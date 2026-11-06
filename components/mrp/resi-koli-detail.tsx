"use client";

import { useEffect, useState } from "react";
import { ItemsDetailPanel, summarizeItems } from "@/components/mrp/koli-items-detail";
import { formatDate } from "@/lib/mrp/derive";
import type { DeliveryKoli } from "@/lib/mrp/types";

const kg = (n: number) => n.toLocaleString("id-ID", { maximumFractionDigits: 2 }) + " kg";

/** Popup isi satu koli: item apa saja (jenis produk, warna, lengan, size/usia, qty) dan tombol "Lihat detail roll". */
function KoliItemsPopup({ koli, onClose }: { koli: DeliveryKoli; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const totalQty = koli.items.reduce((s, it) => s + it.qty, 0);
  return (
    <div className="fixed inset-0 z-[95] flex items-center justify-center bg-[#0B131B]/45 p-4" onClick={onClose}>
      <div className="flex max-h-[84vh] w-full max-w-[680px] flex-col overflow-hidden rounded-xl bg-white shadow-[0_12px_32px_rgba(11,19,27,.25)]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 border-b border-border-subtle px-5 py-3.5">
          <div>
            <div className="font-sans text-[14px] font-semibold text-text-primary">
              Isi koli <span className="font-mono">{koli.noKoli || koli.id}</span>
            </div>
            <div className="mt-0.5 font-sans text-[11.5px] text-text-muted">
              {koli.mrpId} · {koli.ekspedisi || "—"} · resi <span className="font-mono">{koli.noResi || "—"}</span> · {koli.beratKoli ? kg(koli.beratKoli) : "berat belum diisi"} · {totalQty} pcs · kirim {formatDate(koli.deliveredAt)}
            </div>
          </div>
          <button onClick={onClose} className="flex-none rounded-md border border-[#CBD5DF] bg-white px-3 py-[6px] font-sans text-xs font-semibold text-action-primary">
            Tutup
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {koli.items.length === 0 ? <div className="py-6 text-center font-sans text-xs text-text-muted">Koli ini belum berisi item.</div> : <ItemsDetailPanel items={koli.items} />}
        </div>
      </div>
    </div>
  );
}

/** Rincian koli satu resi (isi baris yang dibuka di tabel Invoice Ekspedisi). Tiap nomor koli bisa diklik untuk melihat item di dalamnya. */
export function ResiKoliDetail({ kolis, onExport }: { kolis: DeliveryKoli[]; onExport?: () => void | Promise<void> }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const open = openId ? kolis.find((k) => k.id === openId) : undefined;
  const totalQty = kolis.reduce((s, k) => s + k.items.reduce((a, it) => a + it.qty, 0), 0);
  const totalBerat = kolis.reduce((s, k) => s + (k.beratKoli ?? 0), 0);
  return (
    <div className="overflow-hidden rounded-md border border-[#E4E9EE] bg-white">
      <div className="flex items-center justify-between border-b border-[#E4E9EE] bg-[#F2F5F8] px-3 py-1.5 font-sans text-[10px] font-medium uppercase tracking-wider text-text-muted">
        <span>Rincian koli ({kolis.length} koli)</span>
        <span className="flex items-center gap-3 normal-case tracking-normal">
          Klik baris koli untuk melihat isinya
          {onExport && (
            <button
              onClick={() => void onExport()}
              className="rounded-md border border-[#CBD5DF] bg-white px-2.5 py-[3px] font-sans text-[11px] font-semibold text-action-primary hover:bg-[#F2F5F8]"
              title="Unduh Excel: satu sheet per koli berisi item dan qty-nya"
            >
              Unduh Excel
            </button>
          )}
        </span>
      </div>
      <div className="grid grid-cols-[110px_110px_90px_1fr] gap-x-3 border-b border-[#E4E9EE] bg-[#FAFBFC] px-3 py-1.5 font-sans text-[10px] font-medium uppercase tracking-wider text-text-muted">
        <span>No Koli</span>
        <span className="text-right">Berat</span>
        <span className="text-right">Total Qty</span>
        <span>Isi</span>
      </div>
      {kolis.map((k) => (
        <div
          key={k.id}
          onClick={() => setOpenId(k.id)}
          title="Klik untuk melihat item dan qty koli ini"
          className="grid cursor-pointer grid-cols-[110px_110px_90px_1fr] items-center gap-x-3 border-b border-[#F1F4F7] px-3 py-1.5 font-sans text-[11.5px] text-[#31414F] last:border-b-0 hover:bg-[#EEF4FF]"
        >
          <button onClick={(e) => { e.stopPropagation(); setOpenId(k.id); }} className="text-left font-mono font-semibold text-action-primary underline">
            {k.noKoli || k.id}
          </button>
          <span className="text-right font-mono">{k.beratKoli ? kg(k.beratKoli) : "—"}</span>
          <span className="text-right font-mono font-semibold">{k.items.reduce((s, it) => s + it.qty, 0)} pcs</span>
          <span className="text-text-muted">{summarizeItems(k.items)} · lihat rincian</span>
        </div>
      ))}
      <div className="grid grid-cols-[110px_110px_90px_1fr] gap-x-3 border-t border-[#E4E9EE] bg-[#F7F9FB] px-3 py-1.5 font-sans text-[11.5px] font-semibold text-[#31414F]">
        <span>Total</span>
        <span className="text-right font-mono">{kg(totalBerat)}</span>
        <span className="text-right font-mono">{totalQty} pcs</span>
        <span />
      </div>
      {open && <KoliItemsPopup koli={open} onClose={() => setOpenId(null)} />}
    </div>
  );
}
