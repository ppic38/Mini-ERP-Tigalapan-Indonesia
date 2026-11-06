import type { Workbook, Worksheet } from "exceljs";
import type { DeliveryKoli } from "./types";

// Unduh Excel rincian koli per resi (Procurement > Invoice Ekspedisi). Revisi 2026-11-06 (owner): SATU sheet saja berisi semua koli, supaya bisa difilter dan
// dipivot; tanpa kolom roll, jadi satu koli = satu baris per jenis produk, warna, lengan, size (usia) -- qty dari beberapa roll dijumlahkan.
// Total di bawah memakai SUBTOTAL(109) sehingga ikut berubah saat tabel difilter.

const INK = "FF1A1A1F";
const HEAD_BG = "FF2563EB";
const SOFT = "FFF0F3F6";
const ZEBRA = "FFF8FAFF";
const TOTAL_BG = "FFDBEAFE";
const MUTED = "FF6B7280";
const LINE = "FFD3D8DF";
const FONT = "Calibri";
const thin = { style: "thin" as const, color: { argb: LINE } };
const BORDER = { top: thin, left: thin, bottom: thin, right: thin };
const FMT_INT = "#,##0";

const SIZE_ORDER = ["XXS", "XS", "S", "M", "L", "XL", "2XL", "3XL", "4XL", "5XL", "6XL"];
const sizeRank = (s: string) => {
  const i = SIZE_ORDER.indexOf(s.toUpperCase());
  return i === -1 ? 999 : i;
};
const cmpSize = (a: string, b: string) => sizeRank(a) - sizeRank(b) || a.localeCompare(b, "id-ID", { numeric: true });
const kindRank = (k: string) => (k === "FG" ? 0 : k === "REWORK" ? 1 : 2);
const kindLabel = (k: string | undefined) => (k === "REWORK" ? "Rework" : k === "REJECT" ? "Reject" : "Finish Good");
const lenganLabel = (l: string) => (l === "PENDEK" ? "Pendek" : l === "PANJANG" ? "Panjang" : l);
const usiaLabel = (u: string | undefined) => (u === "KIDS" ? "Kids" : u === "DEWASA" ? "Dewasa" : "");
const koliLabel = (k: DeliveryKoli) => k.noKoli || k.id;

export type KoliResiExcelInput = {
  noResi: string;
  ekspedisi: string;
  vendorName: string;
  mrpIds: string[];
  kolis: DeliveryKoli[];
};

type Line = { noKoli: string; kind: string; warna: string; lengan: string; size: string; usia: string; qty: number };

/** Satu baris per koli x jenis produk x warna x lengan x size x usia (qty dari beberapa roll dijumlahkan). */
export function koliResiLines(kolis: DeliveryKoli[]): Line[] {
  const merged = new Map<string, Line>();
  for (const k of kolis) {
    for (const it of k.items) {
      const kind = it.kind ?? "FG";
      const key = [k.id, kind, it.warna, it.lengan, it.size, it.usia ?? ""].join("|");
      const cur = merged.get(key);
      if (cur) cur.qty += it.qty;
      else merged.set(key, { noKoli: koliLabel(k), kind, warna: it.warna, lengan: it.lengan, size: it.size, usia: it.usia ?? "", qty: it.qty });
    }
  }
  return Array.from(merged.values()).sort(
    (a, b) =>
      a.noKoli.localeCompare(b.noKoli, "id-ID", { numeric: true }) ||
      kindRank(a.kind) - kindRank(b.kind) ||
      a.warna.localeCompare(b.warna, "id-ID") ||
      (a.lengan === b.lengan ? 0 : a.lengan === "PENDEK" ? -1 : 1) ||
      cmpSize(a.size, b.size)
  );
}

function styleHeader(ws: Worksheet, rowNo: number, heads: { text: string; numeric: boolean }[]) {
  const row = ws.getRow(rowNo);
  row.height = 26;
  heads.forEach((h, i) => {
    const cell = row.getCell(i + 1);
    cell.value = h.text;
    cell.font = { name: FONT, size: 10, bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEAD_BG } };
    cell.alignment = { vertical: "middle", horizontal: h.numeric ? "right" : "left", wrapText: true, indent: h.numeric ? 1 : 0 };
    cell.border = BORDER;
  });
}

