import * as XLSX from "xlsx";
import type { Lengan } from "./types";

/** Import massal Master Data "SKU (Harga Jual per Item)" dari Excel/CSV (owner 2026-09-24: "buat
 *  dalam bentuk popup form ... ada cara tambah data per data (baris) ada juga secara masive
 *  (melalui import excel)"). File referensi owner ("Master Data SKU (Tigalapan).csv") cuma punya
 *  4 kolom (Category, SKU, Items Name, Price) -- warna/lengan/size TIDAK terpisah, melainkan
 *  digabung jadi satu string "Items Name" (mis. "HITAM 24S PDK S", atau utk kategori "PANJANG +
 *  RIB" yang tanpa token PDK/PJG sama sekali: "PUTIH + RIB M"). Parser di bawah SENGAJA menerima
 *  DUA bentuk sekaligus:
 *  1. Kolom Warna/Lengan/Size terpisah (disarankan, tidak ambigu) -- dipakai APA ADANYA kalau ada.
 *  2. Kolom "Items Name" gabungan (format asli file owner) -- dipecah otomatis pakai
 *     `splitItemName` di bawah, aturan yang SAMA PERSIS dengan data yang sudah live di DB
 *     (diverifikasi manual terhadap seed migration 0035_item_selling_prices.sql: token terakhir =
 *     size, token sebelum itu "PDK"/"PJG" -> lengan (sisanya = warna); kalau tidak ada token
 *     PDK/PJG (mis. "PUTIH + RIB M"), lengan ditebak dari KATEGORI (mis. "PANJANG + RIB" -> PANJANG)
 *     dan warna = semua token kecuali size).
 *  Kalau file punya KEDUANYA, kolom terpisah menang (fallback ke Items Name cuma untuk field yang
 *  kosong di kolom terpisah). */

export type ParsedSkuRow = {
  rowNum: number; // baris di file (1-based, sudah termasuk header) -- buat pesan error yang jelas.
  kategori: string;
  sku: string | null;
  itemName: string;
  warna: string;
  lengan: Lengan | null;
  size: string;
  price: number;
  issues: string[]; // kosong = baris valid, siap disimpan.
};

function findKey(headers: string[], candidates: string[]): string | null {
  const norm = (s: string) => s.trim().toLowerCase();
  for (const h of headers) {
    if (candidates.some((c) => norm(h) === norm(c))) return h;
  }
  return null;
}

function toLenganLoose(raw: string): Lengan | null {
  const v = raw.trim().toUpperCase();
  if (v === "PENDEK" || v === "PDK") return "PENDEK";
  if (v === "PANJANG" || v === "PJG") return "PANJANG";
  return null;
}

/** Lihat catatan lengkap di atas -- aturan ini DIVERIFIKASI cocok 100% dengan data yang sudah live
 *  (seed migration 0035), termasuk kasus tanpa token PDK/PJG ("PANJANG + RIB" -> warna "X + RIB",
 *  lengan dari kategori). */
function splitItemName(itemName: string, kategori: string): { warna: string; lengan: Lengan | null; size: string | null } {
  const tokens = itemName.trim().split(/\s+/).filter(Boolean);
  if (tokens.length < 2) return { warna: itemName.trim(), lengan: null, size: tokens[0] ?? null };
  const size = tokens[tokens.length - 1];
  const lenganTok = tokens[tokens.length - 2]?.toUpperCase();
  if (lenganTok === "PDK" || lenganTok === "PENDEK") return { warna: tokens.slice(0, -2).join(" "), lengan: "PENDEK", size };
  if (lenganTok === "PJG" || lenganTok === "PANJANG") return { warna: tokens.slice(0, -2).join(" "), lengan: "PANJANG", size };
  // Tidak ada token PDK/PJG (mis. "PUTIH + RIB M") -- tebak lengan dari nama kategori.
  const cat = kategori.toUpperCase();
  const hasPjg = cat.includes("PANJANG");
  const hasPdk = cat.includes("PENDEK");
  const lengan: Lengan | null = hasPjg && !hasPdk ? "PANJANG" : hasPdk && !hasPjg ? "PENDEK" : null;
  return { warna: tokens.slice(0, -1).join(" "), lengan, size };
}

