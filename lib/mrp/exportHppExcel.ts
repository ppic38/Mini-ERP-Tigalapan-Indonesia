import type { Workbook, Worksheet } from "exceljs";
import { VENDOR_PRODUKSI } from "./seed";
import type { HppItemLine, HppReport, HppRollLine } from "./hppReport";

// Unduh Laporan HPP per MRP (template CAL HPP ERP, revisi 2026-11-02): empat sheet -- HPP On Going (estimasi) dan HPP Final (satu baris per
// warna · lengan · size, rata-rata tertimbang), lalu Detail Roll On Going dan Detail Roll Final (satu baris per roll x size). Header berwarna
// (hijau = final, oranye = estimasi), baris header ber-filter dan dibekukan. Angka sudah dihitung di hppRowsForInvoicePerRoll / buildHppReport.

const INK = "FF1A1A1F";
const FINAL_BG = "FF0D9488";
const ESTIMASI_BG = "FFB45309";
const SOFT = "FFF0F3F6";
const LINE = "FFD3D8DF";
const FONT = "Calibri";
const thin = { style: "thin" as const, color: { argb: LINE } };
const BORDER = { top: thin, left: thin, bottom: thin, right: thin };

const vendorName = (id: string) => VENDOR_PRODUKSI[id]?.name ?? id;
const lenganLabel = (l: string) => (l === "PENDEK" ? "Pendek" : "Panjang");

type Col = { head: string; width: number; kind: "text" | "int" | "rp" | "dec" | "pct" };

function sheet(wb: Workbook, name: string, bg: string, title: string, note: string, cols: Col[], rows: (string | number | null)[][]): Worksheet {
  const ws = wb.addWorksheet(name, { views: [{ state: "frozen", xSplit: 3, ySplit: 4 }] });
  ws.mergeCells(1, 1, 1, Math.min(cols.length, 9));
  ws.getCell(1, 1).value = title;
  ws.getCell(1, 1).font = { name: FONT, size: 14, bold: true, color: { argb: INK } };
  ws.mergeCells(2, 1, 2, Math.min(cols.length, 14));
  ws.getCell(2, 1).value = note;
  ws.getCell(2, 1).font = { name: FONT, size: 9, italic: true, color: { argb: "FF828290" } };
  ws.getCell(2, 1).alignment = { wrapText: true, vertical: "top" };
  ws.getRow(2).height = 38;

  const head = ws.getRow(4);
  head.height = 32;
  cols.forEach((c, i) => {
    const cell = head.getCell(i + 1);
    cell.value = c.head;
    cell.font = { name: FONT, size: 10, bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: bg } };
    cell.alignment = { vertical: "middle", horizontal: c.kind === "text" ? "left" : "right", wrapText: true };
    cell.border = BORDER;
    ws.getColumn(i + 1).width = c.width;
  });
  rows.forEach((values, ri) => {
    const row = ws.getRow(5 + ri);
    cols.forEach((c, ci) => {
      const cell = row.getCell(ci + 1);
      cell.value = values[ci] ?? (c.kind === "text" ? "" : null);
      cell.font = { name: FONT, size: 10, color: { argb: INK } };
      cell.border = BORDER;
      cell.alignment = { vertical: "middle", horizontal: c.kind === "text" ? "left" : "right" };
      if (c.kind === "int" || c.kind === "rp") cell.numFmt = "#,##0";
      if (c.kind === "dec") cell.numFmt = "#,##0.00";
      if (c.kind === "pct") cell.numFmt = "0.0%";
      if (ri % 2 === 1) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: SOFT } };
    });
  });
  if (rows.length > 0) ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4, column: cols.length } };
  else ws.getCell(5, 1).value = "Belum ada data untuk kelompok ini.";
  return ws;
}

const ITEM_COLS: Col[] = [
  { head: "Warna", width: 24, kind: "text" },
  { head: "Lengan", width: 9, kind: "text" },
  { head: "Size", width: 8, kind: "text" },
  { head: "Vendor", width: 18, kind: "text" },
  { head: "Qty FG (pcs)", width: 11, kind: "int" },
  { head: "Bahan/pcs (setelah diskon)", width: 14, kind: "rp" },
  { head: "Rib/pcs", width: 10, kind: "rp" },
  { head: "COGS Bahan/pcs", width: 13, kind: "rp" },
  { head: "Maklon/pcs", width: 11, kind: "rp" },
  { head: "Ongkir/pcs", width: 11, kind: "rp" },
  { head: "HPP/pcs", width: 11, kind: "rp" },
  { head: "HPP Min", width: 10, kind: "rp" },
  { head: "HPP Maks", width: 10, kind: "rp" },
  { head: "Harga Jual", width: 11, kind: "rp" },
  { head: "Ratio HPP", width: 10, kind: "pct" },
  { head: "Total HPP (Rp)", width: 15, kind: "rp" },
  { head: "Jumlah Roll", width: 9, kind: "int" },
  { head: "Jumlah Resi", width: 9, kind: "int" },
];
const itemRow = (i: HppItemLine) => [
  i.warna, lenganLabel(i.lengan), i.size, i.vendors.map(vendorName).join(", "), i.fg, i.bahanPcs, i.ribPcs, i.cogsBahanPcs, i.maklonPcs, i.ongkirPcs, i.hppPcs,
  i.hppMin, i.hppMax, i.hargaJual, i.ratio, i.totalHpp, i.jumlahRoll, i.jumlahResi,
];

