import type { Workbook, Worksheet } from "exceljs";
import { targetSizesForBatch } from "./derive";
import {
  PENERIMAAN_HEADERS,
  PRODUKSI_HEADERS,
  REJECT_HEADERS,
  RESTING_HEADERS,
  REWORK_HEADERS,
  SHEET_TAB_PENERIMAAN,
  SHEET_TAB_PRODUKSI,
  SHEET_TAB_REJECT,
  SHEET_TAB_RESTING,
  SHEET_TAB_REWORK,
  SHEET_TZ_OFFSET_MIN,
} from "./vendorSheet";
import type { AduanPolaRow, ProductionBatch, ProductionGroupMeta, ProductionResult, RawMaterialInvoice } from "./types";

// Template spreadsheet sinkron vendor (owner 2026-11-16/17, khusus BAYU): satu file per MRP. Tab "Penerimaan" (pengganti Good Receive, satu baris per roll invoice supplier), "Resting"
// (satu baris per roll yang kode rollnya sudah diketahui), "Produksi" (satu baris per roll x size dengan target), "Reject" (klasifikasi per warna·lengan), "Rework" (yang sudah tercatat),
// dan "Petunjuk". Terisi dengan keadaan ERP saat ini; vendor/sistemnya mengisi kolom kuning, lalu mempublikasikan spreadsheet ke web dan menempelkan tautannya di portal.
// Pembacaan memakai JUDUL KOLOM (lib/mrp/vendorSheet.ts), jadi judulnya tidak boleh diubah. Pengiriman dan pengajuan invoice tetap di ERP.

const SIZE_ORDER = ["XXS", "XS", "S", "M", "L", "XL", "2XL", "3XL", "4XL", "5XL", "6XL"];
const sizeRank = (s: string) => {
  const i = SIZE_ORDER.indexOf(s.toUpperCase());
  return i === -1 ? 999 : i;
};
const lenganLabel = (l: string) => (l === "PENDEK" ? "Pendek" : "Panjang");
const HEAD_BG = "FF2563EB";
const INPUT_BG = "FFFFF7D6";
/** Jam dinding WIB (UTC+7) sebagai Date berkomponen-UTC, supaya Excel menampilkan jam WIB; pembacaan di ERP mengembalikannya ke WIB (lihat SHEET_TZ_OFFSET_MIN di vendorSheet.ts). */
const wibWall = (iso: string) => new Date(Date.parse(iso) + SHEET_TZ_OFFSET_MIN * 60000);
const FMT_DT = "yyyy-mm-dd hh:mm";
const FMT_D = "yyyy-mm-dd";

export type VendorSheetTemplateInput = {
  mrpId: string;
  vendorId: string;
  batches: ProductionBatch[];
  aduanRows: AduanPolaRow[];
  metas: ProductionGroupMeta[];
  results: ProductionResult[];
  invoices: RawMaterialInvoice[];
};

type RollInfo = {
  invoiceId: string;
  supplier: string;
  warna: string;
  lengan: string;
  rollIndex: number;
  grossKg: number;
  code: string;
  arrivedAt?: string;
  netKg?: number;
};

