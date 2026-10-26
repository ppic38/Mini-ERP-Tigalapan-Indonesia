"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";

/** Filter dropdown dengan pilihan GANDA (centang). Kosong = semua. Kotak cari muncul otomatis kalau pilihannya banyak. */
export function MultiSelectFilter({
  label,
  options,
  value,
  onChange,
  labelOf,
}: {
  label: string;
  options: string[];
  value: string[];
  onChange: (v: string[]) => void;
  /** Teks tampilan untuk satu nilai (mis. "2026-10" menjadi "Oktober 2026"); nilai aslinya tetap yang disimpan. */
  labelOf?: (v: string) => string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const text = (v: string) => (labelOf ? labelOf(v) : v);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const shown = options.filter((o) => text(o).toLowerCase().includes(query.trim().toLowerCase()));
  const selected = new Set(value);
  const summary = value.length === 0 ? `${label}: Semua` : value.length === 1 ? `${label}: ${text(value[0])}` : `${label}: ${value.length} dipilih`;

  function toggle(o: string) {
    const next = new Set(selected);
    if (next.has(o)) next.delete(o);
    else next.add(o);
    onChange(options.filter((x) => next.has(x)));
  }

  return (
    <div
      ref={ref}
      className="relative"
      onKeyDown={(e) => {
        if (e.key === "Escape" && open) {
          e.preventDefault();
          e.stopPropagation();
          setOpen(false);
        }
      }}
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={
          "flex max-w-[260px] items-center gap-1.5 rounded-md border bg-white px-2.5 py-[6px] font-sans text-[11.5px] font-medium " +
          (value.length > 0 ? "border-accent-blue text-action-primary" : "border-border-subtle text-[#31414F]")
        }
      >
        <span className="truncate">{summary}</span>
        <ChevronDown size={13} className="flex-none text-text-muted" />
      </button>
      {open && (
        <div className="absolute left-0 top-full z-30 mt-1 w-[270px] overflow-hidden rounded-md border border-border-subtle bg-white shadow-[0_8px_24px_rgba(11,19,27,.16)]">
          {options.length > 8 && (
            <div className="border-b border-[#EEF1F4] p-1.5">
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Cari…"
                className="w-full rounded border border-border-subtle px-2 py-1 font-sans text-[11.5px] outline-none"
              />
            </div>
          )}
          <div className="flex items-center justify-between border-b border-[#EEF1F4] px-2.5 py-1.5 font-sans text-[10.5px] font-semibold text-action-primary">
            <button type="button" onClick={() => onChange(Array.from(new Set([...value, ...shown])).filter((x) => options.includes(x)))} className="hover:underline">
              Pilih semua{query.trim() ? " hasil" : ""}
            </button>
            <button type="button" onClick={() => onChange([])} className="hover:underline">
              Hapus pilihan
            </button>
          </div>
          <div role="listbox" aria-multiselectable="true" className="max-h-[260px] overflow-y-auto py-1">
            {shown.length === 0 && <div className="px-3 py-2 font-sans text-[11.5px] text-text-muted">Tidak ada pilihan.</div>}
            {shown.map((o) => {
              const on = selected.has(o);
              return (
                <button
                  key={o}
                  type="button"
                  role="option"
                  aria-selected={on}
                  onClick={() => toggle(o)}
                  className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left font-sans text-[11.5px] text-[#31414F] hover:bg-[#F7F9FB]"
                >
                  <span className={"flex h-3.5 w-3.5 flex-none items-center justify-center rounded border " + (on ? "border-accent-blue bg-accent-blue text-white" : "border-[#B8C2CC] bg-white")}>
                    {on && <Check size={10} strokeWidth={3} />}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{text(o)}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