const ROLL_COLS: Col[] = [
  { head: "Vendor", width: 18, kind: "text" },
  { head: "Warna", width: 24, kind: "text" },
  { head: "Lengan", width: 9, kind: "text" },
  { head: "Size", width: 8, kind: "text" },
  { head: "Code Roll", width: 16, kind: "text" },
  { head: "No Invoice Material", width: 18, kind: "text" },
  { head: "Berat Roll Gross (kg)", width: 12, kind: "dec" },
  { head: "Harga/kg", width: 11, kind: "rp" },
  { head: "Biaya Bahan Roll", width: 14, kind: "rp" },
  { head: "Diskon (porsi roll)", width: 13, kind: "rp" },
  { head: "Rib (porsi roll)", width: 13, kind: "rp" },
  { head: "Pembagi (pcs)", width: 10, kind: "int" },
  { head: "Qty FG (pcs)", width: 10, kind: "int" },
  { head: "No Resi", width: 18, kind: "text" },
  { head: "No Koli", width: 14, kind: "text" },
  { head: "Bahan/pcs (setelah diskon)", width: 14, kind: "rp" },
  { head: "Diskon/pcs", width: 10, kind: "rp" },
  { head: "Rib/pcs", width: 10, kind: "rp" },
  { head: "COGS Bahan/pcs", width: 13, kind: "rp" },
  { head: "Maklon/pcs", width: 11, kind: "rp" },
  { head: "Ongkir/pcs", width: 11, kind: "rp" },
  { head: "HPP/pcs", width: 11, kind: "rp" },
  { head: "Harga Jual", width: 11, kind: "rp" },
  { head: "Ratio HPP", width: 10, kind: "pct" },
  { head: "Total HPP (Rp)", width: 15, kind: "rp" },
];
const rollRow = (r: HppRollLine) => [
  vendorName(r.vendor), r.warna, lenganLabel(r.lengan), r.size, r.roll, r.invoiceMaterial, r.grossKg, r.hargaPerKg, r.biayaBahanRoll, r.diskonRoll, r.ribRoll,
  r.pembagi, r.fg, r.resi, r.koli, r.bahanPcs, r.diskonPcs, r.ribPcs, r.cogsBahanPcs, r.maklonPcs, r.ongkirPcs, r.hppPcs, r.hargaJual, r.ratio, r.totalHpp,
];

export async function exportHppExcel(mrpId: string, report: HppReport, fileName: string) {
  const ExcelJS = (await import("exceljs")).default;
  const wb: Workbook = new ExcelJS.Workbook();
  wb.creator = "Tigalapan Indonesia";
  wb.created = new Date();
  const stamp = new Date().toLocaleString("id-ID");
  const rumus =
    "Rumus per pcs: Bahan = (biaya bahan roll - porsi diskon) / pembagi; Diskon roll = diskon invoice / total kg kain invoice x berat roll; Rib = biaya rib warna / total kg kain warna x berat roll / pembagi; " +
    "COGS Bahan = Bahan + Rib; HPP = COGS Bahan + Maklon + Ongkir; Ratio HPP = HPP / Harga Jual.";
  const estimasiNote = `MRP ${mrpId} · diunduh ${stamp} · ESTIMASI: roll yang belum ditutup, pembagi = hasil cutting roll (berubah sampai roll ditutup). ${rumus}`;
  const finalNote = `MRP ${mrpId} · diunduh ${stamp} · FINAL: roll yang sudah ditutup (pembagi = Finish Good aktual), plus baris rework dan data lama tanpa roll. ${rumus}`;
  sheet(wb, "HPP On Going (Estimasi)", ESTIMASI_BG, `HPP On Going (Estimasi) — ${mrpId}`, estimasiNote, ITEM_COLS, report.estimasi.items.map(itemRow));
  sheet(wb, "HPP Final", FINAL_BG, `HPP Final — ${mrpId}`, finalNote, ITEM_COLS, report.final.items.map(itemRow));
  sheet(wb, "Detail Roll On Going", ESTIMASI_BG, `Detail Roll On Going (Estimasi) — ${mrpId}`, estimasiNote, ROLL_COLS, report.estimasi.rolls.map(rollRow));
  sheet(wb, "Detail Roll Final", FINAL_BG, `Detail Roll Final — ${mrpId}`, finalNote, ROLL_COLS, report.final.rolls.map(rollRow));

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
