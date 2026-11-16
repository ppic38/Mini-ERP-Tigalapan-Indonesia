"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { formatDate, type WarehouseReceivableGroup } from "@/lib/mrp/derive";

const byText = (a: string, b: string) => a.localeCompare(b, "id-ID", { numeric: true });
const resiOf = (g: WarehouseReceivableGroup) => g.noResi ?? g.resiGroupId;

/** Popup "Download Excel" Penerimaan Warehouse (owner 2026-11-09): pilih resi mana saja; hasilnya SATU file dengan SATU sheet per resi (format template pengiriman).
 *  Pilihan awal = semua resi; saring lewat No MRP, vendor, atau kotak cari, lalu centang/hapus centang per resi. */
export function ResiDownloadDialog({
  groups,
  vendorName,
  onDownload,
  onClose,
  title = "Download Excel Pengiriman per Resi",
  note = "Satu file, satu sheet per nomor resi (pengiriman bernomor resi sama digabung jadi satu sheet, koli berurutan dari nomor terkecil). Kolom: No Koli, Item Name, Qty, Type, Tgl Kirim, AWB (no resi), dan ETA (tanggal kirim + 7 hari). Klik \"Pilih koli\" pada sebuah resi untuk hanya mengunduh koli yang datang.",
  extraFields,
  extraReady = true,
  showSheetCount = true,
  pickKoli = false,
}: {
  /** Opsional (owner 2026-11-16, Download PO kepala tabel): tiap resi punya tombol "Pilih koli" untuk mencentang koli mana saja dari resi itu yang ikut (resi kadang tidak datang utuh).
   *  Grup yang diberikan ke `onDownload` sudah disaring ke koli terpilih (items, koliIds, totalQty); resi yang semua kolinya dilepas tidak ikut. Tidak diisi = seperti semula. */
  pickKoli?: boolean;
  groups: WarehouseReceivableGroup[];
  vendorName: (g: WarehouseReceivableGroup) => string;
  onDownload: (selected: WarehouseReceivableGroup[]) => Promise<void>;
  onClose: () => void;
  /** Download PO memakai popup yang sama: judul, catatan, dan isian tambahan (supplier, template) diganti lewat props ini. */
  title?: string;
  note?: ReactNode;
  extraFields?: ReactNode;
  extraReady?: boolean;
  showSheetCount?: boolean;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const [mrp, setMrp] = useState("");
  const [vendor, setVendor] = useState("");
  const [search, setSearch] = useState("");
  const [off, setOff] = useState<Set<string>>(() => new Set());
  const [busy, setBusy] = useState(false);
  // Pilihan koli per resi (hanya kalau `pickKoli`): koli yang DILEPAS per resiGroupId, dan resi yang daftar kolinya sedang dibuka.
  const [koliOff, setKoliOff] = useState<Record<string, Set<string>>>({});
  const [koliOpen, setKoliOpen] = useState<Set<string>>(() => new Set());

  const koliList = (g: WarehouseReceivableGroup) => {
    const m = new Map<string, number>();
    for (const it of g.items) {
      const k = it.noKoli ?? it.deliveryKoliId;
      m.set(k, (m.get(k) ?? 0) + it.qty);
    }
    return Array.from(m.entries())
      .map(([koli, pcs]) => ({ koli, pcs }))
      .sort((a, b) => byText(a.koli, b.koli));
  };
  /** Grup yang benar-benar diunduh: item koli yang dilepas dibuang. Tanpa `pickKoli` atau tanpa koli dilepas = grup apa adanya. */
  const effective = (g: WarehouseReceivableGroup): WarehouseReceivableGroup => {
    const offSet = pickKoli ? koliOff[g.resiGroupId] : undefined;
    if (!offSet || offSet.size === 0) return g;
    const items = g.items.filter((it) => !offSet.has(it.noKoli ?? it.deliveryKoliId));
    const keep = new Set(items.map((it) => it.deliveryKoliId));
    return { ...g, items, koliIds: g.koliIds.filter((id) => keep.has(id)), totalQty: items.reduce((s, it) => s + it.qty, 0) };
  };

  const mrpIds = useMemo(() => Array.from(new Set(groups.flatMap((g) => g.mrpIds))).sort((a, b) => byText(b, a)), [groups]);
  const vendors = useMemo(() => Array.from(new Set(groups.map(vendorName))).sort(byText), [groups, vendorName]);
  const q = search.trim().toLowerCase();
  const inScope = useMemo(
    () => groups.filter((g) => (!mrp || g.mrpIds.includes(mrp)) && (!vendor || vendorName(g) === vendor)),
    [groups, mrp, vendor, vendorName]
  );
  const visible = useMemo(
    () => inScope.filter((g) => !q || [resiOf(g), g.noKoli, g.ekspedisi, g.mrpIds.join(" ")].join(" ").toLowerCase().includes(q)),
    [inScope, q]
  );
  // Resi yang dicentang, dengan item koli yang dilepas sudah dibuang (pickKoli); resi yang semua kolinya dilepas tidak ikut.
  const selected = inScope
    .filter((g) => !off.has(g.resiGroupId))
    .map(effective)
    .filter((g) => !(pickKoli && (koliOff[g.resiGroupId]?.size ?? 0) > 0 && g.items.length === 0));
  const allVisible = visible.length > 0 && visible.every((g) => !off.has(g.resiGroupId));
  const totals = {
    // Resi bernomor sama digabung jadi satu sheet, jadi jumlah sheet = jumlah nomor resi yang berbeda.
    sheets: new Set(selected.map((g) => (resiOf(g) ?? "").trim().toLowerCase() || g.resiGroupId)).size,
    koli: selected.reduce((s, g) => s + g.koliIds.length, 0),
    pcs: selected.reduce((s, g) => s + g.totalQty, 0),
  };

  /** Lepas/pasang satu koli dari satu resi; memasang koli pada resi yang belum dicentang mencentang resinya, melepas koli terakhir melepas centang resinya. */
  function toggleKoli(g: WarehouseReceivableGroup, koli: string) {
    const cur = new Set(koliOff[g.resiGroupId] ?? []);
    if (cur.has(koli)) cur.delete(koli);
    else cur.add(koli);
    setKoliOff({ ...koliOff, [g.resiGroupId]: cur });
    const nextOff = new Set(off);
    if (cur.size >= koliList(g).length) nextOff.add(g.resiGroupId);
    else nextOff.delete(g.resiGroupId);
    setOff(nextOff);
  }
  function setAllKoli(g: WarehouseReceivableGroup, on: boolean) {
    setKoliOff({ ...koliOff, [g.resiGroupId]: on ? new Set() : new Set(koliList(g).map((k) => k.koli)) });
    const nextOff = new Set(off);
    if (on) nextOff.delete(g.resiGroupId);
    else nextOff.add(g.resiGroupId);
    setOff(nextOff);
  }

  async function download() {
    if (selected.length === 0) return;
    setBusy(true);
    try {
      await onDownload(selected);
      onClose();
    } finally {
      setBusy(false);
    }
  }

  const label = "block font-sans text-[11px] font-medium uppercase tracking-wider text-text-muted";
  const sel = "mt-1 w-full rounded-md border border-[#DDE4EB] px-[11px] py-[9px] font-sans text-[12.5px] font-medium text-text-primary";
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0B131B]/45 p-4" onClick={onClose}>
      <div className="flex max-h-[90vh] w-full max-w-[520px] flex-col overflow-hidden rounded-[9px] bg-surface-card shadow-[0_12px_32px_rgba(11,19,27,.28)]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2.5 bg-info-bg px-5 py-3">
          <span className="h-2 w-2 rounded-full bg-accent-blue" />
          <span className="font-sans text-xs font-semibold text-info-fg">{title}</span>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {extraFields && <div className="mb-4 flex flex-col gap-3 border-b border-[#EEF1F4] pb-4">{extraFields}</div>}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={label}>No. MRP</label>
              <select
                value={mrp}
                onChange={(e) => {
                  setMrp(e.target.value);
                  setOff(new Set());
                }}
                className={sel}
              >
                <option value="">Semua MRP</option>
                {mrpIds.map((id) => (
                  <option key={id} value={id}>
                    {id}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={label}>Vendor produksi</label>
              <select
                value={vendor}
                onChange={(e) => {
                  setVendor(e.target.value);
                  setOff(new Set());
                }}
                className={sel}
              >
                <option value="">Semua vendor</option>
                {vendors.map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="mt-4 flex items-center justify-between">
            <span className={label}>No. resi</span>
            <span className="font-sans text-[10.5px] text-text-muted">
              {selected.length} dari {inScope.length} dipilih
            </span>
          </div>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Cari no resi, no koli, ekspedisi…"
            className="mt-1.5 w-full rounded-md border border-[#DDE4EB] px-[11px] py-[7px] font-sans text-[12px] text-text-primary"
          />
          <div className="mt-1.5 rounded-md border border-[#DDE4EB]">
            <label className="flex cursor-pointer items-center gap-2 border-b border-[#EEF1F4] bg-[#F7F9FB] px-3 py-2">
              <Checkbox
                checked={allVisible}
                onChange={() => {
                  const next = new Set(off);
                  const nextKoliOff = { ...koliOff };
                  for (const g of visible) {
                    if (allVisible) next.add(g.resiGroupId);
                    else {
                      next.delete(g.resiGroupId);
                      delete nextKoliOff[g.resiGroupId]; // dicentang lagi = seluruh koli resi itu ikut
                    }
                  }
                  setOff(next);
                  setKoliOff(nextKoliOff);
                }}
              />
              <span className="font-sans text-[12px] font-semibold text-text-primary">{q ? "Semua hasil pencarian" : "Semua resi"}</span>
            </label>
            <div className="max-h-64 overflow-y-auto">
              {visible.map((g) => {
                const kl = pickKoli ? koliList(g) : [];
                const offKoli = koliOff[g.resiGroupId] ?? new Set<string>();
                const partial = pickKoli && offKoli.size > 0 && offKoli.size < kl.length;
                const open = koliOpen.has(g.resiGroupId);
                return (
                  <div key={g.resiGroupId} className="border-b border-[#EEF1F4] last:border-b-0">
                    <label className="flex cursor-pointer items-center gap-2 px-3 py-2 hover:bg-[#FAFBFC]">
                      <Checkbox
                        checked={!off.has(g.resiGroupId)}
                        onChange={() => {
                          const next = new Set(off);
                          if (next.has(g.resiGroupId)) {
                            next.delete(g.resiGroupId);
                            setKoliOff({ ...koliOff, [g.resiGroupId]: new Set() }); // dicentang lagi = seluruh koli resi itu ikut
                          } else next.add(g.resiGroupId);
                          setOff(next);
                        }}
                      />
                      <span className="min-w-0 flex-1 font-sans text-[12px] font-medium text-[#31414F]">
                        <span className="font-mono">{resiOf(g)}</span>
                        <span className="text-text-muted">
                          {" "}
                          · {g.mrpIds.join(", ")} · {vendorName(g)} · kirim {formatDate(g.deliveredAt)}
                        </span>
                      </span>
                      <span className="flex-none font-mono text-[11px] text-text-muted">{partial ? `${kl.length - offKoli.size}/${kl.length}` : g.koliIds.length} koli</span>
                      {pickKoli && kl.length > 0 && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.preventDefault();
                            const next = new Set(koliOpen);
                            if (next.has(g.resiGroupId)) next.delete(g.resiGroupId);
                            else next.add(g.resiGroupId);
                            setKoliOpen(next);
                          }}
                          className="flex-none rounded border border-[#DDE4EB] bg-white px-2 py-0.5 font-sans text-[10.5px] font-semibold text-accent-blue hover:bg-[#F7F9FB]"
                        >
                          {open ? "Tutup" : "Pilih koli"}
                        </button>
                      )}
                    </label>
                    {pickKoli && open && (
                      <div className="border-t border-[#EEF1F4] bg-[#FAFBFC] px-3 py-1.5 pl-9">
                        <label className="flex cursor-pointer items-center gap-2 py-1">
                          <Checkbox checked={offKoli.size === 0} onChange={() => setAllKoli(g, offKoli.size > 0)} />
                          <span className="font-sans text-[11.5px] font-semibold text-text-primary">Seluruh koli resi ini</span>
                        </label>
                        <div className="grid grid-cols-2 gap-x-3">
                          {kl.map((k) => (
                            <label key={k.koli} className="flex cursor-pointer items-center gap-2 py-1">
                              <Checkbox checked={!offKoli.has(k.koli)} onChange={() => toggleKoli(g, k.koli)} />
                              <span className="min-w-0 flex-1 font-sans text-[11.5px] text-[#31414F]">Koli {k.koli}</span>
                              <span className="flex-none font-mono text-[10.5px] text-text-muted">{k.pcs.toLocaleString("id-ID")} pcs</span>
                            </label>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
              {visible.length === 0 && <div className="px-3 py-4 text-center font-sans text-[11.5px] text-text-muted">Tidak ada resi yang cocok.</div>}
            </div>
          </div>
          <p className="mt-2 font-sans text-[10.5px] text-text-muted">{note}</p>
        </div>
        <div className="flex items-center justify-between gap-2 border-t border-[#EEF1F4] px-5 py-3">
          <span className="font-sans text-[11px] text-text-muted">
            {showSheetCount ? `${totals.sheets} sheet · ` : `${selected.length} resi · `}{totals.koli} koli · {totals.pcs.toLocaleString("id-ID")} pcs
          </span>
          <div className="flex gap-2">
            <Button onClick={onClose} variant="ghost" size="md">
              Batal
            </Button>
            <Button onClick={() => void download()} variant="primary" size="md" disabled={busy || selected.length === 0 || !extraReady}>
              {busy ? "Menyiapkan…" : "Download"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
