"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { AppShell } from "@/components/shell/app-shell";
import { StatusPill } from "@/components/ui/status-pill";
import { DataTable, type ColumnDef } from "@/components/mrp/data-table";
import { VendorAuthGuard } from "@/components/mrp/vendor-auth-guard";
import { useMrpStore } from "@/lib/mrp/store";
import { addDays, formatDate, invoiceBadge, receivedNotYetProducedRows } from "@/lib/mrp/derive";
import { VENDOR_PRODUKSI } from "@/lib/mrp/seed";
import type { Lengan, RawMaterialInvoice } from "@/lib/mrp/types";
import { seenPoKey, useMarkPoSeen } from "@/lib/shell/seen-po";
// Revisi 2026-09-19: link Bukti PV & Bukti Bayar (revisi 2026-09-06) dicabut lagi dari halaman ini
// -- owner: vendor produksi tidak perlu melihat lampiran PV/bukti bayar di PO Material Saya.

const REMARK_BY_STATUS: Record<string, string> = {
  WAITING_INVOICE: "Menunggu invoice supplier",
  INVOICED: "Menunggu payment",
  PAID: "Menunggu dikirim procurement",
  DELIVERY: "Menunggu diterima",
  RECEIVING: "Sedang diterima",
  WAITING_PRODUCTION: "Siap dipakai produksi",
  PRODUCTION_DONE: "Sudah dipakai produksi",
};

// Item revisi 2026-09-17 (owner: "PO Material Saya -- hierarki sama seperti PO Produksi Saya"):
// PO Produksi Saya (po-produksi/page.tsx) 1 baris = 1 PO (bukan 1 baris per invoice/event), dengan
// rincian aduan pola dibuka lewat expand. PO Material Saya dulu 1 baris = 1 invoice ATAU 1 PO
// yang "waiting-invoice" -- 1 PO material yang sudah diinvoice beberapa kali (mis. invoice
// susulan/PV pengganti klaim) muncul sebagai BEBERAPA baris top-level terpisah, tidak konsisten
// dengan PO Produksi Saya. Sekarang disamakan: 1 baris = 1 PO material, rincian per invoice
// (termasuk yang masih waiting-invoice) dipindah ke expand -- InvoiceSub di bawah.
//
// Item revisi 2026-09-17 lanjutan (owner: "grouping jadi level MRP dulu, baru per nomor invoice,
// diklik baru tampil detail"): satu No. MRP bisa punya beberapa PO material (kelihatan di
// screenshot -- MRP-W36 muncul 6x sebagai baris terpisah). Sekarang level top DataTable dikumpulkan
// per MRP (MrpGroup), rincian per PO+invoice dipindah ke dalam expand (InvoiceListExpanded di
// bawah) -- baris invoice di situ baru menampilkan detail (tanggal, warna, bukti) kalau diklik,
// jadi ada 2 tingkat klik: buka grup MRP -> klik salah satu invoice/PO di dalamnya.
type InvoiceSub = {
  invoiceId: string;
  colorDetail: { warna: string; lengan: Lengan; roll: number }[];
  warnaLabel: string;
  roll: number;
  rollProduksi: number;
  rollSisa: number;
  status: string;
  deliveredAt?: string;
  receivedAt?: string;
  productionStart?: string;
};

type PoRow = {
  poId: string;
  supplier: string;
  totalRoll: number;
  waitingRoll: number;
  invoices: InvoiceSub[];
};

type Row = {
  mrpId: string;
  poCount: number;
  invoiceCount: number;
  suppliers: string;
  totalRoll: number;
  waitingRoll: number;
  rollProduksi: number;
  rollSisa: number;
  status: string;
  pos: PoRow[];
};

const STATUS_RANK = ["WAITING_INVOICE", "INVOICED", "PAID", "DELIVERY", "RECEIVING", "WAITING_PRODUCTION", "PRODUCTION_DONE"];

