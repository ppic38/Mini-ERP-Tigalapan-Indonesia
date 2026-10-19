import type { Workbook, Worksheet } from "exceljs";

// Export Monitoring Produksi ke Excel (owner 2026-10-19: "download report dalam bentuk excel ... per warna ada tipe lengan ada
// juga sizenya"). Dua sheet dalam 1 file:
//  - "Ringkasan": 1 baris per MRP · vendor · warna · lengan (deadline, status, qty, roll, yield, reject/rework) + kolom FG per size
//    (urutan size mengikuti SIZE_ORDER) supaya satu baris sudah memperlihatkan sebaran size-nya.
//  - "Detail Size": 1 baris per MRP · vendor · warna · lengan · size (target, cutting, FG, reject, rework, selisih, % FG) --
//    bentuk datar, siap difilter / dijadikan pivot.
// Angka sama persis dengan layar (vendorItemSizeProgress dst.); halaman yang menyusun datanya, file ini hanya menata sel.

export type MonitoringExportSize = { size: string; target: number; cutting: number; finishGood: number; reject: number; rework: number };

export type MonitoringExportGroup = {
  mrpId: string;
  vendor: string;
  warna: string;
  lengan: string;
  /** yyyy-mm-dd atau kosong kalau belum ada bahan diterima. */
  deadline: string;
  /** Selisih hari ke deadline (negatif = lewat); null kalau belum ada deadline. */
  daysLeft: number | null;
  status: string;
  rollReceived: number;
  rollTotal: number;
  yieldCuttingPct: number | null;
  /** Catatan alih size sisa kain (kosong kalau tidak ada). */
  shiftNote: string;
  sizes: MonitoringExportSize[];
};

const INK = "FF1A1A1F";
const HEAD_BG = "FF0D9488";
const SOFT = "FFF0F3F6";
const LINE = "FFD3D8DF";
const FONT = "Calibri";

const thin = { style: "thin" as const, color: { argb: LINE } };
const BORDER = { top: thin, left: thin, bottom: thin, right: thin };

const SIZE_ORDER = ["XXS", "XS", "S", "M", "L", "XL", "2XL", "3XL", "4XL", "5XL", "6XL"];
function sizeRank(s: string): number {
  const i = SIZE_ORDER.indexOf(s.toUpperCase());
  return i < 0 ? SIZE_ORDER.length : i;
}
function compareSize(a: string, b: string): number {
  return sizeRank(a) - sizeRank(b) || a.localeCompare(b, "id-ID", { numeric: true });
}

function sum(sizes: MonitoringExportSize[], k: "target" | "cutting" | "finishGood" | "reject" | "rework"): number {
  return sizes.reduce((a, s) => a + s[k], 0);
}

function dateCell(iso: string): Date | string {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  // UTC: ExcelJS menyimpan tanggal sebagai UTC, jadi tengah malam lokal akan bergeser sehari di Excel.
  return new Date(Date.UTC(y, m - 1, d));
}

function styleHeader(ws: Worksheet, row: number, cols: number) {
  const r = ws.getRow(row);
  r.height = 30;
  for (let c = 1; c <= cols; c++) {
    const cell = r.getCell(c);
    cell.font = { name: FONT, size: 10, bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEAD_BG } };
    cell.alignment = { vertical: "middle", horizontal: c <= 4 ? "left" : "center", wrapText: true };
    cell.border = BORDER;
  }
}

function styleBody(ws: Worksheet, firstRow: number, lastRow: number, cols: number, leftCols: number) {
  for (let r = firstRow; r <= lastRow; r++) {
    const row = ws.getRow(r);
    for (let c = 1; c <= cols; c++) {
      const cell = row.getCell(c);
      cell.font = { name: FONT, size: 10, color: { argb: INK } };
      cell.border = BORDER;
      cell.alignment = { vertical: "middle", horizontal: c <= leftCols ? "left" : "right" };
      if ((r - firstRow) % 2 === 1) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: SOFT } };
    }
  }
}

