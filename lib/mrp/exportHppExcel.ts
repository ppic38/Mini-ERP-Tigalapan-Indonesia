import type { CellFormulaValue, Workbook, Worksheet } from "exceljs";
import { VENDOR_PRODUKSI } from "./seed";
import type { HppItemLine, HppReport, HppRollLine } from "./hppReport";

// Unduh Laporan HPP per MRP (template CAL HPP ERP, revisi 2026-11-05): TIGA sheet -- HPP (satu baris per warna · lengan · size, rata-rata
// tertimbang), Detail Roll (satu baris per roll x size) dan Validasi. HPP dan Detail Roll memuat baris On Going (estimasi) dan Final dalam satu
// sheet; kolom pertama "Status" (oranye = On Going, hijau = Final) bisa difilter. Baris header ber-filter dan dibekukan. Angka dihitung di
// hppRowsForInvoicePerRoll / buildHppReport.
//
// RUMUS EXCEL (owner 2026-11-02: "by formula saat di export jadi bisa ketahuan"): kolom hasil hitung ditulis sebagai rumus yang bisa diklik dan
// ditelusuri, bukan angka mati. Sheet Detail Roll: biaya bahan = berat x harga/kg, porsi diskon = diskon invoice x berat / total kg invoice, porsi rib =
// biaya rib warna x berat / total kg warna, bahan/pcs = (biaya - diskon) / pembagi, COGS = bahan + rib, HPP = COGS + maklon + ongkir, ratio = HPP / harga
// jual. Sheet HPP (per item): rata-rata tertimbang dari sheet Detail Roll lewat SUMPRODUCT. Sel BIRU = data masukan (invoice, master, produksi,
// ekspedisi), sel HITAM = rumus. Nilai tersimpan di tiap rumus sama dengan hasil hitung aplikasi, jadi tampil benar walau belum dihitung ulang.

const INK = "FF1A1A1F";
const INPUT_INK = "FF1D4ED8";
const HEAD_BG = "FF0D9488";
const ST_ONGOING = "On Going";
const ST_FINAL = "Final";
const ST_ONGOING_BG = "FFFEF3C7";
const ST_FINAL_BG = "FFD1FAE5";
const SOFT = "FFF0F3F6";
const LINE = "FFD3D8DF";
const FONT = "Calibri";
const thin = { style: "thin" as const, color: { argb: LINE } };
const BORDER = { top: thin, left: thin, bottom: thin, right: thin };
const FIRST_ROW = 5;
const WS_HPP = "HPP";
const WS_DETAIL = "Detail Roll";

const vendorName = (id: string) => VENDOR_PRODUKSI[id]?.name ?? id;
const lenganLabel = (l: string) => (l === "PENDEK" ? "Pendek" : "Panjang");

type CellValue = string | number | null | { formula: string; result: string | number | null };
type Col = { head: string; width: number; kind: "text" | "int" | "rp" | "dec" | "pct" | "status" };

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
    cell.alignment = { vertical: "middle", horizontal: c.kind === "text" || c.kind === "status" ? "left" : "right", wrapText: true };
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
      cell.alignment = { vertical: "middle", horizontal: c.kind === "text" || c.kind === "status" ? "left" : "right" };
      if (c.kind === "int" || c.kind === "rp") cell.numFmt = "#,##0";
      if (c.kind === "dec") cell.numFmt = "#,##0.00";
      if (c.kind === "pct") cell.numFmt = "0.0%";
      if (ri % 2 === 1) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: SOFT } };
      if (c.kind === "status") {
        const on = v === ST_ONGOING;
        cell.font = { name: FONT, size: 10, bold: true, color: { argb: on ? AMBER : GREEN } };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: on ? ST_ONGOING_BG : ST_FINAL_BG } };
      }
    });
  });
  if (rows.length > 0) ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4, column: cols.length } };
  else ws.getCell(5, 1).value = "Belum ada data untuk kelompok ini.";
  return ws;
}

