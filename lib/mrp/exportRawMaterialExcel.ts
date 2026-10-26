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

  // Sheet Ringkasan dihitung dengan RUMUS dari sheet "Rincian per warna" (SUMIFS per MRP dan vendor), jadi kalau baris rincian diubah atau
  // dihapus, ringkasan dan total ikut berubah. Tiap rumus juga membawa hasil hitungan (`result`) supaya angka tampil di Protected View.
  const DETAIL = "'Rincian per warna'";
  const last = Math.max(2, 1 + lines.length);
  const rng = (col: string) => `${DETAIL}!$${col}$2:$${col}$${last}`;
  const col = (c: number) => String.fromCharCode(64 + c);
  const sumLines = (key: keyof RawMaterialLine, mrpId: string, vendorId: string) =>
    lines.filter((l) => l.mrpId === mrpId && vendorName(l.vendorProduksi) === vendorName(vendorId)).reduce((sum, l) => sum + Number(l[key] ?? 0), 0);

  const ws = wb.addWorksheet("Ringkasan MRP-Vendor", { views: [{ state: "frozen", ySplit: 3, xSplit: 2 }] });
  ws.getCell("A1").value = "Raw Material per MRP dan Vendor";
  ws.getCell("A1").font = { bold: true, size: 13 };
  ws.getCell("A2").value = `Dibuat ${localDateString(new Date())}${filterLabel ? " · Filter: " + filterLabel : ""} · Angka dihitung dengan rumus dari sheet "Rincian per warna" · Roll sisa = dibeli − WIP − selesai · Diskon = total sebelum diskon − total setelah diskon`;
  ws.getCell("A2").font = { italic: true, size: 9, color: { argb: "FF6B7280" } };
  const head = ws.addRow([
    "No. MRP", "Vendor", "Kategori produk", "Jenis bahan", "Jumlah invoice",
    "Roll dibeli", "Roll diterima", "Roll WIP", "Roll selesai", "Roll sisa",
    "Total sebelum diskon", "Diskon", "Total invoice setelah diskon", "WIP (Rp)", "Selesai produksi (Rp)", "Sisa bahan baku (Rp)",
  ]);
  styleHeader(head);
  // kolom ringkasan -> kolom sheet rincian yang dijumlahkan
  const map: [number, string, keyof RawMaterialLine][] = [
    [6, "J", "rollBeli"], [7, "K", "rollDiterima"], [8, "L", "rollWip"], [9, "M", "rollSelesai"],
    [11, "P", "nilaiSebelumDiskon"], [13, "R", "nilaiSetelahDiskon"], [14, "S", "nilaiWip"], [15, "T", "nilaiSelesai"], [16, "U", "nilaiSisa"],
  ];
  summaries.forEach((sm, i) => {
    const r = 4 + i;
    const vals: Record<number, number> = {};
    for (const [c, , key] of map) vals[c] = sumLines(key, sm.mrpId, sm.vendorProduksi);
    const cells: (string | number | { formula: string; result: number })[] = [sm.mrpId, vendorName(sm.vendorProduksi), sm.kategori, sm.jenis, sm.invoiceCount];
    for (let c = 6; c <= 16; c++) {
      const m = map.find((x) => x[0] === c);
      if (m) cells.push({ formula: `SUMIFS(${rng(m[1])},${rng("A")},$A${r},${rng("B")},$B${r})`, result: vals[c] });
      else if (c === 10) cells.push({ formula: `F${r}-H${r}-I${r}`, result: vals[6] - vals[8] - vals[9] });
      else cells.push({ formula: `K${r}-M${r}`, result: vals[11] - vals[13] }); // c === 12: Diskon
    }
    ws.addRow(cells);
  });
  const firstRow = 4;
  const lastRow = 3 + summaries.length;
  const totalCells: (string | { formula: string; result: number })[] = ["TOTAL", "", "", "", ""];
  for (let c = 6; c <= 16; c++) {
    const result = summaries.reduce((sum, sm) => {
      const m = map.find((x) => x[0] === c);
      if (m) return sum + sumLines(m[2], sm.mrpId, sm.vendorProduksi);
      if (c === 10) return sum + sumLines("rollBeli", sm.mrpId, sm.vendorProduksi) - sumLines("rollWip", sm.mrpId, sm.vendorProduksi) - sumLines("rollSelesai", sm.mrpId, sm.vendorProduksi);
      return sum + sumLines("nilaiSebelumDiskon", sm.mrpId, sm.vendorProduksi) - sumLines("nilaiSetelahDiskon", sm.mrpId, sm.vendorProduksi);
    }, 0);
    totalCells.push({ formula: `SUM(${col(c)}${firstRow}:${col(c)}${lastRow})`, result });
  }
  const total = ws.addRow(totalCells);
  total.font = { bold: true };
  total.eachCell((c) => (c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF2F5F8" } }));
  for (let c = 11; c <= 16; c++) ws.getColumn(c).numFmt = RP;
  ws.columns.forEach((cl, i) => (cl.width = i === 0 ? 16 : i === 1 ? 22 : i === 2 || i === 3 ? 22 : i < 10 ? 11 : 20));

  const wd = wb.addWorksheet("Rincian per warna", { views: [{ state: "frozen", ySplit: 1, xSplit: 3 }] });
  const head2 = wd.addRow([
    "No. MRP", "Vendor", "Warna", "Jenis bahan", "Kategori produk", "Benang", "No. invoice supplier", "Tanggal invoice", "Supplier",
    "Roll dibeli", "Roll diterima", "Roll WIP", "Roll selesai", "Roll sisa", "Berat item tambahan (kg)",
    "Total sebelum diskon", "Diskon", "Total setelah diskon", "WIP (Rp)", "Selesai produksi (Rp)", "Sisa bahan baku (Rp)", "ID invoice internal",
  ]);
  styleHeader(head2);
  lines.forEach((l, i) => {
    const r = 2 + i;
    // Nilai rupiah ditulis tanpa pembulatan (tampilan dibulatkan lewat format) supaya jumlah di ringkasan sama dengan angka di aplikasi.
    wd.addRow([
      l.mrpId, vendorName(l.vendorProduksi), l.warna, l.jenis, l.kategori, l.benang, l.noInvoice, l.bookedAt, l.supplier,
      l.rollBeli, l.rollDiterima, l.rollWip, l.rollSelesai,
      { formula: `J${r}-L${r}-M${r}`, result: l.rollBeli - l.rollWip - l.rollSelesai },
      l.beratKg || "",
      l.nilaiSebelumDiskon,
      { formula: `P${r}-R${r}`, result: l.nilaiSebelumDiskon - l.nilaiSetelahDiskon },
      l.nilaiSetelahDiskon, l.nilaiWip, l.nilaiSelesai, l.nilaiSisa, l.invoiceId,
    ]);
  });
  for (let c = 16; c <= 21; c++) wd.getColumn(c).numFmt = RP;
  wd.columns.forEach((cl, i) => (cl.width = i < 9 ? 16 : i < 15 ? 11 : 20));

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
