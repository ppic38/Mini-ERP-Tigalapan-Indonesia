"use client";

import { AppShell } from "@/components/shell/app-shell";
import { PoApprovalQueue } from "@/components/mrp/po-approval-queue";

// Matriks Approval PO (migration 0055, lib/mrp/poApproval.ts) -- antrean approval SCM Manager (Level 3).
export default function ScmApprovalPoPage() {
  return (
    <AppShell role="scm" activeHref="/scm/approval-po" breadcrumb={["Dashboard", "Approval PO"]} title="Approval PO" subtitle="Level 3: PO bernilai > Rp 50 juta - persetujuan SCM Manager (bersama FAT Manager di portal Finance)">
      <PoApprovalQueue role="scm" />
    </AppShell>
  );
}
