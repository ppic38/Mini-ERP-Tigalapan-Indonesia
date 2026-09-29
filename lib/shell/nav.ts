export type NavItem = { label: string; href?: string; badge?: number };

export type RoleKey = "ppic" | "procurement" | "finance" | "scm" | "gm" | "produksi" | "sysadmin" | "warehouse" | "vendorMaklon" | "vendorSupplier" | "admin";

export type RoleNav = {
  role: string;
  entity: string;
  items: NavItem[];
};

export const NAV: Record<RoleKey, RoleNav> = {
  ppic: {
    role: "PPIC",
    entity: "Tigalapan Indonesia",
    items: [
      { label: "Dashboard", href: "/dashboard/ppic" },
      { label: "MRP", href: "/mrp/ppic" },
      { label: "Master Data", href: "/mrp/ppic/master-data" },
    ],
  },
  procurement: {
    role: "Procurement",
    entity: "Tigalapan Indonesia",
    items: [
      { label: "Dashboard", href: "/dashboard/procurement" },
      // Revisi 2026-09-28: "Approval PO" (Level 2) tidak lagi menu terpisah -- sekarang tab
      // "Approval PO Saya" di dalam halaman "Purchase Order" (lihat app/procurement/po-approval/page.tsx).
      { label: "Purchase Order", href: "/procurement/po-approval" },
      { label: "Paying Voucher (Invoice)", href: "/raw-material" },
      { label: "Material Tracking", href: "/procurement/material-tracking" },
      { label: "Klaim Material", href: "/procurement/material-claims" },
      { label: "Master Data", href: "/procurement/master-data" },
    ],
  },
  finance: {
    role: "Finance",
    entity: "Tigalapan Indonesia",
    items: [
      { label: "Dashboard", href: "/dashboard/finance" },
      { label: "PO Approval", href: "/finance/po-approval" },
      { label: "Payment", href: "/finance/payment" },
      // Revisi 2026-09-06: saldo deposit vendor (dari klaim yang diselesaikan lewat "retur +
      // pesan ulang", lihat material-claims/page.tsx) -- halaman transparansi read-only, dipakai
      // manual dari Payment tapi juga perlu terlihat sendiri (saldo bisa nyangkut tanpa transaksi
      // baru hari itu).
      { label: "Saldo Deposit Vendor", href: "/finance/vendor-deposit" },
      // Item revisi 2026-09-06: disembunyikan dari nav atas permintaan owner ("mungkin comment
      // saja biar tidak tampil, saya siapa tau perlu nanti") -- SENGAJA cuma dikomentari, BUKAN
      // dihapus. Halaman /finance/ledger sendiri TIDAK disentuh (masih ada, tetap bisa diakses
      // langsung lewat URL kalau memang dibutuhkan) -- panggil lagi kalau mau dimunculkan ulang.
      // { label: "Ledger", href: "/finance/ledger" },
      { label: "Laporan HPP", href: "/finance/laporan-hpp" },
      { label: "Master Data", href: "/finance/master-data" },
    ],
  },
  scm: {
    role: "SCM",
    entity: "Tigalapan Indonesia",
    items: [
      { label: "Approval MRP", href: "/scm/approval-mrp" },
      { label: "Approval PO", href: "/scm/approval-po" },
      { label: "Monitoring", href: "/scm/monitoring" },
    ],
  },
  sysadmin: {
    role: "Sysadmin",
    entity: "Tigalapan Indonesia",
    items: [
      { label: "Akun & Password", href: "/sysadmin/accounts" },
      { label: "Batalkan PO", href: "/sysadmin/po" },
      // Revisi 2026-09-28 (owner: "case2 seperti ini bisa diatur di sysadmin ... dari tingkat besar
      // hingga tingkat detail ... hanya beberapa yang ingin disetting", diperluas ke "akses tingkat
      // tinggi untuk manipulasi apa pun ... diterapkan ke setiap modul", dipersempit ke Procurement
      // & Finance dulu) -- kembalikan langkah approval PO, tarik kembali PO Material yang belum
      // diinvoice, & kembalikan batch invoice yang salah ke-set Delivery. Granular per baris/PO,
      // bukan borongan.
      { label: "Kembalikan Data", href: "/sysadmin/invoice-status" },
      { label: "Log Audit", href: "/sysadmin/audit-log" },
    ],
  },
  gm: {
    role: "General Manager",
    entity: "Tigalapan Indonesia",
    items: [
      { label: "Dashboard", href: "/gm/dashboard" },
      { label: "Approval PO", href: "/gm/approval-po" },
    ],
  },
  produksi: {
    role: "Produksi",
    entity: "Tigalapan Indonesia",
    items: [
      { label: "Monitoring Produksi", href: "/produksi/monitoring" },
      { label: "Monitoring Reject", href: "/produksi/reject" },
      { label: "Kebutuhan Bahan", href: "/produksi/material-status" },
      { label: "Yield Alert", href: "/produksi/yield-alerts" },
    ],
  },
  warehouse: {
    role: "Warehouse",
    entity: "Tigalapan Indonesia",
    items: [
      { label: "Penerimaan", href: "/warehouse/penerimaan" },
      { label: "Riwayat Penerimaan", href: "/warehouse/riwayat" },
    ],
  },
  vendorMaklon: {
    role: "PT Maklon ABC",
    entity: "Vendor Maklon",
    items: [
      { label: "PO Produksi Saya", href: "/vendor-maklon/po-produksi" },
      { label: "PO Material Saya", href: "/vendor-maklon/po-material" },
      { label: "Good Receive", href: "/vendor-maklon/receiving" },
      { label: "Produksi", href: "/vendor-maklon/production" },
      { label: "Pengiriman", href: "/vendor-maklon/pengiriman" },
      { label: "Invoice & Payment", href: "/vendor-maklon/invoice-payment" },
      // Hanya untuk akun UTAMA vendor -- disaring dari sidebar & ditutup proxy.ts untuk akun
      // anggota tim (migration 0057, lihat components/shell/app-shell.tsx).
      { label: "Tim Saya", href: "/vendor-maklon/team" },
    ],
  },
  vendorSupplier: {
    role: "PT Supplier ABC",
    entity: "Vendor Supplier",
    items: [
      { label: "Order Saya", href: "/dashboard/vendor-supplier" },
      { label: "Invoice" },
      { label: "Status Pembayaran" },
      { label: "Dokumen" },
    ],
  },
  admin: {
    role: "Admin",
    entity: "Administrasi sistem",
    items: [
      { label: "Overview", href: "/dashboard/admin" },
      { label: "Users" },
      { label: "Entities" },
      { label: "SLA Config" },
      { label: "Settings" },
      { label: "System Logs" },
    ],
  },
};