export async function buildVendorSheetTemplate(input: VendorSheetTemplateInput): Promise<Workbook> {
  const ExcelJS = (await import("exceljs")).default;
  const wb: Workbook = new ExcelJS.Workbook();
  wb.creator = "Mini ERP Tigalapan";
  wb.created = new Date();

  const head = (ws: Worksheet, headers: string[], inputCols: number[], widths: number[]) => {
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
  const shadeInputs = (ws: Worksheet, rowNo: number, cols: number[]) => {
    for (const c of cols) ws.getRow(rowNo).getCell(c).fill = { type: "pattern", pattern: "solid", fgColor: { argb: INPUT_BG } };
  };
  const put = (ws: Worksheet, rowNo: number, values: (string | number | Date | null)[]) => {
    values.forEach((v, i) => {
      if (v !== null && v !== "") ws.getRow(rowNo).getCell(i + 1).value = v as string | number | Date;
    });
  };

  const batches = input.batches.filter((b) => b.mrpId === input.mrpId && b.vendorProduksi === input.vendorId && b.codeRoll);
  const batchByCode = new Map(batches.map((b) => [(b.codeRoll ?? "").toUpperCase(), b]));

  // Semua roll invoice material MRP ini yang tujuannya vendor ini (urut invoice, warna, lengan, roll).
  const rolls: RollInfo[] = [];
  for (const inv of input.invoices) {
    if (inv.mrpId !== input.mrpId || inv.destinationVendor !== input.vendorId) continue;
    for (const entry of inv.colorEntries) {
      const key = `${entry.warna}|${entry.lengan}`;
      const arrivals = inv.rollArrivals[key] ?? [];
      const receipts = inv.rollReceipts[key] ?? [];
      entry.rolls.forEach((gross, i) => {
        const arrival = arrivals[i] ?? null;
        const receipt = receipts[i] ?? null;
        rolls.push({
          invoiceId: inv.id,
          supplier: inv.supplier,
          warna: entry.warna,
          lengan: entry.lengan,
          rollIndex: i,
          grossKg: gross,
          code: receipt?.codeRoll ?? arrival?.codeRoll ?? entry.codeRolls?.[i] ?? "",
          arrivedAt: arrival?.arrivedAt,
          netKg: receipt?.netKg,
        });
      });
    }
  }
  rolls.sort((a, b) => a.invoiceId.localeCompare(b.invoiceId, "id-ID", { numeric: true }) || a.warna.localeCompare(b.warna, "id-ID") || a.lengan.localeCompare(b.lengan) || a.rollIndex - b.rollIndex);

  // ---------- Penerimaan ----------
  const pen = wb.addWorksheet(SHEET_TAB_PENERIMAAN);
  head(pen, PENERIMAAN_HEADERS, [8, 9], [10, 20, 18, 24, 10, 8, 16, 18, 14]);
  let r = 2;
  for (const x of rolls) {
    put(pen, r, [input.mrpId, x.invoiceId, x.supplier, x.warna, lenganLabel(x.lengan), x.rollIndex + 1, x.grossKg, x.code, x.arrivedAt ? wibWall(x.arrivedAt) : null]);
    shadeInputs(pen, r, [8, 9]);
    pen.getRow(r).getCell(9).numFmt = FMT_D;
    r++;
  }
  if (r > 2) pen.autoFilter = { from: { row: 1, column: 1 }, to: { row: r - 1, column: PENERIMAAN_HEADERS.length } };

  // ---------- Resting (roll yang kode rollnya sudah diketahui) ----------
  const rest = wb.addWorksheet(SHEET_TAB_RESTING);
  head(rest, RESTING_HEADERS, [6, 7, 8, 9], [10, 18, 24, 10, 16, 16, 10, 14, 18, 12]);
  r = 2;
  for (const x of rolls.filter((x) => x.code)) {
    const b = batchByCode.get(x.code.toUpperCase());
    put(rest, r, [input.mrpId, x.code, x.warna, lenganLabel(x.lengan), x.grossKg, x.netKg ?? null, b?.gramasi ?? null, b?.setting ?? null, b?.restingAt ? wibWall(b.restingAt) : null, b?.kode ?? null]);
    shadeInputs(rest, r, [6, 7, 8, 9]);
    rest.getRow(r).getCell(9).numFmt = FMT_DT;
    r++;
  }
  if (r > 2) rest.autoFilter = { from: { row: 1, column: 1 }, to: { row: r - 1, column: RESTING_HEADERS.length } };

  // ---------- Produksi (roll x size; roll yang belum di-Resting memakai target dari baris Aduan Pola) ----------
  const prod = wb.addWorksheet(SHEET_TAB_PRODUKSI);
  head(prod, PRODUKSI_HEADERS, [7, 8, 9], [10, 18, 24, 10, 8, 9, 18, 14, 14]);
  const usedByAduan = new Map<string, number>();
  for (const b of batches) usedByAduan.set(b.aduanRowId, (usedByAduan.get(b.aduanRowId) ?? 0) + 1);
  const rowsOut: { code: string; warna: string; lengan: string; cuttingAt?: string; target: Record<string, number>; cut: Record<string, number>; fg: Record<string, number> }[] = [];
  const seenCodes = new Set<string>();
  for (const b of [...batches].sort((a, c) => (a.codeRoll ?? "").localeCompare(c.codeRoll ?? "", "id-ID", { numeric: true }))) {
    seenCodes.add((b.codeRoll ?? "").toUpperCase());
    rowsOut.push({ code: b.codeRoll!, warna: b.warna, lengan: b.lengan, cuttingAt: b.cuttingAt, target: targetSizesForBatch(b, input.aduanRows), cut: b.sizeQty ?? {}, fg: b.fgSizeQty ?? {} });
  }
  for (const x of rolls.filter((x) => x.code && !seenCodes.has(x.code.toUpperCase()))) {
    // Belum di-Resting: pilih baris Aduan Pola seperti layar Resting (warna·lengan sama, yang masih punya jatah roll lebih dulu) dan bagi targetnya per roll.
    const cands = input.aduanRows.filter((a) => a.vendor === input.vendorId && a.warna === x.warna && a.lengan === x.lengan);
    const pick = cands.find((a) => (usedByAduan.get(a.id) ?? 0) < a.qtyRoll) ?? cands[0];
    if (!pick || pick.qtyRoll <= 0) continue;
    usedByAduan.set(pick.id, (usedByAduan.get(pick.id) ?? 0) + 1);
    const target: Record<string, number> = {};
    for (const s of pick.sizes) target[s.size] = Math.round(s.qty / pick.qtyRoll);
    rowsOut.push({ code: x.code, warna: x.warna, lengan: x.lengan, target, cut: {}, fg: {} });
  }
  r = 2;
  for (const it of rowsOut) {
    const sizes = Array.from(new Set([...Object.keys(it.target), ...Object.keys(it.cut), ...Object.keys(it.fg)])).sort((a, c) => sizeRank(a) - sizeRank(c) || a.localeCompare(c, "id-ID", { numeric: true }));
    for (const size of sizes) {
      const cut = it.cut[size];
      const fg = it.fg[size];
      put(prod, r, [input.mrpId, it.code, it.warna, lenganLabel(it.lengan), size, it.target[size] ?? null, it.cuttingAt ? wibWall(it.cuttingAt) : null, cut && cut > 0 ? cut : null, fg && fg > 0 ? fg : null]);
      shadeInputs(prod, r, [7, 8, 9]);
      prod.getRow(r).getCell(7).numFmt = FMT_DT;
      r++;
    }
  }
  if (r > 2) prod.autoFilter = { from: { row: 1, column: 1 }, to: { row: r - 1, column: PRODUKSI_HEADERS.length } };

  // ---------- Reject ----------
  const rej = wb.addWorksheet(SHEET_TAB_REJECT);
  head(rej, REJECT_HEADERS, [4, 5], [10, 24, 10, 16, 16]);
  const groups = new Map<string, { warna: string; lengan: string }>();
  for (const it of rowsOut) groups.set(`${input.mrpId}|${it.warna}|${it.lengan}`, { warna: it.warna, lengan: it.lengan });
  r = 2;
  for (const [key, g] of Array.from(groups.entries()).sort((a, b) => a[0].localeCompare(b[0], "id-ID"))) {
    const meta = input.metas.find((m) => m.groupKey === key && m.vendorProduksi === input.vendorId);
    put(rej, r, [input.mrpId, g.warna, lenganLabel(g.lengan), meta?.rejectMaterialQty ?? null, meta?.rejectProsesQty ?? null]);
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
    put(rw, r, [input.mrpId, a.warna, lenganLabel(a.fromLengan), a.fromSize, a.usia === "KIDS" ? "Kids" : "Dewasa", lenganLabel(a.toLengan), a.toSize, a.qty]);
    shadeInputs(rw, r, [8]);
    r++;
  }

  // ---------- Petunjuk ----------
  const help = wb.addWorksheet("Petunjuk");
  help.columns = [{ width: 120 }];
  const lines = [
    `Template sinkron ERP Tigalapan — MRP ${input.mrpId}`,
    "",
    "Cara pakai:",
    "1. Unggah file ini ke Google Sheets. JANGAN ubah nama tab (Penerimaan / Resting / Produksi / Reject / Rework) dan JANGAN ubah judul kolom di baris 1. Satu spreadsheet = satu MRP.",
    "2. Sistem Anda mengisi kolom berwarna kuning. Waktu = tanggal + jam WIB (mis. 2026-11-10 14:30); Tgl Terima cukup tanggal.",
    "3. Google Sheets: File > Bagikan > Publikasikan ke web > pilih \"Seluruh dokumen\" dan format \"Microsoft Excel (.xlsx)\" > Publikasikan. Salin tautannya.",
    "4. Portal ERP > PO Produksi Saya > kolom Spreadsheet (baris MRP ini) > Tambah: tempel tautan dan Simpan. Selanjutnya ERP membaca spreadsheet otomatis; pakai tombol Sinkron kalau ada data yang belum sinkron.",
    "",
    "Urutan tahap (satu putaran baca mengerjakan semuanya berurutan): Penerimaan -> Resting -> Cutting -> Finish Good -> Reject -> Rework. Pengiriman (koli, resi), pengajuan invoice, Tutup Roll, dan Selesai Produksi tetap di ERP.",
    "",
    "Tab Penerimaan (pengganti Good Receive): isi Code Roll dan Tgl Terima per roll. Hanya untuk invoice yang sudah berstatus Delivery (sudah dibayar dan diset Delivery oleh Procurement); roll dari invoice lain ditahan sampai statusnya Delivery. Item tambahan (add buy) dan klaim cutting tetap di ERP.",
    "Tab Resting: isi Berat Bersih, Gramasi, Setting, dan Waktu Resting (tanggal + jam) per roll yang sudah diterima. Selisih berat bersih yang lebih ringan dari toleransi SCM harus diajukan sebagai klaim di ERP lebih dulu (baris ditahan). Kode Aduan boleh dikosongkan; ERP memilih baris Aduan Pola otomatis seperti layar Resting.",
    "Tab Produksi: satu baris per roll x size. Isi Waktu Cutting (tanggal + jam, wajib untuk hasil cutting baru), Hasil Cutting, dan Finish Good. Finish Good tidak boleh melebihi Hasil Cutting. Data sebuah roll baru diterima setelah rollnya diterima dan di-Resting.",
    "Tab Reject: isi Reject Material DAN Reject Produksi; jumlahnya harus sama dengan total reject warna·lengan itu di ERP (reject dihitung setelah Selesai Produksi di tab Finish Good ERP).",
    "Tab Rework: tulis total rework per kombinasi (asal -> tujuan). ERP hanya menambah selisihnya; mengurangi rework tidak dilakukan otomatis.",
    "",
    "Aturan baca: sel kosong = tidak diubah; angka 0 berarti nol. Roll yang sudah ditutup, sudah masuk resi, atau punya alih size/hasil tambahan sisa kain tidak diubah dari spreadsheet (dilaporkan di portal). Roll/invoice baru yang datang belakangan: unduh template baru atau tambahkan baris dengan kolom yang sama.",
    "Publish to web memakan waktu beberapa menit untuk memuat perubahan terbaru dari Google.",
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
