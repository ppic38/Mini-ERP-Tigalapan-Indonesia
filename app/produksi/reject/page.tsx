"use client";

import { useEffect, useState } from "react";
import { ChevronRight } from "lucide-react";
import { AppShell } from "@/components/shell/app-shell";
import { StatusPill } from "@/components/ui/status-pill";
import { DataTable, type ColumnDef } from "@/components/mrp/data-table";
import { useMrpStore } from "@/lib/mrp/store";
import { formatPcs, vendorItemSizeProgress } from "@/lib/mrp/derive";
import { VENDOR_PRODUKSI } from "@/lib/mrp/seed";
import type { MaklonPO } from "@/lib/mrp/types";

/** Monitoring Reject & Rework (owner 2026-09-18) -- data reject/rework SUDAH ADA & sudah dihitung
 *  lewat vendorItemSizeProgress (dipakai "Monitoring Produksi"), halaman ini murni menyusun ulang
 *  angka yang sama supaya kelihatan langsung PO mana yang paling banyak reject & berapa yang sudah
 *  berhasil di-rework jadi baju vs yang masih murni reject (belum diapa-apakan). "Sisa reject" =
 *  reject tercatat - rework -- SAMA seperti pola "reject tercatat / sudah dirework / sisa reject"
 *  di tab Reject production-result-panel.tsx (reject dari reworkQtyForGroup itu sendiri sudah
 *  dikurangkan lewat vendorItemSizeProgress -> cumulativeSizeQtyForGroup "REJECT" yang menghitung
 *  bersih net dari entri REJECT positif+negatif, lihat cumulativeSizeQtyForGroup). */
type RejectRow = { warna: string; lengan: string; size: string; reject: number; rework: number };

function poRejectSummary(po: MaklonPO, mrpDetails: ReturnType<typeof useMrpStore.getState>["mrpDetails"], batches: ReturnType<typeof useMrpStore.getState>["productionBatches"], results: ReturnType<typeof useMrpStore.getState>["productionResults"]) {
  const items = vendorItemSizeProgress(po.mrpId, po.vendorProduksi, mrpDetails, batches, results);
  const totalReject = items.reduce((a, r) => a + r.reject, 0);
  const totalRework = items.reduce((a, r) => a + r.rework, 0);
  return { items, totalReject, totalRework, sisaReject: Math.max(0, totalReject - totalRework) };
}

function RejectDetailTable({ po }: { po: MaklonPO }) {
  const mrpDetails = useMrpStore((s) => s.mrpDetails);
  const productionBatches = useMrpStore((s) => s.productionBatches);
  const productionResults = useMrpStore((s) => s.productionResults);

  const { items } = poRejectSummary(po, mrpDetails, productionBatches, productionResults);
  const rows: RejectRow[] = items.filter((r) => r.reject > 0 || r.rework > 0).map((r) => ({ warna: r.warna, lengan: r.lengan, size: r.size, reject: r.reject, rework: r.rework }));

  if (rows.length === 0) {
    return <div className="rounded-md border border-[#E4E9EE] bg-white px-3 py-2 font-sans text-[11.5px] text-text-muted">Belum ada reject tercatat untuk vendor ini di MRP tsb.</div>;
  }

  return (
    <div className="overflow-hidden rounded-md border border-[#E4E9EE] bg-white">
      <div className="bg-[#F2F4F7] px-3 py-1.5 font-sans text-[10px] font-medium uppercase tracking-wider text-text-muted">Rincian reject per warna/lengan/size</div>
      <div className="divide-y divide-[#F1F4F7]">
        {rows.map((r) => {
          const sisa = Math.max(0, r.reject - r.rework);
          return (
            <div key={r.warna + "|" + r.lengan + "|" + r.size} className="flex items-center gap-3 px-3 py-2">
              <span className="w-[170px] flex-none truncate font-sans text-[11.5px] font-medium text-[#31414F]">
                {r.warna} · {r.lengan} · {r.size}
              </span>
              <span className="w-[110px] flex-none font-mono text-[11px] text-danger-fg">{formatPcs(r.reject)} reject</span>
              <span className="w-[110px] flex-none font-mono text-[11px] text-warning-fg">{formatPcs(r.rework)} rework</span>
              <span className="flex-1 font-mono text-[11px] font-semibold text-[#31414F]">{formatPcs(sisa)} sisa reject</span>
              <StatusPill tone={sisa === 0 && r.reject > 0 ? "success" : sisa > 0 ? "danger" : "neutral"}>{sisa === 0 && r.reject > 0 ? "SEMUA DIREWORK" : sisa > 0 ? "PERLU REWORK" : "—"}</StatusPill>
            </div>
          );
        })}
      </div>
    </div>
  );
}

type MrpGroup = { mrpId: string; vendorPOs: MaklonPO[] };

