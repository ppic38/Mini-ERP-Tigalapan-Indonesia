"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Building2, Lock, X, Eye, EyeOff, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { useInternalAuthStore } from "@/lib/internal-auth-store";
import { INTERNAL_ACCOUNTS, type InternalRole } from "@/lib/internal-auth";
import { useVendorAuthStore } from "@/lib/mrp/vendor-auth-store";
import { internalRoleRequiresUsernameAction } from "@/lib/auth/actions";
import { VendorLoginForm } from "@/components/mrp/vendor-login-form";
import { MODULES } from "@/lib/shell/modules";

// Daftar modul (ikon, warna, urutan) ada di lib/shell/modules.ts, dipakai juga oleh pemindah modul di bar atas.

const WELCOME_TITLE = "Mini ERP Tigalapan";
const WELCOME_WORDS = ["Planning", "Procurement", "Produksi", "Finance", "Warehouse"];

/** Panel kiri halaman pilih modul: "Selamat Datang di" + judul diketik satu-satu (typewriter) +
 *  kata modul yang bergantian. Murni dekoratif (aria-hidden pada bagian animasi tidak perlu, teks
 *  akhirnya tetap terbaca). Animasi CSS-nya ada di app/globals.css (welcome-*) dan otomatis mati
 *  untuk pengguna yang memilih "kurangi gerakan" (prefers-reduced-motion). */
function WelcomePanel() {
  const [typed, setTyped] = useState("");
  const [wordIdx, setWordIdx] = useState(0);

  useEffect(() => {
    let i = 0;
    const t = setInterval(() => {
      i += 1;
      setTyped(WELCOME_TITLE.slice(0, i));
      if (i >= WELCOME_TITLE.length) clearInterval(t);
    }, 75);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const t = setInterval(() => setWordIdx((v) => (v + 1) % WELCOME_WORDS.length), 2200);
    return () => clearInterval(t);
  }, []);

  const done = typed.length >= WELCOME_TITLE.length;

  return (
    <div className="text-center lg:text-left">
      <div className="welcome-fade-up font-heading text-[22px] font-medium text-white/80 sm:text-[26px]" style={{ animationDelay: "0.15s" }}>
        Selamat Datang di
      </div>
      <h1 className="mt-1 min-h-[1.15em] font-heading text-[40px] font-bold leading-[1.1] text-white sm:text-[52px] lg:text-[58px]">
        {typed}
        <span className={done ? "welcome-cursor welcome-cursor-idle" : "welcome-cursor"} />
      </h1>
      <p className="welcome-fade-up mt-5 font-heading text-[20px] font-semibold leading-[1.3] text-white/85 sm:text-[22px]" style={{ animationDelay: "1.6s" }}>
        Satu sistem terpadu untuk <span className="text-[#7DB2FF]">operasional produksi.</span>
      </p>
      <div className="welcome-fade-up mt-4 flex items-center justify-center gap-2 font-sans text-[13px] text-white/60 lg:justify-start" style={{ animationDelay: "1.9s" }}>
        <span>Untuk tim</span>
        <span key={wordIdx} className="welcome-word rounded-md border border-white/15 bg-white/10 px-2.5 py-1 font-semibold text-white">
          {WELCOME_WORDS[wordIdx]}
        </span>
      </div>
    </div>
  );
}