/** Revisi 2026-09-29 (owner: Sysadmin "punya akses ke semua modul ... sidebar seperti modul-modul
 *  lain tapi di-stack, ada PPIC dan isi menunya, Procurement, dst"): urutan grup sidebar Sysadmin.
 *  Isi tiap grup DIAMBIL dari NAV[role].items di atas (bukan salinan), jadi menu baru/berubah di
 *  sebuah modul otomatis ikut. Sysadmin sengaja terakhir (sesuai mockup yang disetujui owner). */
export const SYSADMIN_GROUP_ORDER: RoleKey[] = ["ppic", "procurement", "finance", "scm", "gm", "produksi", "warehouse", "sysadmin"];

export type NavGroup = { key: RoleKey; label: string; items: NavItem[] };

export function sysadminNavGroups(): NavGroup[] {
  return SYSADMIN_GROUP_ORDER.map((key) => ({ key, label: NAV[key].role, items: NAV[key].items }));
}

/** Revisi 2026-09-29 (owner: "profil saya jangan begini. tapi buat halaman penuh seperti halaman
 *  menu kalau dibuka. bukan pop up") -- "Profil Saya" (components/shell/profil-saya-page.tsx)
 *  BUKAN modal lagi, tapi halaman penuh per modul (sama seperti halaman lain lewat AppShell), jadi
 *  tiap modul internal punya route sendiri, TIDAK ada di sidebar (nav.items di atas) -- cuma
 *  diakses lewat menu "Profil Saya" di dropdown topbar (components/shell/app-shell.tsx). Hanya
 *  8 modul GATED (lihat GATED_ROLES di app-shell.tsx) yang punya profil pribadi -- vendor dan
 *  admin lama tidak termasuk lingkup permintaan ini. */
export const PROFILE_HREF: Partial<Record<RoleKey, string>> = {
  ppic: "/dashboard/ppic/profil-saya",
  procurement: "/procurement/profil-saya",
  finance: "/finance/profil-saya",
  scm: "/scm/profil-saya",
  gm: "/gm/profil-saya",
  produksi: "/produksi/profil-saya",
  warehouse: "/warehouse/profil-saya",
  sysadmin: "/sysadmin/profil-saya",
};
