import { getInvoiceBuktiPvAction } from "./actions";
import { downloadDataUrl, fillPreviewWindow, openPreviewWindow } from "./clientFiles";

/** Buka lampiran Paying Voucher sebuah invoice. PDF-nya tidak ikut snapshot (migration 0066) jadi diambil saat
 *  diklik; tab dibuka SEKARANG (sebelum await) supaya tidak diblokir popup blocker -- pola sama bukti pembayaran.
 *
 *  Revisi 2026-10-19 (owner: lampiran "tidak bisa diklik"): dulu semua kegagalan (file tidak ada, server menolak,
 *  tab diblokir) DIAM-DIAM -- tab ditutup lagi dan tombol terlihat tidak berfungsi. Sekarang kegagalan selalu
 *  ditampilkan lewat pesan, dan kalau tab preview diblokir browser, file diunduh sebagai cadangan. */
export async function viewInvoiceBuktiPv(invoiceId: string): Promise<void> {
  const win = openPreviewWindow();
  try {
    const res = await getInvoiceBuktiPvAction(invoiceId);
    if (!res.ok) {
      win?.close();
      window.alert("Gagal membuka lampiran invoice: " + res.error);
      return;
    }
    const file = res.data;
    if (!file) {
      win?.close();
      window.alert("Lampiran invoice ini tidak ditemukan di server.");
      return;
    }
    if (win) fillPreviewWindow(win, file.dataUrl);
    else downloadDataUrl(file.dataUrl, file.fileName ?? `lampiran-${invoiceId}.pdf`);
  } catch (err) {
    win?.close();
    window.alert("Gagal membuka lampiran invoice: " + (err instanceof Error ? err.message : String(err)));
  }
}
