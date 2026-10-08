"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Building2 } from "lucide-react";
import { useVendorAuthStore } from "@/lib/mrp/vendor-auth-store";
import { VendorLoginForm } from "@/components/mrp/vendor-login-form";

/** Halaman login Vendor Produksi (dipakai kalau sesi berakhir / dibuka langsung lewat alamatnya). Dari halaman
 *  pilih modul, login yang sama muncul sebagai panel yang membesar dari kartu "Vendor Produksi" (app/page.tsx).
 *  Isi form-nya satu komponen bersama: components/mrp/vendor-login-form.tsx. */
export default function VendorLoginPage() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const loggedInVendorId = useVendorAuthStore((s) => s.loggedInVendorId);
  const router = useRouter();

  useEffect(() => {
    if (mounted && loggedInVendorId) router.replace("/vendor-maklon/po-produksi");
  }, [mounted, loggedInVendorId, router]);

  if (!mounted) return null;

  return (
    <div
      className="flex min-h-screen flex-col items-center justify-center px-4 py-12"
      style={{ background: "linear-gradient(160deg, #000000 0%, #050912 30%, #0A1B3D 62%, var(--accent-blue) 100%)" }}
    >
      <div className="w-full max-w-[380px]">
        <Link href="/" className="mb-4 flex items-center justify-end gap-1.5 font-sans text-[11.5px] font-medium text-white/60 hover:text-white/90">
          <ArrowLeft size={13} />
          Kembali
        </Link>

        <div className="rounded-xl border border-white/10 bg-surface-card p-6 shadow-[0_16px_40px_rgba(0,0,0,.3)]">
          <div className="flex items-center gap-3.5">
            <span className="flex h-14 w-14 flex-none items-center justify-center rounded-lg bg-accent-orange-bg">
              <Building2 size={26} strokeWidth={1.75} className="text-accent-orange" />
            </span>
            <div className="min-w-0">
              <div className="font-heading text-lg font-bold leading-tight text-text-primary">Login Vendor Produksi</div>
              <div className="mt-1 font-sans text-[11.5px] leading-snug text-text-muted">Masukkan nama vendor atau username Anda, beserta password.</div>
            </div>
          </div>

          <div className="mt-6">
            <VendorLoginForm onSuccess={() => router.push("/vendor-maklon/po-produksi")} />
          </div>
        </div>
      </div>
    </div>
  );
}
