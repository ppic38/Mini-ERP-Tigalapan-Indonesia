"use client";

import { useEffect, useState } from "react";
import { AppShell } from "@/components/shell/app-shell";
import { Tabs } from "@/components/ui/tabs";
import { DataTable } from "@/components/mrp/data-table";
import { OpsIssuesTable, RollYieldTable } from "@/components/mrp/ops-monitor";
import { SLA_DEFAULTS, type SlaRule } from "@/lib/mrp/opsMonitor";

type Tab = "kendala" | "yield" | "aturan";

/** SLA Produksi (owner 2026-11-16: "modul produksi kurang lebih sama namun detail ke SLA produksi"): kendala produksi dan pengiriman yang
 *  melewati SLA (roll diterima belum resting, resting belum cutting, cutting belum Done FG, Done FG belum dikirim, kiriman belum GR DC),
 *  yield per roll / MRP / vendor, dan daftar aturan SLA yang dipakai. Hanya baca. */
export default function ProduksiSlaPage() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const [tab, setTab] = useState<Tab>("kendala");
  if (!mounted) return null;
  return (
    <AppShell role="produksi" activeHref="/produksi/sla" breadcrumb={["Dashboard", "SLA Produksi"]} title="SLA Produksi">
      <Tabs
        items={[
          { key: "kendala", label: "Kendala SLA" },
          { key: "yield", label: "Yield" },
          { key: "aturan", label: "Aturan SLA" },
        ]}
        active={tab}
        onChange={(k) => setTab(k as Tab)}
      />
      {tab === "kendala" && <OpsIssuesTable areas={["Produksi", "Pengiriman"]} />}
      {tab === "yield" && <RollYieldTable />}
      {tab === "aturan" && (
        <DataTable<SlaRule>
          title="Aturan SLA (lead time antar gate)"
          subtitle="Angka bawaan sementara di kode (lib/mrp/opsMonitor.ts). Usulan tabel database supaya bisa diatur dari Master Data: docs/usulan-sla-leadtime.md"
          columns={[
            { key: "area", label: "Area", default: true, render: (r) => r.area },
            { key: "days", label: "SLA (hari)", default: true, align: "right", render: (r) => <span className="font-mono">{r.days}</span> },
            { key: "sumber", label: "Sumber angka", default: true, render: (r) => r.sumber },
          ]}
          rows={SLA_DEFAULTS}
          keyOf={(r) => r.key}
          firstColumnLabel="Tahap"
          firstColumnRender={(r) => <span className="font-medium">{r.label}</span>}
          emptyText="-"
        />
      )}
    </AppShell>
  );
}
