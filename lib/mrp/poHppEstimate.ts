// Estimasi HPP & rasio HPP untuk pengajuan approval PO (owner 2026-11-27).
// Dipakai antrean Approval PO (Procurement / SCM / GM) supaya penyetuju melihat perkiraan HPP sebelum menyetujui.
// Murni turunan data yang sudah dimuat store: nol query baru, nol perubahan database.
//
// Rumus per baris warna x lengan x vendor produksi (pcs = qty Aduan Pola vendor itu):
//   Bahan   = roll x 25 kg x harga kain/kg (Master Data Harga Kain, rumus sama dengan nilai PO Material `materialAmountForPo`)
//   Rib     = kg rib (+ kerah, manset) bagian vendor x harga per kg (Master Data Harga RIB / Kerah-Manset; sama dengan estimasi di Buat PO)
//   Diskon  = bahan x rasio diskon historis supplier itu (jumlah diskon invoice / jumlah nilai kain invoice supplier yang sama).
//             Sama dengan HPP aktual: diskon hanya mengurangi bahan (lihat `rawRollCostShares`). Supplier tanpa riwayat = 0.
//   Maklon  = pcs x harga maklon matriks Master Data per tipe (kategori + lengan + tier kapasitas, `hargaMaklonLineRate`; sama dengan invoice vendor)
//   Ongkir  = pcs x rata-rata ongkir per pcs kategori produk (Combed/Dewasa, Kids, Tunik) dari koli yang sudah dikirim
//             (biaya per koli = `koliOngkirShare`, rumus ongkir HPP aktual); kategori tanpa riwayat memakai rata-rata semua kategori.
//   HPP     = bahan + rib - diskon + maklon + ongkir;  Rasio = HPP / nilai jual (harga jual Master SKU per size, lewat Mapping Warna).

import {
  hargaKainRate,
  hargaKerahMansetRateInfo,
  hargaMaklonLineRate,
  hargaRibRateInfo,
  isBillableKoliItem,
  koliOngkirShare,
  maklonTipeForWarna,
  mrpDetailFor,
  segmenProdukLookup,
  sellingPriceFor,
  vendorCumulativeQtyByTipe,
  type SegmenProduk,
} from "./derive";
import { ROLL_KG_ESTIMATE } from "./seed";
import type { DeliveryKoli, Lengan, MaterialPO, MaterialRow, RawMaterialInvoice } from "./types";
import type { MrpDetail } from "./store";
import type { EkspedisiRateRow, HargaKainPksRow, HargaKainRow, HargaKerahMansetRow, HargaMaklonRow, HargaRibRow, ItemSellingPriceRow, KerahMansetSettingRow } from "./masterData";

export type PoHppContext = {
  mrpDetails: MrpDetail[];
  materialPOs: MaterialPO[];
  hargaKain: HargaKainRow[];
  hargaKainPks: HargaKainPksRow[];
  hargaRib: HargaRibRow[];
  hargaKerahManset: HargaKerahMansetRow[];
  kerahMansetSettings: KerahMansetSettingRow[];
  hargaMaklon: HargaMaklonRow[];
  sellingPrices: ItemSellingPriceRow[];
  /** Rata-rata ongkir per pcs per segmen + rata-rata semua (`ongkirPerPcsBySegmen`). */
  ongkir: { bySegmen: Map<SegmenProduk, number>; overall: number };
  /** Rasio diskon per supplier (huruf besar) = diskon / nilai kain invoice (`diskonRatioBySupplier`). */
  diskonRatio: Map<string, number>;
  segmenOf: (mrpId: string, warna: string, lengan: Lengan) => SegmenProduk;
};

export type PoHppLine = {
  mrpId: string;
  vendor: string;
  supplier?: string;
  warna: string;
  lengan: Lengan;
  segmen: SegmenProduk;
  roll: number;
  pcs: number;
  bahan: number;
  rib: number;
  diskon: number;
  maklon: number;
  maklonRate: number;
  ongkir: number;
  hpp: number;
  hargaJual: number;
  /** pcs yang size-nya tidak punya harga jual (nilai jualnya memakai rata-rata size lain baris ini). */
  pcsTanpaHarga: number;
  /** Harga kain tidak ditemukan di Master Data untuk supplier + warna ini. */
  kainTanpaHarga: boolean;
};

