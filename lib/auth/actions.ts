"use server";

import { cookies } from "next/headers";
import bcrypt from "bcryptjs";
import { supabaseServer } from "../supabase/server";
import { createInternalSessionToken, createVendorSessionToken, sessionCookieOptions, INTERNAL_SESSION_COOKIE, VENDOR_SESSION_COOKIE, readSession } from "./session";
import { INTERNAL_ACCOUNTS, type InternalRole } from "../internal-auth";

type LoginResult = { ok: true } | { ok: false; error: string };

const INTERNAL_ROLE_ENV_VAR: Record<InternalRole, string> = {
  ppic: "INTERNAL_PASSWORD_PPIC",
  procurement: "INTERNAL_PASSWORD_PROCUREMENT",
  finance: "INTERNAL_PASSWORD_FINANCE",
  scm: "INTERNAL_PASSWORD_SCM",
  gm: "INTERNAL_PASSWORD_GM",
  produksi: "INTERNAL_PASSWORD_PRODUKSI",
  warehouse: "INTERNAL_PASSWORD_WAREHOUSE",
  sysadmin: "INTERNAL_PASSWORD_SYSADMIN",
};

/** Cek password role internal (PPIC/Procurement/Finance/SCM/Produksi) terhadap env var
 *  server-only, lalu set cookie sesi httpOnly. Password TIDAK lagi ada di bundle client
 *  (lihat lib/internal-auth.ts) -- satu-satunya tempat perbandingan terjadi di sini.
 *
 *  Role yang baru login DITAMBAHKAN ke daftar role yang sudah aktif (kalau ada), bukan
 *  menggantikannya -- supaya login ke modul lain di tab lain tidak melogout-kan modul yang
 *  sedang aktif di tab sebelumnya (lihat catatan desain di lib/auth/session.ts). */
export async function loginInternalAction(role: InternalRole, password: string): Promise<LoginResult> {
  const account = INTERNAL_ACCOUNTS.find((a) => a.role === role);
  if (!account) return { ok: false, error: "Modul tidak dikenali." };

  // Migrasi password modul internal dari env var ke database (migration 0056, Sysadmin) -- kalau
  // Sysadmin SUDAH pernah set password lewat portalnya, baris `internal_accounts` untuk role ini
  // ada & itu yang dipakai (bcrypt hash). Kalau belum pernah (baris tidak ada), FALLBACK ke env var
  // lama (INTERNAL_PASSWORD_<ROLE>) supaya login tidak mendadak putus untuk role yang belum
  // di-migrasi manual satu per satu.
  const { data: dbAccount } = await supabaseServer().from("internal_accounts").select("password_hash").eq("role", role).maybeSingle();
  if (dbAccount) {
    const ok = await bcrypt.compare(password, dbAccount.password_hash);
    if (!ok) return { ok: false, error: "Password salah." };
  } else {
    const expected = process.env[INTERNAL_ROLE_ENV_VAR[role]];
    if (!expected || password !== expected) {
      return { ok: false, error: "Password salah." };
    }
  }

  const cookieStore = await cookies();
  const existing = await readSession(cookieStore);
  const roles = Array.from(new Set([...existing.internalRoles, role]));
  const token = await createInternalSessionToken(roles);
  cookieStore.set(INTERNAL_SESSION_COOKIE, token, sessionCookieOptions);
  return { ok: true };
}

/** Cek login vendor produksi (maklon): cocokkan nama/kode vendor (case-insensitive),
 *  lalu bandingkan password terhadap password_hash (bcrypt) di tabel vendors_produksi.
 *  Cookie TERPISAH dari sesi internal (lihat lib/auth/session.ts) -- login vendor tidak
 *  menyentuh sesi role internal manapun yang sedang aktif. */
export async function loginVendorAction(nameOrId: string, password: string): Promise<LoginResult & { vendorId?: string }> {
  const query = nameOrId.trim().toLowerCase();
  if (!query) return { ok: false, error: "Nama vendor atau password salah." };

  const { data, error } = await supabaseServer().from("vendors_produksi").select("id,name,password_hash");
  if (error || !data) return { ok: false, error: "Gagal menghubungi server, coba lagi." };

  const match = data.find((v) => v.name.toLowerCase() === query || v.id.toLowerCase() === query);
  if (!match) return { ok: false, error: "Nama vendor atau password salah." };

  const passwordOk = await bcrypt.compare(password, match.password_hash);
  if (!passwordOk) return { ok: false, error: "Nama vendor atau password salah." };

  const token = await createVendorSessionToken(match.id);
  (await cookies()).set(VENDOR_SESSION_COOKIE, token, sessionCookieOptions);
  return { ok: true, vendorId: match.id };
}

/** Login akun ANGGOTA TIM vendor (migration 0057, owner 2026-09-27: "tim cutting, tim finish
 *  good, packing") -- `username` unik se-aplikasi, TIDAK perlu pilih nama vendor dulu (beda dari
 *  loginVendorAction di atas). Sesi yang terbentuk PERSIS sama (cookie vendor, `vendorId` = vendor
 *  induknya) supaya seluruh action/halaman vendor yang sudah ada (requireVendorSession dkk) jalan
 *  tanpa disentuh -- yang membedakan cuma `vendorActor` (dicek proxy.ts untuk batasi halaman, &
 *  dibaca beberapa action untuk vendor_action_log). Akun nonaktif (`active=false`) ditolak. */
export async function loginVendorUserAction(
  username: string,
  password: string
): Promise<LoginResult & { vendorId?: string; actor?: { username: string; name: string; allowedPages: string[] } }> {
  const query = username.trim();
  if (!query) return { ok: false, error: "Username atau password salah." };

  const { data: match, error } = await supabaseServer()
    .from("vendor_users")
    .select("id,vendor_produksi,username,name,password_hash,allowed_pages,active")
    .ilike("username", query)
    .maybeSingle();
  if (error) return { ok: false, error: "Gagal menghubungi server, coba lagi." };
  if (!match || !match.active) return { ok: false, error: "Username atau password salah." };

  const passwordOk = await bcrypt.compare(password, match.password_hash);
  if (!passwordOk) return { ok: false, error: "Username atau password salah." };

  const token = await createVendorSessionToken(match.vendor_produksi, {
    vendorUserId: match.id,
    username: match.username,
    name: match.name,
    allowedPages: match.allowed_pages ?? [],
  });
  (await cookies()).set(VENDOR_SESSION_COOKIE, token, sessionCookieOptions);
  return { ok: true, vendorId: match.vendor_produksi, actor: { username: match.username, name: match.name, allowedPages: match.allowed_pages ?? [] } };
}

/** Logout SATU role internal saja -- kalau masih ada role lain yang aktif, cookie ditulis ulang
 *  tanpa role ini (bukan dihapus total); kalau ini role terakhir, cookie baru dihapus. */
export async function logoutInternalAction(role: InternalRole): Promise<void> {
  const cookieStore = await cookies();
  const existing = await readSession(cookieStore);
  const remaining = existing.internalRoles.filter((r) => r !== role);
  if (remaining.length === 0) {
    cookieStore.delete(INTERNAL_SESSION_COOKIE);
  } else {
    cookieStore.set(INTERNAL_SESSION_COOKIE, await createInternalSessionToken(remaining), sessionCookieOptions);
  }
}

/** Logout vendor -- cookie terpisah, tidak menyentuh sesi role internal manapun. */
export async function logoutVendorAction(): Promise<void> {
  (await cookies()).delete(VENDOR_SESSION_COOKIE);
}
