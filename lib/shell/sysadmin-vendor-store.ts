import { create } from "zustand";
import { persist } from "zustand/middleware";

/** Vendor produksi yang sedang "dilihat" Sysadmin di portal Vendor Produksi (owner 2026-09-30:
 *  Sysadmin ikut melihat & mengoreksi modul Vendor Produksi). Portal vendor dibangun per-vendor
 *  (semua halaman menerima `vendorId` dari VendorAuthGuard), sedangkan Sysadmin bukan vendor -- jadi
 *  Sysadmin memilih vendor mana yang mau dilihat, dan pilihan itu disimpan di sini. Hanya cache UI:
 *  server tetap menolak semua aksi transaksi vendor karena sesi Sysadmin tidak punya vendorId. */
type SysadminVendorState = {
  vendorId: string | null;
  setVendorId: (vendorId: string | null) => void;
};

export const useSysadminVendorStore = create<SysadminVendorState>()(
  persist(
    (set) => ({
      vendorId: null,
      setVendorId: (vendorId) => set({ vendorId }),
    }),
    { name: "sysadmin-view-vendor-v1" }
  )
);
