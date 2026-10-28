import { supabaseServer } from "../supabase/server";
import { compareNoKoli } from "./derive";
import { fileLinkSignature, signWebhook } from "./wosSign";

/** Integrasi dorong (webhook) ke Warehouse Operation System (WOS) partner -- owner 2026-10-28.
 *  Begitu vendor selesai "Set Ekspedisi & Resi" (setKoliEkspedisiResiGroupAction), ERP mengirim satu kejadian
 *  `resi.created` berisi No. MRP, nama vendor, nomor resi, koli beserta itemnya, dan tautan lampiran resi.
 *  Kiriman ditulis dulu ke antrean `wos_outbox` (migration 0081), baru dikirim; yang gagal dicoba ulang
 *  (`processWosOutbox`, dipanggil dari rute /api/wos/retry dan tiap ada resi baru). Seluruh jalur ini BEST-EFFORT:
 *  kegagalan di sini tidak pernah menggagalkan aksi vendor. Mati total kalau env belum diisi:
 *  WOS_WEBHOOK_URL (alamat endpoint penerima di WOS), WOS_WEBHOOK_SECRET (kunci bersama untuk tanda tangan),
 *  APP_BASE_URL (alamat publik ERP untuk tautan lampiran, bawaan https://mini-erp-tigalapan.vercel.app). */

const EVENT_RESI_CREATED = "resi.created";
const TIMEOUT_MS = 8000;
const MAX_ATTEMPTS = 8;
/** Tautan lampiran dalam kiriman berlaku 7 hari; tiap percobaan kirim ulang membuat tautan baru. */
const LINK_TTL_SEC = 7 * 24 * 3600;
/** File ke-2 dst. foto resi disimpan klien SETELAH aksi utama (lihat saveExtraAttachments), jadi kiriman ditunda sebentar. */
const EXTRA_FILES_GRACE_MS = 12_000;

type Db = ReturnType<typeof supabaseServer>;

type WosConfig = { url: string; secret: string; baseUrl: string };

export function wosConfig(): WosConfig | null {
  const url = process.env.WOS_WEBHOOK_URL?.trim();
  const secret = process.env.WOS_WEBHOOK_SECRET?.trim();
  if (!url || !secret) return null;
  const baseUrl = (process.env.APP_BASE_URL?.trim() || "https://mini-erp-tigalapan.vercel.app").replace(/\/+$/, "");
  return { url, secret, baseUrl };
}

type ResiPayload = {
  event: string;
  eventId: string;
  resi: {
    resiGroupId: string;
    resiNo: string;
    expedition: string;
    note: string;
    shippingDate: string;
    totalKoli: number;
    totalQty: number;
    mrpNumbers: string[];
    vendor: { id: string; name: string };
  };
  kolis: {
    koliId: string;
    koliNo: string;
    mrpNo: string;
    weightKg: number | null;
    items: { color: string; sleeve: string; size: string; sku: string | null; qty: number; kind: string; age: string | null }[];
  }[];
};

