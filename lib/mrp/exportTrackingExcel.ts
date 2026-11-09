import type { Workbook } from "exceljs";
import { SIZE_ORDER, targetSizesForBatch } from "./derive";
import { LT_CUTTING_KE_FG, LT_FG_KE_KIRIM, dayKey, maxDay, minDay, plusDays } from "./itemEstimates";
import { itemNameOf, lenganShort, type ItemMrpVendorRow, type ItemTrackRow } from "./itemTracking";
import { VENDOR_PRODUKSI } from "./seed";
import type { AduanPolaRow, DeliveryKoli, Lengan, ProductionBatch, ProductionResult, RawMaterialInvoice } from "./types";

// Export Excel Tracking Item (PPIC/SCM): SATU sheet "WIP" mengikuti template "WIP Download" owner (2026-11-09), satu baris per ROLL x SIZE:
// Item, No. MRP, Vendor, Kategory, Warna, Size, Code Roll, Target Qty, Tgl good Receiving, Tgl Cutting, Tgl Awal FG, Qty FG, Qty WIP, Status Roll, Estimasi, Status.
// Item rework (FG hasil rework reject, tanpa roll dan tanpa target) ikut sebagai baris "(rework)" dengan Target Qty 0. Mengikuti filter layar (MRP, vendor, kategori, warna, lengan, size).
//  - Target Qty  : target roll itu per size = target aduan diprorata menurut jumlah roll (`targetSizesForBatch`, sama dengan form Cutting vendor), sudah ada sebelum roll dicutting; rework = 0.
//  - Qty FG      : hasil Finish Good roll itu (`fgSizeQty`); rework = FG hasil rework.
//  - Qty WIP     : yang belum dikirim = target (roll belum dicutting) + (hasil cutting - FG, selama roll belum ditutup) + (FG belum masuk koli) + (sudah di koli belum dikirim). Roll ditutup:
//                  selisih cutting - FG dianggap reject/kurang, bukan WIP. Reject tidak tercatat per roll, jadi roll yang belum ditutup masih menghitung reject sebagai WIP sampai ditutup.
//  - Estimasi    : estimasi tanggal kirim barang yang masih WIP (cutting + LT Cutting->FG + LT FG->kirim; FG terakhir + LT FG->kirim), sama dengan Est. Kirim di Tracking Item.
//  - Status      : posisi barang yang masih WIP, atau SUDAH DIKIRIM kalau tidak ada sisa.

const FONT = "Calibri";
const INK = "FF1A1A1F";
const HEAD_BG = "FFE5E7EB";
const LINE = "FFD3D8DF";
const thin = { style: "thin" as const, color: { argb: LINE } };
const BORDER = { top: thin, left: thin, bottom: thin, right: thin };
const FMT_DATE = "dd/mm/yyyy";
const FMT_INT = "#,##0";

const vendorName = (id: string) => VENDOR_PRODUKSI[id]?.name ?? id;
const dateOf = (iso?: string): Date | null => {
  if (!iso) return null;
  const [y, m, d] = iso.split("-").map(Number);
  return y && m && d ? new Date(Date.UTC(y, m - 1, d)) : null;
};
const sizeRank = (size: string) => {
  const i = SIZE_ORDER.indexOf(size.trim().toUpperCase());
  return i < 0 ? SIZE_ORDER.length : i;
};

export type TrackingExportInput = {
  rows: ItemTrackRow[];
  filterLabel?: string;
  /** Sumber baris per roll: roll produksi, hasil FG/rework, koli (qty sudah dikirim / di koli), dan invoice bahan (tanggal good receiving roll). */
  batches?: ProductionBatch[];
  results?: ProductionResult[];
  kolis?: DeliveryKoli[];
  invoices?: RawMaterialInvoice[];
  /** Aduan pola semua MRP: target per size per roll = target aduan dibagi menurut jumlah roll (sama seperti form Cutting vendor). */
  aduans?: AduanPolaRow[];
};

export type WipRow = {
  item: string;
  mrp: string;
  vendor: string;
  kategori: string;
  warna: string;
  size: string;
  roll: string;
  target: number | null;
  grAt?: string;
  cuttingAt?: string;
  fgFirstAt?: string;
  fg: number;
  wip: number | null;
  statusRoll: string;
  estimasi?: string;
  status: string;
  /** Hanya untuk urutan. */
  lengan: Lengan;
};

type Moved = { delivered: number; inKoli: number };