export type PoHppEstimate = {
  lines: PoHppLine[];
  pcs: number;
  bahan: number;
  rib: number;
  diskon: number;
  maklon: number;
  ongkir: number;
  hpp: number;
  hargaJual: number;
  /** HPP / nilai jual x 100, hanya dari baris warna yang punya harga jual (sama dengan `hppPercentOf` Laporan HPP: item tanpa harga jual
   *  dikeluarkan dari dua sisi, supaya rasio tidak membengkak). null kalau tidak ada harga jual sama sekali. */
  pct: number | null;
  hppPerPcs: number;
  pcsTanpaHarga: number;
  kainTanpaHarga: number;
};

const up = (s: string | undefined) => (s ?? "").trim().toUpperCase();

/** Rata-rata ongkir per pcs per segmen produk dari koli yang sudah dikirim (reject tidak dihitung). Biaya satu koli dibagi ke
 *  itemnya menurut qty. */
export function ongkirPerPcsBySegmen(kolis: DeliveryKoli[], rates: EkspedisiRateRow[], mrpDetails: MrpDetail[]): { bySegmen: Map<SegmenProduk, number>; overall: number } {
  const seg = segmenProdukLookup(mrpDetails);
  const acc = new Map<SegmenProduk, { biaya: number; pcs: number }>();
  let tb = 0;
  let tp = 0;
  for (const k of kolis) {
    if (!k.deliveredAt) continue;
    const items = k.items.filter(isBillableKoliItem);
    const pcs = items.reduce((s, it) => s + it.qty, 0);
    if (pcs <= 0) continue;
    const biaya = koliOngkirShare(k, kolis, rates);
    if (!(biaya > 0)) continue;
    for (const it of items) {
      if (it.qty <= 0) continue;
      const s = seg(k.mrpId, it.warna, it.lengan, it.usia);
      const cur = acc.get(s) ?? { biaya: 0, pcs: 0 };
      cur.biaya += (biaya * it.qty) / pcs;
      cur.pcs += it.qty;
      acc.set(s, cur);
    }
    tb += biaya;
    tp += pcs;
  }
  const bySegmen = new Map<SegmenProduk, number>();
  for (const [s, a] of acc) if (a.pcs > 0) bySegmen.set(s, a.biaya / a.pcs);
  return { bySegmen, overall: tp > 0 ? tb / tp : 0 };
}

/** Rasio diskon historis per supplier: jumlah diskon invoice bahan / jumlah nilai kain (harga/kg x berat) invoice supplier itu. */
export function diskonRatioBySupplier(invoices: RawMaterialInvoice[]): Map<string, number> {
  const acc = new Map<string, { diskon: number; kain: number }>();
  for (const inv of invoices) {
    const kain = inv.colorEntries.reduce((s, c) => s + c.rolls.reduce((a, w) => a + w, 0) * c.hargaPerRoll, 0);
    if (kain <= 0) continue;
    const key = up(inv.supplier);
    const cur = acc.get(key) ?? { diskon: 0, kain: 0 };
    cur.diskon += Math.max(0, inv.diskon || 0);
    cur.kain += kain;
    acc.set(key, cur);
  }
  const out = new Map<string, number>();
  for (const [k, a] of acc) if (a.kain > 0) out.set(k, Math.min(1, a.diskon / a.kain));
  return out;
}

