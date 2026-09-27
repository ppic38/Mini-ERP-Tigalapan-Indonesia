"use server";

import bcrypt from "bcryptjs";
import { requireSession } from "../auth/session";
import { supabaseServer } from "../supabase/server";
import type { ActionResult } from "./action-result";
import { INTERNAL_ACCOUNTS, type InternalRole } from "../internal-auth";
import { nextReadableId } from "./repo/ids";

/** Bungkus aksi supaya alasan gagalnya sampai ke user di production (sama pola dengan lib/mrp/actions.ts). */
async function toActionResult<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Modul Sysadmin (owner 2026-09-27, migration 0056) -- super admin: kelola/reset password semua
 *  akun (modul internal + vendor produksi) dan batalkan PO/MRP yang salah input. SEMUA aksi di sini
 *  WAJIB alasan & tercatat permanen ke `sysadmin_audit_log` (writeAuditLog) -- tidak ada tombol hapus
 *  log dari UI mana pun. `requireSysadmin()` dipanggil di setiap fungsi, sama pola dengan
 *  requireInternalRole di lib/mrp/actions.ts. */

async function requireSysadmin() {
  const session = await requireSession();
  if (!session.internalRoles.includes("sysadmin")) throw new Error("Forbidden: aksi ini hanya untuk modul Sysadmin.");
}

async function writeAuditLog(action: string, targetType: string, targetId: string, reason: string, before: unknown, after: unknown) {
  const db = supabaseServer();
  const id = await nextReadableId("AUD");
  const { error } = await db.from("sysadmin_audit_log").insert({ id, action, target_type: targetType, target_id: targetId, reason, before: before ?? null, after: after ?? null });
  if (error) throw new Error(`Aksi berhasil tapi gagal menulis log audit: ${error.message}`);
}

// =========================================================================
// Kelola akun & password
// =========================================================================

export type InternalAccountRow = { role: InternalRole; label: string; hasDbPassword: boolean; updatedAt?: string };

export async function listInternalAccountsAction(): Promise<ActionResult<InternalAccountRow[]>> {
  return toActionResult(async () => {
    await requireSysadmin();
    const { data, error } = await supabaseServer().from("internal_accounts").select("role,updated_at");
    if (error) throw new Error(error.message);
    const byRole = new Map((data ?? []).map((r) => [r.role, r.updated_at as string]));
    return INTERNAL_ACCOUNTS.map((a) => ({ role: a.role, label: a.label, hasDbPassword: byRole.has(a.role), updatedAt: byRole.get(a.role) }));
  });
}

export async function setInternalAccountPasswordAction(role: InternalRole, newPassword: string, reason: string): Promise<ActionResult<void>> {
  return toActionResult(async () => {
    await requireSysadmin();
    if (!reason.trim()) throw new Error("Alasan wajib diisi.");
    if (newPassword.length < 6) throw new Error("Password minimal 6 karakter.");
    const account = INTERNAL_ACCOUNTS.find((a) => a.role === role);
    if (!account) throw new Error("Modul tidak dikenali.");
    const db = supabaseServer();
    const { data: before } = await db.from("internal_accounts").select("role,updated_at").eq("role", role).maybeSingle();
    const hash = await bcrypt.hash(newPassword, 10);
    const { error } = await db.from("internal_accounts").upsert({ role, password_hash: hash, updated_at: new Date().toISOString() });
    if (error) throw new Error(error.message);
    await writeAuditLog("SET_INTERNAL_PASSWORD", "internal_accounts", role, reason.trim(), { hadDbPassword: !!before }, { hadDbPassword: true });
  });
}

export type VendorAccountRow = { id: string; name: string };

export async function listVendorAccountsAction(): Promise<ActionResult<VendorAccountRow[]>> {
  return toActionResult(async () => {
    await requireSysadmin();
    const { data, error } = await supabaseServer().from("vendors_produksi").select("id,name").order("name");
    if (error) throw new Error(error.message);
    return (data ?? []).map((r) => ({ id: r.id, name: r.name }));
  });
}

export async function resetVendorPasswordAction(vendorId: string, newPassword: string, reason: string): Promise<ActionResult<void>> {
  return toActionResult(async () => {
    await requireSysadmin();
    if (!reason.trim()) throw new Error("Alasan wajib diisi.");
    if (newPassword.length < 6) throw new Error("Password minimal 6 karakter.");
    const db = supabaseServer();
    const { data: vendor } = await db.from("vendors_produksi").select("id,name").eq("id", vendorId).maybeSingle();
    if (!vendor) throw new Error("Vendor tidak ditemukan.");
    const hash = await bcrypt.hash(newPassword, 10);
    const { error } = await db.from("vendors_produksi").update({ password_hash: hash }).eq("id", vendorId);
    if (error) throw new Error(error.message);
    await writeAuditLog("RESET_VENDOR_PASSWORD", "vendors_produksi", vendorId, reason.trim(), null, { vendorName: vendor.name });
  });
}

// =========================================================================
// Batalkan PO (Material & Produksi) -- "just in case ada kesalahan data"
// =========================================================================

