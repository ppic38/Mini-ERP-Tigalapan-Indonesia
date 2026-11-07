import { isEkspedisiBerbiaya } from "./derive";

/** Gerbang kirim ke WOS (owner 2026-11-06): resi baru dikirim ke tab ERP_INCOMING setelah Procurement memvalidasi biaya ekspedisinya
 *  (Invoice Ekspedisi, status tervalidasi / diajukan / lunas), supaya HPP dan ongkir yang sampai ke WOS sudah pasti. Resi pengiriman
 *  internal (tanpa biaya ekspedisi) tidak punya yang perlu divalidasi, jadi langsung boleh dikirim.
 *  Fungsi murni (tanpa database) supaya bisa diuji; pembacaan datanya ada di wosPush.ts. Aturan "validasi" SAMA dengan gate Bongkar Koli
 *  Warehouse (`ekspedisiActualBiaya` di derive.ts): biaya invoice ekspedisi > 0. */

/** Baris `delivery_kolis` seperti yang dibaca dari database (kolom snake_case), hanya bagian yang dipakai gerbang. */
export type GateKoliRow = {
  resi_group_id: string | null;
  ekspedisi: string | null;
  ekspedisi_invoice: { biaya?: unknown } | null;
};

/** Satu koli lolos gerbang: ekspedisinya tidak berbiaya, atau biaya hasil validasi Procurement sudah ada (> 0). */
export function koliPassesWosGate(k: Pick<GateKoliRow, "ekspedisi" | "ekspedisi_invoice">): boolean {
  if (!isEkspedisiBerbiaya(k.ekspedisi ?? "")) return true;
  const biaya = Number(k.ekspedisi_invoice?.biaya);
  return Number.isFinite(biaya) && biaya > 0;
}

/** Peta id grup resi -> boleh dikirim (SEMUA koli resi itu lolos gerbang). Koli tanpa grup resi (data sebelum migration 0026) dilewati. */
export function resiGateMap(kolis: GateKoliRow[]): Map<string, boolean> {
  const out = new Map<string, boolean>();
  for (const k of kolis) {
    if (!k.resi_group_id) continue;
    out.set(k.resi_group_id, (out.get(k.resi_group_id) ?? true) && koliPassesWosGate(k));
  }
  return out;
}
