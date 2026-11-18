"use client";

import { useMemo, useState } from "react";
import { KpiCard } from "@/components/ui/kpi-card";
import { StatusPill } from "@/components/ui/status-pill";
import { DataTable, aggSame, aggSum, type ColumnDef, type FilterDef } from "@/components/mrp/data-table";
import { EstHppCell, type MrpProgressRow } from "@/components/mrp/mrp-progress";
import { useMrpStore } from "@/lib/mrp/store";
import { YIELD_ALERT_THRESHOLD_PCT, formatDate, formatPcs, formatRupiah, hppRowsForInvoicePerRoll } from "@/lib/mrp/derive";
import { VENDOR_PRODUKSI } from "@/lib/mrp/seed";
import { SLA_DEFAULTS, buildOpsIssues, buildRollYields, yieldPct, type OpsIssue, type RollYieldRow } from "@/lib/mrp/opsMonitor";

const vendorName = (id: string) => VENDOR_PRODUKSI[id]?.name ?? id;
const uniq = (xs: string[]) => Array.from(new Set(xs.filter(Boolean))).sort((a, b) => a.localeCompare(b, "id-ID", { numeric: true }));
const bold = (x: React.ReactNode) => <span className="font-semibold">{x}</span>;
const pctText = (p: number | null) => (p == null ? "—" : p.toLocaleString("id-ID", { maximumFractionDigits: 1 }) + "%");
type Preset = { nonce: number; filters: Record<string, string[]>; card: string };

// ------------------------------------------------------------------------------------------------ Kendala SLA
/** Daftar kendala operasional yang melewati SLA antar gate (lib/mrp/opsMonitor.ts). `areas` membatasi jenisnya (Produksi hanya Produksi +
 *  Pengiriman). Kartu = jumlah per jenis kendala, diklik = filter. */