function InvoiceCard({ vendorId, inv }: { vendorId: string; inv: InvoiceSub }) {
  return (
    <div className="overflow-hidden rounded-md border border-[#E4E8EE] bg-white">
      <div className="grid grid-cols-4 gap-x-2 bg-[#F2F4F7] px-3 py-1.5 font-sans text-[10px] font-medium uppercase tracking-wider text-text-muted">
        <span>Tgl Delivery</span>
        <span>Tgl Receiving</span>
        <span>Tgl Start Produksi</span>
        <span>Target Done Produksi</span>
      </div>
      <div className="grid grid-cols-4 gap-x-2 border-t border-[#F1F4F7] px-3 py-1.5 font-sans text-[11.5px] text-[#31414F]">
        <span>{formatDate(inv.deliveredAt)}</span>
        <span>{formatDate(inv.receivedAt)}</span>
        <span>{formatDate(inv.productionStart)}</span>
        <span>{inv.receivedAt ? formatDate(addDays(inv.receivedAt, VENDOR_PRODUKSI[vendorId]?.productionLeadDays ?? 7)) : "—"}</span>
      </div>
      {inv.colorDetail.length > 0 && (
        <>
          <div className="grid grid-cols-3 gap-x-2 border-t border-[#F1F4F7] bg-[#FAFBFC] px-3 py-1.5 font-sans text-[10px] font-medium uppercase tracking-wider text-text-muted">
            <span>Warna</span>
            <span>Lengan</span>
            <span className="text-right">Roll</span>
          </div>
          {inv.colorDetail.map((c, i) => (
            <div key={i} className="grid grid-cols-3 gap-x-2 border-t border-[#F1F4F7] px-3 py-1.5 font-sans text-[11.5px] text-[#31414F]">
              <span className="font-medium">{c.warna}</span>
              <span>{c.lengan}</span>
              <span className="text-right font-mono">{c.roll}</span>
            </div>
          ))}
        </>
      )}
    </div>
  );
}

function InvoiceListExpanded({ vendorId, group }: { vendorId: string; group: Row }) {
  const [openInvoiceId, setOpenInvoiceId] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-2.5">
      {group.pos.map((po) =>
        po.invoices.length === 0 ? (
          <div key={po.poId} className="rounded-md border border-[#E4E8EE] bg-white px-3 py-2 font-sans text-[11.5px] text-text-muted">
            <span className="font-mono font-medium text-text-primary">{po.poId}</span> — {po.waitingRoll} roll masih menunggu diinvoice supplier.
          </div>
        ) : (
          po.invoices.map((inv) => {
            const isOpen = openInvoiceId === inv.invoiceId;
            return (
              <div key={inv.invoiceId} className="overflow-hidden rounded-md border border-[#E4E8EE] bg-white">
                <button
                  type="button"
                  onClick={() => setOpenInvoiceId(isOpen ? null : inv.invoiceId)}
                  className="flex w-full flex-wrap items-center gap-2 bg-[#F2F4F7] px-3 py-1.5 text-left font-sans text-[11px] font-medium text-text-primary"
                >
                  {isOpen ? <ChevronDown className="h-3.5 w-3.5 flex-none text-text-muted" /> : <ChevronRight className="h-3.5 w-3.5 flex-none text-text-muted" />}
                  <span className="font-mono">{inv.invoiceId}</span>
                  <span className="font-mono text-text-muted">({po.poId})</span>
                  {inv.status === "WAITING_INVOICE" ? (
                    <StatusPill tone="warning">WAITING INVOICE</StatusPill>
                  ) : (
                    <StatusPill tone={invoiceBadge(inv.status as RawMaterialInvoice["status"]).tone}>{invoiceBadge(inv.status as RawMaterialInvoice["status"]).label}</StatusPill>
                  )}
                  <span className="text-text-muted">{REMARK_BY_STATUS[inv.status] ?? "—"}</span>
                  <span className="ml-auto font-mono text-text-muted">{inv.roll} roll</span>
                </button>
                {isOpen && (
                  <div className="border-t border-[#F1F4F7] px-3 py-2">
                    <InvoiceCard vendorId={vendorId} inv={inv} />
                  </div>
                )}
              </div>
            );
          })
        )
      )}
    </div>
  );
}

