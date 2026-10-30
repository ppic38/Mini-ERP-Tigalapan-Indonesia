"use client";

import { downloadPaymentProposalPdf } from "@/lib/mrp/exportProposalPdf";
import { buildAutoProposal } from "@/lib/mrp/proposal";
import { localDateString, vendorInvoiceFinalAmount } from "@/lib/mrp/derive";
import { useMrpStore } from "@/lib/mrp/store";
import { VENDOR_PRODUKSI } from "@/lib/mrp/seed";
import type { VendorInvoice } from "@/lib/mrp/types";

/** Kolom "Proposal" di Payment Maklon: proposal pembayaran dibuat OTOMATIS oleh sistem dari invoice ini (nomor, nama kegiatan + kategori,
 *  tagihan, DP) dan diunduh sebagai PDF -- Procurement tidak perlu membuatnya (owner 2026-10-30). */
export function ProposalCell({ inv, vendorInvoices }: { inv: VendorInvoice; vendorInvoices: VendorInvoice[] }) {
  const mrpDetails = useMrpStore((s) => s.mrpDetails);
  return (
    <span onClick={(e) => e.stopPropagation()} className="flex flex-col gap-0.5 font-sans text-[11px]">
      <button
        onClick={() => {
          const proposal = buildAutoProposal(inv, vendorInvoices, mrpDetails, localDateString(new Date()));
          downloadPaymentProposalPdf(proposal, [
            {
              id: inv.id,
              vendor: VENDOR_PRODUKSI[inv.vendorProduksi]?.name ?? inv.vendorProduksi,
              mrp: Array.from(new Set(inv.lines.map((l) => l.mrpId))).join(", "),
              amount: vendorInvoiceFinalAmount(inv),
            },
          ]);
        }}
        className="w-fit font-semibold text-action-primary underline"
      >
        Download proposal
      </button>
    </span>
  );
}
