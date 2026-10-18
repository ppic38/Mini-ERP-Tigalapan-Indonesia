// Penilaian BANYAK invoice sekaligus (upload banyak invoice, tahap 2): tiap invoice dinilai berurutan terhadap sisa PO
// yang sudah dikurangi invoice-invoice "Siap" sebelumnya, supaya total roll semua invoice tidak melebihi sisa PO dan
// nomor invoice ganda di dalam batch ikut tertangkap. Murni (tanpa DOM/React).

import { autoMap, evaluateMapping, findDuplicateInvoices, findFileNameVendorMismatch, type AliasMap, type Evaluation, type GroupMapping, type PoColorInfo } from "./mapping";
import type { InvoiceAdapter, ParsedInvoice } from "./types";

/** Batas lampiran PDF otomatis ke PV (body Server Action ±2 MB, base64 +33%) -- sama dengan wizard. */
export const BATCH_MAX_ATTACH_BYTES = 1_400_000;

export type BatchStatus = "READY" | "REVIEW" | "BLOCKED";

export type BatchAssessment = {
  status: BatchStatus;
  /** Alasan kenapa tidak "Siap" (kosong kalau Siap). */
  reasons: string[];
  mappings: GroupMapping[];
  evalResult: Evaluation;
};

export type BatchInput = { file: File; parsed: ParsedInvoice };

export function assessBatch(args: {
  items: BatchInput[];
  poColors: PoColorInfo[];
  aliases: AliasMap;
  adapter: InvoiceAdapter;
  supplier: string;
  poVendorId: string;
  vendors: Record<string, { name: string }>;
  existing: { id: string; poId: string; supplier: string; noInvoiceVendor: string }[];
}): BatchAssessment[] {
  let live = args.poColors.map((p) => ({ ...p }));
  const seen: { id: string; poId: string; supplier: string; noInvoiceVendor: string }[] = [...args.existing];
  const out: BatchAssessment[] = [];

  for (const { file, parsed } of args.items) {
    const mappings = autoMap(parsed, live, args.aliases);
    const ev = evaluateMapping(parsed, mappings, live);
    const blocked: string[] = [];
    const review: string[] = [];

    const blocking = args.adapter.validate(parsed).filter((c) => c.blocking && !c.ok);
    for (const c of blocking) blocked.push(`${c.label}${c.detail ? ` (${c.detail})` : ""}`);

    const dups = findDuplicateInvoices(parsed.noPenjualan, args.supplier, seen);
    if (dups.length > 0) blocked.push(`Nomor invoice ${parsed.noPenjualan} sudah dipakai (${dups.map((d) => d.id).join(", ")})`);

    if (ev.recon.some((r) => r.over)) blocked.push("Roll melebihi sisa PO (setelah invoice lain di batch ini)");
    // Warna sudah ketemu di PO tetapi sisanya tidak cukup (mis. sudah dipakai invoice lain di batch ini): tidak disimpan otomatis.
    for (const m of mappings) {
      if (m.kind !== "roll" || m.alloc.length === 0) continue;
      const need = parsed.groups[m.groupIndex].lines.length;
      const got = m.alloc.reduce((a, x) => a + x.qty, 0);
      if (got < need) blocked.push(`Sisa PO tidak cukup untuk ${m.invoiceWarna} ${m.benang} (${got} dari ${need} roll)`);
    }
    if (Number.isFinite(ev.totalDiff) && ev.totalDiff !== 0) blocked.push("Total PV berbeda dari Total Bayar invoice");
    if (!Number.isFinite(ev.totalDiff)) blocked.push("Total Bayar invoice tidak terbaca");

    const unconfirmed = mappings.filter((m) => m.alloc.length === 0 || !m.confirmed);
    if (unconfirmed.length > 0) review.push(`${unconfirmed.length} warna perlu dikonfirmasi / dipetakan`);
    if (findFileNameVendorMismatch(parsed.fileNameParts, args.poVendorId, args.vendors)) review.push("Nama file menyebut vendor lain");
    if (!/^\d{4}$/.test(parsed.kodeTransfer)) review.push("Kode transaksi (4 digit) tidak ada di nama file");
    if (file.size > BATCH_MAX_ATTACH_BYTES) review.push("File terlalu besar untuk dilampirkan otomatis");
    if (ev.issues.some((i) => i.level === "error" && !/saran|belum dipetakan/i.test(i.message)) && blocked.length === 0 && review.length === 0) review.push("Ada pemeriksaan yang belum lulus");

    const status: BatchStatus = blocked.length > 0 ? "BLOCKED" : review.length > 0 || !ev.ok ? "REVIEW" : "READY";
    const reasons = [...blocked, ...review];
    if (status === "REVIEW" && reasons.length === 0) reasons.push("Perlu diperiksa");
    out.push({ status, reasons, mappings, evalResult: ev });

    // Nomor invoice ini terpakai untuk pemeriksaan ganda invoice berikutnya (apa pun statusnya).
    if (parsed.noPenjualan) seen.push({ id: `file:${file.name}`, poId: "", supplier: args.supplier, noInvoiceVendor: parsed.noPenjualan });

    // Hanya invoice "Siap" yang benar-benar akan disimpan -> hanya itu yang mengurangi sisa PO untuk invoice berikutnya.
    if (status === "READY") {
      const thisByWarna = new Map(ev.recon.map((r) => [r.warna, r.thisInvoice]));
      live = live.map((p) => {
        const used = thisByWarna.get(p.warna) ?? 0;
        return used > 0 ? { ...p, before: p.before + used, remaining: Math.max(0, p.remaining - used) } : p;
      });
    }
  }
  return out;
}

/** Salinan PO dengan roll hasil satu draft PV dihitung sebagai "sudah ditagih" -- dipakai menyusun draft invoice berikutnya
 *  dengan pembagian lengan yang benar tanpa menunggu data PO dari server diperbarui. */
export function poAfterDraft<P extends { invoicedByColor: Record<string, number> }>(po: P, colorEntries: { warna: string; lengan: string; rolls: number[] }[]): P {
  const next = { ...po.invoicedByColor };
  for (const c of colorEntries) {
    const key = `${c.warna}|${c.lengan}`;
    next[key] = (next[key] ?? 0) + c.rolls.length;
  }
  return { ...po, invoicedByColor: next };
}
