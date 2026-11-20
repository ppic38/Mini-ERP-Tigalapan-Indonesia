import type { Workbook } from "exceljs";
import { TRACK_STATUSES, type TrackLine } from "./itemTracking";

// Export Tracking Item (owner 2026-11-19): kolom tetap, satu baris = roll x size x status (sama dengan tabel di layar):
//   Item (SKU), No. MRP, Vendor, Kategori, Warna, Size, Code Roll, Target, satu kolom per status (Wait PV .. GR DC, Reject),
//   Status, No Koli, No Resi, Est. Delivery, Est. Tiba. Mengikuti baris yang tampil (filter tabel dan filter tanggal). Total memakai SUBTOTAL(109)
//   sehingga ikut berubah saat difilter di Excel. Menggantikan template WIP lama (lib/mrp/exportTrackingExcel.ts, tidak dipakai lagi).

const INK = "FF1A1A1F";
const HEAD_BG = "FF2563EB";
const ZEBRA = "FFF8FAFF";
const TOTAL_BG = "FFDBEAFE";
const MUTED = "FF6B7280";
const LINE = "FFD3D8DF";
const FONT = "Calibri";
const thin = { style: "thin" as const, color: { argb: LINE } };
const BORDER = { top: thin, left: thin, bottom: thin, right: thin };
const FMT_INT = "#,##0";
const FMT_DATE = "dd/mm/yyyy";

export type TrackExportRow = TrackLine & { itemSku: string; vendorName: string };

const colLetter = (n: number) => {
  let s = "";
  for (let x = n; x > 0; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(65 + ((x - 1) % 26)) + s;
  return s;
};
const asDate = (iso?: string) => (iso ? new Date(`${iso.slice(0, 10)}T00:00:00Z`) : null);

export async function exportTrackLinesExcel(rows: TrackExportRow[], fileName: string, filterLabel?: string): Promise<void> {
  const ExcelJS = (await import("exceljs")).default;
  const wb: Workbook = new ExcelJS.Workbook();
  wb.creator = "Mini ERP Tigalapan";
  wb.created = new Date();
  wb.calcProperties.fullCalcOnLoad = true;

  const head: { text: string; width: number; kind: "text" | "int" | "date" }[] = [
    { text: "Item SKU", width: 30, kind: "text" },
    { text: "No MRP", width: 12, kind: "text" },
    { text: "Vendor", width: 18, kind: "text" },
    { text: "Kategori", width: 16, kind: "text" },
    { text: "Warna", width: 22, kind: "text" },
    { text: "Size", width: 7, kind: "text" },
    { text: "Code Roll", width: 16, kind: "text" },
    { text: "Target", width: 9, kind: "int" },
    ...TRACK_STATUSES.map((s) => ({ text: s, width: 10, kind: "int" as const })),
    { text: "Status", width: 12, kind: "text" },
    { text: "No Koli", width: 14, kind: "text" },
    { text: "No Resi", width: 22, kind: "text" },
    { text: "ETD", width: 13, kind: "date" },
    { text: "ETA", width: 13, kind: "date" },
  ];
  const COLS = head.length;

  const ws = wb.addWorksheet("Tracking Item", { views: [{ showGridLines: false }] });
  ws.columns = head.map((h) => ({ width: h.width }));
  ws.mergeCells(1, 1, 1, COLS);
  ws.getCell(1, 1).value = "Tracking Item per roll x size x status";
  ws.getCell(1, 1).font = { name: FONT, size: 15, bold: true, color: { argb: INK } };
  ws.getRow(1).height = 24;
  ws.mergeCells(2, 1, 2, COLS);
  ws.getCell(2, 1).value =
    `Diunduh ${new Date().toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" })} · ${rows.length} baris` +
    (filterLabel ? ` · ${filterLabel}` : "") +
    " · Qty hanya di kolom statusnya; Target hanya di baris pertama roll x size. Estimasi = tanggal masuk status + lead time sisa tahap.";
  ws.getCell(2, 1).font = { name: FONT, size: 9, italic: true, color: { argb: MUTED } };
  ws.getCell(2, 1).alignment = { wrapText: true, vertical: "top" };
  ws.getRow(2).height = 28;

  const HEAD = 4;
  head.forEach((h, i) => {
    const cell = ws.getCell(HEAD, i + 1);
    cell.value = h.text;
    cell.font = { name: FONT, size: 10, bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEAD_BG } };
    cell.alignment = { vertical: "middle", horizontal: h.kind === "int" ? "right" : "left", wrapText: true };
    cell.border = BORDER;
  });
  ws.getRow(HEAD).height = 30;

  rows.forEach((r, i) => {
    const vals: (string | number | Date | null)[] = [
      r.itemSku,
      r.mrpId,
      r.vendorName,
      r.kategori || "",
      r.warna,
      r.size,
      r.codeRoll || "",
      r.target || null,
      ...TRACK_STATUSES.map((s) => (r.stage === s && r.qty ? r.qty : null)),
      r.stage,
      r.noKoli || "",
      r.noResi || "",
      asDate(r.estKirim),
      asDate(r.estTibaDc),
    ];
    const rowNo = HEAD + 1 + i;
    vals.forEach((v, c) => {
      const cell = ws.getCell(rowNo, c + 1);
      cell.value = v;
      cell.font = { name: FONT, size: 10, color: { argb: INK } };
      cell.border = BORDER;
      const kind = head[c].kind;
      if (kind === "int") cell.numFmt = FMT_INT;
      if (kind === "date") cell.numFmt = FMT_DATE;
      cell.alignment = { vertical: "middle", horizontal: kind === "int" ? "right" : "left" };
      if (i % 2 === 1) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: ZEBRA } };
    });
  });

  if (rows.length > 0) {
    const first = HEAD + 1;
    const last = HEAD + rows.length;
    const T = last + 1;
    for (let c = 1; c <= COLS; c++) {
      const cell = ws.getCell(T, c);
      cell.font = { name: FONT, size: 10, bold: true, color: { argb: INK } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: TOTAL_BG } };
      cell.border = BORDER;
      if (head[c - 1].kind === "int") {
        const L = colLetter(c);
        const result = c === 8 ? rows.reduce((s, r) => s + (r.target || 0), 0) : rows.reduce((s, r) => s + (r.stage === head[c - 1].text ? r.qty : 0), 0);
        cell.value = { formula: `SUBTOTAL(109,${L}${first}:${L}${last})`, result };
        cell.numFmt = FMT_INT;
        cell.alignment = { horizontal: "right" };
      }
    }
    ws.getCell(T, 1).value = "Total";
    ws.autoFilter = { from: { row: HEAD, column: 1 }, to: { row: last, column: COLS } };
  }
  ws.views = [{ showGridLines: false, state: "frozen", ySplit: HEAD, xSplit: 1 }];

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
