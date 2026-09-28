"use client";

import { useState } from "react";

/** Modal alasan untuk Sysadmin membalik batch invoice dari DELIVERY -> PAID (batal "Set
 *  Delivery") LANGSUNG dari halaman Material Tracking -- owner 2026-09-28: "belum bisa disetting
 *  ke semula? ke status paid" (setelah sebelumnya harus pindah ke halaman terpisah "Kembalikan
 *  Data" dan cari No. PO manual). Tombol pemicu HANYA muncul untuk sesi Sysadmin (lihat
 *  app/procurement/material-tracking/page.tsx) -- aksi sesungguhnya tetap
 *  sysadminRevertInvoiceDeliveryAction (lib/mrp/sysadminActions.ts), WAJIB alasan + tercatat Log
 *  Audit, sama seperti dipanggil dari halaman "Kembalikan Data". */
export function SysadminRevertDeliveryModal({
  count,
  busy,
  onCancel,
  onConfirm,
}: {
  count: number;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0B131B]/45 p-4">
      <div className="w-full max-w-[420px] overflow-hidden rounded-[9px] bg-surface-card shadow-[0_12px_32px_rgba(11,19,27,.28)]">
        <div className="px-5 py-4">
          <div className="font-sans text-[17px] font-bold text-text-primary">Kembalikan {count} batch ke PAID</div>
          <div className="mt-0.5 font-sans text-[11.5px] text-text-muted">Batal &quot;Set Delivery&quot; -- status kembali dari DELIVERY menjadi PAID. Aksi Sysadmin, tercatat ke Log Audit.</div>
        </div>
        <div className="px-5 pb-1">
          <label className="font-sans text-[11px] font-medium uppercase tracking-wider text-text-muted">Alasan (wajib)</label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            autoFocus
            placeholder="mis. salah klik Set Delivery, seharusnya batch lain"
            className="mt-1.5 w-full rounded-md border border-[#DDE4EB] px-[11px] py-[9px] font-sans text-[12.5px] text-text-primary"
          />
        </div>
        <div className="mt-4 flex items-center gap-2 border-t border-border-subtle px-5 py-4">
          <button onClick={onCancel} disabled={busy} className="ml-auto rounded-md border border-[#CBD5DF] px-3.5 py-[9px] font-sans text-xs font-semibold text-action-primary disabled:opacity-50">
            Batal
          </button>
          <button
            onClick={() => reason.trim() && onConfirm(reason.trim())}
            disabled={!reason.trim() || busy}
            className="rounded-md bg-danger px-3.5 py-[9px] font-sans text-xs font-semibold text-white disabled:opacity-50"
          >
            {busy ? "Memproses…" : "Kembalikan ke PAID"}
          </button>
        </div>
      </div>
    </div>
  );
}
