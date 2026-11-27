// Estimasi HPP & rasio HPP (owner 2026-11-27). SATU rumus untuk MRP PPIC, SCM Approval MRP, Dashboard, antrean Approval PO, dan Tracking Item.
// Murni turunan data yang sudah dimuat store (nol query baru ke database). Server memakainya juga untuk MENGUNCI estimasi saat PO diajukan.
//
// Rumus per baris warna x lengan x vendor produksi (pcs = qty Aduan Pola vendor itu):
//   Bahan   = roll x 25 kg x harga kain/kg (Master Data Harga Kain, rumus sama dengan nilai PO Material `materialAmountForPo`)
//   Rib     = kg rib (+ kerah, manset) bagian vendor x harga per kg (Master Data Harga RIB / Kerah-Manset; sama dengan estimasi di Buat PO)
//   Diskon  = bahan x rasio diskon historis supplier (jumlah diskon invoice / jumlah nilai kain invoice supplier itu). Sama dengan HPP aktual: diskon hanya
//             mengurangi bahan (lihat `rawRollCostShares`). Supplier tanpa riwayat = 0.
//   Maklon  = pcs x harga matriks Master Data Harga Maklon per vendor + jenis (kategori) + lengan + tier kapasitas (`hargaMaklonLineRate`, sama dengan invoice vendor).
//             Grup FOB: harga FOB per pcs dari PO Produksi FOB (tanpa bahan).
//   Ongkir  = pcs x rata-rata ongkir per pcs kategori produk (Dewasa/Combed, Kids, Tunik) dari koli yang sudah dikirim (`koliOngkirShare`); kategori tanpa
//             riwayat memakai rata-rata semua kategori.
//   HPP     = bahan + rib - diskon + maklon + ongkir;  Rasio = HPP / nilai jual (harga jual Master SKU per size lewat Mapping Warna). Baris warna yang sama sekali
//             tanpa harga jual dikeluarkan dari rasio di dua sisi (pola `hppPercentOf` Laporan HPP).
// Supplier: PO Material warna itu; sebelum ada PO = pilihan supplier di Procurement; belum dipilih = ASUMSI SUPPLIER TERAKHIR yang membeli warna itu (PO Material
// atau invoice bahan terbaru, MRP mana pun), cadangan KNITTO.
// Penguncian: saat Procurement mengajukan PO Material (dan mengajukan ulang / mengubah roll), estimasi per warna x lengan disimpan di entri pengajuan
// (`PoApprovalEntry.hpp`, kolom jsonb approval_log yang sudah ada; tanpa kolom baru). Sesudah itu baris itu memakai angka terkunci, tidak dihitung ulang.

