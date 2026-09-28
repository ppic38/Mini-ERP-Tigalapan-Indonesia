"use client";

import { useState } from "react";
import { AppShell } from "@/components/shell/app-shell";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";
import { formatRupiah, formatDate } from "@/lib/mrp/derive";
import {
  findMaterialInvoicesForPoAction,
  findMaterialPoSummaryAction,
  findMaklonPoSummaryAction,
  sysadminRevertInvoiceDeliveryAction,
  sysadminRecallMaterialPoAction,
  sysadminRevertPoApprovalStepAction,
  type SysadminInvoiceBatchRow,
  type SysadminMaterialPoSummary,
  type SysadminMaklonPoSummary,
} from "@/lib/mrp/sysadminActions";

/** Halaman "Kembalikan Data (PO & Invoice)" -- owner 2026-09-28: "case2 seperti ini bisa diatur di
 *  sysadmin ... dari tingkat besar hingga tingkat detail ... hanya beberapa yang ingin disetting",
 *  lalu diperluas: "akses tingkat tinggi untuk manipulasi apa pun ... diterapkan ke setiap modul",
 *  dipersempit ke Procurement & Finance dulu. Cari 1 PO (Material atau Produksi), tampilkan 3 jenis
 *  aksi "kembalikan ke semula" yang berlaku untuknya -- masing-masing SENGAJA dibatasi ke kondisi
 *  yang aman (lihat catatan per fungsi di lib/mrp/sysadminActions.ts):
 *  1. Kembalikan langkah approval terakhir (PO Material & Produksi, selama belum `approved` final).
 *  2. Tarik kembali PO Material yang belum pernah diinvoice (bukan cuma dibatalkan -- baris
 *     material_rows-nya dilepas lagi supaya bisa dikirim ULANG dengan vendor/supplier yang benar).
 *  3. Kembalikan batch invoice (Paying Voucher) dari DELIVERY ke PAID -- batal "Set Delivery". */
