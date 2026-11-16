"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { formatPcs, type WarehouseReceivableGroup } from "@/lib/mrp/derive";

const koliOf = (it: WarehouseReceivableGroup["items"][number]) => it.noKoli ?? it.deliveryKoliId;

/** Popup "Download Excel" di rincian satu resi (owner 2026-11-16): pilih unduh SELURUH koli resi ini atau hanya koli tertentu (boleh lebih dari satu).
 *  `onDownload(null)` = seluruh koli; `onDownload(["7"])` = hanya koli 7. */
export function KoliDownloadDialog({
  group,
  onDownload,
  onClose,
}: {
  group: WarehouseReceivableGroup;
  onDownload: (kolis: string[] | null) => Promise<void>;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const options = useMemo(() => {
    const byKoli = new Map<string, { pcs: number; lines: number }>();
    for (const it of group.items) {
      const k = koliOf(it);
      const cur = byKoli.get(k) ?? { pcs: 0, lines: 0 };
      cur.pcs += it.qty;
      cur.lines += 1;
      byKoli.set(k, cur);
    }
    return Array.from(byKoli.entries())
      .map(([koli, v]) => ({ koli, ...v }))
      .sort((a, b) => a.koli.localeCompare(b.koli, "id-ID", { numeric: true }));
  }, [group.items]);

  const [picked, setPicked] = useState<Set<string>>(() => new Set(options.map((o) => o.koli)));
  const [busy, setBusy] = useState(false);
  const all = picked.size === options.length;
  const pickedPcs = options.filter((o) => picked.has(o.koli)).reduce((s, o) => s + o.pcs, 0);

  function toggle(k: string) {
    const next = new Set(picked);
    if (next.has(k)) next.delete(k);
    else next.add(k);
    setPicked(next);
  }

  async function download() {
    if (picked.size === 0) return;
    setBusy(true);
    try {
      await onDownload(all ? null : Array.from(picked));
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0B131B]/45 p-4" onClick={onClose}>
      <div className="flex max-h-[90vh] w-full max-w-[440px] flex-col overflow-hidden rounded-[9px] bg-surface-card shadow-[0_12px_32px_rgba(11,19,27,.28)]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2.5 bg-info-bg px-5 py-3">
          <span className="h-2 w-2 rounded-full bg-accent-blue" />
          <span className="font-sans text-xs font-semibold text-info-fg">Download Excel Resi {group.noResi ?? group.resiGroupId}</span>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <div className="flex items-center justify-between">
            <span className="block font-sans text-[11px] font-medium uppercase tracking-wider text-text-muted">Koli yang diunduh</span>
            <span className="font-sans text-[10.5px] text-text-muted">
              {picked.size} dari {options.length} dipilih
            </span>
          </div>
          <div className="mt-1.5 rounded-md border border-[#DDE4EB]">
            <label className="flex cursor-pointer items-center gap-2 border-b border-[#EEF1F4] bg-[#F7F9FB] px-3 py-2">
              <Checkbox checked={all} onChange={() => setPicked(all ? new Set() : new Set(options.map((o) => o.koli)))} />
              <span className="font-sans text-[12px] font-semibold text-text-primary">Seluruh koli</span>
            </label>
            <div className="max-h-64 overflow-y-auto">
              {options.map((o) => (
                <label key={o.koli} className="flex cursor-pointer items-center gap-2 border-b border-[#EEF1F4] px-3 py-2 last:border-b-0 hover:bg-[#FAFBFC]">
                  <Checkbox checked={picked.has(o.koli)} onChange={() => toggle(o.koli)} />
                  <span className="min-w-0 flex-1 font-sans text-[12px] font-medium text-[#31414F]">Koli {o.koli}</span>
                  <span className="flex-none font-mono text-[11px] text-text-muted">{formatPcs(o.pcs)} pcs</span>
                </label>
              ))}
              {options.length === 0 && <div className="px-3 py-4 text-center font-sans text-[11.5px] text-text-muted">Resi ini belum punya koli berisi item.</div>}
            </div>
          </div>
          <p className="mt-2 font-sans text-[10.5px] text-text-muted">Item yang sama dalam satu koli digabung jadi satu baris (qty dijumlah, HPP/item rata-rata tertimbang).</p>
        </div>
        <div className="flex items-center justify-between gap-2 border-t border-[#EEF1F4] px-5 py-3">
          <span className="font-sans text-[11px] text-text-muted">{formatPcs(pickedPcs)} pcs</span>
          <div className="flex gap-2">
            <Button onClick={onClose} variant="ghost" size="md">
              Batal
            </Button>
            <Button onClick={() => void download()} variant="primary" size="md" disabled={busy || picked.size === 0}>
              {busy ? "Menyiapkan…" : "Download"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
