"use client";

import { useEffect, useState } from "react";
import { useMrpStore } from "@/lib/mrp/store";
import type { DeliveryKoliItem, Usia } from "@/lib/mrp/types";

/** Diekstrak dari app/vendor-maklon/pengiriman/page.tsx (revisi 2026-09-24, owner: "apa bisa detail
 *  seperti [Riwayat pengiriman]?") -- dipakai bareng oleh Pengiriman ("Riwayat pengiriman") DAN
 *  Invoice & Payment ("Siap diajukan invoice") supaya kedua tempat menampilkan rincian isi koli
 *  (jenis produk/warna/lengan/size/usia/qty) dengan tampilan yang SAMA PERSIS, bukan disalin manual
 *  dua kali. Kind "REJECT" sengaja TIDAK ada di opsi baru (tidak ada lagi baris Reject yang bisa
 *  dibuat di koli), tapi `kindLabel` tetap mengenalinya untuk koli LAMA yang terlanjur berisi baris
 *  itu dari sebelum perubahan tsb. */
const PRODUCT_KIND_OPTIONS: { value: string; label: string }[] = [
  { value: "FG", label: "Finish Good" },
  { value: "REWORK", label: "Rework" },
  { value: "REJECT", label: "Reject" },
];
const LEGACY_KIND_LABELS: Record<string, string> = { REJECT: "Reject" };
export const USIA_LABEL: Record<Usia, string> = { KIDS: "Kids", DEWASA: "Dewasa" };

export function kindLabel(kind: DeliveryKoliItem["kind"]): string {
  return PRODUCT_KIND_OPTIONS.find((opt) => opt.value === kind)?.label ?? LEGACY_KIND_LABELS[kind ?? ""] ?? kind ?? "—";
}

/** Gabungkan item yang jenis produk, warna, lengan, size, dan usianya sama. Satu size bisa diambil dari beberapa roll, dan tiap roll tersimpan sebagai item sendiri
 *  di koli (migration 0024); untuk dibaca orang, qty-nya dijumlahkan jadi satu baris per size. Urutan mengikuti kemunculan pertama. */
export function mergeKoliItems(items: DeliveryKoliItem[]): DeliveryKoliItem[] {
  const merged = new Map<string, DeliveryKoliItem>();
  for (const it of items) {
    const key = [it.kind ?? "FG", it.warna, it.lengan, it.size, it.usia ?? ""].join("|");
    const cur = merged.get(key);
    if (cur) cur.qty += it.qty;
    else merged.set(key, { ...it });
  }
  return Array.from(merged.values());
}

export function summarizeItems(items: DeliveryKoliItem[]): string {
  if (items.length === 0) return "—";
  const totalQty = items.reduce((s, it) => s + it.qty, 0);
  return `${mergeKoliItems(items).length} varian · ${totalQty} pcs`;
}

/** Popup qty per roll isi satu koli: tiap item koli menyimpan roll asalnya (`sourceBatchId`), jadi di sini terlihat dari roll mana tiap pcs berasal.
 *  Item tanpa roll asal (Rework, atau koli lama sebelum pelacakan per roll) ditandai "—". */
function RollDetailPopup({ items, onClose }: { items: DeliveryKoliItem[]; onClose: () => void }) {
  const batches = useMrpStore((s) => s.productionBatches);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const rows = items
    .map((it) => {
      const batch = it.sourceBatchId ? batches.find((b) => b.id === it.sourceBatchId) : undefined;
      return { ...it, roll: it.sourceBatchId ? batch?.codeRoll ?? batch?.kode ?? it.sourceBatchId : "—" };
    })
    .sort((a, b) => a.roll.localeCompare(b.roll, undefined, { numeric: true }) || a.warna.localeCompare(b.warna) || a.size.localeCompare(b.size));
  const total = rows.reduce((sum, r) => sum + r.qty, 0);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0B131B]/45 p-4" onClick={onClose}>
      <div className="flex max-h-[80vh] w-full max-w-[640px] flex-col overflow-hidden rounded-lg bg-white shadow-[0_8px_24px_rgba(11,19,27,.25)]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 border-b border-border-subtle px-5 py-3.5">
          <div>
            <div className="font-sans text-[14px] font-semibold text-text-primary">Detail roll isi koli</div>
            <div className="mt-0.5 font-sans text-[11.5px] text-text-muted">
              {rows.length} baris · {total} pcs
            </div>
          </div>
          <button onClick={onClose} className="rounded-md border border-[#CBD5DF] bg-white px-3 py-[6px] font-sans text-xs font-semibold text-action-primary">
            Tutup
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <table className="w-full border-collapse font-sans text-[11.5px]">
            <thead className="sticky top-0 bg-info-bg text-[10.5px] font-medium uppercase tracking-wider text-info-fg">
              <tr>
                <th className="px-4 py-2 text-left">Code roll</th>
                <th className="px-3 py-2 text-left">Jenis produk</th>
                <th className="px-3 py-2 text-left">Warna</th>
                <th className="px-3 py-2 text-left">Lengan</th>
                <th className="px-3 py-2 text-left">Size</th>
                <th className="px-4 py-2 text-right">Qty</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="border-t border-[#EEF1F4]">
                  <td className="px-4 py-2 font-mono font-medium">{r.roll}</td>
                  <td className="px-3 py-2">{kindLabel(r.kind ?? "FG")}</td>
                  <td className="px-3 py-2">{r.warna}</td>
                  <td className="px-3 py-2">{r.lengan}</td>
                  <td className="px-3 py-2">
                    {r.size}
                    {r.usia ? " · " + USIA_LABEL[r.usia] : ""}
                  </td>
                  <td className="px-4 py-2 text-right font-mono font-semibold">{r.qty} pcs</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t-2 border-border-subtle bg-[#F2F5F8] font-semibold">
              <tr>
                <td className="px-4 py-2" colSpan={5}>Total</td>
                <td className="px-4 py-2 text-right font-mono">{total} pcs</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  );
}

export function ItemsDetailPanel({ items }: { items: DeliveryKoliItem[] }) {
  const [rollOpen, setRollOpen] = useState(false);
  return (
    <div className="overflow-hidden rounded-md border border-[#E4E8EE] bg-white">
      <div className="flex justify-end border-b border-[#E4E8EE] bg-white px-3 py-1.5">
        <button type="button" onClick={() => setRollOpen(true)} className="font-sans text-[11px] font-semibold text-action-primary hover:underline">
          Lihat detail roll
        </button>
      </div>
      {rollOpen && <RollDetailPopup items={items} onClose={() => setRollOpen(false)} />}
      <div className="grid grid-cols-5 gap-x-2 border-b border-[#E4E8EE] bg-[#F2F4F7] px-3 py-1.5 font-sans text-[10px] font-medium uppercase tracking-wider text-text-muted">
        <span>Jenis produk</span>
        <span>Warna</span>
        <span>Lengan</span>
        <span>Size / Usia</span>
        <span className="text-right">Qty</span>
      </div>
      {mergeKoliItems(items).map((it, i) => (
        <div key={i} className="grid grid-cols-5 gap-x-2 border-b border-[#F1F4F7] px-3 py-1.5 font-sans text-[11.5px] text-[#31414F] last:border-b-0">
          <span>{kindLabel(it.kind ?? "FG")}</span>
          <span>{it.warna}</span>
          <span>{it.lengan}</span>
          <span>
            {it.size}
            {it.usia ? " · " + USIA_LABEL[it.usia] : ""}
          </span>
          <span className="text-right font-mono font-semibold">{it.qty} pcs</span>
        </div>
      ))}
    </div>
  );
}
