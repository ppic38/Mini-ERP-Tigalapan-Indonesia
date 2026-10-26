import type { MrpDetail } from "./store";
import { SIZE_ORDER } from "./derive";
import type { DeliveryKoli, Lengan, ProductionBatch, ProductionResult, WarehouseReceipt } from "./types";

/** Tracking Item (PPIC dan SCM, owner 2026-10-26): memantau SATU ITEM (warna + lengan + size, mis. "HITAM 24S PDK L"), bukan satu warna, dari rencana
 *  MRP sampai diterima gudang. Semua angka turunan dari data yang sudah ada:
 *   - Target MRP    : qty size itu di grup warna·lengan semua MRP (MRP berstatus ditolak tidak dihitung).
 *   - Alokasi vendor: qty size itu di Aduan Pola per vendor (sisa target yang belum punya vendor ditampilkan sebagai "Belum dialokasikan").
 *   - Cutting       : hasil cutting aktual roll yang sudah dicutting (`production_batches.sizeQty`).
 *   - Finish Good   : akumulasi hasil FG per size (sudah termasuk koreksi dan hasil rework); Reject: akumulasi reject.
 *   - Di koli       : sudah masuk koli tetapi belum dikirim; Dikirim: koli yang sudah punya resi/terkirim (reject tidak dihitung).
 *   - Diterima gudang: item di penerimaan Warehouse (reject tidak dihitung). */

export type ItemStage = {
  alokasi: number;
  cutting: number;
  fg: number;
  reject: number;
  diKoli: number;
  dikirim: number;
  diterima: number;
};

export type ItemMrpVendorRow = ItemStage & {
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
};

const empty = (): ItemStage => ({ alokasi: 0, cutting: 0, fg: 0, reject: 0, diKoli: 0, dikirim: 0, diterima: 0 });
const STAGE_KEYS: (keyof ItemStage)[] = ["alokasi", "cutting", "fg", "reject", "diKoli", "dikirim", "diterima"];

export const lenganShort = (l: Lengan) => (l === "PENDEK" ? "PDK" : "PJG");
export const itemNameOf = (warna: string, lengan: Lengan, size: string) => `${warna} ${lenganShort(lengan)} ${size}`;

function sizeRank(size: string): number {
  const i = SIZE_ORDER.indexOf(size.trim().toUpperCase());
  return i < 0 ? SIZE_ORDER.length : i;
}

/** Hitung ulang satu item dari sebagian rinciannya (dipakai saat filter No. MRP, vendor, atau kategori aktif). */
export function itemWithBreakdown(it: ItemTrackRow, breakdown: ItemMrpVendorRow[]): ItemTrackRow {
  const out: ItemTrackRow = { ...it, ...empty(), breakdown, kategori: [], mrpIds: [] };
  for (const b of breakdown) {
    for (const key of STAGE_KEYS) out[key] += b[key];
    if (b.kategori && !out.kategori.includes(b.kategori)) out.kategori.push(b.kategori);
    if (!out.mrpIds.includes(b.mrpId)) out.mrpIds.push(b.mrpId);
  }
  out.kategori.sort();
  out.target = out.alokasi;
  out.sisaProduksi = Math.max(0, out.target - out.fg);
  return out;
}

export function buildItemTracking(
  mrpDetails: MrpDetail[],
  batches: ProductionBatch[],
  results: ProductionResult[],
  kolis: DeliveryKoli[],
  receipts: WarehouseReceipt[]
): ItemTrackRow[] {
  const active = mrpDetails.filter((d) => d.ppicApproval !== "REJECTED");
  const activeIds = new Set(active.map((d) => d.mrp.id));

  const targetByMrpItem = new Map<string, number>(); // mrp|warna|lengan|size
  const allocatedByMrpItem = new Map<string, number>();
  const kategoriOfGroup = new Map<string, string>(); // mrp|warna|lengan
  const cells = new Map<string, ItemMrpVendorRow & { warna: string; lengan: Lengan; size: string }>();

  const cell = (mrpId: string, vendor: string, warna: string, lengan: Lengan, size: string) => {
    const key = `${mrpId}|${vendor}|${warna}|${lengan}|${size}`;
    let c = cells.get(key);
    if (!c) {
      c = { key, mrpId, vendorProduksi: vendor, kategori: kategoriOfGroup.get(`${mrpId}|${warna}|${lengan}`) ?? "", warna, lengan, size, ...empty() };
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
    for (const [size, qty] of Object.entries(b.sizeQty)) cell(b.mrpId, b.vendorProduksi, b.warna, b.lengan, size).cutting += qty;
  }
  for (const r of results) {
    if (!activeIds.has(r.mrpId) || (r.kind !== "FG" && r.kind !== "REJECT")) continue;
    for (const [size, qty] of Object.entries(r.sizeQty)) {
      const c = cell(r.mrpId, r.vendorProduksi, r.warna, r.lengan, size);
      if (r.kind === "FG") c.fg += qty;
      else c.reject += qty;
    }
  }
  for (const k of kolis) {
    if (!activeIds.has(k.mrpId)) continue;
    for (const it of k.items) {
      if (it.kind === "REJECT") continue;
      const c = cell(k.mrpId, k.vendorProduksi, it.warna, it.lengan, it.size);
      if (k.deliveredAt) c.dikirim += it.qty;
      else c.diKoli += it.qty;
    }
  }
  for (const rc of receipts) {
    if (!activeIds.has(rc.mrpId)) continue;
    for (const it of rc.items) {
      if (it.kind === "REJECT") continue;
      cell(rc.mrpId, rc.vendorProduksi, it.warna, it.lengan, it.size).diterima += it.qty;
    }
  }

  const items = new Map<string, ItemTrackRow>();
  const itemOf = (warna: string, lengan: Lengan, size: string) => {
    const key = `${warna}|${lengan}|${size}`;
    let it = items.get(key);
    if (!it) {
      it = { key, warna, lengan, size, itemName: itemNameOf(warna, lengan, size), kategori: [], mrpIds: [], target: 0, sisaProduksi: 0, breakdown: [], ...empty() };
      items.set(key, it);
    }
    return it;
  };
  for (const c of cells.values()) {
    const it = itemOf(c.warna, c.lengan, c.size);
    for (const key of STAGE_KEYS) it[key] += c[key];
    it.breakdown.push(c);
    if (c.kategori && !it.kategori.includes(c.kategori)) it.kategori.push(c.kategori);
    if (!it.mrpIds.includes(c.mrpId)) it.mrpIds.push(c.mrpId);
  }

  const out = Array.from(items.values());
  for (const it of out) {
    it.target = it.alokasi;
    it.sisaProduksi = Math.max(0, it.target - it.fg);
    it.kategori.sort();
    it.mrpIds.sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
    it.breakdown.sort((a, b) => b.mrpId.localeCompare(a.mrpId, undefined, { numeric: true }) || a.vendorProduksi.localeCompare(b.vendorProduksi));
  }
  return out.sort((a, b) => a.warna.localeCompare(b.warna) || a.lengan.localeCompare(b.lengan) || sizeRank(a.size) - sizeRank(b.size) || a.size.localeCompare(b.size));
}