/** Susun isi kiriman dari data resi saat ini. Item Reject tidak ikut (sama seperti integrasi WMS: reject bukan barang jadi yang ditagihkan). */
async function buildResiPayload(db: Db, resiGroupId: string): Promise<ResiPayload | null> {
  const { data: koliRows } = await db
    .from("delivery_kolis")
    .select("id,mrp_id,vendor_produksi,ekspedisi,ekspedisi_note,no_koli,no_resi,berat_koli,delivered_at")
    .eq("resi_group_id", resiGroupId);
  if (!koliRows || koliRows.length === 0) return null;

  const koliIds = koliRows.map((k) => k.id as string);
  const { data: itemRows } = await db.from("delivery_koli_items").select("delivery_koli_id,warna,lengan,size,qty,kind,usia").in("delivery_koli_id", koliIds);
  const items = (itemRows ?? []).filter((i) => ((i.kind as string | null) ?? "FG") !== "REJECT");

  const warnas = Array.from(new Set(items.map((i) => i.warna as string)));
  const skuByKey = new Map<string, string>();
  if (warnas.length > 0) {
    const { data: skuRows } = await db.from("item_selling_prices").select("warna,lengan,size,sku").in("warna", warnas);
    for (const r of skuRows ?? []) {
      const key = `${r.warna}|${r.lengan}|${r.size}`;
      if (r.sku && !skuByKey.has(key)) skuByKey.set(key, r.sku as string);
    }
  }

  const vendorId = koliRows[0].vendor_produksi as string;
  const { data: vendorRow } = await db.from("vendors_produksi").select("name").eq("id", vendorId).maybeSingle();

  const kolis = [...koliRows]
    .sort((a, b) => compareNoKoli(a.no_koli as string | undefined, b.no_koli as string | undefined))
    .map((k) => ({
      koliId: k.id as string,
      koliNo: (k.no_koli as string | null) ?? (k.id as string),
      mrpNo: k.mrp_id as string,
      weightKg: k.berat_koli == null ? null : Number(k.berat_koli),
      items: items
        .filter((i) => i.delivery_koli_id === k.id)
        .map((i) => ({
          color: i.warna as string,
          sleeve: i.lengan as string,
          size: i.size as string,
          sku: skuByKey.get(`${i.warna}|${i.lengan}|${i.size}`) ?? null,
          qty: Number(i.qty),
          kind: ((i.kind as string | null) ?? "FG") as string,
          age: (i.usia as string | null) ?? null,
        })),
    }))
    .filter((k) => k.items.length > 0);
  if (kolis.length === 0) return null;

  const first = koliRows[0];
  return {
    event: EVENT_RESI_CREATED,
    eventId: resiGroupId,
    resi: {
      resiGroupId,
      resiNo: (first.no_resi as string | null) ?? resiGroupId,
      expedition: (first.ekspedisi as string | null) ?? "",
      note: (first.ekspedisi_note as string | null) ?? "",
      shippingDate: String(first.delivered_at ?? "").slice(0, 10),
      totalKoli: kolis.length,
      totalQty: kolis.reduce((s, k) => s + k.items.reduce((a, i) => a + i.qty, 0), 0),
      mrpNumbers: Array.from(new Set(kolis.map((k) => k.mrpNo))),
      vendor: { id: vendorId, name: (vendorRow?.name as string | null) ?? vendorId },
    },
    kolis,
  };
}

export type ResiFile = { fileName: string | null; dataUrl: string };

/** Semua file lampiran satu resi: foto utama (tabel lama, satu salinan per koli) + file tambahan (migration 0080). */
export async function loadResiFiles(db: Db, resiGroupId: string): Promise<ResiFile[]> {
  const { data: koliRows } = await db.from("delivery_kolis").select("id").or(`resi_group_id.eq.${resiGroupId},id.eq.${resiGroupId}`).order("id").limit(1);
  const koliId = koliRows?.[0]?.id as string | undefined;
  if (!koliId) return [];
  const { data: main } = await db.from("delivery_koli_ekspedisi_photos").select("data_url,file_name").eq("delivery_koli_id", koliId).maybeSingle();
  if (!main) return [];
  const out: ResiFile[] = [{ dataUrl: main.data_url as string, fileName: (main.file_name as string | null) ?? null }];
  const { data: extras } = await db.from("attachment_files").select("data_url,file_name").eq("kind", "EKSPEDISI_PHOTO").eq("ref_id", resiGroupId).order("id");
  for (const r of extras ?? []) out.push({ dataUrl: r.data_url as string, fileName: (r.file_name as string | null) ?? null });
  return out;
}

function fileUrl(cfg: WosConfig, scope: "list" | "file", resiGroupId: string, index: number, exp: number): string {
  const sig = fileLinkSignature(cfg.secret, scope, resiGroupId, index, exp);
  const path = scope === "list" ? "resi-files" : "resi-file";
  const q = new URLSearchParams({ resi: resiGroupId, ...(scope === "file" ? { i: String(index) } : {}), exp: String(exp), sig });
  return `${cfg.baseUrl}/api/wos/${path}?${q.toString()}`;
}

