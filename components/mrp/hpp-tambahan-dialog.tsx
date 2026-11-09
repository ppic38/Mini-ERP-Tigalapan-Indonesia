"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { alertDialog } from "@/components/ui/confirm-dialog";
import { exportHppTambahanExcel, hppTambahanLines, BIAYA_TAMBAHAN, BIAYA_TAMBAHAN_AWAL } from "@/lib/mrp/exportHppTambahanExcel";
import type { HppReportRow } from "@/lib/mrp/hppReport";
import { localDateString } from "@/lib/mrp/derive";
import { VENDOR_PRODUKSI } from "@/lib/mrp/seed";

const vendorName = (id: string) => VENDOR_PRODUKSI[id]?.name ?? id;
const byText = (a: string, b: string) => a.localeCompare(b, "id-ID", { numeric: true });

/** Popup "Template HPP + Biaya Tambahan" di Laporan HPP (owner 2026-11-09): pilih vendor (bawaan Konveksi Makassar) dan PO (No MRP); hasilnya SATU file, satu sheet per PO,
 *  berisi HPP sistem per resi x item dan kolom isian biaya tambahan (benang, label, dll.) yang otomatis menghasilkan HPP baru. */
export function HppTambahanDialog({ rows, onClose }: { rows: HppReportRow[]; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const vendors = useMemo(() => Array.from(new Set(rows.filter((r) => r.fg > 0).map((r) => r.vendorProduksi))).sort((a, b) => byText(vendorName(a), vendorName(b))), [rows]);
  const [vendor, setVendor] = useState(() => (vendors.includes("MKS") ? "MKS" : (vendors[0] ?? "")));
  const [off, setOff] = useState<Set<string>>(() => new Set());
  const [busy, setBusy] = useState(false);

  const mrps = useMemo(() => {
    const m = new Map<string, { fg: number; resi: Set<string> }>();
    for (const r of rows) {
      if (r.vendorProduksi !== vendor || !(r.fg > 0)) continue;
      const cur = m.get(r.mrpId) ?? { fg: 0, resi: new Set<string>() };
      cur.fg += r.fg;
      if (r.noResi) cur.resi.add(r.noResi);
      m.set(r.mrpId, cur);
    }
    return Array.from(m.entries())
      .map(([id, v]) => ({ id, fg: v.fg, resi: v.resi.size }))
      .sort((a, b) => byText(b.id, a.id));
  }, [rows, vendor]);
  const selected = mrps.filter((m) => !off.has(m.id));
  const allOn = mrps.length > 0 && selected.length === mrps.length;

  async function download() {
    if (selected.length === 0) return;
    setBusy(true);
    try {
      const ids = new Set(selected.map((m) => m.id));
      const lines = hppTambahanLines(rows.filter((r) => r.vendorProduksi === vendor && ids.has(r.mrpId)));
      await exportHppTambahanExcel({ vendorLabel: vendorName(vendor), lines }, `Template-HPP-${vendorName(vendor).replace(/\s+/g, "")}-${localDateString(new Date())}.xlsx`);
      onClose();
    } catch (e) {
      await alertDialog({ title: "Gagal membuat Excel", message: e instanceof Error ? e.message : "Terjadi kesalahan saat membuat file Excel.", tone: "danger" });
    } finally {
      setBusy(false);
    }
  }

  const label = "block font-sans text-[11px] font-medium uppercase tracking-wider text-text-muted";
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0B131B]/45 p-4" onClick={onClose}>
      <div className="flex max-h-[90vh] w-full max-w-[500px] flex-col overflow-hidden rounded-[9px] bg-surface-card shadow-[0_12px_32px_rgba(11,19,27,.28)]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2.5 bg-info-bg px-5 py-3">
          <span className="h-2 w-2 rounded-full bg-accent-blue" />
          <span className="font-sans text-xs font-semibold text-info-fg">Template HPP + Biaya Tambahan</span>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <label className={label}>Vendor produksi</label>
          <select
            value={vendor}
            onChange={(e) => {
              setVendor(e.target.value);
              setOff(new Set());
            }}
            className="mt-1 w-full rounded-md border border-[#DDE4EB] px-[11px] py-[9px] font-sans text-[12.5px] font-medium text-text-primary"
          >
            {vendors.map((v) => (
              <option key={v} value={v}>
                {vendorName(v)}
              </option>
            ))}
          </select>

          <div className="mt-4 flex items-center justify-between">
            <span className={label}>PO (No MRP)</span>
            <span className="font-sans text-[10.5px] text-text-muted">
              {selected.length} dari {mrps.length} dipilih
            </span>
          </div>
          <div className="mt-1.5 rounded-md border border-[#DDE4EB]">
            <label className="flex cursor-pointer items-center gap-2 border-b border-[#EEF1F4] bg-[#F7F9FB] px-3 py-2">
              <Checkbox checked={allOn} onChange={() => setOff(allOn ? new Set(mrps.map((m) => m.id)) : new Set())} />
              <span className="font-sans text-[12px] font-semibold text-text-primary">Semua PO</span>
            </label>
            <div className="max-h-64 overflow-y-auto">
              {mrps.map((m) => (
                <label key={m.id} className="flex cursor-pointer items-center gap-2 border-b border-[#EEF1F4] px-3 py-2 last:border-b-0 hover:bg-[#FAFBFC]">
                  <Checkbox
                    checked={!off.has(m.id)}
                    onChange={() => {
                      const next = new Set(off);
                      if (next.has(m.id)) next.delete(m.id);
                      else next.add(m.id);
                      setOff(next);
                    }}
                  />
                  <span className="flex-1 font-mono text-[12px] font-medium text-[#31414F]">{m.id}</span>
                  <span className="font-mono text-[11px] text-text-muted">
                    {m.resi} resi · {m.fg.toLocaleString("id-ID")} pcs
                  </span>
                </label>
              ))}
              {mrps.length === 0 && <div className="px-3 py-4 text-center font-sans text-[11.5px] text-text-muted">Belum ada data HPP terkirim untuk vendor ini.</div>}
            </div>
          </div>
          <p className="mt-2 font-sans text-[10.5px] text-text-muted">
            Satu file, satu sheet per PO. Biaya tambahan per pcs: {BIAYA_TAMBAHAN.map((n, i) => `${n} Rp ${BIAYA_TAMBAHAN_AWAL[i]}`).join(", ")} (nilai awal, bisa diubah di kotak biru tiap sheet); HPP baru per pcs = HPP sistem + biaya tambahan, dihitung otomatis. Hanya barang yang sudah dikirim.
          </p>
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-[#EEF1F4] px-5 py-3">
          <Button onClick={onClose} variant="ghost" size="md">
            Batal
          </Button>
          <Button onClick={() => void download()} variant="primary" size="md" disabled={busy || selected.length === 0}>
            {busy ? "Menyiapkan…" : "Download"}
          </Button>
        </div>
      </div>
    </div>
  );
}
