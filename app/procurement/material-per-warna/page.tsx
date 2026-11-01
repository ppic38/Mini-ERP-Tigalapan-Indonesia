"use client";

import { useEffect, useState } from "react";
import { AppShell } from "@/components/shell/app-shell";
import { MaterialPerWarnaView } from "@/components/mrp/material-per-warna-view";

export default function ProcurementMaterialPerWarnaPage() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;

  return (
    <AppShell role="procurement" activeHref="/procurement/material-per-warna" breadcrumb={["Dashboard", "Material per Warna"]} title="Material per Warna">
      <MaterialPerWarnaView />
    </AppShell>
  );
}