export async function parseSkuImportFile(file: File): Promise<ParsedSkuRow[]> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) throw new Error("File tidak punya sheet data.");
  const rows: Record<string, unknown>[] = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { defval: null });
  if (rows.length === 0) throw new Error("Sheet kosong -- tidak ada baris data untuk diimpor.");

  const headers = Object.keys(rows[0]);
  const kKategori = findKey(headers, ["Category", "Kategori"]);
  const kSku = findKey(headers, ["SKU"]);
  const kItemName = findKey(headers, ["Items Name", "Item Name", "Nama Item"]);
  const kWarna = findKey(headers, ["Warna"]);
  const kLengan = findKey(headers, ["Lengan"]);
  const kSize = findKey(headers, ["Size"]);
  const kPrice = findKey(headers, ["Price", "Harga Jual", "Harga"]);

  if (!kKategori) throw new Error('Kolom "Category"/"Kategori" tidak ditemukan di file ini.');
  if (!kItemName && !(kWarna && kSize)) {
    throw new Error('Perlu kolom "Items Name" (satu kolom gabungan), ATAU kolom "Warna" + "Size" terpisah -- tidak ditemukan salah satunya.');
  }
  if (!kPrice) throw new Error('Kolom "Price"/"Harga Jual" tidak ditemukan di file ini.');

  return rows.map((row, i) => {
    const issues: string[] = [];
    const kategori = String(row[kKategori] ?? "").trim();
    const sku = kSku ? String(row[kSku] ?? "").trim() || null : null;
    const rawItemName = kItemName ? String(row[kItemName] ?? "").trim() : "";
    let warna = kWarna ? String(row[kWarna] ?? "").trim() : "";
    let lengan: Lengan | null = kLengan ? toLenganLoose(String(row[kLengan] ?? "")) : null;
    let size = kSize ? String(row[kSize] ?? "").trim() : "";

    if ((!warna || !size || !lengan) && rawItemName) {
      const split = splitItemName(rawItemName, kategori);
      if (!warna) warna = split.warna;
      if (!size) size = split.size ?? "";
      if (!lengan) lengan = split.lengan;
    }
    const itemName = rawItemName || [warna, lengan === "PENDEK" ? "PDK" : lengan === "PANJANG" ? "PJG" : "", size].filter(Boolean).join(" ");

    const priceRaw = row[kPrice];
    const price = Number(String(priceRaw ?? "0").replace(/[^0-9.-]/g, "")) || 0;

    if (!kategori) issues.push("Kategori kosong");
    if (!warna) issues.push("Warna tidak bisa ditentukan");
    if (!lengan) issues.push('Lengan tidak bisa ditentukan (tidak ada token "PDK"/"PJG" & kategori tidak menyebut PENDEK/PANJANG)');
    if (!size) issues.push("Size tidak bisa ditentukan");

    return { rowNum: i + 2, kategori, sku, itemName, warna, lengan, size, price, issues };
  });
}

/** Template Excel yang bisa diunduh dari panel -- DUA gaya kolom sekaligus (Items Name gabungan
 *  DAN Warna/Lengan/Size terpisah) supaya user bebas isi yang mana saja tanpa perlu baca dokumentasi
 *  dulu (owner: "user bisa download template ... just in case mereka tidak tau template seperti
 *  apa yang harus diimport"). Kolom terpisah yang dikosongkan otomatis dipecah dari Items Name saat
 *  diimpor (lihat parseSkuImportFile/splitItemName). */
export function downloadSkuImportTemplate() {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet([
    { Kategori: "COMBED 24S", SKU: "A08-106A2", "Items Name": "HITAM 24S PDK S", Warna: "", Lengan: "", Size: "", "Harga Jual": 40000 },
    { Kategori: "COMBED 24S", SKU: "A08-106B3", "Items Name": "", Warna: "HITAM 24S", Lengan: "PANJANG", Size: "M", "Harga Jual": 45000 },
    { Kategori: "PANJANG + RIB", SKU: "", "Items Name": "PUTIH + RIB M", Warna: "", Lengan: "", Size: "", "Harga Jual": 50000 },
  ]);
  XLSX.utils.book_append_sheet(wb, ws, "SKU");
  XLSX.writeFile(wb, "Template-Import-SKU.xlsx");
}
