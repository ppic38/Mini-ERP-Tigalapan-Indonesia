import type { HppRow } from "./derive";
import type { Lengan } from "./types";

// Laporan HPP untuk diunduh (template CAL HPP ERP, revisi 2026-11-02). Dua kelompok: ON GOING (estimasi) = baris dari roll yang BELUM ditutup
// (biaya roll dibagi hasil cutting), FINAL = baris dari roll yang sudah ditutup (dibagi Finish Good aktual) plus baris rework/pool lama.
// Begitu roll ditutup baris-barisnya pindah otomatis ke FINAL karena pengelompokan memakai `HppRow.sementara`. Tiap kelompok punya:
//  - Item   : satu baris per warna · lengan · size, rata-rata TERTIMBANG pcs dari semua roll, koli, resi, dan vendor (tidak melebar)
//  - Roll   : satu baris per roll x size x koli (resi dan ongkirnya jelas per baris; baris pool lama tanpa koli digabung)

export type HppReportRow = HppRow & { noResi?: string; tanggalKirim?: string };

export type HppItemLine = {
  warna: string;
  lengan: Lengan;
  size: string;
  vendors: string[];
  fg: number;
  bahanPcs: number;
  ribPcs: number;
  cogsBahanPcs: number;
  maklonPcs: number;
  ongkirPcs: number;
  hppPcs: number;
  hppMin: number;
  hppMax: number;
  hargaJual: number | null;
  ratio: number | null;
  totalHpp: number;
  jumlahRoll: number;
  jumlahResi: number;
};

export type HppRollLine = {
  vendor: string;
  warna: string;
  lengan: Lengan;
  size: string;
  /** Kode roll; baris tanpa roll berlabel "(rework)" atau "(tanpa roll)". */
  roll: string;
  invoiceMaterial: string;
  grossKg: number | null;
  hargaPerKg: number | null;
  biayaBahanRoll: number;
  diskonRoll: number;
  ribRoll: number;
  /** Dasar porsi diskon/rib (kosong untuk baris tanpa roll). */
  invDiskon: number | null;
  invKg: number | null;
  warnaRib: number | null;
  warnaKg: number | null;
  pembagi: number | null;
  fg: number;
  resi: string;
  koli: string;
  /** Rincian ongkir (satu baris = satu koli): ongkir per pcs = ongkirResi x beratKoli / beratResi / pcsKoli. Null untuk baris pool lama tanpa koli. */
  ongkirResi: number | null;
  beratResi: number | null;
  beratKoli: number | null;
  pcsKoli: number | null;
  bahanPcs: number;
  diskonPcs: number;
  ribPcs: number;
  cogsBahanPcs: number;
  maklonPcs: number;
  ongkirPcs: number;
  hppPcs: number;
  hargaJual: number | null;
  ratio: number | null;
  totalHpp: number;
};

export type HppReportGroup = { items: HppItemLine[]; rolls: HppRollLine[] };
export type HppReport = { estimasi: HppReportGroup; final: HppReportGroup };

const uniq = <T,>(xs: T[]) => Array.from(new Set(xs));
const wavg = (rows: HppReportRow[], pick: (r: HppReportRow) => number) => {
  const w = rows.reduce((s, r) => s + r.fg, 0);
  return w > 0 ? rows.reduce((s, r) => s + pick(r) * r.fg, 0) / w : 0;
};
// Baris rework/pool lama tidak punya rincian rib/diskon: biaya bahannya (kalau ada) dianggap semua "bahan".
const bahanOf = (r: HppReportRow) => r.bahanPerItem ?? r.cogsBahanPerItem;
const ribOf = (r: HppReportRow) => r.ribPerItem ?? 0;

function hargaJualOf(rows: HppReportRow[]): number | null {
  const priced = rows.filter((r) => r.sellingPricePerItem != null && r.sellingPricePerItem > 0);
  if (priced.length === 0) return null;
  const w = priced.reduce((s, r) => s + r.fg, 0);
  return w > 0 ? priced.reduce((s, r) => s + (r.sellingPricePerItem as number) * r.fg, 0) / w : null;
}

