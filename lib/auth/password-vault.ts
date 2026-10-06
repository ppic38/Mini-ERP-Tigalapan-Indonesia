import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { supabaseServer } from "../supabase/server";

/** Salinan password TERENKRIPSI (bisa dibuka lagi) -- owner 2026-10-06: "sysadmin bisa melihat
 *  password terbaru dari semua modul akun ... takutnya ada user yang tanya apa passnya ini ke saya".
 *  Login TETAP memakai bcrypt hash (kolom password_hash, tidak berubah sama sekali); kolom
 *  `password_enc` cuma salinan tambahan supaya Sysadmin bisa menampilkannya (tombol "Lihat
 *  Password", tercatat di log audit). AES-256-GCM, kunci diturunkan dari SESSION_SECRET -- kalau
 *  SESSION_SECRET diganti, salinan lama tidak bisa dibuka lagi (cukup reset password akunnya).
 *
 *  Hanya dipanggil dari file server action (bukan "use server" sendiri). */

function key(): Buffer {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET belum di-set (lihat .env.local / env var Vercel).");
  return createHash("sha256").update("password-vault:" + secret).digest();
}

export function encryptPassword(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64"), cipher.getAuthTag().toString("base64"), enc.toString("base64")].join(":");
}

export function decryptPassword(stored: string): string | null {
  try {
    const [v, iv, tag, enc] = stored.split(":");
    if (v !== "v1") return null;
    const d = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64"));
    d.setAuthTag(Buffer.from(tag, "base64"));
    return Buffer.concat([d.update(Buffer.from(enc, "base64")), d.final()]).toString("utf8");
  } catch {
    return null;
  }
}

export type VaultTable = "internal_accounts" | "internal_role_users" | "vendors_produksi";
const KEY_COLUMN: Record<VaultTable, string> = { internal_accounts: "role", internal_role_users: "id", vendors_produksi: "id" };

/** Simpan salinan terenkripsi -- BEST-EFFORT & terpisah dari update hash utama: password sudah
 *  berhasil diganti (hash), jadi gagal di sini (mis. migration 0063 belum dijalankan, kolom belum
 *  ada) TIDAK boleh menggagalkan/menutupi penggantian password itu. */
export async function savePasswordCopy(table: VaultTable, keyValue: string, plain: string): Promise<void> {
  try {
    await supabaseServer().from(table).update({ password_enc: encryptPassword(plain) }).eq(KEY_COLUMN[table], keyValue);
  } catch {
    // diabaikan dengan sengaja -- lihat catatan di atas.
  }
}

export async function readPasswordCopy(table: VaultTable, keyValue: string): Promise<{ found: boolean; password: string | null }> {
  const { data, error } = await supabaseServer().from(table).select("password_enc").eq(KEY_COLUMN[table], keyValue).maybeSingle();
  if (error) throw new Error(error.message.includes("password_enc") ? "Kolom password_enc belum ada -- jalankan migration 0063 di Supabase dulu." : error.message);
  if (!data) return { found: false, password: null };
  const stored = (data as { password_enc?: string | null }).password_enc;
  return { found: true, password: stored ? decryptPassword(stored) : null };
}
