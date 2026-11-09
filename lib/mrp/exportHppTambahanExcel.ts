import type { Workbook, Worksheet } from "exceljs";
import type { HppReportRow } from "./hppReport";

// Template HPP + biaya tambahan (owner 2026-11-09), terutama untuk barang yang dikirim Konveksi Makassar: biaya yang tidak ada di mesin HPP (benang, label size,
// label merek, hangtag, kemasan, dll.) diisi di Excel dan otomatis ditambahkan ke HPP yang SUDAH dihitung sistem. Satu file, satu sheet per PO (No MRP), dengan
// blok isian biaya tambahan per pcs di atas (nilai itu dipakai semua baris) dan tabel per resi x item; tiap baris bisa menimpa nilai biayanya sendiri.
// Sel BIRU = masukan (data sistem dan isian), sel HITAM = rumus. HPP baru/pcs = HPP sistem/pcs + total tambahan/pcs.

export const BIAYA_TAMBAHAN = ["Benang", "Label Size", "Label Merek", "Hangtag", "Plastik / Kemasan", "Lainnya"] as const;

const INK = "FF1A1A1F";
const INPUT_INK = "FF1D4ED8";
const HEAD_BG = "FF2563EB";
const EXTRA_BG = "FFD97706";
const NEW_BG = "FF047857";
const SOFT = "FFF0F3F6";
const TOTAL_BG = "FFDBEAFE";
const MUTED = "FF6B7280";
const LINE = "FFD3D8DF";
const FONT = "Calibri";
const thin = { style: "thin" as const, color: { argb: LINE } };
const BORDER = { top: thin, left: thin, bottom: thin, right: thin };
const FMT_INT = "#,##0";
const FMT_RP = '"Rp" #,##0';
const FMT_RP2 = '"Rp" #,##0.00';
const FMT_DATE = "dd/mm/yyyy";

export type HppTambahanLine = {
  mrpId: string;
  status: "On Going" | "Final";
  noResi: string;
  tanggalKirim?: string;
  noKoli: string;
  warna: string;
  lengan: string;
  size: string;
  qty: number;
  /** HPP sistem per pcs (rata-rata tertimbang FG baris yang digabung). */
  hppPcs: number;
};

