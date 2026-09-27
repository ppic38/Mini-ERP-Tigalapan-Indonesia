"use client";

import { useMemo, useState } from "react";
import { Check, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { VENDOR_MODULE_TREE } from "@/lib/mrp/vendorPages";

/** Picker izin akses portal vendor -- modul di kiri (badge "x/y" sub-izin terpilih), panel
 *  sub-izin di kanan untuk modul yang punya anak (mis. Produksi -> Cutting/FG/Reject/Rework/
 *  Final), pencarian, Select All/Deselect All (owner 2026-09-28: tampilan seperti contoh "Edit
 *  Peran" yang dikirim). Modul TANPA anak = 1 baris toggle langsung di kiri (klik = on/off).
 *
 *  `value` disimpan APA ADANYA (key modul bare ATAU key sub-izin `modul:TAB`) -- lihat
 *  lib/mrp/vendorPages.ts untuk makna tiap bentuk key & kompatibilitas akun lama. */
export function VendorPermissionPicker({ value, onChange }: { value: string[]; onChange: (next: string[]) => void }) {
  const [search, setSearch] = useState("");
  // Panel kanan HANYA muncul setelah modul yang punya sub-izin diklik (owner 2026-09-28: "tunggu
  // diklik baru tampil apa isinya") -- tidak ada modul terpilih otomatis saat picker dibuka.
  const [activeModule, setActiveModule] = useState<string | null>(null);

  const q = search.trim().toLowerCase();
  const filteredModules = useMemo(() => {
    if (!q) return VENDOR_MODULE_TREE;
    return VENDOR_MODULE_TREE.filter((m) => m.label.toLowerCase().includes(q) || m.permissions?.some((p) => p.label.toLowerCase().includes(q)));
  }, [q]);

  const totalSlots = VENDOR_MODULE_TREE.reduce((s, m) => s + (m.permissions?.length ?? 1), 0);
  const selectedCount = useMemo(() => {
    let n = 0;
    for (const m of VENDOR_MODULE_TREE) {
      if (!m.permissions) {
        if (value.includes(m.key)) n++;
        continue;
      }
      n += value.includes(m.key) ? m.permissions.length : m.permissions.filter((p) => value.includes(p.key)).length;
    }
    return n;
  }, [value]);

  function toggleLeaf(key: string) {
    onChange(value.includes(key) ? value.filter((v) => v !== key) : [...value, key]);
  }

  function moduleSelectedCount(moduleKey: string): { selected: number; total: number } {
    const m = VENDOR_MODULE_TREE.find((mm) => mm.key === moduleKey)!;
    if (!m.permissions) return { selected: value.includes(m.key) ? 1 : 0, total: 1 };
    const selected = value.includes(m.key) ? m.permissions.length : m.permissions.filter((p) => value.includes(p.key)).length;
    return { selected, total: m.permissions.length };
  }

  const activeMod = VENDOR_MODULE_TREE.find((m) => m.key === activeModule);
  // Modul bare-key (akun lama "akses penuh") DINORMALISASI ke daftar sub-key eksplisit begitu
  // panel ini dibuka -- supaya toggle individual di kanan langsung akurat (bukan tetap "kosong"
  // padahal sebenarnya penuh lewat key bare).
  const activeModExpanded = activeMod?.permissions && value.includes(activeMod.key) ? activeMod.permissions.map((p) => p.key) : [];

  function selectAllInModule(moduleKey: string) {
    const m = VENDOR_MODULE_TREE.find((mm) => mm.key === moduleKey);
    if (!m?.permissions) return;
    const rest = value.filter((v) => v !== m.key && !m.permissions!.some((p) => p.key === v));
    onChange([...rest, ...m.permissions.map((p) => p.key)]);
  }
  function deselectAllInModule(moduleKey: string) {
    const m = VENDOR_MODULE_TREE.find((mm) => mm.key === moduleKey);
    if (!m?.permissions) return;
    onChange(value.filter((v) => v !== m.key && !m.permissions!.some((p) => p.key === v)));
  }

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center gap-2 rounded-md border border-[#DDE4EB] px-2.5 py-1.5">
        <Search size={13} className="text-text-muted" />
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Cari halaman/izin…" className="flex-1 border-none bg-transparent font-sans text-[12px] outline-none" />
      </div>
      <div className="flex items-center justify-between font-sans text-[11.5px]">
        <span className="flex items-center gap-1.5 font-semibold text-action-primary">
          <Check size={13} />
          {selectedCount} dari {totalSlots} izin dipilih
        </span>
        <button type="button" onClick={() => onChange([])} className="font-semibold text-danger-fg underline">
          Clear All
        </button>
      </div>

      <div className="grid grid-cols-[1.1fr_1.4fr] gap-2 overflow-hidden rounded-md border border-[#E4E9EE]" style={{ minHeight: 220 }}>
        <div className="max-h-[320px] overflow-y-auto border-r border-[#E4E9EE] bg-[#FBFCFD]">
          {filteredModules.map((m) => {
            const { selected, total } = moduleSelectedCount(m.key);
            const isLeaf = !m.permissions;
            const isActive = m.key === activeModule;
            return (
              <button
                key={m.key}
                type="button"
                onClick={() => (isLeaf ? toggleLeaf(m.key) : setActiveModule(m.key))}
                className={cn(
                  "flex w-full items-center gap-2 border-b border-[#F1F4F7] px-3 py-2 text-left font-sans text-[12px] transition-colors",
                  isActive ? "bg-action-primary text-white" : "text-[#31414F] hover:bg-white"
                )}
              >
                {isLeaf && (
                  <input type="checkbox" readOnly checked={selected > 0} className="h-3.5 w-3.5 flex-shrink-0" />
                )}
                <span className="flex-1 truncate font-medium">{m.label}</span>
                <span
                  className={cn(
                    "flex-shrink-0 rounded-full px-1.5 py-px font-mono text-[10px] font-semibold",
                    selected === total ? (isActive ? "bg-white/20 text-white" : "bg-success-bg text-success-fg") : selected > 0 ? (isActive ? "bg-white/20 text-white" : "bg-warning-bg text-warning-fg") : isActive ? "bg-white/20 text-white" : "bg-[#EEF1F4] text-text-muted"
                  )}
                >
                  {selected}/{total}
                </span>
              </button>
            );
          })}
          {filteredModules.length === 0 && <div className="px-3 py-6 text-center font-sans text-[11.5px] text-text-muted">Tidak ada yang cocok.</div>}
        </div>

        <div className="max-h-[320px] overflow-y-auto p-3">
          {!activeMod || !activeMod.permissions ? (
            <div className="flex h-full items-center justify-center font-sans text-[11.5px] text-text-muted">Pilih modul di sebelah kiri untuk melihat rincian sub-izinnya.</div>
          ) : (
            <>
              <div className="mb-2 flex items-center justify-between">
                <div className="font-sans text-[12.5px] font-semibold text-text-primary">{activeMod.label}</div>
                <div className="flex gap-1.5">
                  <button type="button" onClick={() => selectAllInModule(activeMod.key)} className="rounded-md border border-[#CBD5DF] px-2 py-[3px] font-sans text-[10.5px] font-semibold text-action-primary">
                    Select All
                  </button>
                  <button type="button" onClick={() => deselectAllInModule(activeMod.key)} className="rounded-md border border-[#CBD5DF] px-2 py-[3px] font-sans text-[10.5px] font-semibold text-danger-fg">
                    Deselect All
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                {activeMod.permissions
                  .filter((p) => !q || p.label.toLowerCase().includes(q) || activeMod.label.toLowerCase().includes(q))
                  .map((p) => {
                    const checked = value.includes(activeMod.key) || value.includes(p.key) || activeModExpanded.includes(p.key);
                    return (
                      <label
                        key={p.key}
                        className={cn(
                          "flex items-center gap-1.5 rounded-md border px-2 py-1.5 font-sans text-[11.5px]",
                          checked ? "border-accent-blue bg-info-bg text-action-primary" : "border-[#E4E9EE] text-[#31414F]"
                        )}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => {
                            // Kalau modul lagi "penuh" lewat key bare (akun lama), lepas dulu bare-nya &
                            // ganti jadi daftar eksplisit sebelum menghapus 1 sub-izin yang di-uncheck.
                            if (value.includes(activeMod.key)) {
                              const rest = activeMod.permissions!.filter((pp) => pp.key !== p.key).map((pp) => pp.key);
                              onChange([...value.filter((v) => v !== activeMod.key), ...rest]);
                            } else {
                              toggleLeaf(p.key);
                            }
                          }}
                          className="h-3.5 w-3.5"
                        />
                        {p.label}
                      </label>
                    );
                  })}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