/** Supplier warna x lengan untuk vendor di MRP itu: PO Material (bukan dibatalkan) yang memuatnya, cadangan pilihan supplier di MaterialRow. */
function supplierFor(ctx: PoHppContext, detail: MrpDetail | undefined, mrpId: string, vendor: string, warna: string, lengan: Lengan): string | undefined {
  const po = ctx.materialPOs.find((p) => p.mrpId === mrpId && p.vendorProduksi === vendor && p.status !== "CANCELLED" && p.colorBreakdown.some((c) => c.warna === warna && c.lengan === lengan));
  if (po) return po.supplier;
  const g = detail?.lenganGroups.find((x) => x.warna === warna && x.lengan === lengan);
  const mr: MaterialRow | undefined = g ? detail?.materialRows.find((m) => m.lenganGroupId === g.id) : undefined;
  return mr?.supplier || undefined;
}

/** Hitung satu baris. `roll` = roll yang dipesan (PO Material, bisa sudah dibulatkan); tanpa itu dipakai roll Aduan Pola. */
function estimateLine(ctx: PoHppContext, mrpId: string, vendor: string, warna: string, lengan: Lengan, rollOverride: number | undefined, supplierOverride: string | undefined, cumulative: Record<string, number>): PoHppLine {
  const detail = mrpDetailFor(mrpId, ctx.mrpDetails);
  const aduan = (detail?.aduanRows ?? []).filter((a) => a.vendor === vendor && a.warna === warna && a.lengan === lengan);
  const group = detail?.lenganGroups.find((g) => g.warna === warna && g.lengan === lengan);
  const pcs = aduan.reduce((s, a) => s + (a.qty || 0), 0);
  const roll = rollOverride ?? aduan.reduce((s, a) => s + (a.qtyRoll || 0), 0);
  const supplier = supplierOverride ?? supplierFor(ctx, detail, mrpId, vendor, warna, lengan);

  // Bahan: roll x 25 kg x harga kain (tier dihitung dari total kg warna ini di PO supplier yang sama, seperti materialAmountForPo).
  const kg = roll * ROLL_KG_ESTIMATE;
  let tierKg = kg;
  if (supplier) {
    tierKg = ctx.materialPOs
      .filter((p) => p.mrpId === mrpId && p.vendorProduksi === vendor && p.supplier === supplier && p.status !== "CANCELLED")
      .reduce((s, p) => s + p.colorBreakdown.filter((c) => c.warna === warna).reduce((t, c) => t + c.rollCount * ROLL_KG_ESTIMATE, 0), 0) || kg;
  }
  const kainRate = supplier ? hargaKainRate(ctx.hargaKain, ctx.hargaKainPks, supplier, warna, tierKg) : 0;
  const bahan = kg * kainRate;

  // Rib, kerah, manset: kg grup x porsi qty vendor ini.
  const share = group && group.totalQty > 0 ? pcs / group.totalQty : 0;
  const ribRate = hargaRibRateInfo(ctx.hargaRib, supplier, warna)?.rate ?? 0;
  const kerahRate = hargaKerahMansetRateInfo(ctx.hargaKerahManset, ctx.kerahMansetSettings, supplier, "KERAH").rate;
  const mansetRate = hargaKerahMansetRateInfo(ctx.hargaKerahManset, ctx.kerahMansetSettings, supplier, "MANSET").rate;
  const rib = group ? share * ((group.ribKg || 0) * ribRate + (group.kerahKg || 0) * kerahRate + (group.mansetKg || 0) * mansetRate) : 0;

  const diskon = bahan * (supplier ? ctx.diskonRatio.get(up(supplier)) ?? 0 : 0);

  const maklonRate = hargaMaklonLineRate(ctx.hargaMaklon, vendor, maklonTipeForWarna(mrpId, warna, lengan, ctx.mrpDetails), lengan, cumulative).rate;
  const maklon = pcs * maklonRate;

  const segmen = ctx.segmenOf(mrpId, warna, lengan);
  const ongkir = pcs * (ctx.ongkir.bySegmen.get(segmen) ?? ctx.ongkir.overall);

  // Nilai jual per size dari Aduan Pola vendor ini.
  let hargaJual = 0;
  let pcsTanpaHarga = 0;
  for (const a of aduan) {
    for (const sz of a.sizes) {
      if (!(sz.qty > 0)) continue;
      const price = sellingPriceFor(warna, lengan, sz.size, ctx.sellingPrices);
      if (price == null || price <= 0) pcsTanpaHarga += sz.qty;
      else hargaJual += price * sz.qty;
    }
  }
  const sizedPcs = aduan.reduce((s, a) => s + a.sizes.reduce((t, z) => t + (z.qty > 0 ? z.qty : 0), 0), 0);
  // Aduan tanpa rincian size: semua pcs dianggap tanpa harga.
  if (sizedPcs < pcs) pcsTanpaHarga += pcs - sizedPcs;
  const priced = pcs - pcsTanpaHarga;
  if (priced > 0 && pcsTanpaHarga > 0) hargaJual += (hargaJual / priced) * pcsTanpaHarga;

  const hpp = bahan + rib - diskon + maklon + ongkir;
  return { mrpId, vendor, supplier, warna, lengan, segmen, roll, pcs, bahan, rib, diskon, maklon, maklonRate, ongkir, hpp, hargaJual, pcsTanpaHarga, kainTanpaHarga: roll > 0 && !(kainRate > 0) };
}

