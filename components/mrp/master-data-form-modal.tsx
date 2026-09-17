"use client";

import type { ReactNode } from "react";

/** Revisi 2026-09-17 (owner: "tambah/edit master data lewat popup form, bukan baris kosong dulu
 *  baru diisi satu-satu lewat Edit inline") -- wrapper modal generik dipakai SEMUA panel Master
 *  Data Procurement (Harga Maklon/Kain/Kain PKS/RIB/Kerah-Manset/Ekspedisi, dan Vendor & Supplier)
 *  untuk form "Tambah Data" maupun "Edit" -- keduanya modal yang sama, cuma judul & nilai awal
 *  field beda (lihat pola isi/kosongkan draft state di tiap panel). Gaya visual sama dengan modal
 *  lain di app ini (mis. SetDeliveryModal) supaya konsisten. */
export function MasterDataFormModal({
  title,
  subtitle,
  onCancel,
  onSave,
  saveLabel = "Simpan",
  saveDisabled,
  saving,
  error,
  children,
}: {
  title: string;
  subtitle?: string;
  onCancel: () => void;
  onSave: () => void;
  saveLabel?: string;
  saveDisabled?: boolean;
  saving?: boolean;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0B131B]/45 p-4">
      <div className="w-full max-w-[480px] overflow-hidden rounded-[9px] bg-surface-card shadow-[0_12px_32px_rgba(11,19,27,.28)]">
        <div className="px-5 py-4">
          <div className="font-sans text-[17px] font-bold text-text-primary">{title}</div>
          {subtitle && <div className="mt-0.5 font-sans text-[11.5px] text-text-muted">{subtitle}</div>}
        </div>
        <div className="flex max-h-[60vh] flex-col gap-3 overflow-y-auto px-5 pb-2">{children}</div>
        {error && <div className="px-5 pb-1 font-sans text-[11px] font-medium text-danger-fg">{error}</div>}
        <div className="mt-4 flex items-center gap-2 border-t border-border-subtle px-5 py-4">
          <button onClick={onCancel} className="ml-auto rounded-md border border-[#CBD5DF] px-3.5 py-[9px] font-sans text-xs font-semibold text-action-primary">
            Batal
          </button>
          <button
            onClick={onSave}
            disabled={saveDisabled || saving}
            className="rounded-md bg-action-primary px-3.5 py-[9px] font-sans text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? "Menyimpan…" : saveLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Label + kontrol form 1 baris, dipakai berulang di dalam MasterDataFormModal supaya spacing &
 *  tipografi label konsisten tanpa copy-paste className di tiap panel. */
export function ModalField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="font-sans text-[11px] font-medium uppercase tracking-wider text-text-muted">{label}</label>
      {children}
    </div>
  );
}
