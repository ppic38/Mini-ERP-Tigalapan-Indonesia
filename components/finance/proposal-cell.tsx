"use client";

import { exportInvoiceProposalPdf } from "@/lib/mrp/exportPoPdf";
import { buildAutoProposal } from "@/lib/mrp/proposal";
import { localDateString } from "@/lib/mrp/derive";
import { useMrpStore } from "@/lib/mrp/store";
import type { VendorInvoice } from "@/lib/mrp/types";

/** Kolom "Proposal" di Payment Maklon: proposal pembayaran dibuat OTOMATIS oleh sistem dari invoice ini (nomor, nama kegiatan + kategori,
 *  rincian, tagihan) dan diunduh sebagai PDF berformat sama dengan PDF PO -- Procurement tidak perlu membuatnya (owner 2026-10-30). */
export function ProposalCell({ inv, vendorInvoices }: { inv: VendorInvoice; vendorInvoices: VendorInvoice[] }) {
  const mrpDetails = useMrpStore((s) => s.mrpDetails);
  return (
    <span onClick={(e) => e.stopPropagation()} className="flex flex-col gap-0.5 font-sans text-[11px]">
      <button
        onClick={() => exportInvoiceProposalPdf(inv, buildAutoProposal(inv, vendorInvoices, mrpDetails, localDateString(new Date())), mrpDetails)}
        className="w-fit font-semibold text-action-primary underline"
      >
        Download proposal
      </button>
    </span>
  );
}
