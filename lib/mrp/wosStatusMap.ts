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
    byKoli[koli] = {
      code: mapWosStatus(raw),
      raw,
      qtyDiterima: Number.isFinite(q) && (r[iQty] ?? "").trim() !== "" ? q : null,
      diterimaPada: iDate >= 0 && (r[iDate] ?? "").trim() ? (r[iDate] ?? "").trim() : null,
    };
  }
  return { hasStatusColumn: true, byKoli };
}
