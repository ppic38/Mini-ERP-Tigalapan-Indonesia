import type { Workbook } from "exceljs";
import { targetSizesForBatch } from "./derive";
import { PRODUKSI_HEADERS, REJECT_HEADERS, REWORK_HEADERS, SHEET_TAB_PRODUKSI, SHEET_TAB_REJECT, SHEET_TAB_REWORK, SHEET_TZ_OFFSET_MIN } from "./vendorSheet";
import type { AduanPolaRow, ProductionBatch, ProductionGroupMeta, ProductionResult } from "./types";

// Template spreadsheet sinkron vendor (owner 2026-11-16, khusus BAYU): satu file per PO/MRP berisi tab "Produksi" (satu baris per roll x size), "Reject" (klasifikasi reject
// per warna·lengan), "Rework" (rework yang sudah tercatat), dan "Petunjuk". Terisi dengan keadaan ERP saat ini; vendor/sistemnya mengisi kolom Hasil Cutting, Finish Good,
// dst., lalu mempublikasikan spreadsheet ke web dan menempelkan tautannya di portal. Pembacaan memakai JUDUL KOLOM (lib/mrp/vendorSheet.ts), jadi judulnya tidak boleh diubah.

const SIZE_ORDER = ["XXS", "XS", "S", "M", "L", "XL", "2XL", "3XL", "4XL", "5XL", "6XL"];
const sizeRank = (s: string) => {
  const i = SIZE_ORDER.indexOf(s.toUpperCase());
  return i === -1 ? 999 : i;
};
const lenganLabel = (l: string) => (l === "PENDEK" ? "Pendek" : "Panjang");
const HEAD_BG = "FF2563EB";
/** Jam dinding WIB (UTC+7) sebagai Date berkomponen-UTC, supaya Excel menampilkan jam WIB; pembacaan di ERP mengembalikannya ke WIB (lihat SHEET_TZ_OFFSET_MIN di vendorSheet.ts). */
const wibWall = (iso: string) => new Date(Date.parse(iso) + SHEET_TZ_OFFSET_MIN * 60000);
const INPUT_BG = "FFFFF7D6";

export type VendorSheetTemplateInput = {
  mrpId: string;
  vendorId: string;
  batches: ProductionBatch[];
  aduanRows: AduanPolaRow[];
  metas: ProductionGroupMeta[];
  results: ProductionResult[];
};

