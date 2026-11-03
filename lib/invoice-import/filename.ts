// Aturan nama file invoice supplier untuk fitur "Upload Invoice Supplier" di Paying Voucher.
// Owner 2026-10-29: SATU format untuk semua supplier -- NOINVOICE.KODETRANSAKSI.pdf. Nomor invoice dan kode transaksi
// diambil dari nama file (tidak dari isi PDF); vendor tujuan tidak perlu di nama file karena sudah ditentukan PO yang dibuka.
// File yang tidak mengikuti format DITOLAK dan pesan penolakan menyebut format yang benar. Murni (tanpa DOM/React).

export type FileNameRule = {
  /** Pola nomor invoice (huruf besar) milik supplier ini. */
  noPattern: RegExp;
  /** Contoh nama file yang benar, ditampilkan di layar upload dan di pesan penolakan. */
  example: string;
  /** Supplier yang nomor invoicenya sekaligus kode transaksi/transfer (mis. FABRIKU): kode transaksi boleh sama dengan nomor invoice,
   *  selain 4 digit angka. Tanpa ini kode transaksi WAJIB 4 digit angka. */
  kodeAlsoInvoiceNo?: boolean;
};

export type FileNameCheck = { ok: true; noInvoice: string; kodeTransaksi: string } | { ok: false; message: string };

/** Hapus folder, ekstensi .pdf, dan akhiran salinan Windows/browser (" - Copy", " (1)"). */
function baseName(name: string): string {
  return String(name || "")
    .replace(/^.*[\\/]/, "")
    .replace(/\.pdf$/i, "")
    .replace(/(\s*-\s*copy)?(\s*\(\d+\))?\s*$/i, "")
    .trim();
}

/** Kode transaksi sah = 4 digit angka, atau (khusus supplier yang nomor invoicenya juga kode transaksi) sama dengan nomor invoice. */
export function isValidKodeTransaksi(kode: string, noInvoice: string, allowSameAsInvoice = false): boolean {
  if (/^[0-9]{4}$/.test(kode)) return true;
  return allowSameAsInvoice && !!kode && kode.toUpperCase() === noInvoice.toUpperCase();
}

export function checkInvoiceFileName(fileName: string, rule: FileNameRule): FileNameCheck {
  const fail = (why: string): FileNameCheck => ({
    ok: false,
    message: `Nama file "${fileName}" tidak sesuai format (${why}). Ubah nama file menjadi NOINVOICE.KODETRANSAKSI.pdf — kode transaksi 4 digit${rule.kodeAlsoInvoiceNo ? " (atau sama dengan nomor invoice, mis. A027.A027.pdf)" : ""}, contoh: ${rule.example}`,
  });
  const parts = baseName(fileName).split(".");
  if (parts.length !== 2) return fail(parts.length < 2 ? "tidak ada kode transaksi" : "hanya boleh dua bagian dipisah satu titik");
  const noInvoice = parts[0].trim().toUpperCase();
  const kode = parts[1].trim();
  if (!rule.noPattern.test(noInvoice)) return fail("nomor invoice tidak dikenali");
  if (!isValidKodeTransaksi(kode, noInvoice, rule.kodeAlsoInvoiceNo)) return fail(rule.kodeAlsoInvoiceNo ? "kode transaksi harus 4 digit angka atau sama dengan nomor invoice" : "kode transaksi harus 4 digit angka");
  return { ok: true, noInvoice, kodeTransaksi: /^[0-9]{4}$/.test(kode) ? kode : kode.toUpperCase() };
}
