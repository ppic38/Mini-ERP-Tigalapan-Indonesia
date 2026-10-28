"use client";

import { AppShell } from "@/components/shell/app-shell";
import { PoApprovalQueue } from "@/components/mrp/po-approval-queue";

// Matriks Approval PO (migration 0055, lib/mrp/poApproval.ts) -- antrean approval SCM Manager (Level 3).
export default function ScmApprovalPoPage() {
  return (
    <AppShell role="scm" activeHref="/scm/approval-po" breadcrumb={["Dashboard", "Approval PO"]} title="Approval PO" subtitle="Level 2: PO Rp 2 juta - Rp 50 juta - persetujuan Asisten Manager (scm02). Level 3: PO > Rp 50 juta - SCM Manager (scm01) lebih dulu, lalu FAT Manager di portal Finance">
      <PoApprovalQueue role="scm" />
    </AppShell>
  );
}
