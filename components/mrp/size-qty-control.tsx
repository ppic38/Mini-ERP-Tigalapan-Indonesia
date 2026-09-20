"use client";

/** Kontrol qty per size di modal Input Hasil Cutting (revisi 2026-09-19): kosong di awal (TIDAK lagi
 *  terisi otomatis), ▼/▲ untuk -1/+1, dan "Maks" mengisi sebesar qty target MRP size itu. Nilai tidak
 *  pernah bisa melebihi `max` (ketikan/▲ di-clamp). Controlled penuh dari parent (value 0 tampil kosong)
 *  supaya clamp langsung terlihat -- beda dari NumberInput yang menyimpan teks sendiri. */
export function SizeQtyControl({ size, max, value, onChange }: { size: string; max: number; value: number; onChange: (v: number) => void }) {
  const clamp = (n: number) => Math.max(0, Math.min(max, Math.floor(n)));
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between gap-2">
        <span className="whitespace-nowrap font-sans text-[11px] font-semibold text-[#31414F]">{size}</span>
        <span className="whitespace-nowrap font-mono text-[10px] text-text-muted">maks {max}</span>
      </div>
      <div className="flex items-stretch overflow-hidden rounded-md border border-[#DDE4EB] bg-white">
        <button
          type="button"
          onClick={() => onChange(clamp(value - 1))}
          disabled={value <= 0}
          aria-label={`Kurangi ${size}`}
          className="w-7 flex-none border-r border-[#DDE4EB] text-[9px] text-text-muted hover:bg-[#F2F4F7] disabled:cursor-not-allowed disabled:opacity-40"
        >
          ▼
        </button>
        <input
          value={value > 0 ? String(value) : ""}
          onChange={(e) => {
            const digits = e.target.value.replace(/[^0-9]/g, "");
            onChange(clamp(digits ? parseInt(digits, 10) : 0));
          }}
          inputMode="numeric"
          placeholder="0"
          className="w-full min-w-0 px-1 py-1.5 text-center font-mono text-[13px] font-semibold outline-none"
        />
        <button
          type="button"
          onClick={() => onChange(clamp(value + 1))}
          disabled={value >= max}
          aria-label={`Tambah ${size}`}
          className="w-7 flex-none border-l border-[#DDE4EB] text-[9px] text-text-muted hover:bg-[#F2F4F7] disabled:cursor-not-allowed disabled:opacity-40"
        >
          ▲
        </button>
        <button
          type="button"
          onClick={() => onChange(max)}
          disabled={max <= 0 || value === max}
          className="flex-none border-l border-[#DDE4EB] bg-info-bg px-2 font-sans text-[10.5px] font-semibold text-info-fg hover:bg-[#DCEBF8] disabled:cursor-not-allowed disabled:opacity-40"
        >
          Maks
        </button>
      </div>
    </div>
  );
}
