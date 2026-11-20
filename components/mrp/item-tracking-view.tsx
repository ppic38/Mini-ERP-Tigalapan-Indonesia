"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { alertDialog } from "@/components/ui/confirm-dialog";
import { DataTable, aggSame, aggSum, type ColumnDef, type FilterDef } from "@/components/mrp/data-table";
import { StageBadge } from "@/components/ui/stage-badge";
import { useMrpStore } from "@/lib/mrp/store";
import { formatDate, formatPcs, localDateString, skuItemNameLookup } from "@/lib/mrp/derive";
import { VENDOR_PRODUKSI } from "@/lib/mrp/seed";
import { getWosKoliStatusAction, type WosKoliStatusResult } from "@/lib/mrp/wosStatusActions";
import { TRACK_STAGES, TRACK_STATUSES, buildAduanTracking, buildItemTracking, buildTrackLines, type TrackLine, type TrackStage } from "@/lib/mrp/itemTracking";
import { returnedRollKeys } from "@/lib/mrp/flowStatus";
import { exportTrackLinesExcel } from "@/lib/mrp/exportTrackLinesExcel";
import { cn } from "@/lib/utils";

const vendorLabel = (id: string) => (id ? VENDOR_PRODUKSI[id]?.name ?? id : "Belum dialokasikan");
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const uniq = (xs: string[]) => Array.from(new Set(xs.filter(Boolean))).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
const FLOW: readonly string[] = TRACK_STAGES;
const qtyAt = (r: TrackLine, stages: readonly TrackStage[]) => (stages.includes(r.stage) ? r.qty : 0);

/** Kartu posisi barang (owner 2026-11-19): qty baris yang SEDANG lolos filter tabel per kelompok status; diklik = filter Status. */
const CARDS: { key: string; label: string; stages: TrackStage[] }[] = [
  { key: "wpv", label: "Wait PV", stages: ["Wait PV"] },
  { key: "bayar", label: "PV & Paid", stages: ["PV", "Paid"] },
  { key: "mat", label: "Del & GR Mat", stages: ["Del Mat", "GR Mat"] },
  { key: "cut", label: "Resting & Cut", stages: ["Resting", "Cutting"] },
  { key: "fg", label: "FG & Done FG", stages: ["FG", "Done FG"] },
  { key: "koli", label: "Packing", stages: ["Packing"] },
  { key: "kirim", label: "Delivery FG", stages: ["Delivery FG"] },
  { key: "dc", label: "GR DC", stages: ["GR DC"] },
];

/** Filter dari tautan (klik sel matriks dashboard): ?mrp=W44,W43&status=Wait PV,PV&group=Status,Vendor,Warna */
type UrlView = { filters: Record<string, string[]>; group: string[] | undefined };
function parseUrlView(search: string): UrlView {
  const q = new URLSearchParams(search);
  const list = (k: string) => (q.get(k) ?? "").split(",").map((x) => x.trim()).filter(Boolean);
  const filters: Record<string, string[]> = {};
  if (list("mrp").length) filters["No MRP"] = list("mrp");
  if (list("status").length) filters["Status"] = list("status");
  return { filters, group: list("group").length ? list("group") : undefined };
}

/** Isi halaman Tracking Item, dipakai PPIC dan SCM (data sama, hanya pembungkus halaman yang beda).
 *  Redesign 2026-11-16 (owner): satu tabel gaya Odoo; tanpa pop-up rincian (semua data ada di tabel, kolom tambahan lewat menu Kolom).
 *  Revisi 2026-11-19 (owner): satu baris per roll x size x STATUS (`buildTrackLines`): qty hanya di kolom statusnya, jadi filter Status
 *  menampilkan qty yang masih berada di status itu saja. Tahap sama dengan matriks 11 gate dashboard + Wait PV + Reject. */
