"use client";

import { useInternalAuthStore } from "@/lib/internal-auth-store";

/** True kalau sesi ini punya Sysadmin terbuka -- dipakai halaman modul internal untuk menampilkan
 *  tombol koreksi Sysadmin (lihat components/sysadmin/correction-dialog.tsx). Hanya UI: penjaga
 *  sebenarnya tetap `requireSysadmin()` di setiap action lib/mrp/sysadminActions.ts, jadi tombol
 *  yang muncul karena state klien basi tetap ditolak server. */
export function useSysadminMode(): boolean {
  return useInternalAuthStore((s) => s.unlockedRoles.includes("sysadmin"));
}
