import type { Workbook } from "exceljs";
import { LT_TIBA_BY_VENDOR, LT_TIBA_DEFAULT, ltTiba, maxDay } from "./itemEstimates";
import { VENDOR_PRODUKSI } from "./seed";
import type { ItemMrpVendorRow, ItemTrackRow } from "./itemTracking";

// Export Excel Tracking Item (PPIC/SCM, owner 2026-11-07). Sheet utama "PENGIRIMAN" mengikuti contoh "ESTIMASI PENGIRIMAN" owner: satu baris per item x MRP (week) x vendor
// x status pengiriman, kolom tanggal pengiriman / estimasi tiba / qty / no. koli bernomor 1..N (N = pengiriman terbanyak), status, dan catatan. Dua sheet pendukung:
// "Ringkasan per item" dan "Rincian per MRP dan vendor" (qty per posisi proses, tanggal, estimasi). Sel LT, estimasi tiba (tanggal kirim + LT), QTY, dan total ditulis sebagai
// rumus Excel; nilai hasilnya ikut disimpan supaya tampil benar di Protected View.

const INK = "FF1A1A1F";
const ORANGE = "FFFFC000";
const HEAD_BG = "FF2563EB";
const INPUT_INK = "FF1D4ED8";
const LINE = "FFD3D8DF";
const FONT = "Calibri";
const thin = { style: "thin" as const, color: { argb: LINE } };
const BORDER = { top: thin, left: thin, bottom: thin, right: thin };
const FMT_DATE = "dd/mm/yyyy";
const FMT_INT = "#,##0";

