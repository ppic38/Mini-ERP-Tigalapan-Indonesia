import type { Workbook } from "exceljs";
import { compareNoKoli } from "./derive";
import { LT_TIBA_DEFAULT } from "./itemEstimates";

// Excel pengiriman per resi untuk Warehouse (owner 2026-11-09), mengikuti template "BY38 MLS": SATU sheet = SATU resi. Blok kiri atas: NO PO, Start (tanggal kirim), End,
// total qty (merah, SUBTOTAL jadi ikut filter) dan legenda warna Produksi / Warehouse. Tabel: NO KOLI, ITEM NAME (nama dari Master SKU), QTY, Type, Tgl Kirim, AWB (= no resi),
// ETA (= Tgl Kirim + 7 hari, rumus). Satu baris per koli x item x jenis (qty dari beberapa roll sudah dijumlahkan), header ber-filter.

const FONT = "Calibri";
const TEAL = "FF45B5C4";
const SALMON = "FFE08B7A";
const ORANGE = "FFFFC000";
const INK = "FF1A1A1F";
const thin = { style: "thin" as const, color: { argb: "FF8FA3AD" } };
const BORDER = { top: thin, left: thin, bottom: thin, right: thin };
const FMT_DATE = "d-mmm";
const FMT_INT = "#,##0";
export const ETA_HARI = LT_TIBA_DEFAULT; // owner: ETA = tanggal kirim + 7

export type ResiSheetRow = { noKoli: string; itemName: string; qty: number; type: "FINISH GOOD" | "REWORK" | "REJECT" };
export type ResiSheet = {
  noResi: string;
  /** Nomor PO Produksi (maklon) MRP + vendor resi ini; kosong = "-". */
  noPo: string;
  /** Tanggal kirim YYYY-MM-DD. */
  deliveredAt?: string;
  rows: ResiSheetRow[];
};

const dateOf = (iso?: string): Date | null => {
  if (!iso) return null;
  const [y, m, d] = iso.split("-").map(Number);
  return y && m && d ? new Date(Date.UTC(y, m - 1, d)) : null;
};
const serialOf = (d: Date) => Math.round((d.getTime() - Date.UTC(1899, 11, 30)) / 86400000);
const asNumberIfDigits = (s: string): string | number => (/^\d+$/.test(s.trim()) ? Number(s.trim()) : s);

/** Nama sheet Excel: maksimal 31 karakter, tanpa \ / ? * [ ] :, unik dalam satu file. */
function sheetName(raw: string, used: Set<string>): string {
  const base = (raw.replace(/[\\/?*[\]:]/g, "-").trim() || "Resi").slice(0, 28);
  let name = base;
  let n = 2;
  while (used.has(name.toLowerCase())) name = `${base.slice(0, 26)}-${n++}`;
  used.add(name.toLowerCase());
  return name;
}

export function sortResiRows(rows: ResiSheetRow[]): ResiSheetRow[] {
  return [...rows].sort((a, b) => compareNoKoli(a.noKoli, b.noKoli) || a.itemName.localeCompare(b.itemName, "id-ID", { numeric: true }) || a.type.localeCompare(b.type));
}

