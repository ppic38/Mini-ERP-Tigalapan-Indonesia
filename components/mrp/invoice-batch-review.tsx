"use client";

import { useRef, useState } from "react";
import { aliasesToSave, buildPvDraft } from "@/lib/invoice-import/mapping";
import { poAfterDraft, type BatchAssessment, type BatchStatus } from "@/lib/invoice-import/batch";
import { round2 } from "@/lib/invoice-import/parser-knitto";
import type { ParsedInvoice } from "@/lib/invoice-import/types";
import { saveSupplierColorAliasesAction } from "@/lib/mrp/supplierColorAliasActions";
import { formatRupiah } from "@/lib/mrp/derive";
import type { AddBuyItem, ColorEntry, Lengan, MaterialPO } from "@/lib/mrp/types";

export type PvBookInput = {
  colorEntries: ColorEntry[];
  addBuys: AddBuyItem[];
  diskon: number;
  kodeTransaksi: string;
  noInvoiceVendor: string;
  buktiPvDataUrl?: string;
  buktiPvFileName?: string;
};

export type BatchReviewItem = { file: File; parsed: ParsedInvoice; assess: BatchAssessment };
export type BatchReadFailure = { file: File; error: string };

const STATUS_LABEL: Record<BatchStatus, string> = { READY: "Siap", REVIEW: "Perlu ditinjau", BLOCKED: "Bermasalah" };
const STATUS_CLASS: Record<BatchStatus, string> = {
  READY: "bg-success-bg text-success-fg",
  REVIEW: "bg-warning-bg text-warning-fg",
  BLOCKED: "bg-danger-bg text-danger-fg",
};

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("Gagal membaca file"));
    reader.readAsDataURL(file);
  });
}

type SaveResult = { state: "saved" | "failed" | "skipped"; message?: string };

/**
 * Ringkasan upload BANYAK invoice: tiap invoice dinilai (Siap / Perlu ditinjau / Bermasalah) terhadap sisa PO secara kumulatif.
 * "Simpan yang siap" menyimpan SETIAP invoice Siap sebagai Paying Voucher-nya SENDIRI (tidak digabung), berurutan; berhenti
 * di kesalahan pertama. Yang belum siap tidak disimpan -- dikembalikan ke antrean supaya dikerjakan satu per satu.
 */
