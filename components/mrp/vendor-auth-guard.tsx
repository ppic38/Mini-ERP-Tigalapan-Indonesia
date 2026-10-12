"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useVendorAuthStore } from "@/lib/mrp/vendor-auth-store";
import { useSysadminMode } from "@/lib/shell/use-sysadmin-mode";
import { useSysadminVendorStore } from "@/lib/shell/sysadmin-vendor-store";
import { SysadminVendorPicker } from "@/components/sysadmin/vendor-picker";

/** Penjaga halaman portal Vendor Produksi. Vendor yang login -> halaman dengan vendorId-nya.
 *  Revisi 2026-09-30 (owner: Sysadmin ikut melihat & mengoreksi Vendor Produksi): kalau sesi ini punya
 *  Sysadmin terbuka, Sysadmin masuk TANPA login vendor -- vendorId diambil dari vendor yang dipilihnya
 *  (belum memilih -> layar pilih vendor). Hanya UI; server tetap menolak aksi transaksi vendor karena
 *  sesi Sysadmin tidak punya vendorId (lihat requireVendorSession). */
export function VendorAuthGuard({ children }: { children: (vendorId: string) => ReactNode }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const loggedInVendorId = useVendorAuthStore((s) => s.loggedInVendorId);
  // Mode Sysadmin hanya kalau identitas aktifnya Sysadmin -- vendor yang login SETELAH Sysadmin tetap
  // melihat portalnya sendiri (lihat ActiveIdentity di lib/internal-auth-store.ts).
  const sysadmin = useSysadminMode();
  const sysadminVendorId = useSysadminVendorStore((s) => s.vendorId);
  const loginOrigin = useVendorAuthStore((s) => s.loginOrigin);
  const router = useRouter();

  // Tanpa sesi vendor: kembali ke tempat login terakhir (panel login di halaman utama, atau halaman login vendor) --
  // SAMA dengan tujuan tombol Logout di app-shell, supaya dua pengalihan itu tidak saling berebut arah.
  useEffect(() => {
    if (mounted && !sysadmin && !loggedInVendorId) router.replace(loginOrigin === "chooser" ? "/?masuk=vendor" : "/vendor-maklon/login");
  }, [mounted, sysadmin, loggedInVendorId, loginOrigin, router]);

  if (!mounted) return null;
  if (sysadmin) return sysadminVendorId ? <>{children(sysadminVendorId)}</> : <SysadminVendorPicker />;
  if (!loggedInVendorId) return null;
  return <>{children(loggedInVendorId)}</>;
}
