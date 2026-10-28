// Aturan nama file invoice supplier untuk fitur "Upload Invoice Supplier" di Paying Voucher.
// Owner 2026-10-29: SATU format untuk semua supplier -- NOINVOICE.KODETRANSAKSI.pdf. Nomor invoice dan kode transaksi
// diambil dari nama file (tidak dari isi PDF); vendor tujuan tidak perlu di nama file karena sudah ditentukan PO yang dibuka.
// File yang tidak mengikuti format DITOLAK dan pesan penolakan menyebut format yang benar. Murni (tanpa DOM/React).

export type FileNameRule = {
  /** Pola nomor invoice (huruf besar) milik supplier ini. */
  noPattern: RegExp;
  /** Contoh nama file yang benar, ditampilkan di layar upload dan di pesan penolakan. */
  example: string;
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

export function checkInvoiceFileName(fileName: string, rule: FileNameRule): FileNameCheck {
  const fail = (why: string): FileNameCheck => ({
    ok: false,
    message: `Nama file "${fileName}" tidak sesuai format (${why}). Ubah nama file menjadi NOINVOICE.KODETRANSAKSI.pdf — kode transaksi 4 digit, contoh: ${rule.example}`,
  });
  const parts = baseName(fileName).split(".");
  if (parts.length !== 2) return fail(parts.length < 2 ? "tidak ada kode transaksi" : "hanya boleh dua bagian dipisah satu titik");
  const noInvoice = parts[0].trim().toUpperCase();
  const kode = parts[1].trim();
  if (!rule.noPattern.test(noInvoice)) return fail("nomor invoice tidak dikenali");
  if (!/^\d{4}$/.test(kode)) return fail("kode transaksi harus 4 digit angka");
  return { ok: true, noInvoice, kodeTransaksi: kode };
}
