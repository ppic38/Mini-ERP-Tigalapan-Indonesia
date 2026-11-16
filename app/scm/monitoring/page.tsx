"use client";

import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/shell/app-shell";
import { KpiCard } from "@/components/ui/kpi-card";
import { StageBadge } from "@/components/ui/stage-badge";
import { DataTable, aggSame, aggSum, type ColumnDef, type FilterDef } from "@/components/mrp/data-table";
import { MrpWarnaBreakdownTable } from "@/components/mrp/mrp-warna-breakdown-table";
import { useMrpStore } from "@/lib/mrp/store";
import { effectiveMrpQty, formatDate, formatPcs, mrpWarnaBreakdown, vendorsForMrp } from "@/lib/mrp/derive";
import {
  FLOW_STAGES,
  batchShippingMap,
  mrpFlowStage,
  mrpHppEstimate,
  ongkirPerPcsByVendor,
  returnedRollKeys,
  rollsByStageText,
  type FlowSideStatus,
  type FlowStage,
} from "@/lib/mrp/flowStatus";
import type { Mrp } from "@/lib/mrp/types";
import type { MrpDetail } from "@/lib/mrp/store";

type St = FlowStage | FlowSideStatus;
const formatRp = (n: number) => "Rp " + Math.round(n).toLocaleString("id-ID");

/** Monitoring progress SCM (redesign 2026-11-16, pola PPIC): satu baris per MRP dengan status staging standar (lib/mrp/flowStatus.ts),
 *  estimasi HPP %, kartu angka yang mengikuti filter, dan rincian warna di panel samping. Hanya baca. */
