"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "lucide-react";

/** Filter dropdown pilihan TUNGGAL: tombol ringkas dengan daftar yang terbuka tepat di bawahnya (naik ke atas kalau di bawah tidak muat). Daftar dirender di body
 *  (portal, posisi tetap) supaya tidak terpotong tabel atau baris yang bisa digulir. Kotak cari muncul otomatis kalau pilihannya banyak. */
export function SingleSelectFilter({
  label,
  allLabel,
  options,
  value,
  onChange,
  labelOf,
}: {
  /** Awalan tombol saat ada pilihan, mis. "Vendor". */
  label: string;
  /** Teks pilihan "semua", mis. "Semua vendor (6)". */
  allLabel: string;
  options: string[];
  value: string;
  onChange: (v: string) => void;
  /** Teks tampilan untuk satu pilihan (nilai aslinya tetap yang disimpan). */
  labelOf?: (v: string) => string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number; maxHeight: number }>({ left: 0, maxHeight: 300 });
  const btnRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const text = (v: string) => (labelOf ? labelOf(v) : v);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (listRef.current?.contains(t) || btnRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
    };
    const close = (e: Event) => {
      // Menggulir isi daftar sendiri tidak menutup.
      if (e.target instanceof Node && listRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [open]);

  function toggleOpen() {
    if (!open && btnRef.current) {
      const r = btnRef.current.getBoundingClientRect();
      const width = 270;
      const left = Math.min(Math.max(8, r.left), window.innerWidth - width - 8);
      const below = window.innerHeight - r.bottom - 12;
      const above = r.top - 12;
      // Turun ke bawah kalau muat sedikitnya 220px; kalau tidak, naik ke atas dengan tinggi mengikuti ruang yang ada.
      if (below >= 220 || below >= above) setPos({ left, top: r.bottom + 4, maxHeight: Math.min(340, below) });
      else setPos({ left, bottom: window.innerHeight - r.top + 4, maxHeight: Math.min(340, above) });
      setQuery("");
    }
    setOpen((o) => !o);
  }

  const shown = options.filter((o) => text(o).toLowerCase().includes(query.trim().toLowerCase()));
  const summary = value ? `${label}: ${text(value)}` : allLabel;

  function choose(v: string) {
    onChange(v);
    setOpen(false);
  }

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={toggleOpen}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={
          "flex max-w-[240px] items-center gap-1.5 rounded-md border bg-white px-2.5 py-[6px] font-sans text-[11px] font-medium " +
          (value ? "border-accent-blue text-action-primary" : "border-border-subtle text-[#31414F]")
        }
      >
        <span className="truncate">{summary}</span>
        <ChevronDown size={13} className="flex-none text-text-muted" />
      </button>
      {open &&
        createPortal(
          <div
            ref={listRef}
            style={{ position: "fixed", left: pos.left, top: pos.top, bottom: pos.bottom, width: 270, maxHeight: pos.maxHeight }}
            className="z-[80] flex flex-col overflow-hidden rounded-md border border-border-subtle bg-white shadow-[0_8px_24px_rgba(11,19,27,.16)]"
          >
            {options.length > 8 && (
              <div className="flex-none border-b border-[#EEF1F4] p-1.5">
                <input
                  autoFocus
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Cari…"
                  className="w-full rounded border border-border-subtle px-2 py-1 font-sans text-[11.5px] outline-none"
                />
              </div>
            )}
            <div role="listbox" className="min-h-0 flex-1 overflow-y-auto py-1">
              <button
                type="button"
                role="option"
                aria-selected={!value}
                onClick={() => choose("")}
                className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left font-sans text-[11.5px] font-semibold text-action-primary hover:bg-[#F7F9FB]"
              >
                <span className="flex h-3.5 w-3.5 flex-none items-center justify-center">{!value && <Check size={12} strokeWidth={3} />}</span>
                <span className="min-w-0 flex-1 truncate">{allLabel}</span>
              </button>
              {shown.length === 0 && <div className="px-3 py-2 font-sans text-[11.5px] text-text-muted">Tidak ada pilihan.</div>}
              {shown.map((o) => {
                const on = o === value;
                return (
                  <button
                    key={o}
                    type="button"
                    role="option"
                    aria-selected={on}
                    onClick={() => choose(o)}
                    className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left font-sans text-[11.5px] text-[#31414F] hover:bg-[#F7F9FB]"
                  >
                    <span className="flex h-3.5 w-3.5 flex-none items-center justify-center text-action-primary">{on && <Check size={12} strokeWidth={3} />}</span>
                    <span className="min-w-0 flex-1 truncate">{text(o)}</span>
                  </button>
                );
              })}
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