import {
  hargaKainRateInfo,
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
import type { AduanPolaRow, DeliveryKoli, Lengan, LenganGroup, MaklonPO, MaterialPO, RawMaterialInvoice } from "./types";
import type { MrpDetail } from "./store";
import type { EkspedisiRateRow, HargaKainPksRow, HargaKainRow, HargaKerahMansetRow, HargaMaklonRow, HargaRibRow, ItemSellingPriceRow, KerahMansetSettingRow } from "./masterData";
import type { FrozenHppLine, PoApprovalEntry } from "./poApproval";

const SUPPLIER_ACUAN = "KNITTO";

export type HppSourceData = {
  mrpDetails: MrpDetail[];
  materialPOs: MaterialPO[];
  maklonPOs: MaklonPO[];
  invoices: RawMaterialInvoice[];
  deliveryKolis: DeliveryKoli[];
  ekspedisiRates: EkspedisiRateRow[];
  hargaKain: HargaKainRow[];
  hargaKainPks: HargaKainPksRow[];
  hargaRib: HargaRibRow[];
  hargaKerahManset: HargaKerahMansetRow[];
  kerahMansetSettings: KerahMansetSettingRow[];
  hargaMaklon: HargaMaklonRow[];
  itemSellingPrices: ItemSellingPriceRow[];
};

export type PoHppContext = HppSourceData & {
  ongkir: { bySegmen: Map<SegmenProduk, number>; overall: number };
  diskonRatio: Map<string, number>;
  segmenOf: (mrpId: string, warna: string, lengan: Lengan) => SegmenProduk;
  /** Supplier terakhir per warna (huruf besar). */
  lastSupplier: Map<string, string>;
  /** mrp|vendor|warna|lengan -> baris Aduan Pola. */
  aduanIdx: Map<string, AduanPolaRow[]>;
  /** mrp|warna|lengan -> grup lengan. */
  groupIdx: Map<string, LenganGroup>;
  /** mrp|vendor -> PO Material bukan dibatalkan. */
  poIdx: Map<string, MaterialPO[]>;
  /** mrp|vendor|warna|lengan -> estimasi terkunci saat PO Material diajukan. */
  frozenIdx: Map<string, PoHppLine>;
  cumulative: Map<string, Record<string, number>>;
};

export type PoHppLine = {
  mrpId: string;
  vendor: string;
  supplier?: string;
  /** Supplier belum dipilih: memakai supplier terakhir yang membeli warna ini. */
  supplierAsumsi?: boolean;
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
  pcsTanpaHarga: number;
  /** Harga kain tidak ada di supplier itu maupun KNITTO: memakai harga estimasi flat. */
  kainTanpaHarga: boolean;
  /** Harga kain tidak ada di supplier itu: memakai harga KNITTO. */
  kainViaKnitto?: boolean;
  /** Angka dari estimasi yang dikunci saat PO diajukan. */
  frozen?: boolean;
  frozenAt?: string;
  fob?: boolean;
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
  /** Nilai jual baris yang punya harga jual. */
  hargaJual: number;
  /** HPP baris berharga jual / nilai jual x 100; null kalau tidak ada harga jual sama sekali. */
  pct: number | null;
  hppPerPcs: number;
  pcsTanpaHarga: number;
  kainTanpaHarga: number;
  /** Jumlah baris yang memakai angka terkunci / asumsi supplier. */
  frozenLines: number;
  asumsiLines: number;
};

const up = (s: string | undefined) => (s ?? "").trim().toUpperCase();
const k4 = (mrpId: string, vendor: string, warna: string, lengan: string) => `${mrpId}|${vendor}|${warna}|${lengan}`;

/** Rata-rata ongkir per pcs per segmen produk dari koli yang sudah dikirim (reject tidak dihitung). Biaya satu koli dibagi ke itemnya menurut qty. */
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

/** Supplier terakhir yang membeli tiap warna: PO Material terbaru (bukan dibatalkan), lalu invoice bahan terbaru. */
function lastSupplierByWarna(pos: MaterialPO[], invoices: RawMaterialInvoice[]): Map<string, string> {
  const best = new Map<string, { at: string; supplier: string }>();
  const consider = (warna: string, at: string | undefined, supplier: string | undefined) => {
    if (!supplier || up(supplier) === "MIGRASI") return;
    const key = up(warna);
    const t = at ?? "";
    const cur = best.get(key);
    if (!cur || t > cur.at) best.set(key, { at: t, supplier });
  };
  for (const p of pos) {
    if (p.status === "CANCELLED") continue;
    for (const c of p.colorBreakdown) consider(c.warna, p.createdAt ?? p.approvalSubmittedAt, p.supplier);
  }
  for (const inv of invoices) for (const c of inv.colorEntries) consider(c.warna, inv.bookedAt, inv.supplier);
  return new Map(Array.from(best, ([k, v]) => [k, v.supplier]));
}

// --------------------------------------------------------------- Penguncian (simpan / baca) ---------------------------------------------------------------
const r0 = (n: number) => Math.round(n);

export function toFrozenLine(l: PoHppLine): FrozenHppLine {
  return {
    w: l.warna,
    l: l.lengan,
    s: l.supplier ?? "",
    sa: l.supplierAsumsi ? 1 : undefined,
    seg: l.segmen,
    roll: Math.round(l.roll * 1000) / 1000,
    pcs: l.pcs,
    b: r0(l.bahan),
    r: r0(l.rib),
    d: r0(l.diskon),
    m: r0(l.maklon),
    mr: r0(l.maklonRate),
    o: r0(l.ongkir),
    j: r0(l.hargaJual),
    nt: l.pcsTanpaHarga || undefined,
    kt: l.kainTanpaHarga ? 1 : undefined,
    kk: l.kainViaKnitto ? 1 : undefined,
  };
}

function fromFrozenLine(f: FrozenHppLine, mrpId: string, vendor: string, at: string): PoHppLine {
  const hpp = f.b + f.r - f.d + f.m + f.o;
  return {
    mrpId,
    vendor,
    supplier: f.s || undefined,
    supplierAsumsi: !!f.sa,
    warna: f.w,
    lengan: f.l,
    segmen: f.seg,
    roll: f.roll,
    pcs: f.pcs,
    bahan: f.b,
    rib: f.r,
    diskon: f.d,
    maklon: f.m,
    maklonRate: f.mr,
    ongkir: f.o,
    hpp,
    hargaJual: f.j,
    pcsTanpaHarga: f.nt ?? 0,
    kainTanpaHarga: !!f.kt,
    kainViaKnitto: !!f.kk,
    frozen: true,
    frozenAt: at,
  };
}

/** Entri pengajuan terakhir (langkah 1) yang membawa estimasi terkunci. */
export function latestFrozenEntry(log: PoApprovalEntry[] | undefined): PoApprovalEntry | undefined {
  const list = (log ?? []).filter((e) => e.step === 1 && e.hpp && e.hpp.length > 0);
  return list[list.length - 1];
}

/** Baris terkunci milik satu PO Material. PO hasil pecah per entitas menyalin seluruh catatan approval, jadi disaring ke warna x lengan PO itu. */
function frozenLinesOfPo(p: MaterialPO): PoHppLine[] {
  const e = latestFrozenEntry(p.approvalLog);
  if (!e) return [];
  const own = new Set(p.colorBreakdown.map((c) => c.warna + "|" + c.lengan));
  return (e.hpp ?? []).filter((f) => own.has(f.w + "|" + f.l)).map((f) => fromFrozenLine(f, p.mrpId, p.vendorProduksi, e.at));
}

// ------------------------------------------------------------------------- Konteks -------------------------------------------------------------------------
export function buildHppContext(d: HppSourceData): PoHppContext {
  const seg = segmenProdukLookup(d.mrpDetails);
  const aduanIdx = new Map<string, AduanPolaRow[]>();
  const groupIdx = new Map<string, LenganGroup>();
  for (const det of d.mrpDetails) {
    for (const g of det.lenganGroups) groupIdx.set(`${det.mrp.id}|${g.warna}|${g.lengan}`, g);
    for (const a of det.aduanRows) {
      const key = k4(det.mrp.id, a.vendor, a.warna, a.lengan);
      const list = aduanIdx.get(key);
      if (list) list.push(a);
      else aduanIdx.set(key, [a]);
    }
  }
  const poIdx = new Map<string, MaterialPO[]>();
  const frozenIdx = new Map<string, PoHppLine>();
  for (const p of d.materialPOs) {
    if (p.status === "CANCELLED") continue;
    const key = p.mrpId + "|" + p.vendorProduksi;
    const list = poIdx.get(key);
    if (list) list.push(p);
    else poIdx.set(key, [p]);
    for (const l of frozenLinesOfPo(p)) frozenIdx.set(k4(l.mrpId, l.vendor, l.warna, l.lengan), l);
  }
  return {
    ...d,
    ongkir: ongkirPerPcsBySegmen(d.deliveryKolis, d.ekspedisiRates, d.mrpDetails),
    diskonRatio: diskonRatioBySupplier(d.invoices),
    segmenOf: (m, w, l) => seg(m, w, l),
    lastSupplier: lastSupplierByWarna(d.materialPOs, d.invoices),
    aduanIdx,
    groupIdx,
    poIdx,
    frozenIdx,
    cumulative: new Map(),
  };
}

function cumulativeFor(ctx: PoHppContext, vendor: string): Record<string, number> {
  let c = ctx.cumulative.get(vendor);
  if (!c) {
    c = vendorCumulativeQtyByTipe(vendor, ctx.mrpDetails);
    ctx.cumulative.set(vendor, c);
  }
  return c;
}

/** Supplier baris: PO Material yang memuat warna x lengan itu, lalu pilihan di Procurement (MaterialRow), lalu supplier terakhir warna itu (asumsi). */
function supplierFor(ctx: PoHppContext, mrpId: string, vendor: string, warna: string, lengan: Lengan): { supplier: string; asumsi: boolean } {
  const po = (ctx.poIdx.get(mrpId + "|" + vendor) ?? []).find((p) => p.colorBreakdown.some((c) => c.warna === warna && c.lengan === lengan));
  if (po) return { supplier: po.supplier, asumsi: false };
  const det = mrpDetailFor(mrpId, ctx.mrpDetails);
  const g = ctx.groupIdx.get(`${mrpId}|${warna}|${lengan}`);
  const mr = g ? det?.materialRows.find((m) => m.lenganGroupId === g.id) : undefined;
  if (mr?.supplier) return { supplier: mr.supplier, asumsi: false };
  return { supplier: ctx.lastSupplier.get(up(warna)) ?? SUPPLIER_ACUAN, asumsi: true };
}

/** Nilai jual per size dari baris Aduan Pola (size tanpa harga memakai rata-rata size lain baris ini). */
function sellingValue(ctx: PoHppContext, warna: string, lengan: Lengan, aduan: AduanPolaRow[], pcs: number): { hargaJual: number; pcsTanpaHarga: number } {
  let hargaJual = 0;
  let pcsTanpaHarga = 0;
  let sized = 0;
  for (const a of aduan) {
    for (const sz of a.sizes) {
      if (!(sz.qty > 0)) continue;
      sized += sz.qty;
      const price = sellingPriceFor(warna, lengan, sz.size, ctx.itemSellingPrices);
      if (price == null || price <= 0) pcsTanpaHarga += sz.qty;
      else hargaJual += price * sz.qty;
    }
  }
  if (sized < pcs) pcsTanpaHarga += pcs - sized;
  const priced = pcs - pcsTanpaHarga;
  if (priced > 0 && pcsTanpaHarga > 0) hargaJual += (hargaJual / priced) * pcsTanpaHarga;
  return { hargaJual, pcsTanpaHarga };
}

/** Hitung satu baris (tanpa angka terkunci). `roll` = roll yang dipesan PO (bisa sudah dibulatkan); tanpa itu roll Aduan Pola. */
export function liveLine(ctx: PoHppContext, mrpId: string, vendor: string, warna: string, lengan: Lengan, opts?: { roll?: number; supplier?: string }): PoHppLine {
  const aduan = ctx.aduanIdx.get(k4(mrpId, vendor, warna, lengan)) ?? [];
  const group = ctx.groupIdx.get(`${mrpId}|${warna}|${lengan}`);
  const pcs = aduan.reduce((s, a) => s + (a.qty || 0), 0);
  const roll = opts?.roll ?? aduan.reduce((s, a) => s + (a.qtyRoll || 0), 0);
  const sup = opts?.supplier ? { supplier: opts.supplier, asumsi: false } : supplierFor(ctx, mrpId, vendor, warna, lengan);
  const supplier = sup.supplier;

  // Bahan: tier harga kain dari total kg warna ini di PO supplier yang sama (seperti materialAmountForPo).
  const kg = roll * ROLL_KG_ESTIMATE;
  const tierKg =
    (ctx.poIdx.get(mrpId + "|" + vendor) ?? [])
      .filter((p) => p.supplier === supplier)
      .reduce((s, p) => s + p.colorBreakdown.filter((c) => c.warna === warna).reduce((t, c) => t + c.rollCount * ROLL_KG_ESTIMATE, 0), 0) || kg;
  // Warna yang belum punya harga kain di supplier itu memakai harga KNITTO (owner 2026-11-27); tidak ada di KNITTO juga = harga estimasi flat, ditandai.
  let kainInfo = hargaKainRateInfo(ctx.hargaKain, ctx.hargaKainPks, supplier, warna, tierKg);
  let kainViaKnitto = false;
  if (kainInfo.source === "Estimasi" && up(supplier) !== SUPPLIER_ACUAN) {
    const knitto = hargaKainRateInfo(ctx.hargaKain, ctx.hargaKainPks, SUPPLIER_ACUAN, warna, tierKg);
    if (knitto.source !== "Estimasi") {
      kainInfo = knitto;
      kainViaKnitto = true;
    }
  }
  const kainRate = kainInfo.rate;
  const bahan = kg * kainRate;

  const share = group && group.totalQty > 0 ? pcs / group.totalQty : 0;
  const ribRate = hargaRibRateInfo(ctx.hargaRib, supplier, warna)?.rate ?? 0;
  const kerahRate = hargaKerahMansetRateInfo(ctx.hargaKerahManset, ctx.kerahMansetSettings, supplier, "KERAH").rate;
  const mansetRate = hargaKerahMansetRateInfo(ctx.hargaKerahManset, ctx.kerahMansetSettings, supplier, "MANSET").rate;
  const rib = group ? share * ((group.ribKg || 0) * ribRate + (group.kerahKg || 0) * kerahRate + (group.mansetKg || 0) * mansetRate) : 0;
  const diskon = bahan * (ctx.diskonRatio.get(up(supplier)) ?? 0);

  const maklonRate = hargaMaklonLineRate(ctx.hargaMaklon, vendor, maklonTipeForWarna(mrpId, warna, lengan, ctx.mrpDetails), lengan, cumulativeFor(ctx, vendor)).rate;
  const maklon = pcs * maklonRate;
  const segmen = ctx.segmenOf(mrpId, warna, lengan);
  const ongkir = pcs * (ctx.ongkir.bySegmen.get(segmen) ?? ctx.ongkir.overall);
  const { hargaJual, pcsTanpaHarga } = sellingValue(ctx, warna, lengan, aduan, pcs);
  const hpp = bahan + rib - diskon + maklon + ongkir;
  return {
    mrpId, vendor, supplier, supplierAsumsi: sup.asumsi, warna, lengan, segmen, roll, pcs, bahan, rib, diskon, maklon, maklonRate, ongkir, hpp, hargaJual, pcsTanpaHarga,
    kainTanpaHarga: roll > 0 && kainInfo.source === "Estimasi", kainViaKnitto,
  };
}

/** Baris: angka terkunci kalau ada, kalau tidak dihitung dari data terkini. */
function lineFor(ctx: PoHppContext, mrpId: string, vendor: string, warna: string, lengan: Lengan, opts?: { roll?: number; supplier?: string }): PoHppLine {
  return ctx.frozenIdx.get(k4(mrpId, vendor, warna, lengan)) ?? liveLine(ctx, mrpId, vendor, warna, lengan, opts);
}

/** Baris grup FOB (beli jadi dari vendor): tanpa bahan, harga per pcs dari PO Produksi FOB vendor itu. */
function fobLine(ctx: PoHppContext, mrpId: string, g: LenganGroup): PoHppLine {
  const vendor = g.vendorDefault;
  const fobPos = ctx.maklonPOs.filter((p) => p.isFob && p.mrpId === mrpId && p.vendorProduksi === vendor);
  const qty = fobPos.reduce((s, p) => s + p.qty, 0);
  const rate = qty > 0 ? fobPos.reduce((s, p) => s + p.amount, 0) / qty : 0;
  const pcs = g.totalQty;
  const segmen = ctx.segmenOf(mrpId, g.warna, g.lengan);
  const ongkir = pcs * (ctx.ongkir.bySegmen.get(segmen) ?? ctx.ongkir.overall);
  const pseudoAduan = [{ sizes: g.sizes } as AduanPolaRow];
  const { hargaJual, pcsTanpaHarga } = sellingValue(ctx, g.warna, g.lengan, pseudoAduan, pcs);
  const maklon = pcs * rate;
  return {
    mrpId, vendor, warna: g.warna, lengan: g.lengan, segmen, roll: 0, pcs, bahan: 0, rib: 0, diskon: 0, maklon, maklonRate: rate, ongkir,
    hpp: maklon + ongkir, hargaJual, pcsTanpaHarga, kainTanpaHarga: false, fob: true,
  };
}

function sum(lines: PoHppLine[]): PoHppEstimate {
  const t = (f: (l: PoHppLine) => number) => lines.reduce((s, l) => s + f(l), 0);
  const pcs = t((l) => l.pcs);
  const hpp = t((l) => l.hpp);
  const priced = lines.filter((l) => l.hargaJual > 0);
  const hargaJual = priced.reduce((s, l) => s + l.hargaJual, 0);
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
    pct: hargaJual > 0 ? (priced.reduce((s, l) => s + l.hpp, 0) / hargaJual) * 100 : null,
    hppPerPcs: pcs > 0 ? hpp / pcs : 0,
    pcsTanpaHarga: t((l) => l.pcsTanpaHarga),
    kainTanpaHarga: lines.filter((l) => l.kainTanpaHarga).length,
    frozenLines: lines.filter((l) => l.frozen).length,
    asumsiLines: lines.filter((l) => l.supplierAsumsi).length,
  };
}

