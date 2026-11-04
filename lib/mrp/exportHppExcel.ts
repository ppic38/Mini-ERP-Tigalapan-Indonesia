import type { CellFormulaValue, Workbook, Worksheet } from "exceljs";
import { VENDOR_PRODUKSI } from "./seed";
import type { HppItemLine, HppReport, HppRollLine } from "./hppReport";

// Unduh Laporan HPP per MRP (template CAL HPP ERP, revisi 2026-11-02): empat sheet -- HPP On Going (estimasi) dan HPP Final (satu baris per
// warna · lengan · size, rata-rata tertimbang), lalu Detail Roll On Going dan Detail Roll Final (satu baris per roll x size). Header berwarna
// (hijau = final, oranye = estimasi), baris header ber-filter dan dibekukan. Angka dihitung di hppRowsForInvoicePerRoll / buildHppReport.
//
// RUMUS EXCEL (owner 2026-11-02: "by formula saat di export jadi bisa ketahuan"): kolom hasil hitung ditulis sebagai rumus yang bisa diklik dan
// ditelusuri, bukan angka mati. Sheet Detail Roll: biaya bahan = berat x harga/kg, porsi diskon = diskon invoice x berat / total kg invoice, porsi rib =
// biaya rib warna x berat / total kg warna, bahan/pcs = (biaya - diskon) / pembagi, COGS = bahan + rib, HPP = COGS + maklon + ongkir, ratio = HPP / harga
// jual. Sheet HPP (per item): rata-rata tertimbang dari sheet Detail Roll lewat SUMPRODUCT. Sel BIRU = data masukan (invoice, master, produksi,
// ekspedisi), sel HITAM = rumus. Nilai tersimpan di tiap rumus sama dengan hasil hitung aplikasi, jadi tampil benar walau belum dihitung ulang.

const INK = "FF1A1A1F";
const INPUT_INK = "FF1D4ED8";
const FINAL_BG = "FF0D9488";
const ESTIMASI_BG = "FFB45309";
const SOFT = "FFF0F3F6";
const LINE = "FFD3D8DF";
const FONT = "Calibri";
const thin = { style: "thin" as const, color: { argb: LINE } };
const BORDER = { top: thin, left: thin, bottom: thin, right: thin };
const FIRST_ROW = 5;

const vendorName = (id: string) => VENDOR_PRODUKSI[id]?.name ?? id;
const lenganLabel = (l: string) => (l === "PENDEK" ? "Pendek" : "Panjang");

type CellValue = string | number | null | { formula: string; result: string | number | null };
type Col = { head: string; width: number; kind: "text" | "int" | "rp" | "dec" | "pct" };

