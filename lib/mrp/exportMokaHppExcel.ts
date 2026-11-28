import type { Workbook } from "exceljs";
import type { MokaFilledItem } from "./exportMokaPo";

// File "HPP" yang ikut terunduh bersama CSV Download PO Warehouse (owner 2026-11-28), mengikuti template "HPP BY41 REG.xlsx":
// satu sheet ("Sheet1"), judul kolom di baris 4 (baris 1-3 kosong), data mulai baris 5, kolom KATEGORI | ITEM | JENIS LENGAN DAN UKURAN | QTY | COGS.
// Isi HANYA baris template Moka yang terisi (yang punya Supplier Email di CSV), urut seperti template. ITEM = isi kolom Items Name template Moka,
// COGS = Unit Cost (HPP per item, rata-rata tertimbang). KATEGORI dikosongkan seperti template contoh.
const HEADERS = ["KATEGORI", "ITEM", "JENIS LENGAN DAN UKURAN", "QTY", "COGS"] as const;

export const lenganUkuranLabel = (lengan?: string, size?: string): string => (lengan && size ? `${lengan} ${size}` : "");

/** Bangun workbook (dipisah dari unduhan supaya bisa diuji di Node). */
export async function buildMokaHppWorkbook(items: MokaFilledItem[]): Promise<Workbook> {
  const ExcelJS = (await import("exceljs")).default;
  const wb: Workbook = new ExcelJS.Workbook();
  wb.creator = "Tigalapan Indonesia";
  wb.created = new Date();
  const ws = wb.addWorksheet("Sheet1");
  const head = ws.getRow(4);
  HEADERS.forEach((h, i) => {
    const c = head.getCell(i + 1);
    c.value = h;
    c.font = { bold: true };
    c.alignment = { horizontal: "center", vertical: "middle" };
  });
  items.forEach((it, i) => {
    const row = ws.getRow(5 + i);
    row.getCell(2).value = it.name;
    row.getCell(3).value = lenganUkuranLabel(it.lengan, it.size);
    row.getCell(4).value = it.qty;
    if (it.cost != null) row.getCell(5).value = it.cost;
  });
  ws.getColumn(1).width = 16;
  ws.getColumn(2).width = 34;
  ws.getColumn(3).width = 26;
  ws.getColumn(4).width = 10;
  ws.getColumn(5).width = 12;
  ws.getColumn(5).numFmt = "#,##0";
  return wb;
}

export async function downloadMokaHppExcel(items: MokaFilledItem[], fileName: string): Promise<void> {
  const wb = await buildMokaHppWorkbook(items);
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
