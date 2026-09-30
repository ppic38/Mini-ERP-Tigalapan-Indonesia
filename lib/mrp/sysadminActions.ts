"use server";

import bcrypt from "bcryptjs";
import { requireSession } from "../auth/session";
import { supabaseServer } from "../supabase/server";
import type { ActionResult } from "./action-result";
import { INTERNAL_ACCOUNTS, type InternalRole } from "../internal-auth";
import { nextReadableId } from "./repo/ids";
import type { NotificationAudience } from "./types";
import { weightVariance } from "./derive";

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

/** Revisi 2026-09-29 (owner: "modul yang diubah atau dimodif oleh sysadmin pemberitahuannya
 *  dimasukkan ke menu notifikasi navbar"): beri tahu modul/vendor yang datanya baru saja dikoreksi
 *  Sysadmin -- muncul di lonceng Notifikasi navbar (tabel `notifications`, sama seperti notifikasi
 *  alur biasa). BEST-EFFORT: koreksinya sudah tersimpan dan tercatat di log audit, jadi gagal
 *  menulis notifikasi TIDAK boleh menggagalkan/menutupi aksi yang sudah terjadi. */
async function notifyAffected(text: string, audience: NotificationAudience[], vendorId?: string): Promise<void> {
  try {
    const id = await nextReadableId("NTF");
    const d = new Date();
    const time = String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
    await supabaseServer().from("notifications").insert({ id, text, time, audience, vendor_id: vendorId ?? null, read: false });
  } catch {
    // diabaikan dengan sengaja -- lihat catatan di atas.
  }
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
// Anggota tim vendor produksi (migration 0057) -- monitor & edit lintas SEMUA vendor.
// Pengelolaan sehari-hari tetap di portal vendor sendiri ("Tim Saya"); ini jalur darurat
// Sysadmin (mis. vendor tidak bisa masuk akun utamanya sendiri untuk mengurus timnya).
// =========================================================================

export type VendorTeamMemberOverviewRow = {
  id: string;
  vendorId: string;
  vendorName: string;
  username: string;
  name: string;
  allowedPages: string[];
  active: boolean;
  createdAt: string;
};

export async function listAllVendorTeamMembersAction(): Promise<ActionResult<VendorTeamMemberOverviewRow[]>> {
  return toActionResult(async () => {
    await requireSysadmin();
    const { data, error } = await supabaseServer()
      .from("vendor_users")
      .select("id,vendor_produksi,username,name,allowed_pages,active,created_at,vendors_produksi(name)")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []).map((r) => ({
      id: r.id,
      vendorId: r.vendor_produksi,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      vendorName: (r.vendors_produksi as any)?.name ?? r.vendor_produksi,
      username: r.username,
      name: r.name,
      allowedPages: r.allowed_pages ?? [],
      active: r.active,
      createdAt: r.created_at,
    }));
  });
}

export async function sysadminUpdateVendorTeamMemberAction(
  id: string,
  patch: { name?: string; allowedPages?: string[]; active?: boolean },
  reason: string
): Promise<ActionResult<void>> {
  return toActionResult(async () => {
    await requireSysadmin();
    if (!reason.trim()) throw new Error("Alasan wajib diisi.");
    const db = supabaseServer();
    const { data: before, error: fetchErr } = await db.from("vendor_users").select("name,allowed_pages,active").eq("id", id).maybeSingle();
    if (fetchErr) throw new Error(fetchErr.message);
    if (!before) throw new Error("Anggota tim tidak ditemukan.");
    const p: Record<string, unknown> = {};
    if (patch.name !== undefined) {
      if (!patch.name.trim()) throw new Error("Nama wajib diisi.");
      p.name = patch.name.trim();
    }
    if (patch.allowedPages !== undefined) p.allowed_pages = patch.allowedPages;
    if (patch.active !== undefined) p.active = patch.active;
    const { error } = await db.from("vendor_users").update(p).eq("id", id);
    if (error) throw new Error(error.message);
    await writeAuditLog("UPDATE_VENDOR_TEAM_MEMBER", "vendor_users", id, reason.trim(), before, patch);
  });
}

export async function sysadminResetVendorTeamMemberPasswordAction(id: string, newPassword: string, reason: string): Promise<ActionResult<void>> {
  return toActionResult(async () => {
    await requireSysadmin();
    if (!reason.trim()) throw new Error("Alasan wajib diisi.");
    if (newPassword.length < 6) throw new Error("Password minimal 6 karakter.");
    const db = supabaseServer();
    const { data: row } = await db.from("vendor_users").select("id,username").eq("id", id).maybeSingle();
    if (!row) throw new Error("Anggota tim tidak ditemukan.");
    const hash = await bcrypt.hash(newPassword, 10);
    const { error } = await db.from("vendor_users").update({ password_hash: hash }).eq("id", id);
    if (error) throw new Error(error.message);
    await writeAuditLog("RESET_VENDOR_TEAM_PASSWORD", "vendor_users", id, reason.trim(), null, { username: row.username });
  });
}

export async function sysadminDeleteVendorTeamMemberAction(id: string, reason: string): Promise<ActionResult<void>> {
  return toActionResult(async () => {
    await requireSysadmin();
    if (!reason.trim()) throw new Error("Alasan wajib diisi.");
    const db = supabaseServer();
    const { data: before } = await db.from("vendor_users").select("username,name,vendor_produksi").eq("id", id).maybeSingle();
    if (!before) throw new Error("Anggota tim tidak ditemukan.");
    const { error } = await db.from("vendor_users").delete().eq("id", id);
    if (error) throw new Error(error.message);
    await writeAuditLog("DELETE_VENDOR_TEAM_MEMBER", "vendor_users", id, reason.trim(), before, null);
  });
}

// =========================================================================
// Anggota tim modul internal (migration 0060, owner 2026-09-29: "procurement ternyata ada dua
// orang, fulan dan fulin ... biar tau siapa PIC-nya") -- BEDA dari anggota tim vendor produksi di
// atas (yang dikelola SEHARI-HARI oleh vendor sendiri dari "Tim Saya", Sysadmin cuma jalur
// darurat): modul internal TIDAK punya portal self-service semacam itu, jadi Sysadmin adalah
// SATU-SATUNYA tempat mengelola akun ini. Tidak ada konsep "allowedPages" -- anggota tim dapat
// akses PENUH ke halaman role itu, sama seperti akun utama (password bersama); bedanya cuma
// atribusi nama di internal_action_log & approval_log (lihat requireInternalRoleWithActor,
// lib/mrp/actions.ts).
// =========================================================================

export type InternalRoleUserRow = { id: string; role: InternalRole; username: string; name: string; active: boolean; createdAt: string };

export async function listInternalRoleUsersAction(): Promise<ActionResult<InternalRoleUserRow[]>> {
  return toActionResult(async () => {
    await requireSysadmin();
    const { data, error } = await supabaseServer().from("internal_role_users").select("id,role,username,name,active,created_at").order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []).map((r) => ({ id: r.id, role: r.role as InternalRole, username: r.username, name: r.name, active: r.active, createdAt: r.created_at }));
  });
}

export async function sysadminAddInternalRoleUserAction(input: { role: InternalRole; username: string; name: string; password: string }, reason: string): Promise<ActionResult<void>> {
  return toActionResult(async () => {
    await requireSysadmin();
    if (!reason.trim()) throw new Error("Alasan wajib diisi.");
    if (!INTERNAL_ACCOUNTS.some((a) => a.role === input.role)) throw new Error("Modul tidak dikenali.");
    const username = input.username.trim();
    if (!/^[a-zA-Z0-9._-]{3,32}$/.test(username)) throw new Error("Username 3-32 karakter, huruf/angka/titik/garis (tanpa spasi).");
    if (!input.name.trim()) throw new Error("Nama wajib diisi.");
    if (input.password.length < 6) throw new Error("Password minimal 6 karakter.");
    const db = supabaseServer();
    const { data: existing } = await db.from("internal_role_users").select("id").ilike("username", username).maybeSingle();
    if (existing) throw new Error(`Username "${username}" sudah dipakai -- pilih username lain.`);
    const id = await nextReadableId("IRU");
    const hash = await bcrypt.hash(input.password, 10);
    const { error } = await db.from("internal_role_users").insert({ id, role: input.role, username, name: input.name.trim(), password_hash: hash, active: true });
    if (error) throw new Error(error.message);
    await writeAuditLog("ADD_INTERNAL_ROLE_USER", "internal_role_users", id, reason.trim(), null, { role: input.role, username, name: input.name.trim() });
  });
}