export function OpsIssuesTable({ areas }: { areas: OpsIssue["area"][] }) {
  const materialPOs = useMrpStore((s) => s.materialPOs);
  const invoices = useMrpStore((s) => s.invoices);
  const batches = useMrpStore((s) => s.productionBatches);
  const kolis = useMrpStore((s) => s.deliveryKolis);
  const receipts = useMrpStore((s) => s.warehouseReceipts);
  const mrpDetails = useMrpStore((s) => s.mrpDetails);
  const all = useMemo(() => buildOpsIssues({ materialPOs, invoices, batches, kolis, receipts, mrpDetails }), [materialPOs, invoices, batches, kolis, receipts, mrpDetails]);
  const rows = all.filter((i) => areas.includes(i.area));
  const [shown, setShown] = useState<Set<string> | null>(null);
  const [preset, setPreset] = useState<Preset>({ nonce: 0, filters: {}, card: "" });
  const visible = shown ? rows.filter((r) => shown.has(r.key)) : rows;
  const rules = SLA_DEFAULTS.filter((r) => areas.includes(r.area));
  const kinds = uniq(rows.map((r) => r.kendala));

  const filterDefs: FilterDef<OpsIssue>[] = [
    { label: "Kendala", options: kinds, test: (r, v) => r.kendala === v },
    { label: "Area", options: areas.filter((a) => rows.some((r) => r.area === a)), test: (r, v) => r.area === v },
    { label: "No. MRP", options: uniq(rows.map((r) => r.mrpId)).reverse(), test: (r, v) => r.mrpId === v },
    { label: "Vendor", options: uniq(rows.map((r) => vendorName(r.vendorProduksi))), test: (r, v) => vendorName(r.vendorProduksi) === v },
    { label: "Supplier", options: uniq(rows.map((r) => r.supplier)), test: (r, v) => r.supplier === v },
    { label: "Lewat SLA", options: ["1-2 hari", "3-7 hari", "> 7 hari"], test: (r, v) => (v === "1-2 hari" ? r.lewat <= 2 : v === "3-7 hari" ? r.lewat >= 3 && r.lewat <= 7 : r.lewat > 7) },
  ];
  const columns: ColumnDef<OpsIssue>[] = [
    { key: "mrp", label: "No. MRP", default: true, aggregate: aggSame((r) => r.mrpId), render: (r) => <span className="font-mono">{r.mrpId}</span> },
    { key: "vendor", label: "Vendor", default: true, aggregate: aggSame((r) => vendorName(r.vendorProduksi)), render: (r) => vendorName(r.vendorProduksi) },
    { key: "supplier", label: "Supplier", default: false, render: (r) => r.supplier || "—" },
    { key: "warna", label: "Warna", default: true, render: (r) => <span title={r.warna}>{r.warna.length > 40 ? r.warna.slice(0, 40) + "…" : r.warna}</span> },
    { key: "ref", label: "Referensi", default: true, render: (r) => <span className="font-mono">{r.ref}</span> },
    { key: "roll", label: "Roll", default: true, align: "right", aggregate: aggSum((r) => r.roll, (n) => bold(formatPcs(n))), render: (r) => <span className="font-mono">{r.roll || "—"}</span> },
    { key: "pcs", label: "Pcs", default: true, align: "right", aggregate: aggSum((r) => r.pcs, (n) => bold(formatPcs(n))), render: (r) => <span className="font-mono">{r.pcs ? formatPcs(r.pcs) : "—"}</span> },
    { key: "sejak", label: "Sejak", default: true, render: (r) => <span className="font-mono">{formatDate(r.sejak)}</span> },
    { key: "umur", label: "Umur (hari)", default: true, align: "right", render: (r) => <span className="font-mono">{r.umur}</span> },
    { key: "batas", label: "SLA (hari)", default: true, align: "right", render: (r) => <span className="font-mono">{r.batas}</span> },
    {
      key: "lewat",
      label: "Lewat SLA",
      default: true,
      align: "right",
      sortValue: (r) => r.lewat,
      render: (r) => <StatusPill tone={r.lewat > 7 ? "danger" : r.lewat > 2 ? "warning" : "info"}>{`+${r.lewat} hari`}</StatusPill>,
    },
  ];
  const accents = ["orange", "purple", "blue", "teal"] as const;
  const topKinds = kinds
    .map((k) => ({ k, n: visible.filter((r) => r.kendala === k).length }))
    .sort((a, b) => b.n - a.n)
    .slice(0, 4);

  return (
    <>
      <div className="grid grid-cols-4 gap-3 max-lg:grid-cols-2">
        {topKinds.length === 0 && <KpiCard label="Kendala" value={0} sub="tidak ada yang lewat SLA" accent="teal" />}
        {topKinds.map((t, i) => (
          <KpiCard
            key={t.k}
            label={t.k}
            value={t.n}
            sub={`${formatPcs(visible.filter((r) => r.kendala === t.k).reduce((s, r) => s + (r.roll || 0), 0))} roll · lewat SLA`}
            accent={accents[i]}
            active={preset.card === t.k}
            onClick={() => setPreset((p) => (p.card === t.k ? { nonce: p.nonce + 1, filters: {} as Record<string, string[]>, card: "" } : { nonce: p.nonce + 1, filters: { Kendala: [t.k] }, card: t.k }))}
          />
        ))}
      </div>
      <DataTable<OpsIssue>
        title="Kendala operasional (lewat SLA)"
        subtitle={"SLA: " + rules.map((r) => `${r.label} ${r.days} hari`).join(" · ")}
        columns={columns}
        rows={rows}
        keyOf={(r) => r.key}
        firstColumnLabel="Kendala"
        firstColumnRender={(r) => <span className="font-medium">{r.kendala}</span>}
        filterDefs={filterDefs}
        filterPreset={preset}
        defaultGroupBy={["Kendala"]}
        search={{ placeholder: "Cari MRP, vendor, supplier, warna, referensi…", getText: (r) => `${r.kendala} ${r.mrpId} ${vendorName(r.vendorProduksi)} ${r.supplier} ${r.warna} ${r.ref}` }}
        onFilteredRows={(list) => setShown(new Set(list.map((r) => r.key)))}
        emptyText="Tidak ada kendala yang melewati SLA."
      />
    </>
  );
}

// ------------------------------------------------------------------------------------------------ Yield
/** Yield per roll, dikelompokkan per MRP dan vendor (baris kelompok = yield tertimbang). Yield cutting = hasil cutting / target roll;
 *  yield FG = Finish Good / hasil cutting (roll yang sudah ditutup). */
