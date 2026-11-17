"use client";

import { useEffect, useState } from "react";
import { AppShell } from "@/components/shell/app-shell";
import { OpsDashboard } from "@/components/dashboard/ops-dashboard";

/** Dashboard Produksi (owner 2026-11-17: "dashboard tambahkan juga di modul produksi"): panel operasional bersama yang sama dengan
 *  Dashboard PPIC, Procurement, Finance, SCM, dan GM. Hanya baca, angka dari fungsi yang sama dengan halaman sumbernya. */
export default function ProduksiDashboardPage() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  return (
    <AppShell role="produksi" activeHref="/produksi/dashboard" breadcrumb={["Dashboard", "Produksi"]} title="Dashboard">
      <OpsDashboard />
    </AppShell>
  );
}
