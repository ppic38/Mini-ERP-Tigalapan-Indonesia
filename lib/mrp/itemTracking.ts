import type { MrpDetail } from "./store";
import { SIZE_ORDER, compareNoKoli } from "./derive";
import { LT_CUTTING_KE_FG, LT_FG_KE_KIRIM, dayKey, ltTiba, maxDay, minDay, parseLooseDay, plusDays } from "./itemEstimates";
import type { WosKoliStatus } from "./wosStatusMap";
import type { DeliveryKoli, Lengan, ProductionBatch, ProductionResult, RawMaterialInvoice, WarehouseReceipt } from "./types";

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
