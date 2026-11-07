"use server";

import { requireSession } from "../auth/session";
import { supabaseServer } from "../supabase/server";
import type { ActionResult } from "./action-result";
import { nextReadableId } from "./repo/ids";
import { enqueueAllShippedResis, processWosOutbox, refreshHppOfQueuedResis, resetExhaustedWosOutbox, wosOutboxSummary } from "./wosPush";

/** Halaman Sysadmin "Kirim ke WOS" (2026-11-05): pantau antrean pengiriman resi ke WOS, kirim ulang resi lama, dan coba lagi yang gagal.
 *  Semua aksi hanya untuk Sysadmin; yang mengubah data (antrekan resi lama, setel ulang percobaan) dicatat di sysadmin_audit_log. */

async function requireSysadmin() {
  const session = await requireSession();
  if (!session.internalRoles.includes("sysadmin")) throw new Error("Forbidden: aksi ini hanya untuk modul Sysadmin.");
}

async function toActionResult<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function audit(action: string, reason: string, after: unknown) {
  const id = await nextReadableId("AUD");
  const { error } = await supabaseServer().from("sysadmin_audit_log").insert({ id, action, target_type: "WOS_OUTBOX", target_id: "-", reason, before: null, after });
  if (error) throw new Error(`Aksi berhasil tapi gagal menulis log audit: ${error.message}`);
}

export type WosOutboxSummary = Awaited<ReturnType<typeof wosOutboxSummary>>;

export async function getWosOutboxSummaryAction(): Promise<ActionResult<WosOutboxSummary>> {
  return toActionResult(async () => {
    await requireSysadmin();
    return wosOutboxSummary(true);
  });
}

/** Masukkan resi yang sudah tervalidasi ongkirnya (dan belum pernah diantrekan) ke antrean; yang sudah pernah diantrekan dilewati, yang belum tervalidasi
 *  dihitung di `awaitingValidation`. Belum mengirim apa pun. */
export async function enqueueOldResisAction(): Promise<ActionResult<{ resis: number; alreadyQueued: number; queued: number; skipped: number; awaitingValidation: number }>> {
  return toActionResult(async () => {
    await requireSysadmin();
    const res = await enqueueAllShippedResis();
    await audit("WOS_ENQUEUE_OLD_RESIS", "Antrekan resi tervalidasi yang belum terkirim ke WOS", res);
    return res;
  });
}

/** Kirim satu gelombang antrean (maks `limit` resi) dan laporkan sisanya; dipanggil berulang dari halaman sampai habis. */
export async function sendWosOutboxAction(limit = 40): Promise<ActionResult<{ sent: number; failed: number; remaining: number }>> {
  return toActionResult(async () => {
    await requireSysadmin();
    const res = await processWosOutbox(Math.min(Math.max(1, limit), 100));
    const summary = await wosOutboxSummary();
    return { ...res, remaining: summary.pending + summary.failed - summary.exhausted };
  });
}

/** Hitung ulang HPP semua resi yang sudah di antrean dan tandai untuk dikirim ulang (menimpa kolom items dan hpp_total di sheet). */
export async function refreshWosHppAction(): Promise<ActionResult<{ resis: number; updated: number }>> {
  return toActionResult(async () => {
    await requireSysadmin();
    const res = await refreshHppOfQueuedResis();
    await audit("WOS_REFRESH_HPP", "Hitung ulang HPP resi di antrean WOS dan kirim ulang", res);
    return res;
  });
}

/** Baris yang sudah menyerah (percobaan habis) dikembalikan ke antrean, mis. setelah env diperbaiki. */
export async function resetWosOutboxAction(): Promise<ActionResult<{ reset: number }>> {
  return toActionResult(async () => {
    await requireSysadmin();
    const reset = await resetExhaustedWosOutbox();
    await audit("WOS_RESET_OUTBOX", "Setel ulang percobaan antrean WOS yang sudah menyerah", { reset });
    return { reset };
  });
}