export function ItemTrackingView() {
  const mrpDetails = useMrpStore((s) => s.mrpDetails);
  const productionBatches = useMrpStore((s) => s.productionBatches);
  const productionResults = useMrpStore((s) => s.productionResults);
  const deliveryKolis = useMrpStore((s) => s.deliveryKolis);
  const warehouseReceipts = useMrpStore((s) => s.warehouseReceipts);
  const invoices = useMrpStore((s) => s.invoices);
  const materialPOs = useMrpStore((s) => s.materialPOs);
  const materialClaimHistory = useMrpStore((s) => s.materialClaimHistory);
  const today = localDateString(new Date());
  const itemSellingPrices = useMrpStore((s) => s.itemSellingPrices);

  // Filter Tanggal Kirim (owner 2026-11-07): baris yang punya pengiriman pada rentang itu; angkanya tetap angka penuh baris.
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [shownKeys, setShownKeys] = useState<Set<string> | null>(null);
  const [preset, setPreset] = useState<{ nonce: number; filters: Record<string, string[]>; card: string }>({ nonce: 0, filters: {}, card: "" });
  // Tabel dipasang SETELAH alamat dibaca (kelompok bawaan dari tautan dipakai saat tabel dibuat), lalu filter tautan dipasang lewat preset.
  const search = useSyncExternalStore(
    () => () => {},
    () => window.location.search,
    () => null
  );
  const urlView = useMemo(() => (search === null ? null : parseUrlView(search)), [search]);

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
  const all = useMemo(() => {
    const rs = buildAduanTracking(items, mrpDetails, productionBatches, deliveryKolis, warehouseReceipts, { wosByKoli: wos?.byKoli, invoices, results: productionResults, materialPOs });
    return buildTrackLines(rs, { batches: productionBatches, invoices, returned: returnedRollKeys(materialClaimHistory), today });
  }, [items, mrpDetails, productionBatches, deliveryKolis, warehouseReceipts, wos, invoices, productionResults, materialPOs, materialClaimHistory, today]);
  const skuOf = useMemo(() => skuItemNameLookup(itemSellingPrices), [itemSellingPrices]);
  /** Item (SKU) = nama item Master SKU; kalau item belum ada di Master SKU, nama item ERP. */
  const itemSkuOf = (r: TrackLine) => skuOf(r.warna, r.lengan, r.size) || r.itemName;
  const rows = useMemo(() => {
    if (!dateFrom && !dateTo) return all;
    return all.filter((r) => r.shipDates.some((d) => (!dateFrom || d >= dateFrom) && (!dateTo || d <= dateTo)));
  }, [all, dateFrom, dateTo]);
  const shown = shownKeys ? rows.filter((r) => shownKeys.has(r.key)) : rows;

  const lenganLabel = (r: TrackLine) => (r.lengan === "PENDEK" ? "Pendek" : "Panjang");
  const filterDefs: FilterDef<TrackLine>[] = [
    { label: "Status", options: TRACK_STATUSES.filter((s) => rows.some((r) => r.stage === s)), test: (r, v) => r.stage === v },
    { label: "No MRP", options: uniq(rows.map((r) => r.mrpId)).reverse(), test: (r, v) => r.mrpId === v },
    { label: "Vendor", options: uniq(rows.map((r) => vendorLabel(r.vendorProduksi))), test: (r, v) => vendorLabel(r.vendorProduksi) === v },
    { label: "Item", options: uniq(rows.map((r) => r.itemName)), test: (r, v) => r.itemName === v },
    { label: "Warna", options: uniq(rows.map((r) => r.warna)), test: (r, v) => r.warna === v },
    { label: "Lengan", options: ["Pendek", "Panjang"], test: (r, v) => lenganLabel(r) === v },
    { label: "Size", options: Array.from(new Set(rows.map((r) => r.size))), test: (r, v) => r.size === v },
    { label: "Kategori", options: uniq(rows.map((r) => r.kategori)), test: (r, v) => r.kategori === v },
    { label: "Aduan", options: uniq(rows.map((r) => r.kode)), test: (r, v) => r.kode === v },
  ];

  const pcs = (n: number) => <span className={n === 0 ? "text-text-muted" : undefined}>{formatPcs(n)}</span>;
  // Baris kelompok (owner 2026-11-16): angka dijumlah; teks dan status hanya tampil kalau sama di semua baris, kalau berbeda dikosongkan.
  const sumPcs = (get: (r: TrackLine) => number) => aggSum<TrackLine>(get, (n) => <span className="font-semibold">{formatPcs(n)}</span>);
  const sameText = (get: (r: TrackLine) => string) => aggSame<TrackLine>(get);
  // Kolom tetap (owner 2026-11-19): Item (SKU), No. MRP, Vendor, Kategori, Warna, Size, Code Roll, Target, satu kolom per status, Status,
  // Est. Delivery, Est. Tiba. Tanggal lain hanya dipakai sebagai filter (Tgl kirim). Export Excel memakai kolom yang sama.
  const dateCell = (iso: string | undefined, late = false) =>
    iso ? <span className={cn("whitespace-nowrap", late && "font-semibold text-[#B91C1C]")}>{formatDate(iso)}</span> : <span className="text-text-muted">-</span>;
  const columns: ColumnDef<TrackLine>[] = [
    { key: "mrp", aggregate: sameText((r) => r.mrpId), label: "No MRP", default: true, render: (r) => <span className="font-mono">{r.mrpId}</span> },
    { key: "vendor", aggregate: sameText((r) => vendorLabel(r.vendorProduksi)), label: "Vendor", default: true, render: (r) => vendorLabel(r.vendorProduksi) },
    { key: "kategori", aggregate: sameText((r) => r.kategori), label: "Kategori", default: true, render: (r) => r.kategori || "-" },
    { key: "warna", aggregate: sameText((r) => r.warna), label: "Warna", default: true, render: (r) => r.warna },
    { key: "size", aggregate: sameText((r) => r.size), label: "Size", default: true, render: (r) => r.size },
    {
      key: "codeRoll",
      label: "Code Roll",
      default: true,
      render: (r) =>
        r.codeRoll ? <span className="font-mono">{r.codeRoll}</span> : <span className="text-text-muted">{r.jenis === "rencana" ? "belum resting" : r.jenis === "sisa" ? "rework / tanpa roll" : "-"}</span>,
    },
    {
      key: "target",
      aggregate: sumPcs((r) => r.target),
      label: "Target",
      default: true,
      align: "right",
      info: { title: "Target", body: "Target roll x size, hanya di baris pertama roll x size (baris lain kosong supaya jumlahnya tidak ganda)." },
      render: (r) => (r.target ? pcs(r.target) : <span className="text-text-muted">-</span>),
    },
    ...TRACK_STATUSES.map(
      (st): ColumnDef<TrackLine> => ({
        key: "st:" + st,
        aggregate: sumPcs((r) => qtyAt(r, [st])),
        label: st,
        default: true,
        align: "right",
        render: (r) => (r.stage === st ? <span className="font-semibold">{formatPcs(r.qty)}</span> : null),
      })
    ),
    {
      key: "status", aggregate: aggSame<TrackLine>((r) => r.stage, (v) => <StageBadge stages={FLOW} current={v} tone={v === "Reject" ? "danger" : v === "GR DC" ? "done" : undefined} />),
      label: "Status",
      default: true,
      render: (r) => <StageBadge stages={FLOW} current={r.stage} tone={r.stage === "Reject" ? "danger" : r.stage === "GR DC" ? "done" : undefined} />,
    },
    {
      key: "estKirim",
      label: "ETD",
      default: true,
      info: { title: "ETD (estimasi delivery)", body: "Perkiraan qty baris ini dikirim vendor: tanggal masuk status + lead time sisa tahap (Wait PV, PV, Paid dihitung dari hari ini). Status Delivery = tanggal kirim aktual. Merah = sudah lewat." },
      render: (r) => dateCell(r.estKirim, r.stage !== "Delivery FG" && !!r.estKirim && r.estKirim <= today),
    },
    {
      key: "estTibaDc",
      label: "ETA",
      default: true,
      info: { title: "ETA (estimasi tiba DC)", body: "ETD + lead time ke DC (7 hari; Konveksi Makassar 1 hari). Merah = sudah lewat tetapi belum diterima DC." },
      render: (r) => dateCell(r.estTibaDc, !!r.estTibaDc && r.estTibaDc < today),
    },
  ];

  /** Export Excel (owner 2026-11-19): kolom tetap sama dengan tabel, mengikuti baris yang tampil (filter tabel dan Tgl kirim). */
  async function exportExcel() {
    const parts: string[] = [];
    if (shown.length !== all.length) parts.push(`${shown.length} dari ${all.length} baris`);
    if (dateFrom || dateTo) parts.push(`tanggal kirim ${dateFrom ? formatDate(dateFrom) : "…"} s/d ${dateTo ? formatDate(dateTo) : "…"}`);
    try {
      await exportTrackLinesExcel(
        shown.map((r) => ({ ...r, itemSku: itemSkuOf(r), vendorName: vendorLabel(r.vendorProduksi) })),
        `Tracking-Item-${today}.xlsx`,
        parts.length > 0 ? "Filter: " + parts.join(" · ") : undefined
      );
    } catch (e) {
      await alertDialog({ title: "Gagal membuat Excel", message: e instanceof Error ? e.message : "Terjadi kesalahan saat membuat file Excel.", tone: "danger" });
    }
  }

  const dateCls = "rounded-md border border-border-subtle bg-white px-2 py-[5px] font-sans text-[11.5px] text-[#31414F]";
  return (
    <>
      <div className="grid grid-cols-8 gap-2.5 max-xl:grid-cols-4 max-sm:grid-cols-2">
        {CARDS.map((c) => {
          const value = sum(shown.map((r) => qtyAt(r, c.stages)));
          const active = preset.card === c.key;
          const clickable = true;
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
                    : { nonce: p.nonce + 1, filters: { ...urlView?.filters, Status: c.stages.filter((s) => rows.some((r) => r.stage === s)) as string[] }, card: c.key }
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

      {urlView && <DataTable<TrackLine>
        title="Tracking per roll"
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
        firstColumnLabel="Item SKU"
        firstColumnRender={(r) => <span className="whitespace-nowrap font-semibold">{itemSkuOf(r)}</span>}
        filterDefs={filterDefs}
        filterPreset={preset}
        onFilteredRows={(list) => setShownKeys(new Set(list.map((r) => r.key)))}
        search={{ placeholder: "Cari item, MRP, vendor, aduan, code roll…", getText: (r) => `${itemSkuOf(r)} ${r.itemName} ${r.mrpId} ${vendorLabel(r.vendorProduksi)} ${r.kode} ${r.codeRoll} ${r.stage} ${r.kategori}` }}
        emptyText="Belum ada baris untuk filter ini."
        nowrap
        openView={urlView}
      />}
    </>
  );
}
