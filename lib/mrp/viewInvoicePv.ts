import { getInvoiceBuktiPvAction } from "./actions";
import { fillPreviewWindow, openPreviewWindow } from "./clientFiles";

/** Buka lampiran Paying Voucher sebuah invoice. PDF-nya tidak ikut snapshot (migration 0066) jadi diambil saat
 *  diklik; tab dibuka SEKARANG (sebelum await) supaya tidak diblokir popup blocker -- pola sama bukti pembayaran. */
export async function viewInvoiceBuktiPv(invoiceId: string): Promise<void> {
  const win = openPreviewWindow();
  try {
    const file = await getInvoiceBuktiPvAction(invoiceId);
    if (!file) {
      win?.close();
      return;
    }
    fillPreviewWindow(win, file.dataUrl);
  } catch (err) {
    win?.close();
    throw err;
  }
}
