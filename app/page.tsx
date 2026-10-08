"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ClipboardList, Package, Wallet, Building2, Lock, X, ShieldCheck, Factory, Eye, EyeOff, Warehouse, Crown, ShieldAlert, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { useInternalAuthStore } from "@/lib/internal-auth-store";
import { INTERNAL_ACCOUNTS, type InternalRole } from "@/lib/internal-auth";
import { useVendorAuthStore } from "@/lib/mrp/vendor-auth-store";
import { internalRoleRequiresUsernameAction } from "@/lib/auth/actions";
import { VendorLoginForm } from "@/components/mrp/vendor-login-form";

// Urutan kartu (owner 2026-09-27): ppic, procurement, finance, produksi, warehouse, scm, general
// manager, sysadmin, lalu Vendor Produksi (kartu terpisah, selalu paling akhir -- lihat di bawah).
// Revisi 2026-10-06 (owner: deskripsi kartu dipersingkat, kartu dibuat berwarna beranimasi): `color` =
// warna aksen tiap kartu (dipakai lewat CSS variable --c di .mod-card, app/globals.css).
const MODULES: { role: InternalRole; label: string; desc: string; icon: typeof ClipboardList; color: string }[] = [
  { role: "ppic", label: "PPIC", desc: "Planning & MRP", icon: ClipboardList, color: "#3B82F6" },
  { role: "procurement", label: "Procurement", desc: "PO & invoice", icon: Package, color: "#F59E0B" },
  { role: "finance", label: "Finance", desc: "Approval & bayar", icon: Wallet, color: "#10B981" },
  { role: "produksi", label: "Produksi", desc: "Monitoring vendor", icon: Factory, color: "#06B6D4" },
  { role: "warehouse", label: "Warehouse", desc: "Penerimaan koli", icon: Warehouse, color: "#EC4899" },
  { role: "scm", label: "SCM", desc: "Approval MRP & PO", icon: ShieldCheck, color: "#6366F1" },
  { role: "gm", label: "General Manager", desc: "Approval PO L4", icon: Crown, color: "#EAB308" },
  { role: "sysadmin", label: "Sysadmin", desc: "Akun & koreksi", icon: ShieldAlert, color: "#8B5CF6" },
];

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
  const logoutVendor = useVendorAuthStore((s) => s.logout);
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

  // Login Vendor Produksi (revisi 2026-10-08, owner: "kartu Vendor Produksi langsung jadi modul login besar sesuai
  // ukuran container, menghapus modul-modul lain, halamannya tetap sama"): kartu kecil MEMBESAR menjadi form login
  // seukuran panel "Pilih Modul" sementara kartu modul lain memudar. Panel tidak berubah ukuran -- lapisan login
  // (absolute) tumbuh dari posisi/ukuran kartu ke seluruh panel (teknik FLIP: ukur kartu -> animasikan ke inset 0).
  // closed -> opening (lapisan di posisi kartu) -> open (lapisan memenuhi panel) -> closing (menyusut kembali).
  const [vendorStage, setVendorStage] = useState<"closed" | "opening" | "open" | "closing">("closed");
  const [vendorRect, setVendorRect] = useState<{ top: number; left: number; width: number; height: number } | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const vendorBtnRef = useRef<HTMLButtonElement>(null);

  function measureVendorCard() {
    const panel = panelRef.current;
    const btn = vendorBtnRef.current;
    if (!panel || !btn) return null;
    const p = panel.getBoundingClientRect();
    const b = btn.getBoundingClientRect();
    return { top: b.top - p.top - panel.clientTop, left: b.left - p.left - panel.clientLeft, width: b.width, height: b.height };
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

  if (!mounted) return null;
  const vendorFaded = vendorStage === "opening" || vendorStage === "open";
  const vendorExpanded = vendorStage === "open";

  function pickRole(role: InternalRole) {
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

        <div ref={panelRef} className="relative rounded-2xl border border-white/10 bg-white/[0.06] p-5 shadow-[0_20px_60px_rgba(0,0,0,.35)] backdrop-blur-md sm:p-6">
          <div className={cn("mb-4 transition-opacity duration-200", vendorFaded && "opacity-0")}>
            <div className="font-heading text-[20px] font-bold text-white">Pilih Modul</div>
            <div className="mt-0.5 font-sans text-[12px] text-white/65">Pilih modul yang ingin Anda akses.</div>
          </div>

      {/* Kartu SELALU punya tinggi tetap (tidak pernah berubah bentuk saat diklik) — form
         password ditampilkan di modal terpisah (lihat di bawah), bukan ditempel di dalam kartu. */}
      <div className="grid w-full grid-cols-1 gap-2.5 sm:grid-cols-2">
        {MODULES.map((m) => {
          const Icon = m.icon;
          const active = selectedRole === m.role;
          // Sysadmin ditandai khusus (ungu, bukan biru seperti modul lain) -- pola sama dengan
          // kartu Vendor Produksi (ikon di kotak warna solid saat hover/aktif) supaya keduanya
          // sama-sama "menonjol beda" dari modul kerja biasa, tapi tidak memakai warna yang sama
          // (oranye = Vendor Produksi, ungu = Sysadmin).
          const isSysadmin = m.role === "sysadmin";
          return (
            <button
              key={m.role}
              onClick={() => pickRole(m.role)}
              className={cn(
                "group flex items-center gap-3 rounded-xl border bg-surface-card p-3 text-left font-sans shadow-[0_8px_22px_rgba(0,0,0,.22)] transition-all duration-200",
                vendorFaded && "pointer-events-none scale-95 opacity-0",
                active
                  ? isSysadmin
                    ? "border-accent-purple shadow-[0_12px_28px_rgba(124,58,237,.32)]"
                    : "border-accent-blue shadow-[0_12px_28px_rgba(37,99,235,.32)]"
                  : "border-white/10 hover:-translate-y-0.5 hover:border-white/25 hover:shadow-[0_12px_28px_rgba(0,0,0,.32)]"
              )}
            >
              <span
                className={cn(
                  "flex h-11 w-11 flex-none items-center justify-center rounded-lg transition-colors duration-200",
                  isSysadmin ? (active ? "bg-accent-purple" : "bg-accent-purple-bg group-hover:bg-accent-purple") : active ? "bg-accent-blue" : "bg-info-bg group-hover:bg-accent-blue"
                )}
              >
                <Icon
                  size={22}
                  strokeWidth={1.75}
                  className={cn(
                    "transition-colors duration-200",
                    isSysadmin ? (active ? "text-white" : "text-accent-purple group-hover:text-white") : active ? "text-white" : "text-action-primary group-hover:text-white"
                  )}
                />
              </span>
              <span className="min-w-0">
                <span className="block text-[13px] font-semibold text-text-primary">{m.label}</span>
                <span className="mt-0.5 line-clamp-2 block text-[10.5px] leading-[1.35] text-text-muted">{m.desc}</span>
              </span>
            </button>
          );
        })}

        <button
          ref={vendorBtnRef}
          onClick={openVendorLogin}
          className={cn(
            "group flex items-center gap-3 rounded-xl border border-white/10 bg-surface-card p-3 text-left font-sans shadow-[0_8px_22px_rgba(0,0,0,.22)] transition-all duration-200 hover:-translate-y-0.5 hover:border-white/25 hover:shadow-[0_12px_28px_rgba(0,0,0,.32)] sm:col-span-2",
            vendorStage !== "closed" && "invisible"
          )}
        >
          <span className="flex h-11 w-11 flex-none items-center justify-center rounded-lg bg-accent-orange-bg transition-colors duration-200 group-hover:bg-accent-orange">
            <Building2 size={22} strokeWidth={1.75} className="text-accent-orange transition-colors duration-200 group-hover:text-white" />
          </span>
          <span className="min-w-0">
            <span className="block text-[13px] font-semibold text-text-primary">Vendor Produksi</span>
            <span className="mt-0.5 block text-[10.5px] leading-[1.35] text-text-muted">Portal vendor</span>
          </span>
        </button>
      </div>

          {vendorStage !== "closed" && (
            <div
              className={cn(
                "absolute z-20 overflow-hidden bg-surface-card shadow-[0_16px_40px_rgba(0,0,0,.35)] transition-[top,left,width,height,border-radius] duration-[380ms] ease-[cubic-bezier(.4,0,.2,1)] motion-reduce:transition-none",
                vendorExpanded ? "rounded-2xl" : "rounded-xl"
              )}
              style={vendorExpanded ? { top: 0, left: 0, width: "100%", height: "100%" } : (vendorRect ?? undefined)}
            >
              {/* Wajah kartu (ikon + teks) -- memudar saat lapisan membesar, supaya terasa kartu itu yang berubah jadi form. */}
              <div className={cn("absolute inset-0 flex items-center gap-3 p-3 transition-opacity duration-150", vendorExpanded ? "opacity-0" : "opacity-100")}>
                <span className="flex h-11 w-11 flex-none items-center justify-center rounded-lg bg-accent-orange-bg">
                  <Building2 size={22} strokeWidth={1.75} className="text-accent-orange" />
                </span>
                <span className="min-w-0 font-sans">
                  <span className="block text-[13px] font-semibold text-text-primary">Vendor Produksi</span>
                  <span className="mt-0.5 block text-[10.5px] leading-[1.35] text-text-muted">Portal vendor</span>
                </span>
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
                    className="absolute left-4 top-3.5 z-10 flex items-center gap-1.5 font-sans text-[11.5px] font-medium text-text-muted hover:text-text-primary"
                  >
                    <ArrowLeft size={13} />
                    Kembali
                  </button>
                  <div className="mx-auto flex min-h-full w-full max-w-[340px] flex-col justify-center px-6 py-14">
                    <span className="flex h-[64px] w-[64px] items-center justify-center rounded-lg bg-accent-orange-bg">
                      <Building2 size={28} strokeWidth={1.75} className="text-accent-orange" />
                    </span>
                    <div className="mt-4 font-heading text-xl font-bold text-text-primary">Login Vendor Produksi</div>
                    <div className="mt-1.5 font-sans text-xs text-text-muted">Masukkan nama vendor atau username Anda, beserta password.</div>
                    <div className="mt-5">
                      <VendorLoginForm onSuccess={() => router.push("/vendor-maklon/po-produksi")} />
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
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
