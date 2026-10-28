import { createHmac, timingSafeEqual } from "node:crypto";

/** Tanda tangan untuk integrasi WOS (Warehouse Operation System). Murni fungsi (tanpa database) supaya mudah diuji. */

export function hmacHex(secret: string, data: string): string {
  return createHmac("sha256", secret).update(data).digest("hex");
}

/** Nilai header `X-ERP-Signature` untuk satu kiriman: HMAC-SHA256 dari `${timestamp}.${body}`. */
export function signWebhook(secret: string, timestamp: string, body: string): string {
  return "sha256=" + hmacHex(secret, `${timestamp}.${body}`);
}

export function safeEqualHex(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Tautan unduh lampiran resi: "list" = daftar file satu resi, "file" = satu file (index). Berlaku sampai `exp` (detik epoch). */
export type FileLinkScope = "list" | "file";

export function fileLinkSignature(secret: string, scope: FileLinkScope, resiGroupId: string, index: number, exp: number): string {
  return hmacHex(secret, `${scope}|${resiGroupId}|${index}|${exp}`);
}

export function verifyFileLink(
  secret: string,
  scope: FileLinkScope,
  resiGroupId: string,
  index: number,
  exp: number,
  sig: string,
  nowSec: number = Math.floor(Date.now() / 1000)
): boolean {
  if (!Number.isFinite(exp) || exp < nowSec) return false;
  return safeEqualHex(fileLinkSignature(secret, scope, resiGroupId, index, exp), sig);
}
