"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";

export type MtDownloadMrpOption = { mrpId: string; invoices: number; rolls: number; belumDelivery: number };

/** Pilihan isi unduhan Material Tracking (owner 2026-11-26): sesuai filter tabel yang sedang tampil, MRP tertentu (dicentang, boleh lebih dari satu, opsional hanya
 *  yang belum di-set delivery), atau semua yang belum di-set delivery di semua MRP. */
export type MtDownloadScope = { mode: "filter" } | { mode: "mrp"; mrpIds: string[]; onlyBelumDelivery: boolean } | { mode: "belum" };

type Preview = { invoices: number; rolls: number };

const fmt = (n: number) => n.toLocaleString("id-ID", { maximumFractionDigits: 2 });

export function MaterialTrackingDownloadDialog({
  mrpOptions,
  previewFor,
  onDownload,
  onClose,
}: {
  mrpOptions: MtDownloadMrpOption[];
  /** Jumlah invoice dan roll yang akan diunduh untuk pilihan itu (dihitung pemanggil dari data yang sama dengan isi file). */
  previewFor: (scope: MtDownloadScope) => Preview;
  onDownload: (scope: MtDownloadScope) => Promise<void>;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const [mode, setMode] = useState<MtDownloadScope["mode"]>("mrp");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [onlyBelum, setOnlyBelum] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const allPicked = mrpOptions.length > 0 && picked.size === mrpOptions.length;
  const scope: MtDownloadScope = useMemo(
    () => (mode === "filter" ? { mode: "filter" } : mode === "belum" ? { mode: "belum" } : { mode: "mrp", mrpIds: Array.from(picked), onlyBelumDelivery: onlyBelum }),
    [mode, picked, onlyBelum]
  );
  const preview = previewFor(scope);
  const filterPreview = previewFor({ mode: "filter" });
  const belumPreview = previewFor({ mode: "belum" });
  const canDownload = preview.invoices > 0 && (mode !== "mrp" || picked.size > 0);

  function toggle(id: string) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function download() {
    if (!canDownload) return;
    setBusy(true);
    setError("");
    try {
      await onDownload(scope);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const radio = (value: MtDownloadScope["mode"], title: string, hint: string) => (
    <label className={"flex cursor-pointer items-start gap-2.5 rounded-md border px-3 py-2.5 " + (mode === value ? "border-accent-blue bg-info-bg" : "border-[#DDE4EB] hover:bg-[#FAFBFC]")}>
      <input type="radio" name="mt-download-mode" className="mt-[3px] accent-[#1F5FA8]" checked={mode === value} onChange={() => setMode(value)} />
      <span className="min-w-0 flex-1">
        <span className="block font-sans text-[12px] font-semibold text-text-primary">{title}</span>
        <span className="block font-sans text-[10.5px] text-text-muted">{hint}</span>
      </span>
    </label>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0B131B]/45 p-4" onClick={onClose}>
      <div className="flex max-h-[90vh] w-full max-w-[500px] flex-col overflow-hidden rounded-[9px] bg-surface-card shadow-[0_12px_32px_rgba(11,19,27,.28)]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2.5 bg-info-bg px-5 py-3">
          <span className="h-2 w-2 rounded-full bg-accent-blue" />
          <span className="font-sans text-xs font-semibold text-info-fg">Download Material Tracking (Excel)</span>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <p className="mb-3 font-sans text-[11px] text-text-muted">Pilih isi file. Hasilnya dua sheet: &quot;Per Invoice&quot; (satu baris per kiriman) dan &quot;Per Roll&quot; (satu baris per roll kain).</p>
          <div className="flex flex-col gap-2">
            {radio("mrp", "Pilih MRP", "Centang MRP yang mau diunduh (boleh lebih dari satu).")}
            {mode === "mrp" && (
              <div className="ml-6 rounded-md border border-[#DDE4EB]">
                <label className="flex cursor-pointer items-center gap-2 border-b border-[#EEF1F4] bg-[#F7F9FB] px-3 py-2">
                  <Checkbox checked={allPicked} onChange={() => setPicked(allPicked ? new Set() : new Set(mrpOptions.map((o) => o.mrpId)))} />
                  <span className="font-sans text-[12px] font-semibold text-text-primary">Semua MRP</span>
                  <span className="ml-auto font-sans text-[10.5px] text-text-muted">
                    {picked.size} dari {mrpOptions.length} dipilih
                  </span>
                </label>
                <div className="max-h-56 overflow-y-auto">
                  {mrpOptions.map((o) => (
                    <label key={o.mrpId} className="flex cursor-pointer items-center gap-2 border-b border-[#EEF1F4] px-3 py-2 last:border-b-0 hover:bg-[#FAFBFC]">
                      <Checkbox checked={picked.has(o.mrpId)} onChange={() => toggle(o.mrpId)} />
                      <span className="min-w-0 flex-1 font-mono text-[12px] font-medium text-[#31414F]">{o.mrpId}</span>
                      <span className="flex-none font-sans text-[10.5px] text-text-muted">
                        {o.invoices} invoice · {fmt(o.rolls)} roll
                        {o.belumDelivery > 0 && <span className="text-warning-fg"> · {o.belumDelivery} belum delivery</span>}
                      </span>
                    </label>
                  ))}
                  {mrpOptions.length === 0 && <div className="px-3 py-4 text-center font-sans text-[11.5px] text-text-muted">Belum ada invoice material yang sudah dibayar.</div>}
                </div>
                <label className="flex cursor-pointer items-center gap-2 border-t border-[#EEF1F4] bg-[#FAFBFC] px-3 py-2">
                  <Checkbox checked={onlyBelum} onChange={() => setOnlyBelum((v) => !v)} />
                  <span className="font-sans text-[11.5px] text-[#31414F]">Hanya yang belum di-set delivery</span>
                </label>
              </div>
            )}
            {radio("belum", "Belum di-set delivery (semua MRP)", `${belumPreview.invoices} invoice · ${fmt(belumPreview.rolls)} roll sudah dibayar, belum dikirim supplier.`)}
            {radio("filter", "Sesuai filter tabel saat ini", `${filterPreview.invoices} invoice · ${fmt(filterPreview.rolls)} roll yang sedang tampil di tabel (tab Material atau Per Roll), ikut filter dan pencarian.`)}
          </div>
          {error && <p className="mt-3 font-sans text-[11px] text-danger-fg">{error}</p>}
        </div>
        <div className="flex items-center justify-between gap-2 border-t border-[#EEF1F4] px-5 py-3">
          <span className="font-sans text-[11px] text-text-muted">
            {preview.invoices} invoice · {fmt(preview.rolls)} roll
          </span>
          <div className="flex gap-2">
            <Button onClick={onClose} variant="ghost" size="md">
              Batal
            </Button>
            <Button onClick={() => void download()} variant="primary" size="md" disabled={busy || !canDownload}>
              {busy ? "Menyiapkan…" : "Download"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
