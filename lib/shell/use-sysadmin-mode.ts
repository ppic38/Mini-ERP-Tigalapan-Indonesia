"use client";

import { isSysadminActive, useInternalAuthStore } from "@/lib/internal-auth-store";

/** True kalau MODE SYSADMIN sedang aktif: Sysadmin terbuka DAN identitas aktif di browser ini Sysadmin
 *  (login terakhir -- lihat isSysadminActive). Dipakai halaman modul untuk menampilkan tombol koreksi
 *  Sysadmin (components/sysadmin/correction-dialog.tsx), VendorAuthGuard, dan AppShell -- satu
 *  aturan yang sama supaya tampilan tidak saling bertentangan. Hanya UI: penjaga sebenarnya tetap
 *  `requireSysadmin()` di setiap action lib/mrp/sysadminActions.ts, jadi tombol yang muncul karena
 *  state klien basi tetap ditolak server. */
export function useSysadminMode(): boolean {
  const unlockedRoles = useInternalAuthStore((s) => s.unlockedRoles);
  const activeIdentity = useInternalAuthStore((s) => s.activeIdentity);
  return isSysadminActive(unlockedRoles, activeIdentity);
}
