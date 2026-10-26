import type { Workbook } from "exceljs";
import { localDateString } from "./derive";
import { VENDOR_PRODUKSI } from "./seed";
import type { RawMaterialLine, RawMaterialSummary } from "./rawMaterialReport";

const NAVY = "FF1F3A5F";
const RP = '"Rp" #,##0';

function vendorName(id: string): string {
  return VENDOR_PRODUKSI[id]?.name ?? id;
}

function styleHeader(row: import("exceljs").Row) {
  row.eachCell((c) => {
    c.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 10 };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } };
    c.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
  });
  row.height = 32;
}

/** Laporan "Raw Material" Procurement ke Excel (pelaporan bulanan): sheet Ringkasan per MRP x vendor dan sheet Rincian per warna/item. */
export async function exportRawMaterialExcel(summaries: RawMaterialSummary[], lines: RawMaterialLine[], filterLabel: string): Promise<void> {
  const ExcelJS = (await import("exceljs")).default;
  const wb: Workbook = new ExcelJS.Workbook();
  wb.creator = "Tigalapan Indonesia";
  wb.created = new Date();

  const ws = wb.addWorksheet("Ringkasan MRP-Vendor", { views: [{ state: "frozen", ySplit: 3, xSplit: 2 }] });
  ws.getCell("A1").value = "Raw Material per MRP dan Vendor";
  ws.getCell("A1").font = { bold: true, size: 13 };
  ws.getCell("A2").value = `Dibuat ${localDateString(new Date())}${filterLabel ? " · Filter: " + filterLabel : ""} · WIP = roll sudah masuk produksi (belum ditutup), Sisa = dibeli dikurangi WIP dan selesai`;
  ws.getCell("A2").font = { italic: true, size: 9, color: { argb: "FF6B7280" } };
  const head = ws.addRow([
    "No. MRP", "Vendor", "Kategori produk", "Jenis bahan", "Jumlah invoice",
    "Roll dibeli", "Roll diterima", "Roll WIP", "Roll selesai", "Roll sisa",
    "Total sebelum diskon", "Diskon", "Total invoice setelah diskon", "WIP (Rp)", "Selesai produksi (Rp)", "Sisa bahan baku (Rp)",
  ]);
  styleHeader(head);
  for (const s of summaries) {
    ws.addRow([
      s.mrpId, vendorName(s.vendorProduksi), s.kategori, s.jenis, s.invoiceCount,
      s.rollBeli, s.rollDiterima, s.rollWip, s.rollSelesai, s.rollSisa,
      Math.round(s.nilaiSebelumDiskon), Math.round(s.diskon), Math.round(s.nilaiSetelahDiskon), Math.round(s.nilaiWip), Math.round(s.nilaiSelesai), Math.round(s.nilaiSisa),
    ]);
  }
  const total = ws.addRow([
    "TOTAL", "", "", "", "",
    ...[6, 7, 8, 9, 10].map((c) => ({ formula: `SUM(${String.fromCharCode(64 + c)}4:${String.fromCharCode(64 + c)}${3 + summaries.length})` })),
    ...[11, 12, 13, 14, 15, 16].map((c) => ({ formula: `SUM(${String.fromCharCode(64 + c)}4:${String.fromCharCode(64 + c)}${3 + summaries.length})` })),
  ]);
  total.font = { bold: true };
  total.eachCell((c) => (c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF2F5F8" } }));
  for (let c = 11; c <= 16; c++) ws.getColumn(c).numFmt = RP;
  ws.columns.forEach((col, i) => (col.width = i === 0 ? 16 : i === 1 ? 22 : i === 2 || i === 3 ? 22 : i < 10 ? 11 : 20));

  const wd = wb.addWorksheet("Rincian per warna", { views: [{ state: "frozen", ySplit: 1, xSplit: 3 }] });
  const head2 = wd.addRow([
    "No. MRP", "Vendor", "Warna", "Lengan", "Jenis bahan", "Kategori produk", "Benang", "No. invoice", "Tanggal invoice", "Supplier",
    "Roll dibeli", "Roll diterima", "Roll WIP", "Roll selesai", "Roll sisa", "Berat item tambahan (kg)",
    "Total sebelum diskon", "Diskon", "Total setelah diskon", "WIP (Rp)", "Selesai produksi (Rp)", "Sisa bahan baku (Rp)",
  ]);
  styleHeader(head2);
  for (const l of lines) {
    wd.addRow([
      l.mrpId, vendorName(l.vendorProduksi), l.warna, l.lengan ?? "", l.jenis, l.kategori, l.benang, l.invoiceId, l.bookedAt, l.supplier,
      l.rollBeli, l.rollDiterima, l.rollWip, l.rollSelesai, l.rollSisa, l.beratKg || "",
      Math.round(l.nilaiSebelumDiskon), Math.round(l.diskon), Math.round(l.nilaiSetelahDiskon), Math.round(l.nilaiWip), Math.round(l.nilaiSelesai), Math.round(l.nilaiSisa),
    ]);
  }
  for (let c = 17; c <= 22; c++) wd.getColumn(c).numFmt = RP;
  wd.columns.forEach((col, i) => (col.width = i < 3 ? 16 : i < 10 ? 16 : i < 16 ? 11 : 20));

  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `raw-material-${localDateString(new Date())}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
