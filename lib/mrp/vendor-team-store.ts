import { create } from "zustand";
import {
  addVendorTeamMemberAction,
  deleteVendorTeamMemberAction,
  listVendorActionLogAction,
  listVendorTeamAction,
  resetVendorTeamMemberPasswordAction,
  revealVendorTeamMemberPasswordAction,
  updateVendorTeamMemberAction,
  type VendorActionLogRow,
  type VendorTeamMemberRow,
} from "./vendorTeamActions";

/** Cache + pembaruan "optimistic" untuk halaman Tim Saya (revisi 2026-10-08, owner: "jangan sampai lama
 *  memuat ... user hanya klik-klik dan datanya sudah ada, tapi jangan sampai conflict/corrupt").
 *
 *  - Daftar anggota & riwayat disimpan di memori selama aplikasi terbuka: pindah halaman lalu kembali
 *    TIDAK menampilkan "Memuat…" lagi -- data lama langsung tampil, lalu disegarkan di belakang layar.
 *  - Tambah / ubah / nonaktifkan / hapus: layar berubah seketika, server dikerjakan di belakang. Kalau
 *    server menolak (mis. username sudah dipakai), perubahan DIBATALKAN dan pemakai diberi tahu.
 *  - Anti-bentrok: snapshot yang diambil dari server DIBUANG kalau sebuah tulisan dimulai setelah
 *    pengambilan itu berangkat (epoch berubah) -- supaya data lama tidak menimpa perubahan yang baru
 *    dibuat. Setelah tulisan terakhir selesai, daftar diambil ulang sekali untuk disamakan dengan server.
 *  - Isi cache dipisah per vendor dan dikosongkan kalau vendor berganti (mis. login akun lain). */

export type TeamMember = VendorTeamMemberRow & { /** true selama baris baru belum dikonfirmasi server -- tombolnya dikunci. */ pending?: boolean };

type State = {
  vendorId: string | null;
  members: TeamMember[] | null;
  logs: VendorActionLogRow[] | null;
  loadTeam: (vendorId: string) => Promise<void>;
  loadLogs: (vendorId: string) => Promise<void>;
  addMember: (input: { username: string; name: string; password: string; allowedPages: string[] }) => Promise<void>;
  updateMember: (id: string, patch: { name?: string; allowedPages?: string[]; active?: boolean }) => Promise<void>;
  resetPassword: (id: string, newPassword: string) => Promise<void>;
  removeMember: (id: string) => Promise<void>;
  revealPassword: (id: string) => Promise<string | null>;
};

let writesInFlight = 0;
let epoch = 0;
let reloadTimer: ReturnType<typeof setTimeout> | null = null;

function unwrap<T>(res: { ok: true; data: T } | { ok: false; error: string }): T {
  if (!res.ok) throw new Error(res.error);
  return res.data;
}

export const useVendorTeamStore = create<State>((set, get) => {
  /** Ambil ulang daftar dari server -- hasilnya dibuang kalau ada tulisan yang mulai/berjalan sejak berangkat. */
  async function fetchTeam(vendorId: string) {
    const myEpoch = epoch;
    const res = await listVendorTeamAction();
    if (!res.ok) throw new Error(res.error);
    if (myEpoch !== epoch || writesInFlight > 0 || get().vendorId !== vendorId) return;
    set({ members: res.data });
  }

  /** Setelah tulisan terakhir selesai: samakan dengan server satu kali (ditunda sedikit supaya beberapa klik
   *  beruntun hanya memicu satu pengambilan). */
  function scheduleReload() {
    if (reloadTimer) clearTimeout(reloadTimer);
    reloadTimer = setTimeout(() => {
      reloadTimer = null;
      const vendorId = get().vendorId;
      if (!vendorId) return;
      if (writesInFlight > 0) return scheduleReload();
      void fetchTeam(vendorId).catch(() => {});
    }, 400);
  }

  async function write<T>(fn: () => Promise<T>): Promise<T> {
    writesInFlight++;
    epoch++;
    try {
      return await fn();
    } finally {
      writesInFlight--;
      scheduleReload();
    }
  }

  return {
    vendorId: null,
    members: null,
    logs: null,

    loadTeam: async (vendorId) => {
      if (get().vendorId !== vendorId) set({ vendorId, members: null, logs: null });
      await fetchTeam(vendorId);
    },

    loadLogs: async (vendorId) => {
      if (get().vendorId !== vendorId) set({ vendorId, members: null, logs: null });
      const res = await listVendorActionLogAction();
      if (res.ok && get().vendorId === vendorId) set({ logs: res.data });
    },

    addMember: async (input) => {
      const tmp: TeamMember = {
        id: `tmp-${Date.now()}`,
        username: input.username.trim(),
        name: input.name.trim(),
        allowedPages: input.allowedPages,
        active: true,
        createdAt: new Date().toISOString(),
        pending: true,
      };
      set({ members: [...(get().members ?? []), tmp] });
      try {
        await write(async () => unwrap(await addVendorTeamMemberAction(input)));
      } catch (err) {
        set({ members: (get().members ?? []).filter((m) => m.id !== tmp.id) });
        throw err;
      }
    },

    updateMember: async (id, patch) => {
      const prev = (get().members ?? []).find((m) => m.id === id);
      if (!prev) return;
      set({ members: (get().members ?? []).map((m) => (m.id === id ? { ...m, ...patch, name: patch.name?.trim() ?? m.name } : m)) });
      try {
        await write(async () => unwrap(await updateVendorTeamMemberAction(id, patch)));
      } catch (err) {
        // Kembalikan HANYA baris ini ke keadaan semula (tidak menyentuh baris lain yang mungkin berubah bersamaan).
        set({ members: (get().members ?? []).map((m) => (m.id === id ? prev : m)) });
        throw err;
      }
    },

    resetPassword: async (id, newPassword) => {
      await write(async () => unwrap(await resetVendorTeamMemberPasswordAction(id, newPassword)));
    },

    removeMember: async (id) => {
      const list = get().members ?? [];
      const index = list.findIndex((m) => m.id === id);
      if (index < 0) return;
      const prev = list[index];
      set({ members: list.filter((m) => m.id !== id) });
      try {
        await write(async () => unwrap(await deleteVendorTeamMemberAction(id)));
      } catch (err) {
        const now = get().members ?? [];
        if (!now.some((m) => m.id === id)) set({ members: [...now.slice(0, index), prev, ...now.slice(index)] });
        throw err;
      }
    },

    revealPassword: async (id) => unwrap(await revealVendorTeamMemberPasswordAction(id)).password,
  };
});