function summarySheet(wb: Workbook, groups: MonitoringExportGroup[], allSizes: string[]) {
  const ws = wb.addWorksheet("Ringkasan", { views: [{ state: "frozen", xSplit: 4, ySplit: 3 }] });
  const fixed = ["No. MRP", "Vendor", "Warna", "Lengan", "Deadline", "Sisa Waktu (hari)", "Status", "Roll Selesai", "Roll Total", "Target (pcs)", "Hasil Cutting", "Yield Cutting", "Finish Good", "Reject", "Rework", "Yield FG", "Alih Size"];
  const head = [...fixed, ...allSizes.map((s) => `FG ${s}`)];
  const cols = head.length;

  ws.mergeCells(1, 1, 1, Math.min(cols, 8));
  const t = ws.getCell(1, 1);
  t.value = "Monitoring Produksi — Ringkasan per Warna · Lengan";
  t.font = { name: FONT, size: 14, bold: true, color: { argb: INK } };
  ws.getCell(2, 1).value = `Diunduh ${new Date().toLocaleString("id-ID")} · FG per size = Finish Good aktual · Yield Cutting = hasil cutting / target · Yield FG = FG / hasil cutting`;
  ws.getCell(2, 1).font = { name: FONT, size: 9, italic: true, color: { argb: "FF828290" } };

  ws.getRow(3).values = head;
  styleHeader(ws, 3, cols);

  groups.forEach((g, i) => {
    const target = sum(g.sizes, "target");
    const cutting = sum(g.sizes, "cutting");
    const fg = sum(g.sizes, "finishGood");
    const bySize = new Map(g.sizes.map((s) => [s.size, s.finishGood]));
    ws.getRow(4 + i).values = [
      g.mrpId,
      g.vendor,
      g.warna,
      g.lengan,
      dateCell(g.deadline),
      g.daysLeft ?? "",
      g.status,
      g.rollReceived,
      g.rollTotal,
      target,
      cutting,
      g.yieldCuttingPct == null ? "" : g.yieldCuttingPct / 100,
      fg,
      sum(g.sizes, "reject"),
      sum(g.sizes, "rework"),
      cutting > 0 ? Math.min(1, fg / cutting) : 0,
      g.shiftNote,
      ...allSizes.map((s) => (bySize.has(s) ? bySize.get(s)! : "")),
    ];
  });

  const last = 3 + groups.length;
  styleBody(ws, 4, last, cols, 4);
  for (let r = 4; r <= last; r++) {
    ws.getCell(r, 5).numFmt = "dd/mm/yyyy";
    ws.getCell(r, 12).numFmt = "0.0%";
    ws.getCell(r, 16).numFmt = "0%";
    for (const c of [8, 9, 10, 11, 13, 14, 15]) ws.getCell(r, c).numFmt = "#,##0";
    for (let c = 18; c <= cols; c++) ws.getCell(r, c).numFmt = "#,##0";
    ws.getCell(r, 7).alignment = { vertical: "middle", horizontal: "center" };
    ws.getCell(r, 17).alignment = { vertical: "middle", horizontal: "left", wrapText: true };
    if (ws.getCell(r, 7).value === "TERLAMBAT") ws.getCell(r, 7).font = { name: FONT, size: 10, bold: true, color: { argb: "FFB42318" } };
  }

  // Baris TOTAL
  const totalRow = last + 1;
  const col = (n: number) => ws.getColumn(n).letter;
  ws.getRow(totalRow).values = ["TOTAL", "", "", "", "", "", "", ...[8, 9, 10, 11].map((c) => ({ formula: `SUM(${col(c)}4:${col(c)}${last})` })), "", ...[13, 14, 15].map((c) => ({ formula: `SUM(${col(c)}4:${col(c)}${last})` }))];
  ws.getCell(totalRow, 12).value = { formula: `IF(${col(10)}${totalRow}>0,${col(11)}${totalRow}/${col(10)}${totalRow},"")` };
  ws.getCell(totalRow, 16).value = { formula: `IF(${col(11)}${totalRow}>0,MIN(1,${col(13)}${totalRow}/${col(11)}${totalRow}),0)` };
  for (let c = 18; c <= cols; c++) ws.getCell(totalRow, c).value = { formula: `SUM(${col(c)}4:${col(c)}${last})` };
  for (let c = 1; c <= cols; c++) {
    const cell = ws.getCell(totalRow, c);
    cell.font = { name: FONT, size: 10, bold: true, color: { argb: INK } };
    cell.border = BORDER;
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFDDE7EE" } };
    cell.alignment = { vertical: "middle", horizontal: c <= 4 ? "left" : "right" };
  }
  ws.getCell(totalRow, 12).numFmt = "0.0%";
  ws.getCell(totalRow, 16).numFmt = "0%";
  for (const c of [8, 9, 10, 11, 13, 14, 15]) ws.getCell(totalRow, c).numFmt = "#,##0";
  for (let c = 18; c <= cols; c++) ws.getCell(totalRow, c).numFmt = "#,##0";

  const widths = [14, 20, 20, 10, 12, 11, 14, 9, 9, 11, 11, 10, 11, 9, 9, 9, 30, ...allSizes.map(() => 8)];
  widths.forEach((w, i) => (ws.getColumn(i + 1).width = w));
  if (groups.length > 0) ws.autoFilter = { from: { row: 3, column: 1 }, to: { row: last, column: cols } };
  ws.pageSetup = { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 };
}