export async function buildKoliResiWorkbook(input: KoliResiExcelInput): Promise<Workbook> {
  const ExcelJS = (await import("exceljs")).default;
  const wb: Workbook = new ExcelJS.Workbook();
  wb.creator = "Mini ERP Tigalapan";
  wb.created = new Date();
  wb.calcProperties.fullCalcOnLoad = true;

  const stamp = new Date().toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" });
  const lines = koliResiLines(input.kolis);
  const COLS = 7;

  const ws = wb.addWorksheet("Rincian Koli", { views: [{ showGridLines: false }] });
  ws.columns = [{ width: 12 }, { width: 16 }, { width: 28 }, { width: 12 }, { width: 14 }, { width: 14 }, { width: 14 }];
  ws.mergeCells(1, 1, 1, COLS);
  ws.getCell(1, 1).value = `Rincian Koli — Resi ${input.noResi}`;
  ws.getCell(1, 1).font = { name: FONT, size: 15, bold: true, color: { argb: INK } };
  ws.getRow(1).height = 26;
  ws.mergeCells(2, 1, 2, COLS);
  ws.getCell(2, 1).value = `Diunduh ${stamp} · Satu baris per koli dan size (qty dari beberapa roll sudah dijumlahkan). Gunakan filter di judul kolom; baris Total mengikuti filter.`;
  ws.getCell(2, 1).font = { name: FONT, size: 9, italic: true, color: { argb: MUTED } };
  ws.getCell(2, 1).alignment = { wrapText: true, vertical: "top" };
  ws.getRow(2).height = 24;

  const info: [string, string][] = [
    ["No Resi", input.noResi],
    ["Ekspedisi", input.ekspedisi || "—"],
    ["Vendor", input.vendorName],
    ["No MRP", input.mrpIds.join(", ") || "—"],
    ["Jumlah Koli", String(input.kolis.length)],
  ];
  info.forEach(([label, value], i) => {
    const r = 4 + i;
    const l = ws.getCell(r, 1);
    l.value = label;
    l.font = { name: FONT, size: 10, bold: true, color: { argb: INK } };
    l.fill = { type: "pattern", pattern: "solid", fgColor: { argb: SOFT } };
    l.border = BORDER;
    ws.mergeCells(r, 2, r, 4);
    const v = ws.getCell(r, 2);
    v.value = value;
    v.font = { name: FONT, size: 10, color: { argb: INK } };
    for (let c = 2; c <= 4; c++) ws.getCell(r, c).border = BORDER;
  });

  const HEAD = 4 + info.length + 1;
  styleHeader(ws, HEAD, [
    { text: "No Koli", numeric: false },
    { text: "Jenis Produk", numeric: false },
    { text: "Warna", numeric: false },
    { text: "Lengan", numeric: false },
    { text: "Size", numeric: false },
    { text: "Usia", numeric: false },
    { text: "Qty (pcs)", numeric: true },
  ]);
  lines.forEach((ln, i) => {
    const r = HEAD + 1 + i;
    const vals = [ln.noKoli, kindLabel(ln.kind), ln.warna, lenganLabel(ln.lengan), ln.size, usiaLabel(ln.usia), ln.qty];
    vals.forEach((v, c) => {
      const cell = ws.getCell(r, c + 1);
      cell.value = v;
      cell.font = { name: FONT, size: 10, color: { argb: INK } };
      cell.border = BORDER;
      cell.alignment = { vertical: "middle", horizontal: c === 6 ? "right" : "left" };
      if (c === 6) cell.numFmt = FMT_INT;
      if (i % 2 === 1) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: ZEBRA } };
    });
    ws.getRow(r).height = 18;
  });

  const total = lines.reduce((s, ln) => s + ln.qty, 0);
  if (lines.length > 0) {
    const first = HEAD + 1;
    const last = HEAD + lines.length;
    const T = last + 1;
    for (let c = 1; c <= COLS; c++) {
      const cell = ws.getCell(T, c);
      cell.font = { name: FONT, size: 10, bold: true, color: { argb: INK } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: TOTAL_BG } };
      cell.border = BORDER;
    }
    ws.getCell(T, 1).value = "Total";
    ws.getCell(T, 7).value = { formula: `SUBTOTAL(109,G${first}:G${last})`, result: total };
    ws.getCell(T, 7).numFmt = FMT_INT;
    ws.getCell(T, 7).alignment = { horizontal: "right" };
    ws.autoFilter = { from: { row: HEAD, column: 1 }, to: { row: last, column: COLS } };
  } else {
    ws.mergeCells(HEAD + 1, 1, HEAD + 1, COLS);
    ws.getCell(HEAD + 1, 1).value = "Resi ini belum berisi item.";
    ws.getCell(HEAD + 1, 1).font = { name: FONT, size: 10, italic: true, color: { argb: MUTED } };
  }
  ws.views = [{ showGridLines: false, state: "frozen", ySplit: HEAD }];
  ws.pageSetup = { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
  return wb;
}

export async function exportKoliResiExcel(input: KoliResiExcelInput, fileName: string): Promise<void> {
  const wb = await buildKoliResiWorkbook(input);
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
