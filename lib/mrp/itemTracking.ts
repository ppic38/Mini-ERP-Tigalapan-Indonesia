import type { MrpDetail } from "./store";
import { SIZE_ORDER, compareNoKoli, invoiceAwaitingPayment, targetSizesForBatch } from "./derive";
import { LT_CUTTING_KE_FG, LT_DEL_MAT_DEFAULT, LT_FG_KE_KIRIM, dayKey, ltDelMat, ltTiba, maxDay, minDay, parseLooseDay, plusDays } from "./itemEstimates";
import type { WosKoliStatus } from "./wosStatusMap";
import type { AduanPolaRow, DeliveryKoli, Lengan, MaterialPO, ProductionBatch, ProductionResult, RawMaterialInvoice, WarehouseReceipt } from "./types";

/** Tracking Item (PPIC dan SCM, owner 2026-10-26): memantau SATU ITEM (warna + lengan + size, mis. "HITAM 24S PDK L"), bukan satu warna, dari rencana
 *  MRP sampai diterima gudang. Semua angka turunan dari data yang sudah ada:
 *   - Target MRP    : qty size itu di grup warna·lengan semua MRP (MRP berstatus ditolak tidak dihitung).
 *   - Alokasi vendor: qty size itu di Aduan Pola per vendor (sisa target yang belum punya vendor ditampilkan sebagai "Belum dialokasikan").
 *   - Cutting       : hasil cutting aktual roll yang sudah dicutting (`production_batches.sizeQty`).
 *   - Finish Good   : akumulasi hasil FG per size (sudah termasuk koreksi dan hasil rework); Reject: akumulasi reject.
 *   - Di koli       : sudah masuk koli tetapi belum dikirim; Dikirim: koli yang sudah punya resi/terkirim (reject tidak dihitung).
 *   - Diterima DC   : koli yang sudah diterima di DC = penerimaan Warehouse ERP ATAU status "Diterima" dari WOS (tab ERP_INCOMING), tanpa hitung ganda.
 *
 *  Angka KUMULATIF di atas (cutting, fg, dikirim, ...) tetap disimpan. Selain itu tiap sel punya qty POSISI SAAT INI (owner 2026-11-07: "qty harus beralih
 *  dari satu proses ke proses berikutnya"): barang hanya dihitung di SATU tahap, jadi cutting 100 dan FG 90 berarti 10 pcs di Cutting dan 90 pcs di FG:
 *   belumCutting = target - cutting
 *   cuttingWip   = cutting - FG - reject          (sudah dicutting, belum jadi FG)
 *   fgWip        = FG - di koli - dikirim         (sudah FG, belum masuk koli)
 *   diKoli       = sudah di koli, belum dikirim
 *   perjalanan   = dikirim - diterima - tiba DC   (di jalan, belum sampai DC)
 *   tibaDc       = tiba di DC tetapi belum divalidasi WOS
 *   diterima     = diterima di DC
 *  Tiap selisih dijaga tidak negatif per sel (MRP x vendor x item) sebelum dijumlahkan. */

export type ItemStage = {
  alokasi: number;
  cutting: number;
  fg: number;
  reject: number;
  diKoli: number;
  dikirim: number;
  diterima: number;
  /** Posisi saat ini (tidak tumpang tindih), lihat catatan di atas. */
  belumCutting: number;
  cuttingWip: number;
  fgWip: number;
  perjalanan: number;
  tibaDc: number;
};

/** Pengiriman item per tanggal kirim: qty dan nomor koli yang dikirim pada tanggal itu. */
export type ItemShipment = { date: string; qty: number; koli: string[] };

/** Informasi per sel (MRP x vendor x item) yang tidak bisa dijumlahkan: tanggal dan daftar koli. */
export type ItemCellInfo = {
  /** Tanggal roll PERTAMA diterima (Good Receive). */
  grAt?: string;
  /** Tanggal cutting pertama yang memuat size ini. */
  cuttingAt?: string;
  /** Tanggal FG PERTAMA dicatat untuk item ini (tanggal awal FG). */
  fgFirstAt?: string;
  /** Tanggal FG terakhir dicatat (dasar Est. Kirim untuk FG yang menunggu). */
  fgAt?: string;
  /** Tanggal item ini PERTAMA masuk koli (tanggal awal di koli). */
  koliFirstAt?: string;
  /** Tanggal kirim TERAKHIR (pengiriman terbaru); dasar Est. Tiba terbaru. */
  shipLastAt?: string;
  shipments: ItemShipment[];
  /** Nomor koli yang sudah berisi item ini tetapi belum dikirim. */
  inKoli: string[];
  receivedKoli: string[];
  receivedAt?: string;
  /** Estimasi per tahap, hanya untuk qty yang MASIH di tahap itu (kosong = tidak ada yang menunggu atau belum bisa dihitung).
   *  Est. Tiba beda: murni tanggal kirim aktual + LT untuk koli yang sudah dikirim dan belum sampai DC; tanpa pengiriman tidak ada Est. Tiba. */
  estFg?: string;
  estKirimCut?: string;
  estKirimFg?: string;
  estKirim?: string;
  estTiba?: string;
};

export type ItemMrpVendorRow = ItemStage &
  ItemCellInfo & {
    key: string;
    mrpId: string;
    /** "" = bagian target MRP yang belum dialokasikan ke vendor mana pun. */
    vendorProduksi: string;
    kategori: string;
  };

export type ItemTrackRow = ItemStage & {
  key: string;
  warna: string;
  lengan: Lengan;
  size: string;
  /** Nama item, mis. "HITAM 24S PDK L". */
  itemName: string;
  kategori: string[];
  mrpIds: string[];
  /** Target item ini = jumlah alokasi semua vendor ditambah bagian yang belum dialokasikan (= rencana MRP; kalau alokasi vendor melebihi rencana, alokasi yang dipakai). */
  target: number;
  /** Target yang belum selesai menjadi Finish Good (tidak pernah negatif). */
  sisaProduksi: number;
  breakdown: ItemMrpVendorRow[];
  grAt?: string;
  cuttingAt?: string;
  fgFirstAt?: string;
  koliFirstAt?: string;
  shipLastAt?: string;
  /** Tanggal estimasi item: yang PALING LAMBAT di antara sel yang masih menunggu tahap itu (kapan semuanya beres). */
  estFg?: string;
  estKirim?: string;
  estTiba?: string;
  /** Semua tanggal kirim (urut naik), gabungan semua sel. */
  shipDates: string[];
  receivedAt?: string;
  receivedKoli: string[];
};

const emptyStage = (): ItemStage => ({ alokasi: 0, cutting: 0, fg: 0, reject: 0, diKoli: 0, dikirim: 0, diterima: 0, belumCutting: 0, cuttingWip: 0, fgWip: 0, perjalanan: 0, tibaDc: 0 });
const emptyInfo = (): ItemCellInfo => ({ shipments: [], inKoli: [], receivedKoli: [] });
const STAGE_KEYS: (keyof ItemStage)[] = ["alokasi", "cutting", "fg", "reject", "diKoli", "dikirim", "diterima", "belumCutting", "cuttingWip", "fgWip", "perjalanan", "tibaDc"];

export const lenganShort = (l: Lengan) => (l === "PENDEK" ? "PDK" : "PJG");
export const itemNameOf = (warna: string, lengan: Lengan, size: string) => `${warna} ${lenganShort(lengan)} ${size}`;

