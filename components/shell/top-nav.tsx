"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronDown, LayoutGrid, Lock, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { NavItem } from "@/lib/shell/nav";
import { MODULES, moduleHomeHref } from "@/lib/shell/modules";
import { useInternalAuthStore } from "@/lib/internal-auth-store";
import type { InternalRole } from "@/lib/internal-auth";

/** Menu modul di bar atas (kerangka gaya Odoo, redesign paket B1-B3). Hanya tampil di layar lebar (>= lg);
 *  di layar kecil menu tetap lewat laci sidebar yang lama. Isi menu = `nav.ts` yang sama dengan sidebar,
 *  badge = angka yang sama (`badgeOverrides`), jadi tidak ada sumber data baru. */
export function TopNavMenu({
  moduleLabel,
  moduleRole,
  items,
  activeHref,
  badgeOverrides,
}: {
  moduleLabel: string;
  moduleRole: InternalRole;
  items: NavItem[];
  activeHref?: string;
  badgeOverrides?: Record<string, number>;
}) {
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const current = MODULES.find((m) => m.role === moduleRole);
  // Menu yang tidak muat di lebar layar pindah ke tombol "Lainnya". Caranya: deretan menu dibiarkan turun baris
  // di dalam kotak setinggi satu baris (yang turun jadi tidak terlihat), lalu yang turun baris itu dihitung.
  const navRef = useRef<HTMLElement>(null);
  const [hiddenCount, setHiddenCount] = useState(0);
  const [moreOpen, setMoreOpen] = useState(false);
  useEffect(() => {
    const el = navRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const kids = Array.from(el.children) as HTMLElement[];
      const top = kids[0]?.offsetTop ?? 0;
      setHiddenCount(kids.filter((k) => k.offsetTop > top).length);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [items.length]);
  const badgeOf = (item: NavItem) => (item.href ? badgeOverrides?.[item.href] : undefined) ?? item.badge ?? 0;
  const hiddenItems = hiddenCount > 0 ? items.slice(items.length - hiddenCount) : [];
  const hiddenActive = hiddenItems.some((i) => !!i.href && i.href === activeHref);
  const hiddenBadge = hiddenItems.reduce((sum, i) => sum + badgeOf(i), 0);

  return (
    <div className="hidden min-w-0 flex-1 items-center gap-1 self-stretch lg:flex">
      <button
        type="button"
        onClick={() => setSwitcherOpen(true)}
        aria-label="Pindah modul"
        title="Pindah modul"
        className="-ml-2 flex h-9 w-9 flex-none items-center justify-center rounded-md text-text-muted hover:bg-[#F1F4F8] hover:text-text-primary"
      >
        <LayoutGrid size={19} strokeWidth={2} />
      </button>
      <span className="mr-2 flex flex-none items-center gap-2 font-heading text-[14px] font-bold tracking-tight text-text-primary">
        {current && (
          <span className="flex h-6 w-6 items-center justify-center rounded-md" style={{ background: current.color }}>
            <current.icon size={14} strokeWidth={2} className="text-white" />
          </span>
        )}
        {moduleLabel}
      </span>
      <nav ref={navRef} aria-label={"Menu " + moduleLabel} className="flex h-[52px] min-w-0 flex-1 flex-wrap items-stretch overflow-hidden">
        {items.map((item) => {
          const active = !!item.href && item.href === activeHref;
          const badge = badgeOf(item);
          const cls = cn(
            "relative flex h-[52px] flex-none items-center gap-1.5 whitespace-nowrap px-2.5 font-sans text-[12.5px]",
            active ? "font-semibold text-action-primary" : "font-medium text-[#4B5B6B] hover:text-text-primary",
            !item.href && "cursor-default opacity-50"
          );
          const inner = (
            <>
              {item.label}
              {!!badge && badge > 0 && (
                <span className="rounded-full bg-danger px-[5px] py-px font-mono text-[9px] font-semibold leading-[1.4] text-white">{badge > 99 ? "99+" : badge}</span>
              )}
              {active && <span className="absolute inset-x-2 bottom-0 h-[2.5px] rounded-t bg-action-primary" />}
            </>
          );
          return item.href ? (
            <Link key={item.label} href={item.href} className={cls} aria-current={active ? "page" : undefined}>
              {inner}
            </Link>
          ) : (
            <span key={item.label} className={cls}>
              {inner}
            </span>
          );
        })}
      </nav>
      {hiddenCount > 0 && (
        <div className="relative flex-none">
          <button
            type="button"
            onClick={() => setMoreOpen((v) => !v)}
            aria-expanded={moreOpen}
            className={cn(
              "flex h-9 items-center gap-1 rounded-md px-2.5 font-sans text-[12.5px] hover:bg-[#F1F4F8]",
              hiddenActive ? "font-semibold text-action-primary" : "font-medium text-[#4B5B6B]"
            )}
          >
            Lainnya
            {hiddenBadge > 0 && <span className="rounded-full bg-danger px-[5px] py-px font-mono text-[9px] font-semibold leading-[1.4] text-white">{hiddenBadge > 99 ? "99+" : hiddenBadge}</span>}
            <ChevronDown size={13} />
          </button>
          {moreOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setMoreOpen(false)} aria-hidden />
              <div className="absolute right-0 top-[calc(100%+6px)] z-50 min-w-[200px] overflow-hidden rounded-lg border border-border-subtle bg-white py-1 shadow-lg">
                {hiddenItems.map((item) => {
                  const active = !!item.href && item.href === activeHref;
                  const badge = badgeOf(item);
                  const cls = cn("flex items-center gap-2 px-3.5 py-2 font-sans text-[12.5px] hover:bg-[#F7F9FB]", active ? "font-semibold text-action-primary" : "font-medium text-text-primary");
                  const inner = (
                    <>
                      <span className="flex-1">{item.label}</span>
                      {badge > 0 && <span className="rounded-full bg-danger px-[5px] py-px font-mono text-[9px] font-semibold leading-[1.4] text-white">{badge > 99 ? "99+" : badge}</span>}
                    </>
                  );
                  return item.href ? (
                    <Link key={item.label} href={item.href} className={cls} onClick={() => setMoreOpen(false)}>
                      {inner}
                    </Link>
                  ) : (
                    <span key={item.label} className={cn(cls, "opacity-50")}>
                      {inner}
                    </span>
                  );
                })}
              </div>
            </>
          )}
        </div>
      )}
      {switcherOpen && <ModuleSwitcher currentRole={moduleRole} onClose={() => setSwitcherOpen(false)} />}
    </div>
  );
}

