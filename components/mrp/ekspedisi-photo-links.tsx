"use client";

import { useEffect, useState } from "react";
import { viewEkspedisiPhoto } from "@/components/mrp/koli-ekspedisi-card";
import { formatDate } from "@/lib/mrp/derive";
import type { EkspedisiResiGroup } from "@/lib/mrp/ekspedisiInvoice";

/** Tautan lampiran resi dari vendor. Satu baris Invoice Ekspedisi bisa menggabungkan beberapa pengiriman vendor bernomor resi sama, dan tiap pengiriman punya fotonya sendiri:
 *  satu pengiriman = satu tombol "Lihat", lebih dari satu = "Lihat 1", "Lihat 2", dst. */
export function VendorPhotoLinks({ ids, className }: { ids: string[]; className?: string }) {
  if (ids.length === 0) return <span className="text-text-muted">—</span>;
  const cls = className ?? "font-sans text-[11px] font-semibold text-action-primary underline";
  return (
    <span onClick={(e) => e.stopPropagation()} className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
      {ids.map((id, i) => (
        <button key={id} onClick={() => viewEkspedisiPhoto(id)} className={cls}>
          {ids.length === 1 ? "Lihat" : `Lihat ${i + 1}`}
        </button>
      ))}
    </span>
  );
}

/** Versi ringkas (owner 2026-11-06, tabel Invoice Ekspedisi Procurement): SATU tombol saja di sel tabel. Satu lampiran dibuka langsung; lebih dari satu
 *  menampilkan "Lihat (N)" yang membuka daftar kecil berisi semua lampiran, tiap pengiriman satu tombol. `labelOf` memberi keterangan tiap pengiriman. */
export function VendorPhotoSummary({ ids, labelOf }: { ids: string[]; labelOf?: (id: string, index: number) => string }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  if (ids.length === 0) return <span className="text-text-muted">—</span>;
  const cls = "font-sans text-[11px] font-semibold text-action-primary underline";
  return (
    <span onClick={(e) => e.stopPropagation()}>
      <button onClick={() => (ids.length === 1 ? viewEkspedisiPhoto(ids[0]) : setOpen(true))} className={cls}>
        {ids.length === 1 ? "Lihat" : `Lihat (${ids.length})`}
      </button>
      {open && (
        <div className="fixed inset-0 z-[95] flex items-center justify-center bg-[#0B131B]/45 p-4" onClick={() => setOpen(false)}>
          <div className="w-full max-w-[460px] overflow-hidden rounded-xl bg-white shadow-[0_12px_32px_rgba(11,19,27,.25)]" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between gap-3 border-b border-border-subtle px-5 py-3.5">
              <div className="font-sans text-[14px] font-semibold text-text-primary">Lampiran vendor ({ids.length})</div>
              <button onClick={() => setOpen(false)} className="rounded-md border border-[#CBD5DF] bg-white px-3 py-[6px] font-sans text-xs font-semibold text-action-primary">
                Tutup
              </button>
            </div>
            <div className="max-h-[60vh] overflow-y-auto">
              {ids.map((id, i) => (
                <div key={id} className="flex items-center justify-between gap-3 border-b border-[#F1F4F7] px-5 py-2.5 last:border-b-0">
                  <span className="font-sans text-[12px] text-[#31414F]">{labelOf ? labelOf(id, i) : `Pengiriman ${i + 1}`}</span>
                  <button onClick={() => viewEkspedisiPhoto(id)} className={cls}>
                    Lihat
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </span>
  );
}

/** Tanggal kirim; kalau gabungan beberapa pengiriman yang tanggalnya beda, tampil sebagai rentang. */
export function kirimDateText(g: Pick<EkspedisiResiGroup, "tanggalKirim" | "tanggalKirimAkhir">): string {
  return g.tanggalKirimAkhir ? `${formatDate(g.tanggalKirim)} – ${formatDate(g.tanggalKirimAkhir)}` : formatDate(g.tanggalKirim);
}