export function RollYieldTable() {
  const batches = useMrpStore((s) => s.productionBatches);
  const mrpDetails = useMrpStore((s) => s.mrpDetails);
  const rows = useMemo(() => buildRollYields(batches, mrpDetails), [batches, mrpDetails]);
  const [shown, setShown] = useState<Set<string> | null>(null);
  const [preset, setPreset] = useState<Preset>({ nonce: 0, filters: {}, card: "" });
  const visible = shown ? rows.filter((r) => shown.has(r.key)) : rows;
  const sum = (list: RollYieldRow[], f: (r: RollYieldRow) => number) => list.reduce((s, r) => s + f(r), 0);
  const closed = (list: RollYieldRow[]) => list.filter((r) => r.closed);
  const yc = (list: RollYieldRow[]) => yieldPct(sum(list, (r) => r.cutting), sum(list, (r) => r.target));
  const yf = (list: RollYieldRow[]) => yieldPct(sum(closed(list), (r) => r.fg), sum(closed(list), (r) => r.cutting));
  const below = (r: RollYieldRow) => r.target > 0 && (r.cutting / r.target) * 100 < YIELD_ALERT_THRESHOLD_PCT;
  const yTone = (p: number | null) => (p == null ? "" : p < YIELD_ALERT_THRESHOLD_PCT ? "text-danger-fg" : "text-success-fg");

  const filterDefs: FilterDef<RollYieldRow>[] = [
    { label: "No. MRP", options: uniq(rows.map((r) => r.mrpId)).reverse(), test: (r, v) => r.mrpId === v },
    { label: "Vendor", options: uniq(rows.map((r) => vendorName(r.vendorProduksi))), test: (r, v) => vendorName(r.vendorProduksi) === v },
    { label: "Warna", options: uniq(rows.map((r) => r.warna)), test: (r, v) => r.warna === v },
    { label: "Yield cutting", options: [`< ${YIELD_ALERT_THRESHOLD_PCT}%`, `>= ${YIELD_ALERT_THRESHOLD_PCT}%`], test: (r, v) => (v.startsWith("<") ? below(r) : !below(r)) },
    { label: "Roll", options: ["Sudah ditutup", "Belum ditutup"], test: (r, v) => (v === "Sudah ditutup") === r.closed },
  ];
  const columns: ColumnDef<RollYieldRow>[] = [
    { key: "mrp", label: "No. MRP", default: false, aggregate: aggSame((r) => r.mrpId), render: (r) => <span className="font-mono">{r.mrpId}</span> },
    { key: "vendor", label: "Vendor", default: false, aggregate: aggSame((r) => vendorName(r.vendorProduksi)), render: (r) => vendorName(r.vendorProduksi) },
    { key: "warna", label: "Warna", default: true, aggregate: aggSame((r) => r.warna), render: (r) => `${r.warna} ${r.lengan === "PENDEK" ? "PDK" : "PJG"}` },
    { key: "gramasi", label: "Gramasi", default: false, align: "right", render: (r) => <span className="font-mono">{r.gramasi || "—"}</span> },
    { key: "tgl", label: "Tgl Cutting", default: true, render: (r) => <span className="font-mono">{formatDate(r.cuttingAt)}</span> },
    { key: "target", label: "Target", default: true, align: "right", aggregate: aggSum((r) => r.target, (n) => bold(formatPcs(n))), render: (r) => <span className="font-mono">{formatPcs(r.target)}</span> },
    { key: "cutting", label: "Cutting", default: true, align: "right", aggregate: aggSum((r) => r.cutting, (n) => bold(formatPcs(n))), render: (r) => <span className="font-mono">{formatPcs(r.cutting)}</span> },
    { key: "fg", label: "Finish Good", default: true, align: "right", aggregate: aggSum((r) => r.fg, (n) => bold(formatPcs(n))), render: (r) => <span className="font-mono">{formatPcs(r.fg)}</span> },
    {
      key: "yc",
      label: "Yield Cutting",
      default: true,
      align: "right",
      sortValue: (r) => yc([r]),
      aggregate: (list) => <span className={"font-semibold " + yTone(yc(list))}>{pctText(yc(list))}</span>,
      render: (r) => <span className={"font-mono " + yTone(yc([r]))}>{pctText(yc([r]))}</span>,
    },
    {
      key: "yf",
      label: "Yield FG",
      default: true,
      align: "right",
      sortValue: (r) => yf([r]),
      info: { title: "Yield FG", body: <p>Finish Good dibagi hasil cutting, hanya roll yang sudah ditutup (Done FG).</p> },
      aggregate: (list) => <span className="font-semibold">{pctText(yf(list))}</span>,
      render: (r) => <span className="font-mono">{r.closed ? pctText(yf([r])) : "—"}</span>,
    },
  ];
  return (
    <>
      <div className="grid grid-cols-4 gap-3 max-lg:grid-cols-2">
        <KpiCard label="Yield cutting" value={pctText(yc(visible))} sub={`${formatPcs(sum(visible, (r) => r.cutting))} dari target ${formatPcs(sum(visible, (r) => r.target))} pcs`} accent="blue" />
        <KpiCard label="Yield FG" value={pctText(yf(visible))} sub={`${closed(visible).length} roll sudah ditutup`} accent="teal" />
        <KpiCard
          label={`Roll < ${YIELD_ALERT_THRESHOLD_PCT}%`}
          value={visible.filter(below).length}
          sub="klik untuk menyaring"
          accent="orange"
          active={preset.card === "below"}
          onClick={() => setPreset((p) => (p.card === "below" ? { nonce: p.nonce + 1, filters: {} as Record<string, string[]>, card: "" } : { nonce: p.nonce + 1, filters: { "Yield cutting": [`< ${YIELD_ALERT_THRESHOLD_PCT}%`] }, card: "below" }))}
        />
        <KpiCard label="Roll dicutting" value={visible.length} sub="roll yang tampil" accent="purple" />
      </div>
      <DataTable<RollYieldRow>
        title="Yield per roll"
        subtitle="Kelompokkan per MRP atau vendor untuk yield per MRP / per vendor (baris kelompok = yield tertimbang)"
        columns={columns}
        rows={rows}
        keyOf={(r) => r.key}
        firstColumnLabel="Code Roll"
        firstColumnRender={(r) => <span className="font-mono">{r.codeRoll || "—"}</span>}
        filterDefs={filterDefs}
        filterPreset={preset}
        defaultGroupBy={["No. MRP", "Vendor"]}
        search={{ placeholder: "Cari code roll, MRP, vendor, warna…", getText: (r) => `${r.codeRoll} ${r.mrpId} ${vendorName(r.vendorProduksi)} ${r.warna}` }}
        onFilteredRows={(list) => setShown(new Set(list.map((r) => r.key)))}
        emptyText="Belum ada roll yang dicutting."
      />
    </>
  );
}

