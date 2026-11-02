import "server-only";
import { supabaseServer } from "../supabase/server";
import { nextReadableId } from "./repo/ids";
import { KIDS_SIZES, SIZE_ORDER } from "./derive";
import type { CuttingExtra, CuttingExtraStored } from "./types";

// Hasil tambahan dari sisa kain saat Input Hasil Cutting (migration 0084): kain roll masih bersisa setelah target tercapai dan dipakai
// jadi baju lain (lengan, usia, size apa pun). Diperlakukan seperti size tambahan roll itu: `qty` = HASIL CUTTING-nya, `fgQty` = Finish Good
// yang diinput belakangan (bisa lebih kecil dari cutting; selisihnya jadi reject saat roll ditutup / grup tujuan diselesaikan, lihat
// expectedRejectGrossForGroup). Baris disimpan di production_batches.extra_results (jsonb). Finish Good-nya (fgQty > 0) dicatat di
// production_results (kind FG, tanpa target) pada grup warna·lengan tujuan; catatannya diawali "Sisa kain" (BUKAN "Rework"/"Roll").

type Db = ReturnType<typeof supabaseServer>;
export type BatchRef = { id: string; mrp_id: string; vendor_produksi: string; warna: string; lengan: string; code_roll: string | null };

export const EXTRA_NOTE_PREFIX = "Sisa kain";

const sameKey = (a: CuttingExtra, b: CuttingExtra) => a.lengan === b.lengan && a.usia === b.usia && a.size === b.size;

/** Rapikan dan validasi isian dari klien; melempar Error berpesan jelas kalau ada yang tidak sah. Baris sama (lengan+usia+size) digabung. */
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
    const next = { lengan: x.lengan, usia: x.usia, size, qty: x.qty };
    const dup = out.find((o) => sameKey(o, next));
    if (dup) dup.qty += next.qty;
    else out.push(next);
  }
  return out;
}

async function deleteResults(db: Db, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await db.from("production_result_sizes").delete().in("production_result_id", ids);
  await db.from("production_results").delete().in("id", ids);
}

/** Pesan kalau Finish Good grup tujuan sudah dikunci ("Selesai Produksi" tahap 1 atau 2), kosong kalau masih boleh diubah. */
async function lockedGroups(db: Db, vendor: string, keys: string[]): Promise<string[]> {
  if (keys.length === 0) return [];
  const { data: metas } = await db.from("production_group_meta").select("group_key,fg_confirmed_at,done_at").in("group_key", keys).eq("vendor_produksi", vendor);
  return (metas ?? []).filter((m) => m.fg_confirmed_at || m.done_at).map((m) => String(m.group_key).split("|").slice(1).join(" · "));
}

/** Lepas hasil tambahan roll-roll ini sebelum diganti/dibatalkan: Finish Good hasilnya dihapus dan kolom dikosongkan. Mengembalikan daftar
 *  lama per roll (untuk mempertahankan fgQty kalau hasil tambahan yang sama disimpan ulang). Ditolak kalau Finish Good yang sudah diinput
 *  ada di grup tujuan yang sudah dikonfirmasi Selesai Produksi. Tidak melempar error kalau kolom belum ada (migration 0084 belum jalan). */
export async function detachBatchExtras(db: Db, batches: BatchRef[]): Promise<Map<string, CuttingExtraStored[]>> {
  const old = new Map<string, CuttingExtraStored[]>();
  if (batches.length === 0) return old;
  const { data, error } = await db.from("production_batches").select("id,extra_results").in("id", batches.map((b) => b.id));
  if (error) return old;
  const resultIds: string[] = [];
  const groupKeys = new Set<string>();
  for (const row of data ?? []) {
    const b = batches.find((x) => x.id === row.id);
    const list = (row.extra_results as CuttingExtraStored[] | null) ?? [];
    old.set(row.id, list);
    for (const e of list) {
      if (!e.resultId || !b) continue;
      resultIds.push(e.resultId);
      groupKeys.add(`${b.mrp_id}|${b.warna}|${e.lengan}`);
    }
  }
  const locked = resultIds.length > 0 ? await lockedGroups(db, batches[0].vendor_produksi, Array.from(groupKeys)) : [];
  if (locked.length > 0) {
    throw new Error(`Hasil tambahan sisa kain tidak bisa diubah karena Finish Good grup ${locked.join(", ")} sudah dikonfirmasi Selesai Produksi. Buka kuncinya dulu di tab Finish Good.`);
  }
  await deleteResults(db, resultIds);
  await db.from("production_batches").update({ extra_results: null }).in("id", batches.map((b) => b.id));
  return old;
}