function PoMaterialContent({ vendorId }: { vendorId: string }) {
  const materialPOs = useMrpStore((s) => s.materialPOs);
  const invoices = useMrpStore((s) => s.invoices);
  const productionBatches = useMrpStore((s) => s.productionBatches);

  const myPOs = materialPOs.filter((p) => p.vendorProduksi === vendorId && p.approved && p.status !== "CANCELLED");
  // Badge sidebar "PO Material Saya" hilang begitu halaman ini dibuka (lib/shell/seen-po.ts).
  useMarkPoSeen(seenPoKey(vendorId, "po-material"), myPOs.map((p) => p.id));
  const myInvoices = invoices.filter((i) => i.destinationVendor === vendorId);
  const groupRows = receivedNotYetProducedRows(vendorId, invoices, productionBatches);

  function groupFor(mrpId: string, warna: string, lengan: Lengan) {
    return groupRows.find((g) => g.mrpId === mrpId && g.warna === warna && g.lengan === lengan);
  }

  const poRows: (PoRow & { mrpId: string })[] = myPOs.map((p) => {
    const poInvoices = myInvoices.filter((i) => i.poId === p.id);
    const invoiceSubs: InvoiceSub[] = poInvoices.map((i) => {
      // Hanya warna yang benar-benar sudah diterima (ada roll receipt) yang ditampilkan di label Warna.
      const receivedColorEntries = i.colorEntries.filter((c) => {
        const key = c.warna + "|" + c.lengan;
        return (i.rollReceipts[key] ?? []).some((r) => r != null);
      });
      const rollProduksi = receivedColorEntries.reduce((sum, c) => sum + (groupFor(i.mrpId, c.warna, c.lengan)?.used ?? 0), 0);
      const rollSisa = receivedColorEntries.reduce((sum, c) => sum + (groupFor(i.mrpId, c.warna, c.lengan)?.remaining ?? 0), 0);
      return {
        invoiceId: i.id,
        colorDetail: i.colorEntries.map((c) => ({ warna: c.warna, lengan: c.lengan, roll: c.rolls.length })),
        warnaLabel: receivedColorEntries.length > 0 ? receivedColorEntries.map((c) => `${c.warna} · ${c.lengan}`).join(", ") : "Menunggu diterima",
        roll: i.qtyReady,
        rollProduksi,
        rollSisa,
        status: i.status,
        deliveredAt: i.deliveredAt,
        receivedAt: i.receivedAt,
        productionStart: i.productionStart,
      };
    });
    return {
      poId: p.id,
      mrpId: p.mrpId,
      supplier: p.supplier,
      totalRoll: p.rollCount,
      waitingRoll: p.rollCount - p.invoicedRolls,
      invoices: invoiceSubs,
    };
  });

  // Item revisi 2026-09-17 lanjutan: dikumpulkan per No. MRP (bukan per PO lagi) -- 1 No. MRP bisa
  // punya beberapa PO material, semuanya sekarang jadi 1 baris top-level, rinciannya (per PO, per
  // invoice) ada di InvoiceListExpanded lewat expand baris.
  const rows: Row[] = Array.from(new Set(poRows.map((p) => p.mrpId))).map((mrpId): Row => {
    const pos = poRows.filter((p) => p.mrpId === mrpId);
    const allInvoices = pos.flatMap((p) => p.invoices);
    const status =
      allInvoices.length > 0
        ? allInvoices.reduce((best, x) => (STATUS_RANK.indexOf(x.status) > STATUS_RANK.indexOf(best) ? x.status : best), allInvoices[0].status)
        : "WAITING_INVOICE";
    return {
      mrpId,
      poCount: pos.length,
      invoiceCount: allInvoices.length,
      suppliers: Array.from(new Set(pos.map((p) => p.supplier))).join(", "),
      totalRoll: pos.reduce((s, p) => s + p.totalRoll, 0),
      waitingRoll: pos.reduce((s, p) => s + p.waitingRoll, 0),
      rollProduksi: allInvoices.reduce((s, x) => s + x.rollProduksi, 0),
      rollSisa: allInvoices.reduce((s, x) => s + x.rollSisa, 0),
      status,
      pos,
    };
  });

  // Item revisi 2026-09-17: kolom sekarang di level No. MRP (bukan per PO/invoice lagi, lihat
  // catatan Row/PoRow/InvoiceSub di atas) -- rincian per PO & per invoice dipindah ke expand.
  const columns: ColumnDef<Row>[] = [
    { key: "supplier", label: "Supplier", default: false, render: (r) => r.suppliers },
    { key: "totalRoll", label: "Total roll PO", default: true, align: "right", render: (r) => r.totalRoll + " roll" },
    { key: "waitingRoll", label: "Belum diinvoice", default: false, align: "right", render: (r) => (r.waitingRoll > 0 ? r.waitingRoll + " roll" : "—") },
    // Revisi 2026-09-19: "Qty roll receiving" (total roll yang pernah diterima) diganti "Qty roll
    // stock" = roll yang sudah diterima tapi belum dipakai produksi (rollSisa, dulunya kolom
    // "Sisa roll material" yang disembunyikan -- digabung ke sini supaya tidak dobel).
    { key: "rollSisa", label: "Qty roll stock", default: true, align: "right", render: (r) => r.rollSisa },
    { key: "rollProduksi", label: "Qty roll produksi", default: true, align: "right", render: (r) => r.rollProduksi },
    {
      key: "status",
      label: "Status",
      default: true,
      render: (r) =>
        r.status === "WAITING_INVOICE" ? (
          <StatusPill tone="warning">WAITING INVOICE</StatusPill>
        ) : (
          <StatusPill tone={invoiceBadge(r.status as RawMaterialInvoice["status"]).tone}>{invoiceBadge(r.status as RawMaterialInvoice["status"]).label}</StatusPill>
        ),
    },
    { key: "remark", label: "Remark", default: false, render: (r) => REMARK_BY_STATUS[r.status] ?? "—" },
    { key: "poCount", label: "Jumlah PO", default: false, align: "right", render: (r) => r.poCount },
    { key: "invoiceCount", label: "Jumlah Invoice", default: false, align: "right", render: (r) => r.invoiceCount },
  ];

  return (
    <AppShell
      role="vendorMaklon"
      vendorId={vendorId}
      activeHref="/vendor-maklon/po-material"
      breadcrumb={["Dashboard", "PO Material Saya"]}
      title="PO Material Saya"
      subtitle={`${rows.length} No. MRP material yang ditujukan ke vendor Anda, sudah disetujui Finance`}
      roleOverride={VENDOR_PRODUKSI[vendorId]?.name ?? vendorId}
      entityOverride="Vendor Produksi"
    >
      <DataTable
        title="PO material tujuan saya"
        columns={columns}
        rows={rows}
        keyOf={(r) => r.mrpId}
        firstColumnLabel="No. MRP"
        firstColumnRender={(r) => <span className="font-mono">{r.mrpId}</span>}
        filterDefs={[
          { label: "No MRP", options: Array.from(new Set(rows.map((r) => r.mrpId))), test: (r, v) => r.mrpId === v },
          { label: "No PO", options: Array.from(new Set(poRows.map((p) => p.poId))), test: (r, v) => r.pos.some((p) => p.poId === v) },
          { label: "Status", options: Array.from(new Set(rows.map((r) => r.status))), test: (r, v) => r.status === v },
        ]}
        emptyText="Belum ada PO material yang disetujui Finance untuk vendor Anda."
        renderExpanded={(r) => <InvoiceListExpanded vendorId={vendorId} group={r} />}
      />
    </AppShell>
  );
}

export default function VendorPoMaterialPage() {
  return <VendorAuthGuard>{(vendorId) => <PoMaterialContent vendorId={vendorId} />}</VendorAuthGuard>;
}
