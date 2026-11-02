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
  rib: 15, pembagi: 16, fg: 17, resi: 18, koli: 19, bahan: 20, diskonPcs: 21, ribPcs: 22, cogs: 23, maklon: 24, ongkir: 25, hpp: 26, jual: 27, ratio: 28, total: 29,
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
  { head: "Biaya Bahan Roll\n= Berat x Harga/kg", width: 15, kind: "rp" },
  { head: "Diskon Invoice (Rp)", width: 13, kind: "rp" },
  { head: "Total kg Kain Invoice", width: 12, kind: "dec" },
  { head: "Diskon (porsi roll)\n= Diskon x Berat / kg Invoice", width: 17, kind: "rp" },
  { head: "Biaya Rib Warna (Rp)", width: 13, kind: "rp" },
  { head: "Total kg Kain Warna", width: 12, kind: "dec" },
  { head: "Rib (porsi roll)\n= Rib Warna x Berat / kg Warna", width: 17, kind: "rp" },
  { head: "Pembagi (pcs)", width: 10, kind: "int" },
  { head: "Qty FG (pcs)", width: 10, kind: "int" },
  { head: "No Resi", width: 18, kind: "text" },
  { head: "No Koli", width: 14, kind: "text" },
  { head: "Bahan/pcs\n= (Biaya - Diskon) / Pembagi", width: 18, kind: "rp" },
  { head: "Diskon/pcs\n= Diskon / Pembagi", width: 13, kind: "rp" },
  { head: "Rib/pcs\n= Rib / Pembagi", width: 12, kind: "rp" },
  { head: "COGS Bahan/pcs\n= Bahan + Rib", width: 14, kind: "rp" },
  { head: "Maklon/pcs", width: 11, kind: "rp" },
  { head: "Ongkir/pcs", width: 11, kind: "rp" },
  { head: "HPP/pcs\n= COGS + Maklon + Ongkir", width: 17, kind: "rp" },
  { head: "Harga Jual", width: 11, kind: "rp" },
  { head: "Ratio HPP\n= HPP / Harga Jual", width: 14, kind: "pct" },
  { head: "Total HPP (Rp)\n= HPP x Qty FG", width: 16, kind: "rp" },
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
  set("ongkir", r.ongkirPcs);
  set("jual", r.hargaJual);
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
  { head: "Qty FG (pcs)\n= jumlah di Detail Roll", width: 14, kind: "int" },
  { head: "Bahan/pcs (setelah diskon)\n= rata-rata tertimbang", width: 16, kind: "rp" },
  { head: "Rib/pcs\n= rata-rata tertimbang", width: 13, kind: "rp" },
  { head: "COGS Bahan/pcs\n= Bahan + Rib", width: 14, kind: "rp" },
  { head: "Maklon/pcs\n= rata-rata tertimbang", width: 14, kind: "rp" },
  { head: "Ongkir/pcs\n= rata-rata tertimbang", width: 14, kind: "rp" },
  { head: "HPP/pcs\n= COGS + Maklon + Ongkir", width: 17, kind: "rp" },
  { head: "HPP Min\n= terendah di Detail Roll", width: 15, kind: "rp" },
  { head: "HPP Maks\n= tertinggi di Detail Roll", width: 15, kind: "rp" },
  { head: "Harga Jual\n= rata-rata tertimbang", width: 14, kind: "rp" },
  { head: "Ratio HPP\n= HPP / Harga Jual", width: 13, kind: "pct" },
  { head: "Total HPP (Rp)\n= jumlah di Detail Roll", width: 16, kind: "rp" },
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

export async function exportHppExcel(mrpId: string, report: HppReport, fileName: string) {
  const ExcelJS = (await import("exceljs")).default;
  const wb: Workbook = new ExcelJS.Workbook();
  wb.creator = "Tigalapan Indonesia";
  wb.created = new Date();
  // Excel menghitung ulang semua rumus saat dibuka (nilai tersimpan hanya cadangan untuk penampil yang tidak menghitung).
  wb.calcProperties.fullCalcOnLoad = true;
  const stamp = new Date().toLocaleString("id-ID");
  const rumus =
    "Rumus per pcs: Bahan = (biaya bahan roll - porsi diskon) / pembagi; Diskon roll = diskon invoice / total kg kain invoice x berat roll; Rib = biaya rib warna / total kg kain warna x berat roll / pembagi; " +
    "COGS Bahan = Bahan + Rib; HPP = COGS Bahan + Maklon + Ongkir; Ratio HPP = HPP / Harga Jual. Maklon/pcs = harga maklon master; Ongkir/pcs = tarif ekspedisi x berat koli / pcs resi (angka masukan). " +
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
