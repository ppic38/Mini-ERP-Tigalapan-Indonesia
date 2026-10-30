import type { Workbook, Worksheet } from "exceljs";
import { formatPcs, maklonTipeForWarna, mrpDetailFor, vendorInvoiceAdjustmentTotal, vendorInvoiceFinalAmount, vendorInvoiceBadge, vendorInvoicePaymentStatus } from "./derive";
import { VENDOR_PRODUKSI } from "./seed";
import type { MrpDetail } from "./store";
import type { VendorInvoice } from "./types";

// Laporan Invoice Vendor Produksi ke Excel (owner 2026-10-30: "download laporan dengan header berwarna, ada filternya, lengkap dengan
// kategori item"). Dua sheet dalam 1 file, header berwarna (hijau, sama dengan export lain), baris header ber-filter (autoFilter) dan
// dibekukan supaya tetap terlihat saat scroll:
//  - "Detail Item": 1 baris per baris invoice (invoice, MRP, kategori item, warna, lengan, tipe harga, qty, harga/pc, jumlah) + status,
//    tanggal, dan PIC invoicenya -- bentuk datar siap difilter / dijadikan pivot.
//  - "Ringkasan Invoice": 1 baris per invoice (kategori yang tercakup, total qty, subtotal, denda, reward, total tagihan, status, PIC).
// Angka sama persis dengan layar (vendorInvoiceFinalAmount dst.); halaman yang memilih invoicenya, file ini hanya menata sel.

const INK = "FF1A1A1F";
const HEAD_BG = "FF0D9488";
const SOFT = "FFF0F3F6";
const LINE = "FFD3D8DF";
const FONT = "Calibri";
const thin = { style: "thin" as const, color: { argb: LINE } };
const BORDER = { top: thin, left: thin, bottom: thin, right: thin };
const NUM = "#,##0";

function dateCell(iso?: string): Date | string {
  if (!iso) return "";
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return iso;
  // UTC: ExcelJS menyimpan tanggal sebagai UTC, jadi tengah malam lokal akan bergeser sehari di Excel.
  return new Date(Date.UTC(y, m - 1, d));
}

const vendorName = (inv: VendorInvoice) => VENDOR_PRODUKSI[inv.vendorProduksi]?.name ?? inv.vendorProduksi;

function styleSheet(ws: Worksheet, headRow: number, cols: number, lastRow: number, textCols: number[], numCols: number[], dateCols: number[], widths: number[]) {
  const head = ws.getRow(headRow);
  head.height = 30;
  for (let c = 1; c <= cols; c++) {
    const cell = head.getCell(c);
    cell.font = { name: FONT, size: 10, bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEAD_BG } };
    cell.alignment = { vertical: "middle", horizontal: numCols.includes(c) ? "right" : "left", wrapText: true };
    cell.border = BORDER;
    ws.getColumn(c).width = widths[c - 1] ?? 14;
  }
  for (let r = headRow + 1; r <= lastRow; r++) {
    const row = ws.getRow(r);
    for (let c = 1; c <= cols; c++) {
      const cell = row.getCell(c);
      cell.font = { name: FONT, size: 10, color: { argb: INK } };
      cell.border = BORDER;
      cell.alignment = { vertical: "middle", horizontal: numCols.includes(c) ? "right" : "left" };
      if (numCols.includes(c)) cell.numFmt = NUM;
      if (dateCols.includes(c)) cell.numFmt = "dd/mm/yyyy";
      if ((r - headRow) % 2 === 0) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: SOFT } };
    }
  }
  void textCols;
  if (lastRow > headRow) ws.autoFilter = { from: { row: headRow, column: 1 }, to: { row: headRow, column: cols } };
}

function titleRows(ws: Worksheet, title: string, note: string, cols: number) {
  ws.mergeCells(1, 1, 1, Math.min(cols, 8));
  ws.getCell(1, 1).value = title;
  ws.getCell(1, 1).font = { name: FONT, size: 14, bold: true, color: { argb: INK } };
  ws.getCell(2, 1).value = note;
  ws.getCell(2, 1).font = { name: FONT, size: 9, italic: true, color: { argb: "FF828290" } };
}

