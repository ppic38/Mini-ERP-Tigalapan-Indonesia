import type { Workbook, Worksheet } from "exceljs";
import { parseCsv, type MokaFilledItem } from "./exportMokaPo";

// Download PO Warehouse (owner 2026-11-28): satu file Excel berisi DUA sheet.
//  - Sheet 1 "PO Moka": isi sama dengan CSV Moka (template Import - Items Purchase Order yang sudah terisi).
//  - Sheet 2 "HPP": mengikuti template "HPP BY41 REG.xlsx": judul kolom di baris 4 (baris 1-3 kosong), data mulai baris 5,
//    kolom KATEGORI | ITEM | JENIS LENGAN DAN UKURAN | QTY | COGS. Hanya baris template Moka yang terisi (punya Supplier Email), urut seperti template.
//    HANYA ITEM dan COGS yang diisi (owner 2026-11-28, "benar-benar sama dengan template"): ITEM = isi kolom Items Name template Moka,
//    COGS = Unit Cost (HPP per item rata-rata tertimbang). KATEGORI, JENIS LENGAN DAN UKURAN, QTY dikosongkan seperti template contoh.
// CSV Moka tetap diunduh terpisah (format impor Moka); file Excel ini untuk dibaca / dipakai internal.
const HPP_HEADERS = ["KATEGORI", "ITEM", "JENIS LENGAN DAN UKURAN", "QTY", "COGS"] as const;
const NUMERIC_COLUMNS = ["in stock", "order", "unit cost"];

function fillHppSheet(ws: Worksheet, items: MokaFilledItem[]) {
  const head = ws.getRow(4);
  HPP_HEADERS.forEach((h, i) => {
    const c = head.getCell(i + 1);
    c.value = h;
    c.font = { bold: true };
    c.alignment = { horizontal: "center", vertical: "middle" };
  });
  items.forEach((it, i) => {
    const row = ws.getRow(5 + i);
    // Hanya ITEM dan COGS yang diisi (sama dengan template contoh); KATEGORI, JENIS LENGAN DAN UKURAN, dan QTY dikosongkan.
    row.getCell(2).value = it.name;
    if (it.cost != null) row.getCell(5).value = it.cost;
  });
  ws.getColumn(1).width = 16;
  ws.getColumn(2).width = 34;
  ws.getColumn(3).width = 26;
  ws.getColumn(4).width = 10;
  ws.getColumn(5).width = 12;
  ws.getColumn(5).numFmt = "#,##0";
}

/** Sheet 1: salin isi CSV Moka apa adanya. ID dan kode tetap teks (tidak jadi 1.35E+08); kolom In Stock, Order, Unit Cost menjadi angka. */
function fillMokaSheet(ws: Worksheet, csvText: string) {
  const rows = parseCsv(csvText).filter((r) => r.some((c) => c.trim() !== ""));
  const head = rows[0] ?? [];
  const numericCols = new Set(head.map((h, i) => (NUMERIC_COLUMNS.some((n) => h.trim().toLowerCase().startsWith(n)) ? i : -1)).filter((i) => i >= 0));
  rows.forEach((r, ri) => {
    const row = ws.getRow(ri + 1);
    r.forEach((cell, ci) => {
      const c = row.getCell(ci + 1);
      const asNum = ri > 0 && numericCols.has(ci) && cell.trim() !== "" && Number.isFinite(Number(cell)) ? Number(cell) : null;
      c.value = asNum ?? cell;
    });
  });
  const hr = ws.getRow(1);
  hr.font = { bold: true };
  ws.views = [{ state: "frozen", ySplit: 1 }];
  head.forEach((h, i) => {
    const key = h.trim().toLowerCase();
    ws.getColumn(i + 1).width = key.startsWith("items name") ? 38 : key.startsWith("outlet") ? 30 : key.startsWith("supplier") ? 26 : key.startsWith("sku") ? 22 : 15;
  });
}

/** Bangun workbook dua sheet (dipisah dari unduhan supaya bisa diuji di Node). */
export async function buildMokaPoWorkbook(csvText: string, items: MokaFilledItem[]): Promise<Workbook> {
  const ExcelJS = (await import("exceljs")).default;
  const wb: Workbook = new ExcelJS.Workbook();
  wb.creator = "Tigalapan Indonesia";
  wb.created = new Date();
  fillMokaSheet(wb.addWorksheet("PO Moka"), csvText);
  fillHppSheet(wb.addWorksheet("HPP"), items);
  return wb;
}

export async function downloadMokaPoExcel(csvText: string, items: MokaFilledItem[], fileName: string): Promise<void> {
  const wb = await buildMokaPoWorkbook(csvText, items);
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
