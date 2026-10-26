"use client";

import { useEffect, useState } from "react";
import { AppShell } from "@/components/shell/app-shell";
import { ItemTrackingView } from "@/components/mrp/item-tracking-view";

export default function ScmItemTrackingPage() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;

  return (
    <AppShell role="scm" activeHref="/scm/item-tracking" breadcrumb={["Dashboard", "Tracking Item"]} title="Tracking Item">
      <ItemTrackingView />
    </AppShell>
  );
}