export async function sysadminUpdateInternalRoleUserAction(id: string, patch: { name?: string; active?: boolean }, reason: string): Promise<ActionResult<void>> {
  return toActionResult(async () => {
    await requireSysadmin();
    if (!reason.trim()) throw new Error("Alasan wajib diisi.");
    const db = supabaseServer();
    const { data: before, error: fetchErr } = await db.from("internal_role_users").select("name,active").eq("id", id).maybeSingle();
    if (fetchErr) throw new Error(fetchErr.message);
    if (!before) throw new Error("Anggota tim tidak ditemukan.");
    const p: Record<string, unknown> = {};
    if (patch.name !== undefined) {
      if (!patch.name.trim()) throw new Error("Nama wajib diisi.");
      p.name = patch.name.trim();
    }
    if (patch.active !== undefined) p.active = patch.active;
    const { error } = await db.from("internal_role_users").update(p).eq("id", id);
    if (error) throw new Error(error.message);
    await writeAuditLog("UPDATE_INTERNAL_ROLE_USER", "internal_role_users", id, reason.trim(), before, patch);
  });
}

export async function sysadminResetInternalRoleUserPasswordAction(id: string, newPassword: string, reason: string): Promise<ActionResult<void>> {
  return toActionResult(async () => {
    await requireSysadmin();
    if (!reason.trim()) throw new Error("Alasan wajib diisi.");
    if (newPassword.length < 6) throw new Error("Password minimal 6 karakter.");
    const db = supabaseServer();
    const { data: row } = await db.from("internal_role_users").select("id,username").eq("id", id).maybeSingle();
    if (!row) throw new Error("Anggota tim tidak ditemukan.");
    const hash = await bcrypt.hash(newPassword, 10);
    const { error } = await db.from("internal_role_users").update({ password_hash: hash }).eq("id", id);
    if (error) throw new Error(error.message);
    await writeAuditLog("RESET_INTERNAL_ROLE_USER_PASSWORD", "internal_role_users", id, reason.trim(), null, { username: row.username });
  });
}