function sizeRank(size: string): number {
  const i = SIZE_ORDER.indexOf(size.trim().toUpperCase());
  return i < 0 ? SIZE_ORDER.length : i;
}

const uniqSorted = (xs: string[]) => Array.from(new Set(xs)).sort((a, b) => compareNoKoli(a, b));

/** Isi ringkasan item dari rincian selnya (qty dijumlahkan, tanggal digabung). `out` harus sudah nol. */
function applyBreakdown(out: ItemTrackRow, breakdown: ItemMrpVendorRow[]) {
  out.kategori = [];
  out.mrpIds = [];
  const dates = new Set<string>();
  const received: string[] = [];
  for (const b of breakdown) {
    for (const key of STAGE_KEYS) out[key] += b[key];
    if (b.kategori && !out.kategori.includes(b.kategori)) out.kategori.push(b.kategori);
    if (!out.mrpIds.includes(b.mrpId)) out.mrpIds.push(b.mrpId);
    out.grAt = minDay(out.grAt, b.grAt);
    out.cuttingAt = minDay(out.cuttingAt, b.cuttingAt);
    out.fgFirstAt = minDay(out.fgFirstAt, b.fgFirstAt);
    out.koliFirstAt = minDay(out.koliFirstAt, b.koliFirstAt);
    out.shipLastAt = maxDay(out.shipLastAt, b.shipLastAt);
    out.estFg = maxDay(out.estFg, b.estFg);
    out.estKirim = maxDay(out.estKirim, b.estKirim);
    out.estTiba = maxDay(out.estTiba, b.estTiba);
    out.receivedAt = maxDay(out.receivedAt, b.receivedAt);
    for (const s of b.shipments) dates.add(s.date);
    received.push(...b.receivedKoli);
  }
  out.kategori.sort();
  out.shipDates = Array.from(dates).sort();
  out.receivedKoli = uniqSorted(received);
  out.target = out.alokasi;
  out.sisaProduksi = Math.max(0, out.target - out.fg);
}

const blankItem = (key: string, warna: string, lengan: Lengan, size: string): ItemTrackRow => ({
  key, warna, lengan, size, itemName: itemNameOf(warna, lengan, size), kategori: [], mrpIds: [], target: 0, sisaProduksi: 0, breakdown: [], shipDates: [], receivedKoli: [], ...emptyStage(),
});

/** Hitung ulang satu item dari sebagian rinciannya (dipakai saat filter No. MRP, vendor, kategori, atau tanggal kirim aktif). */
export function itemWithBreakdown(it: ItemTrackRow, breakdown: ItemMrpVendorRow[]): ItemTrackRow {
  const out: ItemTrackRow = { ...blankItem(it.key, it.warna, it.lengan, it.size), breakdown };
  applyBreakdown(out, breakdown);
  return out;
}

export type ItemTrackingExtra = {
  /** Invoice bahan baku (store.invoices): sumber Good Receive vendor (roll diterima dan tanggalnya). */
  invoices?: RawMaterialInvoice[];
  /** Status penerimaan DC per koli dari WOS (tab ERP_INCOMING); kosong = integrasi belum aktif. */
  wosByKoli?: Record<string, WosKoliStatus>;
  /** Untuk tanggal Tracking per roll: hasil FG (tanggal FG pertama per roll) dan PO Material (tanggal PO). */
  results?: ProductionResult[];
  materialPOs?: MaterialPO[];
};

