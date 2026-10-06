"use server";

import { randomUUID } from "node:crypto";
import { requireSession, requireInternalRole } from "../auth/session";
import { supabaseServer } from "../supabase/server";
import type { ActionResult } from "./action-result";

/** Mapping nama warna invoice supplier -> nama warna MRP (migration 0064), per supplier.
 *  Dipakai fitur "Upload Invoice Supplier" di Paying Voucher. Best-effort terhadap tabelnya:
 *  kalau migration belum dijalankan, baca = kosong & simpan = diabaikan (fitur upload tetap
 *  jalan, pemetaan hanya tidak teringat untuk invoice berikutnya). */

export type SupplierColorAlias = { invoiceWarna: string; benang: string; mrpWarna: string };

const normSupplier = (s: string) => s.trim().toUpperCase();
const normWarna = (s: string) => s.toUpperCase().replace(/\s+/g, " ").trim();

export async function listSupplierColorAliasesAction(supplier: string): Promise<ActionResult<SupplierColorAlias[]>> {
  try {
    await requireInternalRole(await requireSession(), "procurement");
    const db = supabaseServer();
    const { data, error } = await db.from("supplier_color_aliases").select("invoice_warna,benang,mrp_warna").eq("supplier", normSupplier(supplier));
    if (error) return { ok: true, data: [] }; // tabel belum ada (migration 0064 belum dijalankan)
    return { ok: true, data: (data ?? []).map((r) => ({ invoiceWarna: r.invoice_warna, benang: r.benang ?? "", mrpWarna: r.mrp_warna })) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function saveSupplierColorAliasesAction(supplier: string, items: SupplierColorAlias[]): Promise<ActionResult<{ saved: number }>> {
  try {
    const session = await requireSession();
    await requireInternalRole(session, "procurement");
    const rows = items
      .filter((i) => i.invoiceWarna.trim() && i.mrpWarna.trim())
      .map((i) => ({
        id: randomUUID(),
        supplier: normSupplier(supplier),
        invoice_warna: normWarna(i.invoiceWarna),
        benang: normWarna(i.benang),
        mrp_warna: i.mrpWarna.trim(),
      }));
    if (rows.length === 0) return { ok: true, data: { saved: 0 } };
    const db = supabaseServer();
    // Pemetaan yang sama untuk (supplier, warna invoice, benang) ditimpa -- yang terakhir dikonfirmasi user yang berlaku.
    const { error } = await db.from("supplier_color_aliases").upsert(rows, { onConflict: "supplier,invoice_warna,benang", ignoreDuplicates: false });
    if (error) return { ok: true, data: { saved: 0 } }; // best-effort
    return { ok: true, data: { saved: rows.length } };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
