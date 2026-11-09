"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { alertDialog } from "@/components/ui/confirm-dialog";
import { DataTable, type ColumnDef } from "@/components/mrp/data-table";
import { MultiSelectFilter } from "@/components/mrp/multi-select-filter";
import { useMrpStore } from "@/lib/mrp/store";
import { formatDate, formatPcs, localDateString } from "@/lib/mrp/derive";
import { VENDOR_PRODUKSI } from "@/lib/mrp/seed";
import { getWosKoliStatusAction, type WosKoliStatusResult } from "@/lib/mrp/wosStatusActions";
import { WOS_STATUS_LABEL, type WosStatusCode } from "@/lib/mrp/wosStatusMap";
import { buildItemTracking, itemWithBreakdown, koliRowsForItem, lenganShort, type ItemTrackRow } from "@/lib/mrp/itemTracking";
import { dayKey, ltTiba, parseLooseDay, plusDays } from "@/lib/mrp/itemEstimates";
import { exportTrackingExcel } from "@/lib/mrp/exportTrackingExcel";

const vendorLabel = (id: string) => (id ? VENDOR_PRODUKSI[id]?.name ?? id : "Belum dialokasikan");
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const selectCls = "rounded-md border border-border-subtle bg-white px-2.5 py-[6px] font-sans text-[11.5px] font-medium text-[#31414F]";
const num = "px-3 py-2 text-right font-mono";
const dateText = (iso?: string) => (iso ? formatDate(iso) : "-");
/** Tanggal estimasi; merah kalau sudah lewat dari hari ini tetapi qty-nya masih menunggu tahap itu. */
function EstDate({ iso, today }: { iso?: string; today: string }) {
  if (!iso) return <span className="text-text-muted">-</span>;
  return <span className={iso < today ? "font-semibold text-[#B91C1C]" : ""} title={iso < today ? "Sudah lewat dari estimasi" : undefined}>{formatDate(iso)}</span>;
}
function shipRange(dates: string[]) {
  if (dates.length === 0) return "-";
  if (dates.length === 1) return formatDate(dates[0]);
  return `${formatDate(dates[0])} – ${formatDate(dates[dates.length - 1])} (${dates.length}×)`;
}

function Stat({ label, value, sub }: { label: string; value: number; sub?: string }) {
  return (
    <div className="relative min-w-0 overflow-hidden rounded-xl border border-border-subtle bg-surface-card px-5 pb-4 pt-5">
      <div className="absolute inset-x-0 top-0 h-[3px] bg-[#38BDF8]" />
      <div className="truncate font-mono text-[10.5px] uppercase tracking-[0.14em] text-text-muted">{label}</div>
      <div className="mt-2 font-sans text-[26px] font-bold leading-none tracking-tight text-text-primary">{formatPcs(value)}</div>
      <div className="mt-2 truncate font-mono text-[10.5px] text-text-muted">{sub ?? "pcs"}</div>
    </div>
  );
}

/** Ringkasan tahapan satu set item: tujuh kartu berurutan dari rencana sampai diterima DC (kartu dengan garis aksen di atas). Angka kartu = qty POSISI SAAT INI:
 *  barang hanya dihitung di satu tahap (cutting 100 dan FG 90 = 10 di Cutting + 90 di Finish Good); angka kumulatifnya ada di keterangan kartu. */
function StageCards({ rows }: { rows: ItemTrackRow[] }) {
  const t = (k: "target" | "cutting" | "fg" | "reject" | "diKoli" | "dikirim" | "diterima" | "belumCutting" | "cuttingWip" | "fgWip" | "perjalanan" | "tibaDc") => sum(rows.map((r) => r[k]));
  const mrps = new Set(rows.flatMap((r) => r.mrpIds)).size;
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-4 gap-3 max-lg:grid-cols-2 max-sm:grid-cols-1">
        <Stat label="Target MRP" value={t("target")} sub={`pcs · ${rows.length} item · ${mrps} MRP`} />
        <Stat label="Di cutting" value={t("cuttingWip")} sub={`pcs · belum cutting: ${formatPcs(t("belumCutting"))} · total dicutting: ${formatPcs(t("cutting"))}`} />
        <Stat label="Finish Good" value={t("fgWip")} sub={`pcs · belum masuk koli · total FG: ${formatPcs(t("fg"))}`} />
        <Stat label="Reject" value={t("reject")} />
      </div>
      <div className="grid grid-cols-3 gap-3 max-lg:grid-cols-1">
        <Stat label="Masuk koli, belum dikirim" value={t("diKoli")} />
        <Stat label="Dikirim, belum tiba" value={t("perjalanan")} sub={`pcs · total dikirim vendor: ${formatPcs(t("dikirim"))}`} />
        <Stat label="Diterima DC" value={t("diterima")} sub={t("tibaDc") > 0 ? `pcs · tiba, belum validasi: ${formatPcs(t("tibaDc"))}` : "pcs"} />
      </div>
    </div>
  );
}

