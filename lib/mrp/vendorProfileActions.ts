"use server";

import bcrypt from "bcryptjs";
import { requireSession } from "../auth/session";
import { supabaseServer } from "../supabase/server";
import type { ActionResult } from "./action-result";
import { nextReadableId } from "./repo/ids";
import { savePasswordCopy } from "../auth/password-vault";

/** Profil Saya untuk portal Vendor Produksi (owner 2026-10-09: "halaman profile untuk vendor produksi, main account dan sub
 *  account, untuk bisa ubah password ... username tidak boleh dirubah supaya nama vendor tidak ke tracking"). Berlaku untuk
 *  akun UTAMA (vendors_produksi) maupun anggota tim (vendor_users). Hanya password yang bisa diubah; username dan nama
 *  ditampilkan saja (jejak "siapa mengerjakan apa" di vendor_action_log memakai nama itu). Password saat ini WAJIB dicocokkan
 *  dulu di server. Sesi yang sedang berjalan tetap valid setelah password diganti (cookie sesi tidak memuat password). */

export type VendorProfile = {
  kind: "MAIN" | "MEMBER";
  /** Akun utama: login memakai nama vendor; anggota tim: username. */
  loginName: string;
  name: string;
  vendorName: string;
};

async function requireVendorAccount() {
  const session = await requireSession();
  if (!session.vendorId) throw new Error("Forbidden: aksi ini hanya untuk sesi vendor produksi.");
  return { vendorId: session.vendorId, actor: session.vendorActor };
}

export async function getMyVendorProfileAction(): Promise<ActionResult<VendorProfile>> {
  try {
    const { vendorId, actor } = await requireVendorAccount();
    const db = supabaseServer();
    const { data: vendor, error: vErr } = await db.from("vendors_produksi").select("name").eq("id", vendorId).maybeSingle();
    if (vErr) throw new Error(vErr.message);
    const vendorName = vendor?.name ?? vendorId;
    if (!actor) return { ok: true, data: { kind: "MAIN", loginName: vendorName, name: vendorName, vendorName } };
    const { data: row, error } = await db.from("vendor_users").select("username,name,active").eq("id", actor.vendorUserId).eq("vendor_produksi", vendorId).maybeSingle();
    if (error) throw new Error(error.message);
    if (!row || !row.active) throw new Error("Akun tidak ditemukan atau sudah dinonaktifkan. Hubungi akun utama vendor Anda.");
    return { ok: true, data: { kind: "MEMBER", loginName: row.username, name: row.name, vendorName } };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function changeMyVendorPasswordAction(currentPassword: string, newPassword: string): Promise<ActionResult<void>> {
  try {
    const { vendorId, actor } = await requireVendorAccount();
    if (!currentPassword) throw new Error("Masukkan password Anda saat ini.");
    if (newPassword.length < 6) throw new Error("Password baru minimal 6 karakter.");
    if (newPassword === currentPassword) throw new Error("Password baru harus berbeda dari password saat ini.");
    const db = supabaseServer();
    const table = actor ? "vendor_users" : "vendors_produksi";
    const keyValue = actor ? actor.vendorUserId : vendorId;
    const { data: row, error } = await db.from(table).select("password_hash").eq("id", keyValue).maybeSingle();
    if (error) throw new Error(error.message);
    if (!row?.password_hash) throw new Error("Akun tidak ditemukan.");
    if (!(await bcrypt.compare(currentPassword, row.password_hash))) throw new Error("Password saat ini salah.");
    const { error: updErr } = await db.from(table).update({ password_hash: await bcrypt.hash(newPassword, 10) }).eq("id", keyValue);
    if (updErr) throw new Error(updErr.message);
    // Salinan terenkripsi (Sysadmin / Tim Saya bisa melihat password terbaru) -- best-effort, tidak menggagalkan penggantian.
    await savePasswordCopy(table, keyValue, newPassword);
    try {
      const id = await nextReadableId("VAL");
      await db.from("vendor_action_log").insert({
        id,
        vendor_produksi: vendorId,
        vendor_user_id: actor?.vendorUserId ?? null,
        actor_name: actor?.name ?? "Akun utama",
        action: "Ganti password sendiri",
        target_type: table,
        target_id: keyValue,
      });
    } catch {
      // diabaikan dengan sengaja -- jejak log bukan alasan menggagalkan penggantian password.
    }
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