/** Kompatibel: pakai ini kalau cukup membuang hasil tambahan (batalkan cutting, tolak persetujuan). */
export async function removeBatchExtras(db: Db, batches: BatchRef[]): Promise<void> {
  await detachBatchExtras(db, batches);
}

/** Catat Finish Good hasil tambahan (fgQty) di grup warna·lengan tujuan. Mengembalikan id hasilnya. */
async function createExtraFgResult(db: Db, batch: BatchRef, x: CuttingExtra, fgQty: number, recordedAt: string): Promise<string> {
  const { data: maklon } = await db.from("maklon_pos").select("id").eq("mrp_id", batch.mrp_id).eq("vendor_produksi", batch.vendor_produksi).maybeSingle();
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
  const { error: sizeErr } = await db.from("production_result_sizes").insert({ production_result_id: resultId, size: x.size, qty: fgQty });
  if (sizeErr) throw new Error(sizeErr.message);
  return resultId;
}

/** Simpan daftar hasil tambahan sebuah roll saat Input Hasil Cutting (qty = hasil cutting). fgQty yang sudah pernah diinput untuk baris yang sama
 *  dipertahankan (maks sebesar qty baru) dan Finish Good-nya dicatat ulang. */
export async function persistBatchExtras(db: Db, batch: BatchRef, list: CuttingExtra[], old: CuttingExtraStored[], recordedAt: string): Promise<CuttingExtraStored[]> {
  const stored: CuttingExtraStored[] = [];
  for (const x of list) {
    const o = old.find((y) => sameKey(y, x));
    const fgQty = Math.min(o?.fgQty ?? 0, x.qty);
    const entry: CuttingExtraStored = { ...x, fgQty };
    if (fgQty > 0) entry.resultId = await createExtraFgResult(db, batch, x, fgQty, recordedAt);
    stored.push(entry);
  }
  const { error } = await db.from("production_batches").update({ extra_results: stored.length > 0 ? stored : null }).eq("id", batch.id);
  if (error && stored.length > 0) throw new Error("Gagal menyimpan hasil tambahan sisa kain -- jalankan migration 0084 (production_batches.extra_results) di Supabase dulu. " + error.message);
  return stored;
}

/** Input Finish Good hasil tambahan sebuah roll (tab Finish Good): fgQty per baris, 0..qty (hasil cutting). Ditolak kalau grup tujuannya
 *  sudah dikonfirmasi Selesai Produksi. */
export async function saveBatchExtraFg(db: Db, batch: BatchRef, entries: { lengan: string; usia: string; size: string; fgQty: number }[]): Promise<void> {
  const { data, error } = await db.from("production_batches").select("extra_results").eq("id", batch.id).maybeSingle();
  if (error) throw new Error(error.message);
  const current = ((data?.extra_results as CuttingExtraStored[] | null) ?? []).map((x) => ({ ...x }));
  if (current.length === 0) throw new Error("Roll ini tidak punya hasil tambahan sisa kain.");
  const label = batch.code_roll ?? batch.id;
  const touched: CuttingExtraStored[] = [];
  for (const e of entries) {
    const x = current.find((c) => c.lengan === e.lengan && c.usia === e.usia && c.size === e.size);
    if (!x) throw new Error(`Roll ${label}: hasil tambahan ${e.size} (${e.usia}) tidak ditemukan.`);
    if (!Number.isInteger(e.fgQty) || e.fgQty < 0) throw new Error(`Roll ${label}: Finish Good hasil tambahan harus bilangan bulat 0 atau lebih.`);
    if (e.fgQty > x.qty) throw new Error(`Roll ${label}: Finish Good ${e.size} (${e.fgQty}) melebihi hasil cutting-nya (${x.qty}).`);
    touched.push(x);
  }
  const locked = await lockedGroups(db, batch.vendor_produksi, Array.from(new Set(touched.map((x) => `${batch.mrp_id}|${batch.warna}|${x.lengan}`))));
  if (locked.length > 0) throw new Error(`Finish Good grup ${locked.join(", ")} sudah dikonfirmasi Selesai Produksi -- buka kuncinya dulu di tab Finish Good.`);
  const recordedAt = new Date().toISOString();
  for (const e of entries) {
    const x = current.find((c) => c.lengan === e.lengan && c.usia === e.usia && c.size === e.size)!;
    if (x.resultId) await deleteResults(db, [x.resultId]);
    x.fgQty = e.fgQty;
    x.resultId = e.fgQty > 0 ? await createExtraFgResult(db, batch, x, e.fgQty, recordedAt) : undefined;
  }
  const { error: upErr } = await db.from("production_batches").update({ extra_results: current }).eq("id", batch.id);
  if (upErr) throw new Error(upErr.message);
}
