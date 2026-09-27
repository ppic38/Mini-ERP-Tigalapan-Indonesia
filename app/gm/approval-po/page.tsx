"use client";

import { AppShell } from "@/components/shell/app-shell";
import { PoApprovalQueue } from "@/components/mrp/po-approval-queue";

// Matriks Approval PO (migration 0055, lib/mrp/poApproval.ts) -- antrean approval General Manager (Level 4).
export default function GmApprovalPoPage() {
  return (
    <AppShell role="gm" activeHref="/gm/approval-po" breadcrumb={["Dashboard", "Approval PO"]} title="Approval PO" subtitle="Level 4: PO bernilai > Rp 200 juta - persetujuan General Manager / Board of Director">
      <PoApprovalQueue role="gm" />
    </AppShell>
  );
}
