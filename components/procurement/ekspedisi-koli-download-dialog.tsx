"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { alertDialog } from "@/components/ui/confirm-dialog";
import { exportKoliResiExcel, type KoliResiExcelResi } from "@/lib/mrp/exportKoliResiExcel";
import { localDateString } from "@/lib/mrp/derive";
import { VENDOR_PRODUKSI } from "@/lib/mrp/seed";
import type { EkspedisiResiGroup } from "@/lib/mrp/ekspedisiInvoice";

const vendorName = (id: string) => VENDOR_PRODUKSI[id]?.name ?? id;
const resiLabel = (g: EkspedisiResiGroup) => g.invoice?.noResi ?? g.noResi;
const byText = (a: string, b: string) => a.localeCompare(b, "id-ID", { numeric: true });

/** Popup "Download Excel" di tabel Invoice Ekspedisi (owner 2026-11-06): pilih resi mana saja yang masuk SATU file. Filter MRP, vendor, lalu centang resi;
 *  hasilnya satu sheet berisi semua koli resi terpilih dengan kolom No MRP, Vendor, No Resi, Ekspedisi supaya bisa difilter lagi di Excel. */
export function EkspedisiKoliDownloadDialog({ groups, onClose }: { groups: EkspedisiResiGroup[]; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const mrpIds = useMemo(() => Array.from(new Set(groups.flatMap((g) => g.mrpIds))).sort((a, b) => byText(b, a)), [groups]);
  const [mrp, setMrp] = useState(""); // kosong = semua MRP
  const [vendorOff, setVendorOff] = useState<Set<string>>(() => new Set());
  const [resiOff, setResiOff] = useState<Set<string>>(() => new Set());
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);

  const inMrp = useMemo(() => groups.filter((g) => !mrp || g.mrpIds.includes(mrp)), [groups, mrp]);
  const vendors = useMemo(() => {
    const m = new Map<string, number>();
    for (const g of inMrp) m.set(g.vendorProduksi, (m.get(g.vendorProduksi) ?? 0) + 1);
    return Array.from(m.entries())
      .map(([key, resi]) => ({ key, label: vendorName(key), resi }))
      .sort((a, b) => byText(a.label, b.label));
  }, [inMrp]);
  const inVendor = useMemo(() => inMrp.filter((g) => !vendorOff.has(g.vendorProduksi)), [inMrp, vendorOff]);
  const q = search.trim().toLowerCase();
  const visible = useMemo(
    () => inVendor.filter((g) => !q || [resiLabel(g), g.noResi, g.noKolis.join(" "), g.ekspedisi, g.mrpIds.join(" ")].join(" ").toLowerCase().includes(q)),
    [inVendor, q]
  );
  const selected = useMemo(() => inVendor.filter((g) => !resiOff.has(g.key)), [inVendor, resiOff]);
  const allVendors = vendors.length > 0 && vendors.every((v) => !vendorOff.has(v.key));
  const allVisible = visible.length > 0 && visible.every((g) => !resiOff.has(g.key));

  const koliOf = (g: EkspedisiResiGroup) => (mrp ? g.kolis.filter((k) => k.mrpId === mrp) : g.kolis);
  const totals = useMemo(() => {
    let koli = 0;
    let pcs = 0;
    for (const g of selected) {
      for (const k of mrp ? g.kolis.filter((x) => x.mrpId === mrp) : g.kolis) {
        koli++;
        pcs += k.items.reduce((s, it) => s + it.qty, 0);
      }
    }
    return { koli, pcs };
  }, [selected, mrp]);

  function toggle(set: Set<string>, key: string): Set<string> {
    const next = new Set(set);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return next;
  }

  async function download() {
    if (selected.length === 0) return;
    setBusy(true);
    try {
      const resis: KoliResiExcelResi[] = selected.map((g) => ({ noResi: resiLabel(g), ekspedisi: g.ekspedisi, vendorName: vendorName(g.vendorProduksi), kolis: koliOf(g) }));
      const parts: string[] = [];
      if (mrp) parts.push(`MRP ${mrp}`);
      if (!allVendors) parts.push("vendor " + vendors.filter((v) => !vendorOff.has(v.key)).map((v) => v.label).join(", "));
      if (selected.length < inMrp.length) parts.push(`${selected.length} dari ${inMrp.length} resi dipilih`);
      const single = selected.length === 1 ? "-Resi-" + resiLabel(selected[0]).replace(/[^\w.-]+/g, "_") : "";
      await exportKoliResiExcel({ resis, filterLabel: parts.length > 0 ? "Pilihan: " + parts.join(" · ") : undefined }, `Rincian-Koli-Ekspedisi-${mrp || "SemuaMRP"}${single}-${localDateString(new Date())}.xlsx`);
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
      <div className="flex max-h-[90vh] w-full max-w-[520px] flex-col overflow-hidden rounded-[9px] bg-surface-card shadow-[0_12px_32px_rgba(11,19,27,.28)]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2.5 bg-info-bg px-5 py-3">
          <span className="h-2 w-2 rounded-full bg-accent-blue" />
          <span className="font-sans text-xs font-semibold text-info-fg">Download Excel Rincian Koli</span>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <label className={label}>No. MRP</label>
          <select
            value={mrp}
            onChange={(e) => {
              setMrp(e.target.value);
              setVendorOff(new Set());
              setResiOff(new Set());
            }}
            className="mt-1 w-full rounded-md border border-[#DDE4EB] px-[11px] py-[9px] font-sans text-[12.5px] font-medium text-text-primary"
          >
            <option value="">Semua MRP</option>
            {mrpIds.map((id) => (
              <option key={id} value={id}>
                {id}
              </option>
            ))}
          </select>

          <div className="mt-4 flex items-center justify-between">
            <span className={label}>Vendor produksi</span>
            <span className="font-sans text-[10.5px] text-text-muted">
              {vendors.filter((v) => !vendorOff.has(v.key)).length} dari {vendors.length} dipilih
            </span>
          </div>
          <div className="mt-1.5 rounded-md border border-[#DDE4EB]">
            <label className="flex cursor-pointer items-center gap-2 border-b border-[#EEF1F4] bg-[#F7F9FB] px-3 py-2">
              <Checkbox checked={allVendors} onChange={() => setVendorOff(allVendors ? new Set(vendors.map((v) => v.key)) : new Set())} />
              <span className="font-sans text-[12px] font-semibold text-text-primary">Semua vendor</span>
            </label>
            <div className="max-h-36 overflow-y-auto">
              {vendors.map((v) => (
                <label key={v.key} className="flex cursor-pointer items-center gap-2 border-b border-[#EEF1F4] px-3 py-2 last:border-b-0 hover:bg-[#FAFBFC]">
                  <Checkbox checked={!vendorOff.has(v.key)} onChange={() => setVendorOff(toggle(vendorOff, v.key))} />
                  <span className="flex-1 font-sans text-[12px] font-medium text-[#31414F]">{v.label}</span>
                  <span className="font-mono text-[11px] text-text-muted">{v.resi} resi</span>
                </label>
              ))}
              {vendors.length === 0 && <div className="px-3 py-4 text-center font-sans text-[11.5px] text-text-muted">Belum ada resi untuk MRP ini.</div>}
            </div>
          </div>

          <div className="mt-4 flex items-center justify-between">
            <span className={label}>No. resi</span>
            <span className="font-sans text-[10.5px] text-text-muted">
              {selected.length} dari {inVendor.length} dipilih
            </span>
          </div>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Cari no resi, no koli, ekspedisi…"
            className="mt-1.5 w-full rounded-md border border-[#DDE4EB] px-[11px] py-[7px] font-sans text-[12px] text-text-primary"
          />
          <div className="mt-1.5 rounded-md border border-[#DDE4EB]">
            <label className="flex cursor-pointer items-center gap-2 border-b border-[#EEF1F4] bg-[#F7F9FB] px-3 py-2">
              <Checkbox
                checked={allVisible}
                onChange={() => {
                  const next = new Set(resiOff);
                  for (const g of visible) {
                    if (allVisible) next.add(g.key);
                    else next.delete(g.key);
                  }
                  setResiOff(next);
                }}
              />
              <span className="font-sans text-[12px] font-semibold text-text-primary">{q ? "Semua hasil pencarian" : "Semua resi"}</span>
            </label>
            <div className="max-h-56 overflow-y-auto">
              {visible.map((g) => (
                <label key={g.key} className="flex cursor-pointer items-center gap-2 border-b border-[#EEF1F4] px-3 py-2 last:border-b-0 hover:bg-[#FAFBFC]">
                  <Checkbox checked={!resiOff.has(g.key)} onChange={() => setResiOff(toggle(resiOff, g.key))} />
                  <span className="min-w-0 flex-1 font-sans text-[12px] font-medium text-[#31414F]">
                    <span className="font-mono">{resiLabel(g)}</span>
                    <span className="text-text-muted"> · {vendorName(g.vendorProduksi)} · {g.mrpIds.join(", ")}</span>
                  </span>
                  <span className="flex-none font-mono text-[11px] text-text-muted">{koliOf(g).length} koli</span>
                </label>
              ))}
              {visible.length === 0 && <div className="px-3 py-4 text-center font-sans text-[11.5px] text-text-muted">Tidak ada resi yang cocok.</div>}
            </div>
          </div>
          <p className="mt-2 font-sans text-[10.5px] text-text-muted">
            Satu file, satu sheet: tiap baris memuat No MRP, Vendor, No Resi, Ekspedisi, No Koli, item, size, dan qty, jadi bisa difilter lagi di Excel.
          </p>
        </div>
        <div className="flex items-center justify-between gap-2 border-t border-[#EEF1F4] px-5 py-3">
          <span className="font-sans text-[11px] text-text-muted">
            {selected.length} resi · {totals.koli} koli · {totals.pcs.toLocaleString("id-ID")} pcs
          </span>
          <div className="flex gap-2">
            <Button onClick={onClose} variant="ghost" size="md">
              Batal
            </Button>
            <Button onClick={() => void download()} variant="primary" size="md" disabled={busy || selected.length === 0}>
              {busy ? "Menyiapkan…" : "Download"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
