/** Status penerimaan gudang dari WOS yang dibaca balik dari tab ERP_INCOMING (owner 2026-11-05): WOS mengisi kolom status per baris koli, ERP
 *  menampilkannya (mis. di Tracking Item) supaya PPIC tahu koli dan item mana yang sudah diterima gudang WOS. Murni fungsi tanpa server
 *  (aman diimpor klien). Pembacaan sheet-nya ada di wosStatusActions.ts. */

export type WosStatusCode = "DALAM_PERJALANAN" | "TIBA" | "DITERIMA" | "BERMASALAH" | "UNKNOWN";

export type WosKoliStatus = {
  code: WosStatusCode;
  /** Isi sel status apa adanya (untuk tooltip dan status yang tidak dikenali). */
  raw: string;
  /** Kolom opsional `qty_diterima` (jumlah pcs yang dihitung WOS), null kalau kolom/isinya tidak ada. */
  qtyDiterima: number | null;
  /** Kolom opsional `diterima_pada`. */
  diterimaPada: string | null;
};

export const WOS_STATUS_LABEL: Record<WosStatusCode, string> = {
  DALAM_PERJALANAN: "Dalam perjalanan",
  TIBA: "Tiba, belum validasi",
  DITERIMA: "Diterima",
  BERMASALAH: "Diterima (bermasalah)",
  UNKNOWN: "Status lain",
};

/** Padanan toleran isi kolom status WOS: tidak peduli huruf besar/kecil dan kata tambahan.
 *  Contoh: "Diterima" / "Bermasalah" / "Datang" / "Datang-Masalah" (istilah tab KOLI WOS), "Tiba, belum validasi", "Belum diterima", kosong. */
export function mapWosStatus(raw: string): WosStatusCode {
  const t = raw.trim().toLowerCase();
  if (!t) return "DALAM_PERJALANAN";
  if (/belum\s+(di)?(terima|datang|tiba)/.test(t)) return "DALAM_PERJALANAN";
  if (/masalah/.test(t)) return /(datang|tiba)/.test(t) ? "TIBA" : "BERMASALAH";
  if (/(terima|received)/.test(t)) return "DITERIMA";
  if (/(datang|tiba|arrived|validasi)/.test(t)) return "TIBA";
  if (/(perjalanan|transit|kirim)/.test(t)) return "DALAM_PERJALANAN";
  return "UNKNOWN";
}

const STATUS_HEADERS = ["status_wos", "status"];

/** Sejak 2026-11-06 satu koli punya beberapa baris (satu per item). Status koli = baris yang paling "belum selesai": bermasalah paling atas, lalu status tak dikenal,
 *  lalu dalam perjalanan, tiba, dan diterima -- koli baru tampil Diterima kalau SEMUA barisnya diterima. `qty_diterima` dijumlahkan, tanggal diterima = yang terbaru. */
const MERGE_PRIORITY: Record<WosStatusCode, number> = { BERMASALAH: 4, UNKNOWN: 3, DALAM_PERJALANAN: 2, TIBA: 1, DITERIMA: 0 };

function mergeKoliStatus(a: WosKoliStatus, b: WosKoliStatus): WosKoliStatus {
  const top = MERGE_PRIORITY[b.code] > MERGE_PRIORITY[a.code] ? b : a;
  const qty = a.qtyDiterima == null && b.qtyDiterima == null ? null : (a.qtyDiterima ?? 0) + (b.qtyDiterima ?? 0);
  const dates = [a.diterimaPada, b.diterimaPada].filter((d): d is string => !!d).sort();
  return { code: top.code, raw: top.raw, qtyDiterima: qty, diterimaPada: dates.length > 0 ? dates[dates.length - 1] : null };
}

/** Ubah isi tab (baris judul + baris data) menjadi peta id koli ERP -> status. `hasStatusColumn` false kalau tab belum punya kolom status. */
export function parseWosStatusRows(headers: string[], rows: string[][]): { hasStatusColumn: boolean; byKoli: Record<string, WosKoliStatus> } {
  const idx = (names: string[]) => headers.findIndex((h) => names.includes(h.trim().toLowerCase()));
  const iKoli = idx(["koli_erp"]);
  const iStatus = idx(STATUS_HEADERS);
  const iQty = idx(["qty_diterima"]);
  const iDate = idx(["diterima_pada"]);
  if (iKoli < 0 || iStatus < 0) return { hasStatusColumn: false, byKoli: {} };
  const byKoli: Record<string, WosKoliStatus> = {};
  for (const r of rows) {
    const koli = (r[iKoli] ?? "").trim();
    if (!koli) continue;
    const raw = (r[iStatus] ?? "").trim();
    const q = iQty >= 0 ? Number((r[iQty] ?? "").replace(/[^\d.-]/g, "")) : NaN;
    const next: WosKoliStatus = {
      code: mapWosStatus(raw),
      raw,
      qtyDiterima: Number.isFinite(q) && (r[iQty] ?? "").trim() !== "" ? q : null,
      diterimaPada: iDate >= 0 && (r[iDate] ?? "").trim() ? (r[iDate] ?? "").trim() : null,
    };
    byKoli[koli] = byKoli[koli] ? mergeKoliStatus(byKoli[koli], next) : next;
  }
  return { hasStatusColumn: true, byKoli };
}