export default function ModuleSelectPage() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const login = useInternalAuthStore((s) => s.login);
  const loginUser = useInternalAuthStore((s) => s.loginUser);
  const unlockedRoles = useInternalAuthStore((s) => s.unlockedRoles);
  const setActiveIdentity = useInternalAuthStore((s) => s.setActiveIdentity);
  const logoutVendor = useVendorAuthStore((s) => s.logout);
  const setLoginOrigin = useVendorAuthStore((s) => s.setLoginOrigin);
  const router = useRouter();

  const [selectedRole, setSelectedRole] = useState<InternalRole | null>(null);
  // Revisi 2026-09-29 (migration 0060, owner: "procurement ternyata ada dua orang, fulan dan
  // fulin ... biar tau siapa PIC-nya") -- awalnya dibuat toggle "Akun Utama" vs "Anggota Tim",
  // TAPI owner tolak modelnya: "saya ingin itu tidak berdiri dari akun utama jadi anggota...
  // dengan level akses dan akun yang sama" -- jadi TIDAK ada tingkatan/hierarki lagi. Sekarang
  // satu form login rata: Username (opsional) + Password. Kalau Username diisi -> dicocokkan ke
  // akun bernama yang dibuat Sysadmin (mis. "procurement1", "procurement2", akses sama persis,
  // cuma beda nama biar ketauan siapa yang approve). Kalau Username dikosongkan -> pakai password
  // modul lama (untuk modul yang belum dibuatkan akun bernama sama sekali, tetap bisa login).
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Login Vendor Produksi (revisi 2026-10-08, owner: "kartu Vendor Produksi langsung jadi modul login besar, menghapus
  // modul-modul lain, halamannya tetap sama" + "jangan menutupi semua -- batasnya ujung-ujung modul internal, tidak
  // mengambil teks Pilih Modul dan sisi kiri/kanan"): kartu kecil MEMBESAR menjadi form login seukuran AREA KARTU MODUL
  // (pembungkus gridWrapRef) sementara kartu modul lain memudar; judul "Pilih Modul" dan tepi panel tetap terlihat. Panel
  // tidak berubah ukuran -- lapisan login (absolute di dalam pembungkus) tumbuh dari posisi/ukuran kartu ke inset 0
  // pembungkus (teknik FLIP: ukur kartu -> animasikan ke inset 0).
  // closed -> opening (lapisan di posisi kartu) -> open (lapisan memenuhi panel) -> closing (menyusut kembali).
  const [vendorStage, setVendorStage] = useState<"closed" | "opening" | "open" | "closing">("closed");
  const [vendorRect, setVendorRect] = useState<{ top: number; left: number; width: number; height: number } | null>(null);
  const gridWrapRef = useRef<HTMLDivElement>(null); // pembungkus area kartu modul -- batas lapisan login
  const vendorBtnRef = useRef<HTMLButtonElement>(null);

  function measureVendorCard() {
    const wrap = gridWrapRef.current;
    const btn = vendorBtnRef.current;
    if (!wrap || !btn) return null;
    const w = wrap.getBoundingClientRect();
    const b = btn.getBoundingClientRect();
    return { top: b.top - w.top, left: b.left - w.left, width: b.width, height: b.height };
  }
  function openVendorLogin() {
    // Selalu tampilkan form login vendor dulu, walau sebelumnya ada sesi vendor lain yang masih tersimpan --
    // supaya user memilih akun vendor yang dituju.
    logoutVendor();
    const rect = measureVendorCard();
    if (!rect) {
      router.push("/vendor-maklon/login");
      return;
    }
    setVendorRect(rect);
    setVendorStage("opening");
    // Timer (bukan requestAnimationFrame): rAF berhenti kalau tab tidak aktif dan animasi macet di awal.
    window.setTimeout(() => setVendorStage("open"), 50);
  }
  function closeVendorLogin() {
    const rect = measureVendorCard();
    if (rect) setVendorRect(rect);
    setVendorStage("closing");
    window.setTimeout(() => setVendorStage("closed"), 380);
  }
  useEffect(() => {
    if (vendorStage !== "open") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeVendorLogin();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [vendorStage]); // eslint-disable-line react-hooks/exhaustive-deps

  // Logout vendor yang tadinya login dari panel ini kembali ke sini dengan panel login vendor sudah terbuka (?masuk=vendor).
  useEffect(() => {
    if (!mounted || typeof window === "undefined") return;
    if (new URLSearchParams(window.location.search).get("masuk") !== "vendor") return;
    window.history.replaceState(null, "", "/");
    const t = window.setTimeout(() => {
      const rect = measureVendorCard();
      if (!rect) return;
      setVendorRect(rect);
      setVendorStage("opening");
      window.setTimeout(() => setVendorStage("open"), 50);
    }, 150);
    return () => window.clearTimeout(t);
  }, [mounted]); // eslint-disable-line react-hooks/exhaustive-deps

  // Pemindah modul di bar atas mengarahkan modul yang belum login ke sini (?modul=finance): buka form password-nya.
  useEffect(() => {
    if (!mounted || typeof window === "undefined") return;
    const want = new URLSearchParams(window.location.search).get("modul");
    if (!want) return;
    window.history.replaceState(null, "", "/");
    const found = MODULES.find((m) => m.role === want);
    if (!found) return;
    const t = window.setTimeout(() => setSelectedRole(found.role), 0);
    return () => window.clearTimeout(t);
  }, [mounted]);

  if (!mounted) return null;
  const vendorFaded = vendorStage === "opening" || vendorStage === "open";
  const vendorExpanded = vendorStage === "open";

  function pickRole(role: InternalRole) {
    // Sesi modul ini masih terbuka di browser ini: langsung masuk tanpa mengetik password lagi (gaya Odoo).
    // Akses tetap diperiksa server (proxy.ts); kalau sesinya ternyata sudah habis, halaman modul mengembalikan ke sini.
    if (unlockedRoles.includes(role)) {
      setActiveIdentity(role);
      router.push(INTERNAL_ACCOUNTS.find((a) => a.role === role)!.homeHref);
      return;
    }
    setSelectedRole(role);
    setUsername("");
    setPassword("");
    setShowPassword(false);
    setError("");
  }

  function closeLogin() {
    setSelectedRole(null);
    setPassword("");
    setShowPassword(false);
    setError("");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedRole) return;
    const account = INTERNAL_ACCOUNTS.find((a) => a.role === selectedRole)!;
    const trimmedUsername = username.trim();
    setError("");
    setSubmitting(true);
    const ok = trimmedUsername ? await loginUser(selectedRole, trimmedUsername, password) : await login(selectedRole, password);
    setSubmitting(false);
    if (ok) {
      router.push(account.homeHref);
    } else {
      if (trimmedUsername) setError("Username atau password salah.");
      else setError((await internalRoleRequiresUsernameAction(selectedRole)) ? "Modul ini memakai akun masing-masing. Masukkan username Anda." : "Password salah.");
    }
  }

  return (
    // Revisi 2026-10-06 (owner: tampilan 100% tercrop, minta "Selamat Datang di .." beranimasi di kiri
    // dan container login modul di kanan): layout 2 kolom yang MUAT satu layar di desktop (lg:h-screen),
    // kartu modul dibuat ringkas horizontal (ikon di kiri) supaya 9 kartu tidak lagi memanjang ke bawah.
    // Di layar sempit tersusun vertikal (welcome di atas, modul di bawah) dan halaman bisa discroll.
    <div
      className="relative min-h-screen overflow-hidden lg:h-screen"
      style={{ background: "linear-gradient(160deg, #000000 0%, #050912 30%, #0A1B3D 62%, var(--accent-blue) 100%)" }}
    >
      <div className="welcome-glow welcome-glow-a" />
      <div className="welcome-glow welcome-glow-b" />
      <div className="relative mx-auto grid min-h-screen w-full max-w-[1240px] grid-cols-1 items-center gap-10 px-6 py-10 lg:h-screen lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)] lg:gap-16 lg:px-10 lg:py-6">
        <WelcomePanel />

        <div className="relative rounded-2xl border border-white/10 bg-white/[0.06] p-5 shadow-[0_20px_60px_rgba(0,0,0,.35)] backdrop-blur-md sm:p-6">
          <div className="mb-4">
            <div className="font-heading text-[20px] font-bold text-white">Pilih Modul</div>
            <div className="mt-0.5 font-sans text-[12px] text-white/65">Pilih modul yang ingin Anda akses.</div>
          </div>

      {/* Kartu SELALU punya tinggi tetap (tidak pernah berubah bentuk saat diklik) — form
         password ditampilkan di modal terpisah (lihat di bawah), bukan ditempel di dalam kartu. */}
      <div ref={gridWrapRef} className="relative">
      <div className="grid w-full grid-cols-3 gap-x-2 gap-y-3">
        {MODULES.map((m) => {
          const Icon = m.icon;
          const active = selectedRole === m.role;
          const unlocked = unlockedRoles.includes(m.role);
          return (
            <button
              key={m.role}
              onClick={() => pickRole(m.role)}
              title={unlocked ? m.label + " (sudah masuk)" : m.label}
              className={cn(
                "group flex flex-col items-center gap-2 rounded-xl px-1.5 py-3 text-center font-sans transition-all duration-200 hover:bg-white/10",
                vendorFaded && "pointer-events-none scale-95 opacity-0",
                active && "bg-white/10"
              )}
            >
              <span
                className="relative flex h-[58px] w-[58px] flex-none items-center justify-center rounded-2xl shadow-[0_8px_20px_rgba(0,0,0,.35)] transition-transform duration-200 group-hover:-translate-y-0.5"
                style={{ background: m.color }}
              >
                <Icon size={27} strokeWidth={1.75} className="text-white" />
                {unlocked && <span className="absolute -right-1 -top-1 h-3 w-3 rounded-full bg-[#22C55E] ring-2 ring-[#0B1730]" aria-hidden />}
              </span>
              <span className="min-w-0">
                <span className="block text-[12.5px] font-semibold leading-tight text-white">{m.label}</span>
                <span className="mt-0.5 block text-[10.5px] leading-[1.3] text-white/55">{m.desc}</span>
              </span>
            </button>
          );
        })}

        <button
          ref={vendorBtnRef}
          onClick={openVendorLogin}
          className={cn(
            "group flex flex-col items-center gap-2 rounded-xl px-1.5 py-3 text-center font-sans transition-all duration-200 hover:bg-white/10",
            vendorStage !== "closed" && "invisible"
          )}
        >
          <span className="flex h-[58px] w-[58px] flex-none items-center justify-center rounded-2xl bg-accent-orange shadow-[0_8px_20px_rgba(0,0,0,.35)] transition-transform duration-200 group-hover:-translate-y-0.5">
            <Building2 size={27} strokeWidth={1.75} className="text-white" />
          </span>
          <span className="min-w-0">
            <span className="block text-[12.5px] font-semibold leading-tight text-white">Vendor Produksi</span>
            <span className="mt-0.5 block text-[10.5px] leading-[1.3] text-white/55">Portal vendor</span>
          </span>
        </button>
      </div>

          {vendorStage !== "closed" && (
            <div
              className={cn(
                "absolute z-20 overflow-hidden bg-surface-card shadow-[0_16px_40px_rgba(0,0,0,.35)] transition-[top,left,width,height,border-radius] duration-[380ms] ease-[cubic-bezier(.4,0,.2,1)] motion-reduce:transition-none",
                "rounded-xl"
              )}
              style={vendorExpanded ? { top: 0, left: 0, width: "100%", height: "100%" } : (vendorRect ?? undefined)}
            >
              {/* Wajah kartu (ikon + teks) -- memudar saat lapisan membesar, supaya terasa kartu itu yang berubah jadi form. */}
              <div className={cn("absolute inset-0 flex flex-col items-center justify-center gap-2 transition-opacity duration-150", vendorExpanded ? "opacity-0" : "opacity-100")}>
                <span className="flex h-[58px] w-[58px] flex-none items-center justify-center rounded-2xl bg-accent-orange">
                  <Building2 size={27} strokeWidth={1.75} className="text-white" />
                </span>
                <span className="font-sans text-[12.5px] font-semibold text-text-primary">Vendor Produksi</span>
              </div>

              {(vendorStage === "open" || vendorStage === "closing") && (
                <div
                  className={cn(
                    "absolute inset-0 overflow-y-auto",
                    vendorStage === "open" ? "animate-in fade-in fill-mode-backwards delay-200 duration-300" : "opacity-0 transition-opacity duration-150"
                  )}
                >
                  <button
                    type="button"
                    onClick={closeVendorLogin}
                    className="absolute right-4 top-3.5 z-10 flex items-center gap-1.5 font-sans text-[11.5px] font-medium text-text-muted hover:text-text-primary"
                  >
                    <ArrowLeft size={13} />
                    Kembali
                  </button>
                  <div className="mx-auto flex min-h-full w-full max-w-[340px] flex-col justify-center px-6 py-8">
                    {/* Ikon di kiri, judul + petunjuk di kanannya (setinggi ikon); form di bawahnya, blok seluruhnya di tengah. */}
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
                      <VendorLoginForm
                        onSuccess={() => {
                          setLoginOrigin("chooser");
                          router.push("/vendor-maklon/po-produksi");
                        }}
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
          </div>
        </div>
      </div>

      {selectedRole &&
        (() => {
          const m = MODULES.find((mod) => mod.role === selectedRole)!;
          const Icon = m.icon;
          return (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 px-4" onClick={closeLogin}>
              <div
                className="w-full max-w-[340px] overflow-hidden rounded-xl border border-border-subtle bg-surface-card shadow-[0_20px_50px_rgba(0,0,0,.4)]"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex items-center gap-2.5 border-b border-border-subtle px-4 py-3.5">
                  <span className={cn("flex h-8 w-8 items-center justify-center rounded-lg", m.role === "sysadmin" ? "bg-accent-purple" : "bg-accent-blue")}>
                    <Icon size={16} strokeWidth={1.75} className="text-white" />
                  </span>
                  <span className="font-sans text-[13px] font-semibold text-text-primary">{m.label}</span>
                  <button onClick={closeLogin} className="ml-auto text-text-muted hover:text-danger-fg">
                    <X size={16} />
                  </button>
                </div>
                <form onSubmit={handleSubmit} className="flex flex-col gap-2.5 px-4 py-3.5">
                  {/* Sysadmin cuma punya SATU akun (owner 2026-10-06: "langsung pass saja") -- tanpa
                      kolom username, submit otomatis lewat jalur password modul (username kosong). */}
                  {selectedRole !== "sysadmin" && (
                    <div>
                      <div className="flex items-center gap-1 font-sans text-[9.5px] font-medium uppercase tracking-wider text-text-muted">
                        <Users size={10} />
                        Username
                      </div>
                      <input
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                        className="input mt-1 !py-1.5 !text-[11.5px]"
                        autoFocus
                      />
                    </div>
                  )}
                  <div>
                    <div className="flex items-center gap-1 font-sans text-[9.5px] font-medium uppercase tracking-wider text-text-muted">
                      <Lock size={10} />
                      Password
                    </div>
                    <div className="relative mt-1">
                      <input
                        type={showPassword ? "text" : "password"}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className="input !py-1.5 !pr-8 !text-[11.5px]"
                        autoFocus={selectedRole === "sysadmin"}
                        placeholder="••••••••"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword((v) => !v)}
                        tabIndex={-1}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary"
                        aria-label={showPassword ? "Sembunyikan password" : "Tampilkan password"}
                      >
                        {showPassword ? <EyeOff size={13} /> : <Eye size={13} />}
                      </button>
                    </div>
                  </div>
                  {error && <div className="font-sans text-[10.5px] font-medium text-danger-fg">{error}</div>}
                  <button
                    type="submit"
                    disabled={submitting}
                    className="flex items-center justify-center gap-1.5 rounded-md bg-action-primary px-3 py-[7px] font-sans text-[11.5px] font-semibold text-white disabled:opacity-60"
                  >
                    {submitting ? "Memeriksa..." : "Masuk"}
                  </button>
                </form>
              </div>
            </div>
          );
        })()}
    </div>
  );
}