/** Posisi barang yang masih WIP dan label statusnya; dipakai baris roll dan baris rework. `cut` = hasil cutting size itu (0 kalau roll belum dicutting). */
function wipParts(target: number, hasCut: boolean, cut: number, fg: number, closed: boolean, moved: Moved) {
  const belumCutting = hasCut ? 0 : target;
  const cutting = !hasCut || closed ? 0 : Math.max(0, cut - fg);
  const fgPart = Math.max(0, fg - moved.inKoli - moved.delivered);
  const koli = moved.inKoli;
  const labels = [
    belumCutting > 0 ? "BELUM CUTTING" : "",
    cutting > 0 ? "CUTTING, BELUM FG" : "",
    fgPart > 0 ? "FG, BELUM MASUK KOLI" : "",
    koli > 0 ? "DI KOLI, BELUM DIKIRIM" : "",
  ].filter(Boolean);
  return { belumCutting, cutting, fgPart, koli, wip: belumCutting + cutting + fgPart + koli, status: labels.length > 0 ? labels.join(" + ") : moved.delivered > 0 ? "SUDAH DIKIRIM" : "TIDAK ADA HASIL CUTTING" };
}

/** Baris sheet WIP: per roll x size, lalu rework per item. */
export function wipRows(input: TrackingExportInput): WipRow[] {
  const { rows, kolis = [], batches = [], results = [], invoices = [], aduans = [] } = input;
  const cellByKey = new Map<string, ItemMrpVendorRow>(); // mrp|vendor|warna|lengan|size
  const lineScope = new Set<string>(); // mrp|vendor|warna|lengan
  for (const r of rows) {
    for (const b of r.breakdown) {
      if (!b.vendorProduksi) continue;
      cellByKey.set(`${b.mrpId}|${b.vendorProduksi}|${r.warna}|${r.lengan}|${r.size}`, b);
      lineScope.add(`${b.mrpId}|${b.vendorProduksi}|${r.warna}|${r.lengan}`);
    }
  }
  const kategoriOf = (mrp: string, vendor: string, warna: string, lengan: string) => {
    for (const [k, c] of cellByKey) if (k.startsWith(`${mrp}|${vendor}|${warna}|${lengan}|`)) return c.kategori;
    return "";
  };

  // Tanggal good receiving per roll: roll datang di invoice bahan, dicocokkan lewat code roll.
  const grByRoll = new Map<string, string>();
  for (const inv of invoices) {
    for (const arrivals of Object.values(inv.rollArrivals)) {
      for (const a of arrivals) {
        if (!a?.codeRoll) continue;
        const key = `${inv.mrpId}|${inv.destinationVendor}|${a.codeRoll}`;
        const day = minDay(grByRoll.get(key), dayKey(a.arrivedAt));
        if (day) grByRoll.set(key, day);
      }
    }
  }
  // Tanggal FG per roll x size (catatan "Roll {code}") dan FG hasil rework per item.
  const fgDates = new Map<string, { first?: string; last?: string }>();
  const reworkFg = new Map<string, { qty: number; first?: string; last?: string }>();
  for (const r of results) {
    if (r.kind !== "FG") continue;
    const day = dayKey(r.recordedAt);
    for (const [size, qty] of Object.entries(r.sizeQty)) {
      if (!(qty > 0)) continue;
      if (r.note?.startsWith("Roll ")) {
        const key = `${r.mrpId}|${r.vendorProduksi}|${r.note.slice(5).trim()}|${size}`;
        const cur = fgDates.get(key) ?? {};
        fgDates.set(key, { first: minDay(cur.first, day), last: maxDay(cur.last, day) });
      } else if (r.note?.startsWith("Rework dari")) {
        const key = `${r.mrpId}|${r.vendorProduksi}|${r.warna}|${r.lengan}|${size}`;
        const cur = reworkFg.get(key) ?? { qty: 0 };
        reworkFg.set(key, { qty: cur.qty + qty, first: minDay(cur.first, day), last: maxDay(cur.last, day) });
      }
    }
  }
  // Koli: qty yang sudah dikirim / sudah di koli belum dikirim, per roll x size (FG) dan per item (rework). Reject tidak dihitung.
  const rollMoved = new Map<string, Moved>(); // batchId|size
  const reworkMoved = new Map<string, Moved>(); // mrp|vendor|warna|lengan|size
  const bump = (map: Map<string, Moved>, key: string, qty: number, delivered: boolean) => {
    const m = map.get(key) ?? { delivered: 0, inKoli: 0 };
    if (delivered) m.delivered += qty;
    else m.inKoli += qty;
    map.set(key, m);
  };
  for (const k of kolis) {
    for (const it of k.items) {
      if (it.kind === "REJECT" || it.qty <= 0) continue;
      if (it.kind === "REWORK") bump(reworkMoved, `${k.mrpId}|${k.vendorProduksi}|${it.warna}|${it.lengan}|${it.size}`, it.qty, !!k.deliveredAt);
      else if (it.sourceBatchId) bump(rollMoved, `${it.sourceBatchId}|${it.size}`, it.qty, !!k.deliveredAt);
    }
  }

  const out: WipRow[] = [];
  for (const b of batches) {
    if (!lineScope.has(`${b.mrpId}|${b.vendorProduksi}|${b.warna}|${b.lengan}`)) continue;
    const kategori = kategoriOf(b.mrpId, b.vendorProduksi, b.warna, b.lengan);
    const roll = b.codeRoll ?? "";
    const cuttingAt = dayKey(b.cuttingAt);
    const closed = !!b.closedAt;
    const plan = targetSizesForBatch(b, aduans);
    const hasCut = Object.keys(b.sizeQty ?? {}).length > 0 || !!b.cuttingAt;
    const allSizes = Array.from(new Set([...Object.keys(plan), ...Object.keys(b.sizeQty ?? {}), ...Object.keys(b.fgSizeQty ?? {})]));
    const sizes = allSizes.filter((sz) => cellByKey.has(`${b.mrpId}|${b.vendorProduksi}|${b.warna}|${b.lengan}|${sz}`));
    const grOf = (size: string) => grByRoll.get(`${b.mrpId}|${b.vendorProduksi}|${roll}`) ?? cellByKey.get(`${b.mrpId}|${b.vendorProduksi}|${b.warna}|${b.lengan}|${size}`)?.grAt;
    if (allSizes.length === 0) {
      // Roll tanpa aduan yang bisa dibaca dan belum ada hasil per size: satu baris tanpa size supaya roll tetap terlihat.
      out.push({
        item: `${b.warna} ${lenganShort(b.lengan)}`, mrp: b.mrpId, vendor: vendorName(b.vendorProduksi), kategori, warna: b.warna, size: "", roll, target: null, grAt: grByRoll.get(`${b.mrpId}|${b.vendorProduksi}|${roll}`),
        cuttingAt, fgFirstAt: undefined, fg: 0, wip: null, statusRoll: hasCut ? "Sudah cutting" : "Resting", estimasi: undefined, status: hasCut ? "TIDAK ADA HASIL CUTTING" : "BELUM CUTTING", lengan: b.lengan,
      });
      continue;
    }
    for (const size of sizes) {
      const target = plan[size] ?? b.sizeQty?.[size] ?? 0;
      const cut = b.sizeQty?.[size] ?? 0;
      const fg = b.fgSizeQty?.[size] ?? 0;
      if (target === 0 && cut === 0 && fg === 0) continue;
      const p = wipParts(target, hasCut, cut, fg, closed, rollMoved.get(`${b.id}|${size}`) ?? { delivered: 0, inKoli: 0 });
      const fd = fgDates.get(`${b.mrpId}|${b.vendorProduksi}|${roll}|${size}`);
      let est: string | undefined;
      if (p.cutting > 0) est = plusDays(plusDays(cuttingAt, LT_CUTTING_KE_FG), LT_FG_KE_KIRIM);
      if (p.fgPart > 0 || p.koli > 0) est = maxDay(est, plusDays(fd?.last ?? plusDays(cuttingAt, LT_CUTTING_KE_FG), LT_FG_KE_KIRIM));
      out.push({
        item: itemNameOf(b.warna, b.lengan, size), mrp: b.mrpId, vendor: vendorName(b.vendorProduksi), kategori, warna: b.warna, size, roll, target, grAt: grOf(size), cuttingAt, fgFirstAt: fd?.first, fg,
        wip: p.wip, statusRoll: closed ? "Roll ditutup" : fg > 0 ? "FG berjalan" : hasCut ? "Sudah cutting" : "Resting", estimasi: p.wip > 0 ? est : undefined, status: p.status, lengan: b.lengan,
      });
    }
  }
  // Item rework: FG hasil rework reject, tanpa roll dan tanpa target (Target Qty 0).
  for (const [key, rw] of reworkFg) {
    const cell = cellByKey.get(key);
    if (!cell) continue;
    const [mrp, vendor, warna, lengan, size] = key.split("|");
    const p = wipParts(0, true, rw.qty, rw.qty, true, reworkMoved.get(key) ?? { delivered: 0, inKoli: 0 });
    out.push({
      item: itemNameOf(warna, lengan as Lengan, size), mrp, vendor: vendorName(vendor), kategori: cell.kategori, warna, size, roll: "(rework)", target: 0, grAt: undefined, cuttingAt: undefined, fgFirstAt: rw.first,
      fg: rw.qty, wip: p.wip, statusRoll: "Rework", estimasi: p.wip > 0 ? plusDays(rw.last, LT_FG_KE_KIRIM) : undefined, status: p.status, lengan: lengan as Lengan,
    });
  }
  return out.sort(
    (a, b) =>
      b.mrp.localeCompare(a.mrp, undefined, { numeric: true }) ||
      a.vendor.localeCompare(b.vendor) ||
      a.warna.localeCompare(b.warna) ||
      (a.lengan === b.lengan ? 0 : a.lengan === "PENDEK" ? -1 : 1) ||
      (a.roll === "(rework)" ? 1 : 0) - (b.roll === "(rework)" ? 1 : 0) ||
      a.roll.localeCompare(b.roll, undefined, { numeric: true }) ||
      sizeRank(a.size) - sizeRank(b.size)
  );
}

