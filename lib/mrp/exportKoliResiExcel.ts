import type { Workbook, Worksheet } from "exceljs";
import type { DeliveryKoli, DeliveryKoliItem, ProductionBatch } from "./types";

// Unduh Excel rincian koli per resi (Procurement > Invoice Ekspedisi, owner 2026-11-06): satu file per resi, sheet pertama "Ringkasan" berisi daftar koli
// (berat, total qty), lalu SATU SHEET PER KOLI berisi semua item di dalamnya (jenis produk, warna, lengan, size/usia, code roll asal, qty).
// Total tiap sheet ditulis sebagai rumus SUM supaya bisa ditelusuri; nilai hasil ikut disimpan supaya tampil juga di Protected View.

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
const dateText = (iso?: string) => (iso ? new Date(iso).toLocaleDateString("id-ID", { day: "2-digit", month: "2-digit", year: "numeric" }) : "—");

type CellValue = string | number | null | { formula: string; result: number };

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

function styleBody(ws: Worksheet, rowNo: number, idx: number, fmts: (string | null)[], bold = false, fillArgb?: string) {
  const row = ws.getRow(rowNo);
  row.height = 18;
  fmts.forEach((fmt, i) => {
    const cell = row.getCell(i + 1);
    cell.font = { name: FONT, size: 10, bold, color: { argb: INK } };
    cell.border = BORDER;
    cell.alignment = { vertical: "middle", horizontal: fmt ? "right" : "left" };
    if (fmt) cell.numFmt = fmt;
    const bg = fillArgb ?? (idx % 2 === 1 ? ZEBRA : undefined);
    if (bg) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: bg } };
  });
}

function setRow(ws: Worksheet, rowNo: number, vals: CellValue[]) {
  vals.forEach((v, c) => {
    ws.getCell(rowNo, c + 1).value = v !== null && typeof v === "object" ? { formula: v.formula, result: v.result } : v;
  });
}

function titleBlock(ws: Worksheet, cols: number, title: string, subtitle: string) {
  ws.mergeCells(1, 1, 1, cols);
  ws.getCell(1, 1).value = title;
  ws.getCell(1, 1).font = { name: FONT, size: 15, bold: true, color: { argb: INK } };
  ws.getRow(1).height = 26;
  ws.mergeCells(2, 1, 2, cols);
  ws.getCell(2, 1).value = subtitle;
  ws.getCell(2, 1).font = { name: FONT, size: 9, italic: true, color: { argb: MUTED } };
  ws.getCell(2, 1).alignment = { wrapText: true, vertical: "top" };
  ws.getRow(2).height = 24;
}

/** Nama sheet Excel: maksimal 31 karakter, tanpa \ / ? * [ ] :, dan harus unik dalam satu file. */
function sheetName(raw: string, used: Set<string>): string {
  const base = (raw.replace(/[\\/?*[\]:]/g, "-").trim() || "Koli").slice(0, 28);
  let name = base;
  let n = 2;
  while (used.has(name.toLowerCase())) name = `${base.slice(0, 26)}-${n++}`;
  used.add(name.toLowerCase());
  return name;
}

const koliLabel = (k: DeliveryKoli) => k.noKoli || k.id;

export type KoliResiExcelInput = {
  noResi: string;
  ekspedisi: string;
  vendorName: string;
  mrpIds: string[];
  kolis: DeliveryKoli[];
  batches: ProductionBatch[];
};

