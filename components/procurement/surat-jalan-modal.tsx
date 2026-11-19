"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { pdfToText, terminateOcr } from "@/lib/invoice-import/pdf-text";
import { matchSuratJalan, parseSuratJalanKnitto, type ParsedSuratJalan, type SjMatchResult } from "@/lib/invoice-import/surat-jalan";
import { applySuratJalanAction } from "@/lib/mrp/actions";
import { unwrapAction } from "@/lib/mrp/action-result";
import { useMrpStore } from "@/lib/mrp/store";
import type { Lengan, RawMaterialInvoice } from "@/lib/mrp/types";

/** Popup "Upload Surat Jalan" di Material Tracking (owner 2026-11-19): PDF "Bukti Keluar Barang" supplier dibaca di browser, dicocokkan ke roll invoice yang dipilih (No Order = nomor invoice,
 *  bruto tiap roll), dan kalau cocok code roll-nya disimpan di roll-roll invoice itu. Salah invoice / bruto tidak ada pasangannya = ditolak dengan alasan, tidak ada yang tersimpan. */
export function SuratJalanModal({ invoice, onClose }: { invoice: RawMaterialInvoice; onClose: () => void }) {
  const refresh = useMrpStore((s) => s.refresh);
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [fileName, setFileName] = useState("");
  const [parsed, setParsed] = useState<ParsedSuratJalan | null>(null);
  const [error, setError] = useState("");
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      void terminateOcr();
    };
  }, [onClose, busy]);

  // Code roll yang sudah tercatat (dari invoice atau surat jalan sebelumnya) ikut menjadi dasar pencocokan, jadi unggah ulang tidak menimpa apa pun.
  const forMatch = useMemo(
    () => ({
      noInvoiceVendor: invoice.noInvoiceVendor,
      colorEntries: invoice.colorEntries.map((c) => ({
        warna: c.warna,
        lengan: c.lengan,
        rolls: c.rolls,
        codeRolls: c.rolls.map((_, i) => (c.codeRolls?.[i] ?? invoice.rollArrivals?.[c.warna + "|" + c.lengan]?.[i]?.codeRoll ?? "").trim()),
      })),
    }),
    [invoice]
  );
  const result: SjMatchResult | null = useMemo(() => (parsed ? matchSuratJalan(parsed, forMatch) : null), [parsed, forMatch]);

  async function pick(file: File | undefined) {
    if (!file) return;
    setError("");
    setDone(null);
    setParsed(null);
    setFileName(file.name);
    if (!/\.pdf$/i.test(file.name)) {
      setError("Pilih berkas PDF surat jalan.");
      return;
    }
    setBusy("Membaca PDF…");
    try {
      const { text } = await pdfToText(file, (m) => setBusy(m));
      setParsed(parseSuratJalanKnitto(text, file.name));
    } catch (e) {
      setError("PDF tidak bisa dibaca: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setBusy(null);
    }
  }

  async function save() {
    if (!parsed || !result || !result.ok) return;
    setBusy("Menyimpan code roll…");
    setError("");
    try {
      const res = unwrapAction(
        await applySuratJalanAction({
          invoiceId: invoice.id,
          noOrder: parsed.noOrder,
          fileName: parsed.fileName,
          assignments: result.matches.map((m) => ({ warna: m.warna, lengan: m.lengan as Lengan, rollIndex: m.rollIndex, codeRoll: m.code, bruto: m.bruto })),
        })
      );
      await refresh();
      setDone(`${res.updated} code roll disimpan${res.unchanged > 0 ? `, ${res.unchanged} sudah sama` : ""}.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  const th = "px-2.5 py-1.5 text-left font-sans text-[10px] font-semibold uppercase tracking-wider text-text-muted";
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0B131B]/45 p-4" onClick={() => !busy && onClose()}>
      <div className="flex max-h-[90vh] w-full max-w-[720px] flex-col overflow-hidden rounded-[9px] bg-surface-card shadow-[0_12px_32px_rgba(11,19,27,.28)]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2.5 bg-info-bg px-5 py-3">
          <span className="h-2 w-2 rounded-full bg-accent-blue" />
          <span className="font-sans text-xs font-semibold text-info-fg">Upload Surat Jalan · invoice {invoice.noInvoiceVendor || invoice.id}</span>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 font-sans text-[12px] text-[#31414F]">
          <p className="text-text-muted">
            Unggah PDF &quot;Bukti Keluar Barang&quot; dari {invoice.supplier}. ERP memeriksa bahwa <b>No Order</b> sama dengan nomor invoice <span className="font-mono font-semibold">{invoice.noInvoiceVendor || "(belum ada nomor)"}</span> dan setiap roll
            punya pasangan <b>bruto</b> yang sama di invoice ini, lalu menyimpan code roll-nya. Vendor tidak perlu mengetik code roll.
          </p>
          <div className="mt-3 flex items-center gap-2">
            <input ref={inputRef} type="file" accept="application/pdf,.pdf" className="hidden" onChange={(e) => void pick(e.target.files?.[0])} />
            <Button variant="ghost" size="md" disabled={!!busy || !!done} onClick={() => inputRef.current?.click()}>
              {fileName ? "Ganti PDF" : "Pilih PDF surat jalan"}
            </Button>
            <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-text-muted">{fileName || "Belum ada berkas"}</span>
          </div>
          {busy && <div className="mt-3 text-info-fg">{busy}</div>}
          {error && <div className="mt-3 rounded-md border border-[#EFC9C4] bg-[#FCF3F1] px-3 py-2 font-medium text-danger-fg">{error}</div>}

          {parsed && result && (
            <div className="mt-4">
              <div className="flex flex-wrap gap-x-5 gap-y-1">
                <span>
                  No Order: <b className="font-mono">{parsed.noOrder || "—"}</b>
                </span>
                <span>
                  Tanggal: <b>{parsed.tanggal ?? "—"}</b>
                </span>
                <span>
                  Roll di surat jalan: <b>{parsed.groups.filter((g) => g.kind === "roll").reduce((s, g) => s + g.items.length, 0)}</b>
                </span>
                {parsed.total && (
                  <span>
                    Total tercetak: <b>{parsed.total.n} baris · {parsed.total.kg} kg</b>
                  </span>
                )}
              </div>
              {result.errors.length > 0 && (
                <div className="mt-3 rounded-md border border-[#EFC9C4] bg-[#FCF3F1] px-3 py-2 text-danger-fg">
                  <div className="font-semibold">Tidak bisa disimpan:</div>
                  <ul className="mt-1 list-disc pl-5">
                    {result.errors.map((m, i) => (
                      <li key={i}>{m}</li>
                    ))}
                  </ul>
                </div>
              )}
              {result.errors.length === 0 && (
                <div className="mt-3 rounded-md border border-[#BFE3CF] bg-[#F1FAF5] px-3 py-2 font-medium text-success-fg">
                  Cocok: {result.matches.length} roll surat jalan dipasangkan ke roll invoice dengan bruto yang sama
                  {result.matches.some((m) => m.alreadySet) ? ` (${result.matches.filter((m) => m.alreadySet).length} sudah tercatat)` : ""}.
                </div>
              )}
              {result.warnings.length > 0 && (
                <ul className="mt-2 list-disc pl-5 text-warning-fg">
                  {result.warnings.map((m, i) => (
                    <li key={i}>{m}</li>
                  ))}
                </ul>
              )}
              {result.ribIgnored.items > 0 && (
                <div className="mt-2 text-text-muted">
                  Bagian RIB ({result.ribIgnored.items} baris, {result.ribIgnored.kg} kg) bukan roll kain dan tidak dicocokkan.
                </div>
              )}
              {result.matches.length > 0 && (
                <div className="mt-3 max-h-[260px] overflow-y-auto rounded-md border border-[#E4E9EE]">
                  <table className="w-full border-collapse">
                    <thead className="sticky top-0 bg-[#F2F5F8]">
                      <tr>
                        <th className={th}>Code roll</th>
                        <th className={th}>Warna / lengan</th>
                        <th className={th}>Roll ke</th>
                        <th className={th + " text-right"}>Bruto SJ</th>
                        <th className={th + " text-right"}>Bruto invoice</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.matches.map((m) => (
                        <tr key={m.code} className="border-t border-[#EEF1F4]">
                          <td className="px-2.5 py-1 font-mono">{m.code}</td>
                          <td className="px-2.5 py-1">
                            {m.warna} · {m.lengan === "PENDEK" ? "PDK" : "PJG"}
                          </td>
                          <td className="px-2.5 py-1 font-mono">{m.rollIndex + 1}</td>
                          <td className="px-2.5 py-1 text-right font-mono">{m.bruto.toFixed(2)}</td>
                          <td className="px-2.5 py-1 text-right font-mono">{m.gross.toFixed(2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
          {done && <div className="mt-4 rounded-md border border-[#BFE3CF] bg-[#F1FAF5] px-3 py-2 font-semibold text-success-fg">{done}</div>}
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-[#EEF1F4] px-5 py-3">
          <Button variant="ghost" size="md" onClick={onClose} disabled={!!busy}>
            {done ? "Tutup" : "Batal"}
          </Button>
          {!done && (
            <Button variant="primary" size="md" onClick={() => void save()} disabled={!!busy || !result || !result.ok || result.matches.every((m) => m.alreadySet)}>
              Simpan code roll
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
