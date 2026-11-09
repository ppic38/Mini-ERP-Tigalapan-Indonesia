import type { CellFormulaValue, CellValue as XlsxCellValue, Workbook, Worksheet } from "exceljs";
import { VENDOR_PRODUKSI } from "./seed";
import type { WarehouseReceivableGroup } from "./derive";

// Unduh Excel per resi (Warehouse > Penerimaan, owner 2026-11-04): satu file per batch pengiriman (resi) berisi dua sheet --
//  - "Rincian Item": satu baris per isi koli (koli, warna, lengan, size, jenis, qty, HPP/item, nilai HPP), blok info resi di atas.
//  - "Ringkasan Item": satu baris per warna · lengan · size, dijumlahkan lewat rumus SUMIFS dari sheet Rincian.
// Kolom terakhir "Item (MOKA)" (owner 2026-11-09) = nama item format MOKA "WARNA PDK/PJG SIZE" di kedua sheet.
// Header berwarna biru (sama dengan tema ERP), baris berselang-seling, angka berformat. Nilai HPP, total, dan ringkasan ditulis sebagai rumus
// Excel supaya bisa ditelusuri; nilai tersimpan di tiap rumus sama dengan hasil hitung aplikasi. HPP/item berasal dari data HPP Finance
// (hppRowsForInvoicePerRoll) -- "Estimasi" = roll bahan belum ditutup.

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
const FMT_RP = '"Rp" #,##0';
const FMT_RP_DASH = '"Rp" #,##0;-"Rp" #,##0;"—"';

const SIZE_ORDER = ["XXS", "XS", "S", "M", "L", "XL", "2XL", "3XL", "4XL", "5XL", "6XL"];
const sizeRank = (s: string) => {
  const i = SIZE_ORDER.indexOf(s.toUpperCase());
  return i === -1 ? 999 : i;
};
const cmpSize = (a: string, b: string) => sizeRank(a) - sizeRank(b) || a.localeCompare(b, "id-ID", { numeric: true });
const cmpLengan = (a: string, b: string) => (a === b ? 0 : a === "PENDEK" ? -1 : 1);
const lenganLabel = (l: string) => (l === "PENDEK" ? "Pendek" : "Panjang");
const itemMokaOf = (warna: string, lengan: string, size: string) => `${warna} ${lengan === "PENDEK" ? "PDK" : "PJG"} ${size}`;
const jenisLabel = (k: string) => (k === "FG" ? "Finish Good" : k === "REWORK" ? "Rework" : "Reject");

type CellValue = string | number | null | { formula: string; result: string | number | null };
const f = (formula: string, result: string | number | null): CellValue => ({ formula, result });
const toXlsx = (v: CellValue): XlsxCellValue => (v !== null && typeof v === "object" ? ({ formula: v.formula, result: v.result ?? undefined } as CellFormulaValue) : v);

