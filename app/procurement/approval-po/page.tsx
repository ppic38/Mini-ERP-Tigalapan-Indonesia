"use client";

import { AppShell } from "@/components/shell/app-shell";
import { PoApprovalQueue } from "@/components/mrp/po-approval-queue";

// Matriks Approval PO (migration 0055, lib/mrp/poApproval.ts) -- antrean approval Procurement (Level 2) + PO ditolak yang perlu diajukan ulang.
export default function ProcurementApprovalPoPage() {
  return (
    <AppShell role="procurement" activeHref="/procurement/approval-po" breadcrumb={["Dashboard", "Approval PO"]} title="Approval PO" subtitle="Level 2 (Asisten Manager Procurement): setujui atau tolak PO Material & PO Produksi bernilai > Rp 2 juta">
      <PoApprovalQueue role="procurement" />
    </AppShell>
  );
}