/** Lapisan pindah modul. Modul yang sesinya masih terbuka di browser ini langsung dibuka; yang belum
 *  diarahkan ke halaman utama dengan form password modul itu terbuka (`/?modul=...`). Tidak ada logika
 *  login di sini: pemeriksaan akses tetap di proxy.ts dan cookie sesi. */
function ModuleSwitcher({ currentRole, onClose }: { currentRole: InternalRole; onClose: () => void }) {
  const router = useRouter();
  const unlockedRoles = useInternalAuthStore((s) => s.unlockedRoles);
  const setActiveIdentity = useInternalAuthStore((s) => s.setActiveIdentity);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  function open(role: InternalRole) {
    onClose();
    if (unlockedRoles.includes(role)) {
      setActiveIdentity(role);
      router.push(moduleHomeHref(role));
    } else {
      router.push("/?modul=" + role);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Pindah modul"
      className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto px-4 py-16"
      style={{ background: "linear-gradient(160deg, rgba(0,0,0,.94) 0%, rgba(5,9,18,.95) 35%, rgba(10,27,61,.96) 70%, rgba(37,99,235,.92) 100%)" }}
      onClick={onClose}
    >
      <button type="button" onClick={onClose} aria-label="Tutup" className="absolute right-5 top-4 flex h-9 w-9 items-center justify-center rounded-md text-white/70 hover:bg-white/10 hover:text-white">
        <X size={20} />
      </button>
      <div className="w-full max-w-[620px]" onClick={(e) => e.stopPropagation()}>
        <div className="mb-6 text-center font-heading text-[20px] font-bold text-white">Pindah Modul</div>
        <div className="grid grid-cols-3 gap-x-3 gap-y-5 sm:grid-cols-4">
          {MODULES.map((m) => {
            const unlocked = unlockedRoles.includes(m.role);
            return (
              <button
                key={m.role}
                type="button"
                onClick={() => open(m.role)}
                className={cn("group flex flex-col items-center gap-2 rounded-xl px-2 py-3 font-sans hover:bg-white/10", m.role === currentRole && "bg-white/10")}
              >
                <span
                  className="relative flex h-[60px] w-[60px] items-center justify-center rounded-2xl shadow-[0_8px_20px_rgba(0,0,0,.35)] transition-transform duration-150 group-hover:-translate-y-0.5"
                  style={{ background: m.color }}
                >
                  <m.icon size={28} strokeWidth={1.75} className="text-white" />
                  {!unlocked && (
                    <span className="absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-[#0B1220] text-white/80 ring-1 ring-white/25">
                      <Lock size={10} />
                    </span>
                  )}
                </span>
                <span className="text-center text-[12.5px] font-semibold leading-tight text-white">{m.label}</span>
              </button>
            );
          })}
        </div>
        <div className="mt-7 text-center font-sans text-[11.5px] text-white/55">Modul bergembok meminta password dulu.</div>
      </div>
    </div>
  );
}
