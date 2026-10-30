import "server-only";
import { supabaseServer } from "../supabase/server";
import { nextReadableId } from "./repo/ids";
import { KIDS_SIZES, SIZE_ORDER } from "./derive";
import type { CuttingExtra } from "./types";

// Hasil tambahan dari sisa kain saat Input Hasil Cutting (migration 0084): kain roll masih bersisa setelah target tercapai dan dipakai
// jadi baju lain (lengan, usia, size apa pun). Barisnya disimpan di production_batches.extra_results (jsonb) dan, begitu SAH,
// dicatat sebagai Finish Good (production_results, kind FG, tanpa target) di grup warna·lengan tujuannya. Catatan hasilnya diawali
// "Sisa kain" (BUKAN "Rework"/"Roll"), jadi tidak mengurangi reject grup tujuan dan tidak tertukar dengan hasil rework.
// SAH = disimpan akun utama (langsung) atau, kalau disimpan anggota tim, setelah akun utama menyetujui (decideCuttingApprovalAction).

type Db = ReturnType<typeof supabaseServer>;
type BatchRef = { id: string; mrp_id: string; vendor_produksi: string; warna: string; lengan: string; code_roll: string | null };

export const EXTRA_NOTE_PREFIX = "Sisa kain";

/** Rapikan dan validasi isian dari klien; melempar Error berpesan jelas kalau ada yang tidak sah. */
export function normalizeExtras(raw: CuttingExtra[] | undefined, label: string): CuttingExtra[] {
  const out: CuttingExtra[] = [];
  for (const x of raw ?? []) {
    if (!x || !(x.qty > 0)) continue;
    if (!Number.isInteger(x.qty)) throw new Error(`Roll ${label}: qty hasil tambahan harus bilangan bulat.`);
    if (x.lengan !== "PENDEK" && x.lengan !== "PANJANG") throw new Error(`Roll ${label}: lengan hasil tambahan tidak valid.`);
    if (x.usia !== "KIDS" && x.usia !== "DEWASA") throw new Error(`Roll ${label}: usia hasil tambahan harus Dewasa atau Kids.`);
    const size = String(x.size ?? "").trim().toUpperCase();
    if (!size) throw new Error(`Roll ${label}: size hasil tambahan wajib diisi.`);
    if (x.usia === "KIDS" ? !KIDS_SIZES.includes(size) : !(SIZE_ORDER.includes(size) || size === "XS")) {
      throw new Error(`Roll ${label}: size ${size} tidak valid untuk ${x.usia === "KIDS" ? "Kids" : "Dewasa"}.`);
    }
    out.push({ lengan: x.lengan, usia: x.usia, size, qty: x.qty });
  }
  return out;
}

/** Hapus hasil tambahan roll-roll ini: Finish Good yang sudah tercatat ikut dihapus (ditolak kalau grup tujuannya sudah dikonfirmasi
 *  Finish Good/Selesai, karena barangnya mungkin sudah dikirim). Tidak melempar error kalau kolom belum ada (migration 0084 belum jalan). */
export async function removeBatchExtras(db: Db, batches: BatchRef[]): Promise<void> {
  if (batches.length === 0) return;
  const { data, error } = await db.from("production_batches").select("id,extra_results").in("id", batches.map((b) => b.id));
  if (error) return;
  const resultIds: string[] = [];
  const groupKeys = new Set<string>();
  for (const row of data ?? []) {
    const b = batches.find((x) => x.id === row.id);
    for (const e of (row.extra_results as (CuttingExtra & { resultId?: string })[] | null) ?? []) {
      if (!e.resultId || !b) continue;
      resultIds.push(e.resultId);
      groupKeys.add(`${b.mrp_id}|${b.warna}|${e.lengan}`);
    }
  }
  if (resultIds.length > 0) {
    const vendor = batches[0].vendor_produksi;
    const { data: metas } = await db.from("production_group_meta").select("group_key,fg_confirmed_at,done_at").in("group_key", Array.from(groupKeys)).eq("vendor_produksi", vendor);
    const locked = (metas ?? []).filter((m) => m.fg_confirmed_at || m.done_at).map((m) => String(m.group_key).split("|").slice(1).join(" · "));
    if (locked.length > 0) {
      throw new Error(`Hasil tambahan sisa kain tidak bisa diubah karena grup ${locked.join(", ")} sudah dikonfirmasi Selesai Produksi. Buka kuncinya dulu di tab Finish Good.`);
    }
    await db.from("production_result_sizes").delete().in("production_result_id", resultIds);
    await db.from("production_results").delete().in("id", resultIds);
  }
  await db.from("production_batches").update({ extra_results: null }).in("id", batches.map((b) => b.id));
}

/** Catat hasil tambahan jadi Finish Good di grup warna·lengan tujuan, lalu simpan `resultId` di baris hasil tambahan roll itu. */
export async function materializeExtras(db: Db, batch: BatchRef, extras: CuttingExtra[], recordedAt: string): Promise<(CuttingExtra & { resultId: string })[]> {
  if (extras.length === 0) return [];
  const { data: maklon } = await db.from("maklon_pos").select("id").eq("mrp_id", batch.mrp_id).eq("vendor_produksi", batch.vendor_produksi).maybeSingle();
  const stored: (CuttingExtra & { resultId: string })[] = [];
  for (const x of extras) {
    const resultId = await nextReadableId("PR");
    const { error } = await db.from("production_results").insert({
      id: resultId,
      group_key: `${batch.mrp_id}|${batch.warna}|${x.lengan}`,
      mrp_id: batch.mrp_id,
      vendor_produksi: batch.vendor_produksi,
      po_id: maklon?.id ?? "",
      warna: batch.warna,
      lengan: x.lengan,
      kind: "FG",
      recorded_at: recordedAt,
      note: `${EXTRA_NOTE_PREFIX} roll ${batch.code_roll ?? batch.id} (${x.usia === "KIDS" ? "Kids" : "Dewasa"})`,
      usia: x.usia,
    });
    if (error) throw new Error(error.message);
    const { error: sizeErr } = await db.from("production_result_sizes").insert({ production_result_id: resultId, size: x.size, qty: x.qty });
    if (sizeErr) throw new Error(sizeErr.message);
    stored.push({ ...x, resultId });
  }
  return stored;
}
