import { supabaseServer } from "../supabase/server";
import { compareNoKoli } from "./derive";
import { fileLinkSignature, signWebhook } from "./wosSign";
import { sheetsConfig, writeResisToSheets, type SheetResi } from "./wosSheets";

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
    items: { color: string; sleeve: string; size: string; sku: string | null; itemName: string | null; qty: number; kind: string; age: string | null }[];
  }[];
};

/** Ambil SEMUA baris query berhalaman (PostgREST membatasi 1000 baris per permintaan; pemotongan diam-diam bikin data resi hilang). */
async function fetchAll<T>(page: (from: number, to: number) => PromiseLike<{ data: T[] | null }>): Promise<T[]> {
  const out: T[] = [];
  const size = 1000;
  for (let from = 0; ; from += size) {
    const { data } = await page(from, from + size - 1);
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < size) break;
  }
  return out;
}

function chunked<T>(list: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += n) out.push(list.slice(i, i + n));
  return out;
}

/** Susun isi kiriman beberapa resi sekaligus dari data saat ini. Item Reject tidak ikut (sama seperti integrasi WMS: reject bukan barang jadi
 *  yang ditagihkan); resi tanpa item barang jadi dilewati (tidak ada di hasil). */
async function buildResiPayloads(db: Db, resiGroupIds: string[]): Promise<Map<string, ResiPayload>> {
  const out = new Map<string, ResiPayload>();
  type Row = Record<string, unknown>;
  const koliRows: Row[] = [];
  for (const ids of chunked(resiGroupIds, 40)) {
    koliRows.push(
      ...(await fetchAll<Row>((a, b) =>
        db.from("delivery_kolis").select("id,resi_group_id,mrp_id,vendor_produksi,ekspedisi,ekspedisi_note,no_koli,no_resi,berat_koli,delivered_at").in("resi_group_id", ids).order("id").range(a, b)
      ))
    );
  }
  if (koliRows.length === 0) return out;

  const itemRows: Row[] = [];
  for (const ids of chunked(koliRows.map((k) => k.id as string), 40)) {
    itemRows.push(
      ...(await fetchAll<Row>((a, b) => db.from("delivery_koli_items").select("id,delivery_koli_id,warna,lengan,size,qty,kind,usia").in("delivery_koli_id", ids).order("id").range(a, b)))
    );
  }
  const items = itemRows.filter((i) => ((i.kind as string | null) ?? "FG") !== "REJECT");

  const warnas = Array.from(new Set(items.map((i) => i.warna as string)));
  const skuByKey = new Map<string, string>();
  const nameByKey = new Map<string, string>();
  for (const ws of chunked(warnas, 20)) {
    const skuRows = await fetchAll<Row>((a, b) => db.from("item_selling_prices").select("id,warna,lengan,size,sku,item_name").in("warna", ws).order("id").range(a, b));
    for (const r of skuRows) {
      const key = `${r.warna}|${r.lengan}|${r.size}`;
      if (r.sku && !skuByKey.has(key)) skuByKey.set(key, r.sku as string);
      if (r.item_name && !nameByKey.has(key)) nameByKey.set(key, r.item_name as string);
    }
  }

  const vendorIds = Array.from(new Set(koliRows.map((k) => k.vendor_produksi as string)));
  const { data: vendorRows } = await db.from("vendors_produksi").select("id,name").in("id", vendorIds);
  const vendorName = new Map((vendorRows ?? []).map((v) => [v.id as string, v.name as string]));

  const koliByResi = new Map<string, Row[]>();
  for (const k of koliRows) {
    const rid = k.resi_group_id as string;
    koliByResi.set(rid, [...(koliByResi.get(rid) ?? []), k]);
  }
  const itemsByKoli = new Map<string, Row[]>();
  for (const i of items) {
    const kid = i.delivery_koli_id as string;
    itemsByKoli.set(kid, [...(itemsByKoli.get(kid) ?? []), i]);
  }

  for (const [resiGroupId, rows] of koliByResi) {
    const kolis = [...rows]
      .sort((a, b) => compareNoKoli(a.no_koli as string | undefined, b.no_koli as string | undefined))
      .map((k) => ({
        koliId: k.id as string,
        koliNo: (k.no_koli as string | null) ?? (k.id as string),
        mrpNo: k.mrp_id as string,
        weightKg: k.berat_koli == null ? null : Number(k.berat_koli),
        items: (itemsByKoli.get(k.id as string) ?? []).map((i) => ({
          color: i.warna as string,
          sleeve: i.lengan as string,
          size: i.size as string,
          sku: skuByKey.get(`${i.warna}|${i.lengan}|${i.size}`) ?? null,
          itemName: nameByKey.get(`${i.warna}|${i.lengan}|${i.size}`) ?? null,
          qty: Number(i.qty),
          kind: ((i.kind as string | null) ?? "FG") as string,
          age: (i.usia as string | null) ?? null,
        })),
      }))
      .filter((k) => k.items.length > 0);
    if (kolis.length === 0) continue;
    const first = rows[0];
    const vendorId = first.vendor_produksi as string;
    out.set(resiGroupId, {
      event: EVENT_RESI_CREATED,
      eventId: resiGroupId,
      resi: {
        resiGroupId,
        resiNo: (first.no_resi as string | null) ?? resiGroupId,
        expedition: (first.ekspedisi as string | null) ?? "",
        note: (first.ekspedisi_note as string | null) ?? "",
        shippingDate: String(first.delivered_at ?? "").slice(0, 10),
        totalKoli: kolis.length,
        totalQty: kolis.reduce((sum, k) => sum + k.items.reduce((a, i) => a + i.qty, 0), 0),
        mrpNumbers: Array.from(new Set(kolis.map((k) => k.mrpNo))),
        vendor: { id: vendorId, name: vendorName.get(vendorId) ?? vendorId },
      },
      kolis,
    });
  }
  return out;
}

