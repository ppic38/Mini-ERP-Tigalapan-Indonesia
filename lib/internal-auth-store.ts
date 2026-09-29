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
type InternalAuthState = {
  unlockedRoles: InternalRole[];
  actors: Partial<Record<InternalRole, InternalActorInfo>>;
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
      login: async (role, password) => {
        const result = await loginInternalAction(role, password);
        if (!result.ok) return false;
        const nextActors = { ...get().actors };
        delete nextActors[role];
        set({ unlockedRoles: Array.from(new Set([...get().unlockedRoles, role])), actors: nextActors });
        // StoreHydrator sekarang cuma fetch snapshot sekali saat mount + saat fokus/poll berkala
        // (lihat components/shell/store-hydrator.tsx, demi navigasi antar halaman yang cepat) --
        // tanpa baris ini, halaman pertama setelah login akan kosong sampai fokus/poll berikutnya.
        void useMrpStore.getState().refresh();
        return true;
      },
      loginUser: async (role, username, password) => {
        const result = await loginInternalUserAction(role, username, password);
        if (!result.ok) return false;
        set({ unlockedRoles: Array.from(new Set([...get().unlockedRoles, role])), actors: { ...get().actors, [role]: result.actor } });
        void useMrpStore.getState().refresh();
        return true;
      },
      logout: (role) => {
        void logoutInternalAction(role);
        const nextActors = { ...get().actors };
        delete nextActors[role];
        set({ unlockedRoles: get().unlockedRoles.filter((r) => r !== role), actors: nextActors });
      },
    }),
    { name: "internal-auth-v1" }
  )
);
