"use client";

import { useState } from "react";
import { AppShell } from "@/components/shell/app-shell";
import { Button } from "@/components/ui/button";
import { formatRupiah } from "@/lib/mrp/derive";
import {
  findMaklonPoAction,
  findMaterialPoAction,
  sysadminCancelMaklonPoAction,
  sysadminCancelMaterialPoAction,
} from "@/lib/mrp/sysadminActions";

type MaterialResult = NonNullable<Extract<Awaited<ReturnType<typeof findMaterialPoAction>>, { ok: true }>["data"]>;
type MaklonResult = NonNullable<Extract<Awaited<ReturnType<typeof findMaklonPoAction>>, { ok: true }>["data"]>;

/** Halaman "Batalkan PO" (owner 2026-09-27, Sysadmin, "just in case ada kesalahan data dan ingin
 *  diulang") -- cari 1 PO by ID persis (Material atau Produksi), tampilkan status apa adanya, lalu
 *  batalkan dengan alasan wajib. PENTING (ditampilkan juga di UI): membatalkan PO TIDAK membongkar
 *  roll/invoice bahan yang sudah tercatat -- itu tetap ada sebagai jejak historis/HPP; PO hanya
 *  dikeluarkan dari daftar aktif/approval. Lihat lib/mrp/sysadminActions.ts. */
export default function SysadminPoPage() {
  const [type, setType] = useState<"material" | "maklon">("material");
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [material, setMaterial] = useState<MaterialResult | null>(null);
  const [maklon, setMaklon] = useState<MaklonResult | null>(null);
  const [reason, setReason] = useState("");
  const [confirmText, setConfirmText] = useState("");
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function handleSearch() {
    const id = query.trim();
    if (!id) return;
    setSearching(true);
    setSearchError(null);
    setMaterial(null);
    setMaklon(null);
    setDone(null);
    setReason("");
    setConfirmText("");
    const res = type === "material" ? await findMaterialPoAction(id) : await findMaklonPoAction(id);
    setSearching(false);
    if (!res.ok) return setSearchError(res.error);
    if (!res.data) return setSearchError("PO tidak ditemukan.");
    if (type === "material") setMaterial(res.data as MaterialResult);
    else setMaklon(res.data as MaklonResult);
  }

  const target = type === "material" ? material : maklon;
  const alreadyCancelled = type === "material" ? material?.status === "CANCELLED" : !!maklon?.closedAt;
  const canCancel = !!target && !alreadyCancelled && reason.trim().length > 0 && confirmText.trim() === target.id;

  async function handleCancel() {
    if (!target || !canCancel) return;
    setCancelling(true);
    setCancelError(null);
    const res = type === "material" ? await sysadminCancelMaterialPoAction(target.id, reason.trim()) : await sysadminCancelMaklonPoAction(target.id, reason.trim());
    setCancelling(false);
    if (!res.ok) return setCancelError(res.error);
    setDone(`PO ${target.id} berhasil dibatalkan.`);
    setMaterial(null);
    setMaklon(null);
  }

  return (
    <AppShell role="sysadmin" activeHref="/sysadmin/po" breadcrumb={["Dashboard", "Batalkan PO"]} title="Batalkan PO">
      <div className="flex flex-col gap-4">
        <div className="rounded-md border border-[#EFC9C4] bg-danger-bg px-4 py-2.5 font-sans text-[11.5px] leading-[1.5] text-danger-fg">
          Aksi ini permanen dan tercatat ke Log Audit. Membatalkan PO TIDAK membongkar roll/invoice bahan yang sudah tercatat sebelumnya (data historis/HPP tetap utuh) — PO hanya dikeluarkan dari
          daftar aktif, approval, dan Finance.
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
              placeholder="Masukkan No. PO persis, mis. PO-SUP-MRP-W36-MKS-KNITTO"
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
                Disetujui: <span className="font-medium">{target.approved ? "Ya" : "Belum"}</span>
              </div>
              {type === "material" && <div>Supplier: <span className="font-medium">{(target as MaterialResult).supplier}</span></div>}
              {type === "maklon" && <div>Vendor Produksi: <span className="font-mono font-medium">{(target as MaklonResult).vendorProduksi}</span></div>}
            </div>
            {alreadyCancelled ? (
              <div className="border-t border-border-subtle px-4 py-3 font-sans text-[11.5px] text-text-muted">PO ini sudah dibatalkan/ditutup sebelumnya.</div>
            ) : (
              <div className="flex flex-col gap-2 border-t border-border-subtle px-4 py-3">
                <div>
                  <div className="mb-1 font-sans text-[10.5px] font-medium uppercase tracking-wider text-text-muted">Alasan pembatalan (wajib)</div>
                  <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} className="input w-full" placeholder="mis. salah input MRP, data dobel, dst." />
                </div>
                <div>
                  <div className="mb-1 font-sans text-[10.5px] font-medium uppercase tracking-wider text-text-muted">
                    Ketik ulang <span className="font-mono">{target.id}</span> untuk konfirmasi
                  </div>
                  <input value={confirmText} onChange={(e) => setConfirmText(e.target.value)} className="input w-full font-mono" />
                </div>
                {cancelError && <div className="rounded-md border border-danger bg-danger-bg px-3 py-2 font-sans text-[11.5px] text-danger-fg">{cancelError}</div>}
                <div>
                  <Button onClick={handleCancel} disabled={!canCancel || cancelling} variant="danger" size="sm">
                    {cancelling ? "Membatalkan…" : `Batalkan ${target.id}`}
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </AppShell>
  );
}
