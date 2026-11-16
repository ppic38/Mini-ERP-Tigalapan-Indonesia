"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { alertDialog } from "@/components/ui/confirm-dialog";
import { DataTable, type ColumnDef, type FilterDef } from "@/components/mrp/data-table";
import { StageBadge } from "@/components/ui/stage-badge";
import { useMrpStore } from "@/lib/mrp/store";
import { formatDate, formatPcs, localDateString } from "@/lib/mrp/derive";
import { VENDOR_PRODUKSI } from "@/lib/mrp/seed";
import { getWosKoliStatusAction, type WosKoliStatusResult } from "@/lib/mrp/wosStatusActions";
import { ADUAN_STAGES, buildAduanTracking, buildItemTracking, itemWithBreakdown, lenganShort, type AduanStage, type AduanTrackRow, type ItemTrackRow } from "@/lib/mrp/itemTracking";
import { exportTrackingExcel } from "@/lib/mrp/exportTrackingExcel";
import { cn } from "@/lib/utils";

const vendorLabel = (id: string) => (id ? VENDOR_PRODUKSI[id]?.name ?? id : "Belum dialokasikan");
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const dateText = (iso?: string) => (iso ? formatDate(iso) : "-");
const uniq = (xs: string[]) => Array.from(new Set(xs.filter(Boolean))).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
/** Tahapan yang ditampilkan sebagai titik di sel Status (tanpa "Belum dialokasikan" dan "Selesai" yang di luar alur). */
const FLOW: readonly string[] = ADUAN_STAGES.filter((s) => s !== "Belum dialokasikan" && s !== "Selesai");

/** Kartu posisi barang (redesign 2026-11-16): angka dari baris yang SEDANG lolos filter tabel, diklik = filter Status. */
const CARDS: { key: string; label: string; value: (r: AduanTrackRow) => number; stages: AduanStage[] }[] = [
  { key: "target", label: "Target MRP", value: (r) => r.target, stages: [] },
  { key: "belum", label: "Belum cutting", value: (r) => r.belumCutting, stages: ["Belum dialokasikan", "Belum resting", "Resting"] },
  { key: "cutting", label: "Di cutting", value: (r) => r.cuttingWip, stages: ["Cutting"] },
  { key: "fg", label: "Finish Good", value: (r) => r.fgWip, stages: ["Finish Good"] },
  { key: "koli", label: "Di koli", value: (r) => r.diKoli, stages: ["Di koli"] },
  { key: "kirim", label: "Dikirim, belum tiba", value: (r) => r.perjalanan + r.tibaDc, stages: ["Dikirim", "Tiba DC"] },
  { key: "dc", label: "Diterima DC", value: (r) => r.diterima, stages: ["Diterima DC"] },
];

/** Isi halaman Tracking Item, dipakai PPIC dan SCM (data sama, hanya pembungkus halaman yang beda).
 *  Redesign 2026-11-16 (owner): satu tabel gaya Odoo, satu baris per aduan x size, status tahapan dari status roll; tanpa
 *  pop-up rincian (semua data ada di tabel, kolom tambahan lewat menu Kolom). */