/** Satu baris approval PO Material (semua PO satu supplier di satu MRP). Roll mengikuti PO. */
export function estimateMaterialPosHpp(pos: MaterialPO[], ctx: PoHppContext): PoHppEstimate {
  const lines: PoHppLine[] = [];
  for (const p of pos)
    for (const c of p.colorBreakdown) lines.push(lineFor(ctx, p.mrpId, p.vendorProduksi, c.warna, c.lengan, { roll: c.rollCount, supplier: p.supplier }));
  return sum(lines);
}

/** Hitung TANPA angka terkunci (dipakai server saat mengunci). */
export function liveMaterialPoLines(p: MaterialPO, ctx: PoHppContext): PoHppLine[] {
  return p.colorBreakdown.map((c) => liveLine(ctx, p.mrpId, p.vendorProduksi, c.warna, c.lengan, { roll: c.rollCount, supplier: p.supplier }));
}

/** Satu PO Produksi: semua warna x lengan vendor itu di MRP itu (`aduanRows` = baris Aduan Pola milik PO ini). */
export function estimateMaklonPoHpp(mrpId: string, vendor: string, aduanRows: { warna: string; lengan: Lengan }[], ctx: PoHppContext): PoHppEstimate {
  const seen = new Set<string>();
  const lines: PoHppLine[] = [];
  for (const a of aduanRows) {
    const key = a.warna + "|" + a.lengan;
    if (seen.has(key)) continue;
    seen.add(key);
    lines.push(lineFor(ctx, mrpId, vendor, a.warna, a.lengan));
  }
  return sum(lines);
}

