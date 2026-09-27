"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Building2, Eye, EyeOff, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { useVendorAuthStore } from "@/lib/mrp/vendor-auth-store";

/** Revisi 2026-09-27 (migration 0057, owner: "tim cutting, tim finish good, packing") -- 2 mode
 *  login: "Akun Utama" (ketik nama vendor, seperti sebelumnya, akses penuh) dan "Anggota Tim"
 *  (username unik per anggota, dibuatkan akun utama vendor dari menu "Tim Saya" -- akses dibatasi
 *  ke halaman yang diizinkan saja). Keduanya berbagi 1 form password sama, cuma beda label & aksi
 *  login yang dipanggil (login vs loginUser di lib/mrp/vendor-auth-store.ts). */
export default function VendorLoginPage() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const login = useVendorAuthStore((s) => s.login);
  const loginUser = useVendorAuthStore((s) => s.loginUser);
  const loggedInVendorId = useVendorAuthStore((s) => s.loggedInVendorId);
  const router = useRouter();

  const [mode, setMode] = useState<"main" | "team">("main");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    if (mounted && loggedInVendorId) router.replace("/vendor-maklon/po-produksi");
  }, [mounted, loggedInVendorId, router]);

  if (!mounted) return null;

  function switchMode(next: "main" | "team") {
    setMode(next);
    setUsername("");
    setPassword("");
    setError("");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    const ok = mode === "main" ? await login(username, password) : await loginUser(username, password);
    setSubmitting(false);
    if (ok) {
      router.push("/vendor-maklon/po-produksi");
    } else {
      setError(mode === "main" ? "Nama vendor atau password salah." : "Username atau password salah.");
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
          Kembali ke pilih modul
        </Link>

        <div className="rounded-xl border border-white/10 bg-surface-card p-6 shadow-[0_16px_40px_rgba(0,0,0,.3)]">
          <span className="flex h-[64px] w-[64px] items-center justify-center rounded-lg bg-accent-orange-bg">
            <Building2 size={28} strokeWidth={1.75} className="text-accent-orange" />
          </span>
          <div className="mt-3.5 font-sans text-[13px] font-semibold text-text-muted">Tigalapan Indonesia</div>
          <div className="mt-1 font-heading text-xl font-bold text-text-primary">Login Vendor Produksi</div>

          <div className="mt-4 flex rounded-lg border border-[#DDE4EB] p-1">
            <button
              type="button"
              onClick={() => switchMode("main")}
              className={cn("flex-1 rounded-md py-1.5 font-sans text-[11.5px] font-semibold transition-colors", mode === "main" ? "bg-accent-orange text-white" : "text-text-muted")}
            >
              Akun Utama
            </button>
            <button
              type="button"
              onClick={() => switchMode("team")}
              className={cn("flex-1 rounded-md py-1.5 font-sans text-[11.5px] font-semibold transition-colors", mode === "team" ? "bg-accent-orange text-white" : "text-text-muted")}
            >
              Anggota Tim
            </button>
          </div>
          <div className="mt-2 font-sans text-xs text-text-muted">
            {mode === "main" ? "Ketik nama vendor Anda lalu masukkan password." : "Masukkan username anggota tim (dibuatkan admin vendor) lalu password."}
          </div>

          <form onSubmit={handleSubmit} className="mt-4 flex flex-col gap-3">
            <div>
              <div className="font-sans text-[10.5px] font-medium uppercase tracking-wider text-text-muted">{mode === "main" ? "Nama vendor" : "Username"}</div>
              <input
                value={username}
                onChange={(e) => {
                  setUsername(e.target.value);
                  setError("");
                }}
                className="input mt-1"
                autoFocus
                placeholder={mode === "main" ? "contoh: Cecep" : "contoh: budi.cutting"}
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
                  placeholder="••••••••"
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
              {mode === "team" && <Users size={13} />}
              {submitting ? "Memeriksa..." : "Masuk"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
