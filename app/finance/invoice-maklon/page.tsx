"use client";

import { useEffect, useState } from "react";
import { AppShell } from "@/components/shell/app-shell";
import { StatusPill } from "@/components/ui/status-pill";
import { Button } from "@/components/ui/button";
import { DataTable, type ColumnDef } from "@/components/mrp/data-table";
import { useMrpStore } from "@/lib/mrp/store";
import { formatRupiah, maklonInvoiceBadge } from "@/lib/mrp/derive";
import { VENDOR_PRODUKSI } from "@/lib/mrp/seed";
import { SysadminActionsBar } from "@/components/sysadmin/correction-dialog";
import { fobInvoiceCorrections } from "@/components/sysadmin/finance-corrections";
import type { MaklonInvoice } from "@/lib/mrp/types";

export default function InvoiceMaklonPage() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const maklonInvoices = useMrpStore((s) => s.maklonInvoices);
  const maklonPOs = useMrpStore((s) => s.maklonPOs);
  const approveMaklonInvoice = useMrpStore((s) => s.approveMaklonInvoice);
  const payMaklonInvoice = useMrpStore((s) => s.payMaklonInvoice);

  if (!mounted) return null;

  // Tahap 3 skema FOB (migration 0059) -- "Invoice Maklon" (jalur flat per-PO) HIDUP LAGI, TAPI
  // KHUSUS PO Produksi FOB (owner 2026-09-27: "hidupkan lagi tabel maklon_invoices, khusus FOB").
  // MaklonInvoice sendiri tidak menyimpan isFob -- dicocokkan lewat maklonPoId ke MaklonPO.isFob.
  const fobPoIds = new Set(maklonPOs.filter((p) => p.isFob).map((p) => p.id));
  const fobInvoices = maklonInvoices.filter((i) => fobPoIds.has(i.maklonPoId));
  const archivedInvoices = maklonInvoices.filter((i) => !fobPoIds.has(i.maklonPoId));
  const pendingFob = fobInvoices.filter((i) => i.status === "SUBMITTED");
  const pending = archivedInvoices.filter((i) => i.status === "SUBMITTED");

  const columns: ColumnDef<MaklonInvoice>[] = [
    { key: "poId", label: "No PO Produksi", default: true, render: (i) => <span className="font-mono font-medium">{i.maklonPoId}</span> },
    { key: "vendor", label: "Vendor", default: true, render: (i) => VENDOR_PRODUKSI[i.vendorProduksi]?.name ?? i.vendorProduksi },
    { key: "base", label: "Base fee", default: true, align: "right", render: (i) => formatRupiah(i.baseFee) },
    { key: "penalty", label: "Penalty", default: false, align: "right", render: (i) => (i.penalty ? "−" + formatRupiah(i.penalty) : "—") },
    { key: "bonus", label: "Bonus", default: false, align: "right", render: (i) => (i.bonus ? "+" + formatRupiah(i.bonus) : "—") },
    { key: "retention", label: "Retention", default: false, align: "right", render: (i) => (i.retentionPct ? i.retentionPct + "%" : "—") },
    { key: "net", label: "Net dibayar", default: true, align: "right", render: (i) => formatRupiah(i.netAmount) },
    { key: "entitas", label: "Entitas", default: false, render: (i) => i.entity },
    { key: "note", label: "Catatan vendor", default: false, render: (i) => i.note || "—" },
    { key: "status", label: "Status", default: true, render: (i) => <StatusPill tone={maklonInvoiceBadge(i.status).tone}>{maklonInvoiceBadge(i.status).label}</StatusPill> },
    {
      key: "aksi",
      label: "Aksi",
      default: true,
      render: (i) => (
        <div>
          {i.status === "SUBMITTED" ? (
            <Button onClick={() => approveMaklonInvoice(i.id)} variant="success" size="xs">
              Approve
            </Button>
          ) : i.status === "APPROVED" ? (
            <Button onClick={() => payMaklonInvoice(i.id)} variant="success" size="xs">
              Bayar
            </Button>
          ) : (
            <span className="font-sans text-[11.5px] font-medium text-[#94A3B0]">Dibayar</span>
          )}
          <SysadminActionsBar actions={fobInvoiceCorrections(i, maklonPOs.find((p) => p.id === i.maklonPoId))} />
        </div>
      ),
    },
  ];

  return (
    <AppShell
      role="finance"
      activeHref="/finance/invoice-maklon"
      breadcrumb={["Dashboard", "Invoice Maklon"]}
      title="Invoice Maklon"
      subtitle={pendingFob.length || pending.length ? `${pendingFob.length + pending.length} invoice menunggu approval` : "Tidak ada invoice menunggu approval"}
      notifCount={pendingFob.length + pending.length}
    >
      {/* Tahap 3 skema FOB (migration 0059) -- jalur ini HIDUP LAGI khusus PO Produksi FOB (harga
         jadi per pcs, tanpa tracking Cutting/FG -- lihat catatan submitFobMaklonInvoiceAction). */}
      <DataTable
        title="Invoice Produksi FOB"
        columns={columns}
        rows={fobInvoices}
        keyOf={(i) => i.id}
        firstColumnLabel="No. MRP"
        firstColumnRender={(i) => <span className="font-mono">{i.mrpId}</span>}
        filterDefs={[
          { label: "No MRP", options: Array.from(new Set(fobInvoices.map((i) => i.mrpId))), test: (i, v) => i.mrpId === v },
          { label: "Status", options: Array.from(new Set(fobInvoices.map((i) => i.status))), test: (i, v) => i.status === v },
        ]}
        emptyText="Belum ada invoice PO Produksi FOB yang diajukan vendor."
      />
      <div className="rounded-lg border border-[#F0DFC2] bg-warning-bg px-5 py-3 font-sans text-[11.5px] leading-[1.5] text-warning-fg">
        Jalur di bawah ini (CMT) <b>sudah ditutup untuk pengajuan baru</b> — penagihan CMT sekarang lewat Invoice Vendor (per pcs). Tabel arsip invoice lama yang masih perlu diselesaikan.
      </div>
      <DataTable
        title="Invoice maklon CMT (arsip)"
        columns={columns}
        rows={archivedInvoices}
        keyOf={(i) => i.id}
        firstColumnLabel="No. MRP"
        firstColumnRender={(i) => <span className="font-mono">{i.mrpId}</span>}
        filterDefs={[
          { label: "No MRP", options: Array.from(new Set(archivedInvoices.map((i) => i.mrpId))), test: (i, v) => i.mrpId === v },
          { label: "No PO Produksi", options: Array.from(new Set(archivedInvoices.map((i) => i.maklonPoId))), test: (i, v) => i.maklonPoId === v },
          { label: "Status", options: Array.from(new Set(archivedInvoices.map((i) => i.status))), test: (i, v) => i.status === v },
        ]}
        emptyText="Belum pernah ada invoice maklon yang diajukan sebelum jalur ini ditutup."
      />
    </AppShell>
  );
}