// ------------------------------------------------------------------------------------------------ HPP per MRP
/** Estimasi HPP (sampai Approval PO: nilai PO + estimasi ongkir) dan HPP aktual (Laporan HPP: roll yang sudah dikirim dan diinvoice vendor)
 *  per MRP, berdampingan. */
export function MrpHppTable({ rows }: { rows: MrpProgressRow[] }) {
  const vendorInvoices = useMrpStore((s) => s.vendorInvoices);
  const mrpDetails = useMrpStore((s) => s.mrpDetails);
  const staticMrps = useMrpStore((s) => s.staticMrps);
  const batches = useMrpStore((s) => s.productionBatches);
  const results = useMrpStore((s) => s.productionResults);
  const meta = useMrpStore((s) => s.productionGroupMeta);
  const rawInvoices = useMrpStore((s) => s.invoices);
  const kolis = useMrpStore((s) => s.deliveryKolis);
  const rates = useMrpStore((s) => s.ekspedisiRates);
  const prices = useMrpStore((s) => s.itemSellingPrices);
  const warnaAliases = useMrpStore((s) => s.warnaAliases);
  const actual = useMemo(() => {
    const relevant = vendorInvoices.filter((i) => i.status !== "REVISION");
    const acc = new Map<string, { hpp: number; jual: number; fg: number; hppAll: number }>();
    for (const inv of relevant)
      for (const r of hppRowsForInvoicePerRoll(inv, relevant, mrpDetails, staticMrps, batches, results, meta, rawInvoices, kolis, rates, prices)) {
        if (r.fg <= 0) continue;
        const a = acc.get(r.mrpId) ?? { hpp: 0, jual: 0, fg: 0, hppAll: 0 };
        a.fg += r.fg;
        a.hppAll += r.hppPerItem * r.fg;
        if (r.sellingPricePerItem && r.sellingPricePerItem > 0) {
          a.hpp += r.hppPerItem * r.fg;
          a.jual += r.sellingPricePerItem * r.fg;
        }
        acc.set(r.mrpId, a);
      }
    return acc;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vendorInvoices, mrpDetails, staticMrps, batches, results, meta, rawInvoices, kolis, rates, prices, warnaAliases]);
  type Row = MrpProgressRow & { act?: { hpp: number; jual: number; fg: number; hppAll: number } };
  const data: Row[] = rows.map((r) => ({ ...r, act: actual.get(r.mrp.id) }));
  const actPct = (r: Row) => (r.act && r.act.jual > 0 ? (r.act.hpp / r.act.jual) * 100 : null);
  const columns: ColumnDef<Row>[] = [
    { key: "estMaterial", label: "Est. Material", default: true, align: "right", aggregate: aggSum((r) => r.hpp.material, (n) => bold(formatRupiah(n))), render: (r) => <span className="font-mono">{formatRupiah(r.hpp.material)}</span> },
    { key: "estMaklon", label: "Est. Maklon", default: true, align: "right", aggregate: aggSum((r) => r.hpp.maklon, (n) => bold(formatRupiah(n))), render: (r) => <span className="font-mono">{formatRupiah(r.hpp.maklon)}</span> },
    { key: "estOngkir", label: "Est. Delivery", default: true, align: "right", aggregate: aggSum((r) => r.hpp.delivery, (n) => bold(formatRupiah(n))), render: (r) => <span className="font-mono">{formatRupiah(r.hpp.delivery)}</span> },
    { key: "jual", label: "Nilai Jual", default: true, align: "right", aggregate: aggSum((r) => r.hpp.hargaJual, (n) => bold(formatRupiah(n))), render: (r) => <span className="font-mono">{formatRupiah(r.hpp.hargaJual)}</span> },
    { key: "estPct", label: "Est. HPP %", default: true, align: "right", sortValue: (r) => r.hpp.pct ?? null, render: (r) => <EstHppCell hpp={r.hpp} /> },
    { key: "fg", label: "FG terkirim", default: true, align: "right", aggregate: aggSum((r) => r.act?.fg ?? 0, (n) => bold(formatPcs(n))), render: (r) => <span className="font-mono">{r.act ? formatPcs(r.act.fg) : "—"}</span> },
    { key: "hppAct", label: "HPP aktual/pcs", default: true, align: "right", sortValue: (r) => (r.act && r.act.fg > 0 ? r.act.hppAll / r.act.fg : null), render: (r) => <span className="font-mono">{r.act && r.act.fg > 0 ? formatRupiah(r.act.hppAll / r.act.fg) : "—"}</span> },
    { key: "actPct", label: "HPP aktual %", default: true, align: "right", sortValue: (r) => actPct(r), render: (r) => <span className="font-mono font-semibold">{pctText(actPct(r))}</span> },
  ];
  return (
    <DataTable<Row>
      title="HPP per MRP"
      subtitle="Est. HPP = nilai PO Material + PO Produksi + estimasi ongkir (sejak Approval PO). HPP aktual = Laporan HPP (roll yang sudah dikirim dan diinvoice vendor)."
      columns={columns}
      rows={data}
      keyOf={(r) => r.mrp.id}
      firstColumnLabel="No. MRP"
      firstColumnRender={(r) => <span className="font-mono font-medium">{r.mrp.id}</span>}
      search={{ placeholder: "Cari MRP…", getText: (r) => r.mrp.id }}
      emptyText="Belum ada MRP."
    />
  );
}