function detailSheet(wb: Workbook, groups: MonitoringExportGroup[]) {
  const ws = wb.addWorksheet("Detail Size", { views: [{ state: "frozen", xSplit: 5, ySplit: 3 }] });
  const head = ["No. MRP", "Vendor", "Warna", "Lengan", "Size", "Target (pcs)", "Hasil Cutting", "Finish Good", "Reject", "Rework", "Cutting − Target", "FG − Target", "Yield Cutting", "Yield FG", "Di Luar Rencana"];
  const cols = head.length;

  ws.mergeCells(1, 1, 1, 8);
  const t = ws.getCell(1, 1);
  t.value = "Monitoring Produksi — Detail per Size";
  t.font = { name: FONT, size: 14, bold: true, color: { argb: INK } };
  ws.getCell(2, 1).value = "Satu baris per warna · lengan · size. Cutting − Target negatif = kurang dari rencana.";
  ws.getCell(2, 1).font = { name: FONT, size: 9, italic: true, color: { argb: "FF828290" } };
  ws.getRow(3).values = head;
  styleHeader(ws, 3, cols);

  let r = 4;
  for (const g of groups) {
    for (const s of [...g.sizes].sort((a, b) => compareSize(a.size, b.size))) {
      ws.getRow(r).values = [
        g.mrpId,
        g.vendor,
        g.warna,
        g.lengan,
        s.size,
        s.target,
        s.cutting,
        s.finishGood,
        s.reject,
        s.rework,
        s.cutting - s.target,
        s.finishGood - s.target,
        s.target > 0 ? s.cutting / s.target : "",
        s.cutting > 0 ? Math.min(1, s.finishGood / s.cutting) : 0,
        s.target === 0 ? "Ya" : "",
      ];
      r++;
    }
  }
  const last = r - 1;
  if (last >= 4) {
    styleBody(ws, 4, last, cols, 5);
    for (let i = 4; i <= last; i++) {
      for (let c = 6; c <= 12; c++) ws.getCell(i, c).numFmt = "#,##0;[Red]-#,##0";
      ws.getCell(i, 13).numFmt = "0.0%";
      ws.getCell(i, 14).numFmt = "0%";
      ws.getCell(i, 15).alignment = { vertical: "middle", horizontal: "center" };
    }
    ws.autoFilter = { from: { row: 3, column: 1 }, to: { row: last, column: cols } };
  }
  [14, 20, 20, 10, 8, 11, 11, 11, 9, 9, 13, 12, 11, 9, 11].forEach((w, i) => (ws.getColumn(i + 1).width = w));
  ws.pageSetup = { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 };
}

/** Download 1 file Excel (2 sheet). No-op kalau tidak ada data. ExcelJS di-import dinamis (tidak ikut bundle awal). */
export async function exportMonitoringProduksiExcel(groups: MonitoringExportGroup[], fileName: string) {
  if (groups.length === 0) return;
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = "Tigalapan Indonesia";
  wb.created = new Date();

  const sorted = [...groups].sort(
    (a, b) => a.mrpId.localeCompare(b.mrpId, "id-ID", { numeric: true }) || a.vendor.localeCompare(b.vendor) || a.warna.localeCompare(b.warna) || a.lengan.localeCompare(b.lengan)
  );
  const allSizes = Array.from(new Set(sorted.flatMap((g) => g.sizes.map((s) => s.size)))).sort(compareSize);
  summarySheet(wb, sorted, allSizes);
  detailSheet(wb, sorted);

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