export async function buildVendorSheetTemplate(input: VendorSheetTemplateInput): Promise<Workbook> {
  const ExcelJS = (await import("exceljs")).default;
  const wb: Workbook = new ExcelJS.Workbook();
  wb.creator = "Mini ERP Tigalapan";
  wb.created = new Date();

  const head = (ws: import("exceljs").Worksheet, headers: string[], inputCols: number[], widths: number[]) => {
    ws.columns = widths.map((w) => ({ width: w }));
    const row = ws.getRow(1);
    headers.forEach((h, i) => {
      const c = row.getCell(i + 1);
      c.value = h;
      c.font = { name: "Calibri", size: 10, bold: true, color: { argb: "FFFFFFFF" } };
      c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: inputCols.includes(i + 1) ? "FFB45309" : HEAD_BG } };
      c.alignment = { vertical: "middle", horizontal: "left" };
    });
    row.height = 22;
    ws.views = [{ state: "frozen", ySplit: 1 }];
  };
  const shadeInputs = (ws: import("exceljs").Worksheet, rowNo: number, cols: number[]) => {
    for (const c of cols) ws.getRow(rowNo).getCell(c).fill = { type: "pattern", pattern: "solid", fgColor: { argb: INPUT_BG } };
  };

  const batches = input.batches
    .filter((b) => b.mrpId === input.mrpId && b.vendorProduksi === input.vendorId && b.codeRoll)
    .sort((a, b) => (a.codeRoll ?? "").localeCompare(b.codeRoll ?? "", "id-ID", { numeric: true }));

  // ---------- Produksi ----------
  const prod = wb.addWorksheet(SHEET_TAB_PRODUKSI);
  head(prod, PRODUKSI_HEADERS, [7, 8, 9], [10, 18, 24, 10, 8, 9, 14, 14, 14]);
  let r = 2;
  for (const b of batches) {
    const target = targetSizesForBatch(b, input.aduanRows);
    const sizes = Array.from(new Set([...Object.keys(target), ...Object.keys(b.sizeQty ?? {}), ...Object.keys(b.fgSizeQty ?? {})])).sort((a, c) => sizeRank(a) - sizeRank(c) || a.localeCompare(c, "id-ID", { numeric: true }));
    for (const size of sizes) {
      const cut = b.sizeQty?.[size];
      const fg = b.fgSizeQty?.[size];
      const row = prod.getRow(r);
      [b.mrpId, b.codeRoll, b.warna, lenganLabel(b.lengan), size, target[size] ?? "", b.cuttingAt ? wibWall(b.cuttingAt) : "", cut && cut > 0 ? cut : "", fg && fg > 0 ? fg : ""].forEach((v, i) => {
        row.getCell(i + 1).value = v === "" ? null : (v as string | number);
      });
      shadeInputs(prod, r, [7, 8, 9]);
      prod.getRow(r).getCell(7).numFmt = "yyyy-mm-dd hh:mm";
      r++;
    }
  }
  prod.autoFilter = { from: { row: 1, column: 1 }, to: { row: Math.max(1, r - 1), column: PRODUKSI_HEADERS.length } };

  // ---------- Reject ----------
  const rej = wb.addWorksheet(SHEET_TAB_REJECT);
  head(rej, REJECT_HEADERS, [4, 5], [10, 24, 10, 16, 16]);
  const groups = new Map<string, { warna: string; lengan: string }>();
  for (const b of batches) groups.set(`${b.mrpId}|${b.warna}|${b.lengan}`, { warna: b.warna, lengan: b.lengan });
  r = 2;
  for (const [key, g] of Array.from(groups.entries()).sort((a, b) => a[0].localeCompare(b[0], "id-ID"))) {
    const meta = input.metas.find((m) => m.groupKey === key && m.vendorProduksi === input.vendorId);
    const row = rej.getRow(r);
    row.getCell(1).value = input.mrpId;
    row.getCell(2).value = g.warna;
    row.getCell(3).value = lenganLabel(g.lengan);
    if (meta?.rejectMaterialQty !== undefined) row.getCell(4).value = meta.rejectMaterialQty;
    if (meta?.rejectProsesQty !== undefined) row.getCell(5).value = meta.rejectProsesQty;
    shadeInputs(rej, r, [4, 5]);
    r++;
  }

  // ---------- Rework (yang sudah tercatat di ERP) ----------
  const rw = wb.addWorksheet(SHEET_TAB_REWORK);
  head(rw, REWORK_HEADERS, [8], [10, 24, 14, 11, 10, 15, 13, 12]);
  const agg = new Map<string, { warna: string; fromLengan: string; fromSize: string; usia: string; toLengan: string; toSize: string; qty: number }>();
  for (const res of input.results) {
    if (res.mrpId !== input.mrpId || res.vendorProduksi !== input.vendorId || res.kind !== "REJECT") continue;
    const m = /^Rework (\d+) pcs ke (PENDEK|PANJANG) size (\S+) \((KIDS|DEWASA)\)$/.exec(res.note ?? "");
    if (!m) continue;
    const from = Object.entries(res.sizeQty).find(([, q]) => q < 0);
    if (!from) continue;
    const key = [res.warna, res.lengan, from[0], m[4], m[2], m[3]].join("|");
    const cur = agg.get(key) ?? { warna: res.warna, fromLengan: res.lengan, fromSize: from[0], usia: m[4], toLengan: m[2], toSize: m[3], qty: 0 };
    cur.qty += Number(m[1]);
    agg.set(key, cur);
  }
  r = 2;
  for (const a of agg.values()) {
    const row = rw.getRow(r);
    [input.mrpId, a.warna, lenganLabel(a.fromLengan), a.fromSize, a.usia === "KIDS" ? "Kids" : "Dewasa", lenganLabel(a.toLengan), a.toSize, a.qty].forEach((v, i) => {
      row.getCell(i + 1).value = v;
    });
    shadeInputs(rw, r, [8]);
    r++;
  }

  // ---------- Petunjuk ----------
  const help = wb.addWorksheet("Petunjuk");
  help.columns = [{ width: 110 }];
  const lines = [
    `Template sinkron ERP Tigalapan — MRP ${input.mrpId}`,
    "",
    "Cara pakai:",
    "1. Unggah file ini ke Google Sheets (jangan ubah nama tab Produksi / Reject / Rework dan JANGAN ubah judul kolom di baris 1).",
    "2. Sistem Anda mengisi kolom berwarna kuning: Waktu Cutting (tanggal + jam WIB, wajib untuk hasil cutting baru), Hasil Cutting, Finish Good (tab Produksi); Reject Material dan Reject Produksi (tab Reject); Qty Rework (tab Rework).",
    "3. Google Sheets: File > Bagikan > Publikasikan ke web > pilih \"Seluruh dokumen\" dan format \"Microsoft Excel (.xlsx)\" > Publikasikan. Salin tautannya.",
    "4. Portal ERP > PO Produksi Saya > kolom Spreadsheet (baris MRP ini) > Tambah: tempel tautan dan Simpan. Satu spreadsheet = satu MRP. Selanjutnya ERP membaca spreadsheet otomatis; pakai tombol Sinkron kalau ada data yang belum sinkron.",
    "",
    "Aturan baca:",
    "- Satu baris per roll x size (tab Produksi). Code Roll dan No MRP harus sama persis dengan di ERP. Data sebuah roll baru diterima setelah rollnya di-Good Receive dan di-Resting di ERP (roll dibuat lewat Resting, bukan lewat spreadsheet); roll dari invoice yang belum tiba dilaporkan dan diterima belakangan.",
    "- Sel kosong = tidak diubah. Angka 0 berarti nol. Hasil Cutting yang sudah ada di ERP tidak dihapus oleh sel kosong/0.",
    "- Finish Good tidak boleh melebihi Hasil Cutting. Roll yang sudah ditutup, sudah masuk resi, atau punya alih size/hasil tambahan sisa kain tidak diubah dari spreadsheet (dilaporkan di portal).",
    "- Reject: isi Reject Material DAN Reject Produksi; jumlahnya harus sama dengan total reject warna·lengan itu di ERP (reject dihitung setelah Selesai Produksi di tab Finish Good).",
    "- Rework: tulis total rework per kombinasi (asal -> tujuan). ERP hanya menambah selisihnya; mengurangi rework tidak dilakukan otomatis.",
    "- Publish to web memakan waktu beberapa menit untuk memuat perubahan terbaru dari Google.",
  ];
  lines.forEach((t, i) => {
    const c = help.getCell(i + 1, 1);
    c.value = t;
    c.alignment = { wrapText: true, vertical: "top" };
    if (i === 0) c.font = { name: "Calibri", size: 13, bold: true };
  });
  return wb;
}

export async function exportVendorSheetTemplate(input: VendorSheetTemplateInput, fileName: string): Promise<void> {
  const wb = await buildVendorSheetTemplate(input);
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
