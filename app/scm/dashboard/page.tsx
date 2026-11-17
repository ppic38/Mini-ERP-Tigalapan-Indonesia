"use client";

import { useEffect, useState } from "react";
import { AppShell } from "@/components/shell/app-shell";
import { OpsDashboard } from "@/components/dashboard/ops-dashboard";

/** Dashboard SCM (owner 2026-11-17): panel operasional bersama yang sama dengan Dashboard PPIC, Procurement, Finance, dan GM. */
export default function ScmDashboardPage() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  return (
    <AppShell role="scm" activeHref="/scm/dashboard" breadcrumb={["Dashboard", "SCM"]} title="Dashboard">
      <OpsDashboard />
    </AppShell>
  );
}