export function ItemTrackingView() {
  const mrpDetails = useMrpStore((s) => s.mrpDetails);
  const productionBatches = useMrpStore((s) => s.productionBatches);
  const productionResults = useMrpStore((s) => s.productionResults);
  const deliveryKolis = useMrpStore((s) => s.deliveryKolis);
  const warehouseReceipts = useMrpStore((s) => s.warehouseReceipts);
  const invoices = useMrpStore((s) => s.invoices);
  const materialPOs = useMrpStore((s) => s.materialPOs);
  const today = localDateString(new Date());

  // Filter Tanggal Kirim (owner 2026-11-07): baris yang punya pengiriman pada rentang itu; angkanya tetap angka penuh baris.
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [shownKeys, setShownKeys] = useState<Set<string> | null>(null);
  const [preset, setPreset] = useState<{ nonce: number; filters: Record<string, string[]>; card: string }>({ nonce: 0, filters: {}, card: "" });

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

  const items = useMemo(
    () => buildItemTracking(mrpDetails, productionBatches, productionResults, deliveryKolis, warehouseReceipts, { invoices, wosByKoli: wos?.byKoli }),
    [mrpDetails, productionBatches, productionResults, deliveryKolis, warehouseReceipts, invoices, wos]
  );
  const all = useMemo(
    () => buildAduanTracking(items, mrpDetails, productionBatches, deliveryKolis, warehouseReceipts, { wosByKoli: wos?.byKoli }),
    [items, mrpDetails, productionBatches, deliveryKolis, warehouseReceipts, wos]
  );
  const rows = useMemo(() => {
    if (!dateFrom && !dateTo) return all;
    return all.filter((r) => r.shipDates.some((d) => (!dateFrom || d >= dateFrom) && (!dateTo || d <= dateTo)));
  }, [all, dateFrom, dateTo]);
  const shown = shownKeys ? rows.filter((r) => shownKeys.has(r.key)) : rows;

  const lenganLabel = (r: AduanTrackRow) => (r.lengan === "PENDEK" ? "Pendek" : "Panjang");
  const filterDefs: FilterDef<AduanTrackRow>[] = [
    { label: "Status", options: ADUAN_STAGES.filter((s) => rows.some((r) => r.status === s)), test: (r, v) => r.status === v },
    { label: "No. MRP", options: uniq(rows.map((r) => r.mrpId)).reverse(), test: (r, v) => r.mrpId === v },
    { label: "Vendor", options: uniq(rows.map((r) => vendorLabel(r.vendorProduksi))), test: (r, v) => vendorLabel(r.vendorProduksi) === v },
    { label: "Item", options: uniq(rows.map((r) => r.itemName)), test: (r, v) => r.itemName === v },
    { label: "Warna", options: uniq(rows.map((r) => r.warna)), test: (r, v) => r.warna === v },
    { label: "Lengan", options: ["Pendek", "Panjang"], test: (r, v) => lenganLabel(r) === v },
    { label: "Size", options: Array.from(new Set(rows.map((r) => r.size))), test: (r, v) => r.size === v },
    { label: "Kategori", options: uniq(rows.map((r) => r.kategori)), test: (r, v) => r.kategori === v },
    { label: "Kode aduan", options: uniq(rows.map((r) => r.kode)), test: (r, v) => r.kode === v },
  ];

  const pcs = (n: number) => <span className={n === 0 ? "text-text-muted" : undefined}>{formatPcs(n)}</span>;
  const columns: ColumnDef<AduanTrackRow>[] = [
    { key: "mrp", label: "No. MRP", default: true, render: (r) => <span className="font-mono">{r.mrpId}</span> },
    { key: "vendor", label: "Vendor", default: true, render: (r) => vendorLabel(r.vendorProduksi) },
    {
      key: "kode",
      label: "Aduan",
      default: true,
      render: (r) =>
        r.jenis === "aduan" ? (
          <span className="font-mono">{r.kode}</span>
        ) : (
          <span className="text-text-muted" title={r.jenis === "sisa" ? "FG rework / sisa kain atau koli lama yang tidak tercatat roll asalnya" : "Target MRP yang belum punya vendor"}>
            {r.jenis === "sisa" ? "Rework / tanpa roll" : "Belum dialokasikan"}
          </span>
        ),
    },
    { key: "kategori", label: "Kategori", default: false, render: (r) => r.kategori || "-" },
    {
      key: "roll",
      label: "Roll ditutup",
      default: true,
      align: "right",
      info: { title: "Roll ditutup", body: "Roll aduan yang sudah ditutup dari rencana roll aduan. Tooltip memuat roll resting dan cutting." },
      render: (r) =>
        r.jenis === "aduan" ? (
          <span className="font-mono" title={`${r.rollStarted} roll mulai · ${r.rollResting} resting · ${r.rollCutting} cutting · ${r.rollClosed} ditutup`}>
            {r.rollClosed}/{r.rollPlan}
          </span>
        ) : (
          <span className="text-text-muted">-</span>
        ),
    },
    { key: "target", label: "Target", default: true, align: "right", render: (r) => pcs(r.target) },
    { key: "cutting", label: "Cutting", default: true, align: "right", info: { title: "Cutting", body: "Hasil cutting kumulatif roll aduan ini untuk size ini." }, render: (r) => pcs(r.cutting) },
    { key: "fg", label: "Finish Good", default: true, align: "right", info: { title: "Finish Good", body: "Finish Good kumulatif roll aduan ini (termasuk yang sudah dikemas dan dikirim)." }, render: (r) => pcs(r.fg) },
    { key: "reject", label: "Reject", default: false, align: "right", render: (r) => pcs(r.reject) },
    { key: "diKoli", label: "Di koli", default: true, align: "right", render: (r) => pcs(r.diKoli) },
    { key: "dikirim", label: "Dikirim", default: true, align: "right", render: (r) => pcs(r.dikirim) },
    { key: "diterima", label: "Diterima DC", default: true, align: "right", render: (r) => pcs(r.diterima) },
    {
      key: "status",
      label: "Status",
      default: true,
      render: (r) => <StageBadge stages={FLOW} current={r.status} tone={r.status === "Diterima DC" || r.status === "Selesai" ? "done" : undefined} />,
    },
    { key: "belumCutting", label: "Sisa belum cutting", default: false, align: "right", render: (r) => pcs(r.belumCutting) },
    { key: "fgWip", label: "FG belum dikemas", default: false, align: "right", render: (r) => pcs(r.fgWip) },
    { key: "perjalanan", label: "Di perjalanan", default: false, align: "right", render: (r) => pcs(r.perjalanan) },
    { key: "tibaDc", label: "Tiba DC (belum validasi)", default: false, align: "right", render: (r) => pcs(r.tibaDc) },
    { key: "tglResting", label: "Tgl Awal Resting", default: false, render: (r) => <span className="whitespace-nowrap">{dateText(r.restingAt)}</span> },
    { key: "tglCutting", label: "Tgl Awal Cutting", default: false, render: (r) => <span className="whitespace-nowrap">{dateText(r.cuttingAt)}</span> },
    { key: "tglKoli", label: "Tgl Awal Di Koli", default: false, render: (r) => <span className="whitespace-nowrap">{dateText(r.koliFirstAt)}</span> },
    { key: "tglKirim", label: "Tgl Kirim Terakhir", default: true, render: (r) => <span className="whitespace-nowrap" title={r.shipDates.map(formatDate).join(", ") || undefined}>{dateText(r.shipLastAt)}</span> },
    {
      key: "estTiba",
      label: "Est. Tiba DC",
      default: false,
      info: { title: "Est. Tiba DC", body: "Tanggal kirim + lead time ke DC (7 hari; Konveksi Makassar 1 hari), hanya untuk koli yang sudah dikirim dan belum sampai di DC." },
      render: (r) => (r.estTiba ? <span className={cn("whitespace-nowrap", r.estTiba < today && "font-semibold text-[#B91C1C]")}>{formatDate(r.estTiba)}</span> : <span className="text-text-muted">-</span>),
    },
    { key: "koli", label: "No. Koli", default: false, render: (r) => <span className="font-mono text-[11px]">{r.koliNos.join(", ") || "-"}</span> },
  ];

  /** Export Excel tetap memakai susunan WIP yang lama: dibentuk dari sel item (MRP x vendor x item) baris yang sedang tampil. */
  async function exportExcel() {
    const keys = new Set(shown.map((r) => r.cellKey));
    const exportRows: ItemTrackRow[] = [];
    for (const it of items) {
      const bd = it.breakdown.filter((c) => keys.has(c.key));
      if (bd.length === 0) continue;
      exportRows.push(bd.length === it.breakdown.length ? it : itemWithBreakdown(it, bd));
    }
    const parts: string[] = [];
    if (shown.length !== all.length) parts.push(`${shown.length} dari ${all.length} baris aduan yang tampil`);
    if (dateFrom || dateTo) parts.push(`tanggal kirim ${dateFrom ? formatDate(dateFrom) : "…"} s/d ${dateTo ? formatDate(dateTo) : "…"}`);
    try {
      await exportTrackingExcel(
        {
          rows: exportRows,
          filterLabel: parts.length > 0 ? "Filter: " + parts.join(" · ") : undefined,
          batches: productionBatches,
          results: productionResults,
          kolis: deliveryKolis,
          invoices,
          aduans: mrpDetails.flatMap((d) => d.aduanRows),
          aduanMrpIds: Object.fromEntries(mrpDetails.flatMap((d) => d.aduanRows.map((a) => [a.id, d.mrp.id] as const))),
          materialPOs,
        },
        `WIP-Tracking-Item-${today}.xlsx`
      );
    } catch (e) {
      await alertDialog({ title: "Gagal membuat Excel", message: e instanceof Error ? e.message : "Terjadi kesalahan saat membuat file Excel.", tone: "danger" });
    }
  }

  const dateCls = "rounded-md border border-border-subtle bg-white px-2 py-[5px] font-sans text-[11.5px] text-[#31414F]";
  return (
    <>
      <div className="grid grid-cols-7 gap-2.5 max-xl:grid-cols-4 max-sm:grid-cols-2">
        {CARDS.map((c) => {
          const value = sum(shown.map(c.value));
          const active = preset.card === c.key;
          const clickable = c.stages.length > 0;
          return (
            <button
              key={c.key}
              type="button"
              disabled={!clickable}
              aria-pressed={active}
              onClick={() =>
                setPreset((p) =>
                  p.card === c.key
                    ? { nonce: p.nonce + 1, filters: {} as Record<string, string[]>, card: "" }
                    : { nonce: p.nonce + 1, filters: { Status: c.stages.filter((s) => rows.some((r) => r.status === s)) as string[] }, card: c.key }
                )
              }
              className={cn(
                "min-w-0 rounded-[10px] border bg-surface-card px-3.5 py-3 text-left",
                active ? "border-accent-blue ring-1 ring-accent-blue" : "border-border-subtle",
                clickable && "hover:border-accent-blue"
              )}
            >
              <div className="truncate font-sans text-[10.5px] font-semibold uppercase tracking-wider text-text-muted">{c.label}</div>
              <div className="mt-1.5 truncate font-mono text-[20px] font-bold leading-none text-text-primary">{formatPcs(value)}</div>
              <div className="mt-1 font-sans text-[10.5px] text-text-muted">pcs</div>
            </button>
          );
        })}
      </div>

      <DataTable<AduanTrackRow>
        title="Tracking per aduan"
        subtitle={wos && (!wos.configured || !wos.hasStatusColumn) ? "Status penerimaan DC dari WOS belum aktif; Diterima DC hanya dari penerimaan Warehouse ERP." : undefined}
        headerActions={
          <>
            <span className="flex items-center gap-1.5 font-sans text-[11.5px] text-text-muted" title="Tampilkan baris yang punya pengiriman pada rentang tanggal ini">
              Tgl kirim
              <input type="date" value={dateFrom} max={dateTo || undefined} onChange={(e) => setDateFrom(e.target.value)} className={dateCls} aria-label="Tanggal kirim dari" />
              s/d
              <input type="date" value={dateTo} min={dateFrom || undefined} onChange={(e) => setDateTo(e.target.value)} className={dateCls} aria-label="Tanggal kirim sampai" />
            </span>
            <Button onClick={() => void refreshWos()} disabled={wosBusy} variant="muted" size="xs" title="Baca ulang status penerimaan DC dari WOS">
              {wosBusy ? "Memuat…" : "Segarkan status DC"}
            </Button>
            <Button onClick={() => void exportExcel()} disabled={shown.length === 0} variant="muted" size="xs" title="Excel WIP per roll (mengikuti baris yang tampil)">
              Export Excel
            </Button>
          </>
        }
        columns={columns}
        rows={rows}
        keyOf={(r) => r.key}
        firstColumnLabel="Item"
        firstColumnRender={(r) => (
          <span className="whitespace-nowrap font-semibold">
            {r.warna} <span className="text-text-muted">{lenganShort(r.lengan)}</span> {r.size}
          </span>
        )}
        filterDefs={filterDefs}
        filterPreset={preset}
        onFilteredRows={(list) => setShownKeys(new Set(list.map((r) => r.key)))}
        search={{ placeholder: "Cari item, MRP, vendor, kode aduan, status…", getText: (r) => `${r.itemName} ${r.mrpId} ${vendorLabel(r.vendorProduksi)} ${r.kode} ${r.status} ${r.kategori}` }}
        emptyText="Belum ada baris untuk filter ini."
        nowrap
      />
    </>
  );
}