export function buildItemTracking(
  mrpDetails: MrpDetail[],
  batches: ProductionBatch[],
  results: ProductionResult[],
  kolis: DeliveryKoli[],
  receipts: WarehouseReceipt[],
  extra: ItemTrackingExtra = {}
): ItemTrackRow[] {
  const active = mrpDetails.filter((d) => d.ppicApproval !== "REJECTED");
  const activeIds = new Set(active.map((d) => d.mrp.id));

  const targetByMrpItem = new Map<string, number>(); // mrp|warna|lengan|size
  const allocatedByMrpItem = new Map<string, number>();
  const kategoriOfGroup = new Map<string, string>(); // mrp|warna|lengan
  const cells = new Map<string, ItemMrpVendorRow & { warna: string; lengan: Lengan; size: string }>();
  const transitDates = new Map<string, string[]>(); // kunci sel -> tanggal kirim koli yang masih di jalan

  const cell = (mrpId: string, vendor: string, warna: string, lengan: Lengan, size: string) => {
    const key = `${mrpId}|${vendor}|${warna}|${lengan}|${size}`;
    let c = cells.get(key);
    if (!c) {
      c = { key, mrpId, vendorProduksi: vendor, kategori: kategoriOfGroup.get(`${mrpId}|${warna}|${lengan}`) ?? "", warna, lengan, size, ...emptyStage(), ...emptyInfo() };
      cells.set(key, c);
    }
    return c;
  };

  for (const d of active) {
    for (const g of d.lenganGroups) {
      kategoriOfGroup.set(`${d.mrp.id}|${g.warna}|${g.lengan}`, g.kategori || d.mrp.kategori || "");
      for (const s of g.sizes) {
        const k = `${d.mrp.id}|${g.warna}|${g.lengan}|${s.size}`;
        targetByMrpItem.set(k, (targetByMrpItem.get(k) ?? 0) + s.qty);
      }
    }
  }
  for (const d of active) {
    for (const a of d.aduanRows) {
      for (const s of a.sizes) {
        cell(d.mrp.id, a.vendor, a.warna, a.lengan, s.size).alokasi += s.qty;
        const k = `${d.mrp.id}|${a.warna}|${a.lengan}|${s.size}`;
        allocatedByMrpItem.set(k, (allocatedByMrpItem.get(k) ?? 0) + s.qty);
      }
    }
  }
  // Target yang belum punya vendor.
  for (const [k, target] of targetByMrpItem) {
    const rest = target - (allocatedByMrpItem.get(k) ?? 0);
    if (rest <= 0) continue;
    const [mrpId, warna, lengan, size] = k.split("|");
    cell(mrpId, "", warna, lengan as Lengan, size).alokasi += rest;
  }

  for (const b of batches) {
    if (!activeIds.has(b.mrpId) || !b.cuttingAt || !b.sizeQty) continue;
    const day = dayKey(b.cuttingAt);
    for (const [size, qty] of Object.entries(b.sizeQty)) {
      const c = cell(b.mrpId, b.vendorProduksi, b.warna, b.lengan, size);
      c.cutting += qty;
      if (qty > 0) c.cuttingAt = minDay(c.cuttingAt, day);
    }
  }
  for (const r of results) {
    if (!activeIds.has(r.mrpId) || (r.kind !== "FG" && r.kind !== "REJECT")) continue;
    const day = dayKey(r.recordedAt);
    for (const [size, qty] of Object.entries(r.sizeQty)) {
      const c = cell(r.mrpId, r.vendorProduksi, r.warna, r.lengan, size);
      if (r.kind === "FG") {
        c.fg += qty;
        if (qty > 0) {
          c.fgAt = maxDay(c.fgAt, day);
          c.fgFirstAt = minDay(c.fgFirstAt, day);
        }
      } else c.reject += qty;
    }
  }

  // Penerimaan Warehouse ERP: qty dari item penerimaan (angka yang dihitung gudang), dan tanggal terima per koli.
  const erpReceivedAt = new Map<string, string | undefined>();
  for (const rc of receipts) {
    if (!activeIds.has(rc.mrpId)) continue;
    for (const id of rc.koliIds) erpReceivedAt.set(id, dayKey(rc.receivedAt));
    for (const it of rc.items) {
      if (it.kind === "REJECT") continue;
      cell(rc.mrpId, rc.vendorProduksi, it.warna, it.lengan, it.size).diterima += it.qty;
    }
  }

  const wos = extra.wosByKoli ?? {};
  const shipByCell = new Map<string, Map<string, { qty: number; koli: Set<string> }>>();
  for (const k of kolis) {
    if (!activeIds.has(k.mrpId)) continue;
    const koliNo = k.noKoli || k.id;
    const sentDay = k.deliveredAt ? dayKey(k.deliveredAt) : undefined;
    const erpAt = erpReceivedAt.has(k.id);
    const w = wos[k.id];
    const wosReceived = !!w && (w.code === "DITERIMA" || w.code === "BERMASALAH");
    const wosArrived = !!w && w.code === "TIBA";
    for (const it of k.items) {
      if (it.kind === "REJECT") continue;
      const c = cell(k.mrpId, k.vendorProduksi, it.warna, it.lengan, it.size);
      c.koliFirstAt = minDay(c.koliFirstAt, dayKey(k.createdAt));
      if (!k.deliveredAt) {
        c.diKoli += it.qty;
        if (!c.inKoli.includes(koliNo)) c.inKoli.push(koliNo);
        continue;
      }
      c.dikirim += it.qty;
      if (sentDay) {
        const byDate = shipByCell.get(c.key) ?? new Map<string, { qty: number; koli: Set<string> }>();
        const s = byDate.get(sentDay) ?? { qty: 0, koli: new Set<string>() };
        s.qty += it.qty;
        s.koli.add(koliNo);
        byDate.set(sentDay, s);
        shipByCell.set(c.key, byDate);
      }
      if (erpAt) {
        // qty sudah dihitung dari item penerimaan ERP di atas.
        if (!c.receivedKoli.includes(koliNo)) c.receivedKoli.push(koliNo);
        c.receivedAt = maxDay(c.receivedAt, erpReceivedAt.get(k.id));
      } else if (wosReceived) {
        c.diterima += it.qty;
        if (!c.receivedKoli.includes(koliNo)) c.receivedKoli.push(koliNo);
        c.receivedAt = maxDay(c.receivedAt, parseLooseDay(w?.diterimaPada));
      } else if (wosArrived) {
        c.tibaDc += it.qty;
      } else if (sentDay) {
        const list = transitDates.get(c.key) ?? [];
        list.push(sentDay);
        transitDates.set(c.key, list);
      }
    }
  }

  // Good Receive vendor per MRP x vendor x warna x lengan, dari invoice bahan baku.
  const grByGroup = new Map<string, { arrived: number; total: number; at?: string }>();
  for (const inv of extra.invoices ?? []) {
    if (!activeIds.has(inv.mrpId)) continue;
    for (const c of inv.colorEntries) {
      const key = `${inv.mrpId}|${inv.destinationVendor}|${c.warna}|${c.lengan}`;
      const g = grByGroup.get(key) ?? { arrived: 0, total: 0 };
      const arrivals = inv.rollArrivals[c.warna + "|" + c.lengan] ?? [];
      g.total += c.rolls.length;
      c.rolls.forEach((_, idx) => {
        const a = arrivals[idx];
        if (!a) return;
        g.arrived++;
        g.at = minDay(g.at, dayKey(a.arrivedAt));
      });
      grByGroup.set(key, g);
    }
  }

  for (const c of cells.values()) {
    c.belumCutting = Math.max(0, c.alokasi - c.cutting);
    c.cuttingWip = Math.max(0, c.cutting - c.fg - c.reject);
    c.fgWip = Math.max(0, c.fg - c.diKoli - c.dikirim);
    c.perjalanan = Math.max(0, c.dikirim - c.diterima - c.tibaDc);

    const gr = grByGroup.get(`${c.mrpId}|${c.vendorProduksi}|${c.warna}|${c.lengan}`);
    c.grAt = gr?.at;
    c.inKoli.sort(compareNoKoli);
    c.receivedKoli.sort(compareNoKoli);
    c.shipments = Array.from(shipByCell.get(c.key) ?? [])
      .map(([date, s]) => ({ date, qty: s.qty, koli: Array.from(s.koli).sort(compareNoKoli) }))
      .sort((a, b) => a.date.localeCompare(b.date));
    c.shipLastAt = c.shipments.length > 0 ? c.shipments[c.shipments.length - 1].date : undefined;

    // Estimasi: hanya untuk qty yang masih menunggu tahap itu.
    c.estFg = c.cuttingWip > 0 ? plusDays(c.cuttingAt, LT_CUTTING_KE_FG) : undefined;
    c.estKirimCut = c.cuttingWip > 0 ? plusDays(c.estFg, LT_FG_KE_KIRIM) : undefined;
    c.estKirimFg = c.fgWip > 0 || c.diKoli > 0 ? plusDays(c.fgAt, LT_FG_KE_KIRIM) : undefined;
    c.estKirim = maxDay(c.estKirimCut, c.estKirimFg);
    // Est. Tiba HANYA dari tanggal kirim aktual (owner 2026-11-07): koli yang sudah dikirim tetapi belum sampai di DC = tanggal kirim + LT. Barang yang belum dikirim tidak punya Est. Tiba.
    const lt = ltTiba(c.vendorProduksi);
    let tiba: string | undefined;
    for (const d of transitDates.get(c.key) ?? []) tiba = maxDay(tiba, plusDays(d, lt));
    c.estTiba = tiba;
  }

  const items = new Map<string, ItemTrackRow>();
  const itemOf = (warna: string, lengan: Lengan, size: string) => {
    const key = `${warna}|${lengan}|${size}`;
    let it = items.get(key);
    if (!it) {
      it = blankItem(key, warna, lengan, size);
      items.set(key, it);
    }
    return it;
  };
  for (const c of cells.values()) itemOf(c.warna, c.lengan, c.size).breakdown.push(c);

  const out = Array.from(items.values());
  for (const it of out) {
    it.breakdown.sort((a, b) => b.mrpId.localeCompare(a.mrpId, undefined, { numeric: true }) || a.vendorProduksi.localeCompare(b.vendorProduksi));
    applyBreakdown(it, it.breakdown);
    it.mrpIds.sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
  }
  return out.sort((a, b) => a.warna.localeCompare(b.warna) || a.lengan.localeCompare(b.lengan) || sizeRank(a.size) - sizeRank(b.size) || a.size.localeCompare(b.size));
}

/** Satu koli yang memuat item ini (Tracking Item, klik item): isi koli, status kirim (ekspedisi, resi, tanggal), dan tanggal diterima gudang. */
export type ItemKoliRow = {
  koliId: string;
  mrpId: string;
  vendorProduksi: string;
  noKoli: string;
  /** Qty item ini di koli itu (beberapa roll/usia untuk size yang sama dijumlah; reject tidak dihitung). */
  qty: number;
  beratKoli?: number;
  ekspedisi?: string;
  noResi?: string;
  deliveredAt?: string;
  /** Tanggal penerimaan Warehouse (koli dibongkar); kosong = belum diterima. */
  receivedAt?: string;
};

