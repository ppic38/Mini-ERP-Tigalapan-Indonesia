"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Building2, Eye, EyeOff } from "lucide-react";
import { useVendorAuthStore } from "@/lib/mrp/vendor-auth-store";

/** Revisi 2026-09-29 (owner tolak model "Akun Utama"/"Anggota Tim" berjenjang, sama kayak
 *  revisi login modul internal di app/page.tsx) -- SATU form rata: "Nama Vendor / Username" +
 *  Password. Server yang menentukan itu akun utama (login lewat nama vendor) atau akun anggota
 *  tim (login lewat username unik) -- dicoba login() dulu (akun utama), kalau gagal baru dicoba
 *  loginUser() (akun anggota tim), TANPA toggle/tab yang bikin kesan berjenjang. */
export default function VendorLoginPage() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const login = useVendorAuthStore((s) => s.login);
  const loginUser = useVendorAuthStore((s) => s.loginUser);
  const loggedInVendorId = useVendorAuthStore((s) => s.loggedInVendorId);
  const router = useRouter();

  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    if (mounted && loggedInVendorId) router.replace("/vendor-maklon/po-produksi");
  }, [mounted, loggedInVendorId, router]);

  if (!mounted) return null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    const ok = (await login(identifier, password)) || (await loginUser(identifier, password));
    setSubmitting(false);
    if (ok) {
      router.push("/vendor-maklon/po-produksi");
    } else {
      setError("Nama vendor / username atau password salah.");
    }
  }

  return (
    <div
      className="flex min-h-screen flex-col items-center justify-center px-4 py-12"
      style={{ background: "linear-gradient(160deg, #000000 0%, #050912 30%, #0A1B3D 62%, var(--accent-blue) 100%)" }}
    >
      <div className="w-full max-w-[380px]">
        <Link href="/" className="mb-4 flex items-center gap-1.5 font-sans text-[11.5px] font-medium text-white/60 hover:text-white/90">
          <ArrowLeft size={13} />
          Kembali
        </Link>

        <div className="rounded-xl border border-white/10 bg-surface-card p-6 shadow-[0_16px_40px_rgba(0,0,0,.3)]">
          <span className="flex h-[64px] w-[64px] items-center justify-center rounded-lg bg-accent-orange-bg">
            <Building2 size={28} strokeWidth={1.75} className="text-accent-orange" />
          </span>
          <div className="mt-4 font-heading text-xl font-bold text-text-primary">Login Vendor Produksi</div>
          <div className="mt-1.5 font-sans text-xs text-text-muted">Masukkan nama vendor atau username Anda, beserta password.</div>

          <form onSubmit={handleSubmit} className="mt-5 flex flex-col gap-3">
            <div>
              <div className="font-sans text-[10.5px] font-medium uppercase tracking-wider text-text-muted">Username</div>
              <input
                value={identifier}
                onChange={(e) => {
                  setIdentifier(e.target.value);
                  setError("");
                }}
                className="input mt-1"
                autoFocus
                placeholder=""
              />
            </div>
            <div>
              <div className="font-sans text-[10.5px] font-medium uppercase tracking-wider text-text-muted">Password</div>
              <div className="relative mt-1">
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="input !pr-9"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  tabIndex={-1}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary"
                  aria-label={showPassword ? "Sembunyikan password" : "Tampilkan password"}
                >
                  {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
            </div>
            {error && <div className="font-sans text-[11.5px] font-medium text-danger-fg">{error}</div>}
            <button
              type="submit"
              disabled={submitting}
              className="mt-1 flex items-center justify-center gap-1.5 rounded-md bg-accent-orange px-3.5 py-2 font-sans text-xs font-semibold text-white disabled:opacity-60"
            >
              {submitting ? "Memeriksa..." : "Masuk"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
