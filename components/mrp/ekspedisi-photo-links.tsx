"use client";

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

/** Tanggal kirim; kalau gabungan beberapa pengiriman yang tanggalnya beda, tampil sebagai rentang. */
export function kirimDateText(g: Pick<EkspedisiResiGroup, "tanggalKirim" | "tanggalKirimAkhir">): string {
  return g.tanggalKirimAkhir ? `${formatDate(g.tanggalKirim)} – ${formatDate(g.tanggalKirimAkhir)}` : formatDate(g.tanggalKirim);
}