export default function SysadminInvoiceStatusPage() {
  const [type, setType] = useState<"material" | "maklon">("material");
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [material, setMaterial] = useState<SysadminMaterialPoSummary | null>(null);
  const [maklon, setMaklon] = useState<SysadminMaklonPoSummary | null>(null);
  const [batches, setBatches] = useState<SysadminInvoiceBatchRow[] | null>(null);
  const [selectedBatches, setSelectedBatches] = useState<Set<string>>(new Set());

  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState<"recall" | "approval" | "batches" | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const target = type === "material" ? material : maklon;

  async function handleSearch() {
    const id = query.trim();
    if (!id) return;
    setSearching(true);
    setSearchError(null);
    setMaterial(null);
    setMaklon(null);
    setBatches(null);
    setSelectedBatches(new Set());
    setDone(null);
    setReason("");
    setActionError(null);
    if (type === "material") {
      const [poRes, batchRes] = await Promise.all([findMaterialPoSummaryAction(id), findMaterialInvoicesForPoAction(id)]);
      setSearching(false);
      if (!poRes.ok) return setSearchError(poRes.error);
      if (!poRes.data) return setSearchError("PO Material tidak ditemukan.");
      setMaterial(poRes.data);
      if (batchRes.ok) setBatches(batchRes.data);
    } else {
      const res = await findMaklonPoSummaryAction(id);
      setSearching(false);
      if (!res.ok) return setSearchError(res.error);
      if (!res.data) return setSearchError("PO Produksi tidak ditemukan.");
      setMaklon(res.data);
    }
  }

  function toggleBatch(id: string) {
    setSelectedBatches((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const lastLogEntry = target?.approvalLog?.[target.approvalLog.length - 1];
  const canRevertApproval = !!target && !target.approved && target.approvalLevel != null && lastLogEntry?.action === "APPROVED";
  const canRecall = type === "material" && !!material && material.status !== "CANCELLED" && material.invoicedRolls === 0;
  const revertibleBatches = (batches ?? []).filter((r) => r.revertible);
  const selectedRevertibleBatches = revertibleBatches.filter((r) => selectedBatches.has(r.id));
  const hasReason = reason.trim().length > 0;

  async function handleRecall() {
    if (!material || !hasReason) return;
    setBusy("recall");
    setActionError(null);
    const res = await sysadminRecallMaterialPoAction(material.id, reason.trim());
    setBusy(null);
    if (!res.ok) return setActionError(res.error);
    setDone(`PO ${material.id} ditarik kembali -- ${res.data.rowsReleased} baris material dilepas, bisa dikirim ulang.`);
    setMaterial(null);
    setBatches(null);
    setQuery("");
  }

  async function handleRevertApproval() {
    if (!target || !hasReason) return;
    setBusy("approval");
    setActionError(null);
    const res = await sysadminRevertPoApprovalStepAction(type === "material" ? "MATERIAL" : "MAKLON", target.id, reason.trim());
    setBusy(null);
    if (!res.ok) return setActionError(res.error);
    setDone(`Langkah approval terakhir PO ${target.id} dikembalikan.`);
    setMaterial(null);
    setMaklon(null);
    setBatches(null);
    setQuery("");
  }

  async function handleRevertBatches() {
    if (selectedRevertibleBatches.length === 0 || !hasReason) return;
    setBusy("batches");
    setActionError(null);
    const res = await sysadminRevertInvoiceDeliveryAction(Array.from(selectedBatches), reason.trim());
    setBusy(null);
    if (!res.ok) return setActionError(res.error);
    setDone(`${res.data.reverted} batch dikembalikan ke PAID${res.data.skipped ? ` (${res.data.skipped} dilewati)` : ""}.`);
    setMaterial(null);
    setBatches(null);
    setQuery("");
  }

  return (
    <AppShell role="sysadmin" activeHref="/sysadmin/invoice-status" breadcrumb={["Dashboard", "Kembalikan Data"]} title="Kembalikan Data (PO & Invoice)">
      <div className="flex flex-col gap-4">
        <div className="rounded-md border border-[#EFC9C4] bg-danger-bg px-4 py-2.5 font-sans text-[11.5px] leading-[1.5] text-danger-fg">
          Semua aksi di halaman ini permanen dan tercatat ke Log Audit. Cakupan sengaja dibatasi ke kondisi yang aman (lihat penjelasan di tiap tombol) -- kalau kondisinya tidak cocok, tombol
          dinonaktifkan atau aksi ditolak dengan alasan jelas.
        </div>

        <div className="rounded-lg border border-border-subtle bg-surface-card p-4">
          <div className="flex items-center gap-2">
            <select value={type} onChange={(e) => setType(e.target.value as "material" | "maklon")} className="input w-auto">
              <option value="material">PO Material</option>
              <option value="maklon">PO Produksi (Maklon)</option>
            </select>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSearch()}
              placeholder="Masukkan No. PO persis"
              className="input flex-1 font-mono"
            />
            <Button onClick={handleSearch} disabled={searching || !query.trim()} variant="primary" size="sm">
              {searching ? "Mencari…" : "Cari"}
            </Button>
          </div>
          {searchError && <div className="mt-2 rounded-md border border-danger bg-danger-bg px-3 py-2 font-sans text-[11.5px] text-danger-fg">{searchError}</div>}
          {done && <div className="mt-2 rounded-md border border-success-fg/30 bg-success-bg px-3 py-2 font-sans text-[11.5px] text-success-fg">{done}</div>}
        </div>

        {target && (
          <div className="overflow-hidden rounded-lg border border-border-subtle bg-surface-card">
            <div className="border-b border-border-subtle px-4 py-3 font-sans text-[13px] font-semibold text-text-primary">{target.id}</div>
            <div className="grid grid-cols-2 gap-3 px-4 py-3 font-sans text-xs text-[#31414F]">
              <div>
                No. MRP: <span className="font-mono font-medium">{target.mrpId}</span>
              </div>
              <div>
                Nilai: <span className="font-mono font-medium">{formatRupiah(target.amount)}</span>
              </div>
              <div>
                Status: <span className="font-mono font-medium">{target.status}</span>
              </div>
              <div>
                Disetujui (final): <span className="font-medium">{target.approved ? "Ya" : "Belum"}</span>
              </div>
              <div>
                Level approval: <span className="font-mono font-medium">{target.approvalLevel ?? "— (PO lama)"}</span>
              </div>
              {type === "material" && (
                <div>
                  Sudah diinvoice: <span className="font-mono font-medium">{(material as SysadminMaterialPoSummary).invoicedRolls} roll</span>
                </div>
              )}
              {lastLogEntry && (
                <div className="col-span-2">
                  Langkah terakhir: <span className="font-medium">{lastLogEntry.role}</span> —{" "}
                  <span className={lastLogEntry.action === "APPROVED" ? "text-success-fg" : "text-danger-fg"}>{lastLogEntry.action}</span> · {formatDate(lastLogEntry.at)}
                </div>
              )}
            </div>

            <div className="flex flex-col gap-3 border-t border-border-subtle px-4 py-3">
              <div>
                <div className="mb-1 font-sans text-[10.5px] font-medium uppercase tracking-wider text-text-muted">Alasan (wajib, berlaku untuk aksi mana pun di bawah)</div>
                <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} className="input w-full" placeholder="mis. salah approve, seharusnya PO lain" />
              </div>
              {actionError && <div className="rounded-md border border-danger bg-danger-bg px-3 py-2 font-sans text-[11.5px] text-danger-fg">{actionError}</div>}

              <div className="flex flex-wrap items-center gap-2">
                <Button onClick={handleRevertApproval} disabled={!canRevertApproval || !hasReason || busy != null} variant="danger" size="sm">
                  {busy === "approval" ? "Memproses…" : "Kembalikan Langkah Approval Terakhir"}
                </Button>
                {!canRevertApproval && (
                  <span className="font-sans text-[10.5px] text-text-muted">
                    {target.approved ? "PO sudah final disetujui -- tidak bisa di-revert." : target.approvalLevel == null ? "PO lama, tidak pakai matriks approval." : "Langkah terakhir bukan approval."}
                  </span>
                )}
              </div>

              {type === "material" && (
                <div className="flex flex-wrap items-center gap-2">
                  <Button onClick={handleRecall} disabled={!canRecall || !hasReason || busy != null} variant="danger" size="sm">
                    {busy === "recall" ? "Memproses…" : "Tarik Kembali PO (bisa dikirim ulang)"}
                  </Button>
                  {!canRecall && (
                    <span className="font-sans text-[10.5px] text-text-muted">
                      {material?.status === "CANCELLED" ? "PO sudah dibatalkan." : "Sudah pernah diinvoice sebagian -- pakai \"Batalkan PO\" biasa."}
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {type === "material" && batches && (
          <div className="overflow-hidden rounded-lg border border-border-subtle bg-surface-card">
            <div className="border-b border-border-subtle px-4 py-3 font-sans text-[13px] font-semibold text-text-primary">
              {batches.length} batch invoice — {revertibleBatches.length} berstatus DELIVERY (bisa dipilih)
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
                {batches.map((r) => (
                  <tr key={r.id} className="border-b border-[#F1F4F7] text-[#31414F]">
                    <td className="px-4 py-2">
                      <input type="checkbox" checked={selectedBatches.has(r.id)} onChange={() => toggleBatch(r.id)} disabled={!r.revertible} />
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
            <div className="border-t border-border-subtle px-4 py-3">
              <Button onClick={handleRevertBatches} disabled={selectedRevertibleBatches.length === 0 || !hasReason || busy != null} variant="danger" size="sm">
                {busy === "batches" ? "Memproses…" : `Kembalikan ${selectedRevertibleBatches.length} batch ke PAID`}
              </Button>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}