/** Bagian "attachments" kiriman: tautan ke daftar file (selalu terbaru) dan tautan tiap file yang ada saat dikirim. */
export async function buildAttachments(cfg: WosConfig, db: Db, resiGroupId: string, ttlSec: number = LINK_TTL_SEC) {
  const exp = Math.floor(Date.now() / 1000) + ttlSec;
  const files = await loadResiFiles(db, resiGroupId);
  return {
    manifestUrl: fileUrl(cfg, "list", resiGroupId, 0, exp),
    expiresAt: new Date(exp * 1000).toISOString(),
    files: files.map((f, i) => ({ index: i, fileName: f.fileName, url: fileUrl(cfg, "file", resiGroupId, i, exp) })),
  };
}

async function postToWos(cfg: WosConfig, payload: object, idempotencyKey: string): Promise<{ ok: boolean; status: number | null; error?: string }> {
  const body = JSON.stringify(payload);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(cfg.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-ERP-Event": EVENT_RESI_CREATED,
        "X-ERP-Timestamp": timestamp,
        "X-ERP-Signature": signWebhook(cfg.secret, timestamp, body),
        "Idempotency-Key": idempotencyKey,
      },
      body,
      signal: controller.signal,
    });
    if (res.ok) return { ok: true, status: res.status };
    const text = (await res.text().catch(() => "")).slice(0, 300);
    return { ok: false, status: res.status, error: `HTTP ${res.status}${text ? ": " + text : ""}` };
  } catch (e) {
    return { ok: false, status: null, error: e instanceof Error ? (e.name === "AbortError" ? `Timeout ${TIMEOUT_MS} ms` : e.message) : String(e) };
  } finally {
    clearTimeout(timer);
  }
}

/** Kirim baris antrean yang PENDING/FAILED (maks `limit`, paling lama dulu). Mengembalikan jumlah yang terkirim. */
export async function processWosOutbox(limit = 10): Promise<{ sent: number; failed: number }> {
  const cfg = wosConfig();
  if (!cfg) return { sent: 0, failed: 0 };
  const db = supabaseServer();
  const { data: rows, error } = await db
    .from("wos_outbox")
    .select("id,event,resi_group_id,payload,attempts")
    .in("status", ["PENDING", "FAILED"])
    .lt("attempts", MAX_ATTEMPTS)
    .order("id")
    .limit(limit);
  if (error || !rows) return { sent: 0, failed: 0 };

  let sent = 0;
  let failed = 0;
  for (const row of rows) {
    const resiGroupId = row.resi_group_id as string;
    const attachments = await buildAttachments(cfg, db, resiGroupId);
    const result = await postToWos(cfg, { ...(row.payload as object), sentAt: new Date().toISOString(), attachments }, `${row.event}:${resiGroupId}`);
    const now = new Date().toISOString();
    if (result.ok) {
      sent++;
      await db.from("wos_outbox").update({ status: "SENT", attempts: (row.attempts as number) + 1, last_http_status: result.status, last_error: null, last_attempt_at: now, sent_at: now }).eq("id", row.id);
    } else {
      failed++;
      await db.from("wos_outbox").update({ status: "FAILED", attempts: (row.attempts as number) + 1, last_http_status: result.status, last_error: result.error ?? null, last_attempt_at: now }).eq("id", row.id);
    }
  }
  return { sent, failed };
}

/** Dipanggil setelah vendor selesai Set Ekspedisi & Resi: catat ke antrean lalu coba kirim. Tidak pernah melempar error. */
export async function notifyWosResiCreated(resiGroupId: string): Promise<void> {
  try {
    if (!wosConfig()) return;
    const db = supabaseServer();
    const payload = await buildResiPayload(db, resiGroupId);
    if (!payload) return;
    // Antrekan DULU (kalau proses ini terputus, cron harian tetap mengirimnya), baru tunda sebentar dan kirim.
    const { error } = await db.from("wos_outbox").insert({ event: EVENT_RESI_CREATED, resi_group_id: resiGroupId, payload });
    // 23505 = sudah pernah diantrekan (aksi terpanggil dua kali): cukup lanjut memproses antrean.
    if (error && error.code !== "23505") {
      console.error("[wos] gagal menulis antrean:", error.message);
      return;
    }
    await new Promise((r) => setTimeout(r, EXTRA_FILES_GRACE_MS));
    await processWosOutbox();
  } catch (e) {
    console.error("[wos] notifyWosResiCreated:", e instanceof Error ? e.message : e);
  }
}