/** Koli yang memuat item (warna·lengan·size) pada pasangan MRP+vendor yang tampil di rincian item (mengikuti filter aktif). */
export function koliRowsForItem(item: ItemTrackRow, kolis: DeliveryKoli[], receipts: WarehouseReceipt[]): ItemKoliRow[] {
  const scope = new Set(item.breakdown.map((b) => b.mrpId + "|" + b.vendorProduksi));
  const receivedAt = new Map<string, string>();
  for (const rc of receipts) for (const id of rc.koliIds) receivedAt.set(id, rc.receivedAt);
  const out: ItemKoliRow[] = [];
  for (const k of kolis) {
    if (!scope.has(k.mrpId + "|" + k.vendorProduksi)) continue;
    const qty = k.items.reduce((s, it) => s + (it.kind !== "REJECT" && it.warna === item.warna && it.lengan === item.lengan && it.size === item.size ? it.qty : 0), 0);
    if (qty <= 0) continue;
    out.push({
      koliId: k.id, mrpId: k.mrpId, vendorProduksi: k.vendorProduksi, noKoli: k.noKoli, qty, beratKoli: k.beratKoli,
      ekspedisi: k.ekspedisi || undefined, noResi: k.noResi, deliveredAt: k.deliveredAt, receivedAt: receivedAt.get(k.id),
    });
  }
  return out.sort(
    (a, b) => b.mrpId.localeCompare(a.mrpId, undefined, { numeric: true }) || a.vendorProduksi.localeCompare(b.vendorProduksi) || (a.noResi ?? "").localeCompare(b.noResi ?? "") || compareNoKoli(a.noKoli, b.noKoli)
  );
}

/* ------------------------------------------------------------------------------------------------------------------------------
 * Tracking per ROLL x SIZE (owner 2026-11-16, revisi: "line seperti Detail Roll HPP; aduan M-L = 2 line, M-M = 1 line, karena
 * produksi by aduan"). Satu baris = satu roll (production_batches) x satu size aduan roll itu:
 *   target     : target roll itu = target aduan diprorata menurut jumlah roll (targetSizesForBatch, sama dengan form Cutting vendor)
 *   cutting/FG : hasil cutting dan Finish Good roll itu (`sizeQty`, `fgSizeQty`); reject = cutting - FG kalau roll sudah ditutup
 *   koli       : item koli yang roll asalnya (sourceBatchId) roll itu
 * Roll yang belum di-resting belum punya kode roll: sisa target aduannya tampil sebagai satu baris per size berstatus
 * "Belum resting". Yang tidak bisa ditelusuri ke satu roll (FG rework dan sisa kain, koli lama tanpa roll asal) menjadi baris
 * "Rework / tanpa roll", dan target tanpa vendor menjadi "Belum dialokasikan"; keduanya selisih terhadap angka sel Tracking Item
 * (buildItemTracking), sehingga jumlah semua baris sama dengan angka sel itu.
 * ------------------------------------------------------------------------------------------------------------------------------ */

/** Urutan tahapan baris (dipakai status dan filter). */
// Nama status mengikuti status staging standar (lib/mrp/flowStatus.ts, owner 2026-11-16). "Belum dialokasikan" dan "Belum resting" tetap: baris rencana
// belum punya roll, jadi tahap materialnya tidak bisa ditentukan per baris.
export const ADUAN_STAGES = ["Belum dialokasikan", "Belum resting", "Resting", "Cutting", "Finish Good", "Done FG", "Packing", "Delivery FG", "GR DC"] as const;
export type AduanStage = (typeof ADUAN_STAGES)[number];

export type AduanTrackRow = {
  key: string;
  /** Kunci sel Tracking Item (MRP|vendor|warna|lengan|size), dipakai export. */
  cellKey: string;
  mrpId: string;
  vendorProduksi: string;
  /** Kode aduan (kosong untuk baris sisa / belum dialokasikan). */
  kode: string;
  /** Kode roll (kosong kalau belum resting atau baris sisa). */
  codeRoll: string;
  /** "roll" = roll yang sudah di-resting; "rencana" = roll aduan yang belum di-resting; "sisa" = rework / tanpa roll asal;
   *  "belum" = target belum dialokasikan ke vendor. */
  jenis: "roll" | "rencana" | "sisa" | "belum";
  /** Jumlah roll di baris ini: 1 untuk baris roll, sisa roll rencana untuk baris "rencana". */
  qtyRoll: number;
  /** Penanda roll yang sama di beberapa baris size (id roll, atau "rencana|{id aduan}"). Dipakai menjumlah roll tanpa
   *  menghitung satu roll dua kali (aduan M-L = satu roll di dua baris). Kosong untuk baris sisa. */
  rollKey: string;
  kategori: string;
  warna: string;
  lengan: Lengan;
  size: string;
  itemName: string;
  target: number;
  cutting: number;
  fg: number;
  reject: number;
  diKoli: number;
  dikirim: number;
  tibaDc: number;
  diterima: number;
  belumCutting: number;
  cuttingWip: number;
  fgWip: number;
  perjalanan: number;
  status: AduanStage;
  /** Tanggal PO Material (PO yang memuat warna x lengan ini untuk vendor itu; paling awal). */
  poMaterialAt?: string;
  /** Tanggal bahan dikirim ke vendor (Set Delivery invoice bahan) dan tanggal roll diterima vendor (Good Receive). Baris roll
   *  memakai invoice yang memuat code roll itu; baris lain memakai yang paling awal untuk MRP x vendor x warna x lengan. */
  deliveryAt?: string;
  grAt?: string;
  restingAt?: string;
  cuttingAt?: string;
  /** Tanggal Finish Good pertama roll x size ini (catatan hasil "Roll {kode}", sama dengan export WIP). */
  fgFirstAt?: string;
  closedAt?: string;
  koliFirstAt?: string;
  shipLastAt?: string;
  estTiba?: string;
  shipDates: string[];
  koliNos: string[];
  /** Koli roll x size ini dengan nomor resinya dan posisinya: packing = belum dikirim, kirim = sudah dikirim belum diterima DC, terima = sudah diterima DC. */
  koliRefs: { id: string; no: string; resi: string; state: "packing" | "kirim" | "terima"; qty: number; sentAt?: string }[];
};

const SUM_FIELDS = ["target", "cutting", "fg", "reject", "diKoli", "dikirim", "tibaDc", "diterima"] as const;

