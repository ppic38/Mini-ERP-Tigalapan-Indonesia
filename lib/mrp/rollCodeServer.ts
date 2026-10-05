import "server-only";
import { supabaseServer } from "../supabase/server";
import { describeRollCodeConflict } from "./derive";
import type { Lengan } from "./types";

/** Pastikan code roll BELUM dipakai roll lain di ERP (owner 2026-10-05). `entries` = roll yang akan diberi
 *  code (rolls itu sendiri dikecualikan). Melempar Error dengan keterangan roll yang sudah memakainya --
 *  berat kotor, code lot, dan tanggal diterima. Dua entri dengan code sama di satu permintaan juga ditolak. */
export async function assertRollCodesUnique(
  db: ReturnType<typeof supabaseServer>,
  entries: { invoiceId: string; warna: string; lengan: Lengan; rollIndex: number; codeRoll: string }[]
): Promise<void> {
  const norm = (s: string) => s.trim().toLowerCase();
  const seen = new Map<string, number>();
  for (const e of entries) {
    const k = norm(e.codeRoll);
    if (!k) continue;
    seen.set(k, (seen.get(k) ?? 0) + 1);
  }
  const dupInRequest = entries.find((e) => (seen.get(norm(e.codeRoll)) ?? 0) > 1);
  if (dupInRequest) throw new Error(`Code roll ${dupInRequest.codeRoll.trim()} diisi untuk lebih dari satu roll sekaligus -- code roll tidak boleh sama.`);

  const codes = Array.from(new Set(entries.map((e) => e.codeRoll.trim()).filter(Boolean)));
  if (codes.length === 0) return;
  const { data: rolls, error } = await db
    .from("raw_material_invoice_rolls")
    .select("invoice_color_id,roll_index,code_roll,code_lot,gross_kg,received_at")
    .in("code_roll", codes);
  if (error) throw new Error(error.message);
  const mine = new Set(entries.map((e) => `${e.invoiceId}-${e.warna}-${e.lengan}|${e.rollIndex}`));
  const others = (rolls ?? []).filter((r) => !mine.has(`${r.invoice_color_id}|${r.roll_index}`));
  if (others.length === 0) return;

  const r = others[0];
  const { data: color } = await db.from("raw_material_invoice_colors").select("invoice_id,warna,lengan").eq("id", r.invoice_color_id).maybeSingle();
  const { data: inv } = color ? await db.from("raw_material_invoices").select("mrp_id,po_id").eq("id", color.invoice_id).maybeSingle() : { data: null };
  throw new Error(
    describeRollCodeConflict({
      codeRoll: r.code_roll,
      invoiceId: color?.invoice_id ?? r.invoice_color_id,
      poId: inv?.po_id ?? undefined,
      mrpId: inv?.mrp_id ?? undefined,
      warna: color?.warna ?? "?",
      lengan: (color?.lengan ?? "PENDEK") as Lengan,
      rollNo: Number(r.roll_index) + 1,
      grossKg: r.gross_kg != null ? Number(r.gross_kg) : undefined,
      codeLot: r.code_lot ?? undefined,
      receivedAt: r.received_at ?? undefined,
    })
  );
}
