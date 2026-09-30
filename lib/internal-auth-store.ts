import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { InternalRole } from "./internal-auth";
import { loginInternalAction, loginInternalUserAction, logoutInternalAction } from "./auth/actions";
import { useMrpStore } from "./mrp/store";

// Revisi 2026-09-29 (migration 0060, owner: "procurement ternyata ada dua orang, fulan dan fulin
// ... biar tau siapa PIC-nya") -- `actors` menyimpan identitas anggota tim PER ROLE kalau login
// lewat loginUser (akun sub-user), `undefined` untuk role yang login lewat akun utama (password
// bersama). Dipakai AppShell buat menampilkan nama di topbar, TIDAK untuk proteksi (cookie httpOnly
// sungguhan yang jadi penjaga sebenarnya, lihat lib/auth/session.ts).
export type InternalActorInfo = { username: string; name: string };

// CATATAN MIGRASI SUPABASE: dulu login() mengecek password langsung terhadap
// INTERNAL_ACCOUNTS (plaintext, ter-bundle ke client). Sekarang password dicek
// server-only lewat Server Action loginInternalAction (lib/auth/actions.ts) yang juga
// men-set cookie httpOnly sungguhan (BISA lebih dari satu role aktif sekaligus, lihat
// lib/auth/session.ts) -- store ini cuma jadi CACHE hasilnya di client, dipakai
// AppShell/Sidebar untuk render, BUKAN lagi satu-satunya lapisan proteksi (proteksi
// sesungguhnya ada di proxy.ts, yang mengecek cookie tsb).
/** Identitas yang sedang AKTIF di browser ini = login TERAKHIR (role internal atau "vendor"). Satu browser
 *  boleh menyimpan beberapa sesi sekaligus (lihat catatan desain di lib/auth/session.ts), jadi perlu
 *  penanda mana yang sedang dipakai. Dipakai untuk memutuskan "Mode Sysadmin" (lihat isSysadminActive):
 *  tanpa ini, sesi Sysadmin yang lupa di-logout membuat SEMUA halaman (termasuk halaman vendor yang
 *  baru login) tampil sebagai Sysadmin. `null` = belum ada penanda (state lama sebelum fitur ini) atau
 *  akun aktifnya baru logout. */
export type ActiveIdentity = InternalRole | "vendor" | null;

/** Mode Sysadmin aktif kalau Sysadmin terbuka DAN identitas aktifnya Sysadmin (atau belum ada penanda --
 *  perilaku lama, Sysadmin yang dianggap aktif). Login modul/vendor lain SETELAH Sysadmin memindahkan
 *  identitas aktif sehingga halaman tampil normal sebagai modul/vendor itu. */
export function isSysadminActive(unlockedRoles: InternalRole[], activeIdentity: ActiveIdentity): boolean {
  return unlockedRoles.includes("sysadmin") && (activeIdentity === null || activeIdentity === "sysadmin");
}

type InternalAuthState = {
  unlockedRoles: InternalRole[];
  actors: Partial<Record<InternalRole, InternalActorInfo>>;
  activeIdentity: ActiveIdentity;
  setActiveIdentity: (identity: ActiveIdentity) => void;
  login: (role: InternalRole, password: string) => Promise<boolean>;
  /** Login akun ANGGOTA TIM lewat username unik (lihat loginInternalUserAction). */
  loginUser: (role: InternalRole, username: string, password: string) => Promise<boolean>;
  logout: (role: InternalRole) => void;
};

export const useInternalAuthStore = create<InternalAuthState>()(
  persist(
    (set, get) => ({
      unlockedRoles: [],
      actors: {},
      activeIdentity: null,
      setActiveIdentity: (identity) => set({ activeIdentity: identity }),
      login: async (role, password) => {
        const result = await loginInternalAction(role, password);
        if (!result.ok) return false;
        const nextActors = { ...get().actors };
        delete nextActors[role];
        set({ unlockedRoles: Array.from(new Set([...get().unlockedRoles, role])), actors: nextActors, activeIdentity: role });
        // StoreHydrator sekarang cuma fetch snapshot sekali saat mount + saat fokus/poll berkala
        // (lihat components/shell/store-hydrator.tsx, demi navigasi antar halaman yang cepat) --
        // tanpa baris ini, halaman pertama setelah login akan kosong sampai fokus/poll berikutnya.
        void useMrpStore.getState().refresh();
        return true;
      },
      loginUser: async (role, username, password) => {
        const result = await loginInternalUserAction(role, username, password);
        if (!result.ok) return false;
        set({ unlockedRoles: Array.from(new Set([...get().unlockedRoles, role])), actors: { ...get().actors, [role]: result.actor }, activeIdentity: role });
        void useMrpStore.getState().refresh();
        return true;
      },
      logout: (role) => {
        void logoutInternalAction(role);
        const nextActors = { ...get().actors };
        delete nextActors[role];
        set({ unlockedRoles: get().unlockedRoles.filter((r) => r !== role), actors: nextActors, activeIdentity: get().activeIdentity === role ? null : get().activeIdentity });
      },
    }),
    { name: "internal-auth-v1" }
  )
);