function styleHeader(ws: Worksheet, rowNo: number, heads: { text: string; numeric: boolean }[]) {
  const row = ws.getRow(rowNo);
  row.height = 28;
  heads.forEach((h, i) => {
    const cell = row.getCell(i + 1);
    cell.value = h.text;
    cell.font = { name: FONT, size: 10, bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEAD_BG } };
    cell.alignment = { vertical: "middle", horizontal: h.numeric ? "right" : "left", wrapText: true, indent: h.numeric ? 2 : 0 };
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

export async function buildResiWorkbook(group: WarehouseReceivableGroup): Promise<Workbook> {
  const ExcelJS = (await import("exceljs")).default;
  const wb: Workbook = new ExcelJS.Workbook();
  wb.creator = "Mini ERP Tigalapan";
  wb.created = new Date();
  wb.calcProperties.fullCalcOnLoad = true;

  const noResi = group.noResi ?? group.resiGroupId;
  const vendor = VENDOR_PRODUKSI[group.vendorProduksi]?.name ?? group.vendorProduksi;
  const stamp = new Date().toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" });

  // Baris item: koli (angka dulu), warna, lengan, size, lalu jenis (FG, Rework, Reject).
  const kindRank = (k: string) => (k === "FG" ? 0 : k === "REWORK" ? 1 : 2);
  const items = [...group.items].sort(
    (a, b) =>
      (a.noKoli ?? a.deliveryKoliId).localeCompare(b.noKoli ?? b.deliveryKoliId, "id-ID", { numeric: true }) ||
      a.warna.localeCompare(b.warna, "id-ID") ||
      cmpLengan(a.lengan, b.lengan) ||
      cmpSize(a.size, b.size) ||
      kindRank(a.kind) - kindRank(b.kind)
  );
  const hasHpp = (it: (typeof items)[number]) => it.kind !== "REJECT" && it.hppPerItem > 0;

  // ---------- Sheet 1: Rincian Item ----------
  const rin = wb.addWorksheet("Rincian Item", { views: [{ showGridLines: false }] });
  const RIN = "'Rincian Item'";
  rin.columns = [{ width: 20 }, { width: 26 }, { width: 12 }, { width: 10 }, { width: 14 }, { width: 14 }, { width: 18 }, { width: 20 }, { width: 22 }, { width: 32 }];
  rin.mergeCells(1, 1, 1, 9);
  rin.getCell(1, 1).value = `Penerimaan Warehouse — Resi ${noResi}`;
  rin.getCell(1, 1).font = { name: FONT, size: 15, bold: true, color: { argb: INK } };
  rin.getRow(1).height = 26;
  rin.mergeCells(2, 1, 2, 9);
  rin.getCell(2, 1).value = `Diunduh ${stamp} · HPP/item dari data HPP Finance; "Estimasi" = roll bahan belum ditutup, angkanya masih bisa berubah. Nilai HPP = Qty x HPP/item (rumus).`;
  rin.getCell(2, 1).font = { name: FONT, size: 9, italic: true, color: { argb: MUTED } };
  rin.getCell(2, 1).alignment = { wrapText: true, vertical: "top" };
  rin.getRow(2).height = 28;

  const status = group.gateReason ?? "Siap dibongkar";
  const info: [string, string][] = [
    ["No Resi", noResi],
    ["Ekspedisi", group.ekspedisi || "—"],
    ["Tanggal Kirim", group.deliveredAt ? new Date(group.deliveredAt).toLocaleDateString("id-ID", { day: "2-digit", month: "2-digit", year: "numeric" }) : "—"],
    ["No MRP", group.mrpLabel || group.mrpId],
    ["Vendor Produksi", vendor],
    ["No Koli", group.noKoli],
    ["No Invoice Vendor", group.invoiceIds.length > 0 ? group.invoiceIds.join(", ") : "—"],
    ["Status", status],
    ["Status WMS", group.wmsReceivedAt ? `Diterima WMS · ${new Date(group.wmsReceivedAt).toLocaleDateString("id-ID")}` : "Belum dikonfirmasi WMS"],
  ];
  const INFO_FIRST = 4;
  info.forEach(([label, value], i) => {
    const r = INFO_FIRST + i;
    const l = rin.getCell(r, 1);
    l.value = label;
    l.font = { name: FONT, size: 10, bold: true, color: { argb: INK } };
    l.fill = { type: "pattern", pattern: "solid", fgColor: { argb: SOFT } };
    l.border = BORDER;
    l.alignment = { vertical: "middle" };
    rin.mergeCells(r, 2, r, 5);
    const v = rin.getCell(r, 2);
    v.value = value;
    v.font = { name: FONT, size: 10, color: { argb: label === "Status" && group.gateReason ? "FFB91C1C" : INK }, bold: label === "Status" };
    v.alignment = { vertical: "middle", wrapText: true };
    for (let c = 2; c <= 5; c++) rin.getCell(r, c).border = BORDER;
  });

  const HEAD_ROW = INFO_FIRST + info.length + 1;
  const FIRST = HEAD_ROW + 1;
  styleHeader(rin, HEAD_ROW, [
    { text: "No Koli", numeric: false },
    { text: "Warna", numeric: false },
    { text: "Lengan", numeric: false },
    { text: "Size", numeric: false },
    { text: "Jenis", numeric: false },
    { text: "Qty (pcs)", numeric: true },
    { text: "HPP / item", numeric: true },
    { text: "Nilai HPP", numeric: true },
    { text: "Catatan", numeric: false },
    { text: "Item (MOKA)", numeric: false },
  ]);
  let totalQty = 0;
  let totalNilai = 0;
  items.forEach((it, i) => {
    const r = FIRST + i;
    const hpp = hasHpp(it) ? it.hppPerItem : null;
    const nilai = hpp != null ? it.qty * hpp : null;
    totalQty += it.qty;
    if (nilai != null) totalNilai += nilai;
    const note = it.kind === "REJECT" ? "Reject (tanpa HPP)" : hpp == null ? "HPP belum tersedia" : it.sementara ? "Estimasi" : "";
    const vals: CellValue[] = [
      "Koli " + (it.noKoli ?? it.deliveryKoliId),
      it.warna,
      lenganLabel(it.lengan),
      it.size,
      jenisLabel(it.kind),
      it.qty,
      hpp,
      nilai == null ? null : f(`F${r}*G${r}`, nilai),
      note,
      itemMokaOf(it.warna, it.lengan, it.size),
    ];
    vals.forEach((v, c) => {
      rin.getCell(r, c + 1).value = toXlsx(v);
    });
    styleBody(rin, r, i, [null, null, null, null, null, FMT_INT, FMT_RP, FMT_RP, null, null]);
    // Sel masukan (angka dari data) biru, sel rumus hitam -- konsisten dengan unduhan Laporan HPP.
    for (const c of [6, 7]) rin.getCell(r, c).font = { name: FONT, size: 10, color: { argb: "FF1D4ED8" } };
    if (it.sementara && hpp != null) rin.getCell(r, 9).font = { name: FONT, size: 10, bold: true, color: { argb: "FFB45309" } };
  });
  const LAST = FIRST + items.length - 1;
  const TOTAL_ROW = LAST + 1;
  const totalCells: CellValue[] = ["Total", null, null, null, null, items.length > 0 ? f(`SUM(F${FIRST}:F${LAST})`, totalQty) : 0, null, items.length > 0 ? f(`SUM(H${FIRST}:H${LAST})`, totalNilai) : 0, "", ""];
  totalCells.forEach((v, c) => {
    rin.getCell(TOTAL_ROW, c + 1).value = toXlsx(v);
  });
  styleBody(rin, TOTAL_ROW, 0, [null, null, null, null, null, FMT_INT, null, FMT_RP, null, null], true, TOTAL_BG);
  if (items.length > 0) rin.autoFilter = { from: { row: HEAD_ROW, column: 1 }, to: { row: LAST, column: 10 } };
  rin.pageSetup = { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 };

  // ---------- Sheet 2: Ringkasan Item ----------
  const sum = wb.addWorksheet("Ringkasan Item", { views: [{ showGridLines: false }] });
  sum.columns = [{ width: 26 }, { width: 12 }, { width: 10 }, { width: 16 }, { width: 14 }, { width: 14 }, { width: 16 }, { width: 20 }, { width: 22 }, { width: 32 }];
  sum.mergeCells(1, 1, 1, 9);
  sum.getCell(1, 1).value = `Ringkasan per warna · lengan · size — Resi ${noResi}`;
  sum.getCell(1, 1).font = { name: FONT, size: 15, bold: true, color: { argb: INK } };
  sum.getRow(1).height = 26;
  sum.mergeCells(2, 1, 2, 9);
  sum.getCell(2, 1).value = "Dijumlahkan dari sheet Rincian Item lewat rumus SUMIFS. HPP/item rata-rata = Total HPP / (Finish Good + Rework); reject tidak punya HPP.";
  sum.getCell(2, 1).font = { name: FONT, size: 9, italic: true, color: { argb: MUTED } };
  sum.getRow(2).height = 18;
  styleHeader(sum, 4, [
    { text: "Warna", numeric: false },
    { text: "Lengan", numeric: false },
    { text: "Size", numeric: false },
    { text: "Finish Good", numeric: true },
    { text: "Rework", numeric: true },
    { text: "Reject", numeric: true },
    { text: "Total Qty", numeric: true },
    { text: "Total HPP", numeric: true },
    { text: "HPP / item rata-rata", numeric: true },
    { text: "Item (MOKA)", numeric: false },
  ]);
  const groups = new Map<string, { warna: string; lengan: string; size: string; fg: number; rw: number; rj: number; nilai: number }>();
  for (const it of items) {
    const k = it.warna + "|" + it.lengan + "|" + it.size;
    const g = groups.get(k) ?? { warna: it.warna, lengan: it.lengan, size: it.size, fg: 0, rw: 0, rj: 0, nilai: 0 };
    if (it.kind === "FG") g.fg += it.qty;
    else if (it.kind === "REWORK") g.rw += it.qty;
    else g.rj += it.qty;
    if (hasHpp(it)) g.nilai += it.qty * it.hppPerItem;
    groups.set(k, g);
  }
  const lines = Array.from(groups.values()).sort((a, b) => a.warna.localeCompare(b.warna, "id-ID") || cmpLengan(a.lengan, b.lengan) || cmpSize(a.size, b.size));
  const rng = (col: string) => `${RIN}!$${col}$${FIRST}:$${col}$${Math.max(LAST, FIRST)}`;
  const S_FIRST = 5;
  lines.forEach((g, i) => {
    const r = S_FIRST + i;
    const crit = `${rng("B")},$A${r},${rng("C")},$B${r},${rng("D")},$C${r}`;
    const total = g.fg + g.rw + g.rj;
    const hppPcs = g.fg + g.rw > 0 ? g.nilai / (g.fg + g.rw) : 0;
    const vals: CellValue[] = [
      g.warna,
      lenganLabel(g.lengan),
      g.size,
      f(`SUMIFS(${rng("F")},${crit},${rng("E")},"Finish Good")`, g.fg),
      f(`SUMIFS(${rng("F")},${crit},${rng("E")},"Rework")`, g.rw),
      f(`SUMIFS(${rng("F")},${crit},${rng("E")},"Reject")`, g.rj),
      f(`SUM(D${r}:F${r})`, total),
      f(`SUMIFS(${rng("H")},${crit})`, g.nilai),
      f(`IFERROR(H${r}/(D${r}+E${r}),0)`, hppPcs),
      itemMokaOf(g.warna, g.lengan, g.size),
    ];
    vals.forEach((v, c) => {
      sum.getCell(r, c + 1).value = toXlsx(v);
    });
    styleBody(sum, r, i, [null, null, null, FMT_INT, FMT_INT, FMT_INT, FMT_INT, FMT_RP_DASH, FMT_RP_DASH, null]);
  });
  if (lines.length > 0) {
    const S_LAST = S_FIRST + lines.length - 1;
    const T = S_LAST + 1;
    const sumOf = (pick: (g: (typeof lines)[number]) => number) => lines.reduce((s, g) => s + pick(g), 0);
    const tFg = sumOf((g) => g.fg);
    const tRw = sumOf((g) => g.rw);
    const tNilai = sumOf((g) => g.nilai);
    const cells: CellValue[] = [
      "Total",
      null,
      null,
      f(`SUM(D${S_FIRST}:D${S_LAST})`, tFg),
      f(`SUM(E${S_FIRST}:E${S_LAST})`, tRw),
      f(`SUM(F${S_FIRST}:F${S_LAST})`, sumOf((g) => g.rj)),
      f(`SUM(G${S_FIRST}:G${S_LAST})`, sumOf((g) => g.fg + g.rw + g.rj)),
      f(`SUM(H${S_FIRST}:H${S_LAST})`, tNilai),
      f(`IFERROR(H${T}/(D${T}+E${T}),0)`, tFg + tRw > 0 ? tNilai / (tFg + tRw) : 0),
      "",
    ];
    cells.forEach((v, c) => {
      sum.getCell(T, c + 1).value = toXlsx(v);
    });
    styleBody(sum, T, 0, [null, null, null, FMT_INT, FMT_INT, FMT_INT, FMT_INT, FMT_RP, FMT_RP, null], true, TOTAL_BG);
    sum.autoFilter = { from: { row: 4, column: 1 }, to: { row: S_LAST, column: 10 } };
  }
  sum.pageSetup = { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
  return wb;
}

export async function exportResiExcel(group: WarehouseReceivableGroup, fileName: string): Promise<void> {
  const wb = await buildResiWorkbook(group);
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
