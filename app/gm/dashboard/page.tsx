"use client";

import { useMemo } from "react";
import Link from "next/link";
import { AppShell } from "@/components/shell/app-shell";
import { KpiCard } from "@/components/ui/kpi-card";
import { useMrpStore } from "@/lib/mrp/store";
import { formatRupiah, isSyntheticSupplier, vendorInvoiceFinalAmount } from "@/lib/mrp/derive";
import { VENDOR_PRODUKSI } from "@/lib/mrp/seed";
import { APPROVAL_LEVEL_TABLE, poApprovalState } from "@/lib/mrp/poApproval";

/** Dashboard General Manager (owner 2026-09-26): ringkasan posisi approval PO (Matriks Approval PO,
 *  lib/mrp/poApproval.ts), SLA, nilai PO, dan tagihan berjalan. Antrean aksi Level 4 ada di
 *  /gm/approval-po. Semua angka dari data yang sama dengan portal lain (tidak ada sumber baru). */
export default function GmDashboardPage() {
  const materialPOs = useMrpStore((s) => s.materialPOs);
  const maklonPOs = useMrpStore((s) => s.maklonPOs);
  const mrpDetails = useMrpStore((s) => s.mrpDetails);
  const invoices = useMrpStore((s) => s.invoices);
  const vendorInvoices = useMrpStore((s) => s.vendorInvoices);

  const stats = useMemo(() => {
    const all = [
      ...materialPOs.filter((p) => p.status !== "CANCELLED").map((p) => ({ type: "MATERIAL" as const, id: p.id, mrpId: p.mrpId, vendor: VENDOR_PRODUKSI[p.vendorProduksi]?.name ?? p.vendorProduksi, amount: p.amount, approved: p.approved, state: poApprovalState(p) })),
      ...maklonPOs.map((p) => ({ type: "MAKLON" as const, id: p.id, mrpId: p.mrpId, vendor: VENDOR_PRODUKSI[p.vendorProduksi]?.name ?? p.vendorProduksi, amount: p.amount, approved: p.approved, state: poApprovalState(p) })),
    ];
    const open = all.filter((p) => !p.approved);
    const mine = open.filter((p) => !p.state.rejected && p.state.pendingRoles.includes("gm"));
    const inFlight = open.filter((p) => !p.state.rejected);
    const overdue = inFlight.filter((p) => p.state.overdue);
    const rejected = open.filter((p) => p.state.rejected);
    const approved = all.filter((p) => p.approved);
    const byLevel = APPROVAL_LEVEL_TABLE.map((l) => {
      const rows = inFlight.filter((p) => p.state.level === l.level);
      return { label: l.label, approver: l.approver, count: rows.length, amount: rows.reduce((s, p) => s + p.amount, 0) };
    });
    const awaitingInvoices = invoices.filter((i) => i.status === "INVOICED" && !isSyntheticSupplier(i.supplier));
    const awaitingVendorInv = vendorInvoices.filter((i) => i.status === "APPROVED");
    return {
      mine,
      mineAmount: mine.reduce((s, p) => s + p.amount, 0),
      inFlight,
      inFlightAmount: inFlight.reduce((s, p) => s + p.amount, 0),
      overdue,
      rejected,
      approved,
      approvedAmount: approved.reduce((s, p) => s + p.amount, 0),
      byLevel,
      awaitingPayCount: awaitingInvoices.length + awaitingVendorInv.length,
      awaitingPayAmount: awaitingInvoices.reduce((s, i) => s + i.totalBiaya, 0) + awaitingVendorInv.reduce((s, i) => s + vendorInvoiceFinalAmount(i), 0),
    };
  }, [materialPOs, maklonPOs, invoices, vendorInvoices]);

  return (
    <AppShell role="gm" activeHref="/gm/dashboard" breadcrumb={["Dashboard", "General Manager"]} title="Ringkasan untuk General Manager">
      <div className="grid grid-cols-4 gap-3.5">
        <KpiCard label="Menunggu Approval Anda" value={String(stats.mine.length)} sub={`${formatRupiah(stats.mineAmount)} · Level 4`} accent="orange" />
        <KpiCard label="PO Lewat SLA" value={String(stats.overdue.length)} sub={`dari ${stats.inFlight.length} PO yang sedang diproses`} />
        <KpiCard label="PO Sedang Diproses" value={String(stats.inFlight.length)} sub={formatRupiah(stats.inFlightAmount)} />
        <KpiCard label="Tagihan Menunggu Bayar" value={String(stats.awaitingPayCount)} sub={formatRupiah(stats.awaitingPayAmount)} accent="teal" />
      </div>
      <div className="grid grid-cols-4 gap-3.5">
        <KpiCard label="PO Disetujui" value={String(stats.approved.length)} sub={`material + produksi`} />
        <KpiCard label="Nilai PO Disetujui" value={formatRupiah(stats.approvedAmount)} sub="total semua PO disetujui" />
        <KpiCard label="PO Ditolak" value={String(stats.rejected.length)} sub="menunggu diajukan ulang Procurement" />
        <KpiCard label="MRP Aktif" value={String(mrpDetails.length)} sub="seluruh MRP di sistem" />
      </div>

      <div className="grid gap-3.5" style={{ gridTemplateColumns: "1fr 1fr" }}>
        <div className="rounded-lg border border-border-subtle bg-surface-card p-4">
          <div className="font-sans text-[11px] font-medium uppercase tracking-wider text-text-muted">PO sedang diproses per level approval</div>
          <div className="mt-3 flex flex-col gap-2.5">
            {stats.byLevel.map((l) => (
              <div key={l.label} className="flex items-center gap-3 font-sans text-xs text-[#31414F]">
                <span className="w-[62px] font-semibold text-text-primary">{l.label}</span>
                <span className="flex-1 text-text-muted">{l.approver}</span>
                <span className="font-mono">{l.count} PO</span>
                <span className="w-[130px] text-right font-mono font-medium">{formatRupiah(l.amount)}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="overflow-hidden rounded-lg border border-border-subtle bg-surface-card">
          <div className="flex items-center border-b border-border-subtle px-4 py-3">
            <span className="font-sans text-[13px] font-semibold text-text-primary">Antrean Level 4</span>
            <Link href="/gm/approval-po" className="ml-auto font-sans text-[11.5px] font-semibold text-action-primary underline">
              Buka antrean →
            </Link>
          </div>
          {stats.mine.length === 0 && <div className="px-4 py-6 text-center font-sans text-xs text-text-muted">Tidak ada PO yang menunggu persetujuan Anda.</div>}
          {stats.mine.slice(0, 6).map((r, i, arr) => (
            <div key={r.id} className={"flex items-center gap-2.5 px-4 py-[11px] font-sans text-xs text-[#31414F]" + (i < arr.length - 1 ? " border-b border-[#EEF1F4]" : "")}>
              <span className="font-mono font-medium">{r.id}</span>
              <span className="text-text-muted">{r.vendor}</span>
              <span className="ml-auto font-mono font-medium">{formatRupiah(r.amount)}</span>
              {r.state.overdue && <span className="font-mono text-[10px] font-semibold text-danger-fg">LEWAT SLA</span>}
            </div>
          ))}
        </div>
      </div>
    </AppShell>
  );
}
