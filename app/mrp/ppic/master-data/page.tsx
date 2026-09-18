"use client";

import { useEffect, useState } from "react";
import { AppShell } from "@/components/shell/app-shell";
import { ItemSellingPricePanel } from "@/components/mrp/item-selling-price-panel";

export default function PpicMasterDataPage() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!mounted) return null;

  return (
    <AppShell role="ppic" activeHref="/mrp/ppic/master-data" breadcrumb={["Dashboard", "Master Data"]} title="Master Data">
      <ItemSellingPricePanel />
    </AppShell>
  );
}
