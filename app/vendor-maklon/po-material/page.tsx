"use client";

import { AppShell } from "@/components/shell/app-shell";
import { StatusPill } from "@/components/ui/status-pill";
import { DataTable, type ColumnDef } from "@/components/mrp/data-table";
import { VendorAuthGuard } from "@/components/mrp/vendor-auth-guard";
import { useMrpStore } from "@/lib/mrp/store";
import { addDays, formatDate, invoiceBadge, receivedNotYetProducedRows } from "@/lib/mrp/derive";
import { VENDOR_PRODUKSI } from "@/lib/mrp/seed";
import type { Lengan, RawMaterialInvoice } from "@/lib/mrp/types";
// Item revisi 2026-09-06: vendor produksi sekarang bisa lihat/download bukti PV & bukti
// pembayaran untuk PO material tujuannya sendiri -- dulu tidak ada sama sekali di halaman ini.
// buktiPvDataUrl/buktiPvFileName sudah ada di snapshot (tidak perlu fetch tambahan); bukti
// pembayaran TETAP fetch on-demand (getInvoicePaymentProofAction, sekarang juga mengizinkan
// vendor tujuan invoice-nya sendiri -- lihat lib/mrp/actions.ts).
import { getInvoicePaymentProofAction } from "@/lib/mrp/actions";
// Revisi 2026-09-08 (bug fix popup blocked): openPreviewWindow/fillPreviewWindow -- lihat
// catatan panjang di lib/mrp/clientFiles.ts.
import { viewAndDownloadFile, openPreviewWindow, fillPreviewWindow } from "@/lib/mrp/clientFiles";

async function viewPaymentProof(invoiceId: string) {
  const win = openPreviewWindow();
  try {
    const proof = await getInvoicePaymentProofAction(invoiceId);
    if (!proof) {
      win?.close();
      return;
    }
    fillPreviewWindow(win, proof.dataUrl);
  } catch (err) {
    win?.close();
    throw err;
  }
}

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
type InvoiceSub = {
  invoiceId: string;
  colorDetail: { warna: string; lengan: Lengan; roll: number }[];
  warnaLabel: string;
  roll: number;
  rollReceiving: number;
  rollProduksi: number;
  rollSisa: number;
  status: string;
  deliveredAt?: string;
  receivedAt?: string;
  productionStart?: string;
  buktiPvDataUrl?: string;
  buktiPvFileName?: string;
  buktiBayarAt?: string;
  buktiBayarFileName?: string;
};

type Row = {
  poId: string;
  mrpId: string;
  supplier: string;
  totalRoll: number;
  waitingRoll: number;
  rollReceiving: number;
  rollProduksi: number;
  rollSisa: number;
  status: string;
  invoices: InvoiceSub[];
};

const STATUS_RANK = ["WAITING_INVOICE", "INVOICED", "PAID", "DELIVERY", "RECEIVING", "WAITING_PRODUCTION", "PRODUCTION_DONE"];

