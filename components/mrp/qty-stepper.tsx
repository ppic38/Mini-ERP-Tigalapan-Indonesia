"use client";

/** Isian qty kirim dengan tombol −1, +1, dan Maks (permintaan owner 2026-10-24). Nilai SELALU dipotong ke 0..max seketika
 *  (angka yang diketik/di-paste melebihi `max` langsung berubah jadi `max`), dan hanya angka yang diterima. Beda dari NumberInput,
 *  yang selama fokus menampilkan teks mentah sehingga angka berlebih masih kelihatan sampai field ditinggalkan. */
export function QtyStepper({
  value,
  max,
  onChange,
  disabled = false,
  placeholder = "0",
  label,
}: {
  value: number;
  max: number;
  onChange: (v: number) => void;
  disabled?: boolean;
  placeholder?: string;
  /** Untuk pembaca layar, mis. "Burgundy Pendek M". */
  label?: string;
}) {
  const hi = Math.max(0, Math.floor(max));
  const clamp = (n: number) => Math.max(0, Math.min(hi, Math.floor(Number.isFinite(n) ? n : 0)));
  const v = clamp(value);
  const btn = "w-7 flex-none text-[13px] leading-none text-text-muted hover:bg-[#F2F4F7] disabled:cursor-not-allowed disabled:opacity-40";
  return (
    <div className="flex items-center justify-end gap-1.5">
      <div className={"flex items-stretch overflow-hidden rounded-md border border-[#DDE4EB] " + (disabled ? "bg-[#F7F9FB]" : "bg-white")}>
        <button type="button" onClick={() => onChange(clamp(v - 1))} disabled={disabled || v <= 0} aria-label={`Kurangi 1${label ? " " + label : ""}`} className={btn + " border-r border-[#DDE4EB]"}>
          −
        </button>
        <input
          value={v > 0 ? String(v) : ""}
          onChange={(e) => {
            const digits = e.target.value.replace(/[^0-9]/g, "");
            onChange(clamp(digits ? parseInt(digits, 10) : 0));
          }}
          inputMode="numeric"
          placeholder={placeholder}
          disabled={disabled}
          aria-label={label ? `Qty ${label}` : "Qty"}
          className="w-[58px] min-w-0 bg-transparent px-1 py-1.5 text-center font-mono text-[13px] font-semibold outline-none disabled:cursor-not-allowed disabled:text-text-muted"
        />
        <button type="button" onClick={() => onChange(clamp(v + 1))} disabled={disabled || v >= hi} aria-label={`Tambah 1${label ? " " + label : ""}`} className={btn + " border-l border-[#DDE4EB]"}>
          +
        </button>
      </div>
      <button
        type="button"
        onClick={() => onChange(hi)}
        disabled={disabled || hi <= 0 || v >= hi}
        title={`Isi sebesar sisa yang bisa dikirim (${hi})`}
        className="rounded-md border border-[#CBD5DF] bg-white px-2 py-1.5 font-sans text-[10.5px] font-semibold text-action-primary hover:bg-[#F2F4F7] disabled:cursor-not-allowed disabled:opacity-40"
      >
        Maks
      </button>
    </div>
  );
}