function sum(lines: PoHppLine[]): PoHppEstimate {
  const t = (f: (l: PoHppLine) => number) => lines.reduce((s, l) => s + f(l), 0);
  const pcs = t((l) => l.pcs);
  const hpp = t((l) => l.hpp);
  const hargaJual = t((l) => l.hargaJual);
  return {
    lines,
    pcs,
    bahan: t((l) => l.bahan),
    rib: t((l) => l.rib),
    diskon: t((l) => l.diskon),
    maklon: t((l) => l.maklon),
    ongkir: t((l) => l.ongkir),
    hpp,
    hargaJual,
    pct: hargaJual > 0 ? (lines.filter((l) => l.hargaJual > 0).reduce((s, l) => s + l.hpp, 0) / hargaJual) * 100 : null,
    hppPerPcs: pcs > 0 ? hpp / pcs : 0,
    pcsTanpaHarga: t((l) => l.pcsTanpaHarga),
    kainTanpaHarga: lines.filter((l) => l.kainTanpaHarga).length,
  };
}

/** Estimasi untuk sekumpulan PO Material (satu baris approval = semua PO satu supplier di satu MRP). Roll mengikuti PO. */
export function estimateMaterialPosHpp(pos: MaterialPO[], ctx: PoHppContext): PoHppEstimate {
  const cum = new Map<string, Record<string, number>>();
  const lines: PoHppLine[] = [];
  for (const p of pos) {
    if (!cum.has(p.vendorProduksi)) cum.set(p.vendorProduksi, vendorCumulativeQtyByTipe(p.vendorProduksi, ctx.mrpDetails));
    for (const c of p.colorBreakdown) lines.push(estimateLine(ctx, p.mrpId, p.vendorProduksi, c.warna, c.lengan, c.rollCount, p.supplier, cum.get(p.vendorProduksi)!));
  }
  return sum(lines);
}

/** Estimasi untuk satu PO Produksi: semua warna x lengan vendor itu di MRP itu (`aduanRows` = baris Aduan Pola milik PO ini). */
export function estimateMaklonPoHpp(mrpId: string, vendor: string, aduanRows: { warna: string; lengan: Lengan }[], ctx: PoHppContext): PoHppEstimate {
  const cum = vendorCumulativeQtyByTipe(vendor, ctx.mrpDetails);
  const seen = new Set<string>();
  const lines: PoHppLine[] = [];
  for (const a of aduanRows) {
    const key = a.warna + "|" + a.lengan;
    if (seen.has(key)) continue;
    seen.add(key);
    lines.push(estimateLine(ctx, mrpId, vendor, a.warna, a.lengan, undefined, undefined, cum));
  }
  return sum(lines);
}

/** Gabungan beberapa estimasi (baris kelompok No. MRP di tabel). */
export function mergeHppEstimates(list: PoHppEstimate[]): PoHppEstimate {
  return sum(list.flatMap((e) => e.lines));
}
