"use client";

import { exportInvoiceProposalPdf } from "@/lib/mrp/exportPoPdf";
import { buildAutoProposal, formatRekTujuan } from "@/lib/mrp/proposal";
import { localDateString } from "@/lib/mrp/derive";
import { useMrpStore } from "@/lib/mrp/store";
import { listVendorBankAccountsAction } from "@/lib/mrp/actions";
import { unwrapAction } from "@/lib/mrp/action-result";
import { alertDialog } from "@/components/ui/confirm-dialog";
import type { VendorInvoice } from "@/lib/mrp/types";

/** Kolom "Proposal" di Payment Maklon: proposal pembayaran dibuat OTOMATIS oleh sistem dari invoice ini (nomor, nama kegiatan + kategori,
 *  rincian, tagihan, rekening tujuan dari Master Data Vendor Produksi) dan diunduh sebagai PDF berformat sama dengan PDF PO --
 *  Procurement tidak perlu membuatnya (owner 2026-10-30). Rekening belum diisi di Master Data = "-". */
export function ProposalCell({ inv, vendorInvoices }: { inv: VendorInvoice; vendorInvoices: VendorInvoice[] }) {
  const mrpDetails = useMrpStore((s) => s.mrpDetails);
  async function download() {
    let rek = "-";
    try {
      const accounts = unwrapAction(await listVendorBankAccountsAction());
      rek = formatRekTujuan(accounts[inv.vendorProduksi]);
    } catch (err) {
      void alertDialog({ title: "Rekening vendor tidak terbaca", message: "Proposal tetap diunduh dengan rekening \"-\". " + (err instanceof Error ? err.message : String(err)), tone: "danger" });
    }
    exportInvoiceProposalPdf(inv, buildAutoProposal(inv, vendorInvoices, mrpDetails, localDateString(new Date()), rek), mrpDetails);
  }
  return (
    <span onClick={(e) => e.stopPropagation()} className="flex flex-col gap-0.5 font-sans text-[11px]">
      <button onClick={() => void download()} className="w-fit font-semibold text-action-primary underline">
        Download proposal
      </button>
    </span>
  );
}
