"use client";

import { useState } from "react";
import { AppShell } from "@/components/shell/app-shell";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";
import { formatRupiah, formatDate } from "@/lib/mrp/derive";
import { findMaterialInvoicesForPoAction, sysadminRevertInvoiceDeliveryAction, type SysadminInvoiceBatchRow } from "@/lib/mrp/sysadminActions";

/** Halaman "Perbaiki Status Invoice" (owner 2026-09-28: "case2 seperti ini bisa diatur di sysadmin,
 *  di mana ada kesalahan data itu bisa dikembalikan ke semula, dari tingkat besar hingga tingkat
 *  detail ... hanya beberapa yang ingin disetting dan tidak semua") -- kasus pemicu: status
 *  DELIVERY 1 batch PV ikut "menular" ke batch LAIN dari PO yang sama gara-gara bug lama di
 *  Material Tracking (sudah diperbaiki terpisah, lihat app/procurement/material-tracking/page.tsx),
 *  jadi beberapa batch ter-set Delivery padahal seharusnya belum.
 *
 *  Cari SEMUA batch (raw_material_invoices) 1 No PO Material, pilih SEBAGIAN lewat checkbox (bukan
 *  borongan 1 PO), kembalikan yang berstatus DELIVERY ke PAID (batal "Set Delivery"). Baru dukung
 *  1 langkah mundur ini -- lihat catatan lengkap di lib/mrp/sysadminActions.ts kenapa dibatasi. */
export default function SysadminInvoiceStatusPage() {
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [rows, setRows] = useState<SysadminInvoiceBatchRow[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function handleSearch() {
    const id = query.trim();
    if (!id) return;
    setSearching(true);
    setSearchError(null);
    setRows(null);
    setSelected(new Set());
    setDone(null);
    setReason("");
    const res = await findMaterialInvoicesForPoAction(id);
    setSearching(false);
    if (!res.ok) return setSearchError(res.error);
    if (res.data.length === 0) return setSearchError("Tidak ada batch PV untuk No. PO ini.");
    setRows(res.data);
  }

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const revertibleRows = (rows ?? []).filter((r) => r.revertible);
  const selectedRevertible = revertibleRows.filter((r) => selected.has(r.id));
  const canSubmit = selectedRevertible.length > 0 && reason.trim().length > 0;

  async function handleRevert() {
    if (!canSubmit) return;
    setBusy(true);
    setActionError(null);
    const res = await sysadminRevertInvoiceDeliveryAction(Array.from(selected), reason.trim());
    setBusy(false);
    if (!res.ok) return setActionError(res.error);
    setDone(`${res.data.reverted} batch dikembalikan ke PAID${res.data.skipped ? ` (${res.data.skipped} dilewati, statusnya sudah berubah)` : ""}.`);
    setRows(null);
    setSelected(new Set());
    setReason("");
    setQuery("");
  }

  return (
    <AppShell role="sysadmin" activeHref="/sysadmin/invoice-status" breadcrumb={["Dashboard", "Perbaiki Status Invoice"]} title="Perbaiki Status Invoice">
      <div className="flex flex-col gap-4">
        <div className="rounded-md border border-[#EFC9C4] bg-danger-bg px-4 py-2.5 font-sans text-[11.5px] leading-[1.5] text-danger-fg">
          Aksi ini permanen dan tercatat ke Log Audit. Baru mendukung 1 langkah mundur: batal &quot;Set Delivery&quot; (DELIVERY → PAID) — batch dengan status lain tidak bisa dikembalikan dari
          halaman ini.
        </div>

        <div className="rounded-lg border border-border-subtle bg-surface-card p-4">
          <div className="flex items-center gap-2">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSearch()}
              placeholder="Masukkan No. PO Material persis, mis. PO-SUP-MRP-W36-MKS-KNITTO"
              className="input flex-1 font-mono"
            />
            <Button onClick={handleSearch} disabled={searching || !query.trim()} variant="primary" size="sm">
              {searching ? "Mencari…" : "Cari"}
            </Button>
          </div>
          {searchError && <div className="mt-2 rounded-md border border-danger bg-danger-bg px-3 py-2 font-sans text-[11.5px] text-danger-fg">{searchError}</div>}
          {done && <div className="mt-2 rounded-md border border-success-fg/30 bg-success-bg px-3 py-2 font-sans text-[11.5px] text-success-fg">{done}</div>}
        </div>

        {rows && (
          <div className="overflow-hidden rounded-lg border border-border-subtle bg-surface-card">
            <div className="border-b border-border-subtle px-4 py-3 font-sans text-[13px] font-semibold text-text-primary">
              {rows.length} batch — {revertibleRows.length} berstatus DELIVERY (bisa dipilih)
            </div>
            <table className="w-full border-collapse font-sans text-xs">
              <thead>
                <tr className="border-b-2 border-accent-blue bg-info-bg text-left text-[10.5px] font-medium uppercase tracking-wider text-info-fg">
                  <th className="w-10 px-4 py-2"></th>
                  <th className="px-3 py-2">Kode Transaksi / ID</th>
                  <th className="px-3 py-2 text-right">Qty</th>
                  <th className="px-3 py-2 text-right">Nilai</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Tgl Delivery</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b border-[#F1F4F7] text-[#31414F]">
                    <td className="px-4 py-2">
                      <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggle(r.id)} disabled={!r.revertible} />
                    </td>
                    <td className="px-3 py-2">
                      <div className="font-medium text-text-primary">{r.kodeTransaksi || "—"}</div>
                      <div className="font-mono text-[10.5px] text-text-muted">{r.id}</div>
                    </td>
                    <td className="px-3 py-2 text-right font-mono">{r.qtyReady}</td>
                    <td className="px-3 py-2 text-right font-mono">{formatRupiah(r.totalBiaya)}</td>
                    <td className="px-3 py-2">
                      <StatusPill tone={r.status === "DELIVERY" ? "info" : r.status === "PAID" ? "success" : "neutral"}>{r.status}</StatusPill>
                    </td>
                    <td className="px-3 py-2">{r.deliveredAt ? formatDate(r.deliveredAt) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="flex flex-col gap-2 border-t border-border-subtle px-4 py-3">
              <div>
                <div className="mb-1 font-sans text-[10.5px] font-medium uppercase tracking-wider text-text-muted">Alasan (wajib)</div>
                <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} className="input w-full" placeholder="mis. salah klik Set Delivery, seharusnya batch lain" />
              </div>
              {actionError && <div className="rounded-md border border-danger bg-danger-bg px-3 py-2 font-sans text-[11.5px] text-danger-fg">{actionError}</div>}
              <div>
                <Button onClick={handleRevert} disabled={!canSubmit || busy} variant="danger" size="sm">
                  {busy ? "Memproses…" : `Kembalikan ${selectedRevertible.length} batch ke PAID`}
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}
