"use client";

import { useEffect, useState } from "react";
import { AppShell } from "@/components/shell/app-shell";
import { KpiCard } from "@/components/ui/kpi-card";
import { DataTable, type ColumnDef } from "@/components/mrp/data-table";
import { MrpWarnaBreakdownTable } from "@/components/mrp/mrp-warna-breakdown-table";
import { HppEstimateSection } from "@/components/mrp/hpp-estimate-section";
import { mrpProgressColumns, mrpProgressFilters, useMrpProgressRows, type MrpProgressRow } from "@/components/mrp/mrp-progress";
import { SysadminActionsBar } from "@/components/sysadmin/correction-dialog";
import { mrpApprovalCorrections } from "@/components/sysadmin/ppic-corrections";
import { useMrpStore } from "@/lib/mrp/store";
import { useInternalAuthStore } from "@/lib/internal-auth-store";
import { scmMayApproveMrp } from "@/lib/mrp/poApproval";
import { effectiveMrpQty, formatDate, formatPcs, mrpWarnaBreakdown } from "@/lib/mrp/derive";

/** Approval MRP SCM (redesign 2026-11-16, owner: "tampilan history MRP sama dengan PPIC"): dua tabel bersama dengan kolom yang sama dengan
 *  tabel MRP PPIC (Qty, Roll, Status staging, Est. HPP %, tanggal). Keputusan Setujui / Tolak tetap di panel rincian MRP yang menunggu. */
