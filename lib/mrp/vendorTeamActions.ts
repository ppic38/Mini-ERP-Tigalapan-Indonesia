"use server";

import bcrypt from "bcryptjs";
import { requireSession } from "../auth/session";
import { supabaseServer } from "../supabase/server";
import type { ActionResult } from "./action-result";
import { nextReadableId } from "./repo/ids";
import { VALID_VENDOR_PAGES } from "./vendorPages";

/** Kelola "Tim Saya" -- akun anggota tim per vendor produksi (migration 0057, owner 2026-09-27:
 *  "tim cutting, tim finish good, packing", dikelola vendor sendiri dari portalnya). HANYA akun
 *  UTAMA vendor (login lewat nama vendor, TIDAK punya `vendorActor` di sesi) yang boleh
 *  memanggil fungsi-fungsi ini -- akun sub-user (anggota tim) tidak bisa membuat/mengelola akun
 *  lain, walau kebetulan diberi akses ke halaman "/vendor-maklon/team" (proxy.ts sudah menutup
 *  path itu untuk sub-user, ini lapis kedua di sisi server action). Daftar halaman yang bisa
 *  diberikan izin ada di ./vendorPages.ts (BUKAN di sini -- file ini "use server", lihat
 *  catatan di file itu kenapa keduanya harus terpisah). */

async function toActionResult<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Vendor UTAMA saja (bukan sub-user) -- lihat catatan di atas file. */
async function requireMainVendorSession(): Promise<string> {
  const session = await requireSession();
  if (!session.vendorId) throw new Error("Forbidden: aksi ini hanya untuk sesi vendor produksi.");
  if (session.vendorActor) throw new Error("Forbidden: akun anggota tim tidak bisa mengelola Tim Saya -- masuk lewat akun utama vendor.");
  return session.vendorId;
}

function sanitizePages(pages: string[]): string[] {
  const unique = Array.from(new Set(pages));
  const invalid = unique.filter((p) => !VALID_VENDOR_PAGES.has(p));
  if (invalid.length > 0) throw new Error(`Halaman tidak dikenali: ${invalid.join(", ")}`);
  return unique;
}

export type VendorTeamMemberRow = { id: string; username: string; name: string; allowedPages: string[]; active: boolean; createdAt: string };

export async function listVendorTeamAction(): Promise<ActionResult<VendorTeamMemberRow[]>> {
  return toActionResult(async () => {
    const vendorId = await requireMainVendorSession();
    const { data, error } = await supabaseServer().from("vendor_users").select("id,username,name,allowed_pages,active,created_at").eq("vendor_produksi", vendorId).order("created_at");
    if (error) throw new Error(error.message);
    return (data ?? []).map((r) => ({ id: r.id, username: r.username, name: r.name, allowedPages: r.allowed_pages ?? [], active: r.active, createdAt: r.created_at }));
  });
}

export async function addVendorTeamMemberAction(input: { username: string; name: string; password: string; allowedPages: string[] }): Promise<ActionResult<void>> {
  return toActionResult(async () => {
    const vendorId = await requireMainVendorSession();
    const username = input.username.trim();
    if (!/^[a-zA-Z0-9._-]{3,32}$/.test(username)) throw new Error("Username 3-32 karakter, huruf/angka/titik/garis (tanpa spasi).");
    if (!input.name.trim()) throw new Error("Nama wajib diisi.");
    if (input.password.length < 6) throw new Error("Password minimal 6 karakter.");
    const pages = sanitizePages(input.allowedPages);
    if (pages.length === 0) throw new Error("Pilih minimal 1 halaman yang boleh diakses.");
    const db = supabaseServer();
    const { data: existing } = await db.from("vendor_users").select("id").ilike("username", username).maybeSingle();
    if (existing) throw new Error(`Username "${username}" sudah dipakai -- pilih username lain.`);
    const id = await nextReadableId("VU");
    const hash = await bcrypt.hash(input.password, 10);
    const { error } = await db.from("vendor_users").insert({ id, vendor_produksi: vendorId, username, name: input.name.trim(), password_hash: hash, allowed_pages: pages, active: true });
    if (error) throw new Error(error.message);
  });
}

export async function updateVendorTeamMemberAction(id: string, patch: { name?: string; allowedPages?: string[]; active?: boolean }): Promise<ActionResult<void>> {
  return toActionResult(async () => {
    const vendorId = await requireMainVendorSession();
    const db = supabaseServer();
    const { data: row } = await db.from("vendor_users").select("id").eq("id", id).eq("vendor_produksi", vendorId).maybeSingle();
    if (!row) throw new Error("Anggota tim tidak ditemukan.");
    const p: Record<string, unknown> = {};
    if (patch.name !== undefined) {
      if (!patch.name.trim()) throw new Error("Nama wajib diisi.");
      p.name = patch.name.trim();
    }
    if (patch.allowedPages !== undefined) {
      const pages = sanitizePages(patch.allowedPages);
      if (pages.length === 0) throw new Error("Pilih minimal 1 halaman yang boleh diakses.");
      p.allowed_pages = pages;
    }
    if (patch.active !== undefined) p.active = patch.active;
    const { error } = await db.from("vendor_users").update(p).eq("id", id);
    if (error) throw new Error(error.message);
  });
}

export async function resetVendorTeamMemberPasswordAction(id: string, newPassword: string): Promise<ActionResult<void>> {
  return toActionResult(async () => {
    const vendorId = await requireMainVendorSession();
    if (newPassword.length < 6) throw new Error("Password minimal 6 karakter.");
    const db = supabaseServer();
    const { data: row } = await db.from("vendor_users").select("id").eq("id", id).eq("vendor_produksi", vendorId).maybeSingle();
    if (!row) throw new Error("Anggota tim tidak ditemukan.");
    const hash = await bcrypt.hash(newPassword, 10);
    const { error } = await db.from("vendor_users").update({ password_hash: hash }).eq("id", id);
    if (error) throw new Error(error.message);
  });
}

export async function deleteVendorTeamMemberAction(id: string): Promise<ActionResult<void>> {
  return toActionResult(async () => {
    const vendorId = await requireMainVendorSession();
    const { error } = await supabaseServer().from("vendor_users").delete().eq("id", id).eq("vendor_produksi", vendorId);
    if (error) throw new Error(error.message);
  });
}

export type VendorActionLogRow = { id: string; actorName: string; action: string; targetType?: string; targetId?: string; createdAt: string };

/** Riwayat "siapa klik apa" (vendor_action_log) untuk vendor ini -- dilihat akun utama saja. */
export async function listVendorActionLogAction(limit = 100): Promise<ActionResult<VendorActionLogRow[]>> {
  return toActionResult(async () => {
    const vendorId = await requireMainVendorSession();
    const { data, error } = await supabaseServer()
      .from("vendor_action_log")
      .select("id,actor_name,action,target_type,target_id,created_at")
      .eq("vendor_produksi", vendorId)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) throw new Error(error.message);
    return (data ?? []).map((r) => ({ id: r.id, actorName: r.actor_name, action: r.action, targetType: r.target_type ?? undefined, targetId: r.target_id ?? undefined, createdAt: r.created_at }));
  });
}
