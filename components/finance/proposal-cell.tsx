"use client";

import { downloadPaymentProposalPdf, type ProposalInvoiceRow } from "@/lib/mrp/exportProposalPdf";
import { invoicesOfProposal } from "@/lib/mrp/proposal";
import { vendorInvoiceFinalAmount } from "@/lib/mrp/derive";
import { VENDOR_PRODUKSI } from "@/lib/mrp/seed";
import type { VendorInvoice } from "@/lib/mrp/types";

export function proposalInvoiceRows(inv: VendorInvoice, vendorInvoices: VendorInvoice[]): ProposalInvoiceRow[] {
  const no = inv.proposal?.no;
  const list = no ? invoicesOfProposal(vendorInvoices, no) : [];
  return (list.length > 0 ? list : [inv]).map((i) => ({
    id: i.id,
    vendor: VENDOR_PRODUKSI[i.vendorProduksi]?.name ?? i.vendorProduksi,
    mrp: Array.from(new Set(i.lines.map((l) => l.mrpId))).join(", "),
    amount: vendorInvoiceFinalAmount(i),
  }));
}

/** Kolom "Proposal" di Payment Maklon (pola sama kolom Lampiran Ekspedisi): nomor proposal, nama kegiatan, dan link unduh PDF
 *  supaya Finance tahu invoice ini dibayar untuk proposal/kegiatan apa. Invoice tanpa proposal tampil "—". */
export function ProposalCell({ inv, vendorInvoices }: { inv: VendorInvoice; vendorInvoices: VendorInvoice[] }) {
  const p = inv.proposal;
  if (!p) return <span className="font-sans text-[11px] text-text-muted">—</span>;
  return (
    <span onClick={(e) => e.stopPropagation()} className="flex max-w-[260px] flex-col gap-0.5 font-sans text-[11px]">
      <span className="font-mono font-semibold text-text-primary">{p.no}</span>
      <span className="text-[#31414F]">{p.activity}</span>
      <button onClick={() => downloadPaymentProposalPdf(p, proposalInvoiceRows(inv, vendorInvoices))} className="w-fit font-semibold text-action-primary underline">
        Download PDF
      </button>
    </span>
  );
}
