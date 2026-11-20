"use client";

import { useEffect, useState } from "react";
import { AppShell } from "@/components/shell/app-shell";
import { KpiCard } from "@/components/ui/kpi-card";
import { Tabs } from "@/components/ui/tabs";
import { DataTable } from "@/components/mrp/data-table";
import { MrpWarnaBreakdownTable } from "@/components/mrp/mrp-warna-breakdown-table";
import { mrpProgressColumns, mrpProgressFilters, useMrpProgressRows, type MrpProgressRow } from "@/components/mrp/mrp-progress";
import { MrpHppTable, OpsIssuesTable, RollYieldTable } from "@/components/mrp/ops-monitor";
import { useMrpStore } from "@/lib/mrp/store";
import { mrpWarnaBreakdown } from "@/lib/mrp/derive";
import type { FlowSideStatus, FlowStage } from "@/lib/mrp/flowStatus";

type St = FlowStage | FlowSideStatus;
type Tab = "status" | "kendala" | "yield" | "hpp";

/** Monitoring Progress SCM (owner 2026-11-16): tujuan memantau status tiap MRP dan melihat kendala operasional.
 *   - Status MRP : status staging standar per MRP (sama dengan tabel MRP PPIC)
 *   - Kendala    : semua yang melewati SLA antar gate (PV belum dibuat / dibayar, delivery belum diterima, roll belum resting / cutting /
 *                  Done FG, FG belum dikirim, kiriman belum GR DC)
 *   - Yield      : per roll, kelompokkan per MRP / vendor
 *   - HPP        : estimasi HPP (sejak Approval PO) dan HPP aktual per MRP */
export default function ScmMonitoringPage() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const maklonPOs = useMrpStore((s) => s.maklonPOs);
  const rows = useMrpProgressRows();
  const [tab, setTab] = useState<Tab>("status");
  const [shownIds, setShownIds] = useState<Set<string> | null>(null);
  const [preset, setPreset] = useState<{ nonce: number; filters: Record<string, string[]>; card: string }>({ nonce: 0, filters: {}, card: "" });

  if (!mounted) return null;

  const shown = shownIds ? rows.filter((r) => shownIds.has(r.mrp.id)) : rows;
  const cards: { key: string; label: string; sub: string; accent: "orange" | "purple" | "blue" | "teal"; stages: St[] }[] = [
    { key: "approval", label: "Approval", sub: "Approval MRP dan Approval PO", accent: "orange", stages: ["Approval MRP", "Ditolak", "Approval PO"] },
    { key: "material", label: "Material", sub: "PV Material s/d Receiving Material", accent: "purple", stages: ["PV Material", "Paid", "Delivery Material", "Receiving Material"] },
    { key: "produksi", label: "Produksi", sub: "Resting s/d Packing", accent: "blue", stages: ["Resting", "Cutting", "Finish Good", "Done FG", "Packing"] },
    { key: "kirim", label: "Delivery FG & GR DC", sub: "dikirim vendor atau diterima gudang", accent: "teal", stages: ["Delivery FG", "GR DC"] },
  ];

  return (
    <AppShell role="scm" activeHref="/scm/monitoring" breadcrumb={["Dashboard", "Monitoring"]} title="Monitoring Progress">
      <Tabs
        items={[
          { key: "status", label: "Status MRP" },
          { key: "kendala", label: "Kendala SLA" },
          { key: "yield", label: "Yield" },
          { key: "hpp", label: "HPP" },
        ]}
        active={tab}
        onChange={(k) => setTab(k as Tab)}
      />
      {tab === "status" && (
        <>
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
          <DataTable<MrpProgressRow>
            title="Status MRP"
            columns={mrpProgressColumns<MrpProgressRow>(maklonPOs)}
            rows={rows}
            keyOf={(r) => r.mrp.id}
            firstColumnLabel="No. MRP"
            firstColumnRender={(r) => <span className="font-mono font-medium">{r.mrp.id}</span>}
            filterDefs={mrpProgressFilters(rows)}
            filterPreset={preset}
            search={{ placeholder: "Cari MRP, kategori, vendor…", getText: (r) => `${r.mrp.id} ${r.mrp.kategori} ${r.vendors.join(" ")} ${r.stage}` }}
            onFilteredRows={(list) => setShownIds(new Set(list.map((r) => r.mrp.id)))}
            renderExpanded={(r) => <MrpWarnaBreakdownTable breakdown={mrpWarnaBreakdown(r.detail)} />}
            emptyText="Belum ada MRP yang tercatat."
          />
        </>
      )}
      {tab === "kendala" && <OpsIssuesTable areas={["Material", "Produksi", "Pengiriman"]} />}
      {tab === "yield" && <RollYieldTable />}
      {tab === "hpp" && <MrpHppTable rows={rows} />}
    </AppShell>
  );
}
