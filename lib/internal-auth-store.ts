import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { InternalRole } from "./internal-auth";
import { loginInternalAction, logoutInternalAction } from "./auth/actions";
import { useMrpStore } from "./mrp/store";

// CATATAN MIGRASI SUPABASE: dulu login() mengecek password langsung terhadap
// INTERNAL_ACCOUNTS (plaintext, ter-bundle ke client). Sekarang password dicek
// server-only lewat Server Action loginInternalAction (lib/auth/actions.ts) yang juga
// men-set cookie httpOnly sungguhan (BISA lebih dari satu role aktif sekaligus, lihat
// lib/auth/session.ts) -- store ini cuma jadi CACHE hasilnya di client, dipakai
// AppShell/Sidebar untuk render, BUKAN lagi satu-satunya lapisan proteksi (proteksi
// sesungguhnya ada di proxy.ts, yang mengecek cookie tsb).
type InternalAuthState = {
  unlockedRoles: InternalRole[];
  // Revisi 2026-09-28 (owner-reported: begitu baru login Sysadmin lalu LANGSUNG klik modul lain,
  // sekilas kelihatan seperti "user modul biasa" -- sidebar/topbar salah -- baru benar setelah
  // klik/navigasi berikutnya) -- BUKAN soal lambat loading data, tapi race condition: `persist`
  // (localStorage) membaca `unlockedRoles` secara ASYNC, jadi render PERTAMA halaman yang baru
  // di-mount masih memakai nilai default `[]` (state awal SEBELUM localStorage sempat dibaca)
  // sebelum sempat "sadar" browser ini sebenarnya sudah login Sysadmin. `hasHydrated` menandai
  // kapan proses baca localStorage itu BENAR-BENAR selesai -- AppShell (components/shell/
  // app-shell.tsx) menunggu flag ini true dulu sebelum memutuskan sidebar/topbar mana yang
  // dipakai, supaya tidak pernah lagi "kedip" ke tampilan salah.
  hasHydrated: boolean;
  login: (role: InternalRole, password: string) => Promise<boolean>;
  logout: (role: InternalRole) => void;
};

export const useInternalAuthStore = create<InternalAuthState>()(
  persist(
    (set, get) => ({
      unlockedRoles: [],
      hasHydrated: false,
      login: async (role, password) => {
        const result = await loginInternalAction(role, password);
        if (!result.ok) return false;
        set({ unlockedRoles: Array.from(new Set([...get().unlockedRoles, role])) });
        // StoreHydrator sekarang cuma fetch snapshot sekali saat mount + saat fokus/poll berkala
        // (lihat components/shell/store-hydrator.tsx, demi navigasi antar halaman yang cepat) --
        // tanpa baris ini, halaman pertama setelah login akan kosong sampai fokus/poll berikutnya.
        void useMrpStore.getState().refresh();
        return true;
      },
      logout: (role) => {
        void logoutInternalAction(role);
        set({ unlockedRoles: get().unlockedRoles.filter((r) => r !== role) });
      },
    }),
    {
      name: "internal-auth-v1",
      // `hasHydrated` SENGAJA tidak ikut disimpan ke localStorage (partialize) -- nilainya harus
      // selalu dihitung ulang dari NOL tiap kali store ini dibuat (tiap load halaman/tab baru),
      // ditandai true HANYA setelah baca localStorage yang sesungguhnya benar-benar selesai lewat
      // onRehydrateStorage di bawah.
      partialize: (state) => ({ unlockedRoles: state.unlockedRoles }),
      onRehydrateStorage: () => () => {
        useInternalAuthStore.setState({ hasHydrated: true });
      },
    }
  )
);
