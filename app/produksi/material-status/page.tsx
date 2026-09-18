"use client";

import { useEffect, useState } from "react";
import { AppShell } from "@/components/shell/app-shell";
import { StatusPill } from "@/components/ui/status-pill";
import { DataTable, type ColumnDef } from "@/components/mrp/data-table";
import { useMrpStore } from "@/lib/mrp/store";
import { formatPcs, materialPoFullStatus, materialPoFullStatusBadge, materialPoStageBreakdown } from "@/lib/mrp/derive";
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
 *  Revisi 2026-09-18 (owner: "beberapa PO warnanya banyak sekali, jangan dimasukkan ke baris
 *  utama"): daftar warna/lengan (po.colorBreakdown, bisa puluhan baris untuk PO yang mencakup
 *  banyak warna) DIPINDAH dari kolom baris utama ke panel expand (klik baris) -- baris utama
 *  cuma tampilkan ringkasan roll per tahap. */
function ColorBreakdownDetail({ po, productionBatches }: { po: MaterialPO; productionBatches: ProductionBatch[] }) {
  return (
    <div className="overflow-hidden rounded-md border border-[#E4E9EE] bg-white">
      <div className="bg-[#F2F4F7] px-3 py-1.5 font-sans text-[10px] font-medium uppercase tracking-wider text-text-muted">Rincian warna/lengan pada PO ini</div>
      <div className="divide-y divide-[#F1F4F7]">
        {po.colorBreakdown.map((c, i) => {
          const startedCutting = productionBatches.some((b) => b.mrpId === po.mrpId && b.warna === c.warna && b.lengan === c.lengan && b.cuttingAt);
          return (
            <div key={c.warna + "|" + c.lengan + "|" + i} className="flex items-center gap-3 px-3 py-2">
              <span className="flex-1 truncate font-sans text-[11.5px] font-medium text-[#31414F]">
                {c.warna} · {c.lengan}
              </span>
              <span className="w-[90px] flex-none text-right font-mono text-[11px] text-text-muted">{formatPcs(c.rollCount)} roll</span>
              <StatusPill tone={startedCutting ? "success" : "neutral"} className="flex-none">
                {startedCutting ? "SUDAH CUTTING" : "BELUM CUTTING"}
              </StatusPill>
            </div>
          );
        })}
      </div>
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

  const rows = materialPOs
    .filter((p) => p.status !== "CANCELLED")
    .map((po) => ({
      po,
      breakdown: materialPoStageBreakdown(po, invoices, maklonPOs, productionBatches),
      fullStatus: materialPoFullStatus(po, invoices, productionBatches, productionResults, mrpDetails, deliveryKolis, vendorInvoices, maklonPOs),
    }))
    .sort((a, b) => a.po.mrpId.localeCompare(b.po.mrpId));

  const columns: ColumnDef<(typeof rows)[number]>[] = [
    { key: "mrpId", label: "No. MRP", default: true, render: (r) => <span className="font-mono">{r.po.mrpId}</span> },
    { key: "vendor", label: "Vendor Produksi", default: true, render: (r) => VENDOR_PRODUKSI[r.po.vendorProduksi]?.name ?? r.po.vendorProduksi },
    { key: "supplier", label: "Supplier", default: true, render: (r) => r.po.supplier },
    { key: "warnaCount", label: "Jumlah Warna", default: true, align: "right", render: (r) => `${r.po.colorBreakdown.length} warna` },
    { key: "total", label: "Total Roll", default: true, align: "right", render: (r) => formatPcs(r.breakdown.totalRolls) },
    { key: "waiting", label: "Menunggu", default: true, align: "right", render: (r) => <span className="text-text-muted">{formatPcs(r.breakdown.waitingRolls)}</span> },
    { key: "received", label: "Sudah Good Receive", default: true, align: "right", render: (r) => <span className="text-info-fg">{formatPcs(r.breakdown.receivedRolls)}</span> },
    { key: "production", label: "Sudah Masuk Produksi", default: true, align: "right", render: (r) => <span className="text-success-fg">{formatPcs(r.breakdown.productionRolls)}</span> },
    {
      key: "status",
      label: "Status",
      default: true,
      render: (r) => {
        const badge = materialPoFullStatusBadge(r.fullStatus);
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
        title="PO Material"
        subtitle="Breakdown roll per tahap -- klik baris untuk lihat rincian warna/lengan"
        columns={columns}
        rows={rows}
        keyOf={(r) => r.po.id}
        firstColumnLabel="No. PO"
        firstColumnRender={(r) => <span className="font-mono text-[11px]">{r.po.id}</span>}
        renderExpanded={(r) => <ColorBreakdownDetail po={r.po} productionBatches={productionBatches} />}
        filterDefs={[
          { label: "No MRP", options: Array.from(new Set(rows.map((r) => r.po.mrpId))), test: (r, v) => r.po.mrpId === v },
          { label: "Vendor", options: Array.from(new Set(rows.map((r) => r.po.vendorProduksi))).map((v) => VENDOR_PRODUKSI[v]?.name ?? v), test: (r, v) => (VENDOR_PRODUKSI[r.po.vendorProduksi]?.name ?? r.po.vendorProduksi) === v },
        ]}
        emptyText="Belum ada PO material."
      />
    </AppShell>
  );
}
