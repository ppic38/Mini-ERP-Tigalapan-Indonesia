"use client";

import { useEffect, useState } from "react";
import { AppShell } from "@/components/shell/app-shell";
import { ItemTrackingView } from "@/components/mrp/item-tracking-view";

export default function PpicItemTrackingPage() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;

  return (
    <AppShell role="ppic" activeHref="/mrp/ppic/item-tracking" breadcrumb={["Dashboard", "Tracking Item"]} title="Tracking Item">
      <ItemTrackingView />
    </AppShell>
  );
}