export async function buildTrackingWorkbook(input: TrackingExportInput): Promise<Workbook> {
  const ExcelJS = (await import("exceljs")).default;
  const wb: Workbook = new ExcelJS.Workbook();
  wb.creator = "Mini ERP Tigalapan";
  wb.created = new Date();
  const rows = wipRows(input);
  const ws = wb.addWorksheet("WIP", { views: [{ state: "frozen", ySplit: 1 }] });
  const cols: { head: string; width: number; kind: "text" | "int" | "date"; value: (r: WipRow) => string | number | Date | null; note?: string }[] = [
    { head: "Item", width: 26, kind: "text", value: (r) => r.item },
    { head: "No. MRP", width: 9, kind: "text", value: (r) => r.mrp },
    { head: "Vendor", width: 20, kind: "text", value: (r) => r.vendor },
    { head: "Kategory", width: 14, kind: "text", value: (r) => r.kategori },
    { head: "Warna", width: 24, kind: "text", value: (r) => r.warna },
    { head: "Size", width: 7, kind: "text", value: (r) => r.size },
    { head: "Code Roll", width: 16, kind: "text", value: (r) => r.roll },
    { head: "Target Qty", width: 11, kind: "int", value: (r) => r.target, note: "Target roll ini per size: target aduan dibagi menurut jumlah roll (sama seperti form Cutting vendor), sudah ada sebelum roll dicutting. Item rework tidak punya target (0)." },
    { head: "Tgl good Receiving", width: 16, kind: "date", value: (r) => dateOf(r.grAt) },
    { head: "Tgl Cutting", width: 12, kind: "date", value: (r) => dateOf(r.cuttingAt) },
    { head: "Tgl Awal FG", width: 12, kind: "date", value: (r) => dateOf(r.fgFirstAt) },
    { head: "Qty FG", width: 9, kind: "int", value: (r) => r.fg },
    {
      head: "Qty WIP",
      width: 10,
      kind: "int",
      value: (r) => r.wip,
      note: "Barang yang belum dikirim: target (roll belum dicutting) + (hasil cutting - FG, selama roll belum ditutup) + FG belum masuk koli + sudah di koli belum dikirim. Reject tidak tercatat per roll, jadi roll yang belum ditutup masih menghitung reject sebagai WIP.",
    },
    { head: "Status Roll", width: 16, kind: "text", value: (r) => r.statusRoll },
    {
      head: "Estimasi",
      width: 12,
      kind: "date",
      value: (r) => dateOf(r.estimasi),
      note: `Estimasi tanggal kirim barang yang masih WIP: tanggal cutting + ${LT_CUTTING_KE_FG} hari (FG) + ${LT_FG_KE_KIRIM} hari (kirim); untuk FG: tanggal FG terakhir + ${LT_FG_KE_KIRIM} hari.`,
    },
    { head: "Status", width: 34, kind: "text", value: (r) => r.status },
  ];
  ws.columns = cols.map((c) => ({ width: c.width }));
  cols.forEach((c, i) => {
    const cell = ws.getCell(1, i + 1);
    cell.value = c.head;
    cell.font = { name: FONT, size: 10, bold: true, color: { argb: INK } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEAD_BG } };
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    cell.border = BORDER;
    if (c.note) cell.note = c.note;
  });
  if (input.filterLabel) ws.getCell(1, 1).note = `Diunduh ${new Date().toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" })} · ${input.filterLabel}`;
  ws.getRow(1).height = 28;
  rows.forEach((r, ri) => {
    cols.forEach((c, ci) => {
      const cell = ws.getCell(2 + ri, ci + 1);
      const v = c.value(r);
      cell.value = v === "" ? null : v;
      cell.font = { name: FONT, size: 10, color: { argb: INK } };
      cell.border = BORDER;
      if (c.kind === "int") {
        cell.numFmt = FMT_INT;
        cell.alignment = { horizontal: "right" };
      }
      if (c.kind === "date") {
        cell.numFmt = FMT_DATE;
        cell.alignment = { horizontal: "center" };
      }
    });
  });
  if (rows.length > 0) ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1 + rows.length, column: cols.length } };
  ws.pageSetup = { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
  return wb;
}

export async function exportTrackingExcel(input: TrackingExportInput, fileName: string): Promise<void> {
  const wb = await buildTrackingWorkbook(input);
  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
