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
  returnedRollKeys,
  rollsByStageText,
  type FlowSideStatus,
  type FlowStage,
  type MrpHppEstimate,
} from "@/lib/mrp/flowStatus";
import type { MaklonPO, Mrp } from "@/lib/mrp/types";
import { estimateMrpHpp, toMrpHppEstimate, type PoHppEstimate } from "@/lib/mrp/poHppEstimate";
import { hppPctText, hppPctTone } from "@/components/mrp/hpp-estimate-section";
import { useHppContext } from "@/components/mrp/use-hpp-context";

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
  /** Estimasi HPP lengkap (rincian per vendor x warna x lengan) untuk panel rincian, mis. Approval MRP. */
  hppEst: PoHppEstimate;
};

export function useMrpProgressRows(): MrpProgressRow[] {
  const mrpDetails = useMrpStore((s) => s.mrpDetails);
  const staticMrps = useMrpStore((s) => s.staticMrps);
  const materialPOs = useMrpStore((s) => s.materialPOs);
  const invoices = useMrpStore((s) => s.invoices);
  const productionBatches = useMrpStore((s) => s.productionBatches);
  const deliveryKolis = useMrpStore((s) => s.deliveryKolis);
  const warehouseReceipts = useMrpStore((s) => s.warehouseReceipts);
  const materialClaimHistory = useMrpStore((s) => s.materialClaimHistory);
  // Estimasi HPP: satu rumus bersama (lib/mrp/poHppEstimate.ts), sama dengan Approval PO dan Tracking Item (owner 2026-11-27).
  const hppCtx = useHppContext();
  return useMemo(() => {
    const batchByCode = new Map(productionBatches.filter((b) => b.codeRoll).map((b) => [b.codeRoll as string, b]));
    const shipping = batchShippingMap(deliveryKolis, warehouseReceipts);
    const returned = returnedRollKeys(materialClaimHistory);
    const all: { mrp: Mrp; detail?: MrpDetail }[] = [...mrpDetails.map((d) => ({ mrp: d.mrp, detail: d })), ...staticMrps.map((m) => ({ mrp: m }))];
    return all
      .map((x, idx) => ({ ...x, idx, created: x.detail?.dates?.created ?? "" }))
      .sort((a, b) => (a.created < b.created ? 1 : a.created > b.created ? -1 : b.idx - a.idx))
      .map(({ mrp, detail }) => {
        const hppEst = estimateMrpHpp(mrp.id, hppCtx);
        const flow = mrpFlowStage(detail, mrp.id, materialPOs, invoices, batchByCode, shipping, returned);
        return {
          mrp,
          detail,
          vendors: vendorsForMrp(detail),
          roll: mrpWarnaBreakdown(detail).reduce((s, w) => s + w.rollTotal, 0),
          stage: flow.stage,
          rollsByStage: flow.rollsByStage,
          hpp: toMrpHppEstimate(hppEst),
          hppEst,
        };
      });
  }, [mrpDetails, staticMrps, materialPOs, invoices, productionBatches, deliveryKolis, warehouseReceipts, materialClaimHistory, hppCtx]);
}

const formatRp = (n: number) => "Rp " + Math.round(n).toLocaleString("id-ID");

export function EstHppCell({ hpp }: { hpp: MrpHppEstimate }) {
  if (hpp.pct == null || hpp.material + hpp.maklon === 0) return <span className="text-text-muted">—</span>;
  return (
    <span
      className={"font-mono font-semibold " + hppPctTone(hpp.pct)}
      title={`Bahan + rib - diskon ${formatRp(hpp.material)} + Maklon ${formatRp(hpp.maklon)} + Est. ongkir ${formatRp(hpp.delivery)} = ${formatRp(hpp.total)}\nNilai jual ${formatRp(hpp.hargaJual)}`}
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
    {
      key: "estHppTotal",
      label: "Est. HPP",
      default: true,
      align: "right",
      info: { title: "Estimasi HPP", body: "Bahan + rib - diskon + maklon (matriks vendor, jenis, lengan) + ongkir rata-rata per kategori untuk seluruh qty MRP. Angka kecil = HPP per pcs. Rincian: buka baris MRP." },
      sortValue: (r) => r.hppEst.hpp,
      aggregate: aggSum<R>((r) => r.hppEst.hpp, (n) => <span className="font-semibold">{formatRp(n)}</span>),
      render: (r) =>
        r.hppEst.pcs > 0 ? (
          <span className="block text-right font-mono">
            {formatRp(r.hppEst.hpp)}
            <span className="block text-[10px] text-text-muted">{formatRp(r.hppEst.hppPerPcs)}/pcs</span>
          </span>
        ) : (
          <span className="text-text-muted">—</span>
        ),
    },
    {
      key: "estHpp",
      label: "Est. HPP %",
      default: true,
      align: "right",
      sortValue: (r) => r.hpp.pct ?? null,
      render: (r) => (r.hppEst.pcs > 0 ? <span className={"font-mono font-semibold " + hppPctTone(r.hppEst.pct)}>{hppPctText(r.hppEst.pct)}</span> : <EstHppCell hpp={r.hpp} />),
    },
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