export function InvoiceBatchReview({
  items,
  failures,
  po,
  onBook,
  onFinish,
  onCancel,
}: {
  items: BatchReviewItem[];
  failures: BatchReadFailure[];
  po: MaterialPO;
  onBook: (input: PvBookInput) => Promise<void>;
  /** `leftover` = file yang belum tersimpan (untuk dikerjakan satu per satu). Kosong = selesai semua. */
  onFinish: (leftover: File[]) => void;
  onCancel: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [finished, setFinished] = useState(false);
  const [results, setResults] = useState<Record<number, SaveResult>>({});
  const poAtStart = useRef(po);

  const ready = items.map((it, idx) => ({ it, idx })).filter((x) => x.it.assess.status === "READY");
  const count = (s: BatchStatus) => items.filter((i) => i.assess.status === s).length;
  const readyRolls = ready.reduce((a, x) => a + x.it.assess.evalResult.invoiceRolls, 0);
  const readyTotal = ready.reduce((a, x) => a + x.it.assess.evalResult.invoiceTotalBayar, 0);

  async function saveReady() {
    setSaving(true);
    let simPo = poAtStart.current;
    const next: Record<number, SaveResult> = {};
    let stopped = false;
    for (const { it, idx } of ready) {
      if (stopped) {
        next[idx] = { state: "skipped", message: "Tidak diproses karena invoice sebelumnya gagal" };
        continue;
      }
      try {
        const draft = buildPvDraft(it.parsed, it.assess.mappings, simPo);
        if (draft.leftoverRolls > 0) throw new Error(`${draft.leftoverRolls} roll tidak punya tempat di PO (sisa per lengan tidak cukup)`);
        const buktiPvDataUrl = await readAsDataUrl(it.file);
        await onBook({
          colorEntries: draft.colorEntries.map((c) => ({ warna: c.warna, lengan: c.lengan as Lengan, hargaPerRoll: c.hargaPerRoll, rolls: c.rolls })),
          addBuys: draft.addBuys.map((a) => ({ id: a.id, item: a.item, warna: a.warna, beratKg: a.beratKg, hargaPerKg: a.hargaPerKg, totalHarga: a.totalHarga, remark: a.remark })),
          diskon: draft.diskon,
          noInvoiceVendor: it.parsed.noPenjualan,
          kodeTransaksi: it.parsed.kodeTransfer,
          buktiPvDataUrl,
          buktiPvFileName: it.file.name,
        });
        simPo = poAfterDraft(simPo, draft.colorEntries);
        next[idx] = { state: "saved" };
        const aliases = aliasesToSave(it.assess.mappings);
        if (aliases.length > 0) void saveSupplierColorAliasesAction(po.supplier, aliases).catch(() => {});
      } catch (err) {
        next[idx] = { state: "failed", message: err instanceof Error ? err.message : "Gagal menyimpan" };
        stopped = true;
      }
      setResults({ ...next });
    }
    setResults({ ...next });
    setSaving(false);
    setFinished(true);
  }

  const savedCount = Object.values(results).filter((r) => r.state === "saved").length;
  const leftover = [...items.filter((_, idx) => results[idx]?.state !== "saved").map((i) => i.file), ...failures.map((f) => f.file)];

  return (
    <div className="mt-3 space-y-3 font-sans">
      <div className="rounded-lg border border-[#CFE0EF] bg-white">
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 px-4 pt-3">
          <span className="text-[13px] font-semibold text-text-primary">Upload banyak invoice — {items.length + failures.length} file</span>
          <span className="text-[11.5px] text-success-fg">Siap: {count("READY")}</span>
          <span className="text-[11.5px] text-warning-fg">Perlu ditinjau: {count("REVIEW")}</span>
          <span className="text-[11.5px] text-danger-fg">Bermasalah: {count("BLOCKED") + failures.length}</span>
        </div>
        <div className="px-4 pb-2 pt-1 text-[11px] text-text-muted">
          Tiap invoice yang <b>Siap</b> disimpan sebagai <b>Paying Voucher-nya sendiri</b> (tidak digabung), dengan isi dari invoice itu. Roll semua invoice dihitung kumulatif terhadap sisa PO. Yang belum siap tidak disimpan dan bisa dikerjakan satu per satu setelahnya.
        </div>

        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[11.5px]">
            <thead>
              <tr className="bg-[#F2F5F8] text-left text-[10px] font-medium uppercase tracking-wider text-text-muted">
                <th className="px-3 py-1.5">File</th>
                <th className="px-3 py-1.5">No Invoice</th>
                <th className="px-3 py-1.5 text-right">Roll</th>
                <th className="px-3 py-1.5 text-right">Rib (kg)</th>
                <th className="px-3 py-1.5 text-right">Total Bayar</th>
                <th className="px-3 py-1.5">Status</th>
                <th className="px-3 py-1.5">Catatan</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it, idx) => {
                const a = it.assess;
                const r = results[idx];
                return (
                  <tr key={idx} className="border-t border-[#F1F4F7] align-top">
                    <td className="px-3 py-2 font-mono text-[10.5px] text-text-muted">{it.file.name}</td>
                    <td className="px-3 py-2 font-mono">{it.parsed.noPenjualan || "—"}</td>
                    <td className="px-3 py-2 text-right font-mono">{a.evalResult.invoiceRolls}</td>
                    <td className="px-3 py-2 text-right font-mono">{round2(a.evalResult.invoiceRibKg).toLocaleString("id-ID")}</td>
                    <td className="px-3 py-2 text-right font-mono">{formatRupiah(a.evalResult.invoiceTotalBayar)}</td>
                    <td className="px-3 py-2">
                      {r ? (
                        <span className={"rounded px-1.5 py-0.5 text-[10.5px] font-semibold " + (r.state === "saved" ? "bg-success-bg text-success-fg" : r.state === "failed" ? "bg-danger-bg text-danger-fg" : "bg-[#EEF1F4] text-text-muted")}>
                          {r.state === "saved" ? "✓ Tersimpan" : r.state === "failed" ? "✕ Gagal" : "Dilewati"}
                        </span>
                      ) : (
                        <span className={"rounded px-1.5 py-0.5 text-[10.5px] font-semibold " + STATUS_CLASS[a.status]}>{STATUS_LABEL[a.status]}</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-[11px] text-[#31414F]">{r?.message ?? (a.reasons.length > 0 ? a.reasons.join(" · ") : "Warna terpetakan, total cocok")}</td>
                  </tr>
                );
              })}
              {failures.map((f, idx) => (
                <tr key={`f${idx}`} className="border-t border-[#F1F4F7] align-top">
                  <td className="px-3 py-2 font-mono text-[10.5px] text-text-muted">{f.file.name}</td>
                  <td className="px-3 py-2">—</td>
                  <td colSpan={3} />
                  <td className="px-3 py-2">
                    <span className="rounded bg-danger-bg px-1.5 py-0.5 text-[10.5px] font-semibold text-danger-fg">Gagal dibaca</span>
                  </td>
                  <td className="px-3 py-2 text-[11px] text-[#31414F]">{f.error}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex flex-wrap items-center gap-3 border-t border-[#E8EEF4] px-4 py-2.5">
          {!finished ? (
            <>
              <button
                onClick={() => void saveReady()}
                disabled={saving || ready.length === 0}
                className="rounded-md bg-action-primary px-3.5 py-2 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
              >
                {saving ? "Menyimpan…" : `Simpan ${ready.length} invoice yang siap`}
              </button>
              {ready.length > 0 && !saving && (
                <span className="text-[11px] text-text-muted">
                  {readyRolls} roll · {formatRupiah(readyTotal)} — jadi {ready.length} Paying Voucher terpisah
                </span>
              )}
              <button onClick={onCancel} disabled={saving} className="ml-auto text-[11.5px] font-semibold text-action-primary underline disabled:opacity-40">
                Batal
              </button>
            </>
          ) : (
            <>
              <span className="text-[12px] font-semibold text-success-fg">{savedCount} Paying Voucher tersimpan.</span>
              {leftover.length > 0 && <span className="text-[11.5px] text-text-muted">{leftover.length} invoice belum tersimpan — dilanjutkan satu per satu.</span>}
              <button onClick={() => onFinish(leftover)} className="ml-auto rounded-md bg-action-primary px-3.5 py-2 text-xs font-semibold text-white">
                {leftover.length > 0 ? "Lanjut yang belum siap" : "Selesai"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