function buildGroup(rows: HppReportRow[]): HppReportGroup {
  const byItem = new Map<string, HppReportRow[]>();
  const byRoll = new Map<string, HppReportRow[]>();
  for (const r of rows) {
    if (r.fg <= 0) continue;
    const ik = r.warna + "|" + r.lengan + "|" + r.size;
    byItem.set(ik, [...(byItem.get(ik) ?? []), r]);
    const rollKey = r.rollId ?? (r.rework > 0 ? "rework" : "pool");
    // Satu baris Detail Roll = satu roll x size x koli, supaya ongkir per resi / koli bisa ditulis sebagai rumus yang bisa ditelusuri.
    const rk = r.vendorProduksi + "|" + rollKey + "|" + ik + "|" + (r.koliId ?? "");
    byRoll.set(rk, [...(byRoll.get(rk) ?? []), r]);
  }

  const items: HppItemLine[] = Array.from(byItem.values()).map((rs) => {
    const fg = rs.reduce((s, r) => s + r.fg, 0);
    const hppPcs = wavg(rs, (r) => r.hppPerItem);
    const jual = hargaJualOf(rs);
    return {
      warna: rs[0].warna,
      lengan: rs[0].lengan,
      size: rs[0].size,
      vendors: uniq(rs.map((r) => r.vendorProduksi)).sort(),
      fg,
      bahanPcs: wavg(rs, bahanOf),
      ribPcs: wavg(rs, ribOf),
      cogsBahanPcs: wavg(rs, (r) => r.cogsBahanPerItem),
      maklonPcs: wavg(rs, (r) => r.biayaProduksiPerItem),
      ongkirPcs: wavg(rs, (r) => r.ongkirPerItem),
      hppPcs,
      hppMin: Math.min(...rs.map((r) => r.hppPerItem)),
      hppMax: Math.max(...rs.map((r) => r.hppPerItem)),
      hargaJual: jual,
      ratio: jual != null && jual > 0 ? hppPcs / jual : null,
      totalHpp: rs.reduce((s, r) => s + r.hppPerItem * r.fg, 0),
      jumlahRoll: uniq(rs.map((r) => r.rollId).filter(Boolean)).length,
      jumlahResi: uniq(rs.map((r) => r.noResi).filter(Boolean)).length,
    };
  });
  items.sort((a, b) => a.warna.localeCompare(b.warna) || (a.lengan === b.lengan ? 0 : a.lengan === "PENDEK" ? -1 : 1) || a.size.localeCompare(b.size, "id-ID", { numeric: true }));

  const rolls: HppRollLine[] = Array.from(byRoll.values()).map((rs) => {
    const first = rs[0];
    const fg = rs.reduce((s, r) => s + r.fg, 0);
    const hppPcs = wavg(rs, (r) => r.hppPerItem);
    const jual = hargaJualOf(rs);
    return {
      vendor: first.vendorProduksi,
      warna: first.warna,
      lengan: first.lengan,
      size: first.size,
      roll: first.rollCode ?? (first.rework > 0 ? "(rework)" : "(tanpa roll)"),
      invoiceMaterial: first.rawInvoiceNo ?? "",
      grossKg: first.rollGrossKg ?? null,
      hargaPerKg: first.rollHargaPerKg ?? null,
      biayaBahanRoll: first.rollBody ?? 0,
      diskonRoll: first.rollDiskon ?? 0,
      ribRoll: first.rollRib ?? 0,
      invDiskon: first.rollInvDiskon ?? null,
      invKg: first.rollInvKg ?? null,
      warnaRib: first.rollWarnaRib ?? null,
      warnaKg: first.rollWarnaKg ?? null,
      pembagi: first.divisorQty ?? null,
      fg,
      resi: uniq(rs.map((r) => r.noResi).filter(Boolean)).join(", "),
      koli: uniq(rs.map((r) => r.noKoli).filter(Boolean)).join(", "),
      ongkirResi: first.ongkirResi ?? null,
      beratResi: first.beratResi ?? null,
      beratKoli: first.beratKoli ?? null,
      pcsKoli: first.pcsKoli ?? null,
      bahanPcs: wavg(rs, bahanOf),
      diskonPcs: wavg(rs, (r) => r.diskonPerItem ?? 0),
      ribPcs: wavg(rs, ribOf),
      cogsBahanPcs: wavg(rs, (r) => r.cogsBahanPerItem),
      maklonPcs: wavg(rs, (r) => r.biayaProduksiPerItem),
      ongkirPcs: wavg(rs, (r) => r.ongkirPerItem),
      hppPcs,
      hargaJual: jual,
      ratio: jual != null && jual > 0 ? hppPcs / jual : null,
      totalHpp: rs.reduce((s, r) => s + r.hppPerItem * r.fg, 0),
    };
  });
  rolls.sort((a, b) => a.vendor.localeCompare(b.vendor) || a.warna.localeCompare(b.warna) || a.roll.localeCompare(b.roll) || a.size.localeCompare(b.size, "id-ID", { numeric: true }));
  // HPP terendah/tertinggi per item = antar baris Detail Roll item itu (bukan antar koli/resi mentah), supaya angkanya bisa ditelusuri dan dihitung ulang
  // di Excel dari sheet Detail Roll.
  for (const it of items) {
    const mine = rolls.filter((r) => r.warna === it.warna && r.lengan === it.lengan && r.size === it.size).map((r) => r.hppPcs);
    if (mine.length > 0) {
      it.hppMin = Math.min(...mine);
      it.hppMax = Math.max(...mine);
    }
  }
  return { items, rolls };
}

/** Bagi baris HPP jadi ON GOING (estimasi, roll belum ditutup) dan FINAL (roll sudah ditutup, rework, pool lama). */
export function buildHppReport(rows: HppReportRow[]): HppReport {
  return { estimasi: buildGroup(rows.filter((r) => r.sementara)), final: buildGroup(rows.filter((r) => !r.sementara)) };
}
