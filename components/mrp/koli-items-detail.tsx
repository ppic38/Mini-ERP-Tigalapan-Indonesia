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
];
const LEGACY_KIND_LABELS: Record<string, string> = { REJECT: "Reject" };
export const USIA_LABEL: Record<Usia, string> = { KIDS: "Kids", DEWASA: "Dewasa" };

export function kindLabel(kind: DeliveryKoliItem["kind"]): string {
  return PRODUCT_KIND_OPTIONS.find((opt) => opt.value === kind)?.label ?? LEGACY_KIND_LABELS[kind ?? ""] ?? kind ?? "—";
}

export function summarizeItems(items: DeliveryKoliItem[]): string {
  if (items.length === 0) return "—";
  const totalQty = items.reduce((s, it) => s + it.qty, 0);
  return `${items.length} varian · ${totalQty} pcs`;
}

export function ItemsDetailPanel({ items }: { items: DeliveryKoliItem[] }) {
  return (
    <div className="overflow-hidden rounded-md border border-[#E4E8EE] bg-white">
      <div className="grid grid-cols-5 gap-x-2 border-b border-[#E4E8EE] bg-[#F2F4F7] px-3 py-1.5 font-sans text-[10px] font-medium uppercase tracking-wider text-text-muted">
        <span>Jenis produk</span>
        <span>Warna</span>
        <span>Lengan</span>
        <span>Size / Usia</span>
        <span className="text-right">Qty</span>
      </div>
      {items.map((it, i) => (
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
