"use client";

import { useEffect, useState } from "react";
import { AppShell } from "@/components/shell/app-shell";
import { MaterialPerWarnaView } from "@/components/mrp/material-per-warna-view";

export default function ScmMaterialPerWarnaPage() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;

  return (
    <AppShell role="scm" activeHref="/scm/material-per-warna" breadcrumb={["Dashboard", "Material per Warna"]} title="Material per Warna">
      <MaterialPerWarnaView />
    </AppShell>
  );
}