const SIZE_ORDER = ["XXS", "XS", "S", "M", "L", "XL", "2XL", "3XL", "4XL", "5XL", "6XL"];
const sizeRank = (s: string) => {
  const i = SIZE_ORDER.indexOf(s.toUpperCase());
  return i === -1 ? 999 : i;
};
const itemMokaOf = (l: Pick<HppTambahanLine, "warna" | "lengan" | "size">) => `${l.warna} ${l.lengan === "PENDEK" ? "PDK" : "PJG"} ${l.size}`;
const lenganLabel = (l: string) => (l === "PENDEK" ? "Pendek" : "Panjang");
const dateOf = (iso?: string): Date | null => {
  const s = (iso ?? "").slice(0, 10);
  const [y, m, d] = s.split("-").map(Number);
  return y && m && d ? new Date(Date.UTC(y, m - 1, d)) : null;
};
const colLetter = (n: number) => {
  let s = "";
  for (let x = n; x > 0; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(65 + ((x - 1) % 26)) + s;
  return s;
};

/** Satu baris per PO x status (On Going / Final) x resi x item (warna, lengan, size): qty = jumlah FG, HPP/pcs = rata-rata tertimbang qty. Hanya barang yang SUDAH dikirim
 *  (baris HPP berasal dari koli yang sudah di-Delivery); baris tanpa koli (data lama) memakai resi "—". */
export function hppTambahanLines(rows: HppReportRow[]): HppTambahanLine[] {
  const merged = new Map<string, HppTambahanLine & { w: number; koli: Set<string> }>();
  for (const r of rows) {
    if (!(r.fg > 0)) continue;
    const status = r.sementara ? "On Going" : "Final";
    const noResi = r.noResi ?? "";
    const key = [r.mrpId, status, noResi, r.warna, r.lengan, r.size].join("|");
    const cur = merged.get(key) ?? {
      mrpId: r.mrpId,
      status,
      noResi,
      tanggalKirim: r.tanggalKirim,
      noKoli: "",
      warna: r.warna,
      lengan: r.lengan,
      size: r.size,
      qty: 0,
      hppPcs: 0,
      w: 0,
      koli: new Set<string>(),
    };
    cur.qty += r.fg;
    cur.w += r.hppPerItem * r.fg;
    if (r.noKoli) cur.koli.add(r.noKoli);
    merged.set(key, cur);
  }
  return Array.from(merged.values())
    .map(({ w, koli, ...l }) => ({ ...l, hppPcs: l.qty > 0 ? w / l.qty : 0, noKoli: Array.from(koli).sort((a, b) => a.localeCompare(b, "id-ID", { numeric: true })).join(", ") }))
    .sort(
      (a, b) =>
        a.mrpId.localeCompare(b.mrpId, "id-ID", { numeric: true }) ||
        (a.tanggalKirim ?? "").localeCompare(b.tanggalKirim ?? "") ||
        a.noResi.localeCompare(b.noResi, "id-ID", { numeric: true }) ||
        a.warna.localeCompare(b.warna, "id-ID") ||
        (a.lengan === b.lengan ? 0 : a.lengan === "PENDEK" ? -1 : 1) ||
        sizeRank(a.size) - sizeRank(b.size)
    );
}

function sheetName(raw: string, used: Set<string>): string {
  const base = (raw.replace(/[\\/?*[\]:]/g, "-").trim() || "PO").slice(0, 28);
  let name = base;
  let n = 2;
  while (used.has(name.toLowerCase())) name = `${base.slice(0, 26)}-${n++}`;
  used.add(name.toLowerCase());
  return name;
}

type SheetTotals = { sheet: string; mrpId: string; totalRow: number };

function poSheet(wb: Workbook, name: string, mrpId: string, vendor: string, lines: HppTambahanLine[], stamp: string): SheetTotals {
  const ws: Worksheet = wb.addWorksheet(name, { views: [{ showGridLines: false }] });
  const COLS = 19; // A..S
  ws.columns = [
    { width: 24 }, // A status / label isian
    { width: 14 }, // B no resi / nilai isian
    { width: 12 }, // C tgl kirim
    { width: 30 }, // D item moka
    { width: 16 }, // E warna
    { width: 9 }, // F lengan
    { width: 7 }, // G size
    { width: 10 }, // H qty
    { width: 14 }, // I hpp sistem/pcs
    { width: 16 }, // J nilai hpp sistem
    { width: 11 }, // K..P biaya
    { width: 11 },
    { width: 12 },
    { width: 10 },
    { width: 12 },
    { width: 10 },
    { width: 14 }, // Q tambahan/pcs
    { width: 14 }, // R hpp baru/pcs
    { width: 17 }, // S nilai hpp baru
  ];
  ws.mergeCells(1, 1, 1, COLS);
  ws.getCell(1, 1).value = `Template HPP + Biaya Tambahan — ${vendor} — PO ${mrpId}`;
  ws.getCell(1, 1).font = { name: FONT, size: 15, bold: true, color: { argb: INK } };
  ws.getRow(1).height = 26;
  ws.mergeCells(2, 1, 2, COLS);
  ws.getCell(2, 1).value = `Diunduh ${stamp} · HPP sistem = HPP/pcs dari Laporan HPP (bahan + rib + maklon + ongkir), hanya barang yang sudah dikirim; "On Going" = roll bahan belum ditutup (angka bisa berubah). Isi biaya tambahan per pcs di kotak biru di bawah: nilainya dipakai semua baris dan boleh ditimpa per baris di kolom oranye. Sel biru = masukan, sel hitam = rumus.`;
  ws.getCell(2, 1).font = { name: FONT, size: 9, italic: true, color: { argb: MUTED } };
  ws.getCell(2, 1).alignment = { wrapText: true, vertical: "top" };
  ws.getRow(2).height = 40;

  // ---- blok isian biaya tambahan per pcs ----
  const IN_HEAD = 4;
  ws.getCell(IN_HEAD, 1).value = "BIAYA TAMBAHAN PER PCS";
  ws.getCell(IN_HEAD, 2).value = "Rp / pcs";
  for (const c of [1, 2]) {
    const cell = ws.getCell(IN_HEAD, c);
    cell.font = { name: FONT, size: 10, bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: EXTRA_BG } };
    cell.border = BORDER;
    cell.alignment = { horizontal: c === 2 ? "right" : "left" };
  }
  const IN_FIRST = IN_HEAD + 1;
  BIAYA_TAMBAHAN.forEach((label, i) => {
    const r = IN_FIRST + i;
    const l = ws.getCell(r, 1);
    l.value = label;
    l.font = { name: FONT, size: 10, color: { argb: INK } };
    l.fill = { type: "pattern", pattern: "solid", fgColor: { argb: SOFT } };
    l.border = BORDER;
    const v = ws.getCell(r, 2);
    v.value = 0;
    v.numFmt = FMT_RP2;
    v.font = { name: FONT, size: 10, color: { argb: INPUT_INK } };
    v.border = BORDER;
    v.alignment = { horizontal: "right" };
  });
  const IN_LAST = IN_FIRST + BIAYA_TAMBAHAN.length - 1;
  const IN_TOTAL = IN_LAST + 1;
  ws.getCell(IN_TOTAL, 1).value = "Total tambahan / pcs";
  ws.getCell(IN_TOTAL, 2).value = { formula: `SUM(B${IN_FIRST}:B${IN_LAST})`, result: 0 };
  ws.getCell(IN_TOTAL, 2).numFmt = FMT_RP2;
  for (const c of [1, 2]) {
    const cell = ws.getCell(IN_TOTAL, c);
    cell.font = { name: FONT, size: 10, bold: true, color: { argb: INK } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: TOTAL_BG } };
    cell.border = BORDER;
  }
  ws.getCell(IN_TOTAL, 2).alignment = { horizontal: "right" };

  // ---- tabel ----
  const HEAD = IN_TOTAL + 2;
  const FIRST = HEAD + 1;
  const heads: { text: string; bg: string; numeric?: boolean }[] = [
    { text: "Status", bg: HEAD_BG },
    { text: "No Resi", bg: HEAD_BG },
    { text: "Tgl Kirim", bg: HEAD_BG },
    { text: "Item (MOKA)", bg: HEAD_BG },
    { text: "Warna", bg: HEAD_BG },
    { text: "Lengan", bg: HEAD_BG },
    { text: "Size", bg: HEAD_BG },
    { text: "Qty (pcs)", bg: HEAD_BG, numeric: true },
    { text: "HPP sistem / pcs", bg: HEAD_BG, numeric: true },
    { text: "Nilai HPP sistem", bg: HEAD_BG, numeric: true },
    ...BIAYA_TAMBAHAN.map((t) => ({ text: t, bg: EXTRA_BG, numeric: true })),
    { text: "Tambahan / pcs", bg: NEW_BG, numeric: true },
    { text: "HPP baru / pcs", bg: NEW_BG, numeric: true },
    { text: "Nilai HPP baru", bg: NEW_BG, numeric: true },
  ];
  heads.forEach((h, i) => {
    const c = ws.getCell(HEAD, i + 1);
    c.value = h.text;
    c.font = { name: FONT, size: 10, bold: true, color: { argb: "FFFFFFFF" } };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: h.bg } };
    c.alignment = { vertical: "middle", horizontal: h.numeric ? "right" : "left", wrapText: true };
    c.border = BORDER;
  });
  ws.getRow(HEAD).height = 32;

  const nExtra = BIAYA_TAMBAHAN.length;
  const K = 11; // kolom pertama biaya tambahan
  const colTambah = K + nExtra; // Q
  const colBaru = colTambah + 1; // R
  const colNilaiBaru = colTambah + 2; // S
  lines.forEach((l, i) => {
    const r = FIRST + i;
    const put = (c: number, v: unknown, fmt?: string, input = false, bold = false) => {
      const cell = ws.getCell(r, c);
      cell.value = v as never;
      cell.font = { name: FONT, size: 10, bold, color: { argb: input ? INPUT_INK : INK } };
      cell.border = BORDER;
      if (fmt) cell.numFmt = fmt;
      if (i % 2 === 1) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF8FAFF" } };
    };
    put(1, l.status + (l.noKoli ? ` · koli ${l.noKoli}` : ""));
    put(2, l.noResi || "—");
    put(3, dateOf(l.tanggalKirim), FMT_DATE);
    put(4, itemMokaOf(l));
    put(5, l.warna);
    put(6, lenganLabel(l.lengan));
    put(7, l.size);
    put(8, l.qty, FMT_INT, true);
    put(9, l.hppPcs, FMT_RP2, true);
    put(10, { formula: `H${r}*I${r}`, result: l.qty * l.hppPcs }, FMT_RP);
    BIAYA_TAMBAHAN.forEach((_, j) => put(K + j, { formula: `$B$${IN_FIRST + j}`, result: 0 }, FMT_RP2));
    put(colTambah, { formula: `SUM(${colLetter(K)}${r}:${colLetter(K + nExtra - 1)}${r})`, result: 0 }, FMT_RP2);
    put(colBaru, { formula: `I${r}+${colLetter(colTambah)}${r}`, result: l.hppPcs }, FMT_RP2, false, true);
    put(colNilaiBaru, { formula: `H${r}*${colLetter(colBaru)}${r}`, result: l.qty * l.hppPcs }, FMT_RP, false, true);
    ws.getRow(r).height = 17;
  });

  const LAST = FIRST + Math.max(lines.length, 1) - 1;
  const TOTAL_ROW = LAST + 2;
  const totalQty = lines.reduce((s, l) => s + l.qty, 0);
  const totalSistem = lines.reduce((s, l) => s + l.qty * l.hppPcs, 0);
  const tot = (c: number, value: unknown, fmt?: string) => {
    const cell = ws.getCell(TOTAL_ROW, c);
    cell.value = value as never;
    cell.font = { name: FONT, size: 10, bold: true, color: { argb: INK } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: TOTAL_BG } };
    cell.border = BORDER;
    if (fmt) cell.numFmt = fmt;
  };
  for (let c = 1; c <= COLS; c++) tot(c, null);
  tot(1, "TOTAL");
  if (lines.length > 0) {
    const sub = (c: number, result: number, fmt: string) => tot(c, { formula: `SUBTOTAL(9,${colLetter(c)}${FIRST}:${colLetter(c)}${LAST})`, result }, fmt);
    sub(8, totalQty, FMT_INT);
    sub(10, totalSistem, FMT_RP);
    sub(colNilaiBaru, totalSistem, FMT_RP);
    tot(9, { formula: `IFERROR(J${TOTAL_ROW}/H${TOTAL_ROW},0)`, result: totalQty > 0 ? totalSistem / totalQty : 0 }, FMT_RP2);
    tot(colBaru, { formula: `IFERROR(${colLetter(colNilaiBaru)}${TOTAL_ROW}/H${TOTAL_ROW},0)`, result: totalQty > 0 ? totalSistem / totalQty : 0 }, FMT_RP2);
    tot(colTambah, { formula: `${colLetter(colBaru)}${TOTAL_ROW}-I${TOTAL_ROW}`, result: 0 }, FMT_RP2);
    ws.autoFilter = { from: { row: HEAD, column: 1 }, to: { row: LAST, column: COLS } };
  } else {
    ws.getCell(FIRST, 1).value = "Belum ada barang terkirim dengan data HPP untuk PO ini.";
    ws.getCell(FIRST, 1).font = { name: FONT, size: 10, italic: true, color: { argb: MUTED } };
  }
  ws.pageSetup = { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
  return { sheet: name, mrpId, totalRow: TOTAL_ROW };
}

