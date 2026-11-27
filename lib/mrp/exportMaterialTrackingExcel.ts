import type { Workbook, Worksheet } from "exceljs";
import { localDateString } from "./derive";

const NAVY = "FF1F3A5F";
const RP = '"Rp" #,##0';
const DATE_FMT = "dd/mm/yyyy";

/** Satu baris kiriman (satu invoice supplier) di Material Tracking Procurement. Tanggal berbentuk ISO ("2026-11-24" atau lengkap dengan jam). */
export type MaterialTrackingExportInvoice = {
  mrpId: string;
  supplier: string;
  vendorProduksi: string;
  noInvoice: string;
  noPo: string;
  entitas: string;
  kodeTransaksi: string;
  warna: string;
  roll: number;
  rollDiterima: number;
  rollTotal: number;
  nilai: number;
  status: string;
  /** Roll per tahap, mis. "Receiving Material 3 · Cutting 20". */
  statusRoll: string;
  sudahDelivery: boolean;
  tglInvoice?: string;
  tglBayar?: string;
  tglDelivery?: string;
  tglTerimaPertama?: string;
  tglLengkapDiterima?: string;
  /** "Lengkap" / "Sebagian" / "Belum ada" / "—" (invoice yang tidak memakai alur surat jalan). */
  suratJalan: string;
  invoiceId: string;
};

/** Satu baris roll kain (isi tab "Per Roll"). */
export type MaterialTrackingExportRoll = {
  mrpId: string;
  supplier: string;
  vendorProduksi: string;
  warna: string;
  lengan: string;
  noInvoice: string;
  noPo: string;
  codeRoll: string;
  noRoll: number;
  beratKotor: number;
  beratBersih?: number;
  status: string;
  tahapProduksi?: string;
  tglBayar?: string;
  tglDelivery?: string;
  tglGr?: string;
  tglResting?: string;
  tglCutting?: string;
  invoiceId: string;
};

const asDate = (iso?: string): Date | string => {
  if (!iso) return "";
  const d = new Date(iso.slice(0, 10) + "T00:00:00");
  return Number.isNaN(d.getTime()) ? "" : d;
};

function styleHeader(row: import("exceljs").Row) {
  row.eachCell((c) => {
    c.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 10 };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } };
    c.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
  });
  row.height = 32;
}

function titleBlock(ws: Worksheet, title: string, note: string) {
  ws.getCell("A1").value = title;
  ws.getCell("A1").font = { bold: true, size: 13 };
  ws.getCell("A2").value = note;
  ws.getCell("A2").font = { italic: true, size: 9, color: { argb: "FF6B7280" } };
}

/** Download Material Tracking Procurement ke Excel (owner 2026-11-26): sheet "Per Invoice" (satu baris per kiriman) dan "Per Roll" (satu baris per roll kain).
 *  Isi mengikuti pilihan di popup (MRP tertentu, sesuai filter tabel, atau hanya yang belum di-set delivery); `scopeLabel` dicetak di judul. */
