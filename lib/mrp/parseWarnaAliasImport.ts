import * as XLSX from "xlsx";

/** Import massal Master Data "Mapping Warna" dari Excel/CSV (owner 2026-09-24: "buat mapping
 *  warna juga bisa ada fitur import spreadsheet") -- pola SAMA PERSIS dengan
 *  lib/mrp/parseSkuImport.ts (SKU), dipertahankan sebagai file terpisah (bukan fungsi generik)
 *  konsisten dengan gaya tiap Master Data panel di app ini yang punya file sendiri-sendiri. */

export type ParsedWarnaAliasRow = {
  rowNum: number;
  mrpWarna: string;
  skuWarna: string;
  catatan: string;
  issues: string[];
};

function findKey(headers: string[], candidates: string[]): string | null {
  const norm = (s: string) => s.trim().toLowerCase();
  for (const h of headers) {
    if (candidates.some((c) => norm(h) === norm(c))) return h;
  }
  return null;
}

export async function parseWarnaAliasImportFile(file: File): Promise<ParsedWarnaAliasRow[]> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) throw new Error("File tidak punya sheet data.");
  const rows: Record<string, unknown>[] = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { defval: null });
  if (rows.length === 0) throw new Error("Sheet kosong -- tidak ada baris data untuk diimpor.");

  const headers = Object.keys(rows[0]);
  const kMrp = findKey(headers, ["Nama di MRP", "MRP Warna", "Warna MRP", "Nama MRP"]);
  const kSku = findKey(headers, ["Nama di SKU", "SKU Warna", "Warna SKU", "Nama SKU"]);
  const kCatatan = findKey(headers, ["Catatan", "Note", "Keterangan"]);

  if (!kMrp) throw new Error('Kolom "Nama di MRP" tidak ditemukan di file ini.');
  if (!kSku) throw new Error('Kolom "Nama di SKU" tidak ditemukan di file ini.');

  return rows.map((row, i) => {
    const issues: string[] = [];
    const mrpWarna = String(row[kMrp] ?? "").trim();
    const skuWarna = String(row[kSku] ?? "").trim();
    const catatan = kCatatan ? String(row[kCatatan] ?? "").trim() : "";
    if (!mrpWarna) issues.push("Nama di MRP kosong");
    if (!skuWarna) issues.push("Nama di SKU kosong");
    return { rowNum: i + 2, mrpWarna, skuWarna, catatan, issues };
  });
}

export function downloadWarnaAliasImportTemplate() {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet([
    { "Nama di MRP": "BENHUR SPECIAL 24S", "Nama di SKU": "BENHUR 24S", Catatan: "" },
    { "Nama di MRP": "FUCHSIA", "Nama di SKU": "FANTA", Catatan: "" },
    { "Nama di MRP": "PUTIH BLUISH", "Nama di SKU": "PUTIH", Catatan: "" },
  ]);
  XLSX.utils.book_append_sheet(wb, ws, "Mapping Warna");
  XLSX.writeFile(wb, "Template-Import-Mapping-Warna.xlsx");
}