export function buildAduanTracking(
  items: ItemTrackRow[],
  mrpDetails: MrpDetail[],
  batches: ProductionBatch[],
  kolis: DeliveryKoli[],
  receipts: WarehouseReceipt[],
  extra: ItemTrackingExtra = {}
): AduanTrackRow[] {
  const active = mrpDetails.filter((d) => d.ppicApproval !== "REJECTED");
  const activeIds = new Set(active.map((d) => d.mrp.id));
  const kategoriOf = new Map<string, string>();
  for (const d of active) for (const g of d.lenganGroups) kategoriOf.set(`${d.mrp.id}|${g.warna}|${g.lengan}`, g.kategori || d.mrp.kategori || "");
  const aduanById = new Map<string, { mrpId: string; a: AduanPolaRow; aduanRows: AduanPolaRow[] }>();
  for (const d of active) for (const a of d.aduanRows) aduanById.set(a.id, { mrpId: d.mrp.id, a, aduanRows: d.aduanRows });

  const rows = new Map<string, AduanTrackRow>();
  const blank = (key: string, mrpId: string, vendor: string, kode: string, codeRoll: string, jenis: AduanTrackRow["jenis"], warna: string, lengan: Lengan, size: string): AduanTrackRow => ({
    key,
    cellKey: `${mrpId}|${vendor}|${warna}|${lengan}|${size}`,
    mrpId,
    vendorProduksi: vendor,
    kode,
    codeRoll,
    jenis,
    qtyRoll: 0,
    rollKey: "",
    kategori: kategoriOf.get(`${mrpId}|${warna}|${lengan}`) ?? "",
    warna,
    lengan,
    size,
    itemName: itemNameOf(warna, lengan, size),
    target: 0,
    cutting: 0,
    fg: 0,
    reject: 0,
    diKoli: 0,
    dikirim: 0,
    tibaDc: 0,
    diterima: 0,
    belumCutting: 0,
    cuttingWip: 0,
    fgWip: 0,
    perjalanan: 0,
    status: "GR DC",
    shipDates: [],
    koliNos: [],
    koliRefs: [],
  });

  // Baris roll: satu per roll x size (size aduan, ditambah size lain yang muncul di hasil roll, mis. alih size).
  const batchById = new Map<string, ProductionBatch>();
  const startedByAduan = new Map<string, ProductionBatch[]>();
  const rollRow = (b: ProductionBatch, size: string) => {
    const key = `${b.id}|${size}`;
    let r = rows.get(key);
    if (!r) {
      const info = aduanById.get(b.aduanRowId);
      r = blank(key, b.mrpId, b.vendorProduksi, info?.a.kode ?? b.kode ?? "", b.codeRoll ?? "", "roll", b.warna, b.lengan, size);
      r.qtyRoll = 1;
      r.rollKey = b.id;
      r.restingAt = b.restingAt ? dayKey(b.restingAt) : undefined;
      r.cuttingAt = b.cuttingAt ? dayKey(b.cuttingAt) : undefined;
      r.closedAt = b.closedAt ? dayKey(b.closedAt) : undefined;
      rows.set(key, r);
    }
    return r;
  };
  for (const b of batches) {
    if (!activeIds.has(b.mrpId)) continue;
    batchById.set(b.id, b);
    const info = aduanById.get(b.aduanRowId);
    if (info) {
      const list = startedByAduan.get(b.aduanRowId);
      if (list) list.push(b);
      else startedByAduan.set(b.aduanRowId, [b]);
    }
    const target = info ? targetSizesForBatch(b, info.aduanRows) : {};
    const sizes = new Set([...Object.keys(target), ...Object.keys(b.cuttingAt ? (b.sizeQty ?? {}) : {}), ...Object.keys(b.fgSizeQty ?? {})]);
    for (const size of sizes) {
      const r = rollRow(b, size);
      r.target += target[size] ?? 0;
      const cut = b.cuttingAt ? (b.sizeQty?.[size] ?? 0) : 0;
      const fg = b.fgSizeQty?.[size] ?? 0;
      r.cutting += cut;
      r.fg += fg;
      if (b.closedAt) r.reject += Math.max(0, cut - fg);
    }
  }

  // Baris rencana: roll aduan yang belum di-resting (belum ada kode roll), sisa target per size.
  for (const [aduanId, info] of aduanById) {
    const started = startedByAduan.get(aduanId) ?? [];
    const plan = Math.max(started.length, Math.ceil(info.a.qtyRoll - 0.01));
    const restRolls = plan - started.length;
    if (started.length === 0 && restRolls <= 0) continue;
    const usedTarget: Record<string, number> = {};
    for (const b of started) for (const [size, q] of Object.entries(targetSizesForBatch(b, info.aduanRows))) usedTarget[size] = (usedTarget[size] ?? 0) + q;
    for (const s of info.a.sizes) {
      const rest = s.qty - (usedTarget[s.size] ?? 0);
      // Target per roll dibulatkan, jadi jumlahnya bisa lebih/kurang beberapa pcs dari target aduan. Kalau tidak ada roll
      // rencana yang menampung selisihnya, selisih itu dibebankan ke roll terakhir supaya jumlah target tetap = target aduan.
      if (restRolls <= 0 || rest <= 0) {
        const last = started[started.length - 1];
        const lastRow = last ? rows.get(`${last.id}|${s.size}`) : undefined;
        if (rest !== 0 && lastRow) lastRow.target = Math.max(0, lastRow.target + rest);
        continue;
      }
      const r = blank(`rencana|${aduanId}|${s.size}`, info.mrpId, info.a.vendor, info.a.kode, "", "rencana", info.a.warna, info.a.lengan, s.size);
      r.qtyRoll = restRolls;
      r.rollKey = `rencana|${aduanId}`;
      r.target = rest;
      rows.set(r.key, r);
    }
  }

  // Koli: item yang roll asalnya roll itu.
  const erpReceived = new Set<string>();
  for (const rc of receipts) if (activeIds.has(rc.mrpId)) for (const id of rc.koliIds) erpReceived.add(id);
  const wos = extra.wosByKoli ?? {};
  for (const k of kolis) {
    if (!activeIds.has(k.mrpId)) continue;
    const koliNo = k.noKoli || k.id;
    const sentDay = k.deliveredAt ? dayKey(k.deliveredAt) : undefined;
    const w = wos[k.id];
    const received = erpReceived.has(k.id) || (!!w && (w.code === "DITERIMA" || w.code === "BERMASALAH"));
    const arrived = !received && !!w && w.code === "TIBA";
    for (const it of k.items) {
      if (it.kind === "REJECT" || !it.sourceBatchId) continue;
      const b = batchById.get(it.sourceBatchId);
      if (!b) continue;
      const r = rollRow(b, it.size);
      r.koliFirstAt = minDay(r.koliFirstAt, dayKey(k.createdAt));
      if (!r.koliNos.includes(koliNo)) r.koliNos.push(koliNo);
      const refState: "packing" | "kirim" | "terima" = !k.deliveredAt ? "packing" : received ? "terima" : "kirim";
      const ref = r.koliRefs.find((x) => x.id === k.id && x.state === refState);
      if (ref) ref.qty += it.qty;
      else r.koliRefs.push({ id: k.id, no: koliNo, resi: (k.noResi ?? "").trim(), state: refState, qty: it.qty, sentAt: sentDay });
      if (!k.deliveredAt) {
        r.diKoli += it.qty;
        continue;
      }
      r.dikirim += it.qty;
      if (sentDay) {
        if (!r.shipDates.includes(sentDay)) r.shipDates.push(sentDay);
        r.shipLastAt = maxDay(r.shipLastAt, sentDay);
      }
      if (received) r.diterima += it.qty;
      else if (arrived) r.tibaDc += it.qty;
      else if (sentDay) r.estTiba = maxDay(r.estTiba, plusDays(sentDay, ltTiba(k.vendorProduksi)));
    }
  }

  // Baris sisa: selisih angka sel Tracking Item terhadap jumlah baris roll/rencana sel itu.
  const sumByCell = new Map<string, Record<(typeof SUM_FIELDS)[number], number>>();
  for (const r of rows.values()) {
    const t = sumByCell.get(r.cellKey) ?? { target: 0, cutting: 0, fg: 0, reject: 0, diKoli: 0, dikirim: 0, tibaDc: 0, diterima: 0 };
    for (const f of SUM_FIELDS) t[f] += r[f];
    sumByCell.set(r.cellKey, t);
  }
  for (const it of items) {
    for (const c of it.breakdown) {
      const t = sumByCell.get(c.key);
      const cellVal: Record<(typeof SUM_FIELDS)[number], number> = {
        target: c.alokasi,
        cutting: c.cutting,
        fg: c.fg,
        reject: c.reject,
        diKoli: c.diKoli,
        dikirim: c.dikirim,
        tibaDc: c.tibaDc,
        diterima: c.diterima,
      };
      const rest = SUM_FIELDS.map((f) => [f, cellVal[f] - (t?.[f] ?? 0)] as const);
      if (!rest.some(([, v]) => v > 0)) continue;
      const r = blank(`sisa|${c.key}`, c.mrpId, c.vendorProduksi, "", "", c.vendorProduksi ? "sisa" : "belum", it.warna, it.lengan, it.size);
      for (const [f, v] of rest) r[f] = Math.max(0, v);
      r.cuttingAt = c.cuttingAt;
      r.koliFirstAt = c.koliFirstAt;
      r.shipDates = c.shipments.map((s) => s.date);
      r.shipLastAt = c.shipLastAt;
      r.estTiba = c.estTiba;
      r.koliNos = [...c.inKoli];
      rows.set(r.key, r);
    }
  }

  // Tanggal PO Material, delivery bahan, Good Receive, dan FG pertama.
  const poAt = new Map<string, string>(); // mrp|vendor|warna|lengan
  for (const po of extra.materialPOs ?? []) {
    if (po.status === "CANCELLED" || !activeIds.has(po.mrpId)) continue;
    const day = dayKey(po.createdAt ?? po.approvalSubmittedAt);
    if (!day) continue;
    const lines = po.colorBreakdown.length > 0 ? po.colorBreakdown : [{ warna: po.warna, lengan: po.lengan }];
    for (const c of lines) {
      const k = `${po.mrpId}|${po.vendorProduksi}|${c.warna}|${c.lengan}`;
      poAt.set(k, minDay(poAt.get(k), day)!);
    }
  }
  const matByRoll = new Map<string, { delivery?: string; gr?: string }>(); // mrp|vendor|codeRoll
  const matByGroup = new Map<string, { delivery?: string; gr?: string }>(); // mrp|vendor|warna|lengan
  for (const inv of extra.invoices ?? []) {
    if (!activeIds.has(inv.mrpId)) continue;
    const delivery = inv.deliveredAt ? dayKey(inv.deliveredAt) : undefined;
    for (const c of inv.colorEntries) {
      const gk = `${inv.mrpId}|${inv.destinationVendor}|${c.warna}|${c.lengan}`;
      const g = matByGroup.get(gk) ?? {};
      g.delivery = minDay(g.delivery, delivery);
      for (const a of inv.rollArrivals[c.warna + "|" + c.lengan] ?? []) {
        if (!a) continue;
        const gr = dayKey(a.arrivedAt);
        g.gr = minDay(g.gr, gr);
        if (a.codeRoll) matByRoll.set(`${inv.mrpId}|${inv.destinationVendor}|${a.codeRoll}`, { delivery, gr });
      }
      matByGroup.set(gk, g);
    }
  }
  const fgFirst = new Map<string, string>(); // mrp|vendor|codeRoll|size
  for (const res of extra.results ?? []) {
    if (res.kind !== "FG" || !res.note?.startsWith("Roll ") || !activeIds.has(res.mrpId)) continue;
    const day = dayKey(res.recordedAt);
    for (const [size, qty] of Object.entries(res.sizeQty)) {
      if (!(qty > 0)) continue;
      const k = `${res.mrpId}|${res.vendorProduksi}|${res.note.slice(5).trim()}|${size}`;
      fgFirst.set(k, minDay(fgFirst.get(k), day)!);
    }
  }
  for (const r of rows.values()) {
    const gk = `${r.mrpId}|${r.vendorProduksi}|${r.warna}|${r.lengan}`;
    r.poMaterialAt = poAt.get(gk);
    const mat = (r.codeRoll ? matByRoll.get(`${r.mrpId}|${r.vendorProduksi}|${r.codeRoll}`) : undefined) ?? matByGroup.get(gk);
    r.deliveryAt = mat?.delivery;
    r.grAt = r.jenis === "rencana" ? undefined : mat?.gr;
    if (r.codeRoll) r.fgFirstAt = fgFirst.get(`${r.mrpId}|${r.vendorProduksi}|${r.codeRoll}|${r.size}`);
  }

  for (const r of rows.values()) {
    const b = r.jenis === "roll" ? batchById.get(r.key.slice(0, r.key.lastIndexOf("|"))) : undefined;
    r.belumCutting = r.jenis === "rencana" || r.jenis === "belum" || (b && !b.cuttingAt) ? r.target : 0;
    r.cuttingWip = Math.max(0, r.cutting - r.fg - r.reject);
    r.fgWip = Math.max(0, r.fg - r.diKoli - r.dikirim);
    r.perjalanan = Math.max(0, r.dikirim - r.diterima - r.tibaDc);
    r.shipDates.sort();
    r.koliNos.sort(compareNoKoli);
    r.status = rowStatus(r, b);
  }

  return Array.from(rows.values()).sort(
    (a, b) =>
      b.mrpId.localeCompare(a.mrpId, undefined, { numeric: true }) ||
      a.vendorProduksi.localeCompare(b.vendorProduksi) ||
      a.warna.localeCompare(b.warna) ||
      a.lengan.localeCompare(b.lengan) ||
      a.kode.localeCompare(b.kode) ||
      a.codeRoll.localeCompare(b.codeRoll) ||
      sizeRank(a.size) - sizeRank(b.size)
  );
}