export async function buildResiTemplateWorkbook(sheets: ResiSheet[]): Promise<Workbook> {
  const ExcelJS = (await import("exceljs")).default;
  const wb: Workbook = new ExcelJS.Workbook();
  wb.creator = "Mini ERP Tigalapan";
  wb.created = new Date();
  wb.calcProperties.fullCalcOnLoad = true;
  const used = new Set<string>();

  for (const s of sheets) {
    const ws = wb.addWorksheet(sheetName(s.noResi, used), { views: [{ state: "frozen", ySplit: 4, showGridLines: true }] });
    ws.columns = [{ width: 9 }, { width: 40 }, { width: 9 }, { width: 18 }, { width: 11 }, { width: 14 }, { width: 11 }];
    const rows = sortResiRows(s.rows);
    const FIRST = 5;
    const LAST = FIRST + Math.max(rows.length, 1) - 1;
    const totalQty = rows.reduce((a, r) => a + r.qty, 0);
    const kirim = dateOf(s.deliveredAt);

    const label = (r: number, text: string) => {
      const c = ws.getCell(r, 1);
      c.value = text;
      c.font = { name: FONT, size: 11, bold: true, color: { argb: INK } };
      c.alignment = { horizontal: "right" };
    };
    label(1, "NO PO :");
    label(2, "Start :");
    label(3, "End :");
    ws.getCell(1, 2).value = s.noPo || "-";
    ws.getCell(1, 2).font = { name: FONT, size: 11, bold: true, color: { argb: INK } };
    ws.getCell(2, 2).value = kirim;
    ws.getCell(2, 2).numFmt = "dd-mmm-yyyy";
    ws.getCell(2, 2).alignment = { horizontal: "left" };
    ws.getCell(2, 2).font = { name: FONT, size: 11, color: { argb: INK } };
    ws.getCell(3, 2).value = "-";
    ws.getCell(3, 2).font = { name: FONT, size: 11, color: { argb: INK } };
    // total qty (merah), mengikuti filter
    const tq = ws.getCell(3, 3);
    tq.value = { formula: `SUBTOTAL(9,C${FIRST}:C${LAST})`, result: totalQty };
    tq.numFmt = FMT_INT;
    tq.font = { name: FONT, size: 11, bold: true, color: { argb: "FFFF0000" } };
    tq.alignment = { horizontal: "right" };
    // legenda warna
    ws.getCell(1, 3).fill = { type: "pattern", pattern: "solid", fgColor: { argb: TEAL } };
    ws.getCell(2, 3).fill = { type: "pattern", pattern: "solid", fgColor: { argb: SALMON } };
    ws.getCell(1, 4).value = "Produksi";
    ws.getCell(2, 4).value = "Warehouse";
    for (const r of [1, 2]) ws.getCell(r, 4).font = { name: FONT, size: 11, bold: true, color: { argb: INK } };

    const heads = ["NO KOLI", "ITEM NAME", "QTY", "Type", "Tgl Kirim", "AWB", "ETA"];
    heads.forEach((h, i) => {
      const c = ws.getCell(4, i + 1);
      c.value = h;
      c.font = { name: FONT, size: 11, bold: true, color: { argb: INK } };
      c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: i === 6 ? ORANGE : TEAL } };
      c.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
      c.border = BORDER;
    });
    ws.getRow(4).height = 30;

    const awb = asNumberIfDigits(s.noResi);
    if (rows.length === 0) {
      ws.mergeCells(FIRST, 1, FIRST, 7);
      ws.getCell(FIRST, 1).value = "Resi ini belum berisi item.";
      ws.getCell(FIRST, 1).font = { name: FONT, size: 10, italic: true, color: { argb: "FF6B7280" } };
    }
    rows.forEach((r, i) => {
      const n = FIRST + i;
      const vals: (string | number | Date | null | { formula: string; result: number | string })[] = [
        asNumberIfDigits(r.noKoli),
        r.itemName,
        r.qty,
        r.type,
        kirim,
        awb,
        { formula: `IF(E${n}="","",E${n}+${ETA_HARI})`, result: kirim ? serialOf(kirim) + ETA_HARI : "" },
      ];
      vals.forEach((v, c) => {
        const cell = ws.getCell(n, c + 1);
        cell.value = v as never;
        cell.font = { name: FONT, size: 11, italic: c === 4 || c === 6, color: { argb: INK } };
        cell.border = BORDER;
        cell.alignment = { vertical: "middle", horizontal: c === 1 || c === 3 ? "left" : c === 0 || c === 2 || c === 5 ? "right" : "center" };
        if (c === 2) cell.numFmt = FMT_INT;
        if (c === 4 || c === 6) cell.numFmt = FMT_DATE;
      });
    });
    if (rows.length > 0) ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: LAST, column: 7 } };
    ws.pageSetup = { orientation: "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
  }
  return wb;
}

export async function exportResiTemplateExcel(sheets: ResiSheet[], fileName: string): Promise<void> {
  const wb = await buildResiTemplateWorkbook(sheets);
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
