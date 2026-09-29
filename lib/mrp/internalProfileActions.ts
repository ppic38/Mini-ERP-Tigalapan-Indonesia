"use server";

import bcrypt from "bcryptjs";
import { requireSession, internalActorForRole } from "../auth/session";
import { supabaseServer } from "../supabase/server";
import type { ActionResult } from "./action-result";
import type { InternalRole } from "../internal-auth";
import { nextReadableId } from "./repo/ids";

/** Profil Saya (self-service) -- owner 2026-09-29: "buat untuk akun dari tiap modul itu bisa
 *  lihat akun profile ... username, Full Name, Password. Dan bisa edit itu". BEDA dari Sysadmin
 *  "Akun & Password" (yang itu jalur ADMIN, siapa saja bisa diedit, WAJIB alasan + audit log) --
 *  di sini orangnya SENDIRI yang login, hanya bisa lihat/edit BARISNYA SENDIRI di
 *  `internal_role_users` (migration 0060), tidak butuh alasan (bukan aksi darurat/admin). Password
 *  saat ini WAJIB dicocokkan dulu sebelum ganti password baru (pola sama dengan ganti password
 *  akun biasa di aplikasi lain), supaya orang lain yang kebetulan lagi login di device yang sama
 *  tidak bisa iseng ganti password tanpa tahu password lama.
 *
 *  CATATAN: akun UTAMA (password bersama modul, tabel internal_accounts) TIDAK punya baris di
 *  internal_role_users sama sekali -- makanya tidak ada "profil" buat diedit lewat sini (ganti
 *  password akun utama tetap lewat Sysadmin > Akun & Password > Ganti Password). Kalau nama
 *  diganti di sini, sesi yang SEDANG login tetap menampilkan nama LAMA sampai logout+login ulang
 *  (nama disimpan di dalam token sesi saat login, bukan dibaca ulang tiap request) -- sama seperti
 *  keterbatasan vendor_users, bukan bug baru. */

export type MyInternalProfile = { id: string; username: string; name: string; role: InternalRole };

async function requireMyActor(role: InternalRole) {
  const session = await requireSession();
  if (!session.internalRoles.includes(role)) throw new Error("Forbidden: sesi Anda tidak punya akses ke modul ini.");
  const actor = internalActorForRole(session, role);
  if (!actor) throw new Error("Akun ini login lewat password modul (akun utama), belum punya profil pribadi. Hubungi Sysadmin kalau perlu dibuatkan akun bernama.");
  return actor;
}

export async function getMyInternalProfileAction(role: InternalRole): Promise<ActionResult<MyInternalProfile>> {
  try {
    const actor = await requireMyActor(role);
    const db = supabaseServer();
    const { data: row, error } = await db.from("internal_role_users").select("id, username, name, active").eq("id", actor.internalUserId).maybeSingle();
    if (error) throw new Error(error.message);
    if (!row || !row.active) throw new Error("Akun tidak ditemukan atau sudah dinonaktifkan. Hubungi Sysadmin.");
    return { ok: true, data: { id: row.id, username: row.username, name: row.name, role } };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function updateMyInternalProfileAction(
  role: InternalRole,
  patch: { name?: string; currentPassword?: string; newPassword?: string }
): Promise<ActionResult<{ name: string }>> {
  try {
    const actor = await requireMyActor(role);
    const db = supabaseServer();
    const { data: row, error } = await db.from("internal_role_users").select("id, name, password_hash, active").eq("id", actor.internalUserId).maybeSingle();
    if (error) throw new Error(error.message);
    if (!row || !row.active) throw new Error("Akun tidak ditemukan atau sudah dinonaktifkan. Hubungi Sysadmin.");

    const updates: { name?: string; password_hash?: string } = {};
    const newName = patch.name?.trim();
    if (newName && newName !== row.name) updates.name = newName;

    if (patch.newPassword) {
      if (!patch.currentPassword) throw new Error("Masukkan password Anda saat ini untuk mengganti password.");
      const matches = await bcrypt.compare(patch.currentPassword, row.password_hash);
      if (!matches) throw new Error("Password saat ini salah.");
      if (patch.newPassword.length < 6) throw new Error("Password baru minimal 6 karakter.");
      updates.password_hash = await bcrypt.hash(patch.newPassword, 10);
    }

    if (Object.keys(updates).length === 0) throw new Error("Tidak ada perubahan untuk disimpan.");

    const { error: updErr } = await db.from("internal_role_users").update(updates).eq("id", actor.internalUserId);
    if (updErr) throw new Error(updErr.message);

    // Best-effort, sama pola logInternalAction di lib/mrp/actions.ts -- tidak melempar error kalau gagal.
    try {
      const id = await nextReadableId("IAL");
      await db.from("internal_action_log").insert({
        id,
        role,
        internal_user_id: actor.internalUserId,
        actor_name: updates.name ?? row.name,
        action: updates.password_hash ? "Ubah profil (nama & password)" : "Ubah profil (nama)",
      });
    } catch {
      // diabaikan dengan sengaja.
    }

    return { ok: true, data: { name: updates.name ?? row.name } };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
