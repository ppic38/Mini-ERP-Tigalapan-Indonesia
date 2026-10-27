import { viewAttachments } from "./attachments";

/** Buka bukti pembayaran invoice vendor produksi (migration 0075; bisa lebih dari satu file, migration 0080). Satu tombol membuka semua file dalam satu tab. */
export function viewVendorInvoicePaymentProof(invoiceId: string): Promise<void> {
  return viewAttachments("VENDOR_INVOICE_PROOF", invoiceId, "Bukti pembayaran untuk invoice ini belum dilampirkan.");
}