/** Status satu baris. Baris roll mengikuti status roll: belum dicutting -> Resting; dicutting dan belum ditutup -> Cutting
 *  (atau Finish Good kalau FG-nya sudah mulai diisi); sesudah roll ditutup, tahap paling awal yang masih memegang barang. */
function rowStatus(r: AduanTrackRow, b?: ProductionBatch): AduanStage {
  if (r.jenis === "belum") return "Belum dialokasikan";
  if (r.jenis === "rencana") return "Belum resting";
  if (b) {
    if (!b.cuttingAt) return "Resting";
    if (!b.closedAt) return r.fg > 0 ? "Finish Good" : "Cutting";
  }
  if (r.cuttingWip > 0) return "Cutting";
  if (r.fgWip > 0) return b ? "Done FG" : "Finish Good";
  if (r.diKoli > 0) return "Packing";
  // Tiba DC (WOS, belum divalidasi) masih Delivery; GR DC = sudah dibongkar / diterima gudang.
  if (r.perjalanan > 0 || r.tibaDc > 0) return "Delivery FG";
  return "GR DC";
}

/* ------------------------------------------------------------------------------------------------------------------------------
 * Tracking per ROLL x SIZE x STATUS (owner 2026-11-19: "status mencerminkan posisi; filter status hanya menampilkan qty yang masih
 * berada di status itu"; tahap sama dengan matriks 11 gate dashboard, ditambah Wait PV). Satu baris roll x size di atas dipecah
 * menjadi satu baris per status yang MASIH memegang qty (qty 0 tidak ditampilkan). Jumlah semua baris satu roll x size = posisi barang
 * roll itu; tidak ada qty yang terhitung dua kali.
 *   Wait PV .. GR Mat : roll yang belum di-resting, per tahap material (invoice bahan roll itu). Roll aduan yang belum ada di invoice
 *                          mana pun = Wait PV. Qty = target aduan diprorata jumlah roll.
 *   Resting              : roll sudah di-resting, belum dicutting (qty = target roll).
 *   Cutting              : hasil cutting yang belum jadi FG (roll terbuka).
 *   FG / Done FG         : FG belum masuk koli (roll terbuka / sudah ditutup).
 *   Packing, Delivery    : di koli belum dikirim; sudah dikirim belum diterima DC.
 *   GR DC                : diterima DC.
 *   Reject               : roll ditutup, hasil cutting yang tidak jadi FG (selisih selesai, bukan outstanding).
 * Target hanya diisi di baris PERTAMA roll x size (baris rencana: bagian target roll di status itu), supaya jumlahnya tidak ganda.
 * ------------------------------------------------------------------------------------------------------------------------------ */

