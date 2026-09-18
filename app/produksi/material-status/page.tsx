"use client";

import { Fragment, useEffect, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { AppShell } from "@/components/shell/app-shell";
import { StatusPill } from "@/components/ui/status-pill";
import { DataTable, type ColumnDef } from "@/components/mrp/data-table";
import { useMrpStore } from "@/lib/mrp/store";
import { formatPcs, materialPoFullStatus, materialPoFullStatusBadge, materialPoStageBreakdown, type MaterialPoFullStatus } from "@/lib/mrp/derive";
import { VENDOR_PRODUKSI } from "@/lib/mrp/seed";
import type { MaterialPO, ProductionBatch } from "@/lib/mrp/types";

/** Kebutuhan Bahan per PO (owner 2026-09-18): breakdown roll material 1 PO ke 3 tahap -- Menunggu
 *  (belum di-Good Receive vendor, apapun tahap invoice/bayar/kirimnya), Sudah Good Receive (di
 *  tangan vendor, belum cutting), Sudah Masuk Produksi (warna/lengan itu sudah mulai cutting) --
 *  dari `materialPoStageBreakdown` (lib/mrp/derive.ts, murni derivasi dari data yang sudah ada:
 *  rollArrivalProgress + cuttingAt batch, SAMA kriteria dengan materialPoFullStatus supaya kedua
 *  halaman selalu konsisten). Badge status keseluruhan pakai materialPoFullStatus yang sudah ada
 *  (dipakai juga di Procurement > Material Tracking).
 *
 *  Revisi 2026-09-18 (owner: "grouping jadi MRP baru level vendor produksi", pola sama seperti
 *  Monitoring Produksi): baris utama sekarang 1 per MRP (ringkasan gabungan semua PO material di
 *  MRP itu), klik untuk pilih vendor produksi, baru terakhir daftar PO material vendor itu --
 *  daftar warna/lengan (bisa puluhan untuk PO yang mencakup banyak warna) tetap di panel expand
 *  per PO (klik baris PO), bukan di baris ringkasan manapun. */
type Row = { po: MaterialPO; breakdown: ReturnType<typeof materialPoStageBreakdown>; fullStatus: MaterialPoFullStatus };
type MrpGroup = { mrpId: string; rows: Row[] };

function sumBreakdown(rows: Row[]) {
  return rows.reduce(
    (a, r) => ({ totalRolls: a.totalRolls + r.breakdown.totalRolls, waitingRolls: a.waitingRolls + r.breakdown.waitingRolls, receivedRolls: a.receivedRolls + r.breakdown.receivedRolls, productionRolls: a.productionRolls + r.breakdown.productionRolls }),
    { totalRolls: 0, waitingRolls: 0, receivedRolls: 0, productionRolls: 0 }
  );
}

function ColorBreakdownDetail({ po, productionBatches }: { po: MaterialPO; productionBatches: ProductionBatch[] }) {
  return (
    <table className="w-full border-collapse overflow-hidden rounded-md border border-[#E4E9EE] bg-white">
      <thead>
        <tr className="bg-[#F2F4F7] font-sans text-[10px] font-medium uppercase tracking-wider text-text-muted">
          <th className="w-full px-3 py-1.5 text-left">Warna / Lengan</th>
          <th className="whitespace-nowrap px-3 py-1.5 text-right">Roll</th>
          <th className="whitespace-nowrap px-3 py-1.5 text-left">Status Cutting</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-[#F1F4F7]">
        {po.colorBreakdown.map((c, i) => {
          const startedCutting = productionBatches.some((b) => b.mrpId === po.mrpId && b.warna === c.warna && b.lengan === c.lengan && b.cuttingAt);
          return (
            <tr key={c.warna + "|" + c.lengan + "|" + i} className="border-t border-[#F1F4F7]">
              <td className="whitespace-nowrap px-3 py-2 font-sans text-[11.5px] font-medium text-[#31414F]">
                {c.warna} · {c.lengan}
              </td>
              <td className="whitespace-nowrap px-3 py-2 text-right font-mono text-[11px] text-text-muted">{formatPcs(c.rollCount)}</td>
              <td className="whitespace-nowrap px-3 py-2">
                <StatusPill tone={startedCutting ? "success" : "neutral"}>{startedCutting ? "SUDAH CUTTING" : "BELUM CUTTING"}</StatusPill>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function VendorPoTable({ rows, productionBatches }: { rows: Row[]; productionBatches: ProductionBatch[] }) {
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <table className="w-full border-collapse overflow-hidden rounded-md border border-[#E4E9EE] bg-white">
      <thead>
        <tr className="bg-[#F2F4F7] font-sans text-[10px] font-medium uppercase tracking-wider text-text-muted">
          <th className="w-6 py-1.5 pl-3"></th>
          <th className="whitespace-nowrap px-2 py-1.5 text-left">Supplier</th>
          <th className="whitespace-nowrap px-2 py-1.5 text-right">Jumlah Warna</th>
          <th className="whitespace-nowrap px-2 py-1.5 text-right">Total Roll</th>
          <th className="whitespace-nowrap px-2 py-1.5 text-right">Menunggu</th>
          <th className="whitespace-nowrap px-2 py-1.5 text-right">Sudah Good Receive</th>
          <th className="w-full whitespace-nowrap px-2 py-1.5 text-right">Sudah Masuk Produksi</th>
          <th className="whitespace-nowrap px-2 py-1.5 pr-3 text-left">Status</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          const open = openId === r.po.id;
          const badge = materialPoFullStatusBadge(r.fullStatus);
          return (
            <Fragment key={r.po.id}>
              <tr onClick={() => setOpenId(open ? null : r.po.id)} className="cursor-pointer border-t border-[#F1F4F7] hover:bg-[#FAFBFC]">
                <td className="py-2 pl-3 text-text-muted">{open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</td>
                <td className="whitespace-nowrap px-2 py-2 font-sans text-[11.5px] font-medium text-[#31414F]">{r.po.supplier}</td>
                <td className="whitespace-nowrap px-2 py-2 text-right font-mono text-[11px] text-text-muted">{r.po.colorBreakdown.length}</td>
                <td className="whitespace-nowrap px-2 py-2 text-right font-mono text-[11px] text-text-muted">{formatPcs(r.breakdown.totalRolls)}</td>
                <td className="whitespace-nowrap px-2 py-2 text-right font-mono text-[11px] text-text-muted">{formatPcs(r.breakdown.waitingRolls)}</td>
                <td className="whitespace-nowrap px-2 py-2 text-right font-mono text-[11px] text-info-fg">{formatPcs(r.breakdown.receivedRolls)}</td>
                <td className="whitespace-nowrap px-2 py-2 text-right font-mono text-[11px] text-success-fg">{formatPcs(r.breakdown.productionRolls)}</td>
                <td className="whitespace-nowrap px-2 py-2 pr-3">
                  <StatusPill tone={badge.tone}>{badge.label}</StatusPill>
                </td>
              </tr>
              {open && (
                <tr className="border-t border-[#F1F4F7] bg-[#FAFBFC]">
                  <td colSpan={8} className="px-3 py-2 pl-9">
                    <ColorBreakdownDetail po={r.po} productionBatches={productionBatches} />
                  </td>
                </tr>
              )}
            </Fragment>
          );
        })}
      </tbody>
    </table>
  );
}

function MrpVendorDrilldown({ group, productionBatches }: { group: MrpGroup; productionBatches: ProductionBatch[] }) {
  const vendorMap = new Map<string, Row[]>();
  for (const r of group.rows) {
    const list = vendorMap.get(r.po.vendorProduksi) ?? [];
    list.push(r);
    vendorMap.set(r.po.vendorProduksi, list);
  }
  const vendors = Array.from(vendorMap.entries());
  const [selected, setSelected] = useState<string | null>(vendors.length === 1 ? vendors[0][0] : null);
  const selectedRows = selected ? (vendorMap.get(selected) ?? []) : null;

  return (
    <div className="flex flex-col gap-2">
      {selectedRows && vendors.length > 1 && (
        <button onClick={() => setSelected(null)} className="self-start font-sans text-[11.5px] font-semibold text-action-primary underline">
          ← Ganti vendor ({vendors.length} vendor mengerjakan MRP ini)
        </button>
      )}
      {!selectedRows ? (
        <div className="flex flex-col gap-1.5">
          {vendors.map(([vendorProduksi, vRows]) => {
            const sum = sumBreakdown(vRows);
            return (
              <button
                key={vendorProduksi}
                onClick={() => setSelected(vendorProduksi)}
                className="flex w-full items-center gap-3 rounded-md border border-[#E4E9EE] bg-white px-3 py-2 text-left hover:bg-[#FAFBFC]"
              >
                <span className="w-[160px] flex-none truncate font-sans text-[12px] font-semibold text-[#31414F]">{VENDOR_PRODUKSI[vendorProduksi]?.name ?? vendorProduksi}</span>
                <span className="w-[90px] flex-none font-mono text-[11px] text-text-muted">{formatPcs(sum.totalRolls)} roll</span>
                <span className="w-[110px] flex-none font-mono text-[11px] text-text-muted">{formatPcs(sum.waitingRolls)} menunggu</span>
                <span className="w-[110px] flex-none font-mono text-[11px] text-info-fg">{formatPcs(sum.receivedRolls)} GR</span>
                <span className="flex-1 font-mono text-[11px] text-success-fg">{formatPcs(sum.productionRolls)} produksi</span>
                <span className="flex-none text-text-muted">
                  <ChevronRight size={14} />
                </span>
              </button>
            );
          })}
        </div>
      ) : (
        <VendorPoTable rows={selectedRows} productionBatches={productionBatches} />
      )}
    </div>
  );
}

export default function ProduksiMaterialStatusPage() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const materialPOs = useMrpStore((s) => s.materialPOs);
  const invoices = useMrpStore((s) => s.invoices);
  const maklonPOs = useMrpStore((s) => s.maklonPOs);
  const productionBatches = useMrpStore((s) => s.productionBatches);
  const productionResults = useMrpStore((s) => s.productionResults);
  const mrpDetails = useMrpStore((s) => s.mrpDetails);
  const deliveryKolis = useMrpStore((s) => s.deliveryKolis);
  const vendorInvoices = useMrpStore((s) => s.vendorInvoices);

  if (!mounted) return null;

  const flatRows: Row[] = materialPOs
    .filter((p) => p.status !== "CANCELLED")
    .map((po) => ({
      po,
      breakdown: materialPoStageBreakdown(po, invoices, maklonPOs, productionBatches),
      fullStatus: materialPoFullStatus(po, invoices, productionBatches, productionResults, mrpDetails, deliveryKolis, vendorInvoices, maklonPOs),
    }));

  const mrpMap = new Map<string, Row[]>();
  for (const r of flatRows) {
    const list = mrpMap.get(r.po.mrpId) ?? [];
    list.push(r);
    mrpMap.set(r.po.mrpId, list);
  }
  const rows: MrpGroup[] = Array.from(mrpMap.entries())
    .map(([mrpId, mrpRows]) => ({ mrpId, rows: mrpRows }))
    .sort((a, b) => a.mrpId.localeCompare(b.mrpId));

  const columns: ColumnDef<MrpGroup>[] = [
    { key: "vendorCount", label: "Jumlah Vendor", default: true, render: (g) => `${new Set(g.rows.map((r) => r.po.vendorProduksi)).size} vendor` },
    { key: "poCount", label: "Jumlah PO", default: true, align: "right", render: (g) => `${g.rows.length} PO` },
    { key: "total", label: "Total Roll", default: true, align: "right", render: (g) => formatPcs(sumBreakdown(g.rows).totalRolls) },
    { key: "waiting", label: "Menunggu", default: true, align: "right", render: (g) => <span className="text-text-muted">{formatPcs(sumBreakdown(g.rows).waitingRolls)}</span> },
    { key: "received", label: "Sudah Good Receive", default: true, align: "right", render: (g) => <span className="text-info-fg">{formatPcs(sumBreakdown(g.rows).receivedRolls)}</span> },
    { key: "production", label: "Sudah Masuk Produksi", default: true, align: "right", render: (g) => <span className="text-success-fg">{formatPcs(sumBreakdown(g.rows).productionRolls)}</span> },
    {
      key: "status",
      label: "Status",
      default: true,
      render: (g) => {
        const statuses = Array.from(new Set(g.rows.map((r) => r.fullStatus)));
        if (statuses.length > 1) return <span className="font-sans text-[11px] text-text-muted">Campuran</span>;
        const badge = materialPoFullStatusBadge(statuses[0]);
        return <StatusPill tone={badge.tone}>{badge.label}</StatusPill>;
      },
    },
  ];

  return (
    <AppShell
      role="produksi"
      activeHref="/produksi/material-status"
      breadcrumb={["Dashboard", "Kebutuhan Bahan"]}
      title="Kebutuhan Bahan per PO"
      subtitle="Detail roll material per PO -- berapa masih menunggu, sudah Good Receive, dan sudah masuk tahap produksi"
    >
      <DataTable
        title="MRP dengan PO material"
        subtitle="Klik baris untuk pilih vendor, lalu lihat PO material & rincian warna/lengan"
        columns={columns}
        rows={rows}
        keyOf={(g) => g.mrpId}
        firstColumnLabel="No. MRP"
        firstColumnRender={(g) => <span className="font-mono">{g.mrpId}</span>}
        renderExpanded={(g) => <MrpVendorDrilldown group={g} productionBatches={productionBatches} />}
        filterDefs={[{ label: "No MRP", options: Array.from(new Set(rows.map((g) => g.mrpId))), test: (g, v) => g.mrpId === v }]}
        emptyText="Belum ada PO material."
      />
    </AppShell>
  );
}
