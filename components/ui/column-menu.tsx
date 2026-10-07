"use client";

import { useState } from "react";

/** Menu "⊞ Kolom" (tampil/sembunyikan kolom) -- tampilan sama dengan menu Kolom di DataTable (components/mrp/data-table.tsx), tapi
 *  untuk tabel grid buatan sendiri. Pilihan disimpan di localStorage (per `storageKey`) supaya diingat antar kunjungan. */
export function useColumnVisibility(storageKey: string, defaults: string[]): [Set<string>, (key: string) => void] {
  const [visible, setVisible] = useState<Set<string>>(() => {
    try {
      const raw = typeof window !== "undefined" ? window.localStorage.getItem(storageKey) : null;
      if (raw) {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr)) return new Set<string>(arr.filter((x) => typeof x === "string"));
      }
    } catch {
      /* abaikan -- pakai default */
    }
    return new Set(defaults);
  });
  function toggle(key: string) {
    setVisible((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      try {
        window.localStorage.setItem(storageKey, JSON.stringify(Array.from(next)));
      } catch {
        /* abaikan */
      }
      return next;
    });
  }
  return [visible, toggle];
}

export function ColumnMenu({ columns, visible, onToggle }: { columns: { key: string; label: string }[]; visible: Set<string>; onToggle: (key: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen((v) => !v)} className="rounded-md border border-[#CBD5DF] bg-white px-2.5 py-[5px] font-sans text-[11px] font-semibold text-action-primary">
        ⊞ Kolom
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-[110%] z-20 max-h-72 w-52 overflow-y-auto rounded-md border border-border-subtle bg-surface-card p-2 shadow-[0_8px_20px_rgba(11,19,27,.15)]">
            {columns.map((c) => (
              <label key={c.key} className="flex items-center gap-2 rounded px-2 py-1.5 font-sans text-xs text-[#31414F] hover:bg-[#F7F9FB]">
                <input type="checkbox" checked={visible.has(c.key)} onChange={() => onToggle(c.key)} className="h-3.5 w-3.5 accent-accent-blue" />
                {c.label}
              </label>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
