import type { ColorEntry } from "./types";

export type MergedColorRow = {
  warna: string;
  /** Harga per kg (field `hargaPerRoll` di ColorEntry sebenarnya harga PER KG). */
  hargaPerKg: number;
  rollCount: number;
  totalKg: number;
  /** Jumlah subtotal asli tiap entri (harga x total kg entri itu) -- tidak dihitung ulang dari total gabungan. */
  subtotal: number;
};

/**
 * Gabungkan baris warna·lengan (PENDEK + PANJANG) jadi 1 baris per WARNA untuk tampilan (Finance).
 * Penggabungan per (warna, harga/kg): kalau satu warna ternyata punya 2 harga berbeda di invoice yang
 * sama, kedua harga tetap tampil di baris terpisah -- tidak pernah dirata-ratakan, jadi kg, harga, dan
 * subtotal tidak mungkin meleset. Roll, kg, dan subtotal adalah penjumlahan persis dari entri aslinya.
 */
export function mergeColorEntriesByWarna(entries: ColorEntry[]): MergedColorRow[] {
  const map = new Map<string, MergedColorRow>();
  const order: string[] = [];
  for (const c of entries) {
    const kg = c.rolls.reduce((s, w) => s + w, 0);
    const key = `${c.warna}\u0000${c.hargaPerRoll}`;
    let row = map.get(key);
    if (!row) {
      row = { warna: c.warna, hargaPerKg: c.hargaPerRoll, rollCount: 0, totalKg: 0, subtotal: 0 };
      map.set(key, row);
      order.push(key);
    }
    row.rollCount += c.rolls.length;
    row.totalKg += kg;
    row.subtotal += c.hargaPerRoll * kg;
  }
  return order.map((k) => map.get(k)!);
}