export const TRACK_STAGES = ["Wait PV", "PV", "Paid", "Del Mat", "GR Mat", "Resting", "Cutting", "FG", "Done FG", "Packing", "Delivery FG", "GR DC"] as const;
export type TrackStage = (typeof TRACK_STAGES)[number] | "Reject";
export const TRACK_STATUSES: readonly TrackStage[] = [...TRACK_STAGES, "Reject"];
/** Koli dan resi yang memuat qty sebuah baris status: Packing = koli belum dikirim, Delivery FG = sudah dikirim belum diterima DC, GR DC = sudah diterima. */
function koliFor(r: AduanTrackRow, stage: TrackStage): { noKoli: string; noResi: string } {
  const want = stage === "Packing" ? "packing" : stage === "Delivery FG" ? "kirim" : stage === "GR DC" ? "terima" : null;
  if (!want) return { noKoli: "", noResi: "" };
  // Baris tanpa penelusuran per koli (sisa / rework): tampilkan semua koli sel itu tanpa resi.
  if (r.koliRefs.length === 0) return { noKoli: r.koliNos.join(", "), noResi: "" };
  const refs = r.koliRefs.filter((x) => x.state === want);
  const nos = [...new Set(refs.map((x) => x.no))].sort(compareNoKoli);
  const resis = [...new Set(refs.map((x) => x.resi).filter(Boolean))].sort();
  return { noKoli: nos.join(", "), noResi: resis.join(", ") };
}

/** Untuk export Excel (owner 2026-11-20): baris status Packing / Delivery FG / GR DC dipecah SATU BARIS PER KOLI (qty = FG di koli itu, nomor koli dan resi
 *  per baris; ETD / ETA baris Delivery FG memakai tanggal kirim koli itu). Baris status lain dan baris tanpa penelusuran per koli tidak dipecah. Kalau jumlah
 *  qty koli tidak sama dengan qty baris, baris tidak dipecah supaya total tetap benar. Target hanya di baris pertama. */
export function expandLinesByKoli(lines: TrackLine[]): TrackLine[] {
  const out: TrackLine[] = [];
  for (const l of lines) {
    const want = l.stage === "Packing" ? "packing" : l.stage === "Delivery FG" ? "kirim" : l.stage === "GR DC" ? "terima" : null;
    const refs = want ? l.koliRefs.filter((x) => x.state === want) : [];
    if (refs.length === 0 || refs.reduce((s, x) => s + x.qty, 0) !== l.qty) {
      out.push(l);
      continue;
    }
    [...refs]
      .sort((a, b) => compareNoKoli(a.no, b.no) || a.resi.localeCompare(b.resi) || a.id.localeCompare(b.id))
      .forEach((x, i) => {
        out.push({
          ...l,
          key: `${l.key}|${x.id}`,
          qty: x.qty,
          qtyKoli: x.qty,
          target: i === 0 ? l.target : 0,
          noKoli: x.no,
          noResi: x.resi,
          ...(want === "kirim" && x.sentAt ? { estKirim: x.sentAt, estTibaDc: plusDays(x.sentAt, ltTiba(l.vendorProduksi)) } : {}),
        });
      });
  }
  return out;
}

const MAT_STAGES: TrackStage[] = ["Wait PV", "PV", "Paid", "Del Mat", "GR Mat"];

export type TrackLine = AduanTrackRow & {
  /** Kunci baris roll x size asal. */
  rsKey: string;
  stage: TrackStage;
  qty: number;
  /** Nomor koli dan nomor resi untuk qty baris ini (hanya status Packing, Delivery FG, dan GR DC; selain itu kosong). Lebih dari satu dipisah koma. */
  noKoli: string;
  noResi: string;
  /** Hanya pada hasil `expandLinesByKoli`: qty (FG) di koli pada baris itu. */
  qtyKoli?: number;
  /** Estimasi qty baris ini dikirim vendor (status Delivery FG: tanggal kirim aktual) dan estimasi tiba di DC. Kosong untuk GR DC dan Reject. */
  estKirim?: string;
  estTibaDc?: string;
};

/** Lead time (hari) dari masuk satu status sampai pindah ke status berikutnya, dipakai estimasi kirim. Angka material dari SLA
 *  (lib/mrp/opsMonitor.ts SLA_DEFAULTS); Paid -> Del Mat 1 hari = usulan (belum ditetapkan owner). FG, Done FG, dan Packing
 *  bersama-sama = LT_FG_KE_KIRIM. */
const LT_STEP: [TrackStage, number][] = [
  ["Wait PV", 2],
  ["PV", 2],
  ["Paid", 1],
  ["Del Mat", LT_DEL_MAT_DEFAULT],
  ["GR Mat", 3],
  ["Resting", 2],
  ["Cutting", LT_CUTTING_KE_FG],
];
const DAYS_TO_KIRIM: Partial<Record<TrackStage, number>> = { FG: LT_FG_KE_KIRIM, "Done FG": LT_FG_KE_KIRIM, Packing: LT_FG_KE_KIRIM };
for (let i = LT_STEP.length - 1, acc = LT_FG_KE_KIRIM; i >= 0; i--) {
  acc += LT_STEP[i][1];
  DAYS_TO_KIRIM[LT_STEP[i][0]] = acc;
}

/** Tanggal baris masuk statusnya sekarang (dasar estimasi). Wait PV, PV, Paid belum punya tanggal per roll: dihitung dari hari ini. */
function stageSince(r: TrackLine): string | undefined {
  switch (r.stage) {
    case "Del Mat":
      return r.deliveryAt;
    case "GR Mat":
      return r.grAt;
    case "Resting":
      return r.restingAt;
    case "Cutting":
      return r.cuttingAt;
    case "FG":
    case "Done FG":
      return r.fgFirstAt ?? plusDays(r.cuttingAt, LT_CUTTING_KE_FG);
    case "Packing":
      return r.koliFirstAt;
    default:
      return undefined;
  }
}

/** Estimasi kirim dan tiba DC satu baris: tanggal masuk status + lead time sisa tahap; yang sudah lewat hari ini dianggap hari ini
 *  (terlambat). Status Delivery memakai tanggal kirim aktual dan estimasi tiba koli. */