export default function ScmMonitoringPage() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const mrpDetails = useMrpStore((s) => s.mrpDetails);
  const staticMrps = useMrpStore((s) => s.staticMrps);
  const materialPOs = useMrpStore((s) => s.materialPOs);
  const maklonPOs = useMrpStore((s) => s.maklonPOs);
  const invoices = useMrpStore((s) => s.invoices);
  const productionBatches = useMrpStore((s) => s.productionBatches);
  const deliveryKolis = useMrpStore((s) => s.deliveryKolis);
  const warehouseReceipts = useMrpStore((s) => s.warehouseReceipts);
  const materialClaimHistory = useMrpStore((s) => s.materialClaimHistory);
  const ekspedisiRates = useMrpStore((s) => s.ekspedisiRates);
  const itemSellingPrices = useMrpStore((s) => s.itemSellingPrices);

  const [shownIds, setShownIds] = useState<Set<string> | null>(null);
  const [preset, setPreset] = useState<{ nonce: number; filters: Record<string, string[]>; card: string }>({ nonce: 0, filters: {}, card: "" });

  const rows = useMemo(() => {
    const batchByCode = new Map(productionBatches.filter((b) => b.codeRoll).map((b) => [b.codeRoll as string, b]));
    const shipping = batchShippingMap(deliveryKolis, warehouseReceipts);
    const returned = returnedRollKeys(materialClaimHistory);
    const ongkir = ongkirPerPcsByVendor(deliveryKolis, ekspedisiRates);
    const all: { mrp: Mrp; detail?: MrpDetail }[] = [...mrpDetails.map((d) => ({ mrp: d.mrp, detail: d })), ...staticMrps.map((m) => ({ mrp: m }))];
    return all
      .map((x, idx) => ({ ...x, idx, created: x.detail?.dates?.created ?? "" }))
      .sort((a, b) => (a.created < b.created ? 1 : a.created > b.created ? -1 : b.idx - a.idx))
      .map(({ mrp, detail }) => {
        const flow = mrpFlowStage(detail, mrp.id, materialPOs, invoices, batchByCode, shipping, returned);
        return {
          mrp,
          detail,
          vendors: vendorsForMrp(detail),
          roll: mrpWarnaBreakdown(detail).reduce((s, w) => s + w.rollTotal, 0),
          stage: flow.stage as St,
          rollsByStage: flow.rollsByStage,
          hpp: mrpHppEstimate(detail, mrp.id, materialPOs, maklonPOs, ongkir, itemSellingPrices),
        };
      });
  }, [mrpDetails, staticMrps, materialPOs, maklonPOs, invoices, productionBatches, deliveryKolis, warehouseReceipts, materialClaimHistory, ekspedisiRates, itemSellingPrices]);
  type Row = (typeof rows)[number];

  if (!mounted) return null;

  const uniq = (xs: string[]) => Array.from(new Set(xs.filter(Boolean))).sort();
  const filterDefs: FilterDef<Row>[] = [
    { label: "Status", options: ["Ditolak", ...FLOW_STAGES].filter((st) => rows.some((r) => r.stage === st)), test: (r, v) => r.stage === v },
    { label: "Vendor", options: uniq(rows.flatMap((r) => r.vendors)), test: (r, v) => r.vendors.includes(v) },
    { label: "Kategori", options: uniq(rows.map((r) => r.mrp.kategori)), test: (r, v) => r.mrp.kategori === v },
  ];
  const columns: ColumnDef<Row>[] = [
    { key: "kategori", label: "Kategori", default: false, aggregate: aggSame((r) => r.mrp.kategori), render: (r) => r.mrp.kategori },
    { key: "qty", label: "Qty", default: true, align: "right", aggregate: aggSum((r) => effectiveMrpQty(r.mrp.id, r.mrp.qty, maklonPOs), (n) => <span className="font-semibold">{formatPcs(n)}</span>), render: (r) => <span className="font-mono">{formatPcs(effectiveMrpQty(r.mrp.id, r.mrp.qty, maklonPOs))}</span> },
    { key: "roll", label: "Roll", default: true, align: "right", aggregate: aggSum((r) => r.roll, (n) => <span className="font-semibold">{n.toLocaleString("id-ID", { maximumFractionDigits: 2 })}</span>), render: (r) => <span className="font-mono">{r.roll.toLocaleString("id-ID", { maximumFractionDigits: 2 })}</span> },
    { key: "vendor", label: "Vendor", default: true, render: (r) => (r.vendors.length ? r.vendors.join(", ") : "—") },
    {
      key: "status",
      label: "Status",
      default: true,
      aggregate: aggSame((r) => r.stage, (v) => <StageBadge stages={FLOW_STAGES} current={v} tone={v === "Ditolak" ? "danger" : undefined} />),
      render: (r) => (
        <span title={rollsByStageText(r.rollsByStage) || undefined}>
          <StageBadge stages={FLOW_STAGES} current={r.stage} tone={r.stage === "Ditolak" ? "danger" : undefined} />
        </span>
      ),
    },
    {
      key: "estHpp",
      label: "Est. HPP %",
      default: true,
      align: "right",
      render: (r) =>
        r.hpp.pct == null || r.hpp.material + r.hpp.maklon === 0 ? (
          <span className="text-text-muted">—</span>
        ) : (
          <span
            className={"font-mono font-semibold " + (r.hpp.pct > 100 ? "text-danger-fg" : r.hpp.pct > 80 ? "text-warning-fg" : "text-success-fg")}
            title={`Material ${formatRp(r.hpp.material)} + Maklon ${formatRp(r.hpp.maklon)} + Est. ongkir ${formatRp(r.hpp.delivery)} = ${formatRp(r.hpp.total)} / Nilai jual ${formatRp(r.hpp.hargaJual)}`}
          >
            {r.hpp.pct.toLocaleString("id-ID", { maximumFractionDigits: 1 })}%
          </span>
        ),
    },
    { key: "tglMrp", label: "Tgl MRP", default: true, render: (r) => <span className="font-mono">{formatDate(r.detail?.dates?.created)}</span> },
    { key: "tglApproved", label: "Tgl Approve PO", default: true, render: (r) => <span className="font-mono">{formatDate(r.detail?.dates?.poApproved)}</span> },
    { key: "tglPayment", label: "Tgl Bayar", default: false, render: (r) => <span className="font-mono">{formatDate(r.detail?.dates?.firstPayment)}</span> },
  ];

  const shown = shownIds ? rows.filter((r) => shownIds.has(r.mrp.id)) : rows;
  const cards: { key: string; label: string; sub: string; accent: "orange" | "purple" | "blue" | "teal"; stages: St[] }[] = [
    { key: "approval", label: "Approval", sub: "Approval MRP dan Approval PO", accent: "orange", stages: ["Approval MRP", "Ditolak", "Approval PO"] },
    { key: "material", label: "Material", sub: "PV Material s/d Receiving Material", accent: "purple", stages: ["PV Material", "Paid", "Delivery Material", "Receiving Material"] },
    { key: "produksi", label: "Produksi", sub: "Resting s/d Packing", accent: "blue", stages: ["Resting", "Cutting", "Finish Good", "Done FG", "Packing"] },
    { key: "kirim", label: "Delivery & GR DC", sub: "dikirim vendor atau diterima gudang", accent: "teal", stages: ["Delivery", "GR DC"] },
  ];

  return (
    <AppShell role="scm" activeHref="/scm/monitoring" breadcrumb={["Dashboard", "Monitoring"]} title="Monitoring Progress">
      <div className="grid grid-cols-4 gap-3 max-lg:grid-cols-2">
        {cards.map((c) => (
          <KpiCard
            key={c.key}
            label={c.label}
            value={shown.filter((r) => c.stages.includes(r.stage)).length}
            sub={c.sub}
            accent={c.accent}
            active={preset.card === c.key}
            onClick={() =>
              setPreset((p) =>
                p.card === c.key
                  ? { nonce: p.nonce + 1, filters: {} as Record<string, string[]>, card: "" }
                  : { nonce: p.nonce + 1, filters: { Status: c.stages.filter((st) => rows.some((r) => r.stage === st)) as string[] }, card: c.key }
              )
            }
          />
        ))}
      </div>
      <DataTable<Row>
        title="Progress MRP"
        columns={columns}
        rows={rows}
        keyOf={(r) => r.mrp.id}
        firstColumnLabel="No. MRP"
        firstColumnRender={(r) => <span className="font-mono font-medium">{r.mrp.id}</span>}
        filterDefs={filterDefs}
        filterPreset={preset}
        search={{ placeholder: "Cari MRP, kategori, vendor…", getText: (r) => `${r.mrp.id} ${r.mrp.kategori} ${r.vendors.join(" ")} ${r.stage}` }}
        onFilteredRows={(list) => setShownIds(new Set(list.map((r) => r.mrp.id)))}
        renderExpanded={(r) => <MrpWarnaBreakdownTable breakdown={mrpWarnaBreakdown(r.detail)} />}
        panelWidth={1040}
        emptyText="Belum ada MRP yang tercatat."
      />
    </AppShell>
  );
}