export async function sysadminDeleteInternalRoleUserAction(id: string, reason: string): Promise<ActionResult<void>> {
  return toActionResult(async () => {
    await requireSysadmin();
    if (!reason.trim()) throw new Error("Alasan wajib diisi.");
    const db = supabaseServer();
    const { data: before } = await db.from("internal_role_users").select("username,name,role").eq("id", id).maybeSingle();
    if (!before) throw new Error("Anggota tim tidak ditemukan.");
    const { error } = await db.from("internal_role_users").delete().eq("id", id);
    if (error) throw new Error(error.message);
    await writeAuditLog("DELETE_INTERNAL_ROLE_USER", "internal_role_users", id, reason.trim(), before, null);
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
    await notifyAffected(`PO Material ${poId} (${po.mrp_id}) dibatalkan Sysadmin — alasan: ${reason.trim()}.`, ["procurement", "finance"]);
    // Vendor produksi tujuan baru relevan kalau PO-nya sudah approved (sebelumnya belum tampil di "PO Material Saya").
    if (po.approved && po.vendor_produksi) {
      await notifyAffected(`PO Material ${poId} (${po.mrp_id}) dibatalkan Sysadmin — alasan: ${reason.trim()}.`, ["vendorMaklon"], po.vendor_produksi);
    }
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
    await notifyAffected(`PO Produksi ${poId} (${po.mrp_id}) dibatalkan Sysadmin — alasan: ${reason.trim()}.`, ["procurement", "finance"]);
    if (po.approved && po.vendor_produksi) {
      await notifyAffected(`PO Produksi ${poId} (${po.mrp_id}) dibatalkan Sysadmin — alasan: ${reason.trim()}. Tidak ada lagi produksi/pengiriman baru untuk PO ini.`, ["vendorMaklon"], po.vendor_produksi);
    }
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

// =========================================================================
// Perbaiki status invoice material -- "kembalikan ke semula" untuk salah klik
// aksi status (owner 2026-09-28, kasus nyata: "Set Delivery" ke-klik di batch
// PV yang salah gara-gara bug status ikut-ikutan antar batch, lihat fix di
// app/procurement/material-tracking/page.tsx). Granular per BATCH (raw_material_invoice),
// bukan per PO -- 1 PO bisa punya banyak batch PV, dan owner cuma mau kembalikan
// SEBAGIAN yang salah, bukan semuanya. Baru dukung 1 langkah: DELIVERY -> PAID
// (batal "Set Delivery") -- ini kasus paling umum & paling aman (1 kolom timestamp,
// tanpa efek samping ke data lain). Langkah lain (RECEIVING -> DELIVERY dkk)
// menyentuh raw_material_invoice_rolls per-roll & progres vendor, BELUM dibuatkan
// jalur revert-nya (lebih berisiko, menyusul kalau memang dibutuhkan).
// =========================================================================

export type SysadminInvoiceBatchRow = {
  id: string;
  poId: string;
  mrpId: string;
  kodeTransaksi: string;
  status: string;
  qtyReady: number;
  totalBiaya: number;
  deliveredAt: string | null;
  /** true = batch ini status DELIVERY, bisa dikembalikan ke PAID lewat aksi di bawah. */
  revertible: boolean;
};

/** Cari semua batch PV (raw_material_invoices) untuk 1 No PO Material -- dipakai halaman
 *  "Perbaiki Status Invoice" supaya Sysadmin bisa pilih SEBAGIAN batch (bukan 1 PO utuh). */
export async function findMaterialInvoicesForPoAction(poId: string): Promise<ActionResult<SysadminInvoiceBatchRow[]>> {
  return toActionResult(async () => {
    await requireSysadmin();
    const { data, error } = await supabaseServer()
      .from("raw_material_invoices")
      .select("id,po_id,mrp_id,kode_transaksi,status,qty_ready,total_biaya,delivered_at")
      .eq("po_id", poId.trim())
      .order("booked_at");
    if (error) throw new Error(error.message);
    return (data ?? []).map((r) => ({
      id: r.id,
      poId: r.po_id,
      mrpId: r.mrp_id,
      kodeTransaksi: r.kode_transaksi,
      status: r.status,
      qtyReady: r.qty_ready,
      totalBiaya: Number(r.total_biaya ?? 0),
      deliveredAt: r.delivered_at,
      revertible: r.status === "DELIVERY",
    }));
  });
}

/** Kembalikan batch (status DELIVERY) ke PAID -- batal "Set Delivery". Batch yang statusnya
 *  bukan DELIVERY dilewati diam-diam (bukan error) -- pemanggil (UI) sudah menyaring lewat
 *  `revertible`, ini jaring pengaman kedua kalau data berubah di antara load & submit. */
export async function sysadminRevertInvoiceDeliveryAction(invoiceIds: string[], reason: string): Promise<ActionResult<{ reverted: number; skipped: number }>> {
  return toActionResult(async () => {
    await requireSysadmin();
    if (!reason.trim()) throw new Error("Alasan wajib diisi.");
    if (invoiceIds.length === 0) throw new Error("Pilih minimal 1 batch.");
    const db = supabaseServer();
    const { data: rows, error } = await db.from("raw_material_invoices").select("id,status,delivered_at,po_id,mrp_id,destination_vendor").in("id", invoiceIds);
    if (error) throw new Error(error.message);
    let reverted = 0;
    let skipped = 0;
    for (const r of rows ?? []) {
      if (r.status !== "DELIVERY") {
        skipped++;
        continue;
      }
      const { error: updErr } = await db.from("raw_material_invoices").update({ status: "PAID", delivered_at: null }).eq("id", r.id);
      if (updErr) throw new Error(`Gagal mengembalikan ${r.id}: ${updErr.message}`);
      await writeAuditLog("REVERT_INVOICE_DELIVERY", "raw_material_invoices", r.id, reason.trim(), { status: r.status, deliveredAt: r.delivered_at }, { status: "PAID", deliveredAt: null });
      await notifyAffected(`Status Delivery batch ${r.id} (PO ${r.po_id}, ${r.mrp_id}) dikembalikan ke Paid oleh Sysadmin — alasan: ${reason.trim()}. Silakan set Delivery ulang bila sudah benar.`, ["procurement"]);
      if (r.destination_vendor) {
        await notifyAffected(`Batch material ${r.id} (PO ${r.po_id}) belum jadi dikirim — status Delivery dibatalkan Sysadmin (alasan: ${reason.trim()}). Batch hilang dari Good Receive sampai dikirim ulang.`, ["vendorMaklon"], r.destination_vendor);
      }
      reverted++;
    }
    return { reverted, skipped };
  });
}

// =========================================================================
// Koreksi pembayaran Finance -- "salah klik Bayar / salah upload bukti, kembalikan supaya bisa
// diproses ulang" (owner 2026-09-29, modul Finance). Semuanya MUNDUR SATU LANGKAH ke status
// sebelum langkah itu, dan hanya kalau langkah berikutnya belum terjadi. Bukti pembayaran yang
// sudah diupload TIDAK dihapus (sama seperti "Batalkan Bayar" bawaan Finance: file itu jejak audit
// dan akan ditimpa upload berikutnya).
// =========================================================================

/** Batalkan pembayaran invoice material: PAID -> INVOICED (Finance bisa bayar ulang). Menolak kalau
 *  invoice sudah lanjut (Delivery dst -- Procurement harus mengembalikan Delivery dulu) atau kalau
 *  invoice ini PV pengganti klaim (terikat ledger kredit/debit klaim). `releaseDeposit` juga
 *  menghapus baris DEBIT deposit yang dipakai membayar invoice ini (hasil applyVendorDepositAction),
 *  supaya saldo supplier pulih dan tidak terpotong dua kali saat dibayar ulang. */
export async function sysadminRevertMaterialInvoicePaidAction(invoiceId: string, releaseDeposit: boolean, reason: string): Promise<ActionResult<{ depositReleased: number }>> {
  return toActionResult(async () => {
    await requireSysadmin();
    if (!reason.trim()) throw new Error("Alasan wajib diisi.");
    const db = supabaseServer();
    const { data: inv, error } = await db.from("raw_material_invoices").select("id,po_id,mrp_id,status,paid_at,source_claim_id,total_biaya").eq("id", invoiceId).maybeSingle();
    if (error) throw new Error(error.message);
    if (!inv) throw new Error("Invoice tidak ditemukan.");
    if (inv.source_claim_id) throw new Error("Invoice ini PV pengganti klaim -- pembayarannya terikat ledger deposit klaim, tidak bisa dikembalikan dari sini.");
    if (inv.status === "INVOICED") throw new Error("Invoice ini belum dibayar.");
    if (inv.status !== "PAID") throw new Error(`Invoice sudah berstatus ${inv.status} (lanjut setelah pembayaran) -- kembalikan langkah setelahnya dulu (mis. Kembalikan Delivery di Material Tracking).`);

    let depositRows: { id: string; supplier: string; amount: number }[] = [];
    if (releaseDeposit) {
      const { data: rows, error: depErr } = await db.from("vendor_deposits").select("id,supplier,amount").eq("kind", "DEBIT").eq("source_invoice_id", invoiceId);
      if (depErr) throw new Error(depErr.message);
      depositRows = (rows ?? []).map((r) => ({ id: r.id, supplier: r.supplier, amount: Number(r.amount) }));
    }
    const { error: updErr } = await db.from("raw_material_invoices").update({ status: "INVOICED", paid_at: null }).eq("id", invoiceId);
    if (updErr) throw new Error(updErr.message);
    if (depositRows.length > 0) {
      const { error: delErr } = await db.from("vendor_deposits").delete().in("id", depositRows.map((r) => r.id));
      if (delErr) throw new Error(`Status invoice sudah dikembalikan, tapi gagal memulihkan saldo deposit: ${delErr.message}`);
    }
    await writeAuditLog(
      "REVERT_MATERIAL_INVOICE_PAID",
      "raw_material_invoices",
      invoiceId,
      reason.trim(),
      { status: inv.status, paidAt: inv.paid_at, depositDebits: depositRows },
      { status: "INVOICED", paidAt: null, depositReleased: depositRows.length }
    );
    const depositNote = depositRows.length > 0 ? ` Saldo deposit yang terpakai (${depositRows.length} baris) dipulihkan.` : "";
    await notifyAffected(
      `Pembayaran invoice ${invoiceId} (PO ${inv.po_id}, ${inv.mrp_id}) dibatalkan Sysadmin — alasan: ${reason.trim()}. Status kembali ke Invoiced; silakan proses bayar ulang.${depositNote}`,
      ["finance", "procurement"]
    );
    return { depositReleased: depositRows.length };
  });
}

/** Batalkan pembayaran invoice vendor produksi (per pcs): PAID -> APPROVED. Bongkar Koli yang sudah
 *  dilakukan Warehouse TIDAK ikut dibatalkan (itu gate satu arah, HPP sudah tercatat); yang belum
 *  dibongkar tertahan lagi sampai invoice dibayar ulang. */
export async function sysadminRevertVendorInvoicePaidAction(invoiceId: string, reason: string): Promise<ActionResult<void>> {
  return toActionResult(async () => {
    await requireSysadmin();
    if (!reason.trim()) throw new Error("Alasan wajib diisi.");
    const db = supabaseServer();
    const { data: inv, error } = await db.from("vendor_invoices").select("id,vendor_produksi,status,paid_at").eq("id", invoiceId).maybeSingle();
    if (error) throw new Error(error.message);
    if (!inv) throw new Error("Invoice vendor tidak ditemukan.");
    if (inv.status !== "PAID") throw new Error(`Invoice ini berstatus ${inv.status}, bukan PAID -- tidak ada pembayaran yang bisa dibatalkan.`);
    const { error: updErr } = await db.from("vendor_invoices").update({ status: "APPROVED", paid_at: null }).eq("id", invoiceId);
    if (updErr) throw new Error(updErr.message);
    await writeAuditLog("REVERT_VENDOR_INVOICE_PAID", "vendor_invoices", invoiceId, reason.trim(), { status: inv.status, paidAt: inv.paid_at }, { status: "APPROVED", paidAt: null });
    await notifyAffected(`Pembayaran invoice vendor ${invoiceId} dibatalkan Sysadmin — alasan: ${reason.trim()}. Status kembali ke Disetujui; menunggu pembayaran Finance lagi.`, ["finance", "procurement"]);
    await notifyAffected(`Pembayaran invoice ${invoiceId} dibatalkan Sysadmin (alasan: ${reason.trim()}). Status kembali ke Disetujui, menunggu pembayaran.`, ["vendorMaklon"], inv.vendor_produksi);
  });
}

/** Mundurkan invoice PO Produksi FOB (maklon_invoices): PAID -> APPROVED (PO kembali ke DELIVERY, status
 *  sebelum dibayar) atau APPROVED -> SUBMITTED. Hanya invoice FOB -- invoice CMT arsip tidak menyimpan
 *  status PO sebelum bayar, jadi tidak aman dimundurkan otomatis. */
export async function sysadminRevertMaklonInvoiceAction(invoiceId: string, from: "PAID" | "APPROVED", reason: string): Promise<ActionResult<void>> {
  return toActionResult(async () => {
    await requireSysadmin();
    if (!reason.trim()) throw new Error("Alasan wajib diisi.");
    const db = supabaseServer();
    const { data: inv, error } = await db.from("maklon_invoices").select("id,maklon_po_id,vendor_produksi,status,approved_at,paid_at").eq("id", invoiceId).maybeSingle();
    if (error) throw new Error(error.message);
    if (!inv) throw new Error("Invoice tidak ditemukan.");
    if (inv.status !== from) throw new Error(`Invoice ini berstatus ${inv.status}, bukan ${from} -- tidak bisa dimundurkan dari langkah itu.`);
    const { data: po, error: poErr } = await db.from("maklon_pos").select("id,is_fob,status").eq("id", inv.maklon_po_id).maybeSingle();
    if (poErr) throw new Error(poErr.message);
    if (!po?.is_fob) throw new Error("Hanya invoice PO Produksi FOB yang bisa dimundurkan dari sini (invoice CMT arsip tidak didukung).");

    if (from === "PAID") {
      if (po.status !== "FULLY_PAID") throw new Error(`PO Produksi berstatus ${po.status}, bukan FULLY_PAID -- pembayaran tidak bisa dimundurkan otomatis.`);
      const { error: e1 } = await db.from("maklon_invoices").update({ status: "APPROVED", paid_at: null }).eq("id", invoiceId);
      if (e1) throw new Error(e1.message);
      // Status PO sebelum dibayar selalu DELIVERY untuk FOB (lihat submitFobMaklonInvoiceAction).
      const { error: e2 } = await db.from("maklon_pos").update({ status: "DELIVERY" }).eq("id", po.id);
      if (e2) throw new Error(`Status invoice sudah dikembalikan, tapi gagal memulihkan status PO: ${e2.message}`);
    } else {
      const { error: e1 } = await db.from("maklon_invoices").update({ status: "SUBMITTED", approved_at: null }).eq("id", invoiceId);
      if (e1) throw new Error(e1.message);
    }
    const toStatus = from === "PAID" ? "APPROVED" : "SUBMITTED";
    await writeAuditLog(
      from === "PAID" ? "REVERT_MAKLON_INVOICE_PAID" : "REVERT_MAKLON_INVOICE_APPROVAL",
      "maklon_invoices",
      invoiceId,
      reason.trim(),
      { status: inv.status, approvedAt: inv.approved_at, paidAt: inv.paid_at, poStatus: po.status },
      { status: toStatus, poStatus: from === "PAID" ? "DELIVERY" : po.status }
    );
    const text = `Invoice PO Produksi FOB ${invoiceId} (PO ${inv.maklon_po_id}) dimundurkan Sysadmin ke ${toStatus} — alasan: ${reason.trim()}.`;
    await notifyAffected(text, ["finance"]);
    await notifyAffected(text, ["vendorMaklon"], inv.vendor_produksi);
  });
}

// =========================================================================
// Koreksi Cutting vendor produksi (owner 2026-09-30). Tiga koreksi per roll (batch) yang MUNDUR satu
// langkah dan hanya boleh selama roll BELUM menyentuh tahap sesudahnya (Finish Good / pengiriman):
//   1. Batalkan resting  -- roll dikeluarkan dari produksi (batch dihapus), kembali ke pool roll siap
//      diresting; hanya kalau belum ada hasil cutting.
//   2. Batalkan hasil cutting -- kembali ke status resting, hasil per size dihapus, vendor menginput ulang.
//   3. Koreksi berat bersih -- salah timbang; hanya untuk berat yang TIDAK menjadi klaim selisih berat
//      (klaim butuh foto bukti & alur retur Procurement, tidak boleh dibuat/dihapus dari sini).
// =========================================================================

type BatchForCorrection = {
  id: string;
  mrp_id: string;
  vendor_produksi: string;
  warna: string;
  lengan: string;
  code_roll: string | null;
  cutting_at: string | null;
  closed_at: string | null;
  fg_logged_snapshot: Record<string, number> | null;
};

/** Ambil batch + pastikan belum menyentuh tahap sesudah Cutting (FG, pengiriman, Final Produksi). */
async function loadBatchUntouchedByFg(db: ReturnType<typeof supabaseServer>, batchId: string): Promise<BatchForCorrection> {
  const { data: batch, error } = await db
    .from("production_batches")
    .select("id,mrp_id,vendor_produksi,warna,lengan,code_roll,cutting_at,closed_at,fg_logged_snapshot")
    .eq("id", batchId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!batch) throw new Error("Roll tidak ditemukan (mungkin sudah dibatalkan).");
  if (batch.closed_at) throw new Error("Roll ini sudah ditutup (Tutup Roll) -- buka lagi dulu dari portal vendor sebelum dikoreksi.");
  if (batch.fg_logged_snapshot && Object.keys(batch.fg_logged_snapshot).length > 0) throw new Error("Roll ini sudah punya progres Finish Good -- tidak bisa dikoreksi dari sini.");
  const [{ count: fgCount, error: fgErr }, { count: koliCount, error: koliErr }, { data: meta, error: metaErr }] = await Promise.all([
    db.from("production_batch_fg_sizes").select("size", { count: "exact", head: true }).eq("production_batch_id", batchId),
    db.from("delivery_koli_items").select("delivery_koli_id", { count: "exact", head: true }).eq("source_batch_id", batchId),
    db.from("production_group_meta").select("fg_confirmed_at,done_at").eq("group_key", `${batch.mrp_id}|${batch.warna}|${batch.lengan}`).maybeSingle(),
  ]);
  if (fgErr || koliErr || metaErr) throw new Error((fgErr ?? koliErr ?? metaErr)!.message);
  if ((fgCount ?? 0) > 0) throw new Error("Roll ini sudah punya hasil Finish Good -- tidak bisa dikoreksi dari sini.");
  if ((koliCount ?? 0) > 0) throw new Error("Roll ini sudah masuk koli pengiriman -- tidak bisa dikoreksi dari sini.");
  if (meta?.fg_confirmed_at || meta?.done_at) throw new Error(`Grup ${batch.warna} · ${batch.lengan} sudah Selesai/Final Produksi -- buka kunci dulu dari portal vendor.`);
  return batch as BatchForCorrection;
}

export async function sysadminUndoRestingAction(batchId: string, reason: string): Promise<ActionResult<void>> {
  return toActionResult(async () => {
    await requireSysadmin();
    if (!reason.trim()) throw new Error("Alasan wajib diisi.");
    const db = supabaseServer();
    const batch = await loadBatchUntouchedByFg(db, batchId);
    if (batch.cutting_at) throw new Error("Roll ini sudah punya hasil cutting -- batalkan hasil cutting dulu.");
    const { data: full } = await db.from("production_batches").select("*").eq("id", batchId).maybeSingle();
    const { error: sizeErr } = await db.from("production_batch_sizes").delete().eq("production_batch_id", batchId);
    if (sizeErr) throw new Error(sizeErr.message);
    const { error: delErr } = await db.from("production_batches").delete().eq("id", batchId);
    if (delErr) throw new Error(delErr.message);
    await writeAuditLog("UNDO_RESTING", "production_batches", batchId, reason.trim(), { batch: full }, { removed: true });
    await notifyAffected(
      `Resting roll ${batch.code_roll ?? batchId} (${batch.mrp_id} · ${batch.warna} · ${batch.lengan}) dibatalkan Sysadmin — alasan: ${reason.trim()}. Roll kembali ke daftar roll yang siap diresting.`,
      ["vendorMaklon"],
      batch.vendor_produksi
    );
  });
}

export async function sysadminUndoCuttingAction(batchId: string, reason: string): Promise<ActionResult<void>> {
  return toActionResult(async () => {
    await requireSysadmin();
    if (!reason.trim()) throw new Error("Alasan wajib diisi.");
    const db = supabaseServer();
    const batch = await loadBatchUntouchedByFg(db, batchId);
    if (!batch.cutting_at) throw new Error("Roll ini belum punya hasil cutting.");
    const { data: sizes, error: sizesErr } = await db.from("production_batch_sizes").select("size,qty").eq("production_batch_id", batchId);
    if (sizesErr) throw new Error(sizesErr.message);
    const { error: sizeErr } = await db.from("production_batch_sizes").delete().eq("production_batch_id", batchId);
    if (sizeErr) throw new Error(sizeErr.message);
    const { error: updErr } = await db.from("production_batches").update({ cutting_at: null }).eq("id", batchId);
    if (updErr) {
      // Pulihkan hasil per size yang sudah terhapus supaya roll tidak tertinggal setengah.
      if ((sizes ?? []).length > 0) await db.from("production_batch_sizes").insert((sizes ?? []).map((s) => ({ ...s, production_batch_id: batchId })));
      throw new Error(updErr.message);
    }
    // Resolusi yield alert (kalau ada) ikut dihapus -- alert lama tidak boleh tampil "sudah ditindak" begitu roll dicutting ulang.
    await db.from("production_yield_resolutions").delete().eq("production_batch_id", batchId);
    await writeAuditLog("UNDO_CUTTING", "production_batches", batchId, reason.trim(), { cuttingAt: batch.cutting_at, sizes }, { cuttingAt: null });
    await notifyAffected(
      `Hasil cutting roll ${batch.code_roll ?? batchId} (${batch.mrp_id} · ${batch.warna} · ${batch.lengan}) dibatalkan Sysadmin — alasan: ${reason.trim()}. Roll kembali ke status resting; silakan input ulang hasil cutting.`,
      ["vendorMaklon"],
      batch.vendor_produksi
    );
  });
}

/** Cari roll fisik (raw_material_invoice_rolls) milik sebuah batch lewat pencocokan code_roll -- pola sama
 *  dengan submitCuttingDefectClaimAction (ProductionBatch tidak menyimpan invoiceId/rollIndex). */
async function findRollForBatch(db: ReturnType<typeof supabaseServer>, batch: BatchForCorrection) {
  if (!batch.code_roll) throw new Error("Roll ini tidak punya code roll -- roll fisiknya tidak bisa ditelusuri.");
  const { data: invs, error: invErr } = await db.from("raw_material_invoices").select("id,po_id,supplier").eq("mrp_id", batch.mrp_id).eq("destination_vendor", batch.vendor_produksi);
  if (invErr) throw new Error(invErr.message);
  const invIds = (invs ?? []).map((i) => i.id);
  if (invIds.length === 0) throw new Error("Invoice material untuk roll ini tidak ditemukan.");
  const { data: colors, error: colErr } = await db.from("raw_material_invoice_colors").select("id,invoice_id").in("invoice_id", invIds).eq("warna", batch.warna).eq("lengan", batch.lengan);
  if (colErr) throw new Error(colErr.message);
  const colorIds = (colors ?? []).map((c) => c.id);
  if (colorIds.length === 0) throw new Error("Data warna roll tidak ditemukan.");
  const { data: rolls, error: rollErr } = await db
    .from("raw_material_invoice_rolls")
    .select("invoice_color_id,roll_index,gross_kg,net_kg,claim_defect_at,claim_retur_requested_at,claim_resolved_at")
    .in("invoice_color_id", colorIds)
    .eq("code_roll", batch.code_roll);
  if (rollErr) throw new Error(rollErr.message);
  if ((rolls ?? []).length !== 1) throw new Error(`Roll fisik untuk code roll ${batch.code_roll} tidak unik/tidak ditemukan (${(rolls ?? []).length} cocok).`);
  const roll = rolls![0];
  const color = (colors ?? []).find((c) => c.id === roll.invoice_color_id)!;
  const inv = (invs ?? []).find((i) => i.id === color.invoice_id)!;
  return { roll, invoiceId: inv.id, poId: inv.po_id, supplier: inv.supplier as string | null };
}

export async function sysadminSetBatchNetWeightAction(batchId: string, netKg: number, reason: string): Promise<ActionResult<void>> {
  return toActionResult(async () => {
    await requireSysadmin();
    if (!reason.trim()) throw new Error("Alasan wajib diisi.");
    if (!Number.isFinite(netKg) || netKg <= 0) throw new Error("Berat bersih harus angka lebih dari 0.");
    const db = supabaseServer();
    const batch = await loadBatchUntouchedByFg(db, batchId);
    const { roll, invoiceId, poId } = await findRollForBatch(db, batch);
    if (roll.claim_defect_at || roll.claim_retur_requested_at) throw new Error("Roll ini punya klaim (cacat fisik / retur) -- berat tidak bisa dikoreksi dari sini.");
    if (roll.gross_kg == null) throw new Error("Berat kotor roll tidak diketahui -- tidak bisa memvalidasi toleransi.");
    const variance = weightVariance(Number(roll.gross_kg), netKg);
    if (variance.claimable) {
      throw new Error(`Berat baru ${netKg} kg (${variance.pct.toFixed(1)}% dari berat kotor ${roll.gross_kg} kg) di luar toleransi -- itu menjadi klaim selisih berat yang butuh foto bukti dan alur retur, tidak bisa dibuat dari sini.`);
    }
    if (roll.net_kg != null && Number(roll.net_kg) === netKg) throw new Error("Berat baru sama dengan yang tersimpan.");
    const { error: updErr } = await db
      .from("raw_material_invoice_rolls")
      .update({ net_kg: netKg, weigh_confirmed_at: new Date().toISOString() })
      .eq("invoice_color_id", roll.invoice_color_id)
      .eq("roll_index", roll.roll_index);
    if (updErr) throw new Error(updErr.message);
    await writeAuditLog(
      "EDIT_ROLL_NET_WEIGHT",
      "raw_material_invoice_rolls",
      `${invoiceId}|${batch.warna}|${batch.lengan}|${roll.roll_index}`,
      reason.trim(),
      { netKg: roll.net_kg, batchId },
      { netKg }
    );
    const text = `Berat bersih roll ${batch.code_roll} (PO ${poId}, ${batch.warna} · ${batch.lengan}) dikoreksi Sysadmin: ${roll.net_kg ?? "—"} → ${netKg} kg — alasan: ${reason.trim()}.`;
    await notifyAffected(text, ["procurement"]);
    await notifyAffected(text, ["vendorMaklon"], batch.vendor_produksi);
  });
}

// =========================================================================
// Buka lagi Yield Alert yang sudah "ditindak" (owner 2026-09-30, modul Produksi): Produksi salah
// menandai alert yield <99% sebagai ditindak (atau catatannya keliru) -- baris resolusi dihapus supaya
// alert kembali "Belum ditindak" dan Produksi bisa menindaklanjuti ulang dengan catatan yang benar.
// Resolusi hanya penanda (production_yield_resolutions), tidak memengaruhi data produksi lain.
// =========================================================================

export async function sysadminReopenYieldAlertAction(batchId: string, reason: string): Promise<ActionResult<void>> {
  return toActionResult(async () => {
    await requireSysadmin();
    if (!reason.trim()) throw new Error("Alasan wajib diisi.");
    const db = supabaseServer();
    const { data: res, error } = await db.from("production_yield_resolutions").select("note,resolved_at").eq("production_batch_id", batchId).maybeSingle();
    if (error) throw new Error(error.message);
    if (!res) throw new Error("Alert ini sudah berstatus belum ditindak.");
    const { data: batch } = await db.from("production_batches").select("mrp_id,vendor_produksi,warna,lengan,code_roll").eq("id", batchId).maybeSingle();
    const { error: delErr } = await db.from("production_yield_resolutions").delete().eq("production_batch_id", batchId);
    if (delErr) throw new Error(delErr.message);
    await writeAuditLog("REOPEN_YIELD_ALERT", "production_yield_resolutions", batchId, reason.trim(), { note: res.note, resolvedAt: res.resolved_at }, { resolved: false });
    const label = batch ? `${batch.mrp_id} · ${batch.warna} · ${batch.lengan}${batch.code_roll ? ` · roll ${batch.code_roll}` : ""}` : batchId;
    await notifyAffected(`Yield alert ${label} dibuka lagi oleh Sysadmin — alasan: ${reason.trim()}. Status kembali "Belum ditindak"; silakan tindak lanjuti ulang.`, ["produksi"]);
  });
}

// =========================================================================
// Kembalikan MRP ke "menunggu approval SCM" (owner 2026-09-30, modul PPIC): SCM salah setuju/tolak,
// atau MRP perlu diperiksa ulang. Berlaku untuk PPIC_APPROVED dan REJECTED. Untuk PPIC_APPROVED hanya
// boleh kalau Procurement belum membuat PO dari MRP ini (tidak ada material_pos/maklon_pos, po_sent
// false) -- kalau PO sudah ada, tarik/batalkan PO-nya dulu lewat tombol koreksi Procurement.
// =========================================================================

export async function sysadminRevertMrpApprovalAction(mrpId: string, reason: string): Promise<ActionResult<void>> {
  return toActionResult(async () => {
    await requireSysadmin();
    if (!reason.trim()) throw new Error("Alasan wajib diisi.");
    const db = supabaseServer();
    const { data: mrp, error } = await db.from("mrp").select("id,ppic_approval,ppic_approved_at,ppic_rejection_note,po_sent").eq("id", mrpId).maybeSingle();
    if (error) throw new Error(error.message);
    if (!mrp) throw new Error("MRP tidak ditemukan.");
    if (mrp.ppic_approval === "WAITING_PPIC_APPROVAL") throw new Error("MRP ini sudah menunggu approval SCM.");
    if (mrp.ppic_approval === "PPIC_APPROVED") {
      const [{ count: matPos, error: e1 }, { count: maklonPos, error: e2 }] = await Promise.all([
        db.from("material_pos").select("id", { count: "exact", head: true }).eq("mrp_id", mrpId),
        db.from("maklon_pos").select("id", { count: "exact", head: true }).eq("mrp_id", mrpId),
      ]);
      if (e1 || e2) throw new Error((e1 ?? e2)!.message);
      if (mrp.po_sent || (matPos ?? 0) > 0 || (maklonPos ?? 0) > 0) {
        throw new Error("Procurement sudah membuat PO dari MRP ini -- tarik kembali / batalkan PO-nya dulu (tombol Sysadmin di halaman Purchase Order) sebelum approval SCM dimundurkan.");
      }
    }
    const { error: updErr } = await db.from("mrp").update({ ppic_approval: "WAITING_PPIC_APPROVAL", ppic_approved_at: null, ppic_rejection_note: null }).eq("id", mrpId);
    if (updErr) throw new Error(updErr.message);
    await writeAuditLog(
      "REVERT_MRP_APPROVAL",
      "mrp",
      mrpId,
      reason.trim(),
      { ppicApproval: mrp.ppic_approval, approvedAt: mrp.ppic_approved_at, rejectionNote: mrp.ppic_rejection_note },
      { ppicApproval: "WAITING_PPIC_APPROVAL" }
    );
    await notifyAffected(`MRP ${mrpId} dikembalikan Sysadmin ke menunggu approval SCM (sebelumnya ${mrp.ppic_approval}) — alasan: ${reason.trim()}.`, ["scm", "ppic", "procurement"]);
  });
}

// =========================================================================
// Batalkan "Bongkar Koli" Warehouse (owner 2026-09-30, modul Warehouse). 1 resi group = tepat 1
// warehouse_receipt (+ baris koli & item). Membatalkan = menghapus ketiganya, sehingga resi itu muncul
// lagi di Penerimaan dan Warehouse bisa membongkar ulang. Aman karena arsip ini tidak jadi dasar
// tabel lain (bukan ledger stok berjalan, lihat migration 0031). Catatan akuntansi: `hpp_per_item`
// di item penerimaan adalah SNAPSHOT saat dibongkar -- pembongkaran ulang mengambil snapshot BARU dari
// HPP live saat itu (itu tujuan koreksinya kalau angka lama keliru). Penghapusan tidak atomik (anak
// dulu, baru induk, karena FK tanpa cascade) -- kalau penghapusan induk gagal, anak dikembalikan.
// =========================================================================

export async function sysadminUndoWarehouseReceiptAction(receiptId: string, reason: string): Promise<ActionResult<{ itemsRemoved: number }>> {
  return toActionResult(async () => {
    await requireSysadmin();
    if (!reason.trim()) throw new Error("Alasan wajib diisi.");
    const db = supabaseServer();
    const { data: receipt, error } = await db.from("warehouse_receipts").select("*").eq("id", receiptId).maybeSingle();
    if (error) throw new Error(error.message);
    if (!receipt) throw new Error("Penerimaan tidak ditemukan (mungkin sudah dibatalkan).");
    const [{ data: kolis, error: koliErr }, { data: items, error: itemsErr }] = await Promise.all([
      db.from("warehouse_receipt_kolis").select("delivery_koli_id").eq("warehouse_receipt_id", receiptId),
      db.from("warehouse_receipt_items").select("delivery_koli_id,warna,lengan,size,kind,qty,hpp_per_item,source_batch_id").eq("warehouse_receipt_id", receiptId),
    ]);
    if (koliErr) throw new Error(koliErr.message);
    if (itemsErr) throw new Error(itemsErr.message);

    const { error: delItemsErr } = await db.from("warehouse_receipt_items").delete().eq("warehouse_receipt_id", receiptId);
    if (delItemsErr) throw new Error(delItemsErr.message);
    const { error: delKolisErr } = await db.from("warehouse_receipt_kolis").delete().eq("warehouse_receipt_id", receiptId);
    if (delKolisErr) {
      if ((items ?? []).length > 0) await db.from("warehouse_receipt_items").insert((items ?? []).map((it) => ({ ...it, warehouse_receipt_id: receiptId })));
      throw new Error(delKolisErr.message);
    }
    const { error: delReceiptErr } = await db.from("warehouse_receipts").delete().eq("id", receiptId);
    if (delReceiptErr) {
      // Pulihkan anak yang sudah terhapus supaya penerimaan tidak tertinggal tanpa isi.
      if ((kolis ?? []).length > 0) await db.from("warehouse_receipt_kolis").insert((kolis ?? []).map((k) => ({ ...k, warehouse_receipt_id: receiptId })));
      if ((items ?? []).length > 0) await db.from("warehouse_receipt_items").insert((items ?? []).map((it) => ({ ...it, warehouse_receipt_id: receiptId })));
      throw new Error(`Gagal membatalkan penerimaan (data dikembalikan seperti semula): ${delReceiptErr.message}`);
    }

    const totalNilai = (items ?? []).reduce((a, it) => a + Number(it.qty) * Number(it.hpp_per_item), 0);
    await writeAuditLog(
      "UNDO_WAREHOUSE_RECEIPT",
      "warehouse_receipts",
      receiptId,
      reason.trim(),
      { receipt, koliIds: (kolis ?? []).map((k) => k.delivery_koli_id), items, totalNilai },
      { removed: true }
    );
    await notifyAffected(
      `Bongkar koli resi ${receipt.resi_group_id} (${receipt.mrp_id}) dibatalkan Sysadmin — alasan: ${reason.trim()}. Resi kembali ke daftar Penerimaan; silakan bongkar ulang.`,
      ["warehouse", "finance", "produksi"]
    );
    return { itemsRemoved: (items ?? []).length };
  });
}

// =========================================================================
// Batalkan penerimaan 1 roll di Good Receive (vendor produksi salah menekan "Terima") -- owner
// 2026-09-30, modul Vendor Produksi. Mundur satu langkah: roll kembali "belum diterima" supaya vendor
// bisa menerimanya lagi dengan benar. Hanya boleh kalau langkah setelahnya belum terjadi:
//   - roll belum ditimbang di Cutting (net_kg kosong), DAN
//   - PO Produksi vendor untuk MRP itu masih menunggu material (belum "Mulai Produksi").
// code_lot TIDAK direset (label dari Procurement/vendor), code_roll direset karena dibuat saat terima.
// =========================================================================

const MAKLON_WAITING_STATUSES = ["FULL_WAITING_MATERIAL", "PARTIAL_WAITING_MATERIAL"];

export async function sysadminUndoRollArrivalAction(
  input: { invoiceId: string; warna: string; lengan: "PENDEK" | "PANJANG"; rollIndex: number },
  reason: string
): Promise<ActionResult<void>> {
  return toActionResult(async () => {
    await requireSysadmin();
    if (!reason.trim()) throw new Error("Alasan wajib diisi.");
    const { invoiceId, warna, lengan, rollIndex } = input;
    const db = supabaseServer();
    const colorId = `${invoiceId}-${warna}-${lengan}`;
    const { data: roll, error } = await db
      .from("raw_material_invoice_rolls")
      .select("received_at,net_kg,code_roll")
      .eq("invoice_color_id", colorId)
      .eq("roll_index", rollIndex)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!roll) throw new Error("Roll tidak ditemukan.");
    if (!roll.received_at) throw new Error("Roll ini belum ditandai diterima.");
    if (roll.net_kg != null) throw new Error("Roll ini sudah ditimbang di Cutting -- penerimaannya tidak bisa dibatalkan dari sini.");

    const { data: inv, error: invErr } = await db.from("raw_material_invoices").select("id,po_id,mrp_id,status,destination_vendor").eq("id", invoiceId).maybeSingle();
    if (invErr) throw new Error(invErr.message);
    if (!inv) throw new Error("Invoice tidak ditemukan.");
    const { data: pos, error: poErr } = await db.from("maklon_pos").select("id,status").eq("mrp_id", inv.mrp_id).eq("vendor_produksi", inv.destination_vendor);
    if (poErr) throw new Error(poErr.message);
    const started = (pos ?? []).find((p) => !MAKLON_WAITING_STATUSES.includes(p.status));
    if (started) throw new Error(`PO Produksi ${started.id} sudah berstatus ${started.status} (produksi sudah dimulai) -- penerimaan roll tidak bisa dibatalkan dari sini.`);

    const { error: updErr } = await db.from("raw_material_invoice_rolls").update({ received_at: null, code_roll: null }).eq("invoice_color_id", colorId).eq("roll_index", rollIndex);
    if (updErr) throw new Error(updErr.message);

    // Kalau tidak ada lagi roll/item tambahan yang diterima di invoice ini, status kembali ke DELIVERY
    // (RECEIVING baru terjadi begitu penerimaan pertama, lihat markRollArrivedAction).
    let statusReverted = false;
    if (inv.status === "RECEIVING") {
      const { data: colors } = await db.from("raw_material_invoice_colors").select("id").eq("invoice_id", invoiceId);
      const colorIds = (colors ?? []).map((c) => c.id);
      const [{ count: rollsLeft }, { count: addBuysLeft }] = await Promise.all([
        db.from("raw_material_invoice_rolls").select("roll_index", { count: "exact", head: true }).in("invoice_color_id", colorIds.length > 0 ? colorIds : [""]).not("received_at", "is", null),
        db.from("raw_material_invoice_addbuys").select("id", { count: "exact", head: true }).eq("invoice_id", invoiceId).not("received_at", "is", null),
      ]);
      if ((rollsLeft ?? 0) === 0 && (addBuysLeft ?? 0) === 0) {
        const { error: stErr } = await db.from("raw_material_invoices").update({ status: "DELIVERY", received_at: null }).eq("id", invoiceId);
        if (stErr) throw new Error(`Roll sudah dikembalikan, tapi gagal memulihkan status invoice: ${stErr.message}`);
        statusReverted = true;
      }
    }
    await writeAuditLog(
      "UNDO_ROLL_ARRIVAL",
      "raw_material_invoice_rolls",
      `${invoiceId}|${warna}|${lengan}|${rollIndex}`,
      reason.trim(),
      { receivedAt: roll.received_at, codeRoll: roll.code_roll, invoiceStatus: inv.status },
      { receivedAt: null, codeRoll: null, invoiceStatus: statusReverted ? "DELIVERY" : inv.status }
    );
    const text = `Penerimaan Roll ${rollIndex + 1} ${warna} · ${lengan} (PO ${inv.po_id}, ${inv.mrp_id}) dibatalkan Sysadmin — alasan: ${reason.trim()}. Roll kembali belum diterima; silakan terima ulang.`;
    await notifyAffected(text, ["procurement"]);
    await notifyAffected(text, ["vendorMaklon"], inv.destination_vendor);
  });
}

// =========================================================================
// Koreksi code lot / code roll 1 roll -- salah ketik saat Paying Voucher (Procurement) atau saat
// Good Receive (vendor produksi), owner 2026-09-29 (Sysadmin "melihat dan mengoreksi", mulai dari
// modul Procurement). Aturan pengaman:
//   - code_lot cuma LABEL (tidak jadi kunci/relasi di tabel lain) -> boleh diubah kapan saja, boleh
//     dikosongkan. Salinan teks lot di riwayat klaim yang SUDAH terbentuk (material_claim_history)
//     tidak ikut berubah -- itu snapshot historis.
//   - code_roll dipakai sebagai identitas fisik roll di Cutting -> HANYA boleh diubah kalau roll
//     sudah ditandai diterima DAN belum ditimbang (net_kg masih kosong); setelah ditimbang, roll
//     sudah masuk alur Cutting/klaim dan mengubah kodenya bisa merusak jejak.
// =========================================================================

export type SysadminRollCodePatch = { codeLot?: string; codeRoll?: string };

export async function sysadminSetRollCodeAction(
  input: { invoiceId: string; warna: string; lengan: "PENDEK" | "PANJANG"; rollIndex: number; patch: SysadminRollCodePatch },
  reason: string
): Promise<ActionResult<void>> {
  return toActionResult(async () => {
    await requireSysadmin();
    if (!reason.trim()) throw new Error("Alasan wajib diisi.");
    const { invoiceId, warna, lengan, rollIndex, patch } = input;
    const db = supabaseServer();
    const colorId = `${invoiceId}-${warna}-${lengan}`;
    const { data: roll, error } = await db
      .from("raw_material_invoice_rolls")
      .select("code_lot,code_roll,net_kg,received_at")
      .eq("invoice_color_id", colorId)
      .eq("roll_index", rollIndex)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!roll) throw new Error("Roll tidak ditemukan.");

    const update: Record<string, string | null> = {};
    if (patch.codeLot !== undefined) {
      const lot = patch.codeLot.trim() || null;
      if (lot !== (roll.code_lot ?? null)) update.code_lot = lot;
    }
    if (patch.codeRoll !== undefined) {
      const code = patch.codeRoll.trim();
      if (!code) throw new Error("Code roll tidak boleh dikosongkan.");
      if (code !== (roll.code_roll ?? "")) {
        if (!roll.received_at) throw new Error("Roll ini belum diterima vendor -- code roll baru ada saat Good Receive.");
        if (roll.net_kg != null) throw new Error("Roll ini sudah ditimbang di Cutting -- code roll tidak bisa diubah lagi dari sini.");
        update.code_roll = code;
      }
    }
    if (Object.keys(update).length === 0) throw new Error("Tidak ada perubahan -- nilainya sama dengan yang tersimpan.");

    const { error: updErr } = await db.from("raw_material_invoice_rolls").update(update).eq("invoice_color_id", colorId).eq("roll_index", rollIndex);
    if (updErr) throw new Error(updErr.message);
    await writeAuditLog(
      "EDIT_ROLL_CODE",
      "raw_material_invoice_rolls",
      `${invoiceId}|${warna}|${lengan}|${rollIndex}`,
      reason.trim(),
      { codeLot: roll.code_lot, codeRoll: roll.code_roll },
      { codeLot: "code_lot" in update ? update.code_lot : roll.code_lot, codeRoll: "code_roll" in update ? update.code_roll : roll.code_roll }
    );

    const { data: inv } = await db.from("raw_material_invoices").select("po_id,destination_vendor").eq("id", invoiceId).maybeSingle();
    const changes = [
      "code_lot" in update ? `code lot ${roll.code_lot ?? "—"} → ${update.code_lot ?? "—"}` : null,
      "code_roll" in update ? `code roll ${roll.code_roll ?? "—"} → ${update.code_roll}` : null,
    ]
      .filter(Boolean)
      .join(", ");
    const text = `Roll ${rollIndex + 1} ${warna} · ${lengan} (PO ${inv?.po_id ?? invoiceId}) dikoreksi Sysadmin: ${changes} — alasan: ${reason.trim()}.`;
    await notifyAffected(text, ["procurement"]);
    if (inv?.destination_vendor) await notifyAffected(text, ["vendorMaklon"], inv.destination_vendor);
  });
}

// =========================================================================
// Tarik kembali PO Material -- "kirim ke Finance" yang salah (owner 2026-09-28,
// tahap Procurement/Finance dari permintaan "akses tingkat tinggi ... diterapkan
// ke setiap modul"). BEDA dari sysadminCancelMaterialPoAction (yang MEMANG sengaja
// TIDAK membongkar apa pun, dipakai untuk PO yang sudah lanjut diinvoice) -- ini
// KHUSUS PO yang BELUM PERNAH diinvoice sama sekali (invoicedRolls 0): selain
// dibatalkan, baris material_rows terkait juga di-"lepas" lagi (sent_to_po_at
// dikosongkan) supaya warna itu muncul lagi di "MRP tanpa PO" dan bisa dikirim
// ULANG dengan vendor/supplier yang benar -- Batalkan PO biasa TIDAK melakukan ini
// (baris tetap "sent", tidak akan pernah bisa dikirim lagi).
//
// TIDAK ada versi Maklon PO (Produksi) -- maklon_pos TIDAK menyimpan rincian
// warna/lengan per PO (beda dari material_pos yang punya material_po_color_
// breakdown), jadi tidak ada cara aman mencocokkan material_rows mana yang harus
// dilepas tanpa risiko salah (bisa ke-lepas baris dari PO Maklon LAIN yang masih
// valid, kalau vendor yang sama pernah dikirim PO bertahap). Untuk PO Maklon yang
// salah kirim, pakai "Batalkan PO" biasa dulu -- kirim ulang manual kalau memang
// perlu (belum ada jalur otomatisnya).
// =========================================================================

export type SysadminMaterialPoSummary = {
  id: string;
  mrpId: string;
  supplier: string;
  vendorProduksi: string;
  status: string;
  approved: boolean;
  invoicedRolls: number;
  amount: number;
  approvalLevel: number | null;
  approvalLog: { step: number; role: string; action: string; at: string; note?: string }[];
};

export async function findMaterialPoSummaryAction(poId: string): Promise<ActionResult<SysadminMaterialPoSummary | null>> {
  return toActionResult(async () => {
    await requireSysadmin();
    const { data, error } = await supabaseServer()
      .from("material_pos")
      .select("id,mrp_id,supplier,vendor_produksi,status,approved,invoiced_rolls,amount,approval_level,approval_log")
      .eq("id", poId.trim())
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return null;
    return {
      id: data.id,
      mrpId: data.mrp_id,
      supplier: data.supplier,
      vendorProduksi: data.vendor_produksi,
      status: data.status,
      approved: data.approved,
      invoicedRolls: Number(data.invoiced_rolls ?? 0),
      amount: Number(data.amount ?? 0),
      approvalLevel: data.approval_level ?? null,
      approvalLog: (data.approval_log ?? []) as SysadminMaterialPoSummary["approvalLog"],
    };
  });
}

export async function sysadminRecallMaterialPoAction(poId: string, reason: string): Promise<ActionResult<{ rowsReleased: number }>> {
  return toActionResult(async () => {
    await requireSysadmin();
    if (!reason.trim()) throw new Error("Alasan wajib diisi.");
    const db = supabaseServer();
    const { data: po, error: poErr } = await db.from("material_pos").select("id,mrp_id,status,invoiced_rolls,approved,vendor_produksi").eq("id", poId.trim()).maybeSingle();
    if (poErr) throw new Error(poErr.message);
    if (!po) throw new Error("PO Material tidak ditemukan.");
    if (po.status === "CANCELLED") throw new Error("PO ini sudah dibatalkan sebelumnya.");
    if (Number(po.invoiced_rolls ?? 0) > 0) {
      throw new Error("PO ini sudah pernah diinvoice sebagian (Paying Voucher) -- tidak aman ditarik kembali dari sini. Pakai \"Batalkan PO\" biasa kalau memang perlu dibatalkan (invoice yang sudah ada tetap tidak dibongkar).");
    }
    const { data: colors, error: colorErr } = await db.from("material_po_color_breakdown").select("warna,lengan").eq("material_po_id", po.id);
    if (colorErr) throw new Error(colorErr.message);
    let rowsReleased = 0;
    for (const c of colors ?? []) {
      const { data: rows, error: rowErr } = await db.from("material_rows").select("id,sent_to_po_at").eq("mrp_id", po.mrp_id).eq("warna", c.warna).eq("lengan", c.lengan);
      if (rowErr) throw new Error(rowErr.message);
      const ids = (rows ?? []).filter((r) => r.sent_to_po_at).map((r) => r.id);
      if (ids.length === 0) continue;
      const { error: updErr } = await db.from("material_rows").update({ sent_to_po_at: null }).in("id", ids);
      if (updErr) throw new Error(updErr.message);
      rowsReleased += ids.length;
    }
    const { error: cancelErr } = await db.from("material_pos").update({ status: "CANCELLED" }).eq("id", po.id);
    if (cancelErr) throw new Error(cancelErr.message);
    // MRP ini pasti masih punya baris outstanding sekarang (baru saja dilepas di atas) -- kembalikan
    // ke "MRP tanpa PO" supaya bisa dikirim ulang. Aman di-set false tanpa syarat: kalau ternyata
    // semua baris LAIN sudah lengkap terkirim juga, panggilan sendPoToFinanceAction berikutnya untuk
    // MRP ini otomatis men-set po_sent=true lagi begitu tidak ada sisa (logika yang sudah ada).
    await db.from("mrp").update({ po_sent: false }).eq("id", po.mrp_id);
    await writeAuditLog("RECALL_MATERIAL_PO", "material_pos", po.id, reason.trim(), { status: po.status, invoicedRolls: po.invoiced_rolls }, { status: "CANCELLED", rowsReleased });
    await notifyAffected(
      `PO Material ${po.id} (${po.mrp_id}) ditarik kembali oleh Sysadmin — alasan: ${reason.trim()}. ${rowsReleased} baris material dilepas dan muncul lagi di "MRP tanpa PO"; silakan kirim ulang.`,
      ["procurement", "finance"]
    );
    // PO yang sudah final disetujui sudah tampil di "PO Material Saya" vendor -- beri tahu vendornya juga.
    if (po.approved && po.vendor_produksi) {
      await notifyAffected(`PO Material ${po.id} (${po.mrp_id}) ditarik kembali oleh Sysadmin — alasan: ${reason.trim()}. PO ini tidak berlaku lagi; PO pengganti akan dikirim bila diperlukan.`, ["vendorMaklon"], po.vendor_produksi);
    }
    return { rowsReleased };
  });
}

// =========================================================================
// Kembalikan 1 langkah approval PO (Material/Produksi) -- "salah approve/reject,
// balikin ke menunggu approval lagi". HANYA boleh selama PO belum final (`approved`
// masih false) -- begitu approved=true, PO Material sudah kena split per entitas
// (splitMaterialPoByEntitas) & PO Produksi sudah kirim notifikasi ke vendor;
// membongkar itu jauh lebih rumit/berisiko, jadi SENGAJA tidak didukung di sini.
// =========================================================================

export type SysadminApprovalPoType = "MATERIAL" | "MAKLON";

const APPROVAL_PO_TABLE: Record<SysadminApprovalPoType, string> = { MATERIAL: "material_pos", MAKLON: "maklon_pos" };

export type SysadminMaklonPoSummary = {
  id: string;
  mrpId: string;
  vendorProduksi: string;
  status: string;
  approved: boolean;
  amount: number;
  approvalLevel: number | null;
  approvalLog: { step: number; role: string; action: string; at: string; note?: string }[];
};

export async function findMaklonPoSummaryAction(poId: string): Promise<ActionResult<SysadminMaklonPoSummary | null>> {
  return toActionResult(async () => {
    await requireSysadmin();
    const { data, error } = await supabaseServer()
      .from("maklon_pos")
      .select("id,mrp_id,vendor_produksi,status,approved,amount,approval_level,approval_log")
      .eq("id", poId.trim())
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return null;
    return {
      id: data.id,
      mrpId: data.mrp_id,
      vendorProduksi: data.vendor_produksi,
      status: data.status,
      approved: data.approved,
      amount: Number(data.amount ?? 0),
      approvalLevel: data.approval_level ?? null,
      approvalLog: (data.approval_log ?? []) as SysadminMaklonPoSummary["approvalLog"],
    };
  });
}

export async function sysadminRevertPoApprovalStepAction(type: SysadminApprovalPoType, poId: string, reason: string): Promise<ActionResult<void>> {
  return toActionResult(async () => {
    await requireSysadmin();
    if (!reason.trim()) throw new Error("Alasan wajib diisi.");
    const db = supabaseServer();
    const table = APPROVAL_PO_TABLE[type];
    const { data: po, error } = await db.from(table).select("id,mrp_id,approved,approval_level,approval_log").eq("id", poId.trim()).maybeSingle();
    if (error) throw new Error(error.message);
    if (!po) throw new Error("PO tidak ditemukan.");
    if (po.approved) throw new Error("PO ini sudah FINAL disetujui (approved) -- tidak bisa di-revert dari sini (bisa sudah memicu efek lain, mis. split entitas / notifikasi vendor).");
    if (po.approval_level == null) throw new Error("PO ini tidak pakai matriks approval (PO lama) -- tidak ada langkah untuk dikembalikan.");
    const log = (po.approval_log ?? []) as { step: number; role: string; action: string; at: string; note?: string }[];
    if (log.length === 0) throw new Error("Belum ada riwayat approval untuk PO ini.");
    const last = log[log.length - 1];
    if (last.action !== "APPROVED") throw new Error("Langkah terakhir bukan persetujuan (kemungkinan penolakan) -- pakai \"Ajukan ulang\" di portal Procurement untuk kasus itu.");
    const nextLog = log.slice(0, -1);
    const { error: updErr } = await db.from(table).update({ approval_log: nextLog }).eq("id", po.id);
    if (updErr) throw new Error(updErr.message);
    await writeAuditLog(`REVERT_${type}_PO_APPROVAL_STEP`, table, po.id, reason.trim(), { approvalLog: log }, { approvalLog: nextLog, removedStep: last });
    // Penerima: modul yang persetujuannya dibatalkan + Procurement (pemilik PO). Peran di approval_log
    // hanya procurement/finance/scm/gm (ApprovalRole) -- di luar itu dilewati.
    const affected = new Set<NotificationAudience>(["procurement"]);
    if (last.role === "procurement" || last.role === "finance" || last.role === "scm" || last.role === "gm") affected.add(last.role);
    await notifyAffected(
      `Approval PO ${po.id} (${po.mrp_id}) dikembalikan satu langkah oleh Sysadmin (persetujuan ${last.role} dibatalkan) — alasan: ${reason.trim()}. PO kembali menunggu approval.`,
      Array.from(affected)
    );
  });
}
