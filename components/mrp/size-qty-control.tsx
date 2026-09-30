"use client";

/** Kontrol qty per size (dipakai di modal Input Hasil Cutting dan Edit FG): kosong di awal (TIDAK lagi terisi
 *  otomatis), ▼/▲ untuk -1/+1, dan "Maks" mengisi sebesar `max` (target size itu). Controlled penuh dari
 *  parent (value 0 tampil kosong) supaya perubahan langsung terlihat -- beda dari NumberInput yang menyimpan
 *  teks sendiri.
 *
 *  Default: nilai TIDAK pernah bisa melebihi `max` (ketikan/▲ di-clamp) -- dipakai Edit FG, yang juga
 *  ditegakkan server (FG tidak boleh melebihi hasil cutting).
 *
 *  Revisi 2026-09-30 (owner: "di lapangan bisa input cutting lebih dari target MRP, jangan set maks, tapi
 *  fungsi tombol Maks dan naik-turun satu angka tetap dipertahankan"): `allowExceed` -- `max` dianggap TARGET
 *  (bukan batas): ketikan dan ▲ boleh melampauinya, tombol Maks tetap mengisi sebesar target, ▼/▲ tetap +-1.
 *  Kelebihan ditandai "+N" supaya kelihatan. Dipakai hanya di Input Hasil Cutting. */
export function SizeQtyControl({
  size,
  max,
  value,
  onChange,
  allowExceed = false,
}: {
  size: string;
  max: number;
  value: number;
  onChange: (v: number) => void;
  allowExceed?: boolean;
}) {
  const clamp = (n: number) => (allowExceed ? Math.max(0, Math.floor(n)) : Math.max(0, Math.min(max, Math.floor(n))));
  const over = allowExceed && value > max ? value - max : 0;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between gap-2">
        <span className="whitespace-nowrap font-sans text-[11px] font-semibold text-[#31414F]">{size}</span>
        <span className="whitespace-nowrap font-mono text-[10px] text-text-muted">
          {allowExceed ? "target" : "maks"} {max}
          {over > 0 && <span className="ml-1 font-semibold text-warning-fg">+{over}</span>}
        </span>
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
          disabled={!allowExceed && value >= max}
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