export async function exportMaterialTrackingExcel(invoices: MaterialTrackingExportInvoice[], rolls: MaterialTrackingExportRoll[], scopeLabel: string, vendorName: (id: string) => string): Promise<void> {
  const ExcelJS = (await import("exceljs")).default;
  const wb: Workbook = new ExcelJS.Workbook();
  wb.creator = "Tigalapan Indonesia";
  wb.created = new Date();
  const today = localDateString(new Date());

  // ---- Sheet 1: Per Invoice ----
  const ws = wb.addWorksheet("Per Invoice", { views: [{ state: "frozen", ySplit: 4, xSplit: 3 }] });
  titleBlock(ws, "Material Tracking per Invoice", `Dibuat ${today} · ${scopeLabel} · ${invoices.length} invoice, ${invoices.reduce((s, r) => s + r.roll, 0).toLocaleString("id-ID", { maximumFractionDigits: 2 })} roll · Status = tahap paling awal roll di kiriman itu`);
  ws.addRow([]);
  const head = ws.addRow([
    "No. MRP", "Supplier", "Vendor Produksi", "No. Invoice Supplier", "No. PO", "Entitas", "Kode Transaksi", "Warna",
    "Roll", "Roll diterima vendor", "Nilai (Rp)", "Status", "Status roll per tahap", "Delivery Material",
    "Tgl Invoice", "Tgl Bayar", "Tgl Delivery Material", "Tgl Terima (pertama)", "Tgl Lengkap Diterima", "Surat Jalan", "ID invoice internal",
  ]);
  styleHeader(head);
  invoices.forEach((r) => {
    ws.addRow([
      r.mrpId, r.supplier, vendorName(r.vendorProduksi), r.noInvoice, r.noPo, r.entitas, r.kodeTransaksi, r.warna,
      r.roll, `${r.rollDiterima}/${r.rollTotal}`, r.nilai, r.status, r.statusRoll, r.sudahDelivery ? "Sudah delivery" : "Belum delivery",
      asDate(r.tglInvoice), asDate(r.tglBayar), asDate(r.tglDelivery), asDate(r.tglTerimaPertama), asDate(r.tglLengkapDiterima), r.suratJalan, r.invoiceId,
    ]);
  });
  if (invoices.length > 0) {
    const first = 5;
    const last = 4 + invoices.length;
    const total = ws.addRow([
      "TOTAL", "", "", "", "", "", "", "",
      { formula: `SUM(I${first}:I${last})`, result: invoices.reduce((s, r) => s + r.roll, 0) }, "",
      { formula: `SUM(K${first}:K${last})`, result: invoices.reduce((s, r) => s + r.nilai, 0) },
    ]);
    total.font = { bold: true };
    total.eachCell({ includeEmpty: true }, (c) => (c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF2F5F8" } }));
  }
  ws.getColumn(11).numFmt = RP;
  for (const c of [15, 16, 17, 18, 19]) ws.getColumn(c).numFmt = DATE_FMT;
  ws.columns.forEach((cl, i) => (cl.width = i === 7 ? 34 : i === 12 ? 38 : i === 20 ? 16 : i >= 14 && i <= 18 ? 14 : i === 10 ? 18 : 17));
  ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4, column: 21 } };

  // ---- Sheet 2: Per Roll ----
  const wr = wb.addWorksheet("Per Roll", { views: [{ state: "frozen", ySplit: 4, xSplit: 3 }] });
  titleBlock(wr, "Material Tracking per Roll", `Dibuat ${today} · ${scopeLabel} · ${rolls.length} roll, ${rolls.reduce((s, r) => s + r.beratKotor, 0).toLocaleString("id-ID", { maximumFractionDigits: 1 })} kg berat kotor · Satu baris per roll kain`);
  wr.addRow([]);
  const head2 = wr.addRow([
    "No. MRP", "Supplier", "Vendor Produksi", "Warna", "Lengan", "No. Invoice Supplier", "No. PO", "Code Roll", "Roll ke",
    "Berat kotor (kg)", "Berat bersih (kg)", "Status", "Tahap produksi", "Tgl Bayar", "Tgl Delivery Material", "Tgl GR", "Tgl Resting", "Tgl Cutting", "ID invoice internal",
  ]);
  styleHeader(head2);
  rolls.forEach((r) => {
    wr.addRow([
      r.mrpId, r.supplier, vendorName(r.vendorProduksi), r.warna, r.lengan === "PENDEK" ? "PDK" : r.lengan === "PANJANG" ? "PJG" : r.lengan, r.noInvoice, r.noPo, r.codeRoll || "", r.noRoll,
      r.beratKotor, r.beratBersih ?? "", r.status, r.tahapProduksi ?? "",
      asDate(r.tglBayar), asDate(r.tglDelivery), asDate(r.tglGr), asDate(r.tglResting), asDate(r.tglCutting), r.invoiceId,
    ]);
  });
  if (rolls.length > 0) {
    const first = 5;
    const last = 4 + rolls.length;
    const total = wr.addRow([
      "TOTAL", "", "", "", "", "", "", "", "",
      { formula: `SUM(J${first}:J${last})`, result: rolls.reduce((s, r) => s + r.beratKotor, 0) },
      { formula: `SUM(K${first}:K${last})`, result: rolls.reduce((s, r) => s + (r.beratBersih ?? 0), 0) },
    ]);
    total.font = { bold: true };
    total.eachCell({ includeEmpty: true }, (c) => (c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF2F5F8" } }));
  }
  for (const c of [10, 11]) wr.getColumn(c).numFmt = "#,##0.00";
  for (const c of [14, 15, 16, 17, 18]) wr.getColumn(c).numFmt = DATE_FMT;
  wr.columns.forEach((cl, i) => (cl.width = i === 3 ? 28 : i === 7 ? 18 : i === 8 || i === 4 ? 8 : i === 18 ? 16 : i >= 13 && i <= 17 ? 14 : 17));
  wr.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4, column: 19 } };

  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `material-tracking-${today}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
