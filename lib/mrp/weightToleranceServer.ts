import "server-only";
import { supabaseServer } from "../supabase/server";
import { DEFAULT_WEIGHT_TOLERANCE_PCT, setWeightTolerancePct } from "./derive";

/** Kunci baris toleransi selisih berat di tabel `app_number_settings` (migration 0061). */
export const WEIGHT_TOLERANCE_KEY = "weight_tolerance_pct";

/** Baca toleransi selisih berat (%) dari database dan pasang sebagai toleransi AKTIF di derive.ts.
 *  Dipanggil di awal setiap aksi server yang memakai weightVariance/materialClaimsList, supaya hasilnya
 *  selalu mengikuti nilai terbaru yang diatur SCM -- bukan nilai basi dari proses server sebelumnya.
 *
 *  AMAN kalau migration 0061 belum dijalankan (tabel belum ada), atau barisnya kosong/rusak: jatuh ke
 *  DEFAULT_WEIGHT_TOLERANCE_PCT (8) tanpa melempar error, sama seperti pola readDataVersion. */
export async function loadWeightTolerancePct(): Promise<number> {
  let pct = DEFAULT_WEIGHT_TOLERANCE_PCT;
  try {
    const { data, error } = await supabaseServer().from("app_number_settings").select("value").eq("key", WEIGHT_TOLERANCE_KEY).maybeSingle();
    if (!error && data) {
      const n = Number(data.value);
      if (Number.isFinite(n) && n >= 0) pct = n;
    }
  } catch {
    // tabel belum ada / gagal dibaca -- pakai default.
  }
  setWeightTolerancePct(pct);
  return pct;
}