async function buildResiPayload(db: Db, resiGroupId: string): Promise<ResiPayload | null> {
  return (await buildResiPayloads(db, [resiGroupId])).get(resiGroupId) ?? null;
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

/** Kirim baris antrean yang PENDING/FAILED (maks `limit`, paling lama dulu). Mengembalikan jumlah yang terkirim dan gagal.
 *  Ke Google Sheets semua baris batch ini ditulis dalam SATU rangkaian panggilan (judul dan id dibaca sekali). */
export async function processWosOutbox(limit = 10): Promise<{ sent: number; failed: number }> {
  // Tujuan: Google Sheets (tab ERP_INCOMING) kalau env-nya lengkap, kalau tidak webhook ke endpoint WOS. Sheets didahulukan.
  const sheets = sheetsConfig();
  const cfg = sheets ? null : wosConfig();
  if (!sheets && !cfg) return { sent: 0, failed: 0 };
  const db = supabaseServer();
  const { data: rows, error } = await db
    .from("wos_outbox")
    .select("id,event,resi_group_id,payload,attempts")
    .in("status", ["PENDING", "FAILED"])
    .lt("attempts", MAX_ATTEMPTS)
    .order("id")
    .limit(limit);
  if (error || !rows || rows.length === 0) return { sent: 0, failed: 0 };

  const mark = async (row: (typeof rows)[number], result: { ok: boolean; status: number | null; error?: string }) => {
    const now = new Date().toISOString();
    if (result.ok) {
      await db.from("wos_outbox").update({ status: "SENT", attempts: (row.attempts as number) + 1, last_http_status: result.status, last_error: null, last_attempt_at: now, sent_at: now }).eq("id", row.id);
    } else {
      await db.from("wos_outbox").update({ status: "FAILED", attempts: (row.attempts as number) + 1, last_http_status: result.status, last_error: result.error ?? null, last_attempt_at: now }).eq("id", row.id);
    }
  };

  if (sheets) {
    try {
      await writeResisToSheets(sheets, rows.map((r) => r.payload as SheetResi));
      for (const row of rows) await mark(row, { ok: true, status: 200 });
      return { sent: rows.length, failed: 0 };
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      for (const row of rows) await mark(row, { ok: false, status: null, error });
      return { sent: 0, failed: rows.length };
    }
  }

  let sent = 0;
  let failed = 0;
  for (const row of rows) {
    const resiGroupId = row.resi_group_id as string;
    const attachments = await buildAttachments(cfg!, db, resiGroupId);
    const result = await postToWos(cfg!, { ...(row.payload as object), sentAt: new Date().toISOString(), attachments }, `${row.event}:${resiGroupId}`);
    await mark(row, result);
    if (result.ok) sent++;
    else failed++;
  }
  return { sent, failed };
}

/** Antrekan SEMUA resi lama yang sudah terkirim (delivered_at terisi, punya grup resi) dan belum pernah masuk antrean -- untuk kirim ulang ke WOS
 *  setelah integrasi dinyalakan. Idempoten: yang sudah ada di antrean dilewati. Resi tanpa grup (data sebelum migration 0026) dan resi yang
 *  isinya hanya reject tidak ikut. */
export async function enqueueAllShippedResis(): Promise<{ resis: number; alreadyQueued: number; queued: number; skipped: number }> {
  const db = supabaseServer();
  const kolis = await fetchAll<{ id: string; resi_group_id: string }>((a, b) =>
    db.from("delivery_kolis").select("id,resi_group_id").not("delivered_at", "is", null).not("resi_group_id", "is", null).order("id").range(a, b)
  );
  const ids = Array.from(new Set(kolis.map((k) => k.resi_group_id))).sort();
  const queuedRows = await fetchAll<{ id: number; resi_group_id: string }>((a, b) => db.from("wos_outbox").select("id,resi_group_id").eq("event", EVENT_RESI_CREATED).order("id").range(a, b));
  const already = new Set(queuedRows.map((r) => r.resi_group_id));
  const fresh = ids.filter((id) => !already.has(id));

  let queued = 0;
  for (const chunk of chunked(fresh, 40)) {
    const payloads = await buildResiPayloads(db, chunk);
    const rows = chunk.filter((id) => payloads.has(id)).map((id) => ({ event: EVENT_RESI_CREATED, resi_group_id: id, payload: payloads.get(id) }));
    if (rows.length > 0) {
      const { error } = await db.from("wos_outbox").upsert(rows, { onConflict: "event,resi_group_id", ignoreDuplicates: true });
      if (error) throw new Error(`Gagal menulis antrean: ${error.message}`);
      queued += rows.length;
    }
  }
  return { resis: ids.length, alreadyQueued: ids.length - fresh.length, queued, skipped: fresh.length - queued };
}

/** Ringkasan antrean untuk halaman Sysadmin. Tidak memuat rahasia apa pun. */
export async function wosOutboxSummary(): Promise<{
  destination: "SHEETS" | "WEBHOOK" | "NONE";
  pending: number;
  sent: number;
  failed: number;
  exhausted: number;
  recentErrors: { resiGroupId: string; attempts: number; error: string; at: string | null }[];
}> {
  const db = supabaseServer();
  const rows = await fetchAll<{ id: number; resi_group_id: string; status: string; attempts: number; last_error: string | null; last_attempt_at: string | null }>((a, b) =>
    db.from("wos_outbox").select("id,resi_group_id,status,attempts,last_error,last_attempt_at").order("id").range(a, b)
  );
  const count = (st: string) => rows.filter((r) => r.status === st).length;
  return {
    destination: sheetsConfig() ? "SHEETS" : wosConfig() ? "WEBHOOK" : "NONE",
    pending: count("PENDING"),
    sent: count("SENT"),
    failed: count("FAILED"),
    exhausted: rows.filter((r) => r.status !== "SENT" && r.attempts >= MAX_ATTEMPTS).length,
    recentErrors: rows
      .filter((r) => r.status === "FAILED" && r.last_error)
      .slice(-5)
      .reverse()
      .map((r) => ({ resiGroupId: r.resi_group_id, attempts: r.attempts, error: r.last_error as string, at: r.last_attempt_at })),
  };
}

/** Setel ulang jumlah percobaan baris yang sudah menyerah (>= batas) supaya dicoba lagi, mis. setelah env diperbaiki. */
export async function resetExhaustedWosOutbox(): Promise<number> {
  const db = supabaseServer();
  const { data, error } = await db.from("wos_outbox").update({ attempts: 0, status: "PENDING" }).neq("status", "SENT").gte("attempts", MAX_ATTEMPTS).select("id");
  if (error) throw new Error(error.message);
  return data?.length ?? 0;
}

/** Dipanggil setelah vendor selesai Set Ekspedisi & Resi: catat ke antrean lalu coba kirim. Tidak pernah melempar error. */
export async function notifyWosResiCreated(resiGroupId: string): Promise<void> {
  try {
    const viaSheets = !!sheetsConfig();
    if (!viaSheets && !wosConfig()) return;
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
    // Jeda hanya untuk webhook (menunggu foto ke-2 dst. tersimpan); Sheets tidak memuat lampiran.
    if (!viaSheets) await new Promise((r) => setTimeout(r, EXTRA_FILES_GRACE_MS));
    await processWosOutbox();
  } catch (e) {
    console.error("[wos] notifyWosResiCreated:", e instanceof Error ? e.message : e);
  }
}