export default function ScmApprovalMrpPage() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const maklonPOs = useMrpStore((s) => s.maklonPOs);
  const materialPOs = useMrpStore((s) => s.materialPOs);
  const approvePpicMrp = useMrpStore((s) => s.approvePpicMrp);
  const rejectPpicMrp = useMrpStore((s) => s.rejectPpicMrp);
  const rows = useMrpProgressRows();

  // Approval MRP hanya untuk scm02 (Asisten Manager SCM).
  const scmUsername = useInternalAuthStore((s) => s.actors.scm?.username);
  const mayDecide = scmMayApproveMrp(scmUsername);
  const notAllowedTitle = "Approval MRP hanya untuk akun scm02 (Asisten Manager SCM)";
  const [noteDraft, setNoteDraft] = useState<Record<string, string>>({});

  if (!mounted) return null;

  type Row = MrpProgressRow;
  const withDetail = rows.filter((r) => r.detail);
  const pending = withDetail.filter((r) => r.detail!.ppicApproval === "WAITING_PPIC_APPROVAL");
  const history = withDetail.filter((r) => r.detail!.ppicApproval === "PPIC_APPROVED" || r.detail!.ppicApproval === "REJECTED");

  function reject(mrpId: string) {
    const note = (noteDraft[mrpId] ?? "").trim();
    if (!note) return;
    rejectPpicMrp(mrpId, note);
    setNoteDraft((prev) => ({ ...prev, [mrpId]: "" }));
  }

  const base = mrpProgressColumns<Row>(maklonPOs);
  const pendingColumns: ColumnDef<Row>[] = [
    // Estimasi HPP dan rasio tampil sebelum diputuskan (owner 2026-11-27); rincian di panel baris.
    ...base.filter((c) => ["kategori", "qty", "roll", "vendor", "estHppTotal", "estHpp"].includes(c.key)),
    { key: "tglSubmit", label: "Tgl Diajukan", default: true, render: (r) => <span className="font-mono">{formatDate(r.detail?.dates.ppicSubmitted)}</span> },
  ];
  const historyColumns: ColumnDef<Row>[] = [
    {
      key: "sysadmin",
      label: "Aksi Sysadmin",
      default: true,
      sysadmin: true,
      render: (r) => <SysadminActionsBar compact actions={mrpApprovalCorrections(r.mrp.id, { detail: r.detail!, materialPOs, maklonPOs })} />,
    },
    ...base,
    { key: "tglKeputusan", label: "Tgl Keputusan SCM", default: false, render: (r) => <span className="font-mono">{formatDate(r.detail?.dates.ppicApproved)}</span> },
    { key: "catatan", label: "Catatan SCM", default: false, render: (r) => (r.detail?.ppicApproval === "REJECTED" ? r.detail.ppicRejectionNote ?? "—" : "—") },
  ];

  return (
    <AppShell role="scm" activeHref="/scm/approval-mrp" breadcrumb={["Dashboard", "Approval MRP"]} title="Approval MRP">
      <div className="grid grid-cols-4 gap-3 max-lg:grid-cols-2">
        <KpiCard label="Menunggu approval" value={pending.length} sub={`${formatPcs(pending.reduce((s, r) => s + effectiveMrpQty(r.mrp.id, r.mrp.qty, maklonPOs), 0))} pcs`} accent="orange" />
        <KpiCard label="Disetujui" value={history.filter((r) => r.detail!.ppicApproval === "PPIC_APPROVED").length} sub="MRP" accent="teal" />
        <KpiCard label="Ditolak" value={history.filter((r) => r.detail!.ppicApproval === "REJECTED").length} sub="MRP" accent="purple" />
        <KpiCard label="Hak keputusan" value={mayDecide ? "Ya" : "Tidak"} sub={mayDecide ? "akun ini boleh menyetujui" : "hanya akun scm02"} accent="blue" />
      </div>

      <DataTable<Row>
        title="Menunggu approval"
        columns={pendingColumns}
        rows={pending}
        keyOf={(r) => r.mrp.id}
        firstColumnLabel="No. MRP"
        firstColumnRender={(r) => <span className="font-mono font-medium">{r.mrp.id}</span>}
        renderExpanded={(r) => (
          <div className="flex flex-col gap-3">
            {r.hppEst.pcs > 0 && <HppEstimateSection est={r.hppEst} className="" />}
            <MrpWarnaBreakdownTable breakdown={mrpWarnaBreakdown(r.detail, { includeZeroQty: false })} />
            <div className="flex flex-wrap items-center gap-2">
              <input
                value={noteDraft[r.mrp.id] ?? ""}
                onChange={(e) => setNoteDraft((prev) => ({ ...prev, [r.mrp.id]: e.target.value }))}
                placeholder="Alasan (wajib diisi kalau mau Tolak, opsional kalau Setujui)…"
                className="input min-w-[280px] flex-1 text-[11.5px]"
              />
              <button
                onClick={() => approvePpicMrp(r.mrp.id)}
                disabled={!mayDecide}
                title={!mayDecide ? notAllowedTitle : undefined}
                className="rounded-md bg-success px-3.5 py-[7px] font-sans text-[11.5px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                Setujui
              </button>
              <button
                onClick={() => reject(r.mrp.id)}
                disabled={!mayDecide || !(noteDraft[r.mrp.id] ?? "").trim()}
                title={!mayDecide ? notAllowedTitle : !(noteDraft[r.mrp.id] ?? "").trim() ? "Isi alasan penolakan dulu" : undefined}
                className="rounded-md border border-[#EFC9C4] bg-white px-3.5 py-[7px] font-sans text-[11.5px] font-semibold text-danger-fg disabled:cursor-not-allowed disabled:opacity-50"
              >
                Tolak
              </button>
            </div>
          </div>
        )}
        emptyText="Tidak ada MRP yang menunggu approval saat ini."
      />

      <DataTable<Row>
        title="Riwayat Material Requirement Planning"
        columns={historyColumns}
        rows={history}
        keyOf={(r) => r.mrp.id}
        firstColumnLabel="No. MRP"
        firstColumnRender={(r) => <span className="font-mono font-medium">{r.mrp.id}</span>}
        filterDefs={mrpProgressFilters(history)}
        search={{ placeholder: "Cari MRP, kategori, vendor…", getText: (r) => `${r.mrp.id} ${r.mrp.kategori} ${r.vendors.join(" ")} ${r.stage}` }}
        renderExpanded={(r) => (
          <div className="flex flex-col gap-3">
            {r.hppEst.pcs > 0 && <HppEstimateSection est={r.hppEst} className="" />}
            <MrpWarnaBreakdownTable breakdown={mrpWarnaBreakdown(r.detail)} />
          </div>
        )}
        emptyText="Belum ada MRP yang diputuskan."
      />
    </AppShell>
  );
}
