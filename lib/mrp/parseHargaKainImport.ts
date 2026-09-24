import * as XLSX from "xlsx";
import { parseIndoRupiah } from "./importGoogleSheet";

/** Import massal Master Data "Harga Kain" dari Excel/CSV (owner 2026-09-24: "buat mapping warna
 *  juga bisa ada fitur import spreadsheet, sama yang untuk harga kain") -- pola SAMA PERSIS dengan
 *  lib/mrp/parseSkuImport.ts (SKU). Nama kolom yang dikenali SENGAJA disamakan dengan kolom yang
 *  sudah dipakai jalur "Import dari Google Sheets" lama (KODE SUPPLIER/NAMA SUPPLIER/KATEGORI/
 *  WARNA/HARGA PER KG, lihat mapHargaKainRows di lib/mrp/importGoogleSheet.ts) supaya sheet yang
 *  sama bisa dipakai lewat DUA jalur (link publik ATAU upload file) tanpa perlu diubah formatnya.
 *  Beda dari jalur Google Sheets (REPLACE total), import file ini UPSERT (lihat
 *  bulkUpsertHargaKainAction) -- tidak menghapus baris lama yang tidak disebut di file. */

export type ParsedHargaKainRow = {
  rowNum: number;
  kodeSupplier: string;
  namaSupplier: string;
  kategori: string;
  warna: string;
  hargaPerKg: number;
  issues: string[];
};

function findKey(headers: string[], candidates: string[]): string | null {
  const norm = (s: string) => s.trim().toLowerCase();
  for (const h of headers) {
    if (candidates.some((c) => norm(h) === norm(c))) return h;
  }
  return null;
}

export async function parseHargaKainImportFile(file: File): Promise<ParsedHargaKainRow[]> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) throw new Error("File tidak punya sheet data.");
  const rows: Record<string, unknown>[] = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { defval: null });
  if (rows.length === 0) throw new Error("Sheet kosong -- tidak ada baris data untuk diimpor.");

  const headers = Object.keys(rows[0]);
  const kKodeSupplier = findKey(headers, ["KODE SUPPLIER", "Kode Supplier"]);
  const kNamaSupplier = findKey(headers, ["NAMA SUPPLIER", "Nama Supplier"]);
  const kKategori = findKey(headers, ["KATEGORI", "Kategori"]);
  const kWarna = findKey(headers, ["WARNA", "Warna"]);
  const kHarga = findKey(headers, ["HARGA PER KG", "Harga Per Kg", "Harga/Kg", "Harga"]);

  if (!kKodeSupplier) throw new Error('Kolom "KODE SUPPLIER" tidak ditemukan di file ini.');
  if (!kKategori) throw new Error('Kolom "KATEGORI" tidak ditemukan di file ini.');
  if (!kWarna) throw new Error('Kolom "WARNA" tidak ditemukan di file ini.');
  if (!kHarga) throw new Error('Kolom "HARGA PER KG" tidak ditemukan di file ini.');

  return rows.map((row, i) => {
    const issues: string[] = [];
    const kodeSupplier = String(row[kKodeSupplier] ?? "").trim();
    const namaSupplier = kNamaSupplier ? String(row[kNamaSupplier] ?? "").trim() : kodeSupplier;
    const kategori = String(row[kKategori] ?? "").trim();
    const warna = String(row[kWarna] ?? "").trim();
    const hargaPerKg = parseIndoRupiah(row[kHarga]);
    if (!kodeSupplier) issues.push("Kode supplier kosong");
    if (!kategori) issues.push("Kategori kosong");
    if (!warna) issues.push("Warna kosong");
    return { rowNum: i + 2, kodeSupplier, namaSupplier, kategori, warna, hargaPerKg, issues };
  });
}

export function downloadHargaKainImportTemplate() {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet([
    { "KODE SUPPLIER": "KNITTO", "NAMA SUPPLIER": "KNITTO", KATEGORI: "COMBED 24S", WARNA: "BENHUR 24S", "HARGA PER KG": 65000 },
    { "KODE SUPPLIER": "FABRIKU", "NAMA SUPPLIER": "FABRIKU", KATEGORI: "COMBED 30S", WARNA: "MAROON 30S", "HARGA PER KG": 60000 },
  ]);
  XLSX.utils.book_append_sheet(wb, ws, "Harga Kain");
  XLSX.writeFile(wb, "Template-Import-Harga-Kain.xlsx");
}