export async function sysadminCancelMaterialPoAction(poId: string, reason: string): Promise<ActionResult<void>> {
  return toActionResult(async () => {
    await requireSysadmin();
    if (!reason.trim()) throw new Error("Alasan wajib diisi.");
    const db = supabaseServer();
    const { data: po, error: fetchErr } = await db.from("material_pos").select("*").eq("id", poId).maybeSingle();
    if (fetchErr) throw new Error(fetchErr.message);
    if (!po) throw new Error("PO Material tidak ditemukan.");
    if (po.status === "CANCELLED") throw new Error("PO ini sudah dibatalkan.");
    const { error } = await db.from("material_pos").update({ status: "CANCELLED" }).eq("id", poId);
    if (error) throw new Error(error.message);
    await writeAuditLog(
      "CANCEL_MATERIAL_PO",
      "material_pos",
      poId,
      reason.trim(),
      { status: po.status, approved: po.approved, invoicedRolls: po.invoiced_rolls },
      { status: "CANCELLED" }
    );
    // Catatan penting (didokumentasikan ke user, bukan cuma komentar): aksi ini HANYA menandai PO
    // sebagai dibatalkan (dikeluarkan dari daftar aktif/approval/Finance) -- roll/invoice bahan yang
    // SUDAH tercatat (raw_material_invoices dkk, kalau po.invoiced_rolls > 0) TIDAK ikut dibatalkan/
    // dihapus otomatis, karena membongkarnya bisa merusak jejak HPP & fisik bahan yang mungkin sudah
    // benar-benar diterima vendor. Kalau roll itu memang salah, hapus/koreksi manual di data terkait.
  });
}

/** Batalkan PO Produksi (maklon) -- reuse mekanisme "Close PO" yang sudah ada (migration 0016,
 *  `closed_at`/`close_reason`, dipakai closePoWithReasonAction) alih-alih bikin status baru:
 *  MaklonPO tidak punya enum 'CANCELLED', dan `closedAt` SUDAH dibaca di seluruh app (derive.ts)
 *  sebagai "PO ini mati, tidak ada lagi produksi/pengiriman baru untuk warna manapun di situ". */
export async function sysadminCancelMaklonPoAction(poId: string, reason: string): Promise<ActionResult<void>> {
  return toActionResult(async () => {
    await requireSysadmin();
    if (!reason.trim()) throw new Error("Alasan wajib diisi.");
    const db = supabaseServer();
    const { data: po, error: fetchErr } = await db.from("maklon_pos").select("*").eq("id", poId).maybeSingle();
    if (fetchErr) throw new Error(fetchErr.message);
    if (!po) throw new Error("PO Produksi tidak ditemukan.");
    if (po.closed_at) throw new Error("PO ini sudah ditutup/dibatalkan sebelumnya.");
    const { error } = await db.from("maklon_pos").update({ closed_at: new Date().toISOString().slice(0, 10), close_reason: `[SYSADMIN] ${reason.trim()}` }).eq("id", poId);
    if (error) throw new Error(error.message);
    await writeAuditLog("CANCEL_MAKLON_PO", "maklon_pos", poId, reason.trim(), { status: po.status, approved: po.approved, closedAt: po.closed_at }, { closedAt: "now" });
  });
}

// =========================================================================
// Log audit (read-only)
// =========================================================================

export type AuditLogRow = { id: string; action: string; targetType: string; targetId: string; reason: string; before: unknown; after: unknown; createdAt: string };

export async function listAuditLogAction(limit = 200): Promise<ActionResult<AuditLogRow[]>> {
  return toActionResult(async () => {
    await requireSysadmin();
    const { data, error } = await supabaseServer().from("sysadmin_audit_log").select("*").order("created_at", { ascending: false }).limit(limit);
    if (error) throw new Error(error.message);
    return (data ?? []).map((r) => ({ id: r.id, action: r.action, targetType: r.target_type, targetId: r.target_id, reason: r.reason, before: r.before, after: r.after, createdAt: r.created_at }));
  });
}

// Dipakai halaman "Batalkan PO" untuk mencari 1 PO tanpa menarik snapshot 32-tabel penuh.
export async function findMaterialPoAction(poId: string): Promise<ActionResult<{ id: string; mrpId: string; supplier: string; amount: number; status: string; approved: boolean } | null>> {
  return toActionResult(async () => {
    await requireSysadmin();
    const { data, error } = await supabaseServer().from("material_pos").select("id,mrp_id,supplier,amount,status,approved").eq("id", poId.trim()).maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return null;
    return { id: data.id, mrpId: data.mrp_id, supplier: data.supplier, amount: Number(data.amount), status: data.status, approved: data.approved };
  });
}

export async function findMaklonPoAction(poId: string): Promise<ActionResult<{ id: string; mrpId: string; vendorProduksi: string; amount: number; status: string; approved: boolean; closedAt?: string } | null>> {
  return toActionResult(async () => {
    await requireSysadmin();
    const { data, error } = await supabaseServer().from("maklon_pos").select("id,mrp_id,vendor_produksi,amount,status,approved,closed_at").eq("id", poId.trim()).maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return null;
    return { id: data.id, mrpId: data.mrp_id, vendorProduksi: data.vendor_produksi, amount: Number(data.amount), status: data.status, approved: data.approved, closedAt: data.closed_at ?? undefined };
  });
}
