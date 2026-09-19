// Hasil Server Action yang alasan gagalnya HARUS sampai ke user. Di production Next.js menyembunyikan
// pesan Error yang di-throw dari Server Action (klien hanya melihat "Minified React error #441"),
// jadi aksi yang punya aturan bisnis (mis. gate "Selesai Produksi") mengembalikan objek ini, lalu
// `unwrapAction` di sisi klien melempar ulang Error dengan pesan aslinya.
export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };

export function unwrapAction<T>(result: ActionResult<T>): T {
  if (!result.ok) throw new Error(result.error);
  return result.data;
}
