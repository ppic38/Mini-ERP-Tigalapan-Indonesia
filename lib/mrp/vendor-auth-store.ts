import { create } from "zustand";
import { persist } from "zustand/middleware";
import { loginVendorAction, loginVendorUserAction, logoutVendorAction } from "../auth/actions";
import { useMrpStore } from "./store";
import { useInternalAuthStore } from "../internal-auth-store";

// CATATAN MIGRASI SUPABASE: dulu login() mengecek password langsung ke
// VENDOR_PRODUKSI[id].password (plaintext, ter-bundle ke client, seragam "vendor123"
// buat semua vendor). Sekarang dicek server-only lewat Server Action loginVendorAction
// (lib/auth/actions.ts) terhadap kolom vendors_produksi.password_hash di Supabase, yang
// juga men-set cookie httpOnly sungguhan TERPISAH dari sesi role internal (lihat
// lib/auth/session.ts) -- login/logout vendor tidak lagi ikut melogout-kan role internal
// yang sedang aktif di tab lain. Store ini cuma cache hasilnya di client buat
// AppShell/Sidebar/VendorAuthGuard -- proteksi sesungguhnya ada di proxy.ts.
//
// Revisi 2026-09-27 (migration 0057, owner: "tim cutting, tim finish good, packing"): `actor`
// menyimpan identitas anggota tim kalau login lewat loginUser (akun sub-user) -- `null` kalau
// login lewat akun utama vendor (akses penuh). Dipakai AppShell untuk menyaring menu sidebar ke
// allowedPages saja & menampilkan nama anggota yang login, TIDAK untuk proteksi (proxy.ts yang
// membaca cookie httpOnly sungguhan yang jadi penjaga sebenarnya).
export type VendorActorInfo = { username: string; name: string; allowedPages: string[] };

type VendorAuthState = {
  loggedInVendorId: string | null;
  actor: VendorActorInfo | null;
  /** Login akun UTAMA berbasis ketik nama vendor (bukan dropdown/select) — `nameOrId`
   *  dicocokkan case-insensitive ke `name` ATAU kode vendor di server (lihat loginVendorAction). */
  login: (nameOrId: string, password: string) => Promise<boolean>;
  /** Login akun ANGGOTA TIM lewat username unik (lihat loginVendorUserAction). */
  loginUser: (username: string, password: string) => Promise<boolean>;
  logout: () => void;
};

export const useVendorAuthStore = create<VendorAuthState>()(
  persist(
    (set) => ({
      loggedInVendorId: null,
      actor: null,
      login: async (nameOrId, password) => {
        const result = await loginVendorAction(nameOrId, password);
        if (!result.ok) return false;
        set({ loggedInVendorId: result.vendorId ?? null, actor: null });
        // Login vendor = identitas aktif di browser ini pindah ke vendor (lihat ActiveIdentity di
        // lib/internal-auth-store.ts) -- supaya sesi Sysadmin yang lupa di-logout tidak membuat portal
        // vendor tampil sebagai Sysadmin.
        useInternalAuthStore.getState().setActiveIdentity("vendor");
        // Lihat catatan sama di lib/internal-auth-store.ts -- StoreHydrator tidak lagi refetch
        // otomatis tiap pindah halaman, jadi perlu dipicu manual begitu login sukses.
        void useMrpStore.getState().refresh();
        return true;
      },
      loginUser: async (username, password) => {
        const result = await loginVendorUserAction(username, password);
        if (!result.ok) return false;
        set({ loggedInVendorId: result.vendorId ?? null, actor: result.actor ?? null });
        useInternalAuthStore.getState().setActiveIdentity("vendor");
        void useMrpStore.getState().refresh();
        return true;
      },
      logout: () => {
        void logoutVendorAction();
        set({ loggedInVendorId: null, actor: null });
        const internal = useInternalAuthStore.getState();
        if (internal.activeIdentity === "vendor") internal.setActiveIdentity(null);
      },
    }),
    { name: "vendor-auth-v1" }
  )
);