function MrpVendorDrilldown({ group }: { group: MrpGroup }) {
  const [selectedId, setSelectedId] = useState<string | null>(group.vendorPOs.length === 1 ? group.vendorPOs[0].id : null);
  const mrpDetails = useMrpStore((s) => s.mrpDetails);
  const productionBatches = useMrpStore((s) => s.productionBatches);
  const productionResults = useMrpStore((s) => s.productionResults);
  const selected = group.vendorPOs.find((p) => p.id === selectedId) ?? null;

  return (
    <div className="flex flex-col gap-2">
      {selected && group.vendorPOs.length > 1 && (
        <button onClick={() => setSelectedId(null)} className="self-start font-sans text-[11.5px] font-semibold text-action-primary underline">
          ← Ganti vendor ({group.vendorPOs.length} vendor mengerjakan MRP ini)
        </button>
      )}
      {!selected ? (
        <div className="flex flex-col gap-1.5">
          {group.vendorPOs.map((po) => {
            const summary = poRejectSummary(po, mrpDetails, productionBatches, productionResults);
            return (
              <button
                key={po.id}
                onClick={() => setSelectedId(po.id)}
                className="flex w-full items-center gap-3 rounded-md border border-[#E4E9EE] bg-white px-3 py-2 text-left hover:bg-[#FAFBFC]"
              >
                <span className="w-[160px] flex-none truncate font-sans text-[12px] font-semibold text-[#31414F]">{VENDOR_PRODUKSI[po.vendorProduksi]?.name ?? po.vendorProduksi}</span>
                <span className="w-[100px] flex-none font-mono text-[11px] text-danger-fg">{formatPcs(summary.totalReject)} reject</span>
                <span className="w-[100px] flex-none font-mono text-[11px] text-warning-fg">{formatPcs(summary.totalRework)} rework</span>
                <span className="flex-1 font-mono text-[11px] font-semibold text-[#31414F]">{formatPcs(summary.sisaReject)} sisa</span>
                <span className="flex-none text-text-muted"><ChevronRight size={14} /></span>
              </button>
            );
          })}
        </div>
      ) : (
        <RejectDetailTable po={selected} />
      )}
    </div>
  );
}

export default function ProduksiRejectPage() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const maklonPOs = useMrpStore((s) => s.maklonPOs);
  const mrpDetails = useMrpStore((s) => s.mrpDetails);
  const productionBatches = useMrpStore((s) => s.productionBatches);
  const productionResults = useMrpStore((s) => s.productionResults);

  if (!mounted) return null;

  const approved = maklonPOs.filter((p) => p.approved);
  const mrpMap = new Map<string, MrpGroup>();
  for (const p of approved) {
    if (!mrpMap.has(p.mrpId)) mrpMap.set(p.mrpId, { mrpId: p.mrpId, vendorPOs: [] });
    mrpMap.get(p.mrpId)!.vendorPOs.push(p);
  }
  const rows = Array.from(mrpMap.values())
    .map((g) => ({ ...g, summary: g.vendorPOs.reduce((a, p) => { const s = poRejectSummary(p, mrpDetails, productionBatches, productionResults); return { reject: a.reject + s.totalReject, rework: a.rework + s.totalRework, sisa: a.sisa + s.sisaReject }; }, { reject: 0, rework: 0, sisa: 0 }) }))
    .sort((a, b) => b.summary.sisa - a.summary.sisa);

  const columns: ColumnDef<(typeof rows)[number]>[] = [
    {
      key: "vendorCount",
      label: "Vendor",
      default: true,
      render: (g) => (g.vendorPOs.length === 1 ? (VENDOR_PRODUKSI[g.vendorPOs[0].vendorProduksi]?.name ?? g.vendorPOs[0].vendorProduksi) : `${g.vendorPOs.length} vendor`),
    },
    { key: "reject", label: "Total Reject", default: true, align: "right", render: (g) => <span className="text-danger-fg">{formatPcs(g.summary.reject)}</span> },
    { key: "rework", label: "Sudah Rework", default: true, align: "right", render: (g) => <span className="text-warning-fg">{formatPcs(g.summary.rework)}</span> },
    { key: "sisa", label: "Sisa Reject", default: true, align: "right", render: (g) => <span className="font-semibold">{formatPcs(g.summary.sisa)}</span> },
    {
      key: "status",
      label: "Status",
      default: true,
      render: (g) => (g.summary.reject === 0 ? <StatusPill tone="neutral">TIDAK ADA REJECT</StatusPill> : g.summary.sisa === 0 ? <StatusPill tone="success">SEMUA DIREWORK</StatusPill> : <StatusPill tone="danger">PERLU REWORK</StatusPill>),
    },
  ];

  return (
    <AppShell
      role="produksi"
      activeHref="/produksi/reject"
      breadcrumb={["Dashboard", "Monitoring Reject"]}
      title="Monitoring Reject & Rework"
      subtitle="PO dengan reject di vendor produksi, dan berapa yang sudah berhasil di-rework jadi baju"
    >
      <DataTable
        title="MRP dengan PO vendor produksi"
        subtitle="Diurutkan dari sisa reject terbanyak — klik baris untuk pilih vendor, lalu lihat rincian per warna/lengan/size"
        columns={columns}
        rows={rows}
        keyOf={(g) => g.mrpId}
        firstColumnLabel="No. MRP"
        firstColumnRender={(g) => <span className="font-mono">{g.mrpId}</span>}
        renderExpanded={(g) => <MrpVendorDrilldown group={g} />}
        filterDefs={[{ label: "No MRP", options: Array.from(new Set(rows.map((g) => g.mrpId))), test: (g, v) => g.mrpId === v }]}
        emptyText="Belum ada PO vendor produksi yang disetujui Finance."
      />
    </AppShell>
  );
}
