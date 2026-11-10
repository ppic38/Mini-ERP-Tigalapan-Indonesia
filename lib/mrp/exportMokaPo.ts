// Download PO Warehouse (owner 2026-11-10): isi template "Import - Items Purchase Order" dari Moka (CSV) dari resi yang dipilih.
// Kolom template: Internal ID, Outlet Name, Supplier Email, Items Name, Variant Name, Category, SKU, In Stock, Order, Unit Cost.
// Yang diisi: Supplier Email (pilihan di popup), Order (= qty), Unit Cost (= HPP per item). Kolom lain ("Do Not Edit") dibiarkan persis.
// Item dicocokkan dengan kolom "Items Name" template memakai format Item (MOKA) (warna hasil Mapping Warna + PDK/PJG + size), cadangan: nama item Master SKU, lalu kode SKU.

export const MOKA_SUPPLIER_EMAILS = [
  "test@gmail.com",
  "ammarrrrr@gmail.com",
  "artra123@gmail.com",
  "customprojectconvection@gmail.com",
  "marcusbukitmoriah@gmail.com",
  "dr38@gmail.com",
  "tigalapandefect@gmail.com",
  "dodyjuanedi288@gmail.com",
  "dtf00@gmail.com",
  "duniaplastik38@gmail.com",
  "konveksimakassar38@gmail.com",
  "rickihalim@gmail.com",
  "mandiricreatif@gmail.com",
  "warehousesquad052@gmail.com",
  "unimatemsdsablon@gmail.com",
  "points.indonesiaa@gmail.com",
  "ptsipi123@gmail.com",
  "vendorsyahrul@gmail.com",
  "trl99@gmail.com",
  "totebagtp99@gmail.com",
  "Tigalapanold@gmail.com",
  "tripaq3838@gmail.com",
  "Vendorr01@gmail.com",
  "vendor02gi@gmail.com",
  "vendor03@gmail.com",
  "vendor04@gmail.com",
  "vendor05@gmail.com",
  "vendor06@gmail.com",
  "awaluddinpawae@gmail.com",
  "cece2510@gmail.com",
  "dedikusnadi@gmail.com",
  "sayogi@gmail.com",
  "desipurnama03@gmail.com",
  "cv.satpas13@gmail.com",
  "yadirohayadi99@gmail.com",
] as const;

/** Satu item PO (sudah digabung per item): kunci pencocokan + qty + HPP rata-rata tertimbang. */
export type MokaPoItem = {
  /** Item (MOKA): "{warna hasil Mapping Warna} PDK|PJG {size}". */
  itemMoka: string;
  /** Nama item Master SKU kalau ada (cadangan pencocokan). */
  itemName?: string | null;
  /** Nama alternatif untuk dicocokkan (mis. item RIB di Moka tanpa PDK/PJG: "BENHUR KID + RIB XS"). */
  alt?: string[];
  /** Kode SKU Master SKU kalau ada (cadangan pencocokan). */
  sku?: string | null;
  qty: number;
  /** HPP per item (rata-rata tertimbang); null kalau belum ada. */
  hppPerItem: number | null;
};

export type MokaPoResult = {
  csv: string;
  /** Jumlah baris template yang diisi dan jumlah pcs total. */
  filledRows: number;
  filledQty: number;
  /** Item yang tidak ditemukan di template (tidak ikut file). */
  notFound: MokaPoItem[];
  /** Item yang ditemukan tetapi belum punya HPP (Unit Cost dikosongkan). */
  noCost: MokaPoItem[];
  /** Baris item template yang tidak punya kolom sesuai / template tidak dikenali. */
  error?: string;
};

/** Parser CSV kecil (RFC 4180: tanda kutip ganda, koma, baris baru di dalam kutip). */
export function parseCsv(text: string): string[][] {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else inQuotes = false;
      } else cell += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

