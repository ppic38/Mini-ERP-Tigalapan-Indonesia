"use client";

import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { useVendorAuthStore } from "@/lib/mrp/vendor-auth-store";

/** Form login Vendor Produksi -- dipakai bersama oleh halaman /vendor-maklon/login dan panel login yang
 *  membesar dari kartu "Vendor Produksi" di halaman pilih modul (app/page.tsx).
 *
 *  SATU form rata (revisi 2026-09-29): "Username" (nama vendor untuk akun utama, atau username anggota tim) +
 *  Password. Server yang menentukan jenis akunnya -- dicoba login() dulu (akun utama), kalau gagal baru
 *  loginUser() (anggota tim), tanpa toggle yang menimbulkan kesan berjenjang. */
export function VendorLoginForm({ onSuccess, autoFocus = true }: { onSuccess: () => void; autoFocus?: boolean }) {
  const login = useVendorAuthStore((s) => s.login);
  const loginUser = useVendorAuthStore((s) => s.loginUser);

  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    const ok = (await login(identifier, password)) || (await loginUser(identifier, password));
    setSubmitting(false);
    if (ok) onSuccess();
    else setError("Nama vendor / username atau password salah.");
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <div>
        <div className="font-sans text-[10.5px] font-medium uppercase tracking-wider text-text-muted">Username</div>
        <input
          value={identifier}
          onChange={(e) => {
            setIdentifier(e.target.value);
            setError("");
          }}
          className="input mt-1"
          autoFocus={autoFocus}
        />
      </div>
      <div>
        <div className="font-sans text-[10.5px] font-medium uppercase tracking-wider text-text-muted">Password</div>
        <div className="relative mt-1">
          <input type={showPassword ? "text" : "password"} value={password} onChange={(e) => setPassword(e.target.value)} className="input !pr-9" />
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
  );
}
