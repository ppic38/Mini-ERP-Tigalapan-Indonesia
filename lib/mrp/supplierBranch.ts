/** Kode cabang supplier (owner 2026-10-20): dua huruf pertama No Invoice Supplier menunjukkan cabang yang menerbitkan
 *  invoice, mis. "OH191026418" -> OH = Holis (Bandung). Hanya kode yang sudah diberikan owner yang terdaftar; cabang
 *  lain (Jakarta Puri, Yogya Cokroaminoto, Semarang Sudirman) ditambahkan di sini begitu kodenya diketahui. Kode yang
 *  belum terdaftar tetap ditampilkan apa adanya supaya tetap bisa dilacak. */
export type SupplierBranch = { code: string; nama: string; kota: string };

export const SUPPLIER_BRANCHES: SupplierBranch[] = [
  { code: "OH", nama: "Holis", kota: "Bandung" },
  { code: "OR", nama: "Kebon Jukut", kota: "Bandung" },
  { code: "OB", nama: "Soekarno", kota: "Surabaya" },
];

/** Dua huruf pertama nomor invoice supplier (huruf besar), atau null kalau tidak diawali dua huruf. */
export function branchCodeFromInvoiceNo(noInvoice?: string | null): string | null {
  const m = (noInvoice ?? "").trim().match(/^([A-Za-z]{2})/);
  return m ? m[1].toUpperCase() : null;
}

/** Cabang dari nomor invoice supplier. `branch` null = kode belum terdaftar (lihat `code`). */
export function supplierBranchFromInvoiceNo(noInvoice?: string | null): { code: string; branch: SupplierBranch | null } | null {
  const code = branchCodeFromInvoiceNo(noInvoice);
  if (!code) return null;
  return { code, branch: SUPPLIER_BRANCHES.find((b) => b.code === code) ?? null };
}

export function supplierBranchLabel(noInvoice?: string | null): string {
  const r = supplierBranchFromInvoiceNo(noInvoice);
  if (!r) return "—";
  return r.branch ? `${r.branch.nama} (${r.branch.kota})` : r.code;
}
