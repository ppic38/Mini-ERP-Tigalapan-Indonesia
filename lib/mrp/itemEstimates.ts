import { addDays, localDateString } from "./derive";

// Aturan estimasi Tracking Item (owner 2026-11-07). Tanggal GR dan tanggal Cutting adalah tanggal AKTUAL (tanpa estimasi); estimasi hanya untuk tahap berikutnya:
//   Est. FG    = tanggal cutting + LT_CUTTING_KE_FG
//   Est. Kirim = tanggal FG (aktual, atau Est. FG kalau belum) + LT_FG_KE_KIRIM
//   Est. Tiba  = tanggal kirim (aktual, atau Est. Kirim kalau belum) + LT tiba di DC
// Ubah angka di sini kalau aturannya berubah; semua kolom dan Excel export ikut.
export const LT_CUTTING_KE_FG = 3;
export const LT_FG_KE_KIRIM = 1;
export const LT_TIBA_DEFAULT = 7;
/** Lead time kirim sampai tiba di DC per vendor produksi; vendor yang tidak ada di sini memakai LT_TIBA_DEFAULT. Konveksi Makassar 1 hari (sama dengan Excel estimasi pengiriman owner). */
export const LT_TIBA_BY_VENDOR: Record<string, number> = { MKS: 1 };

export const ltTiba = (vendorId: string): number => LT_TIBA_BY_VENDOR[vendorId] ?? LT_TIBA_DEFAULT;

/** Kunci tanggal lokal "YYYY-MM-DD" dari tanggal polos atau stempel waktu ISO (stempel waktu dikonversi ke tanggal lokal). Kosong/tidak valid = undefined. */
export function dayKey(value?: string | null): string | undefined {
  if (!value) return undefined;
  const s = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? undefined : localDateString(d);
}

/** Tanggal dari isian bebas (mis. kolom `diterima_pada` WOS): menerima yyyy-mm-dd dan dd/mm/yyyy (hari lebih dulu); selain itu undefined. */
export function parseLooseDay(value?: string | null): string | undefined {
  if (!value) return undefined;
  const s = value.trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const dmy = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/.exec(s);
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}`;
  return undefined;
}

export const plusDays = (iso: string | undefined, days: number): string | undefined => (iso ? addDays(iso, days) : undefined);
export const maxDay = (a?: string, b?: string): string | undefined => (a && b ? (a > b ? a : b) : a ?? b);
export const minDay = (a?: string, b?: string): string | undefined => (a && b ? (a < b ? a : b) : a ?? b);