/** Satu MRP: semua vendor x warna x lengan Aduan Pola (grup FOB lewat harga FOB). Dipakai MRP PPIC, SCM, Dashboard, Tracking Item. */
export function estimateMrpHpp(mrpId: string, ctx: PoHppContext): PoHppEstimate {
  const det = mrpDetailFor(mrpId, ctx.mrpDetails);
  if (!det) return sum([]);
  const fobGroups = new Set(det.lenganGroups.filter((g) => g.catProd === "FOB").map((g) => g.id));
  const seen = new Set<string>();
  const lines: PoHppLine[] = [];
  for (const a of det.aduanRows) {
    if (fobGroups.has(a.lenganGroupId)) continue;
    const key = k4(mrpId, a.vendor, a.warna, a.lengan);
    if (seen.has(key)) continue;
    seen.add(key);
    lines.push(lineFor(ctx, mrpId, a.vendor, a.warna, a.lengan));
  }
  for (const g of det.lenganGroups) if (g.catProd === "FOB" && g.totalQty > 0) lines.push(fobLine(ctx, mrpId, g));
  return sum(lines);
}

export function mergeHppEstimates(list: PoHppEstimate[]): PoHppEstimate {
  return sum(list.flatMap((e) => e.lines));
}

/** Bentuk lama kolom Est. HPP % (MrpHppEstimate) dari estimasi baru, supaya pemakai lama tidak berubah tampilannya. */
export function toMrpHppEstimate(e: PoHppEstimate) {
  return {
    material: e.bahan + e.rib - e.diskon,
    maklon: e.maklon,
    delivery: e.ongkir,
    total: e.hpp,
    hargaJual: e.hargaJual,
    pct: e.pct,
    pcs: e.pcs,
    pcsTanpaHarga: e.pcsTanpaHarga,
  };
}
