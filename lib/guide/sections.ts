/** Bagian-bagian halaman Panduan Penggunaan portal Vendor Produksi (urut sesuai menu sidebar vendor). `key` dipakai
 *  menautkan media (tabel guide_items, migration 0073) ke bagian yang tepat; `title` harus sama dengan judul di
 *  app/vendor-maklon/panduan/page.tsx. */
export const VENDOR_GUIDE_SECTIONS: { key: string; title: string }[] = [
  { key: "po-produksi", title: "1. PO Produksi Saya" },
  { key: "po-material", title: "2. PO Material Saya" },
  { key: "good-receive", title: "3. Good Receive" },
  { key: "produksi", title: "4. Produksi" },
  { key: "pengiriman", title: "5. Pengiriman" },
  { key: "invoice-payment", title: "6. Invoice & Payment" },
  { key: "tim-saya", title: "7. Tim Saya (khusus akun utama)" },
  { key: "profil", title: "8. Profil Saya & akun" },
  { key: "tips", title: "Tips bekerja bersama dalam satu tim" },
];

export type GuideKind = "VIDEO" | "IMAGE" | "LINK";

export type GuideItem = {
  id: string;
  portal: string;
  sectionKey: string;
  kind: GuideKind;
  title: string;
  url: string;
  caption: string;
  sortOrder: number;
  active: boolean;
};