export async function exportVendorInvoiceExcel(invoices: VendorInvoice[], mrpDetails: MrpDetail[], fileName: string) {
  if (invoices.length === 0) return;
  const ExcelJS = (await import("exceljs")).default;
  const wb: Workbook = new ExcelJS.Workbook();
  wb.creator = "Tigalapan Indonesia";
  wb.created = new Date();
  const note = `Diunduh ${new Date().toLocaleString("id-ID")} · ${formatPcs(invoices.length)} invoice · gunakan tombol filter di baris header`;
  const kategoriOf = (mrpId: string, warna: string, lengan: string) => mrpDetailFor(mrpId, mrpDetails)?.lenganGroups.find((g) => g.warna === warna && g.lengan === lengan)?.kategori ?? "";
  const sorted = [...invoices].sort((a, b) => (a.submittedAt === b.submittedAt ? a.id.localeCompare(b.id, "id-ID", { numeric: true }) : a.submittedAt < b.submittedAt ? 1 : -1));

  // ---- Detail Item
  const detail = wb.addWorksheet("Detail Item", { views: [{ state: "frozen", xSplit: 2, ySplit: 3 }] });
  const dHead = ["No Invoice", "Vendor Produksi", "No MRP", "Kategori Item", "Warna", "Lengan", "Tipe Harga", "Qty (pcs)", "Harga/pc", "Jumlah", "Status Invoice", "Status Payment", "Tanggal Invoice", "Tanggal Disetujui", "PIC Menyetujui", "Tanggal Dibayar", "PIC Pembayaran"];
  titleRows(detail, "Laporan Invoice Vendor Produksi — Detail Item", note, dHead.length);
  detail.getRow(3).values = dHead;
  let r = 3;
  for (const inv of sorted) {
    for (const l of inv.lines) {
      r++;
      detail.getRow(r).values = [
        inv.id,
        vendorName(inv),
        l.mrpId,
        kategoriOf(l.mrpId, l.warna, l.lengan) || "—",
        l.warna,
        l.lengan === "PENDEK" ? "Pendek" : "Panjang",
        maklonTipeForWarna(l.mrpId, l.warna, l.lengan, mrpDetails),
        l.qty,
        l.ratePerPc,
        l.amount,
        vendorInvoiceBadge(inv.status).label,
        vendorInvoicePaymentStatus(inv).label,
        dateCell(inv.submittedAt),
        dateCell(inv.approvedAt),
        inv.approvedBy ?? "",
        dateCell(inv.paidAt),
        inv.paidBy ?? "",
      ];
    }
  }
  styleSheet(detail, 3, dHead.length, r, [], [8, 9, 10], [13, 14, 16], [14, 16, 9, 16, 26, 10, 11, 10, 11, 14, 13, 14, 13, 14, 20, 13, 20]);

  // ---- Ringkasan Invoice
  const sum = wb.addWorksheet("Ringkasan Invoice", { views: [{ state: "frozen", xSplit: 1, ySplit: 3 }] });
  const sHead = ["No Invoice", "Vendor Produksi", "No MRP", "Kategori Item", "Total Qty (pcs)", "Subtotal", "Denda", "Reward", "Total Tagihan", "Status Invoice", "Status Payment", "Tanggal Invoice", "Tanggal Disetujui", "PIC Menyetujui", "Tanggal Dibayar", "PIC Pembayaran"];
  titleRows(sum, "Laporan Invoice Vendor Produksi — Ringkasan per Invoice", note, sHead.length);
  sum.getRow(3).values = sHead;
  let sr = 3;
  for (const inv of sorted) {
    sr++;
    const kategori = Array.from(new Set(inv.lines.map((l) => kategoriOf(l.mrpId, l.warna, l.lengan)).filter(Boolean)));
    sum.getRow(sr).values = [
      inv.id,
      vendorName(inv),
      Array.from(new Set(inv.lines.map((l) => l.mrpId))).join(", "),
      kategori.join(", ") || "—",
      inv.lines.reduce((n, l) => n + l.qty, 0),
      inv.totalTagihan,
      vendorInvoiceAdjustmentTotal(inv, "DENDA"),
      vendorInvoiceAdjustmentTotal(inv, "REWARD"),
      vendorInvoiceFinalAmount(inv),
      vendorInvoiceBadge(inv.status).label,
      vendorInvoicePaymentStatus(inv).label,
      dateCell(inv.submittedAt),
      dateCell(inv.approvedAt),
      inv.approvedBy ?? "",
      dateCell(inv.paidAt),
      inv.paidBy ?? "",
    ];
  }
  styleSheet(sum, 3, sHead.length, sr, [], [5, 6, 7, 8, 9], [12, 13, 15], [14, 16, 12, 28, 12, 14, 12, 12, 15, 13, 14, 13, 14, 20, 13, 20]);

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