function lineEstimates(r: TrackLine, today: string): Pick<TrackLine, "estKirim" | "estTibaDc"> {
  if (r.stage === "GR DC" || r.stage === "Reject") return {};
  if (r.stage === "Delivery FG") return { estKirim: r.shipLastAt, estTibaDc: r.estTiba ?? plusDays(r.shipLastAt, ltTiba(r.vendorProduksi)) };
  const base = DAYS_TO_KIRIM[r.stage];
  if (base == null) return {};
  // Delivery Material -> GR Material per vendor (Konveksi Makassar 5 hari): berlaku untuk baris yang belum melewati GR Mat.
  const beforeGr = (TRACK_STAGES as readonly string[]).indexOf(r.stage) <= TRACK_STAGES.indexOf("Del Mat");
  const days = base + (beforeGr ? ltDelMat(r.vendorProduksi) - LT_DEL_MAT_DEFAULT : 0);
  const est = maxDay(plusDays(stageSince(r) ?? today, days), today);
  return { estKirim: est, estTibaDc: plusDays(est, ltTiba(r.vendorProduksi)) };
}

/** Tahap dashboard yang BELUM dilewati: klik sel gate di matriks dashboard = status-status sebelum gate itu. */
export function stagesBefore(gate: TrackStage): TrackStage[] {
  const i = (TRACK_STAGES as readonly string[]).indexOf(gate);
  return i <= 0 ? [] : (TRACK_STAGES.slice(0, i) as TrackStage[]);
}

export function buildTrackLines(
  rows: AduanTrackRow[],
  ctx: { batches: ProductionBatch[]; invoices: RawMaterialInvoice[]; returned?: Set<string>; today: string }
): TrackLine[] {
  const batchById = new Map(ctx.batches.map((b) => [b.id, b]));
  const batchCodes = new Set(ctx.batches.map((b) => b.codeRoll).filter(Boolean) as string[]);

  // Roll invoice bahan yang belum menjadi roll produksi, per MRP x vendor tujuan x warna x lengan, per tahap material (indeks MAT_STAGES).
  const matByGroup = new Map<string, number[]>();
  for (const inv of ctx.invoices) {
    if (inv.status === "WAITING_INVOICE") continue;
    const awaiting = invoiceAwaitingPayment(inv);
    for (const c of inv.colorEntries) {
      const key = `${c.warna}|${c.lengan}`;
      const arrivals = inv.rollArrivals[key] ?? [];
      const receipts = inv.rollReceipts[key] ?? [];
      const gk = `${inv.mrpId}|${inv.destinationVendor}|${c.warna}|${c.lengan}`;
      c.rolls.forEach((_, idx) => {
        if (ctx.returned?.has(`${inv.id}|${c.warna}|${c.lengan}|${idx}`)) return;
        const code = arrivals[idx]?.codeRoll || receipts[idx]?.codeRoll || c.codeRolls?.[idx] || "";
        if (code && batchCodes.has(code)) return;
        const st = awaiting ? 1 : arrivals[idx] ? 4 : inv.deliveredAt ? 3 : 2;
        const arr = matByGroup.get(gk) ?? [0, 0, 0, 0, 0];
        arr[st]++;
        matByGroup.set(gk, arr);
      });
    }
  }

  // Roll rencana (aduan yang belum di-resting) dibagi ke tahap material: roll paling maju lebih dulu, sisanya Wait PV.
  const aduanByGroup = new Map<string, Map<string, { kode: string; rolls: number }>>();
  for (const r of rows) {
    if (r.jenis !== "rencana") continue;
    const gk = `${r.mrpId}|${r.vendorProduksi}|${r.warna}|${r.lengan}`;
    const m = aduanByGroup.get(gk) ?? new Map();
    m.set(r.rollKey, { kode: r.kode, rolls: r.qtyRoll });
    aduanByGroup.set(gk, m);
  }
  const alloc = new Map<string, number[]>();
  for (const [gk, aduans] of aduanByGroup) {
    const pool = [...(matByGroup.get(gk) ?? [0, 0, 0, 0, 0])];
    const list = [...aduans.entries()].sort((a, b) => a[1].kode.localeCompare(b[1].kode, undefined, { numeric: true }));
    for (const [rk, a] of list) {
      const counts = [0, 0, 0, 0, 0];
      let need = a.rolls;
      for (const st of [4, 3, 2, 1]) {
        const take = Math.min(need, pool[st]);
        counts[st] += take;
        pool[st] -= take;
        need -= take;
      }
      counts[0] = need;
      alloc.set(rk, counts);
    }
  }

  const statusToStage: Record<AduanStage, TrackStage> = {
    "Belum dialokasikan": "Wait PV", "Belum resting": "Wait PV", Resting: "Resting", Cutting: "Cutting",
    "Finish Good": "FG", "Done FG": "Done FG", Packing: "Packing", "Delivery FG": "Delivery FG", "GR DC": "GR DC",
  };
  const out: TrackLine[] = [];
  const line = (r: AduanTrackRow, stage: TrackStage, qty: number, target: number, extra: Partial<AduanTrackRow> = {}): TrackLine => ({
    ...r, ...koliFor(r, stage), ...extra, key: `${r.key}|${stage}`, rsKey: r.key, stage, qty, target,
  });

  for (const r of rows) {
    if (r.jenis === "rencana") {
      const counts = alloc.get(r.rollKey) ?? [r.qtyRoll, 0, 0, 0, 0];
      const total = counts.reduce((s, n) => s + n, 0) || 1;
      const used = counts.map((n, i) => [n, i] as const).filter(([n]) => n > 0);
      let left = r.target;
      used.forEach(([n, i], j) => {
        const q = j === used.length - 1 ? left : Math.round((r.target * n) / total);
        left -= q;
        const st = MAT_STAGES[i];
        out.push(line(r, st, q, q, { qtyRoll: n, rollKey: `${r.rollKey}|${st}` }));
      });
      continue;
    }
    if (r.jenis === "belum") {
      out.push(line(r, "Wait PV", r.target, r.target));
      continue;
    }
    const parts: [TrackStage, number][] = [];
    const b = r.jenis === "roll" ? batchById.get(r.rollKey) : undefined;
    if (r.jenis === "roll" && !b?.cuttingAt) parts.push(["Resting", r.target]);
    else {
      // cuttingWip = cutting - FG - reject; roll ditutup: 0 (sisanya reject).
      parts.push(["Cutting", r.cuttingWip]);
      parts.push([b?.closedAt ? "Done FG" : "FG", r.fgWip]);
      parts.push(["Packing", r.diKoli], ["Delivery FG", r.perjalanan + r.tibaDc], ["GR DC", r.diterima], ["Reject", r.reject]);
      if (r.jenis === "sisa" && r.cutting === 0 && r.fg === 0 && r.target > 0 && parts.every(([, q]) => q <= 0)) parts.push(["Wait PV", r.target]);
    }
    const live = parts.filter(([, q]) => q > 0);
    if (live.length === 0) {
      out.push(line(r, statusToStage[r.status], 0, r.target));
      continue;
    }
    live.forEach(([st, q], i) => out.push(line(r, st, q, i === 0 ? r.target : 0)));
  }
  for (const l of out) Object.assign(l, lineEstimates(l, ctx.today));
  return out;
}