function PoMaterialContent({ vendorId }: { vendorId: string }) {
  const materialPOs = useMrpStore((s) => s.materialPOs);
  const invoices = useMrpStore((s) => s.invoices);
  const productionBatches = useMrpStore((s) => s.productionBatches);

  const myPOs = materialPOs.filter((p) => p.vendorProduksi === vendorId && p.approved && p.status !== "CANCELLED");
  const myInvoices = invoices.filter((i) => i.destinationVendor === vendorId);
  const groupRows = receivedNotYetProducedRows(vendorId, invoices, productionBatches);

  function groupFor(mrpId: string, warna: string, lengan: Lengan) {
    return groupRows.find((g) => g.mrpId === mrpId && g.warna === warna && g.lengan === lengan);
  }

  const rows: Row[] = myPOs.map((p): Row => {
    const poInvoices = myInvoices.filter((i) => i.poId === p.id);
    const invoiceSubs: InvoiceSub[] = poInvoices.map((i) => {
      // Hanya warna yang benar-benar sudah diterima (ada roll receipt) yang ditampilkan di label Warna.
      const receivedColorEntries = i.colorEntries.filter((c) => {
        const key = c.warna + "|" + c.lengan;
        return (i.rollReceipts[key] ?? []).some((r) => r != null);
      });
      const rollReceiving = i.colorEntries.reduce((sum, c) => {
        const key = c.warna + "|" + c.lengan;
        return sum + (i.rollReceipts[key] ?? []).filter((r) => r != null).length;
      }, 0);
      const rollProduksi = receivedColorEntries.reduce((sum, c) => sum + (groupFor(i.mrpId, c.warna, c.lengan)?.used ?? 0), 0);
      const rollSisa = receivedColorEntries.reduce((sum, c) => sum + (groupFor(i.mrpId, c.warna, c.lengan)?.remaining ?? 0), 0);
      return {
        invoiceId: i.id,
        colorDetail: i.colorEntries.map((c) => ({ warna: c.warna, lengan: c.lengan, roll: c.rolls.length })),
        warnaLabel: receivedColorEntries.length > 0 ? receivedColorEntries.map((c) => `${c.warna} · ${c.lengan}`).join(", ") : "Menunggu diterima",
        roll: i.qtyReady,
        rollReceiving,
        rollProduksi,
        rollSisa,
        status: i.status,
        deliveredAt: i.deliveredAt,
        receivedAt: i.receivedAt,
        productionStart: i.productionStart,
        buktiPvDataUrl: i.buktiPvDataUrl,
        buktiPvFileName: i.buktiPvFileName,
        buktiBayarAt: i.buktiBayarAt,
        buktiBayarFileName: i.buktiBayarFileName,
      };
    });
    const waitingRoll = p.rollCount - p.invoicedRolls;
    const status =
      invoiceSubs.length > 0
        ? invoiceSubs.reduce((best, x) => (STATUS_RANK.indexOf(x.status) > STATUS_RANK.indexOf(best) ? x.status : best), invoiceSubs[0].status)
        : "WAITING_INVOICE";
    return {
      poId: p.id,
      mrpId: p.mrpId,
      supplier: p.supplier,
      totalRoll: p.rollCount,
      waitingRoll,
      rollReceiving: invoiceSubs.reduce((s, x) => s + x.rollReceiving, 0),
      rollProduksi: invoiceSubs.reduce((s, x) => s + x.rollProduksi, 0),
      rollSisa: invoiceSubs.reduce((s, x) => s + x.rollSisa, 0),
      status,
      invoices: invoiceSubs,
    };
  });

  // Item revisi 2026-09-17: kolom sekarang di level PO (bukan per invoice/event lagi, lihat
  // catatan Row/InvoiceSub di atas) -- konsisten dengan PO Produksi Saya yang juga 1 baris = 1 PO
  // dengan kolom ringkasan + expand untuk rincian. "Bukti Invoice/Pembayaran" & tanggal per-event
  // dipindah ke rincian per invoice di renderExpanded, karena 1 PO sekarang bisa punya >1 invoice.
  const columns: ColumnDef<Row>[] = [
    { key: "noPo", label: "No PO", default: false, render: (r) => <span className="font-mono font-medium">{r.poId}</span> },
    { key: "supplier", label: "Supplier", default: false, render: (r) => r.supplier },
    { key: "totalRoll", label: "Total roll PO", default: true, align: "right", render: (r) => r.totalRoll + " roll" },
    { key: "waitingRoll", label: "Belum diinvoice", default: true, align: "right", render: (r) => (r.waitingRoll > 0 ? r.waitingRoll + " roll" : "—") },
    { key: "rollReceiving", label: "Qty roll receiving", default: true, align: "right", render: (r) => r.rollReceiving },
    { key: "rollProduksi", label: "Qty roll produksi", default: true, align: "right", render: (r) => r.rollProduksi },
    { key: "rollSisa", label: "Sisa roll material", default: false, align: "right", render: (r) => r.rollSisa },
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
    { key: "invoiceCount", label: "Jumlah Invoice", default: false, align: "right", render: (r) => r.invoices.length },
  ];

  return (
    <AppShell
      role="vendorMaklon"
      vendorId={vendorId}
      activeHref="/vendor-maklon/po-material"
      breadcrumb={["Dashboard", "PO Material Saya"]}
      title="PO Material Saya"
      subtitle={`${rows.length} baris material yang ditujukan ke vendor Anda, sudah disetujui Finance`}
      roleOverride={VENDOR_PRODUKSI[vendorId]?.name ?? vendorId}
      entityOverride="Vendor Produksi"
    >
      <DataTable
        title="PO material tujuan saya"
        columns={columns}
        rows={rows}
        keyOf={(r) => r.poId}
        firstColumnLabel="No. MRP"
        firstColumnRender={(r) => <span className="font-mono">{r.mrpId}</span>}
        filterDefs={[
          { label: "No MRP", options: Array.from(new Set(rows.map((r) => r.mrpId))), test: (r, v) => r.mrpId === v },
          { label: "No PO", options: Array.from(new Set(rows.map((r) => r.poId))), test: (r, v) => r.poId === v },
          { label: "Status", options: Array.from(new Set(rows.map((r) => r.status))), test: (r, v) => r.status === v },
        ]}
        emptyText="Belum ada PO material yang disetujui Finance untuk vendor Anda."
        renderExpanded={(r) =>
          r.invoices.length === 0 ? (
            <div className="font-sans text-[11.5px] text-text-muted">
              Belum ada invoice untuk PO ini — {r.waitingRoll} roll masih menunggu diinvoice supplier.
            </div>
          ) : (
            <div className="flex flex-col gap-2.5">
              {r.invoices.map((inv) => (
                <div key={inv.invoiceId} className="overflow-hidden rounded-md border border-[#E4E8EE] bg-white">
                  <div className="flex flex-wrap items-center gap-2 bg-[#F2F4F7] px-3 py-1.5 font-sans text-[11px] font-medium text-text-primary">
                    <span className="font-mono">{inv.invoiceId}</span>
                    {inv.status === "WAITING_INVOICE" ? (
                      <StatusPill tone="warning">WAITING INVOICE</StatusPill>
                    ) : (
                      <StatusPill tone={invoiceBadge(inv.status as RawMaterialInvoice["status"]).tone}>{invoiceBadge(inv.status as RawMaterialInvoice["status"]).label}</StatusPill>
                    )}
                    <span className="text-text-muted">{REMARK_BY_STATUS[inv.status] ?? "—"}</span>
                    <div className="ml-auto flex items-center gap-2">
                      {inv.buktiPvDataUrl && (
                        <button onClick={() => viewAndDownloadFile(inv.buktiPvDataUrl!)} className="font-semibold text-action-primary underline">
                          Bukti PV
                        </button>
                      )}
                      {inv.buktiBayarAt && (
                        <button onClick={() => viewPaymentProof(inv.invoiceId)} className="font-semibold text-action-primary underline">
                          Bukti Bayar
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="grid grid-cols-4 gap-x-2 border-t border-[#F1F4F7] bg-[#FAFBFC] px-3 py-1.5 font-sans text-[10px] font-medium uppercase tracking-wider text-text-muted">
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
              ))}
            </div>
          )
        }
      />
    </AppShell>
  );
}

export default function VendorPoMaterialPage() {
  return <VendorAuthGuard>{(vendorId) => <PoMaterialContent vendorId={vendorId} />}</VendorAuthGuard>;
}
