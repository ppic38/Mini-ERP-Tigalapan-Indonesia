/** Pohon modul & izin portal vendor produksi yang bisa diberikan ke anggota tim (migration 0057,
 *  owner 2026-09-27 & 2026-09-28: "bisa akses sub modul apa saja yang ada di dalam Produksi,
 *  fleksibel option"). Modul TANPA `permissions` = 1 halaman utuh (leaf, "boleh"/"tidak"). Modul
 *  DENGAN `permissions` (mis. Produksi) dipecah per tab -- akun bisa diberi sebagian tab saja
 *  (mis. cuma Cutting, tanpa Final Produksi). Key sub-izin berformat `<hrefModul>:<KODE_TAB>`
 *  (KODE_TAB persis sama dengan `Tab` type di app/vendor-maklon/production/page.tsx).
 *
 *  Sengaja file TERPISAH dari lib/mrp/vendorTeamActions.ts ("use server") -- file "use server"
 *  hanya boleh mengekspor async function, konstanta biasa seperti ini akan diam-diam berubah jadi
 *  referensi server action yang rusak kalau diimpor client component (gejala:
 *  "VENDOR_PAGE_OPTIONS.map is not a function" di browser, lolos tsc/lint karena itu bug runtime
 *  Next.js, bukan error tipe -- lihat riwayat git untuk insiden ini). */

export type VendorPermission = { key: string; label: string };
export type VendorModule = { key: string; label: string; permissions?: VendorPermission[] };

export const VENDOR_MODULE_TREE: VendorModule[] = [
  { key: "/vendor-maklon/po-produksi", label: "PO Produksi Saya" },
  { key: "/vendor-maklon/po-material", label: "PO Material Saya" },
  { key: "/vendor-maklon/receiving", label: "Good Receive" },
  {
    key: "/vendor-maklon/production",
    label: "Produksi",
    permissions: [
      { key: "/vendor-maklon/production:CUTTING", label: "Cutting / Resting" },
      { key: "/vendor-maklon/production:FG", label: "Finish Good" },
      { key: "/vendor-maklon/production:REJECT", label: "Reject" },
      { key: "/vendor-maklon/production:REWORK", label: "Rework" },
      { key: "/vendor-maklon/production:FINAL", label: "Final Produksi" },
    ],
  },
  { key: "/vendor-maklon/pengiriman", label: "Pengiriman" },
  { key: "/vendor-maklon/invoice-payment", label: "Invoice & Payment" },
];

/** Semua key (modul + sub-izin) yang sah disimpan -- termasuk key BARE modul yang punya
 *  `permissions` (mis. "/vendor-maklon/production" tanpa ":TAB") supaya akun LAMA (dibuat sebelum
 *  sub-izin Produksi ada, tersimpan sebagai akses penuh ke modul itu) tetap valid & tidak
 *  mendadak ditolak validasi server. */
export const VALID_VENDOR_PAGES = new Set<string>(VENDOR_MODULE_TREE.flatMap((m) => [m.key, ...(m.permissions?.map((p) => p.key) ?? [])]));

/** True kalau `allowedPages` mengizinkan `pathname` dibuka SAMA SEKALI (proxy.ts) -- modul dengan
 *  sub-izin dianggap "boleh dibuka" asal minimal SATU sub-izin (atau key bare-nya, akun lama)
 *  dimiliki; penyaringan tab MANA yang tampil di dalam halaman itu sendiri ada di
 *  vendorAllowedSubTabs, bukan di sini. */
export function vendorHasPageAccess(allowedPages: string[], pathname: string): boolean {
  const mod = VENDOR_MODULE_TREE.find((m) => pathname === m.key || pathname.startsWith(m.key + "/"));
  if (!mod) return false;
  if (!mod.permissions) return allowedPages.includes(mod.key);
  return allowedPages.includes(mod.key) || mod.permissions.some((p) => allowedPages.includes(p.key));
}

/** Kode tab (bagian setelah ":") yang boleh diakses untuk 1 modul yang punya sub-izin -- "ALL"
 *  kalau modul itu TIDAK punya sub-izin, TIDAK diketahui, atau akun ini diberi akses penuh (key
 *  bare modul ada di allowedPages, termasuk akun lama sebelum sub-izin Produksi ada). Dipakai
 *  halaman modul itu SENDIRI (mis. app/vendor-maklon/production/page.tsx) untuk menyaring tab yang
 *  ditampilkan -- proxy.ts tidak sampai granularitas tab, cukup vendorHasPageAccess di atas. */
export function vendorAllowedSubTabs(allowedPages: string[] | null, moduleKey: string): string[] | "ALL" {
  if (allowedPages == null) return "ALL"; // akun UTAMA vendor (bukan sub-user) -- akses penuh.
  const mod = VENDOR_MODULE_TREE.find((m) => m.key === moduleKey);
  if (!mod?.permissions) return "ALL";
  if (allowedPages.includes(moduleKey)) return "ALL";
  return mod.permissions.filter((p) => allowedPages.includes(p.key)).map((p) => p.key.split(":")[1]);
}

/** URL modul pertama yang boleh dibuka akun ini -- dipakai proxy.ts (redirect) & halaman "Tim
 *  Saya" saat login sub-user langsung diarahkan ke tempat yang relevan buat dia, bukan halaman
 *  yang kebetulan ditolak. */
export function firstAllowedVendorUrl(allowedPages: string[]): string {
  for (const m of VENDOR_MODULE_TREE) {
    if (allowedPages.includes(m.key) || m.permissions?.some((p) => allowedPages.includes(p.key))) return m.key;
  }
  return "/vendor-maklon/po-produksi";
}

/** Ringkasan teks "Produksi (Cutting, Finish Good), Pengiriman" -- dipakai tabel "Tim Saya" &
 *  Sysadmin supaya daftar izin gampang dibaca tanpa perlu buka modal edit dulu. */
export function describeVendorPermissions(allowedPages: string[]): string {
  const parts: string[] = [];
  for (const m of VENDOR_MODULE_TREE) {
    if (!m.permissions) {
      if (allowedPages.includes(m.key)) parts.push(m.label);
      continue;
    }
    if (allowedPages.includes(m.key)) {
      parts.push(m.label);
      continue;
    }
    const subLabels = m.permissions.filter((p) => allowedPages.includes(p.key)).map((p) => p.label);
    if (subLabels.length > 0) parts.push(`${m.label} (${subLabels.join(", ")})`);
  }
  return parts.join(", ") || "—";
}
