"use client";

import { useMemo } from "react";
import { StageBadge } from "@/components/ui/stage-badge";
import { aggSame, aggSum, type ColumnDef, type FilterDef } from "@/components/mrp/data-table";
import { useMrpStore, type MrpDetail } from "@/lib/mrp/store";
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
  type MrpHppEstimate,
} from "@/lib/mrp/flowStatus";
import type { MaklonPO, Mrp } from "@/lib/mrp/types";

/** Satu baris MRP dengan status staging standar dan estimasi HPP -- dipakai bersama SCM (Monitoring, riwayat Approval MRP) supaya tampilan
 *  dan angkanya sama dengan tabel MRP di PPIC (owner 2026-11-16: "tampilan history MRP sama dengan PPIC"). */
export type MrpProgressRow = {
  mrp: Mrp;
  detail?: MrpDetail;
  vendors: string[];
  roll: number;
  stage: FlowStage | FlowSideStatus;
  rollsByStage: Partial<Record<FlowStage, number>>;
  hpp: MrpHppEstimate;
};

export function useMrpProgressRows(): MrpProgressRow[] {
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
  return useMemo(() => {
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
          stage: flow.stage,
          rollsByStage: flow.rollsByStage,
          hpp: mrpHppEstimate(detail, mrp.id, materialPOs, maklonPOs, ongkir, itemSellingPrices),
        };
      });
  }, [mrpDetails, staticMrps, materialPOs, maklonPOs, invoices, productionBatches, deliveryKolis, warehouseReceipts, materialClaimHistory, ekspedisiRates, itemSellingPrices]);
}

const formatRp = (n: number) => "Rp " + Math.round(n).toLocaleString("id-ID");

export function EstHppCell({ hpp }: { hpp: MrpHppEstimate }) {
  if (hpp.pct == null || hpp.material + hpp.maklon === 0) return <span className="text-text-muted">—</span>;
  return (
    <span
      className={"font-mono font-semibold " + (hpp.pct > 100 ? "text-danger-fg" : hpp.pct > 80 ? "text-warning-fg" : "text-success-fg")}
      title={`Material ${formatRp(hpp.material)} + Maklon ${formatRp(hpp.maklon)} + Est. ongkir ${formatRp(hpp.delivery)} = ${formatRp(hpp.total)}\nNilai jual ${formatRp(hpp.hargaJual)}`}
    >
      {hpp.pct.toLocaleString("id-ID", { maximumFractionDigits: 1 })}%
    </span>
  );
}

/** Kolom yang sama dengan tabel MRP PPIC (Qty, Roll, Status, Est. HPP %, lima tanggal). */
export function mrpProgressColumns<R extends MrpProgressRow>(maklonPOs: MaklonPO[]): ColumnDef<R>[] {
  return [
    { key: "kategori", label: "Kategori", default: false, aggregate: aggSame<R>((r) => r.mrp.kategori), render: (r) => r.mrp.kategori },
    {
      key: "qty",
      label: "Qty",
      default: true,
      align: "right",
      aggregate: aggSum<R>((r) => effectiveMrpQty(r.mrp.id, r.mrp.qty, maklonPOs), (n) => <span className="font-semibold">{formatPcs(n)}</span>),
      render: (r) => <span className="font-mono">{formatPcs(effectiveMrpQty(r.mrp.id, r.mrp.qty, maklonPOs))}</span>,
    },
    {
      key: "roll",
      label: "Roll",
      default: true,
      align: "right",
      aggregate: aggSum<R>((r) => r.roll, (n) => <span className="font-semibold">{n.toLocaleString("id-ID", { maximumFractionDigits: 2 })}</span>),
      render: (r) => <span className="font-mono">{r.roll.toLocaleString("id-ID", { maximumFractionDigits: 2 })}</span>,
    },
    { key: "vendor", label: "Vendor", default: false, render: (r) => (r.vendors.length ? r.vendors.join(", ") : "—") },
    {
      key: "status",
      label: "Status",
      default: true,
      sortValue: (r) => String((FLOW_STAGES as readonly string[]).indexOf(r.stage)).padStart(2, "0"),
      aggregate: aggSame<R>((r) => r.stage, (v) => <StageBadge stages={FLOW_STAGES} current={v} tone={v === "Ditolak" ? "danger" : undefined} />),
      render: (r) => (
        <span title={rollsByStageText(r.rollsByStage) || undefined}>
          <StageBadge stages={FLOW_STAGES} current={r.stage} tone={r.stage === "Ditolak" ? "danger" : undefined} />
        </span>
      ),
    },
    { key: "estHpp", label: "Est. HPP %", default: true, align: "right", sortValue: (r) => r.hpp.pct ?? null, render: (r) => <EstHppCell hpp={r.hpp} /> },
    { key: "tglMrp", label: "Tgl MRP", default: true, render: (r) => <span className="font-mono">{formatDate(r.detail?.dates?.created)}</span> },
    { key: "tglPO", label: "Tgl PO", default: true, render: (r) => <span className="font-mono">{formatDate(r.detail?.dates?.poSent)}</span> },
    { key: "tglApproved", label: "Tgl Approve PO", default: true, render: (r) => <span className="font-mono">{formatDate(r.detail?.dates?.poApproved)}</span> },
    { key: "tglInvoice", label: "Tgl Invoice", default: true, render: (r) => <span className="font-mono">{formatDate(r.detail?.dates?.firstInvoice)}</span> },
    { key: "tglPayment", label: "Tgl Bayar", default: true, render: (r) => <span className="font-mono">{formatDate(r.detail?.dates?.firstPayment)}</span> },
  ];
}

export function mrpProgressFilters<R extends MrpProgressRow>(rows: R[]): FilterDef<R>[] {
  const uniq = (xs: string[]) => Array.from(new Set(xs.filter(Boolean))).sort();
  return [
    { label: "Status", options: ["Ditolak", ...FLOW_STAGES].filter((st) => rows.some((r) => r.stage === st)), test: (r, v) => r.stage === v },
    { label: "Vendor", options: uniq(rows.flatMap((r) => r.vendors)), test: (r, v) => r.vendors.includes(v) },
    { label: "Kategori", options: uniq(rows.map((r) => r.mrp.kategori)), test: (r, v) => r.mrp.kategori === v },
  ];
}
