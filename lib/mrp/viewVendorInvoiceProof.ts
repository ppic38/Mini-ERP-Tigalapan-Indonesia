import { getVendorInvoicePaymentProofAction } from "./actions";
import { downloadDataUrl, fillPreviewWindow, openPreviewWindow } from "./clientFiles";

/** Buka bukti pembayaran invoice vendor produksi (migration 0075). Tab dibuka SEKARANG (sebelum await) supaya tidak diblokir popup blocker;
 *  kegagalan selalu ditampilkan lewat pesan, dan kalau tab diblokir browser file diunduh sebagai cadangan. */
export async function viewVendorInvoicePaymentProof(invoiceId: string): Promise<void> {
  const win = openPreviewWindow();
  try {
    const res = await getVendorInvoicePaymentProofAction(invoiceId);
    if (!res.ok) {
      win?.close();
      window.alert("Gagal membuka bukti pembayaran: " + res.error);
      return;
    }
    if (!res.data) {
      win?.close();
      window.alert("Bukti pembayaran untuk invoice ini belum dilampirkan.");
      return;
    }
    if (win) fillPreviewWindow(win, res.data.dataUrl);
    else downloadDataUrl(res.data.dataUrl, res.data.fileName ?? `bukti-bayar-${invoiceId}.pdf`);
  } catch (err) {
    win?.close();
    window.alert("Gagal membuka bukti pembayaran: " + (err instanceof Error ? err.message : String(err)));
  }
}