/** Kotak cari item dengan daftar pilihan: muncul saat diklik dan menyempit saat mengetik; item dipilih lewat klik atau panah + Enter. */
function ItemSearch({ items, query, onQuery, picked, onPick }: { items: ItemTrackRow[]; query: string; onQuery: (v: string) => void; picked: string[]; onPick: (name: string) => void }) {
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const listId = useId();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const needle = query.trim().toLowerCase();
  const matches = items.filter((i) => !picked.includes(i.itemName) && (!needle || i.itemName.toLowerCase().includes(needle))).slice(0, 60);
  const active = Math.min(hi, Math.max(0, matches.length - 1));

  function choose(name: string) {
    onPick(name);
    onQuery("");
    setHi(0);
    setOpen(false);
  }

  return (
    <div ref={ref} className="relative min-w-[260px] max-w-[380px] flex-1">
      <input
        value={query}
        onChange={(e) => {
          onQuery(e.target.value);
          setHi(0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setOpen(true);
            setHi((h) => Math.min(h + 1, matches.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setHi((h) => Math.max(h - 1, 0));
          } else if (e.key === "Enter" && open && matches[active]) {
            e.preventDefault();
            choose(matches[active].itemName);
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
        placeholder="Cari item, mis. HITAM 24S PDK L"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        className={selectCls + " w-full font-normal"}
      />
      {open && (
        <div id={listId} role="listbox" className="absolute left-0 right-0 top-full z-30 mt-1 max-h-[320px] overflow-y-auto rounded-md border border-border-subtle bg-white py-1 shadow-[0_8px_24px_rgba(11,19,27,.16)]">
          {matches.length === 0 && <div className="px-3 py-2 font-sans text-[11.5px] text-text-muted">Tidak ada item yang cocok.</div>}
          {matches.map((i, idx) => (
            <button
              key={i.key}
              type="button"
              role="option"
              aria-selected={idx === active}
              onMouseEnter={() => setHi(idx)}
              onClick={() => choose(i.itemName)}
              className={"flex w-full items-center gap-3 px-3 py-1.5 text-left font-sans text-[12px] " + (idx === active ? "bg-[#F2F5F8]" : "")}
            >
              <span className="min-w-0 flex-1 truncate font-medium text-text-primary">{i.itemName}</span>
              <span className="flex-none text-[10.5px] text-text-muted">{i.kategori.join(", ") || "-"} · target {formatPcs(i.target)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const WOS_TONE: Record<WosStatusCode, string> = {
  DALAM_PERJALANAN: "text-[#1D4ED8]",
  TIBA: "text-[#B45309]",
  DITERIMA: "text-[#047857]",
  BERMASALAH: "text-[#B91C1C]",
  UNKNOWN: "text-text-muted",
};

function ItemDetailModal({ item, onClose }: { item: ItemTrackRow; onClose: () => void }) {
  const deliveryKolis = useMrpStore((s) => s.deliveryKolis);
  const warehouseReceipts = useMrpStore((s) => s.warehouseReceipts);
  const koliRows = useMemo(() => koliRowsForItem(item, deliveryKolis, warehouseReceipts), [item, deliveryKolis, warehouseReceipts]);
  // Status penerimaan gudang dari WOS (dibaca dari tab ERP_INCOMING, diisi WOS): koli yang sudah diterima di gudang WOS terlihat di sini.
  const [wos, setWos] = useState<WosKoliStatusResult | null>(null);
  const [wosError, setWosError] = useState<string | null>(null);
  const [wosBusy, setWosBusy] = useState(false);
  useEffect(() => {
    void getWosKoliStatusAction().then((res) => {
      if (res.ok) setWos(res.data);
      else setWosError(res.error);
    });
  }, []);
  async function refreshWos() {
    setWosBusy(true);
    const res = await getWosKoliStatusAction(true);
    if (res.ok) {
      setWos(res.data);
      setWosError(null);
    } else setWosError(res.error);
    setWosBusy(false);
  }
  const today = localDateString(new Date());
  const wosOf = (koliId: string) => wos?.byKoli[koliId];
  const wosReceivedQty = sum(koliRows.filter((k) => ["DITERIMA", "BERMASALAH"].includes(wosOf(k.koliId)?.code ?? "")).map((k) => k.qty));
  const wosArrivedQty = sum(koliRows.filter((k) => wosOf(k.koliId)?.code === "TIBA").map((k) => k.qty));
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0B131B]/45 p-4" onClick={onClose}>
      <div className="flex max-h-[88vh] w-full max-w-[1100px] flex-col overflow-hidden rounded-lg bg-white shadow-[0_8px_24px_rgba(11,19,27,.25)]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 border-b border-border-subtle px-5 py-3.5">
          <div>
            <div className="font-sans text-[16px] font-bold text-text-primary">{item.itemName}</div>
            <div className="mt-0.5 font-sans text-[11px] text-text-muted">
              {item.kategori.join(", ") || "-"} · {item.lengan === "PENDEK" ? "Pendek" : "Panjang"} · Ukuran {item.size} · {item.mrpIds.length} MRP
            </div>
          </div>
          <button onClick={onClose} className="rounded-md border border-[#CBD5DF] bg-white px-3 py-[6px] font-sans text-xs font-semibold text-action-primary">
            Tutup
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">
          <StageCards rows={[item]} />
          <div className="mt-4 font-sans text-[12px] font-semibold text-text-primary">Rincian per MRP dan vendor</div>
          <div className="mt-1 font-sans text-[10.5px] text-text-muted">
            Qty per posisi saat ini (tidak tumpang tindih). Tanggal awal = kejadian pertama untuk item ini; tanggal kirim = pengiriman terbaru. Estimasi tiba ada di tabel koli di bawah.
          </div>
          <div className="mt-2 overflow-x-auto rounded-md border border-[#E4E9EE]">
            <table className="w-full border-collapse font-sans text-[11.5px]">
              <thead className="bg-info-bg text-[10.5px] font-medium uppercase tracking-wider text-info-fg">
                <tr>
                  <th className="px-3 py-2 text-left">No. MRP</th>
                  <th className="px-3 py-2 text-left">Vendor</th>
                  <th className="px-3 py-2 text-left">Kategori</th>
                  <th className="px-3 py-2 text-right">Target</th>
                  <th className="px-3 py-2 text-right">Belum cutting</th>
                  <th className="px-3 py-2 text-left">Tgl GR</th>
                  <th className="px-3 py-2 text-right">Cutting</th>
                  <th className="px-3 py-2 text-left">Tgl awal cutting</th>
                  <th className="px-3 py-2 text-right">FG</th>
                  <th className="px-3 py-2 text-left">Tgl awal FG</th>
                  <th className="px-3 py-2 text-right">Reject</th>
                  <th className="px-3 py-2 text-right">Di koli</th>
                  <th className="px-3 py-2 text-left">Tgl awal di koli</th>
                  <th className="px-3 py-2 text-right">Dikirim</th>
                  <th className="px-3 py-2 text-left">Tgl kirim terakhir</th>
                  <th className="px-3 py-2 text-right">Diterima DC</th>
                </tr>
              </thead>
              <tbody>
                {item.breakdown.map((b) => (
                  <tr key={b.key} className="border-t border-[#EEF1F4]">
                    <td className="px-3 py-2 font-mono">{b.mrpId}</td>
                    <td className={"px-3 py-2 " + (b.vendorProduksi ? "" : "text-text-muted")}>{vendorLabel(b.vendorProduksi)}</td>
                    <td className="px-3 py-2 text-text-muted">{b.kategori || "-"}</td>
                    <td className={num}>{formatPcs(b.alokasi)}</td>
                    <td className={num}>{formatPcs(b.belumCutting)}</td>
                    <td className="px-3 py-2">{dateText(b.grAt)}</td>
                    <td className={num}>{formatPcs(b.cuttingWip)}</td>
                    <td className="px-3 py-2">{dateText(b.cuttingAt)}</td>
                    <td className={num}>{formatPcs(b.fgWip)}</td>
                    <td className="px-3 py-2">{dateText(b.fgFirstAt)}</td>
                    <td className={num}>{formatPcs(b.reject)}</td>
                    <td className={num}>{formatPcs(b.diKoli)}</td>
                    <td className="px-3 py-2">{dateText(b.koliFirstAt)}</td>
                    <td className={num}>{formatPcs(b.perjalanan)}</td>
                    <td className="px-3 py-2">{dateText(b.shipLastAt)}</td>
                    <td className={num}>{formatPcs(b.diterima)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t-2 border-border-subtle bg-[#F2F5F8] font-semibold">
                <tr>
                  <td className="px-3 py-2" colSpan={3}>Total</td>
                  <td className={num}>{formatPcs(item.target)}</td>
                  <td className={num}>{formatPcs(item.belumCutting)}</td>
                  <td />
                  <td className={num}>{formatPcs(item.cuttingWip)}</td>
                  <td />
                  <td className={num}>{formatPcs(item.fgWip)}</td>
                  <td />
                  <td className={num}>{formatPcs(item.reject)}</td>
                  <td className={num}>{formatPcs(item.diKoli)}</td>
                  <td />
                  <td className={num}>{formatPcs(item.perjalanan)}</td>
                  <td />
                  <td className={num}>{formatPcs(item.diterima)}</td>
                </tr>
              </tfoot>
            </table>
          </div>

          <div className="mt-5 flex flex-wrap items-center justify-between gap-2">
            <div className="font-sans text-[12px] font-semibold text-text-primary">Koli dan pengiriman item ini</div>
            <button
              onClick={() => void refreshWos()}
              disabled={wosBusy}
              className="rounded-md border border-[#CBD5DF] bg-white px-2.5 py-[4px] font-sans text-[11px] font-semibold text-action-primary disabled:opacity-50"
            >
              {wosBusy ? "Memuat…" : "Segarkan status WOS"}
            </button>
          </div>
          <div className="mt-2 overflow-x-auto rounded-md border border-[#E4E9EE]">
            <table className="w-full border-collapse font-sans text-[11.5px]">
              <thead className="bg-info-bg text-[10.5px] font-medium uppercase tracking-wider text-info-fg">
                <tr>
                  <th className="px-3 py-2 text-left">No. MRP</th>
                  <th className="px-3 py-2 text-left">Vendor</th>
                  <th className="px-3 py-2 text-left">No. Koli</th>
                  <th className="px-3 py-2 text-right">Qty item</th>
                  <th className="px-3 py-2 text-right">Berat (kg)</th>
                  <th className="px-3 py-2 text-left">Status</th>
                  <th className="px-3 py-2 text-left">Status WOS</th>
                  <th className="px-3 py-2 text-left">Ekspedisi</th>
                  <th className="px-3 py-2 text-left">No. Resi</th>
                  <th className="px-3 py-2 text-left">Tgl kirim</th>
                  <th className="px-3 py-2 text-left">Est. tiba DC</th>
                  <th className="px-3 py-2 text-left">Diterima gudang</th>
                </tr>
              </thead>
              <tbody>
                {koliRows.length === 0 && (
                  <tr>
                    <td colSpan={12} className="px-3 py-4 text-center text-text-muted">Belum ada koli yang memuat item ini.</td>
                  </tr>
                )}
                {koliRows.map((k) => (
                  <tr key={k.koliId} className="border-t border-[#EEF1F4]">
                    <td className="px-3 py-2 font-mono">{k.mrpId}</td>
                    <td className="px-3 py-2">{vendorLabel(k.vendorProduksi)}</td>
                    <td className="px-3 py-2 font-mono">{k.noKoli}</td>
                    <td className={num}>{formatPcs(k.qty)}</td>
                    <td className={num}>{k.beratKoli ? k.beratKoli : "-"}</td>
                    <td className="px-3 py-2 font-semibold">
                      {k.receivedAt ? <span className="text-[#047857]">Diterima gudang</span> : k.deliveredAt ? <span className="text-[#1D4ED8]">Dalam perjalanan</span> : <span className="text-[#B45309]">Belum dikirim</span>}
                    </td>
                    <td className="px-3 py-2 font-semibold">
                      {(() => {
                        const w = wosOf(k.koliId);
                        if (!w) return <span className="font-normal text-text-muted" title={!wos ? "Memuat status WOS" : !wos.configured ? "Integrasi WOS belum aktif" : !wos.hasStatusColumn ? "Tab ERP_INCOMING belum punya kolom status" : "Koli ini belum ada di sheet WOS"}>—</span>;
                        const label = w.code === "UNKNOWN" ? w.raw || WOS_STATUS_LABEL.UNKNOWN : WOS_STATUS_LABEL[w.code];
                        const tip = [w.raw ? `Isi sheet: ${w.raw}` : "", w.qtyDiterima != null ? `Diterima ${w.qtyDiterima} pcs` : "", w.diterimaPada ? `Pada ${w.diterimaPada}` : ""].filter(Boolean).join(" · ");
                        return (
                          <span className={WOS_TONE[w.code]} title={tip || undefined}>
                            {label}
                          </span>
                        );
                      })()}
                    </td>
                    <td className="px-3 py-2">{k.ekspedisi ?? "-"}</td>
                    <td className="px-3 py-2 font-mono">{k.noResi ?? "-"}</td>
                    <td className="px-3 py-2">{k.deliveredAt ? formatDate(k.deliveredAt) : "-"}</td>
                    <td className="px-3 py-2">
                      {(() => {
                        // Est. Tiba per koli = tanggal kirim + lead time ke DC; hanya untuk koli yang sudah dikirim dan belum tiba/diterima.
                        const w = wosOf(k.koliId);
                        const sentDay = dayKey(k.deliveredAt);
                        if (!sentDay || k.receivedAt || (w && ["DITERIMA", "BERMASALAH", "TIBA"].includes(w.code))) return <span className="text-text-muted">-</span>;
                        return <EstDate iso={plusDays(sentDay, ltTiba(k.vendorProduksi))} today={today} />;
                      })()}
                    </td>
                    <td className="px-3 py-2">{k.receivedAt ? formatDate(k.receivedAt) : dateText(parseLooseDay(wosOf(k.koliId)?.diterimaPada))}</td>
                  </tr>
                ))}
              </tbody>
              {koliRows.length > 0 && (
                <tfoot className="border-t-2 border-border-subtle bg-[#F2F5F8] font-semibold">
                  <tr>
                    <td className="px-3 py-2" colSpan={3}>Total di koli ({koliRows.length} koli)</td>
                    <td className={num}>{formatPcs(sum(koliRows.map((k) => k.qty)))}</td>
                    <td colSpan={8} />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
          {wosError && <div className="mt-2 font-sans text-[11px] text-danger-fg">Status WOS gagal dimuat: {wosError}</div>}
          {wos && !wos.configured && <div className="mt-2 font-sans text-[11px] text-text-muted">Status WOS belum aktif (integrasi Google Sheets belum dikonfigurasi).</div>}
          {wos && wos.configured && !wos.hasStatusColumn && <div className="mt-2 font-sans text-[11px] text-text-muted">Tab ERP_INCOMING belum punya kolom status (status_wos atau Status) yang diisi WOS.</div>}
          {wos && wos.hasStatusColumn && koliRows.length > 0 && (
            <div className="mt-2 font-sans text-[11.5px] text-[#31414F]">
              Diterima gudang WOS: <span className="font-mono font-semibold text-[#047857]">{formatPcs(wosReceivedQty)}</span> dari {formatPcs(sum(koliRows.map((k) => k.qty)))} pcs di koli
              {wosArrivedQty > 0 && (
                <>
                  {" · "}tiba belum validasi: <span className="font-mono font-semibold text-[#B45309]">{formatPcs(wosArrivedQty)}</span> pcs
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** Isi halaman Tracking Item, dipakai PPIC dan SCM (data sama, hanya pembungkus halaman yang beda). */
export function ItemTrackingView() {
  const mrpDetails = useMrpStore((s) => s.mrpDetails);
  const productionBatches = useMrpStore((s) => s.productionBatches);
  const productionResults = useMrpStore((s) => s.productionResults);
  const deliveryKolis = useMrpStore((s) => s.deliveryKolis);
  const warehouseReceipts = useMrpStore((s) => s.warehouseReceipts);
  const invoices = useMrpStore((s) => s.invoices);

  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [warna, setWarna] = useState<string[]>([]);
  const [lengan, setLengan] = useState<string[]>([]);
  const [size, setSize] = useState<string[]>([]);
  const [kategori, setKategori] = useState<string[]>([]);
  const [mrp, setMrp] = useState<string[]>([]);
  const [vendor, setVendor] = useState<string[]>([]);
  // Filter Tanggal Kirim: hanya sel (MRP x vendor) yang punya pengiriman pada rentang itu; angkanya tetap angka penuh sel tersebut.
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [detailKey, setDetailKey] = useState<string | null>(null);
  const today = localDateString(new Date());

  // Penerimaan di DC dari WOS (tab ERP_INCOMING): dipakai bersama penerimaan Warehouse ERP untuk kolom Diterima DC.
  const [wos, setWos] = useState<WosKoliStatusResult | null>(null);
  const [wosBusy, setWosBusy] = useState(false);
  useEffect(() => {
    void getWosKoliStatusAction().then((res) => {
      if (res.ok) setWos(res.data);
    });
  }, []);
  async function refreshWos() {
    setWosBusy(true);
    const res = await getWosKoliStatusAction(true);
    if (res.ok) setWos(res.data);
    setWosBusy(false);
  }

  const all = useMemo(
    () => buildItemTracking(mrpDetails, productionBatches, productionResults, deliveryKolis, warehouseReceipts, { invoices, wosByKoli: wos?.byKoli }),
    [mrpDetails, productionBatches, productionResults, deliveryKolis, warehouseReceipts, invoices, wos]
  );

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const dateOn = !!dateFrom || !!dateTo;
    const out: ItemTrackRow[] = [];
    for (const it of all) {
      if (warna.length > 0 && !warna.includes(it.warna)) continue;
      if (lengan.length > 0 && !lengan.includes(it.lengan === "PENDEK" ? "Pendek" : "Panjang")) continue;
      if (size.length > 0 && !size.includes(it.size)) continue;
      if (picked.length > 0 && !picked.includes(it.itemName)) continue;
      if (needle && !it.itemName.toLowerCase().includes(needle) && !it.warna.toLowerCase().includes(needle)) continue;
      const bd = it.breakdown.filter(
        (b) =>
          (mrp.length === 0 || mrp.includes(b.mrpId)) &&
          (vendor.length === 0 || vendor.includes(vendorLabel(b.vendorProduksi))) &&
          (kategori.length === 0 || kategori.includes(b.kategori)) &&
          (!dateOn || b.shipments.some((s) => (!dateFrom || s.date >= dateFrom) && (!dateTo || s.date <= dateTo)))
      );
      if (bd.length === 0) continue;
      const item = bd.length === it.breakdown.length ? it : itemWithBreakdown(it, bd);
      out.push(item);
    }
    return out;
  }, [all, q, picked, warna, lengan, size, kategori, mrp, vendor, dateFrom, dateTo]);

  const detail = detailKey ? rows.find((r) => r.key === detailKey) : undefined;
  const hasFilter = !!q.trim() || picked.length > 0 || !!dateFrom || !!dateTo || warna.length + lengan.length + size.length + kategori.length + mrp.length + vendor.length > 0;

  const opt = (xs: string[]) => Array.from(new Set(xs.filter(Boolean))).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const allBreakdown = all.flatMap((i) => i.breakdown);

  async function exportExcel() {
    const parts: string[] = [];
    if (picked.length > 0) parts.push("item " + picked.join(", "));
    if (warna.length > 0) parts.push("warna " + warna.join(", "));
    if (lengan.length > 0) parts.push("lengan " + lengan.join(", "));
    if (size.length > 0) parts.push("size " + size.join(", "));
    if (kategori.length > 0) parts.push("kategori " + kategori.join(", "));
    if (mrp.length > 0) parts.push("MRP " + mrp.join(", "));
    if (vendor.length > 0) parts.push("vendor " + vendor.join(", "));
    if (dateFrom || dateTo) parts.push(`tanggal kirim ${dateFrom ? formatDate(dateFrom) : "…"} s/d ${dateTo ? formatDate(dateTo) : "…"}`);
    try {
      await exportTrackingExcel(
        { rows, filterLabel: parts.length > 0 ? "Filter: " + parts.join(" · ") : undefined, batches: productionBatches, results: productionResults, kolis: deliveryKolis, invoices },
        `WIP-Tracking-Item-${today}.xlsx`
      );
    } catch (e) {
      await alertDialog({ title: "Gagal membuat Excel", message: e instanceof Error ? e.message : "Terjadi kesalahan saat membuat file Excel.", tone: "danger" });
    }
  }

  // Kolom baru (tanggal GR/awal cutting/awal FG/awal di koli/kirim, estimasi, info penerimaan DC) ada di menu Kolom; yang tampil bawaan hanya Est. Tiba DC.
  // Angka qty = posisi saat ini (tidak tumpang tindih), lihat itemTracking.ts.
  const columns: ColumnDef<ItemTrackRow>[] = [
    { key: "kategori", label: "Kategori", default: true, render: (r) => r.kategori.join(", ") || "-" },
    { key: "mrp", label: "MRP", default: false, render: (r) => r.mrpIds.join(", ") },
    { key: "target", label: "Target MRP", default: true, align: "right", render: (r) => formatPcs(r.target) },
    { key: "tglGr", label: "Tgl Good Receive", default: false, render: (r) => <span className="whitespace-nowrap">{dateText(r.grAt)}</span> },
    { key: "belumCutting", label: "Belum Cutting", default: true, align: "right", render: (r) => formatPcs(r.belumCutting) },
    { key: "cutting", label: "Cutting", default: true, align: "right", info: { title: "Cutting", body: "Sudah dicutting tetapi belum jadi Finish Good (cutting dikurangi FG dan reject). Qty yang sudah jadi FG pindah ke kolom Finish Good." }, render: (r) => formatPcs(r.cuttingWip) },
    { key: "tglCutting", label: "Tgl Awal Cutting", default: false, render: (r) => <span className="whitespace-nowrap">{dateText(r.cuttingAt)}</span> },
    { key: "estFg", label: "Est. FG", default: false, render: (r) => <EstDate iso={r.estFg} today={today} /> },
    { key: "fg", label: "Finish Good", default: true, align: "right", info: { title: "Finish Good", body: "Sudah jadi Finish Good tetapi belum masuk koli. Qty yang sudah masuk koli atau dikirim pindah ke kolom berikutnya. Total FG kumulatif ada di kartu atas dan di Excel." }, render: (r) => <span className="font-semibold">{formatPcs(r.fgWip)}</span> },
    { key: "tglFg", label: "Tgl Awal FG", default: false, render: (r) => <span className="whitespace-nowrap">{dateText(r.fgFirstAt)}</span> },
    { key: "pct", label: "% FG", default: true, align: "right", info: { title: "% FG", body: "Total Finish Good kumulatif (termasuk yang sudah dikirim) dibagi Target MRP." }, render: (r) => (r.target > 0 ? `${Math.round((r.fg / r.target) * 100)}%` : "-") },
    { key: "reject", label: "Reject", default: false, align: "right", render: (r) => formatPcs(r.reject) },
    { key: "diKoli", label: "Di koli", default: true, align: "right", render: (r) => formatPcs(r.diKoli) },
    { key: "tglKoli", label: "Tgl Awal Di Koli", default: false, render: (r) => <span className="whitespace-nowrap">{dateText(r.koliFirstAt)}</span> },
    { key: "estKirim", label: "Est. Kirim", default: false, render: (r) => <EstDate iso={r.estKirim} today={today} /> },
    {
      key: "tglKirim",
      label: "Tanggal Kirim",
      default: false,
      render: (r) => (
        <span className="whitespace-nowrap" title={r.shipDates.map(formatDate).join(", ") || undefined}>
          {shipRange(r.shipDates)}
        </span>
      ),
    },
    { key: "dikirim", label: "Dikirim (belum tiba)", default: true, align: "right", info: { title: "Dikirim", body: "Sudah dikirim vendor tetapi belum sampai di DC. Total yang pernah dikirim ada di kartu atas dan di Excel." }, render: (r) => formatPcs(r.perjalanan) },
    { key: "estTiba", label: "Est. Tiba DC", default: true, info: { title: "Est. Tiba DC", body: "Tanggal kirim + lead time ke DC (7 hari; Konveksi Makassar 1 hari), hanya untuk koli yang sudah dikirim dan belum sampai di DC. Barang yang belum dikirim tidak punya Est. Tiba. Tanggal paling lambat di antara MRP dan vendor item ini; merah = sudah lewat dari hari ini." }, render: (r) => <EstDate iso={r.estTiba} today={today} /> },
    { key: "tibaDc", label: "Tiba DC (belum validasi)", default: false, align: "right", render: (r) => formatPcs(r.tibaDc) },
    { key: "diterima", label: "Diterima DC", default: true, align: "right", info: { title: "Diterima DC", body: "Koli yang sudah diterima di DC: penerimaan Warehouse ERP atau status Diterima dari WOS (tidak dihitung ganda)." }, render: (r) => formatPcs(r.diterima) },
    { key: "tglDiterima", label: "Tgl Diterima DC", default: false, render: (r) => <span className="whitespace-nowrap">{dateText(r.receivedAt)}</span> },
    { key: "koliDiterima", label: "No. Koli Diterima", default: false, render: (r) => <span className="font-mono text-[11px]">{r.receivedKoli.join(", ") || "-"}</span> },
    { key: "sisa", label: "Sisa produksi", default: false, align: "right", render: (r) => formatPcs(r.sisaProduksi) },
  ];

  return (
    <>
      <StageCards rows={rows} />

      <div className="mt-3 rounded-lg border border-border-subtle bg-surface-card px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <ItemSearch items={all} query={q} onQuery={setQ} picked={picked} onPick={(name) => setPicked((p) => [...p, name])} />
          <MultiSelectFilter label="Warna" options={opt(all.map((i) => i.warna))} value={warna} onChange={setWarna} />
          <MultiSelectFilter label="Lengan" options={["Pendek", "Panjang"]} value={lengan} onChange={setLengan} />
          <MultiSelectFilter label="Size" options={opt(all.map((i) => i.size))} value={size} onChange={setSize} />
          <MultiSelectFilter label="Kategori" options={opt(allBreakdown.map((b) => b.kategori))} value={kategori} onChange={setKategori} />
          <MultiSelectFilter label="No. MRP" options={opt(allBreakdown.map((b) => b.mrpId)).reverse()} value={mrp} onChange={setMrp} />
          <MultiSelectFilter label="Vendor" options={opt(allBreakdown.map((b) => vendorLabel(b.vendorProduksi)))} value={vendor} onChange={setVendor} />
          <label className="flex items-center gap-1.5 font-sans text-[11.5px] font-medium text-[#31414F]" title="Tampilkan item yang punya pengiriman pada rentang tanggal ini">
            Tgl kirim
            <input type="date" value={dateFrom} max={dateTo || undefined} onChange={(e) => setDateFrom(e.target.value)} className={selectCls} aria-label="Tanggal kirim dari" />
            s/d
            <input type="date" value={dateTo} min={dateFrom || undefined} onChange={(e) => setDateTo(e.target.value)} className={selectCls} aria-label="Tanggal kirim sampai" />
          </label>
          {hasFilter && (
            <button
              onClick={() => {
                setQ("");
                setPicked([]);
                setWarna([]);
                setLengan([]);
                setSize([]);
                setKategori([]);
                setMrp([]);
                setVendor([]);
                setDateFrom("");
                setDateTo("");
              }}
              className="font-sans text-[11.5px] font-semibold text-action-primary underline"
            >
              Hapus filter
            </button>
          )}
        </div>
        {wos && (!wos.configured || !wos.hasStatusColumn) && (
          <div className="mt-2 font-sans text-[11px] text-text-muted">Status penerimaan DC dari WOS belum aktif, jadi kolom Diterima DC hanya dari penerimaan Warehouse ERP.</div>
        )}
        {picked.length > 0 && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {picked.map((name) => (
              <span key={name} className="inline-flex items-center gap-1 rounded-full border border-border-subtle bg-[#F2F5F8] py-[3px] pl-2.5 pr-1.5 font-sans text-[11px] font-medium text-text-primary">
                {name}
                <button type="button" aria-label={`Hapus ${name}`} onClick={() => setPicked((p) => p.filter((x) => x !== name))} className="text-text-muted hover:text-text-primary">
                  ✕
                </button>
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="mt-3">
        <DataTable
          title="Tracking per item"
          headerActions={
            <>
              <Button onClick={() => void refreshWos()} disabled={wosBusy} variant="muted" size="xs" title="Baca ulang status penerimaan DC dari WOS">
                {wosBusy ? "Memuat…" : "Segarkan status DC"}
              </Button>
              <Button onClick={() => void exportExcel()} disabled={rows.length === 0} variant="muted" size="xs" title="Excel estimasi pengiriman per item, MRP, dan vendor (mengikuti filter)">
                Export Excel
              </Button>
            </>
          }
          columns={columns}
          rows={rows}
          keyOf={(r) => r.key}
          firstColumnLabel="Item"
          firstColumnRender={(r) => (
            <span className="font-semibold">
              {r.warna} <span className="text-text-muted">{lenganShort(r.lengan)}</span> {r.size}
            </span>
          )}
          onRowClick={(r) => setDetailKey(r.key)}
          emptyText="Belum ada item untuk filter ini."
          bodyMaxHeight="60vh"
        />
      </div>
      {detail && <ItemDetailModal item={detail} onClose={() => setDetailKey(null)} />}
    </>
  );
}
