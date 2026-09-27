/** Daftar halaman portal vendor yang BISA diberikan sebagai izin ke anggota tim (migration 0057,
 *  owner 2026-09-27) -- dipakai checkbox di halaman "Tim Saya" & Sysadmin, DAN dicek proxy.ts saat
 *  sub-user membuka halaman. Sengaja file TERPISAH dari lib/mrp/vendorTeamActions.ts ("use server")
 *  -- file "use server" hanya boleh mengekspor async function, konstanta biasa seperti array ini
 *  akan diam-diam berubah jadi referensi server action yang rusak kalau diimpor client component
 *  (gejala: "VENDOR_PAGE_OPTIONS.map is not a function" di browser, lolos tsc/lint karena itu
 *  bug runtime Next.js, bukan error tipe). */
export const VENDOR_PAGE_OPTIONS = [
  { href: "/vendor-maklon/po-produksi", label: "PO Produksi Saya" },
  { href: "/vendor-maklon/po-material", label: "PO Material Saya" },
  { href: "/vendor-maklon/receiving", label: "Good Receive" },
  { href: "/vendor-maklon/production", label: "Produksi (Resting/Cutting/Final)" },
  { href: "/vendor-maklon/pengiriman", label: "Pengiriman" },
  { href: "/vendor-maklon/invoice-payment", label: "Invoice & Payment" },
] as const;

export const VALID_VENDOR_PAGES = new Set<string>(VENDOR_PAGE_OPTIONS.map((p) => p.href));