const colLetter = (n: number) => {
  let s = "";
  for (let x = n; x > 0; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(65 + ((x - 1) % 26)) + s;
  return s;
};
const f = (formula: string, result: string | number | null): CellValue => ({ formula, result });

function sheet(wb: Workbook, name: string, bg: string, title: string, note: string, cols: Col[], rows: CellValue[][]): Worksheet {
  const ws = wb.addWorksheet(name, { views: [{ state: "frozen", xSplit: 3, ySplit: 4 }] });
  ws.mergeCells(1, 1, 1, Math.min(cols.length, 9));
  ws.getCell(1, 1).value = title;
  ws.getCell(1, 1).font = { name: FONT, size: 14, bold: true, color: { argb: INK } };
  ws.mergeCells(2, 1, 2, Math.min(cols.length, 14));
  ws.getCell(2, 1).value = note;
  ws.getCell(2, 1).font = { name: FONT, size: 9, italic: true, color: { argb: "FF828290" } };
  ws.getCell(2, 1).alignment = { wrapText: true, vertical: "top" };
  ws.getRow(2).height = 52;
  ws.mergeCells(3, 1, 3, Math.min(cols.length, 9));
  ws.getCell(3, 1).value = "Warna font: BIRU = data masukan (invoice, master, produksi, ekspedisi) · HITAM = rumus Excel (klik sel untuk melihat cara hitungnya)";
  ws.getCell(3, 1).font = { name: FONT, size: 9, bold: true, color: { argb: INPUT_INK } };

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
    const row = ws.getRow(FIRST_ROW + ri);
    cols.forEach((c, ci) => {
      const cell = row.getCell(ci + 1);
      const v = values[ci];
      const isFormula = v !== null && typeof v === "object";
      if (isFormula) cell.value = { formula: v.formula, result: v.result ?? undefined } as CellFormulaValue;
      else cell.value = v ?? (c.kind === "text" ? "" : null);
      const isInput = !isFormula && typeof v === "number";
      cell.font = { name: FONT, size: 10, color: { argb: isInput ? INPUT_INK : INK } };
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

// ---- Sheet Detail Roll: satu baris per roll x size ----
const RC = {
  vendor: 1, warna: 2, lengan: 3, size: 4, roll: 5, invoice: 6, berat: 7, hargaKg: 8, biaya: 9, invDiskon: 10, invKg: 11, diskon: 12, warnaRib: 13, warnaKg: 14,
  rib: 15, pembagi: 16, fg: 17, resi: 18, koli: 19, ongkirResi: 20, beratResi: 21, beratKoli: 22, ongkirKoli: 23, pcsKoli: 24,
  bahan: 25, diskonPcs: 26, ribPcs: 27, cogs: 28, maklon: 29, ongkir: 30, hpp: 31, jual: 32, ratio: 33, total: 34,
} as const;
const ROLL_COLS: Col[] = [
  { head: "Vendor", width: 18, kind: "text" },
  { head: "Warna", width: 24, kind: "text" },
  { head: "Lengan", width: 9, kind: "text" },
  { head: "Size", width: 8, kind: "text" },
  { head: "Code Roll", width: 16, kind: "text" },
  { head: "No Invoice Material", width: 18, kind: "text" },
  { head: "Berat Roll Gross (kg)", width: 12, kind: "dec" },
  { head: "Harga/kg", width: 11, kind: "rp" },
  { head: "Biaya Bahan Roll", width: 15, kind: "rp" },
  { head: "Diskon Invoice (Rp)", width: 13, kind: "rp" },
  { head: "Total kg Kain Invoice", width: 12, kind: "dec" },
  { head: "Diskon (porsi roll)", width: 17, kind: "rp" },
  { head: "Biaya Rib Warna (Rp)", width: 13, kind: "rp" },
  { head: "Total kg Kain Warna", width: 12, kind: "dec" },
  { head: "Rib (porsi roll)", width: 17, kind: "rp" },
  { head: "Pembagi (pcs)", width: 10, kind: "int" },
  { head: "Qty FG (pcs)", width: 10, kind: "int" },
  { head: "No Resi", width: 18, kind: "text" },
  { head: "No Koli", width: 14, kind: "text" },
  { head: "Ongkir Resi (Rp)", width: 15, kind: "rp" },
  { head: "Berat Resi (kg)", width: 13, kind: "dec" },
  { head: "Berat Koli (kg)", width: 11, kind: "dec" },
  { head: "Ongkir Koli (Rp)", width: 19, kind: "rp" },
  { head: "Pcs di Koli", width: 10, kind: "int" },
  { head: "Bahan/pcs", width: 18, kind: "rp" },
  { head: "Diskon/pcs", width: 13, kind: "rp" },
  { head: "Rib/pcs", width: 12, kind: "rp" },
  { head: "COGS Bahan/pcs", width: 14, kind: "rp" },
  { head: "Maklon/pcs", width: 11, kind: "rp" },
  { head: "Ongkir/pcs", width: 18, kind: "rp" },
  { head: "HPP/pcs", width: 17, kind: "rp" },
  { head: "Harga Jual", width: 11, kind: "rp" },
  { head: "Ratio HPP", width: 14, kind: "pct" },
  { head: "Total HPP (Rp)", width: 16, kind: "rp" },
];

function rollRow(r: HppRollLine, rowNo: number): CellValue[] {
  const c = (k: keyof typeof RC) => colLetter(RC[k]) + rowNo;
  // Baris yang bisa ditelusuri ke roll di invoice material memakai rumus penuh; baris rework / data lama tanpa roll hanya punya angka akhir.
  const traced = r.grossKg != null && r.hargaPerKg != null && r.invKg != null && r.warnaKg != null && r.invDiskon != null && r.warnaRib != null && !!r.pembagi && r.pembagi > 0;
  const out: CellValue[] = new Array(ROLL_COLS.length).fill(null);
  const set = (k: keyof typeof RC, v: CellValue) => {
    out[RC[k] - 1] = v;
  };
  set("vendor", vendorName(r.vendor));
  set("warna", r.warna);
  set("lengan", lenganLabel(r.lengan));
  set("size", r.size);
  set("roll", r.roll);
  set("invoice", r.invoiceMaterial);
  set("berat", r.grossKg);
  set("hargaKg", r.hargaPerKg);
  set("invDiskon", r.invDiskon);
  set("invKg", r.invKg);
  set("warnaRib", r.warnaRib);
  set("warnaKg", r.warnaKg);
  set("pembagi", r.pembagi);
  set("fg", r.fg);
  set("resi", r.resi);
  set("koli", r.koli);
  set("maklon", r.maklonPcs);
  set("jual", r.hargaJual);
  // Ongkir/pcs rumus kalau baris ini bisa ditelusuri ke satu koli; baris pool lama tanpa koli tetap angka akhir.
  if (r.ongkirResi != null && r.beratResi != null && r.beratKoli != null && r.pcsKoli != null) {
    set("ongkirResi", r.ongkirResi);
    set("beratResi", r.beratResi);
    set("beratKoli", r.beratKoli);
    set("pcsKoli", r.pcsKoli);
    set("ongkirKoli", f(`IF(${c("beratResi")}=0,0,${c("ongkirResi")}*${c("beratKoli")}/${c("beratResi")})`, r.ongkirPcs * r.pcsKoli));
    set("ongkir", f(`IF(${c("pcsKoli")}=0,0,${c("ongkirKoli")}/${c("pcsKoli")})`, r.ongkirPcs));
  } else {
    set("ongkir", r.ongkirPcs);
  }
  if (traced) {
    set("biaya", f(`${c("berat")}*${c("hargaKg")}`, r.biayaBahanRoll));
    set("diskon", f(`IF(${c("invKg")}=0,0,${c("invDiskon")}*${c("berat")}/${c("invKg")})`, r.diskonRoll));
    set("rib", f(`IF(${c("warnaKg")}=0,0,${c("warnaRib")}*${c("berat")}/${c("warnaKg")})`, r.ribRoll));
    set("bahan", f(`(${c("biaya")}-${c("diskon")})/${c("pembagi")}`, r.bahanPcs));
    set("diskonPcs", f(`${c("diskon")}/${c("pembagi")}`, r.diskonPcs));
    set("ribPcs", f(`${c("rib")}/${c("pembagi")}`, r.ribPcs));
    set("cogs", f(`${c("bahan")}+${c("ribPcs")}`, r.cogsBahanPcs));
  } else {
    set("biaya", r.biayaBahanRoll);
    set("diskon", r.diskonRoll);
    set("rib", r.ribRoll);
    set("bahan", r.bahanPcs);
    set("diskonPcs", r.diskonPcs);
    set("ribPcs", r.ribPcs);
    set("cogs", r.cogsBahanPcs);
  }
  set("hpp", f(`${c("cogs")}+${c("maklon")}+${c("ongkir")}`, r.hppPcs));
  set("ratio", f(`IF(${c("jual")}>0,${c("hpp")}/${c("jual")},"")`, r.ratio ?? ""));
  set("total", f(`${c("hpp")}*${c("fg")}`, r.totalHpp));
  return out;
}

// ---- Sheet HPP (per item): rata-rata tertimbang dari sheet Detail Roll pasangannya ----
const IC = { warna: 1, lengan: 2, size: 3, vendor: 4, fg: 5, bahan: 6, rib: 7, cogs: 8, maklon: 9, ongkir: 10, hpp: 11, min: 12, max: 13, jual: 14, ratio: 15, total: 16, roll: 17, resi: 18 } as const;
const ITEM_COLS: Col[] = [
  { head: "Warna", width: 24, kind: "text" },
  { head: "Lengan", width: 9, kind: "text" },
  { head: "Size", width: 8, kind: "text" },
  { head: "Vendor", width: 18, kind: "text" },
  { head: "Qty FG (pcs)", width: 14, kind: "int" },
  { head: "Bahan/pcs (setelah diskon)", width: 16, kind: "rp" },
  { head: "Rib/pcs", width: 13, kind: "rp" },
  { head: "COGS Bahan/pcs", width: 14, kind: "rp" },
  { head: "Maklon/pcs", width: 14, kind: "rp" },
  { head: "Ongkir/pcs", width: 14, kind: "rp" },
  { head: "HPP/pcs", width: 17, kind: "rp" },
  { head: "HPP Min", width: 15, kind: "rp" },
  { head: "HPP Maks", width: 15, kind: "rp" },
  { head: "Harga Jual", width: 14, kind: "rp" },
  { head: "Ratio HPP", width: 13, kind: "pct" },
  { head: "Total HPP (Rp)", width: 16, kind: "rp" },
  { head: "Jumlah Roll", width: 9, kind: "int" },
  { head: "Jumlah Resi", width: 9, kind: "int" },
];

function itemRow(i: HppItemLine, rowNo: number, detailSheet: string, detailRows: number): CellValue[] {
  const rng = (k: keyof typeof RC) => `'${detailSheet}'!$${colLetter(RC[k])}$${FIRST_ROW}:$${colLetter(RC[k])}$${FIRST_ROW + detailRows - 1}`;
  const c = (k: keyof typeof IC) => colLetter(IC[k]) + rowNo;
  const match = `(${rng("warna")}=$A${rowNo})*(${rng("lengan")}=$B${rowNo})*(${rng("size")}=$C${rowNo})`;
  const weighted = (k: keyof typeof RC) => `IF(${c("fg")}=0,0,SUMPRODUCT(${match}*${rng(k)}*${rng("fg")})/${c("fg")})`;
  const out: CellValue[] = new Array(ITEM_COLS.length).fill(null);
  const set = (k: keyof typeof IC, v: CellValue) => {
    out[IC[k] - 1] = v;
  };
  set("warna", i.warna);
  set("lengan", lenganLabel(i.lengan));
  set("size", i.size);
  set("vendor", i.vendors.map(vendorName).join(", "));
  set("fg", f(`SUMPRODUCT(${match}*${rng("fg")})`, i.fg));
  set("bahan", f(weighted("bahan"), i.bahanPcs));
  set("rib", f(weighted("ribPcs"), i.ribPcs));
  set("cogs", f(`${c("bahan")}+${c("rib")}`, i.cogsBahanPcs));
  set("maklon", f(weighted("maklon"), i.maklonPcs));
  set("ongkir", f(weighted("ongkir"), i.ongkirPcs));
  set("hpp", f(`${c("cogs")}+${c("maklon")}+${c("ongkir")}`, i.hppPcs));
  // MIN/MAX bersyarat tanpa fungsi baru (MINIFS/AGGREGATE butuh Excel 2010+ dan awalan khusus di berkas): SUMPRODUCT memaksa hitung larik di semua versi.
  set("min", f(`SUMPRODUCT(MIN(${rng("hpp")}+(1-${match})*1E+12))`, i.hppMin));
  set("max", f(`SUMPRODUCT(MAX(${match}*${rng("hpp")}))`, i.hppMax));
  set("jual", f(`IFERROR(SUMPRODUCT(${match}*${rng("jual")}*${rng("fg")})/SUMPRODUCT(${match}*(${rng("jual")}>0)*${rng("fg")}),"")`, i.hargaJual ?? ""));
  set("ratio", f(`IF(AND(ISNUMBER(${c("jual")}),${c("jual")}>0),${c("hpp")}/${c("jual")},"")`, i.ratio ?? ""));
  set("total", f(`SUMPRODUCT(${match}*${rng("total")})`, i.totalHpp));
  set("roll", i.jumlahRoll);
  set("resi", i.jumlahResi);
  return out;
}

export async function buildHppWorkbook(mrpId: string, report: HppReport): Promise<Workbook> {
  const ExcelJS = (await import("exceljs")).default;
  const wb: Workbook = new ExcelJS.Workbook();
  wb.creator = "Tigalapan Indonesia";
  wb.created = new Date();
  // Excel menghitung ulang semua rumus saat dibuka (nilai tersimpan hanya cadangan untuk penampil yang tidak menghitung).
  wb.calcProperties.fullCalcOnLoad = true;
  const stamp = new Date().toLocaleString("id-ID");
  const rumus =
    "Rumus per pcs: Bahan = (biaya bahan roll - porsi diskon) / pembagi; Diskon roll = diskon invoice / total kg kain invoice x berat roll; Rib = biaya rib warna / total kg kain warna x berat roll / pembagi; " +
    "COGS Bahan = Bahan + Rib; HPP = COGS Bahan + Maklon + Ongkir; Ratio HPP = HPP / Harga Jual. Maklon/pcs = harga maklon master; Ongkir Resi = tarif ekspedisi master x berat seluruh koli resi, Ongkir Koli = Ongkir Resi x Berat Koli / Berat Resi, Ongkir/pcs = Ongkir Koli / Pcs di Koli (satu baris Detail Roll = satu koli). " +
    "Sheet HPP menghitung rata-rata tertimbang (bobot Qty FG) dari sheet Detail Roll pasangannya.";
  const estimasiNote = `MRP ${mrpId} · diunduh ${stamp} · ESTIMASI: roll yang belum ditutup, pembagi = hasil cutting roll (berubah sampai roll ditutup). ${rumus}`;
  const finalNote = `MRP ${mrpId} · diunduh ${stamp} · FINAL: roll yang sudah ditutup (pembagi = Finish Good aktual), plus baris rework dan data lama tanpa roll. ${rumus}`;

  const groups = [
    { key: "estimasi" as const, bg: ESTIMASI_BG, item: "HPP On Going (Estimasi)", detail: "Detail Roll On Going", itemTitle: "HPP On Going (Estimasi)", detailTitle: "Detail Roll On Going (Estimasi)", note: estimasiNote },
    { key: "final" as const, bg: FINAL_BG, item: "HPP Final", detail: "Detail Roll Final", itemTitle: "HPP Final", detailTitle: "Detail Roll Final", note: finalNote },
  ];
  // Urutan sheet: HPP estimasi, HPP final, detail estimasi, detail final.
  for (const g of groups) {
    const rolls = report[g.key].rolls;
    sheet(wb, g.item, g.bg, `${g.itemTitle} — ${mrpId}`, g.note, ITEM_COLS, report[g.key].items.map((it, ri) => itemRow(it, FIRST_ROW + ri, g.detail, rolls.length)));
  }
  for (const g of groups) {
    sheet(wb, g.detail, g.bg, `${g.detailTitle} — ${mrpId}`, g.note, ROLL_COLS, report[g.key].rolls.map((r, ri) => rollRow(r, FIRST_ROW + ri)));
  }
  // Sheet validasi (owner 2026-11-04): total sumber vs jumlah (nilai per pcs x Qty FG), supaya terlihat kalau per pcs tidak kembali ke totalnya.
  for (const g of groups) {
    addValidasiSheet(wb, {
      name: g.key === "estimasi" ? "Validasi On Going" : "Validasi Final",
      bg: g.bg,
      title: `Validasi ${g.itemTitle} — ${mrpId}`,
      detail: g.detail,
      rolls: report[g.key].rolls,
    });
  }
  return wb;
}

export async function exportHppExcel(mrpId: string, report: HppReport, fileName: string) {
  const wb = await buildHppWorkbook(mrpId, report);
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

// ---- Sheet Validasi: total sumber (pool) vs jumlah (nilai per pcs x Qty FG), owner 2026-11-04 ----
// Tujuan: membuktikan bahwa nilai per pcs di sheet Detail Roll bisa dikembalikan ke total biayanya (bahan, diskon, rib, ongkir), dan kalau tidak
// kembali, menunjukkan DI MANA selisihnya. Semua angka berupa rumus yang membaca sheet Detail Roll pasangannya. Tiga bagian:
//  1) Ringkasan semua komponen, 2) per roll (bahan, diskon, rib), 3) per resi (ongkir).
const DIFF_FMT = "#,##0;[Red]-#,##0";
const GREEN = "FF047857";
const AMBER = "FFB45309";
const TOLERANCE = 1;

type VStyle = { fmt?: string; bold?: boolean; bg?: string; color?: string; align?: "left" | "right" | "center"; wrap?: boolean };

function vput(ws: Worksheet, row: number, col: number, v: CellValue, st: VStyle = {}) {
  const cell = ws.getCell(row, col);
  const isFormula = v !== null && typeof v === "object";
  cell.value = isFormula ? ({ formula: v.formula, result: v.result ?? undefined } as CellFormulaValue) : v;
  cell.font = { name: FONT, size: 10, bold: st.bold, color: { argb: st.color ?? INK } };
  cell.border = BORDER;
  cell.alignment = { vertical: "middle", horizontal: st.align ?? (typeof v === "string" ? "left" : "right"), wrapText: st.wrap };
  if (st.fmt) cell.numFmt = st.fmt;
  if (st.bg) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: st.bg } };
}

function vhead(ws: Worksheet, row: number, heads: string[], bg: string, mergeTo?: number) {
  ws.getRow(row).height = 44;
  heads.forEach((h, i) => {
    const cell = ws.getCell(row, i + 1);
    cell.value = h;
    cell.font = { name: FONT, size: 10, bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: bg } };
    cell.alignment = { vertical: "middle", horizontal: i === 0 ? "left" : "center", wrapText: true };
    cell.border = BORDER;
  });
  // Kolom terakhir (penjelasan / status) dilebarkan dengan menggabung sel sampai kolom mergeTo.
  if (mergeTo && mergeTo > heads.length) {
    ws.mergeCells(row, heads.length, row, mergeTo);
    for (let c = heads.length + 1; c <= mergeTo; c++) ws.getCell(row, c).border = BORDER;
  }
}

function vsection(ws: Worksheet, row: number, text: string, hint: string) {
  const t = ws.getCell(row, 1);
  t.value = text;
  t.font = { name: FONT, size: 12, bold: true, color: { argb: INK } };
  ws.mergeCells(row + 1, 1, row + 1, 14);
  const h = ws.getCell(row + 1, 1);
  h.value = hint;
  h.font = { name: FONT, size: 9, italic: true, color: { argb: "FF828290" } };
  h.alignment = { wrapText: true, vertical: "top" };
  ws.getRow(row + 1).height = 28;
}

function statusRules(ws: Worksheet, ref: string, topLeft: string) {
  ws.addConditionalFormatting({
    ref,
    rules: [
      { type: "expression", priority: 1, formulae: [`LEFT(${topLeft},5)="Cocok"`], style: { font: { bold: true, color: { argb: GREEN } } } },
      { type: "expression", priority: 2, formulae: [`AND(LEN(${topLeft})>0,LEFT(${topLeft},5)<>"Cocok")`], style: { font: { bold: true, color: { argb: AMBER } } } },
    ],
  });
}

function addValidasiSheet(wb: Workbook, o: { name: string; bg: string; title: string; detail: string; rolls: HppRollLine[] }) {
  const ws = wb.addWorksheet(o.name, { views: [{ showGridLines: false }] });
  ws.columns = [34, 22, 22, 16, 16, 18, 16, 16, 16, 16, 16, 16, 16, 16, 52].map((width) => ({ width }));
  ws.mergeCells(1, 1, 1, 10);
  ws.getCell(1, 1).value = o.title;
  ws.getCell(1, 1).font = { name: FONT, size: 14, bold: true, color: { argb: INK } };
  ws.mergeCells(2, 1, 2, 14);
  ws.getCell(2, 1).value =
    "Sheet ini membuktikan nilai per pcs di sheet Detail Roll bisa dikembalikan ke total biayanya. TOTAL SUMBER (pool) = biaya asli (invoice material, rib, tagihan ekspedisi). " +
    "TERALOKASI = jumlah (nilai per pcs x Qty FG) dari sheet Detail Roll. SELISIH tidak selalu berarti salah. Penyebab yang wajar: (1) pembagi roll belum sama dengan Finish Good " +
    "(roll belum ditutup memakai hasil cutting, atau sebagian pcs belum masuk koli/resi), (2) diskon, rib, dan ongkir dibagi ke SEMUA roll/koli di sumbernya, sedangkan laporan ini hanya memuat " +
    `roll/koli milik MRP ini. Selisih sampai Rp ${TOLERANCE} dianggap cocok (pembulatan).`;
  ws.getCell(2, 1).font = { name: FONT, size: 9, italic: true, color: { argb: "FF828290" } };
  ws.getCell(2, 1).alignment = { wrapText: true, vertical: "top" };
  ws.getRow(2).height = 56;
  ws.mergeCells(3, 1, 3, 14);
  ws.getCell(3, 1).value = `Semua angka di sini adalah rumus Excel yang membaca sheet "${o.detail}" (klik sel untuk melihat cara hitungnya). Hijau = cocok, oranye = ada selisih (lihat penjelasan).`;
  ws.getCell(3, 1).font = { name: FONT, size: 9, bold: true, color: { argb: INPUT_INK } };

  const rolls = o.rolls;
  const N = rolls.length;
  if (N === 0) {
    ws.getCell(5, 1).value = "Belum ada data untuk kelompok ini.";
    return;
  }
  const rg = (k: keyof typeof RC) => `'${o.detail}'!$${colLetter(RC[k])}$${FIRST_ROW}:$${colLetter(RC[k])}$${FIRST_ROW + N - 1}`;
  const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);
  const berat = rg("berat");
  const roll = rg("roll");
  const fg = rg("fg");

  // ---- nilai cadangan (hasil hitung di aplikasi) untuk tiap rumus ----
  const traced = rolls.filter((r) => (r.grossKg ?? 0) > 0);
  const firstOfRoll = new Map<string, HppRollLine>();
  for (const r of traced) if (!firstOfRoll.has(r.roll)) firstOfRoll.set(r.roll, r);
  const uniqRolls = Array.from(firstOfRoll.values()).sort((a, b) => a.vendor.localeCompare(b.vendor) || a.warna.localeCompare(b.warna) || a.roll.localeCompare(b.roll));
  const ribRows = rolls.filter((r) => (r.warnaRib ?? 0) > 0);
  const ribWarnaPool = sum(Array.from(new Map(ribRows.map((r) => [r.warna + "|" + r.invoiceMaterial, r.warnaRib as number])).values()));
  const withResi = rolls.filter((r) => (r.ongkirResi ?? 0) > 0 && r.resi);
  const ongkirResiPool = sum(Array.from(new Map(withResi.map((r) => [r.resi, r.ongkirResi as number])).values()));
  const koliOngkir = (r: HppRollLine) => r.ongkirPcs * (r.pcsKoli ?? 0);
  const ongkirKoliPool = sum(Array.from(new Map(withResi.map((r) => [r.resi + "|" + r.koli, koliOngkir(r)])).values()));
  const ongkirAlloc = sum(withResi.map((r) => r.ongkirPcs * r.fg));

  // ---- 1) Ringkasan ----
  const S0 = 5;
  vsection(ws, S0, "1. Ringkasan: total sumber vs jumlah per pcs", "Satu baris per komponen biaya. Selisih = total sumber dikurangi teralokasi; positif berarti ada biaya yang belum terbagi ke pcs di laporan ini.");
  const SH = S0 + 3;
  vhead(ws, SH, ["Komponen", "Total sumber (pool)", "Teralokasi (Σ per pcs × Qty FG)", "Selisih", "% Teralokasi", "Status", "Penjelasan"], o.bg, 14);
  type SumRow = { label: string; pool: CellValue; alloc: CellValue; poolV: number; allocV: number; note: string };
  const R = (i: number) => SH + 1 + i; // nomor baris ringkasan ke-i
  const poolBahan = sum(uniqRolls.map((r) => r.biayaBahanRoll));
  const poolDiskon = sum(uniqRolls.map((r) => r.diskonRoll));
  const summary: SumRow[] = [
    {
      label: "Bahan kain sebelum diskon",
      pool: f(`SUMPRODUCT((${berat}>0)*${rg("biaya")}/COUNTIFS(${roll},${roll}))`, poolBahan),
      alloc: f(`SUMPRODUCT((${berat}>0)*(${rg("bahan")}+${rg("diskonPcs")})*${fg})`, sum(traced.map((r) => (r.bahanPcs + r.diskonPcs) * r.fg))),
      poolV: poolBahan,
      allocV: sum(traced.map((r) => (r.bahanPcs + r.diskonPcs) * r.fg)),
      note: "Pool = Σ biaya tiap roll (berat × harga/kg). Teralokasi = Σ (bahan/pcs + diskon/pcs) × Qty FG. Kembali penuh kalau pembagi roll = jumlah FG roll itu di laporan; lihat bagian 2.",
    },
    {
      label: "Diskon invoice (porsi roll)",
      pool: f(`SUMPRODUCT((${berat}>0)*${rg("diskon")}/COUNTIFS(${roll},${roll}))`, poolDiskon),
      alloc: f(`SUMPRODUCT((${berat}>0)*${rg("diskonPcs")}*${fg})`, sum(traced.map((r) => r.diskonPcs * r.fg))),
      poolV: poolDiskon,
      allocV: sum(traced.map((r) => r.diskonPcs * r.fg)),
      note: "Pool = Σ porsi diskon roll (diskon invoice × berat roll / total kg kain invoice). Teralokasi = Σ Diskon/pcs × Qty FG.",
    },
    {
      label: "Bahan kain setelah diskon",
      pool: f(`B${R(0)}-B${R(1)}`, poolBahan - poolDiskon),
      alloc: f(`SUMPRODUCT((${berat}>0)*${rg("bahan")}*${fg})`, sum(traced.map((r) => r.bahanPcs * r.fg))),
      poolV: poolBahan - poolDiskon,
      allocV: sum(traced.map((r) => r.bahanPcs * r.fg)),
      note: "Pool = bahan sebelum diskon dikurangi diskon. Teralokasi = Σ Bahan/pcs × Qty FG (Bahan/pcs sudah setelah diskon).",
    },
    {
      label: "Rib (porsi roll)",
      pool: f(`SUMPRODUCT((${berat}>0)*${rg("rib")}/COUNTIFS(${roll},${roll}))`, sum(uniqRolls.map((r) => r.ribRoll))),
      alloc: f(`SUMPRODUCT((${berat}>0)*${rg("ribPcs")}*${fg})`, sum(traced.map((r) => r.ribPcs * r.fg))),
      poolV: sum(uniqRolls.map((r) => r.ribRoll)),
      allocV: sum(traced.map((r) => r.ribPcs * r.fg)),
      note: "Pool = Σ porsi rib roll (biaya rib warna × berat roll / total kg kain warna). Teralokasi = Σ Rib/pcs × Qty FG. Selisih di sini hanya karena pembagi ≠ Qty FG (lihat bagian 2).",
    },
    {
      label: "Rib: total biaya rib per warna di invoice",
      pool: f(`SUMPRODUCT((${rg("warnaRib")}>0)*${rg("warnaRib")}/(COUNTIFS(${rg("warna")},${rg("warna")},${rg("invoice")},${rg("invoice")})+(${rg("invoice")}="")))`, ribWarnaPool),
      alloc: f(`SUMPRODUCT((${rg("warnaRib")}>0)*${rg("ribPcs")}*${fg})`, sum(ribRows.map((r) => r.ribPcs * r.fg))),
      poolV: ribWarnaPool,
      allocV: sum(ribRows.map((r) => r.ribPcs * r.fg)),
      note: "Inilah angka total rib di invoice (mis. Rp 100.000 per warna). Selisih ke Rib per pcs berasal dari: roll warna itu yang tidak masuk laporan ini (rib dibagi ke semua roll warna), lalu pembagi ≠ Qty FG.",
    },
    {
      label: "Ongkir: tagihan ekspedisi per resi",
      pool: f(`SUMPRODUCT((${rg("ongkirResi")}>0)*${rg("ongkirResi")}/(COUNTIFS(${rg("resi")},${rg("resi")},${rg("ongkirResi")},">0")+(${rg("ongkirResi")}=0)))`, ongkirResiPool),
      alloc: f(`SUMPRODUCT((${rg("ongkirResi")}>0)*${rg("ongkir")}*${fg})`, ongkirAlloc),
      poolV: ongkirResiPool,
      allocV: ongkirAlloc,
      note: "Pool = Σ ongkir resi (tarif master × berat seluruh koli resi). Resi sering memuat koli MRP/vendor lain, jadi selisih wajar; lihat bagian 3 per resi.",
    },
    {
      label: "Ongkir: koli yang ikut laporan ini",
      pool: f(`SUMPRODUCT((${rg("ongkirResi")}>0)*${rg("ongkirKoli")}/(COUNTIFS(${rg("resi")},${rg("resi")},${rg("koli")},${rg("koli")},${rg("ongkirResi")},">0")+(${rg("ongkirResi")}=0)))`, ongkirKoliPool),
      alloc: f(`SUMPRODUCT((${rg("ongkirResi")}>0)*${rg("ongkir")}*${fg})`, ongkirAlloc),
      poolV: ongkirKoliPool,
      allocV: ongkirAlloc,
      note: "Pool = Σ ongkir koli (ongkir resi × berat koli / berat resi) hanya untuk koli yang ada di laporan. Selisih = pcs di koli itu yang bukan bagian laporan ini (Pcs di Koli > Qty FG baris).",
    },
    {
      label: "Total HPP = Σ komponen per pcs × Qty FG",
      pool: f(`SUM(${rg("total")})`, sum(rolls.map((r) => r.totalHpp))),
      alloc: f(`SUMPRODUCT((${rg("bahan")}+${rg("ribPcs")}+${rg("maklon")}+${rg("ongkir")})*${fg})`, sum(rolls.map((r) => (r.bahanPcs + r.ribPcs + r.maklonPcs + r.ongkirPcs) * r.fg))),
      poolV: sum(rolls.map((r) => r.totalHpp)),
      allocV: sum(rolls.map((r) => (r.bahanPcs + r.ribPcs + r.maklonPcs + r.ongkirPcs) * r.fg)),
      note: "Pemeriksaan rumus: Total HPP (kolom Total HPP di Detail Roll) harus sama dengan bahan + rib + maklon + ongkir per pcs × Qty FG. Selisih di sini = ada baris yang rumusnya tidak konsisten.",
    },
  ];
  summary.forEach((s, i) => {
    const r = R(i);
    ws.getRow(r).height = 44;
    const diff = s.poolV - s.allocV;
    vput(ws, r, 1, s.label, { bold: true });
    vput(ws, r, 2, s.pool, { fmt: "#,##0" });
    vput(ws, r, 3, s.alloc, { fmt: "#,##0" });
    vput(ws, r, 4, f(`B${r}-C${r}`, diff), { fmt: DIFF_FMT });
    vput(ws, r, 5, f(`IF(B${r}=0,"",C${r}/B${r})`, s.poolV === 0 ? "" : s.allocV / s.poolV), { fmt: "0.0%" });
    vput(ws, r, 6, f(`IF(ABS(D${r})<=${TOLERANCE},"Cocok","Selisih")`, Math.abs(diff) <= TOLERANCE ? "Cocok" : "Selisih"), { align: "center", bold: true });
    ws.mergeCells(r, 7, r, 14);
    vput(ws, r, 7, s.note, { wrap: true, color: "FF4B5563" });
    for (let c = 8; c <= 14; c++) ws.getCell(r, c).border = BORDER;
  });
  statusRules(ws, `F${R(0)}:F${R(summary.length - 1)}`, `F${R(0)}`);

  // ---- 2) Per roll ----
  const T0 = R(summary.length - 1) + 3;
  vsection(ws, T0, "2. Validasi per roll: bahan, diskon, rib", "Satu baris per roll yang bisa ditelusuri ke invoice material. Pembagi = pcs yang menanggung biaya roll (hasil cutting kalau belum ditutup, Finish Good kalau sudah). Σ Qty FG = pcs roll ini yang ada di laporan.");
  const TH = T0 + 3;
  vhead(ws, TH, ["Warna", "Code Roll", "No Invoice Material", "Pembagi (pcs)", "Σ Qty FG di laporan", "Biaya Bahan Roll", "Teralokasi Bahan", "Selisih Bahan", "Diskon (porsi roll)", "Teralokasi Diskon", "Selisih Diskon", "Rib (porsi roll)", "Teralokasi Rib", "Selisih Rib", "Status"], o.bg);
  uniqRolls.forEach((u, i) => {
    const r = TH + 1 + i;
    const mine = traced.filter((x) => x.roll === u.roll);
    const k = `$B${r}`;
    const fgSum = sum(mine.map((x) => x.fg));
    const aBahan = sum(mine.map((x) => (x.bahanPcs + x.diskonPcs) * x.fg));
    const aDisk = sum(mine.map((x) => x.diskonPcs * x.fg));
    const aRib = sum(mine.map((x) => x.ribPcs * x.fg));
    const dB = u.biayaBahanRoll - aBahan;
    const dD = u.diskonRoll - aDisk;
    const dR = u.ribRoll - aRib;
    const pemb = u.pembagi ?? 0;
    const ok = Math.abs(dB) <= TOLERANCE && Math.abs(dD) <= TOLERANCE && Math.abs(dR) <= TOLERANCE;
    const status = ok ? "Cocok" : fgSum < pemb ? "Qty FG di laporan < pembagi: sisa pcs roll belum terkirim / belum masuk koli" : fgSum > pemb ? "Qty FG di laporan > pembagi: cek roll ini" : "Selisih pembulatan";
    vput(ws, r, 1, u.warna);
    vput(ws, r, 2, u.roll);
    vput(ws, r, 3, u.invoiceMaterial);
    vput(ws, r, 4, f(`AVERAGEIFS(${rg("pembagi")},${roll},${k})`, pemb), { fmt: "#,##0" });
    vput(ws, r, 5, f(`SUMIFS(${fg},${roll},${k})`, fgSum), { fmt: "#,##0" });
    vput(ws, r, 6, f(`AVERAGEIFS(${rg("biaya")},${roll},${k})`, u.biayaBahanRoll), { fmt: "#,##0" });
    vput(ws, r, 7, f(`SUMPRODUCT((${roll}=${k})*(${rg("bahan")}+${rg("diskonPcs")})*${fg})`, aBahan), { fmt: "#,##0" });
    vput(ws, r, 8, f(`F${r}-G${r}`, dB), { fmt: DIFF_FMT });
    vput(ws, r, 9, f(`AVERAGEIFS(${rg("diskon")},${roll},${k})`, u.diskonRoll), { fmt: "#,##0" });
    vput(ws, r, 10, f(`SUMPRODUCT((${roll}=${k})*${rg("diskonPcs")}*${fg})`, aDisk), { fmt: "#,##0" });
    vput(ws, r, 11, f(`I${r}-J${r}`, dD), { fmt: DIFF_FMT });
    vput(ws, r, 12, f(`AVERAGEIFS(${rg("rib")},${roll},${k})`, u.ribRoll), { fmt: "#,##0" });
    vput(ws, r, 13, f(`SUMPRODUCT((${roll}=${k})*${rg("ribPcs")}*${fg})`, aRib), { fmt: "#,##0" });
    vput(ws, r, 14, f(`L${r}-M${r}`, dR), { fmt: DIFF_FMT });
    vput(
      ws,
      r,
      15,
      f(`IF(AND(ABS(H${r})<=${TOLERANCE},ABS(K${r})<=${TOLERANCE},ABS(N${r})<=${TOLERANCE}),"Cocok",IF(E${r}<D${r},"Qty FG di laporan < pembagi: sisa pcs roll belum terkirim / belum masuk koli",IF(E${r}>D${r},"Qty FG di laporan > pembagi: cek roll ini","Selisih pembulatan")))`, status),
      { align: "left", bold: true, wrap: true }
    );
  });
  const rollEnd = TH + Math.max(uniqRolls.length, 1);
  if (uniqRolls.length === 0) ws.getCell(TH + 1, 1).value = "Belum ada roll yang bisa ditelusuri ke invoice material.";
  else statusRules(ws, `O${TH + 1}:O${rollEnd}`, `O${TH + 1}`);

  // ---- 3) Per resi (ongkir) ----
  const U0 = rollEnd + 3;
  vsection(ws, U0, "3. Validasi ongkir per resi", "Ongkir resi dibagi ke koli menurut berat koli, lalu ke pcs di koli. Koli di resi yang sama bisa milik MRP/vendor lain, jadi total resi bisa lebih besar dari yang masuk laporan ini.");
  const UH = U0 + 3;
  vhead(ws, UH, ["No Resi", "Ongkir Resi (Rp)", "Berat Resi (kg)", "Σ Berat Koli di laporan (kg)", "Ongkir Koli di laporan (Rp)", "Teralokasi (Σ Ongkir/pcs × FG)", "Selisih Resi − Koli", "Selisih Koli − Teralokasi", "Status"], o.bg, 14);
  const resiList = Array.from(new Set(withResi.map((r) => r.resi))).sort((a, b) => a.localeCompare(b, "id-ID", { numeric: true }));
  resiList.forEach((resi, i) => {
    const r = UH + 1 + i;
    const k = `$A${r}`;
    const mine = rolls.filter((x) => x.resi === resi && (x.ongkirResi ?? 0) > 0);
    const oResi = mine[0].ongkirResi as number;
    const bResi = mine[0].beratResi ?? 0;
    const koliMap = new Map(mine.map((x) => [x.koli, x]));
    const bKoli = sum(Array.from(koliMap.values()).map((x) => x.beratKoli ?? 0));
    const oKoli = sum(Array.from(koliMap.values()).map(koliOngkir));
    const alloc = sum(mine.map((x) => x.ongkirPcs * x.fg));
    const gA = oResi - oKoli;
    const gB = oKoli - alloc;
    const status = Math.abs(gA) <= TOLERANCE && Math.abs(gB) <= TOLERANCE ? "Cocok" : gA > TOLERANCE ? "Ada koli resi ini di luar laporan (MRP/vendor lain)" : gB > TOLERANCE ? "Pcs di koli lebih banyak dari Qty FG di laporan" : "Selisih pembulatan";
    const keys = `${rg("resi")},${rg("resi")},${rg("koli")},${rg("koli")}`;
    const denom = `(COUNTIFS(${keys},${rg("ongkirResi")},">0")+(${rg("ongkirResi")}=0))`;
    vput(ws, r, 1, resi, { bold: true });
    vput(ws, r, 2, f(`IFERROR(AVERAGEIFS(${rg("ongkirResi")},${rg("resi")},${k},${rg("ongkirResi")},">0"),0)`, oResi), { fmt: "#,##0" });
    vput(ws, r, 3, f(`IFERROR(AVERAGEIFS(${rg("beratResi")},${rg("resi")},${k},${rg("beratResi")},">0"),0)`, bResi), { fmt: "#,##0.00" });
    vput(ws, r, 4, f(`SUMPRODUCT((${rg("resi")}=${k})*${rg("beratKoli")}/${denom})`, bKoli), { fmt: "#,##0.00" });
    vput(ws, r, 5, f(`SUMPRODUCT((${rg("resi")}=${k})*${rg("ongkirKoli")}/${denom})`, oKoli), { fmt: "#,##0" });
    vput(ws, r, 6, f(`SUMPRODUCT((${rg("resi")}=${k})*(${rg("ongkirResi")}>0)*${rg("ongkir")}*${fg})`, alloc), { fmt: "#,##0" });
    vput(ws, r, 7, f(`B${r}-E${r}`, gA), { fmt: DIFF_FMT });
    vput(ws, r, 8, f(`E${r}-F${r}`, gB), { fmt: DIFF_FMT });
    ws.mergeCells(r, 9, r, 14);
    vput(ws, r, 9, f(`IF(AND(ABS(G${r})<=${TOLERANCE},ABS(H${r})<=${TOLERANCE}),"Cocok",IF(G${r}>${TOLERANCE},"Ada koli resi ini di luar laporan (MRP/vendor lain)",IF(H${r}>${TOLERANCE},"Pcs di koli lebih banyak dari Qty FG di laporan","Selisih pembulatan")))`, status), { align: "left", bold: true });
    for (let c = 10; c <= 14; c++) ws.getCell(r, c).border = BORDER;
  });
  if (resiList.length === 0) ws.getCell(UH + 1, 1).value = "Belum ada baris dengan rincian ongkir resi.";
  else statusRules(ws, `I${UH + 1}:I${UH + resiList.length}`, `I${UH + 1}`);
}