// ---- Sheet Detail Roll: satu baris per roll x size ----
const RC = {
  status: 1, vendor: 2, warna: 3, lengan: 4, size: 5, roll: 6, invoice: 7, berat: 8, hargaKg: 9, biaya: 10, invDiskon: 11, invKg: 12, diskon: 13, warnaRib: 14, warnaKg: 15,
  rib: 16, pembagi: 17, fg: 18, resi: 19, koli: 20, ongkirResi: 21, beratResi: 22, beratKoli: 23, ongkirKoli: 24, pcsKoli: 25,
  bahan: 26, diskonPcs: 27, ribPcs: 28, cogs: 29, maklon: 30, ongkir: 31, hpp: 32, jual: 33, ratio: 34, total: 35,
} as const;
const ROLL_COLS: Col[] = [
  { head: "Status", width: 10, kind: "status" },
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

function rollRow(r: HppRollLine, rowNo: number, status: string): CellValue[] {
  const c = (k: keyof typeof RC) => colLetter(RC[k]) + rowNo;
  // Baris yang bisa ditelusuri ke roll di invoice material memakai rumus penuh; baris rework / data lama tanpa roll hanya punya angka akhir.
  const traced = r.grossKg != null && r.hargaPerKg != null && r.invKg != null && r.warnaKg != null && r.invDiskon != null && r.warnaRib != null && !!r.pembagi && r.pembagi > 0;
  const out: CellValue[] = new Array(ROLL_COLS.length).fill(null);
  const set = (k: keyof typeof RC, v: CellValue) => {
    out[RC[k] - 1] = v;
  };
  set("status", status);
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

// ---- Sheet HPP (per item): rata-rata tertimbang dari baris Detail Roll kelompoknya (On Going atau Final) ----
const IC = { status: 1, warna: 2, lengan: 3, size: 4, vendor: 5, fg: 6, bahan: 7, rib: 8, cogs: 9, maklon: 10, ongkir: 11, hpp: 12, min: 13, max: 14, jual: 15, ratio: 16, total: 17, roll: 18, resi: 19 } as const;
const ITEM_COLS: Col[] = [
  { head: "Status", width: 10, kind: "status" },
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

// Baris Detail Roll kelompok ini = detailFirst .. detailFirst + detailCount - 1 di sheet Detail Roll (On Going di atas, Final di bawahnya).
function itemRow(i: HppItemLine, rowNo: number, status: string, detailSheet: string, detailFirst: number, detailCount: number): CellValue[] {
  const rng = (k: keyof typeof RC) => `'${detailSheet}'!$${colLetter(RC[k])}$${detailFirst}:$${colLetter(RC[k])}$${detailFirst + detailCount - 1}`;
  const c = (k: keyof typeof IC) => colLetter(IC[k]) + rowNo;
  const a = (k: keyof typeof IC) => `$${colLetter(IC[k])}${rowNo}`;
  // Kelompok tanpa baris Detail Roll tidak punya rentang rumus: tulis angka akhirnya saja.
  const live = detailCount > 0;
  const f = (formula: string, result: string | number | null): CellValue => (live ? { formula, result } : result);
  const match = `(${rng("warna")}=${a("warna")})*(${rng("lengan")}=${a("lengan")})*(${rng("size")}=${a("size")})`;
  const weighted = (k: keyof typeof RC) => `IF(${c("fg")}=0,0,SUMPRODUCT(${match}*${rng(k)}*${rng("fg")})/${c("fg")})`;
  const out: CellValue[] = new Array(ITEM_COLS.length).fill(null);
  const set = (k: keyof typeof IC, v: CellValue) => {
    out[IC[k] - 1] = v;
  };
  set("status", status);
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
    "Sheet HPP menghitung rata-rata tertimbang (bobot Qty FG) dari baris Detail Roll dengan Status yang sama.";
  const note =
    `MRP ${mrpId} · diunduh ${stamp} · Kolom Status: ON GOING (oranye) = roll yang belum ditutup, pembagi = hasil cutting roll (estimasi, berubah sampai roll ditutup); ` +
    `FINAL (hijau) = roll yang sudah ditutup (pembagi = Finish Good aktual), plus baris rework dan data lama tanpa roll. Gunakan filter di kolom Status untuk memilih salah satunya. ${rumus}`;

  // Urutan baris: On Going di atas, Final di bawahnya (di sheet HPP maupun Detail Roll).
  const groups = [
    { status: ST_ONGOING, key: "estimasi" as const },
    { status: ST_FINAL, key: "final" as const },
  ];
  let nextFirst = FIRST_ROW;
  const placed = groups.map((g) => {
    const rolls = report[g.key].rolls;
    const first = nextFirst;
    nextFirst += rolls.length;
    return { ...g, rolls, items: report[g.key].items, first };
  });
  const itemRows: CellValue[][] = [];
  for (const g of placed) for (const it of g.items) itemRows.push(itemRow(it, FIRST_ROW + itemRows.length, g.status, WS_DETAIL, g.first, g.rolls.length));
  const rollRows: CellValue[][] = [];
  for (const g of placed) for (const r of g.rolls) rollRows.push(rollRow(r, FIRST_ROW + rollRows.length, g.status));
  sheet(wb, WS_HPP, HEAD_BG, `HPP — ${mrpId}`, note, ITEM_COLS, itemRows);
  sheet(wb, WS_DETAIL, HEAD_BG, `Detail Roll — ${mrpId}`, note, ROLL_COLS, rollRows);
  // Sheet validasi (owner 2026-11-04): total sumber vs jumlah (nilai per pcs x Qty FG), supaya terlihat kalau per pcs tidak kembali ke totalnya.
  // Satu sheet (owner 2026-11-05: export disederhanakan): ringkasan, rincian ongkir, rincian bahan/diskon/rib. Membaca baris Detail Roll On Going DAN Final.
  addValidasiSheet(
    wb,
    mrpId,
    placed.map((g) => ({ key: g.key, detail: WS_DETAIL, first: g.first, rolls: g.rolls })),
    HEAD_BG
  );
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

// ---- Sheet Validasi (satu sheet, tiga bagian), owner 2026-11-04 / disederhanakan 2026-11-05 ----
// Tujuan: membuktikan bahwa nilai per pcs di sheet Detail Roll bisa dikembalikan ke total biayanya (bahan, diskon, rib, ongkir), dan kalau tidak
// kembali, menunjukkan DI MANA selisihnya. Tabel bergaya pivot (bukan PivotTable asli) yang seluruh angkanya rumus Excel (SUMPRODUCT / SUMIFS) ke
// baris Detail Roll On Going DAN Final sekaligus, karena satu koli bisa terbagi di dua kelompok itu (roll sudah ditutup vs belum).
//  - A. Ringkasan                  : semua komponen dalam satu tabel.
//  - B. Ongkir                     : per resi -> pengiriman -> koli (harga per koli dijumlahkan, dibandingkan tagihan resi).
//  - C. Bahan, Diskon, dan Rib     : per invoice material (bahan, diskon), per warna (rib), dan per roll.
const DIFF_FMT = "#,##0;[Red]-#,##0";
const GREEN = "FF047857";
const AMBER = "FFB45309";
const TOLERANCE = 1;
const WS_VALIDASI = "Validasi";
const RINGKASAN_ROWS = 10; // jumlah baris tabel ringkasan (bagian A); bagian B dan C diletakkan di bawahnya
const NCOL = 16; // lebar sheet Validasi (kolom A..P)

type VStyle = { fmt?: string; bold?: boolean; bg?: string; color?: string; align?: "left" | "right" | "center"; wrap?: boolean };
type VPart = { key: "estimasi" | "final"; detail: string; first: number; rolls: HppRollLine[] };
type VRoll = HppRollLine & { part: "estimasi" | "final" };

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

function vsection(ws: Worksheet, row: number, text: string, hint: string, lastCol = 14) {
  const t = ws.getCell(row, 1);
  t.value = text;
  t.font = { name: FONT, size: 12, bold: true, color: { argb: INK } };
  ws.mergeCells(row + 1, 1, row + 1, lastCol);
  const h = ws.getCell(row + 1, 1);
  h.value = hint;
  h.font = { name: FONT, size: 9, italic: true, color: { argb: "FF828290" } };
  h.alignment = { wrapText: true, vertical: "top" };
  ws.getRow(row + 1).height = 28;
}

function vtitle(ws: Worksheet, title: string, note: string, legend: string, lastCol: number) {
  ws.mergeCells(1, 1, 1, Math.min(lastCol, 10));
  ws.getCell(1, 1).value = title;
  ws.getCell(1, 1).font = { name: FONT, size: 14, bold: true, color: { argb: INK } };
  ws.mergeCells(2, 1, 2, lastCol);
  ws.getCell(2, 1).value = note;
  ws.getCell(2, 1).font = { name: FONT, size: 9, italic: true, color: { argb: "FF828290" } };
  ws.getCell(2, 1).alignment = { wrapText: true, vertical: "top" };
  ws.getRow(2).height = 44;
  ws.mergeCells(3, 1, 3, lastCol);
  ws.getCell(3, 1).value = legend;
  ws.getCell(3, 1).font = { name: FONT, size: 9, bold: true, color: { argb: INPUT_INK } };
}

/** Pita judul bagian (A / B / C) di sheet Validasi, diikuti satu baris keterangan. */
function vbanner(ws: Worksheet, row: number, text: string, note: string, bg: string) {
  ws.mergeCells(row, 1, row, NCOL);
  const t = ws.getCell(row, 1);
  t.value = text;
  t.font = { name: FONT, size: 13, bold: true, color: { argb: "FFFFFFFF" } };
  t.fill = { type: "pattern", pattern: "solid", fgColor: { argb: bg } };
  t.alignment = { vertical: "middle", horizontal: "left" };
  ws.getRow(row).height = 24;
  ws.mergeCells(row + 1, 1, row + 1, NCOL);
  const n = ws.getCell(row + 1, 1);
  n.value = note;
  n.font = { name: FONT, size: 9, italic: true, color: { argb: "FF828290" } };
  n.alignment = { wrapText: true, vertical: "top" };
  ws.getRow(row + 1).height = 44;
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

const vsum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);
const numCmp = (a: string, b: string) => a.localeCompare(b, "id-ID", { numeric: true });
const cmpNote = "Selisih sampai Rp 1 (atau 0,05 kg) dianggap cocok (pembulatan).";
const rngOf = (p: VPart, k: keyof typeof RC) => `'${p.detail}'!$${colLetter(RC[k])}$${p.first}:$${colLetter(RC[k])}$${p.first + p.rolls.length - 1}`;
const joinParts = (parts: VPart[], sep: string, fn: (p: VPart) => string) => (parts.length === 0 ? "0" : parts.map(fn).join(sep));

/** Sisipkan sheet Validasi. `parts` = kelompok On Going dan Final (yang kosong dilewati). */
function addValidasiSheet(wb: Workbook, mrpId: string, allParts: VPart[], bg: string) {
  const parts = allParts.filter((p) => p.rolls.length > 0);
  const ws = wb.addWorksheet(WS_VALIDASI, { views: [{ showGridLines: false }] });
  ws.columns = [40, 22, 22, 16, 14, 14, 16, 16, 14, 16, 16, 14, 16, 16, 14, 56].map((width) => ({ width }));
  const legend = `Semua angka adalah rumus Excel yang membaca sheet Detail Roll (On Going dan Final) · klik sel untuk melihat cara hitungnya · hijau = cocok, oranye = ada selisih. ${cmpNote}`;
  const note =
    "Membuktikan bahwa nilai per pcs di sheet Detail Roll bisa dikembalikan ke total biayanya, dan kalau tidak kembali, menunjukkan di mana selisihnya. " +
    "Bagian A = ringkasan semua komponen; bagian B = rincian ongkir per resi dan koli; bagian C = rincian bahan, diskon, dan rib per invoice, warna, dan roll. " +
    "Selisih tidak selalu berarti salah: wajar kalau pembagi roll belum sama dengan Finish Good (roll belum ditutup / pcs belum masuk koli), atau kalau diskon/rib/ongkir dibagi ke semua roll/koli di sumbernya sedangkan laporan ini hanya memuat milik MRP ini.";
  vtitle(ws, `Validasi — ${mrpId}`, note, legend, NCOL);
  if (parts.length === 0) {
    ws.getCell(5, 1).value = "Belum ada data HPP untuk MRP ini.";
    return;
  }
  const RING = 5;
  const ringEnd = RING + 3 + RINGKASAN_ROWS; // baris terakhir tabel ringkasan
  const ongkir = fillOngkirSheet(ws, mrpId, parts, bg, ringEnd + 3);
  const bahan = fillBahanSheet(ws, mrpId, parts, bg, ongkir.end + 1);
  fillRingkasanSheet(ws, parts, bg, RING, ongkir, bahan);
}

// ======================= Validasi Ongkir: resi -> pengiriman -> koli =======================
type OngkirRefs = { tagihan: { cell: string; v: number }; koli: { cell: string; v: number }; alloc: { cell: string; v: number }; noKoli: number; end: number };

function fillOngkirSheet(ws: Worksheet, mrpId: string, parts: VPart[], bg: string, base: number): OngkirRefs {
  vbanner(
    ws,
    base,
    `B. Ongkir per resi dan koli — ${mrpId}`,
    "Ongkir resi = tarif ekspedisi master × berat seluruh koli pengiriman itu. Ongkir koli (HARGA BIAYA PER KOLI) = ongkir resi × berat koli / berat resi. Ongkir/pcs = ongkir koli / pcs di koli. " +
      "Total per koli harus sama dengan tagihan resi, dan Σ (ongkir/pcs × Qty FG) harus sama dengan total koli. Nomor resi yang dipakai lebih dari sekali (dikirim beberapa kali) ditampilkan sebagai pengiriman terpisah. " +
      "Qty FG dijumlahkan dari baris On Going dan Final sekaligus, karena satu koli bisa berisi roll yang sudah dan yang belum ditutup.",
    bg
  );
  const all: VRoll[] = parts.flatMap((p) => p.rolls.map((r) => ({ ...r, part: p.key })));
  const rows = all.filter((r) => (r.ongkirResi ?? 0) > 0 && r.resi && r.koli);
  type Koli = { koli: string; beratKoli: number; ongkirKoli: number; pcsKoli: number; fgFinal: number; fgOn: number; alloc: number };
  type Grp = { vendor: string; resi: string; ongkirResi: number; beratResi: number; kolis: Map<string, Koli> };
  const groups = new Map<string, Grp>();
  for (const r of rows) {
    const vn = vendorName(r.vendor);
    const gk = [vn, r.resi, r.ongkirResi, r.beratResi].join("|");
    const g = groups.get(gk) ?? { vendor: vn, resi: r.resi, ongkirResi: r.ongkirResi as number, beratResi: r.beratResi ?? 0, kolis: new Map<string, Koli>() };
    const k = g.kolis.get(r.koli) ?? { koli: r.koli, beratKoli: r.beratKoli ?? 0, ongkirKoli: r.ongkirPcs * (r.pcsKoli ?? 0), pcsKoli: r.pcsKoli ?? 0, fgFinal: 0, fgOn: 0, alloc: 0 };
    if (r.part === "final") k.fgFinal += r.fg;
    else k.fgOn += r.fg;
    k.alloc += r.ongkirPcs * r.fg;
    g.kolis.set(r.koli, k);
    groups.set(gk, g);
  }
  const grpList = Array.from(groups.values()).sort((a, b) => a.vendor.localeCompare(b.vendor) || numCmp(a.resi, b.resi) || b.beratResi - a.beratResi);
  if (grpList.length === 0) {
    ws.getCell(base + 3, 1).value = "Belum ada baris dengan rincian ongkir resi dan koli.";
    return { tagihan: { cell: "0", v: 0 }, koli: { cell: "0", v: 0 }, alloc: { cell: "0", v: 0 }, noKoli: 0, end: base + 4 };
  }
  const resiKeys = Array.from(new Set(grpList.map((g) => g.vendor + "|" + g.resi)));
  const nResi = resiKeys.length;

  // ---- tata letak: ringkasan per nomor resi di atas, lalu blok per pengiriman ----
  const S0 = base + 3;
  const SH = S0 + 3;
  const SFIRST = SH + 1;
  const STOTAL = SFIRST + nResi;
  const T0 = STOTAL + 3;
  const TH = T0 + 3;
  let cursor = TH + 1;
  type Blk = { g: Grp; title: number; first: number; total: number; tagihan: number; selisih: number; kolis: Koli[]; idx: number; of: number };
  const blocks: Blk[] = grpList.map((g) => {
    const kolis = Array.from(g.kolis.values()).sort((a, b) => numCmp(a.koli, b.koli));
    const same = grpList.filter((x) => x.vendor === g.vendor && x.resi === g.resi);
    const b: Blk = { g, title: cursor, first: cursor + 1, total: cursor + 1 + kolis.length, tagihan: cursor + 2 + kolis.length, selisih: cursor + 3 + kolis.length, kolis, idx: same.indexOf(g) + 1, of: same.length };
    cursor += kolis.length + 5;
    return b;
  });

  // ---- 2) blok per pengiriman ----
  vsection(ws, T0, "B.2 Rincian per pengiriman → koli (harga biaya per koli)", "Satu blok per pengiriman. Baris koli: isi koli (pcs), Qty FG di laporan, ongkir koli, dan ongkir/pcs × Qty FG. Di bawahnya total koli dibandingkan tagihan resi.", 16);
  vhead(ws, TH, ["Vendor", "No Resi", "Ongkir Resi pengiriman (Rp)", "Berat Resi pengiriman (kg)", "No Koli", "Berat Koli (kg)", "Ongkir Koli (Rp)", "Pcs di Koli", "Qty FG Final", "Qty FG On Going", "Σ Qty FG di laporan", "Ongkir / pcs", "Teralokasi (Σ Ongkir/pcs × FG)", "Selisih Pcs", "Selisih Rp", "Status"], bg);
  const SOFTBLUE = "FFEFF6FF";
  for (const b of blocks) {
    const g = b.g;
    ws.mergeCells(b.title, 1, b.title, 16);
    vput(ws, b.title, 1, `No Resi: ${g.resi}  ·  ${g.vendor}  ·  pengiriman ${b.idx} dari ${b.of}${b.of > 1 ? " (nomor resi ini dipakai lebih dari sekali)" : ""}`, { bold: true, bg: SOFTBLUE });
    for (let c = 2; c <= 16; c++) ws.getCell(b.title, c).border = BORDER;
    b.kolis.forEach((k, i) => {
      const r = b.first + i;
      const match = (p: VPart) => `(${rngOf(p, "vendor")}=$A${r})*(${rngOf(p, "resi")}=$B${r})*(${rngOf(p, "koli")}=$E${r})*(${rngOf(p, "ongkirResi")}=$C${r})*(${rngOf(p, "beratResi")}=$D${r})`;
      const maxOf = (key: keyof typeof RC) => `MAX(${joinParts(parts, ",", (p) => `SUMPRODUCT(MAX(${match(p)}*${rngOf(p, key)}))`)})`;
      const fgOf = (part: "estimasi" | "final") => {
        const p = parts.find((x) => x.key === part);
        return p ? `SUMPRODUCT(${match(p)}*${rngOf(p, "fg")})` : "0";
      };
      const fgSum = k.fgFinal + k.fgOn;
      const ongkirPcs = k.pcsKoli === 0 ? 0 : k.ongkirKoli / k.pcsKoli;
      const dPcs = k.pcsKoli - fgSum;
      const dRp = k.ongkirKoli - k.alloc;
      const ok = dPcs === 0 && Math.abs(dRp) <= TOLERANCE;
      const status = ok ? "Cocok" : dPcs > 0 ? "Pcs di koli lebih banyak dari Qty FG baris HPP (ada pcs koli tanpa baris HPP)" : dPcs < 0 ? "Qty FG baris HPP lebih banyak dari isi koli (baris HPP melebihi isi koli)" : "Selisih pembulatan";
      vput(ws, r, 1, g.vendor);
      vput(ws, r, 2, g.resi);
      vput(ws, r, 3, g.ongkirResi, { fmt: "#,##0", color: INPUT_INK });
      vput(ws, r, 4, g.beratResi, { fmt: "#,##0.00", color: INPUT_INK });
      vput(ws, r, 5, k.koli);
      vput(ws, r, 6, f(maxOf("beratKoli"), k.beratKoli), { fmt: "#,##0.00" });
      vput(ws, r, 7, f(maxOf("ongkirKoli"), k.ongkirKoli), { fmt: "#,##0" });
      vput(ws, r, 8, f(maxOf("pcsKoli"), k.pcsKoli), { fmt: "#,##0" });
      vput(ws, r, 9, f(fgOf("final"), k.fgFinal), { fmt: "#,##0" });
      vput(ws, r, 10, f(fgOf("estimasi"), k.fgOn), { fmt: "#,##0" });
      vput(ws, r, 11, f(`I${r}+J${r}`, fgSum), { fmt: "#,##0" });
      vput(ws, r, 12, f(`IF(H${r}=0,0,G${r}/H${r})`, ongkirPcs), { fmt: "#,##0.00" });
      vput(ws, r, 13, f(joinParts(parts, "+", (p) => `SUMPRODUCT(${match(p)}*${rngOf(p, "ongkir")}*${rngOf(p, "fg")})`), k.alloc), { fmt: "#,##0" });
      vput(ws, r, 14, f(`H${r}-K${r}`, dPcs), { fmt: DIFF_FMT });
      vput(ws, r, 15, f(`G${r}-M${r}`, dRp), { fmt: DIFF_FMT });
      vput(ws, r, 16, f(`IF(AND(N${r}=0,ABS(O${r})<=${TOLERANCE}),"Cocok",IF(N${r}>0,"Pcs di koli lebih banyak dari Qty FG baris HPP (ada pcs koli tanpa baris HPP)",IF(N${r}<0,"Qty FG baris HPP lebih banyak dari isi koli (baris HPP melebihi isi koli)","Selisih pembulatan")))`, status), { align: "left", bold: true });
    });
    const f0 = b.first;
    const f1 = b.first + b.kolis.length - 1;
    const sumK = (fn: (k: Koli) => number) => vsum(b.kolis.map(fn));
    const tBerat = sumK((k) => k.beratKoli);
    const tOng = sumK((k) => k.ongkirKoli);
    const tPcs = sumK((k) => k.pcsKoli);
    const tFgF = sumK((k) => k.fgFinal);
    const tFgO = sumK((k) => k.fgOn);
    const tAlloc = sumK((k) => k.alloc);
    const T = b.total;
    vput(ws, T, 1, "Total koli di laporan", { bold: true, bg: SOFT, align: "right" });
    ws.mergeCells(T, 1, T, 5);
    vput(ws, T, 6, f(`SUM(F${f0}:F${f1})`, tBerat), { fmt: "#,##0.00", bold: true, bg: SOFT });
    vput(ws, T, 7, f(`SUM(G${f0}:G${f1})`, tOng), { fmt: "#,##0", bold: true, bg: SOFT });
    vput(ws, T, 8, f(`SUM(H${f0}:H${f1})`, tPcs), { fmt: "#,##0", bold: true, bg: SOFT });
    vput(ws, T, 9, f(`SUM(I${f0}:I${f1})`, tFgF), { fmt: "#,##0", bold: true, bg: SOFT });
    vput(ws, T, 10, f(`SUM(J${f0}:J${f1})`, tFgO), { fmt: "#,##0", bold: true, bg: SOFT });
    vput(ws, T, 11, f(`SUM(K${f0}:K${f1})`, tFgF + tFgO), { fmt: "#,##0", bold: true, bg: SOFT });
    vput(ws, T, 12, null, { bg: SOFT });
    vput(ws, T, 13, f(`SUM(M${f0}:M${f1})`, tAlloc), { fmt: "#,##0", bold: true, bg: SOFT });
    vput(ws, T, 14, f(`H${T}-K${T}`, tPcs - tFgF - tFgO), { fmt: DIFF_FMT, bold: true, bg: SOFT });
    vput(ws, T, 15, f(`G${T}-M${T}`, tOng - tAlloc), { fmt: DIFF_FMT, bold: true, bg: SOFT });
    vput(ws, T, 16, null, { bg: SOFT });
    const G = b.tagihan;
    for (const c of [7, 8, 9, 10, 11, 12, 13, 14, 15, 16]) vput(ws, G, c, null);
    vput(ws, G, 1, "Tagihan resi pengiriman ini (tarif × berat resi)", { bold: true, align: "right" });
    ws.mergeCells(G, 1, G, 5);
    vput(ws, G, 6, f(`D${b.first}`, g.beratResi), { fmt: "#,##0.00", bold: true });
    vput(ws, G, 7, f(`C${b.first}`, g.ongkirResi), { fmt: "#,##0", bold: true });
    const S = b.selisih;
    for (const c of [8, 9, 10, 11, 12, 13, 14, 15]) vput(ws, S, c, null);
    const dBerat = g.beratResi - tBerat;
    const dOng = g.ongkirResi - tOng;
    const okBlock = Math.abs(dBerat) <= 0.05 && Math.abs(dOng) <= TOLERANCE;
    vput(ws, S, 1, "Selisih tagihan resi − total koli", { bold: true, align: "right" });
    ws.mergeCells(S, 1, S, 5);
    vput(ws, S, 6, f(`F${G}-F${T}`, dBerat), { fmt: "#,##0.00;[Red]-#,##0.00", bold: true });
    vput(ws, S, 7, f(`G${G}-G${T}`, dOng), { fmt: DIFF_FMT, bold: true });
    vput(ws, S, 16, f(`IF(AND(ABS(F${S})<=0.05,ABS(G${S})<=${TOLERANCE}),"Cocok: total per koli = tagihan resi","Selisih: ada koli resi ini di luar laporan (MRP/vendor lain)")`, okBlock ? "Cocok: total per koli = tagihan resi" : "Selisih: ada koli resi ini di luar laporan (MRP/vendor lain)"), { align: "left", bold: true });
    statusRules(ws, `P${b.first}:P${b.first + b.kolis.length - 1}`, `P${b.first}`);
    statusRules(ws, `P${S}:P${S}`, `P${S}`);
  }

  // ---- 1) ringkasan per nomor resi (merujuk blok di bawah) ----
  vsection(ws, S0, "B.1 Ringkasan per nomor resi", "Satu baris per nomor resi (semua pengiriman dengan nomor itu dijumlahkan). Kolom Tagihan dan Ongkir koli membuktikan total per koli = total resi; kolom Teralokasi membuktikan ongkir/pcs × Qty FG kembali ke total koli.", 16);
  vhead(ws, SH, ["Vendor", "No Resi", "Jumlah pengiriman", "Tagihan resi (Σ pengiriman)", "Ongkir koli di laporan (Σ koli)", "Selisih tagihan − koli", "Teralokasi (Σ Ongkir/pcs × FG)", "Selisih koli − teralokasi", "Status"], bg, 16);
  let gTag = 0;
  let gKoli = 0;
  let gAlloc = 0;
  resiKeys.forEach((rk, i) => {
    const r = SFIRST + i;
    const bl = blocks.filter((b) => b.g.vendor + "|" + b.g.resi === rk);
    const tag = vsum(bl.map((b) => b.g.ongkirResi));
    const kol = vsum(bl.map((b) => vsum(b.kolis.map((k) => k.ongkirKoli))));
    const alc = vsum(bl.map((b) => vsum(b.kolis.map((k) => k.alloc))));
    gTag += tag;
    gKoli += kol;
    gAlloc += alc;
    const dA = tag - kol;
    const dB = kol - alc;
    const status = Math.abs(dA) <= TOLERANCE && Math.abs(dB) <= TOLERANCE ? "Cocok" : Math.abs(dA) > TOLERANCE ? "Selisih: ada koli resi ini di luar laporan (MRP/vendor lain)" : "Selisih: pcs di koli tidak sama dengan Qty FG baris HPP (lihat rincian per koli)";
    vput(ws, r, 1, bl[0].g.vendor, { bold: true });
    vput(ws, r, 2, bl[0].g.resi, { bold: true });
    vput(ws, r, 3, bl.length, { fmt: "#,##0" });
    vput(ws, r, 4, f(bl.map((b) => `G${b.tagihan}`).join("+"), tag), { fmt: "#,##0" });
    vput(ws, r, 5, f(bl.map((b) => `G${b.total}`).join("+"), kol), { fmt: "#,##0" });
    vput(ws, r, 6, f(`D${r}-E${r}`, dA), { fmt: DIFF_FMT });
    vput(ws, r, 7, f(bl.map((b) => `M${b.total}`).join("+"), alc), { fmt: "#,##0" });
    vput(ws, r, 8, f(`E${r}-G${r}`, dB), { fmt: DIFF_FMT });
    ws.mergeCells(r, 9, r, 16);
    vput(ws, r, 9, f(`IF(AND(ABS(F${r})<=${TOLERANCE},ABS(H${r})<=${TOLERANCE}),"Cocok",IF(ABS(F${r})>${TOLERANCE},"Selisih: ada koli resi ini di luar laporan (MRP/vendor lain)","Selisih: pcs di koli tidak sama dengan Qty FG baris HPP (lihat rincian per koli)"))`, status), { align: "left", bold: true });
    for (let c = 10; c <= 16; c++) ws.getCell(r, c).border = BORDER;
  });
  const gr = (col: string) => `SUM(${col}${SFIRST}:${col}${STOTAL - 1})`;
  vput(ws, STOTAL, 1, "Total semua resi", { bold: true, bg: SOFT });
  vput(ws, STOTAL, 2, null, { bg: SOFT });
  vput(ws, STOTAL, 3, f(gr("C"), blocks.length), { fmt: "#,##0", bold: true, bg: SOFT });
  vput(ws, STOTAL, 4, f(gr("D"), gTag), { fmt: "#,##0", bold: true, bg: SOFT });
  vput(ws, STOTAL, 5, f(gr("E"), gKoli), { fmt: "#,##0", bold: true, bg: SOFT });
  vput(ws, STOTAL, 6, f(`D${STOTAL}-E${STOTAL}`, gTag - gKoli), { fmt: DIFF_FMT, bold: true, bg: SOFT });
  vput(ws, STOTAL, 7, f(gr("G"), gAlloc), { fmt: "#,##0", bold: true, bg: SOFT });
  vput(ws, STOTAL, 8, f(`E${STOTAL}-G${STOTAL}`, gKoli - gAlloc), { fmt: DIFF_FMT, bold: true, bg: SOFT });
  ws.mergeCells(STOTAL, 9, STOTAL, 16);
  vput(ws, STOTAL, 9, null, { bg: SOFT });
  statusRules(ws, `I${SFIRST}:I${STOTAL - 1}`, `I${SFIRST}`);
  const q = (c: string) => `'${WS_VALIDASI}'!$${c}$${STOTAL}`;
  return { tagihan: { cell: q("D"), v: gTag }, koli: { cell: q("E"), v: gKoli }, alloc: { cell: q("G"), v: gAlloc }, noKoli: grpList.length, end: cursor };
}

// ======================= Validasi Bahan Diskon Rib: invoice, warna, roll =======================
type BahanRefs = {
  bahanPool: { cell: string; v: number };
  bahanAlloc: { cell: string; v: number };
  diskonPool: { cell: string; v: number };
  diskonAlloc: { cell: string; v: number };
  ribPool: { cell: string; v: number };
  ribAlloc: { cell: string; v: number };
  diskonInvoice: { cell: string; v: number };
  diskonInvoiceAlloc: { cell: string; v: number };
  ribWarna: { cell: string; v: number };
  ribWarnaAlloc: { cell: string; v: number };
  end: number;
};

function fillBahanSheet(ws: Worksheet, mrpId: string, parts: VPart[], bg: string, base: number): BahanRefs {
  vbanner(
    ws,
    base,
    `C. Bahan, Diskon, dan Rib — ${mrpId}`,
    "Bahan: biaya roll = berat × harga/kg. Diskon: porsi roll = diskon invoice × berat roll / total kg kain invoice. Rib: porsi roll = biaya rib warna × berat roll / total kg kain warna. " +
      "Per pcs = biaya roll (atau porsi) / pembagi. Total per roll harus kembali ke biayanya kalau Σ Qty FG di laporan = pembagi. Total per invoice (diskon) dan per warna (rib) kembali ke angka di invoice " +
      "kalau semua roll invoice/warna itu ada di laporan ini.",
    bg
  );
  const all: VRoll[] = parts.flatMap((p) => p.rolls.map((r) => ({ ...r, part: p.key })));
  const traced = all.filter((r) => (r.grossKg ?? 0) > 0);
  const firstOf = new Map<string, VRoll>();
  for (const r of traced) if (!firstOf.has(r.roll)) firstOf.set(r.roll, r);
  const rolls = Array.from(firstOf.values()).sort((a, b) => a.invoiceMaterial.localeCompare(b.invoiceMaterial) || a.warna.localeCompare(b.warna) || a.roll.localeCompare(b.roll));
  const empty: BahanRefs = {
    bahanPool: { cell: "0", v: 0 }, bahanAlloc: { cell: "0", v: 0 }, diskonPool: { cell: "0", v: 0 }, diskonAlloc: { cell: "0", v: 0 }, ribPool: { cell: "0", v: 0 }, ribAlloc: { cell: "0", v: 0 },
    diskonInvoice: { cell: "0", v: 0 }, diskonInvoiceAlloc: { cell: "0", v: 0 }, ribWarna: { cell: "0", v: 0 }, ribWarnaAlloc: { cell: "0", v: 0 }, end: base + 4,
  };
  if (rolls.length === 0) {
    ws.getCell(base + 3, 1).value = "Belum ada roll yang bisa ditelusuri ke invoice material.";
    return empty;
  }
  const rollNums = rolls.map((u) => {
    const mine = traced.filter((x) => x.roll === u.roll);
    const fg = vsum(mine.map((x) => x.fg));
    const aB = vsum(mine.map((x) => (x.bahanPcs + x.diskonPcs) * x.fg));
    const aD = vsum(mine.map((x) => x.diskonPcs * x.fg));
    const aR = vsum(mine.map((x) => x.ribPcs * x.fg));
    return { u, fg, aB, aD, aR };
  });
  const invoices = Array.from(new Set(rolls.map((u) => u.invoiceMaterial))).sort();
  const warnaInv = Array.from(new Map(rolls.filter((u) => (u.warnaRib ?? 0) > 0).map((u) => [u.warna + "|" + u.invoiceMaterial, u])).values()).sort((a, b) => a.warna.localeCompare(b.warna) || a.invoiceMaterial.localeCompare(b.invoiceMaterial));

  // ---- tata letak ----
  const A0 = base + 3;
  const AH = A0 + 3;
  const AFIRST = AH + 1;
  const ATOTAL = AFIRST + invoices.length;
  const B0 = ATOTAL + 3;
  const BH = B0 + 3;
  const BFIRST = BH + 1;
  const BTOTAL = BFIRST + warnaInv.length;
  const C0 = BTOTAL + 3;
  const CH = C0 + 3;
  const CFIRST = CH + 1;
  const CLAST = CFIRST + rolls.length - 1;
  const CTOTAL = CLAST + 1;
  const col = (c: string) => `$${c}$${CFIRST}:$${c}$${CLAST}`;

  // ---- 3) per roll ----
  vsection(ws, C0, "C.3 Per roll: bahan, diskon, rib", "Satu baris per roll yang bisa ditelusuri ke invoice material. Pembagi = pcs yang menanggung biaya roll (hasil cutting kalau roll belum ditutup, Finish Good kalau sudah). Σ Qty FG = pcs roll ini di laporan.", 16);
  vhead(ws, CH, ["Invoice Material", "Warna", "Code Roll", "Berat Roll (kg)", "Pembagi (pcs)", "Σ Qty FG di laporan", "Biaya Bahan Roll", "Teralokasi Bahan", "Selisih Bahan", "Diskon (porsi roll)", "Teralokasi Diskon", "Selisih Diskon", "Rib (porsi roll)", "Teralokasi Rib", "Selisih Rib", "Status"], bg);
  rollNums.forEach(({ u, fg, aB, aD, aR }, i) => {
    const r = CFIRST + i;
    const p = parts.find((x) => x.key === u.part) as VPart;
    const m = `(${rngOf(p, "roll")}=$C${r})`;
    const maxOf = (k: keyof typeof RC) => `SUMPRODUCT(MAX(${m}*${rngOf(p, k)}))`;
    const dB = u.biayaBahanRoll - aB;
    const dD = u.diskonRoll - aD;
    const dR = u.ribRoll - aR;
    const pemb = u.pembagi ?? 0;
    const ok = Math.abs(dB) <= TOLERANCE && Math.abs(dD) <= TOLERANCE && Math.abs(dR) <= TOLERANCE;
    const status = ok ? "Cocok" : fg < pemb ? "Qty FG di laporan < pembagi: sisa pcs roll belum terkirim / belum masuk koli" : fg > pemb ? "Qty FG di laporan > pembagi: cek roll ini" : "Selisih pembulatan";
    vput(ws, r, 1, u.invoiceMaterial);
    vput(ws, r, 2, u.warna);
    vput(ws, r, 3, u.roll);
    vput(ws, r, 4, f(maxOf("berat"), u.grossKg ?? 0), { fmt: "#,##0.00" });
    vput(ws, r, 5, f(maxOf("pembagi"), pemb), { fmt: "#,##0" });
    vput(ws, r, 6, f(`SUMPRODUCT(${m}*${rngOf(p, "fg")})`, fg), { fmt: "#,##0" });
    vput(ws, r, 7, f(maxOf("biaya"), u.biayaBahanRoll), { fmt: "#,##0" });
    vput(ws, r, 8, f(`SUMPRODUCT(${m}*(${rngOf(p, "bahan")}+${rngOf(p, "diskonPcs")})*${rngOf(p, "fg")})`, aB), { fmt: "#,##0" });
    vput(ws, r, 9, f(`G${r}-H${r}`, dB), { fmt: DIFF_FMT });
    vput(ws, r, 10, f(maxOf("diskon"), u.diskonRoll), { fmt: "#,##0" });
    vput(ws, r, 11, f(`SUMPRODUCT(${m}*${rngOf(p, "diskonPcs")}*${rngOf(p, "fg")})`, aD), { fmt: "#,##0" });
    vput(ws, r, 12, f(`J${r}-K${r}`, dD), { fmt: DIFF_FMT });
    vput(ws, r, 13, f(maxOf("rib"), u.ribRoll), { fmt: "#,##0" });
    vput(ws, r, 14, f(`SUMPRODUCT(${m}*${rngOf(p, "ribPcs")}*${rngOf(p, "fg")})`, aR), { fmt: "#,##0" });
    vput(ws, r, 15, f(`M${r}-N${r}`, dR), { fmt: DIFF_FMT });
    vput(
      ws,
      r,
      16,
      f(`IF(AND(ABS(I${r})<=${TOLERANCE},ABS(L${r})<=${TOLERANCE},ABS(O${r})<=${TOLERANCE}),"Cocok",IF(F${r}<E${r},"Qty FG di laporan < pembagi: sisa pcs roll belum terkirim / belum masuk koli",IF(F${r}>E${r},"Qty FG di laporan > pembagi: cek roll ini","Selisih pembulatan")))`, status),
      { align: "left", bold: true, wrap: true }
    );
  });
  const totC = (c: string) => `SUM(${c}${CFIRST}:${c}${CLAST})`;
  const tot = { D: vsum(rollNums.map((x) => x.u.grossKg ?? 0)), F: vsum(rollNums.map((x) => x.fg)), G: vsum(rollNums.map((x) => x.u.biayaBahanRoll)), H: vsum(rollNums.map((x) => x.aB)), J: vsum(rollNums.map((x) => x.u.diskonRoll)), K: vsum(rollNums.map((x) => x.aD)), M: vsum(rollNums.map((x) => x.u.ribRoll)), N: vsum(rollNums.map((x) => x.aR)) };
  vput(ws, CTOTAL, 1, "Total semua roll di laporan", { bold: true, bg: SOFT });
  for (const c of [2, 3, 5, 16]) vput(ws, CTOTAL, c, null, { bg: SOFT });
  vput(ws, CTOTAL, 4, f(totC("D"), tot.D), { fmt: "#,##0.00", bold: true, bg: SOFT });
  vput(ws, CTOTAL, 6, f(totC("F"), tot.F), { fmt: "#,##0", bold: true, bg: SOFT });
  vput(ws, CTOTAL, 7, f(totC("G"), tot.G), { fmt: "#,##0", bold: true, bg: SOFT });
  vput(ws, CTOTAL, 8, f(totC("H"), tot.H), { fmt: "#,##0", bold: true, bg: SOFT });
  vput(ws, CTOTAL, 9, f(`G${CTOTAL}-H${CTOTAL}`, tot.G - tot.H), { fmt: DIFF_FMT, bold: true, bg: SOFT });
  vput(ws, CTOTAL, 10, f(totC("J"), tot.J), { fmt: "#,##0", bold: true, bg: SOFT });
  vput(ws, CTOTAL, 11, f(totC("K"), tot.K), { fmt: "#,##0", bold: true, bg: SOFT });
  vput(ws, CTOTAL, 12, f(`J${CTOTAL}-K${CTOTAL}`, tot.J - tot.K), { fmt: DIFF_FMT, bold: true, bg: SOFT });
  vput(ws, CTOTAL, 13, f(totC("M"), tot.M), { fmt: "#,##0", bold: true, bg: SOFT });
  vput(ws, CTOTAL, 14, f(totC("N"), tot.N), { fmt: "#,##0", bold: true, bg: SOFT });
  vput(ws, CTOTAL, 15, f(`M${CTOTAL}-N${CTOTAL}`, tot.M - tot.N), { fmt: DIFF_FMT, bold: true, bg: SOFT });
  statusRules(ws, `P${CFIRST}:P${CLAST}`, `P${CFIRST}`);

  // ---- 1) per invoice material: bahan dan diskon ----
  vsection(ws, A0, "C.1 Per invoice material: bahan dan diskon", "Satu baris per invoice. Diskon invoice dibandingkan Σ porsi diskon roll di laporan (selisih = roll invoice itu yang tidak masuk laporan ini); porsi dibandingkan Σ diskon/pcs × Qty FG (selisih = pembagi ≠ Qty FG).", 16);
  vhead(ws, AH, ["Invoice Material", "Total kg kain invoice", "Σ kg roll di laporan", "Cakupan roll", "Σ Biaya Bahan Roll", "Σ Teralokasi Bahan", "Selisih Bahan", "Diskon invoice (Rp)", "Σ porsi diskon roll", "Σ Teralokasi Diskon", "Selisih diskon invoice − porsi", "Selisih porsi − teralokasi", "Status"], bg, 16);
  let invDiskonTot = 0;
  let invDiskonAlloc = 0;
  invoices.forEach((inv, i) => {
    const r = AFIRST + i;
    const mine = rollNums.filter((x) => x.u.invoiceMaterial === inv);
    const u0 = mine[0].u;
    const kgInv = u0.invKg ?? 0;
    const diskInv = u0.invDiskon ?? 0;
    const kgRoll = vsum(mine.map((x) => x.u.grossKg ?? 0));
    const sB = vsum(mine.map((x) => x.u.biayaBahanRoll));
    const sAB = vsum(mine.map((x) => x.aB));
    const sPD = vsum(mine.map((x) => x.u.diskonRoll));
    const sAD = vsum(mine.map((x) => x.aD));
    invDiskonTot += diskInv;
    invDiskonAlloc += sAD;
    const dBhn = sB - sAB;
    const dK = diskInv - sPD;
    const dL = sPD - sAD;
    const status = Math.abs(dK) <= TOLERANCE && Math.abs(dL) <= TOLERANCE && Math.abs(dBhn) <= TOLERANCE ? "Cocok" : Math.abs(dK) > TOLERANCE ? "Selisih: ada roll invoice ini di luar laporan (MRP/vendor lain)" : "Selisih: pembagi tidak sama dengan Qty FG (lihat per roll)";
    const maxInv = (k: keyof typeof RC) => `MAX(${joinParts(parts, ",", (p) => `SUMPRODUCT(MAX((${rngOf(p, "invoice")}=$A${r})*${rngOf(p, k)}))`)})`;
    vput(ws, r, 1, inv, { bold: true });
    vput(ws, r, 2, f(maxInv("invKg"), kgInv), { fmt: "#,##0.00" });
    vput(ws, r, 3, f(`SUMIFS(${col("D")},${col("A")},$A${r})`, kgRoll), { fmt: "#,##0.00" });
    vput(ws, r, 4, f(`IF(B${r}=0,"",C${r}/B${r})`, kgInv === 0 ? "" : kgRoll / kgInv), { fmt: "0.0%" });
    vput(ws, r, 5, f(`SUMIFS(${col("G")},${col("A")},$A${r})`, sB), { fmt: "#,##0" });
    vput(ws, r, 6, f(`SUMIFS(${col("H")},${col("A")},$A${r})`, sAB), { fmt: "#,##0" });
    vput(ws, r, 7, f(`E${r}-F${r}`, dBhn), { fmt: DIFF_FMT });
    vput(ws, r, 8, f(maxInv("invDiskon"), diskInv), { fmt: "#,##0" });
    vput(ws, r, 9, f(`SUMIFS(${col("J")},${col("A")},$A${r})`, sPD), { fmt: "#,##0" });
    vput(ws, r, 10, f(`SUMIFS(${col("K")},${col("A")},$A${r})`, sAD), { fmt: "#,##0" });
    vput(ws, r, 11, f(`H${r}-I${r}`, dK), { fmt: DIFF_FMT });
    vput(ws, r, 12, f(`I${r}-J${r}`, dL), { fmt: DIFF_FMT });
    ws.mergeCells(r, 13, r, 16);
    vput(ws, r, 13, f(`IF(AND(ABS(K${r})<=${TOLERANCE},ABS(L${r})<=${TOLERANCE},ABS(G${r})<=${TOLERANCE}),"Cocok",IF(ABS(K${r})>${TOLERANCE},"Selisih: ada roll invoice ini di luar laporan (MRP/vendor lain)","Selisih: pembagi tidak sama dengan Qty FG (lihat per roll)"))`, status), { align: "left", bold: true });
    for (let c = 14; c <= 16; c++) ws.getCell(r, c).border = BORDER;
  });
  const ta = (c: string) => `SUM(${c}${AFIRST}:${c}${ATOTAL - 1})`;
  vput(ws, ATOTAL, 1, "Total semua invoice", { bold: true, bg: SOFT });
  vput(ws, ATOTAL, 2, f(ta("B"), vsum(invoices.map((inv) => rollNums.find((x) => x.u.invoiceMaterial === inv)?.u.invKg ?? 0))), { fmt: "#,##0.00", bold: true, bg: SOFT });
  vput(ws, ATOTAL, 3, f(ta("C"), tot.D), { fmt: "#,##0.00", bold: true, bg: SOFT });
  vput(ws, ATOTAL, 4, null, { bg: SOFT });
  vput(ws, ATOTAL, 5, f(ta("E"), tot.G), { fmt: "#,##0", bold: true, bg: SOFT });
  vput(ws, ATOTAL, 6, f(ta("F"), tot.H), { fmt: "#,##0", bold: true, bg: SOFT });
  vput(ws, ATOTAL, 7, f(`E${ATOTAL}-F${ATOTAL}`, tot.G - tot.H), { fmt: DIFF_FMT, bold: true, bg: SOFT });
  vput(ws, ATOTAL, 8, f(ta("H"), invDiskonTot), { fmt: "#,##0", bold: true, bg: SOFT });
  vput(ws, ATOTAL, 9, f(ta("I"), tot.J), { fmt: "#,##0", bold: true, bg: SOFT });
  vput(ws, ATOTAL, 10, f(ta("J"), invDiskonAlloc), { fmt: "#,##0", bold: true, bg: SOFT });
  vput(ws, ATOTAL, 11, f(`H${ATOTAL}-I${ATOTAL}`, invDiskonTot - tot.J), { fmt: DIFF_FMT, bold: true, bg: SOFT });
  vput(ws, ATOTAL, 12, f(`I${ATOTAL}-J${ATOTAL}`, tot.J - invDiskonAlloc), { fmt: DIFF_FMT, bold: true, bg: SOFT });
  ws.mergeCells(ATOTAL, 13, ATOTAL, 16);
  vput(ws, ATOTAL, 13, null, { bg: SOFT });
  statusRules(ws, `M${AFIRST}:M${ATOTAL - 1}`, `M${AFIRST}`);

  // ---- 2) per warna: rib ----
  vsection(ws, B0, "C.2 Per warna: rib", "Satu baris per warna (dalam satu invoice). Biaya rib warna di invoice dibandingkan Σ porsi rib roll di laporan (selisih = roll warna itu yang tidak masuk laporan ini); porsi dibandingkan Σ rib/pcs × Qty FG (selisih = pembagi ≠ Qty FG).", 16);
  vhead(ws, BH, ["Warna", "Invoice Material", "Biaya rib warna di invoice (Rp)", "Total kg kain warna", "Σ kg roll di laporan", "Cakupan roll", "Σ porsi rib roll", "Σ Teralokasi Rib", "Selisih biaya rib − porsi", "Selisih porsi − teralokasi", "Status"], bg, 16);
  let ribTot = 0;
  let ribAllocW = 0;
  warnaInv.forEach((w, i) => {
    const r = BFIRST + i;
    const mine = rollNums.filter((x) => x.u.warna === w.warna && x.u.invoiceMaterial === w.invoiceMaterial);
    const biaya = w.warnaRib ?? 0;
    const kgW = w.warnaKg ?? 0;
    const kgRoll = vsum(mine.map((x) => x.u.grossKg ?? 0));
    const pr = vsum(mine.map((x) => x.u.ribRoll));
    const ar = vsum(mine.map((x) => x.aR));
    ribTot += biaya;
    ribAllocW += ar;
    const dI = biaya - pr;
    const dJ = pr - ar;
    const status = Math.abs(dI) <= TOLERANCE && Math.abs(dJ) <= TOLERANCE ? "Cocok" : Math.abs(dI) > TOLERANCE ? "Selisih: ada roll warna ini di luar laporan (MRP/vendor lain)" : "Selisih: pembagi tidak sama dengan Qty FG (lihat per roll)";
    const maxW = (k: keyof typeof RC) => `MAX(${joinParts(parts, ",", (p) => `SUMPRODUCT(MAX((${rngOf(p, "warna")}=$A${r})*(${rngOf(p, "invoice")}=$B${r})*${rngOf(p, k)}))`)})`;
    vput(ws, r, 1, w.warna, { bold: true });
    vput(ws, r, 2, w.invoiceMaterial);
    vput(ws, r, 3, f(maxW("warnaRib"), biaya), { fmt: "#,##0" });
    vput(ws, r, 4, f(maxW("warnaKg"), kgW), { fmt: "#,##0.00" });
    vput(ws, r, 5, f(`SUMIFS(${col("D")},${col("B")},$A${r},${col("A")},$B${r})`, kgRoll), { fmt: "#,##0.00" });
    vput(ws, r, 6, f(`IF(D${r}=0,"",E${r}/D${r})`, kgW === 0 ? "" : kgRoll / kgW), { fmt: "0.0%" });
    vput(ws, r, 7, f(`SUMIFS(${col("M")},${col("B")},$A${r},${col("A")},$B${r})`, pr), { fmt: "#,##0" });
    vput(ws, r, 8, f(`SUMIFS(${col("N")},${col("B")},$A${r},${col("A")},$B${r})`, ar), { fmt: "#,##0" });
    vput(ws, r, 9, f(`C${r}-G${r}`, dI), { fmt: DIFF_FMT });
    vput(ws, r, 10, f(`G${r}-H${r}`, dJ), { fmt: DIFF_FMT });
    ws.mergeCells(r, 11, r, 16);
    vput(ws, r, 11, f(`IF(AND(ABS(I${r})<=${TOLERANCE},ABS(J${r})<=${TOLERANCE}),"Cocok",IF(ABS(I${r})>${TOLERANCE},"Selisih: ada roll warna ini di luar laporan (MRP/vendor lain)","Selisih: pembagi tidak sama dengan Qty FG (lihat per roll)"))`, status), { align: "left", bold: true });
    for (let c = 12; c <= 16; c++) ws.getCell(r, c).border = BORDER;
  });
  const tb = (c: string) => `SUM(${c}${BFIRST}:${c}${BTOTAL - 1})`;
  const ribPorsi = vsum(warnaInv.map((w) => vsum(rollNums.filter((x) => x.u.warna === w.warna && x.u.invoiceMaterial === w.invoiceMaterial).map((x) => x.u.ribRoll))));
  vput(ws, BTOTAL, 1, "Total semua warna", { bold: true, bg: SOFT });
  vput(ws, BTOTAL, 2, null, { bg: SOFT });
  vput(ws, BTOTAL, 3, f(tb("C"), ribTot), { fmt: "#,##0", bold: true, bg: SOFT });
  vput(ws, BTOTAL, 4, null, { bg: SOFT });
  vput(ws, BTOTAL, 5, null, { bg: SOFT });
  vput(ws, BTOTAL, 6, null, { bg: SOFT });
  vput(ws, BTOTAL, 7, f(tb("G"), ribPorsi), { fmt: "#,##0", bold: true, bg: SOFT });
  vput(ws, BTOTAL, 8, f(tb("H"), ribAllocW), { fmt: "#,##0", bold: true, bg: SOFT });
  vput(ws, BTOTAL, 9, f(`C${BTOTAL}-G${BTOTAL}`, ribTot - ribPorsi), { fmt: DIFF_FMT, bold: true, bg: SOFT });
  vput(ws, BTOTAL, 10, f(`G${BTOTAL}-H${BTOTAL}`, ribPorsi - ribAllocW), { fmt: DIFF_FMT, bold: true, bg: SOFT });
  ws.mergeCells(BTOTAL, 11, BTOTAL, 16);
  vput(ws, BTOTAL, 11, null, { bg: SOFT });
  statusRules(ws, `K${BFIRST}:K${BTOTAL - 1}`, `K${BFIRST}`);

  const q = (c: string, row: number) => `'${WS_VALIDASI}'!$${c}$${row}`;
  return {
    bahanPool: { cell: q("G", CTOTAL), v: tot.G },
    bahanAlloc: { cell: q("H", CTOTAL), v: tot.H },
    diskonPool: { cell: q("J", CTOTAL), v: tot.J },
    diskonAlloc: { cell: q("K", CTOTAL), v: tot.K },
    ribPool: { cell: q("M", CTOTAL), v: tot.M },
    ribAlloc: { cell: q("N", CTOTAL), v: tot.N },
    diskonInvoice: { cell: q("H", ATOTAL), v: invDiskonTot },
    diskonInvoiceAlloc: { cell: q("J", ATOTAL), v: invDiskonAlloc },
    ribWarna: { cell: q("C", BTOTAL), v: ribTot },
    ribWarnaAlloc: { cell: q("H", BTOTAL), v: ribAllocW },
    end: CTOTAL,
  };
}

// ======================= A. Ringkasan =======================
function fillRingkasanSheet(ws: Worksheet, parts: VPart[], bg: string, base: number, ongkir: OngkirRefs, bahan: BahanRefs) {
  const all = parts.flatMap((p) => p.rolls);
  const sumPartsExpr = (fn: (p: VPart) => string) => joinParts(parts, "+", fn);
  const berat = (p: VPart) => rngOf(p, "berat");
  const fg = (p: VPart) => rngOf(p, "fg");
  const tracedRows = all.filter((r) => (r.grossKg ?? 0) > 0);
  const bahanNet = vsum(tracedRows.map((r) => r.bahanPcs * r.fg));
  const noKoliOng = vsum(all.filter((r) => !((r.ongkirResi ?? 0) > 0)).map((r) => r.ongkirPcs * r.fg));
  const totalHpp = vsum(all.map((r) => r.totalHpp));
  const totalKomp = vsum(all.map((r) => (r.bahanPcs + r.ribPcs + r.maklonPcs + r.ongkirPcs) * r.fg));

  const S0 = base;
  vsection(ws, S0, "A. Ringkasan: total sumber vs jumlah per pcs (On Going + Final)", "Selisih = total sumber dikurangi teralokasi; positif berarti ada biaya yang belum terbagi ke pcs di laporan ini.", NCOL);
  const SH = S0 + 3;
  vhead(ws, SH, ["Komponen", "Total sumber (pool)", "Teralokasi (Σ per pcs × Qty FG)", "Selisih", "% Teralokasi", "Status", "Penjelasan"], bg, NCOL);
  type Row = { label: string; pool: CellValue | null; alloc: CellValue; poolV: number | null; allocV: number; note: string };
  const R = (i: number) => SH + 1 + i;
  const rows: Row[] = [
    { label: "Bahan kain sebelum diskon", pool: f(bahan.bahanPool.cell, bahan.bahanPool.v), alloc: f(bahan.bahanAlloc.cell, bahan.bahanAlloc.v), poolV: bahan.bahanPool.v, allocV: bahan.bahanAlloc.v, note: "Pool = Σ biaya tiap roll (berat × harga/kg). Teralokasi = Σ (bahan/pcs + diskon/pcs) × Qty FG. Rincian per invoice dan roll: bagian C di bawah." },
    { label: "Diskon invoice (porsi roll)", pool: f(bahan.diskonPool.cell, bahan.diskonPool.v), alloc: f(bahan.diskonAlloc.cell, bahan.diskonAlloc.v), poolV: bahan.diskonPool.v, allocV: bahan.diskonAlloc.v, note: "Pool = Σ porsi diskon roll. Teralokasi = Σ Diskon/pcs × Qty FG. Selisih hanya karena pembagi ≠ Qty FG." },
    {
      label: "Bahan kain setelah diskon",
      pool: f(`B${R(0)}-B${R(1)}`, bahan.bahanPool.v - bahan.diskonPool.v),
      alloc: f(sumPartsExpr((p) => `SUMPRODUCT((${berat(p)}>0)*${rngOf(p, "bahan")}*${fg(p)})`), bahanNet),
      poolV: bahan.bahanPool.v - bahan.diskonPool.v,
      allocV: bahanNet,
      note: "Pool = bahan sebelum diskon dikurangi diskon. Teralokasi = Σ Bahan/pcs × Qty FG (Bahan/pcs sudah setelah diskon).",
    },
    { label: "Rib (porsi roll)", pool: f(bahan.ribPool.cell, bahan.ribPool.v), alloc: f(bahan.ribAlloc.cell, bahan.ribAlloc.v), poolV: bahan.ribPool.v, allocV: bahan.ribAlloc.v, note: "Pool = Σ porsi rib roll (biaya rib warna × berat roll / total kg kain warna). Teralokasi = Σ Rib/pcs × Qty FG. Selisih hanya karena pembagi ≠ Qty FG." },
    { label: "Diskon: total diskon di invoice material", pool: f(bahan.diskonInvoice.cell, bahan.diskonInvoice.v), alloc: f(bahan.diskonInvoiceAlloc.cell, bahan.diskonInvoiceAlloc.v), poolV: bahan.diskonInvoice.v, allocV: bahan.diskonInvoiceAlloc.v, note: "Angka diskon di invoice. Selisih ke 'porsi roll' = roll invoice itu yang tidak masuk laporan ini (diskon dibagi ke semua roll invoice), lalu pembagi ≠ Qty FG." },
    { label: "Rib: total biaya rib per warna di invoice", pool: f(bahan.ribWarna.cell, bahan.ribWarna.v), alloc: f(bahan.ribWarnaAlloc.cell, bahan.ribWarnaAlloc.v), poolV: bahan.ribWarna.v, allocV: bahan.ribWarnaAlloc.v, note: "Angka total rib di invoice (mis. Rp 100.000 per warna). Selisih ke Rib per pcs: roll warna itu yang tidak masuk laporan ini (rib dibagi ke semua roll warna), lalu pembagi ≠ Qty FG." },
    { label: "Ongkir: tagihan ekspedisi per resi", pool: f(ongkir.tagihan.cell, ongkir.tagihan.v), alloc: f(ongkir.alloc.cell, ongkir.alloc.v), poolV: ongkir.tagihan.v, allocV: ongkir.alloc.v, note: "Pool = Σ tagihan semua pengiriman (tarif master × berat seluruh koli). Nomor resi yang dipakai beberapa kali dijumlahkan per pengiriman. Rincian: bagian B di bawah." },
    { label: "Ongkir: koli yang ikut laporan ini", pool: f(ongkir.koli.cell, ongkir.koli.v), alloc: f(ongkir.alloc.cell, ongkir.alloc.v), poolV: ongkir.koli.v, allocV: ongkir.alloc.v, note: "Pool = Σ ongkir koli (harga biaya per koli). Selisih = pcs di koli tidak sama dengan Qty FG baris HPP; koli mana-nya terlihat di bagian B di bawah." },
    {
      label: "Ongkir pada baris tanpa rincian koli (rework / data lama)",
      pool: null,
      alloc: f(sumPartsExpr((p) => `SUMPRODUCT((${rngOf(p, "ongkirResi")}=0)*${rngOf(p, "ongkir")}*${fg(p)})`), noKoliOng),
      poolV: null,
      allocV: noKoliOng,
      note: "Info: ongkir/pcs × Qty FG pada baris yang tidak bisa ditelusuri ke satu koli (rework atau data lama). Tidak punya total sumber, jadi tidak dibandingkan.",
    },
    {
      label: "Total HPP = Σ komponen per pcs × Qty FG",
      pool: f(sumPartsExpr((p) => `SUM(${rngOf(p, "total")})`), totalHpp),
      alloc: f(sumPartsExpr((p) => `SUMPRODUCT((${rngOf(p, "bahan")}+${rngOf(p, "ribPcs")}+${rngOf(p, "maklon")}+${rngOf(p, "ongkir")})*${fg(p)})`), totalKomp),
      poolV: totalHpp,
      allocV: totalKomp,
      note: "Pemeriksaan rumus: kolom Total HPP di Detail Roll harus sama dengan bahan + rib + maklon + ongkir per pcs × Qty FG. Selisih = ada baris yang rumusnya tidak konsisten.",
    },
  ];
  rows.forEach((s, i) => {
    const r = R(i);
    ws.getRow(r).height = 44;
    vput(ws, r, 1, s.label, { bold: true, wrap: true });
    if (s.poolV === null) {
      vput(ws, r, 2, "—", { align: "right" });
      vput(ws, r, 3, s.alloc, { fmt: "#,##0" });
      vput(ws, r, 4, "—", { align: "right" });
      vput(ws, r, 5, "—", { align: "right" });
      vput(ws, r, 6, "Info", { align: "center", bold: true, color: "FF6B7280" });
    } else {
      const diff = s.poolV - s.allocV;
      vput(ws, r, 2, s.pool, { fmt: "#,##0" });
      vput(ws, r, 3, s.alloc, { fmt: "#,##0" });
      vput(ws, r, 4, f(`B${r}-C${r}`, diff), { fmt: DIFF_FMT });
      vput(ws, r, 5, f(`IF(B${r}=0,"",C${r}/B${r})`, s.poolV === 0 ? "" : s.allocV / s.poolV), { fmt: "0.0%" });
      vput(ws, r, 6, f(`IF(ABS(D${r})<=${TOLERANCE},"Cocok","Selisih")`, Math.abs(diff) <= TOLERANCE ? "Cocok" : "Selisih"), { align: "center", bold: true });
    }
    ws.mergeCells(r, 7, r, NCOL);
    vput(ws, r, 7, s.note, { wrap: true, color: "FF4B5563" });
    for (let c = 8; c <= NCOL; c++) ws.getCell(r, c).border = BORDER;
  });
  if (rows.length !== RINGKASAN_ROWS) throw new Error("RINGKASAN_ROWS tidak sama dengan jumlah baris ringkasan");
  statusRules(ws, `F${R(0)}:F${R(rows.length - 1)}`, `F${R(0)}`);
}