const vendorName = (id: string) => (id ? VENDOR_PRODUKSI[id]?.name ?? id : "BELUM DIALOKASIKAN");
const dateOf = (iso?: string): Date | null => {
  if (!iso) return null;
  const [y, m, d] = iso.split("-").map(Number);
  return y && m && d ? new Date(Date.UTC(y, m - 1, d)) : null;
};
const serial = (iso: string) => {
  const d = dateOf(iso);
  return d ? Math.round((d.getTime() - Date.UTC(1899, 11, 30)) / 86400000) : 0;
};
const colLetter = (n: number) => {
  let s = "";
  for (let x = n; x > 0; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(65 + ((x - 1) % 26)) + s;
  return s;
};
const dateList = (dates: string[]) => dates.map((d) => d.split("-").reverse().join("/")).join(", ");

type Seg = { item: string; mrp: string; vendorId: string; dates: string[]; qtys: number[]; kolis: string[]; status: string; note: string };

/** Baris-baris sheet PENGIRIMAN untuk satu item: sudah dikirim, masuk koli, belum dikirim (sudah cutting), lalu belum cutting. */
export function pengirimanSegments(rows: ItemTrackRow[]): Seg[] {
  const out: Seg[] = [];
  for (const r of rows) {
    const sent: Seg[] = [];
    const inKoli: Seg[] = [];
    const pending: Seg[] = [];
    const notCut: Seg[] = [];
    for (const b of r.breakdown) {
      if (!b.vendorProduksi) continue; // target yang belum dialokasikan ke vendor belum punya rencana kirim
      const base = { item: r.itemName, mrp: b.mrpId, vendorId: b.vendorProduksi };
      if (b.shipments.length > 0) {
        const recv = [b.diterima > 0 ? `Diterima DC ${b.diterima} pcs` : "", b.tibaDc > 0 ? `tiba DC belum validasi ${b.tibaDc} pcs` : ""].filter(Boolean).join(", ");
        sent.push({ ...base, dates: b.shipments.map((s) => s.date), qtys: b.shipments.map((s) => s.qty), kolis: b.shipments.map((s) => s.koli.join(", ")), status: "SUDAH DIKIRIM", note: recv });
      }
      if (b.diKoli > 0) {
        inKoli.push({
          ...base,
          dates: b.estKirimFg ? [b.estKirimFg] : [],
          qtys: [b.diKoli],
          kolis: [b.inKoli.join(", ")],
          status: "MASUK KOLI, BELUM DIKIRIM",
          note: (b.estKirimFg ? "Tanggal asumsi (Est. Kirim)." : "Tanggal belum bisa diperkirakan (belum ada tanggal FG).") + " Sudah masuk koli, belum dikirim.",
        });
      }
      const wip = b.cuttingWip + b.fgWip;
      if (wip > 0) {
        const date = maxDay(b.cuttingWip > 0 ? b.estKirimCut : undefined, b.fgWip > 0 ? b.estKirimFg : undefined);
        const formula = ["Cutting", b.reject > 0 ? "Reject" : "", b.diKoli > 0 ? "Di koli" : "", b.dikirim > 0 ? "Dikirim" : ""].filter(Boolean).join(" - ");
        pending.push({
          ...base,
          dates: date ? [date] : [],
          qtys: [wip],
          kolis: [""],
          status: "BELUM DIKIRIM",
          note: (date ? "Tanggal asumsi (Est. Kirim)." : "Tanggal belum bisa diperkirakan (belum ada tanggal cutting/FG).") + ` QTY = ${formula}.`,
        });
      }
      if (b.belumCutting > 0) {
        notCut.push({
          ...base,
          dates: [],
          qtys: [b.belumCutting],
          kolis: [""],
          status: "BELUM DIKIRIM",
          note: `Belum cutting, QTY = Target MRP${b.cutting > 0 ? " - Cutting" : ""}. Tanggal kirim belum bisa diperkirakan.`,
        });
      }
    }
    out.push(...sent, ...inKoli, ...pending, ...notCut);
  }
  return out;
}

function pengirimanSheet(wb: Workbook, rows: ItemTrackRow[]) {
  const segs = pengirimanSegments(rows);
  const N = Math.max(1, ...segs.map((s) => s.dates.length));
  const ws = wb.addWorksheet("PENGIRIMAN", { views: [{ state: "frozen", xSplit: 4, ySplit: 2 }] });
  const dateCol = (i: number) => 5 + i; // tanggal pengiriman
  const tibaCol = (i: number) => 5 + N + i; // estimasi tiba
  const qtyCol = (i: number) => 5 + 2 * N + i;
  const koliCol = (i: number) => 5 + 3 * N + i;
  const statusCol = 6 + 4 * N;
  const noteCol = statusCol + 1;

  ws.getCell(1, 1).value = "FREKUENSI PENGIRIMAN";
  ws.getCell(1, 2).value = N;
  ws.getCell(1, 3).value = "KALI";
  const vendorRule = Object.entries(LT_TIBA_BY_VENDOR).map(([id, d]) => `${vendorName(id)} ${d} hari`).join(", ");
  ws.getCell(1, 5).value = `LT (hari) = lama kirim sampai tiba di DC: ${vendorRule ? vendorRule + ", " : ""}vendor lain ${LT_TIBA_DEFAULT} hari. Tanggal estimasi tiba = tanggal pengiriman aktual + LT (kosong untuk baris yang belum dikirim).`;
  ws.getCell(1, 5).font = { name: FONT, size: 9, italic: true, color: { argb: "FF6B7280" } };
  for (const c of [1, 2, 3]) ws.getCell(1, c).font = { name: FONT, size: 11, bold: true, color: { argb: INK } };

  const heads = ["ITEM", "WEEK (NO. PO)", "VENDOR", "LT (HARI)", "QTY"];
  for (let i = 1; i <= N; i++) heads[dateCol(i) - 1] = `TANGGAL PENGIRIMAN_${i}`;
  for (let i = 1; i <= N; i++) heads[tibaCol(i) - 1] = `TANGGAL ESTIMASI TIBA_${i}`;
  for (let i = 1; i <= N; i++) heads[qtyCol(i) - 1] = `QTY_${i}`;
  for (let i = 1; i <= N; i++) heads[koliCol(i) - 1] = `NO. KOLI_${i}`;
  heads[statusCol - 1] = "STATUS";
  heads[noteCol - 1] = "CATATAN";
  const widths: number[] = [28, 14, 24, 10, 9];
  for (let i = 1; i <= N; i++) widths[dateCol(i) - 1] = 18;
  for (let i = 1; i <= N; i++) widths[tibaCol(i) - 1] = 22;
  for (let i = 1; i <= N; i++) widths[qtyCol(i) - 1] = 8;
  for (let i = 1; i <= N; i++) widths[koliCol(i) - 1] = 18;
  widths[statusCol - 1] = 28;
  widths[noteCol - 1] = 70;
  ws.columns = widths.map((w) => ({ width: w }));
  heads.forEach((h, i) => {
    const cell = ws.getCell(2, i + 1);
    cell.value = h;
    cell.font = { name: FONT, size: 10, bold: true, color: { argb: INK } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: ORANGE } };
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    cell.border = BORDER;
  });
  ws.getRow(2).height = 32;

  const FIRST = 3;
  segs.forEach((s, idx) => {
    const r = FIRST + idx;
    const lt = ltTiba(s.vendorId);
    const put = (c: number, v: unknown, fmt?: string, input = false) => {
      const cell = ws.getCell(r, c);
      cell.value = v as never;
      cell.font = { name: FONT, size: 10, color: { argb: input ? INPUT_INK : INK } };
      cell.border = BORDER;
      if (fmt) cell.numFmt = fmt;
    };
    put(1, s.item);
    put(2, s.mrp);
    put(3, vendorName(s.vendorId));
    put(4, lt, undefined, true);
    const qtyFirst = colLetter(qtyCol(1));
    const qtyLast = colLetter(qtyCol(N));
    put(5, { formula: `SUM(${qtyFirst}${r}:${qtyLast}${r})`, result: s.qtys.reduce((a, b) => a + b, 0) }, FMT_INT);
    for (let i = 1; i <= N; i++) {
      const d = s.dates[i - 1];
      const dLetter = colLetter(dateCol(i));
      put(dateCol(i), d ? dateOf(d) : null, FMT_DATE, true);
      // Estimasi tiba hanya untuk pengiriman yang benar-benar sudah terjadi; tanggal pada baris belum dikirim hanyalah asumsi kirim (owner 2026-11-07).
      if (s.status === "SUDAH DIKIRIM") put(tibaCol(i), { formula: `IF(${dLetter}${r}="","",${dLetter}${r}+$D${r})`, result: d ? serial(d) + lt : "" }, FMT_DATE);
      else put(tibaCol(i), null, FMT_DATE);
      put(qtyCol(i), s.qtys[i - 1] ?? null, FMT_INT, true);
      put(koliCol(i), s.kolis[i - 1] || null, undefined, true);
    }
    put(statusCol, s.status);
    put(noteCol, s.note || null);
    ws.getRow(r).height = 16;
  });
  const LAST = FIRST + segs.length - 1;
  if (segs.length > 0) {
    ws.autoFilter = { from: { row: 2, column: 1 }, to: { row: LAST, column: noteCol } };
    const T = LAST + 2;
    ws.getCell(T, 1).value = "TOTAL";
    ws.getCell(T, 1).font = { name: FONT, size: 10, bold: true, color: { argb: INK } };
    const subtotal = (col: number, total: number) => {
      const L = colLetter(col);
      const cell = ws.getCell(T, col);
      cell.value = { formula: `SUBTOTAL(9,${L}${FIRST}:${L}${LAST})`, result: total };
      cell.numFmt = FMT_INT;
      cell.font = { name: FONT, size: 10, bold: true, color: { argb: INK } };
    };
    subtotal(5, segs.reduce((a, s) => a + s.qtys.reduce((x, y) => x + y, 0), 0));
    for (let i = 1; i <= N; i++) subtotal(qtyCol(i), segs.reduce((a, s) => a + (s.qtys[i - 1] ?? 0), 0));
  }
  ws.pageSetup = { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
}

type Col<T> = { head: string; width: number; value: (r: T) => string | number | Date | null; fmt?: string };

function tableSheet<T>(wb: Workbook, name: string, title: string, cols: Col<T>[], rows: T[]) {
  const ws = wb.addWorksheet(name, { views: [{ state: "frozen", xSplit: 1, ySplit: 3 }] });
  ws.columns = cols.map((c) => ({ width: c.width }));
  ws.getCell(1, 1).value = title;
  ws.getCell(1, 1).font = { name: FONT, size: 14, bold: true, color: { argb: INK } };
  const HEAD = 3;
  cols.forEach((c, i) => {
    const cell = ws.getCell(HEAD, i + 1);
    cell.value = c.head;
    cell.font = { name: FONT, size: 10, bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEAD_BG } };
    cell.alignment = { vertical: "middle", horizontal: c.fmt === FMT_INT ? "right" : "left", wrapText: true };
    cell.border = BORDER;
  });
  ws.getRow(HEAD).height = 32;
  rows.forEach((r, idx) => {
    cols.forEach((c, i) => {
      const cell = ws.getCell(HEAD + 1 + idx, i + 1);
      cell.value = c.value(r);
      cell.font = { name: FONT, size: 10, color: { argb: INK } };
      cell.border = BORDER;
      if (c.fmt) cell.numFmt = c.fmt;
    });
  });
  if (rows.length > 0) ws.autoFilter = { from: { row: HEAD, column: 1 }, to: { row: HEAD + rows.length, column: cols.length } };
  ws.pageSetup = { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
}

type Stage = ItemTrackRow | ItemMrpVendorRow;
const shipDates = (r: Stage) => dateList("breakdown" in r ? r.shipDates : r.shipments.map((s) => s.date));
/** Kolom qty dan tanggal. Est. Tiba DC hanya di ringkasan per item; di rincian per MRP dan vendor estimasi tiba tidak ditampilkan (owner 2026-11-07). */
const stageCols = <T extends Stage>(withTiba: boolean): Col<T>[] => [
  { head: "Target MRP", width: 11, fmt: FMT_INT, value: (r) => ("breakdown" in r ? r.target : r.alokasi) },
  { head: "Belum Cutting", width: 11, fmt: FMT_INT, value: (r) => r.belumCutting },
  { head: "Tgl Good Receive", width: 14, fmt: FMT_DATE, value: (r) => dateOf(r.grAt) },
  { head: "Cutting (belum FG)", width: 11, fmt: FMT_INT, value: (r) => r.cuttingWip },
  { head: "Tgl Awal Cutting", width: 13, fmt: FMT_DATE, value: (r) => dateOf(r.cuttingAt) },
  { head: "Est. FG", width: 13, fmt: FMT_DATE, value: (r) => dateOf(r.estFg) },
  { head: "Finish Good (belum masuk koli)", width: 14, fmt: FMT_INT, value: (r) => r.fgWip },
  { head: "Tgl Awal FG", width: 13, fmt: FMT_DATE, value: (r) => dateOf(r.fgFirstAt) },
  { head: "Reject", width: 9, fmt: FMT_INT, value: (r) => r.reject },
  { head: "Di Koli (belum dikirim)", width: 12, fmt: FMT_INT, value: (r) => r.diKoli },
  { head: "Tgl Awal Di Koli", width: 13, fmt: FMT_DATE, value: (r) => dateOf(r.koliFirstAt) },
  { head: "Est. Kirim", width: 13, fmt: FMT_DATE, value: (r) => dateOf(r.estKirim) },
  { head: "Tanggal Kirim", width: 24, value: shipDates },
  { head: "Tgl Kirim Terakhir", width: 13, fmt: FMT_DATE, value: (r) => dateOf(r.shipLastAt) },
  { head: "Dikirim (belum tiba)", width: 12, fmt: FMT_INT, value: (r) => r.perjalanan },
  ...(withTiba ? [{ head: "Est. Tiba DC", width: 13, fmt: FMT_DATE, value: (r: T) => dateOf(r.estTiba) } as Col<T>] : []),
  { head: "Tiba DC (belum validasi)", width: 12, fmt: FMT_INT, value: (r) => r.tibaDc },
  { head: "Diterima DC", width: 11, fmt: FMT_INT, value: (r) => r.diterima },
  { head: "Tgl Diterima DC", width: 14, fmt: FMT_DATE, value: (r) => dateOf(r.receivedAt) },
  { head: "No. Koli Diterima", width: 20, value: (r) => r.receivedKoli.join(", ") || null },
  { head: "Total Cutting (kumulatif)", width: 12, fmt: FMT_INT, value: (r) => r.cutting },
  { head: "Total FG (kumulatif)", width: 12, fmt: FMT_INT, value: (r) => r.fg },
  { head: "Total Dikirim (kumulatif)", width: 12, fmt: FMT_INT, value: (r) => r.dikirim },
];

export type TrackingExportInput = { rows: ItemTrackRow[]; filterLabel?: string };

export async function buildTrackingWorkbook(input: TrackingExportInput): Promise<Workbook> {
  const ExcelJS = (await import("exceljs")).default;
  const wb: Workbook = new ExcelJS.Workbook();
  wb.creator = "Mini ERP Tigalapan";
  wb.created = new Date();
  wb.calcProperties.fullCalcOnLoad = true;
  const stamp = new Date().toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" });
  const note = `Diunduh ${stamp}${input.filterLabel ? " · " + input.filterLabel : ""}`;

  pengirimanSheet(wb, input.rows);
  tableSheet<ItemTrackRow>(
    wb,
    "Ringkasan per item",
    `Ringkasan per item · qty per posisi proses (tidak tumpang tindih) · ${note}`,
    [
      { head: "Item", width: 28, value: (r) => r.itemName },
      { head: "Kategori", width: 14, value: (r) => r.kategori.join(", ") },
      ...stageCols<ItemTrackRow>(true),
    ],
    input.rows
  );
  const detail = input.rows.flatMap((r) => r.breakdown.map((b) => ({ item: r, cell: b })));
  tableSheet<{ item: ItemTrackRow; cell: ItemMrpVendorRow }>(
    wb,
    "Rincian per MRP dan vendor",
    `Rincian per MRP dan vendor · ${note}`,
    [
      { head: "Item", width: 28, value: (r) => r.item.itemName },
      { head: "No. MRP", width: 10, value: (r) => r.cell.mrpId },
      { head: "Vendor", width: 22, value: (r) => vendorName(r.cell.vendorProduksi) },
      { head: "Kategori", width: 14, value: (r) => r.cell.kategori },
      ...stageCols<ItemMrpVendorRow>(false).map((c) => ({ ...c, value: (r: { item: ItemTrackRow; cell: ItemMrpVendorRow }) => c.value(r.cell) })),
    ],
    detail
  );
  return wb;
}

export async function exportTrackingExcel(input: TrackingExportInput, fileName: string): Promise<void> {
  const wb = await buildTrackingWorkbook(input);
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