export async function buildKoliResiWorkbook(input: KoliResiExcelInput): Promise<Workbook> {
  const ExcelJS = (await import("exceljs")).default;
  const wb: Workbook = new ExcelJS.Workbook();
  wb.creator = "Mini ERP Tigalapan";
  wb.created = new Date();
  wb.calcProperties.fullCalcOnLoad = true;

  const stamp = new Date().toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" });
  const rollOf = (it: DeliveryKoliItem) => {
    if (!it.sourceBatchId) return "—";
    const b = input.batches.find((x) => x.id === it.sourceBatchId);
    return b?.codeRoll ?? b?.kode ?? it.sourceBatchId;
  };
  const kolis = [...input.kolis].sort((a, b) => koliLabel(a).localeCompare(koliLabel(b), "id-ID", { numeric: true }));
  const used = new Set<string>(["ringkasan"]);
  const names = new Map<string, string>(); // id koli -> nama sheet
  for (const k of kolis) names.set(k.id, sheetName("Koli " + koliLabel(k), used));
  const qtyOf = (k: DeliveryKoli) => k.items.reduce((s, it) => s + it.qty, 0);

  // ---------- Sheet "Ringkasan" ----------
  const sum = wb.addWorksheet("Ringkasan", { views: [{ showGridLines: false }] });
  sum.columns = [{ width: 14 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 18 }, { width: 40 }];
  titleBlock(sum, 6, `Rincian Koli — Resi ${input.noResi}`, `Diunduh ${stamp} · Tiap koli punya sheet sendiri (lihat tab di bawah) berisi item, warna, lengan, size, code roll asal, dan qty.`);
  const info: [string, string][] = [
    ["No Resi", input.noResi],
    ["Ekspedisi", input.ekspedisi || "—"],
    ["Vendor", input.vendorName],
    ["No MRP", input.mrpIds.join(", ") || "—"],
    ["Jumlah Koli", String(kolis.length)],
  ];
  info.forEach(([label, value], i) => {
    const r = 4 + i;
    const l = sum.getCell(r, 1);
    l.value = label;
    l.font = { name: FONT, size: 10, bold: true, color: { argb: INK } };
    l.fill = { type: "pattern", pattern: "solid", fgColor: { argb: SOFT } };
    l.border = BORDER;
    sum.mergeCells(r, 2, r, 4);
    const v = sum.getCell(r, 2);
    v.value = value;
    v.font = { name: FONT, size: 10, color: { argb: INK } };
    for (let c = 2; c <= 4; c++) sum.getCell(r, c).border = BORDER;
  });
  const HEAD = 4 + info.length + 1;
  styleHeader(sum, HEAD, [
    { text: "No Koli", numeric: false },
    { text: "Tgl Kirim", numeric: false },
    { text: "Berat (kg)", numeric: true },
    { text: "Jumlah Varian", numeric: true },
    { text: "Total Qty (pcs)", numeric: true },
    { text: "Sheet", numeric: false },
  ]);
  kolis.forEach((k, i) => {
    const r = HEAD + 1 + i;
    const varian = new Set(k.items.map((it) => [it.kind ?? "FG", it.warna, it.lengan, it.size, it.usia ?? ""].join("|"))).size;
    setRow(sum, r, [koliLabel(k), dateText(k.deliveredAt), k.beratKoli ?? null, varian, qtyOf(k), names.get(k.id) ?? ""]);
    styleBody(sum, r, i, [null, null, "#,##0.##", FMT_INT, FMT_INT, null]);
    // tautan ke sheet koli
    sum.getCell(r, 6).value = { text: names.get(k.id) ?? "", hyperlink: `#'${names.get(k.id)}'!A1` };
    sum.getCell(r, 6).font = { name: FONT, size: 10, color: { argb: "FF1D4ED8" }, underline: true };
  });
  if (kolis.length > 0) {
    const first = HEAD + 1;
    const last = HEAD + kolis.length;
    const T = last + 1;
    setRow(sum, T, [
      "Total",
      null,
      { formula: `SUM(C${first}:C${last})`, result: kolis.reduce((s, k) => s + (k.beratKoli ?? 0), 0) },
      null,
      { formula: `SUM(E${first}:E${last})`, result: kolis.reduce((s, k) => s + qtyOf(k), 0) },
      "",
    ]);
    styleBody(sum, T, 0, [null, null, "#,##0.##", null, FMT_INT, null], true, TOTAL_BG);
  }

  // ---------- Satu sheet per koli ----------
  for (const k of kolis) {
    const ws = wb.addWorksheet(names.get(k.id) ?? "Koli", { views: [{ showGridLines: false }] });
    ws.columns = [{ width: 16 }, { width: 28 }, { width: 12 }, { width: 14 }, { width: 18 }, { width: 14 }];
    titleBlock(ws, 6, `Isi Koli ${koliLabel(k)} — Resi ${input.noResi}`, `${k.mrpId} · ${input.vendorName} · ${input.ekspedisi || "—"} · kirim ${dateText(k.deliveredAt)} · ${k.beratKoli ? k.beratKoli + " kg" : "berat belum diisi"} · diunduh ${stamp}`);
    const H = 4;
    styleHeader(ws, H, [
      { text: "Jenis Produk", numeric: false },
      { text: "Warna", numeric: false },
      { text: "Lengan", numeric: false },
      { text: "Size / Usia", numeric: false },
      { text: "Code Roll Asal", numeric: false },
      { text: "Qty (pcs)", numeric: true },
    ]);
    const items = [...k.items].sort(
      (a, b) =>
        kindRank(a.kind ?? "FG") - kindRank(b.kind ?? "FG") ||
        a.warna.localeCompare(b.warna, "id-ID") ||
        (a.lengan === b.lengan ? 0 : a.lengan === "PENDEK" ? -1 : 1) ||
        cmpSize(a.size, b.size) ||
        rollOf(a).localeCompare(rollOf(b), "id-ID", { numeric: true })
    );
    items.forEach((it, i) => {
      const r = H + 1 + i;
      setRow(ws, r, [kindLabel(it.kind), it.warna, lenganLabel(it.lengan), it.size + (it.usia ? " · " + usiaLabel(it.usia) : ""), rollOf(it), it.qty]);
      styleBody(ws, r, i, [null, null, null, null, null, FMT_INT]);
    });
    if (items.length === 0) {
      ws.mergeCells(H + 1, 1, H + 1, 6);
      ws.getCell(H + 1, 1).value = "Koli ini belum berisi item.";
      ws.getCell(H + 1, 1).font = { name: FONT, size: 10, italic: true, color: { argb: MUTED } };
    } else {
      const last = H + items.length;
      const T = last + 1;
      setRow(ws, T, ["Total", null, null, null, null, { formula: `SUM(F${H + 1}:F${last})`, result: qtyOf(k) }]);
      styleBody(ws, T, 0, [null, null, null, null, null, FMT_INT], true, TOTAL_BG);
      ws.autoFilter = { from: { row: H, column: 1 }, to: { row: last, column: 6 } };
    }
    ws.pageSetup = { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
  }
  sum.pageSetup = { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
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
