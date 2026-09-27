// CATATAN MIGRASI SUPABASE: password modul dulu ada di sini (plaintext, ikut ter-bundle
// ke client -- bisa dibaca siapapun lewat DevTools/view-source). Sekarang password
// dicek server-only dari env var INTERNAL_PASSWORD_<ROLE> (lihat lib/auth/actions.ts),
// jadi file ini cuma menyimpan info non-sensitif (label/homeHref) yang aman dipakai UI.
export type InternalRole = "ppic" | "procurement" | "finance" | "scm" | "gm" | "produksi" | "warehouse";

export type InternalAccount = {
  role: InternalRole;
  label: string;
  homeHref: string;
};

export const INTERNAL_ACCOUNTS: InternalAccount[] = [
  { role: "ppic", label: "PPIC", homeHref: "/dashboard/ppic" },
  { role: "procurement", label: "Procurement", homeHref: "/dashboard/procurement" },
  { role: "finance", label: "Finance", homeHref: "/dashboard/finance" },
  // SCM: jembatan approval MRP dari PPIC sebelum masuk Procurement + monitoring lintas modul
  // (lihat ppicApproval di lib/mrp/store.ts). Produksi: monitoring progres semua vendor produksi
  // lintas MRP — read-only, tidak ada aksi approval/input.
  { role: "scm", label: "SCM", homeHref: "/scm/approval-mrp" },
  // General Manager (2026-09-26): approver Level 4 Matriks Approval PO + dashboard ringkasan (lihat
  // lib/mrp/poApproval.ts). Password: env INTERNAL_PASSWORD_GM.
  { role: "gm", label: "General Manager", homeHref: "/gm/dashboard" },
  { role: "produksi", label: "Produksi", homeHref: "/produksi/monitoring" },
  // Warehouse: entitas internal yang menerima koli barang jadi (FG) kiriman Vendor Produksi &
  // "membongkar"-nya jadi item stok gudang (Spec Portal Warehouse) -- satu akun umum, sama pola
  // PPIC/SCM/Finance (Q2), bukan multi-akun/multi-lokasi.
  { role: "warehouse", label: "Warehouse", homeHref: "/warehouse/penerimaan" },
];

export function internalAccountFor(role: InternalRole): InternalAccount | undefined {
  return INTERNAL_ACCOUNTS.find((a) => a.role === role);
}