const csvCell = (v: string) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
const norm = (s: string) => s.trim().replace(/\s+/g, " ").toUpperCase();

const HEADER = {
  supplier: "Supplier Email",
  name: "Items Name",
  sku: "SKU",
  order: "Order",
  cost: "Unit Cost",
};

/** Isi template Moka dengan item PO. Seluruh baris template dipertahankan (urutan dan isi kolom "Do Not Edit" tidak berubah). */
export function buildMokaPoCsv(templateText: string, supplierEmail: string, items: MokaPoItem[]): MokaPoResult {
  const empty: MokaPoResult = { csv: "", filledRows: 0, filledQty: 0, notFound: [], noCost: [] };
  const rows = parseCsv(templateText);
  if (rows.length < 2) return { ...empty, error: "File template kosong." };
  const head = rows[0].map((h) => h.trim());
  const col = (prefix: string) => head.findIndex((h) => h.toLowerCase().startsWith(prefix.toLowerCase()));
  const iSupplier = col(HEADER.supplier);
  const iName = col(HEADER.name);
  const iSku = col(HEADER.sku);
  const iOrder = col(HEADER.order);
  const iCost = col(HEADER.cost);
  if (iSupplier < 0 || iName < 0 || iOrder < 0 || iCost < 0) {
    return { ...empty, error: "Format template tidak dikenali: kolom Supplier Email, Items Name, Order, dan Unit Cost harus ada (template Import Items Purchase Order dari Moka)." };
  }

  const byName = new Map<string, number>();
  const bySku = new Map<string, number>();
  const skuDup = new Set<string>();
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (row.length < head.length && row.every((c) => c.trim() === "")) continue;
    const n = norm(row[iName] ?? "");
    if (n && !byName.has(n)) byName.set(n, r);
    const s = iSku >= 0 ? norm(row[iSku] ?? "") : "";
    if (s) {
      if (bySku.has(s)) skuDup.add(s);
      else bySku.set(s, r);
    }
  }

  const notFound: MokaPoItem[] = [];
  const noCost: MokaPoItem[] = [];
  const filled = new Map<number, { qty: number; nilai: number; qtyCost: number }>();
  for (const it of items) {
    if (!(it.qty > 0)) continue;
    let r = byName.get(norm(it.itemMoka));
    if (r === undefined && it.itemName) r = byName.get(norm(it.itemName));
    for (const a of it.alt ?? []) if (r === undefined) r = byName.get(norm(a));
    if (r === undefined && it.sku) {
      const s = norm(it.sku);
      if (!skuDup.has(s)) r = bySku.get(s);
    }
    if (r === undefined) {
      notFound.push(it);
      continue;
    }
    const cur = filled.get(r) ?? { qty: 0, nilai: 0, qtyCost: 0 };
    cur.qty += it.qty;
    if (it.hppPerItem != null && it.hppPerItem > 0) {
      cur.nilai += it.qty * it.hppPerItem;
      cur.qtyCost += it.qty;
    } else noCost.push(it);
    filled.set(r, cur);
  }

  let filledQty = 0;
  for (const [r, f] of filled) {
    const row = rows[r];
    while (row.length < head.length) row.push("");
    row[iSupplier] = supplierEmail;
    row[iOrder] = String(f.qty);
    // Unit Cost = HPP rata-rata tertimbang, dibulatkan ke rupiah; kosong kalau tidak ada HPP sama sekali.
    row[iCost] = f.qtyCost > 0 ? String(Math.round(f.nilai / f.qtyCost)) : "";
    filledQty += f.qty;
  }

  return {
    // BOM mengikuti template (kalau template dari Moka tidak berBOM, hasilnya juga tidak).
    csv: (templateText.charCodeAt(0) === 0xfeff ? "﻿" : "") + rows.map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n",
    filledRows: filled.size,
    filledQty,
    notFound,
    noCost,
  };
}

export function downloadCsv(csv: string, fileName: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
