"use client";

import { useEffect, useState } from "react";
import { AppShell } from "@/components/shell/app-shell";
import { Tabs } from "@/components/ui/tabs";
import { KeepAliveTab } from "@/components/ui/keep-alive-tab";
import { PoMaterialPanel } from "@/components/finance/po-material-panel";
import { PoMaklonPanel } from "@/components/finance/po-maklon-panel";
import { useMrpStore } from "@/lib/mrp/store";
import { countPendingMaklonPO, countPendingMaterialPO } from "@/lib/shell/badges";
import { poApprovalState } from "@/lib/mrp/poApproval";

export default function FinancePoApprovalPage() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const materialPOs = useMrpStore((s) => s.materialPOs);
  const maklonPOs = useMrpStore((s) => s.maklonPOs);
  const [tab, setTab] = useState<"material" | "maklon">("material");

  if (!mounted) return null;

  const materialBadge = countPendingMaterialPO(materialPOs);
  const maklonBadge = countPendingMaklonPO(maklonPOs);
  // PO yang belum selesai tapi BUKAN giliran Finance (masih menunggu Procurement / SCM / GM) -- info saja.
  const waitingElsewhere =
    materialPOs.filter((p) => p.status !== "CANCELLED" && !p.approved && !poApprovalState(p).rejected && !poApprovalState(p).pendingRoles.includes("finance")).length +
    maklonPOs.filter((p) => !p.approved && !poApprovalState(p).rejected && !poApprovalState(p).pendingRoles.includes("finance")).length;

  return (
    <AppShell role="finance" activeHref="/finance/po-approval" breadcrumb={["Dashboard", "PO Approval"]} title="PO Approval">
      <Tabs
        items={[
          { key: "material", label: "PO Material", badge: materialBadge },
          { key: "maklon", label: "PO Maklon", badge: maklonBadge },
        ]}
        active={tab}
        onChange={(k) => setTab(k as "material" | "maklon")}
      />
      {waitingElsewhere > 0 && (
        <div className="rounded-md border border-border-subtle bg-info-bg px-3 py-2 font-sans text-[11.5px] text-info-fg">
          {waitingElsewhere} PO lain masih menunggu approval level lain (Procurement / SCM / GM) — muncul di sini begitu giliran Finance (FAT Manager, Level 3).
        </div>
      )}
      <KeepAliveTab active={tab === "material"}><PoMaterialPanel /></KeepAliveTab>
      <KeepAliveTab active={tab === "maklon"}><PoMaklonPanel /></KeepAliveTab>
    </AppShell>
  );
}