export type HppTambahanInput = { vendorLabel: string; lines: HppTambahanLine[] };

export async function buildHppTambahanWorkbook(input: HppTambahanInput): Promise<Workbook> {
  const ExcelJS = (await import("exceljs")).default;
  const wb: Workbook = new ExcelJS.Workbook();
  wb.creator = "Mini ERP Tigalapan";
  wb.created = new Date();
  wb.calcProperties.fullCalcOnLoad = true;
  const stamp = new Date().toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" });
  const byMrp = new Map<string, HppTambahanLine[]>();
  for (const l of input.lines) byMrp.set(l.mrpId, [...(byMrp.get(l.mrpId) ?? []), l]);
  const mrpIds = Array.from(byMrp.keys()).sort((a, b) => b.localeCompare(a, "id-ID", { numeric: true }));

  // Ringkasan dibuat dulu supaya menjadi sheet pertama; isinya diisi sesudah sheet PO tahu baris totalnya.
  const sum = wb.addWorksheet("Ringkasan", { views: [{ showGridLines: false }] });
  const used = new Set<string>(["ringkasan"]);
  const totals = mrpIds.map((id) => poSheet(wb, sheetName(id, used), id, input.vendorLabel, byMrp.get(id) ?? [], stamp));

  sum.columns = [{ width: 20 }, { width: 12 }, { width: 20 }, { width: 20 }, { width: 18 }, { width: 18 }, { width: 18 }];
  sum.mergeCells(1, 1, 1, 7);
  sum.getCell(1, 1).value = `Ringkasan HPP + Biaya Tambahan — ${input.vendorLabel}`;
  sum.getCell(1, 1).font = { name: FONT, size: 15, bold: true, color: { argb: INK } };
  sum.getRow(1).height = 26;
  sum.mergeCells(2, 1, 2, 7);
  sum.getCell(2, 1).value = `Diunduh ${stamp} · angka diambil dari baris TOTAL tiap sheet PO (ikut berubah saat biaya tambahan diisi).`;
  sum.getCell(2, 1).font = { name: FONT, size: 9, italic: true, color: { argb: MUTED } };
  const heads = ["PO (No MRP)", "Qty (pcs)", "Nilai HPP sistem", "Nilai HPP baru", "HPP sistem / pcs", "HPP baru / pcs", "Selisih / pcs"];
  heads.forEach((h, i) => {
    const c = sum.getCell(4, i + 1);
    c.value = h;
    c.font = { name: FONT, size: 10, bold: true, color: { argb: "FFFFFFFF" } };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEAD_BG } };
    c.alignment = { horizontal: i === 0 ? "left" : "right", wrapText: true };
    c.border = BORDER;
  });
  totals.forEach((t, i) => {
    const r = 5 + i;
    const q = `'${t.sheet}'!H${t.totalRow}`;
    const lines = byMrp.get(t.mrpId) ?? [];
    const qty = lines.reduce((s, l) => s + l.qty, 0);
    const nilai = lines.reduce((s, l) => s + l.qty * l.hppPcs, 0);
    const cells: { v: unknown; fmt?: string }[] = [
      { v: t.mrpId },
      { v: { formula: q, result: qty }, fmt: FMT_INT },
      { v: { formula: `'${t.sheet}'!J${t.totalRow}`, result: nilai }, fmt: FMT_RP },
      { v: { formula: `'${t.sheet}'!S${t.totalRow}`, result: nilai }, fmt: FMT_RP },
      { v: { formula: `IFERROR(C${r}/B${r},0)`, result: qty > 0 ? nilai / qty : 0 }, fmt: FMT_RP2 },
      { v: { formula: `IFERROR(D${r}/B${r},0)`, result: qty > 0 ? nilai / qty : 0 }, fmt: FMT_RP2 },
      { v: { formula: `F${r}-E${r}`, result: 0 }, fmt: FMT_RP2 },
    ];
    cells.forEach((c, j) => {
      const cell = sum.getCell(r, j + 1);
      cell.value = c.v as never;
      cell.font = { name: FONT, size: 10, color: { argb: INK } };
      cell.border = BORDER;
      if (c.fmt) cell.numFmt = c.fmt;
    });
  });
  if (totals.length === 0) {
    sum.getCell(5, 1).value = "Tidak ada PO dengan data HPP terkirim untuk pilihan ini.";
    sum.getCell(5, 1).font = { name: FONT, size: 10, italic: true, color: { argb: MUTED } };
  } else {
    const T = 5 + totals.length;
    const first = 5;
    const last = T - 1;
    const allQty = input.lines.reduce((s, l) => s + l.qty, 0);
    const allNilai = input.lines.reduce((s, l) => s + l.qty * l.hppPcs, 0);
    const cells: { v: unknown; fmt?: string }[] = [
      { v: "TOTAL" },
      { v: { formula: `SUM(B${first}:B${last})`, result: allQty }, fmt: FMT_INT },
      { v: { formula: `SUM(C${first}:C${last})`, result: allNilai }, fmt: FMT_RP },
      { v: { formula: `SUM(D${first}:D${last})`, result: allNilai }, fmt: FMT_RP },
      { v: { formula: `IFERROR(C${T}/B${T},0)`, result: allQty > 0 ? allNilai / allQty : 0 }, fmt: FMT_RP2 },
      { v: { formula: `IFERROR(D${T}/B${T},0)`, result: allQty > 0 ? allNilai / allQty : 0 }, fmt: FMT_RP2 },
      { v: { formula: `F${T}-E${T}`, result: 0 }, fmt: FMT_RP2 },
    ];
    cells.forEach((c, j) => {
      const cell = sum.getCell(T, j + 1);
      cell.value = c.v as never;
      cell.font = { name: FONT, size: 10, bold: true, color: { argb: INK } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: TOTAL_BG } };
      cell.border = BORDER;
      if (c.fmt) cell.numFmt = c.fmt;
    });
  }
  return wb;
}

export async function exportHppTambahanExcel(input: HppTambahanInput, fileName: string): Promise<void> {
  const wb = await buildHppTambahanWorkbook(input);
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
