"use server";

import { requireSession } from "../auth/session";
import type { ActionResult } from "./action-result";
import { readTabRows, sheetsConfig } from "./wosSheets";
import { parseWosStatusRows, type WosKoliStatus } from "./wosStatusMap";

export type WosKoliStatusResult = {
  /** Env Google Sheets sudah lengkap. */
  configured: boolean;
  /** Tab ERP_INCOMING sudah punya kolom status (status_wos atau status) dan kolom koli_erp. */
  hasStatusColumn: boolean;
  byKoli: Record<string, WosKoliStatus>;
  fetchedAt: string;
};

let cache: { at: number; value: WosKoliStatusResult } | null = null;
const CACHE_MS = 60_000;

/** Status penerimaan gudang WOS per koli ERP, dibaca dari tab ERP_INCOMING lewat akun layanan Google (privat, tidak lewat link publik).
 *  Hanya untuk sesi modul internal (PPIC, SCM, Procurement, dst.); portal vendor tidak boleh. Hasil di-cache 60 detik per instance. */
export async function getWosKoliStatusAction(force = false): Promise<ActionResult<WosKoliStatusResult>> {
  try {
    const session = await requireSession();
    if (session.internalRoles.length === 0) throw new Error("Forbidden: hanya untuk modul internal.");
    const cfg = sheetsConfig();
    if (!cfg) return { ok: true, data: { configured: false, hasStatusColumn: false, byKoli: {}, fetchedAt: new Date().toISOString() } };
    if (!force && cache && Date.now() - cache.at < CACHE_MS) return { ok: true, data: cache.value };
    const { headers, rows } = await readTabRows(cfg);
    const parsed = parseWosStatusRows(headers, rows);
    const value: WosKoliStatusResult = { configured: true, ...parsed, fetchedAt: new Date().toISOString() };
    cache = { at: Date.now(), value };
    return { ok: true, data: value };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
