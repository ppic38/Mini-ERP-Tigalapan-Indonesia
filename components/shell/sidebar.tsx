"use client";

import { createElement, useState } from "react";
import Link from "next/link";
import {
  ChevronDown,
  ChevronRight,
  LayoutGrid,
  ClipboardList,
  Package,
  Wallet,
  ShieldCheck,
  Building2,
  CheckCircle2,
  Send,
  Truck,
  FileText,
  Users,
  Settings,
  Boxes,
  Receipt,
  Lock,
  Database,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { NavGroup, NavItem } from "@/lib/shell/nav";

function iconForLabel(label: string): LucideIcon {
  const l = label.toLowerCase();
  if (l.includes("dashboard") || l.includes("overview")) return LayoutGrid;
  if (l.includes("mrp") || l.includes("planning")) return ClipboardList;
  if (l.includes("purchase order") || l.includes("po ") || l === "po" || l.includes("po produksi") || l.includes("po material")) return Package;
  if (l.includes("payment") || l.includes("ledger")) return Wallet;
  if (l.includes("master data")) return Database;
  if (l.includes("approval") || l.includes("master panel") || l.includes("sla")) return ShieldCheck;
  if (l.includes("vendor") || l.includes("entities")) return Building2;
  if (l.includes("receive") || l.includes("monitoring")) return CheckCircle2;
  if (l.includes("pengiriman") || l.includes("delivery")) return Truck;
  if (l.includes("invoice") || l.includes("laporan")) return Receipt;
  if (l.includes("material") || l.includes("raw material")) return Boxes;
  if (l.includes("users")) return Users;
  if (l.includes("settings") || l.includes("logs")) return Settings;
  if (l.includes("produksi") || l.includes("dokumen")) return FileText;
  return Send;
}

/** Badge satu menu: override real-time dari store kalau ada, kalau tidak badge statis NavItem. */
function badgeFor(item: NavItem, badgeOverrides?: Record<string, number>): number | undefined {
  return (item.href ? badgeOverrides?.[item.href] : undefined) ?? item.badge;
}

const OPEN_GROUPS_KEY = "sidebar-open-groups-v1";

function readOpenGroups(): string[] {
  try {
    const raw = window.localStorage.getItem(OPEN_GROUPS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((k): k is string => typeof k === "string") : [];
  } catch {
    return [];
  }
}

function SidebarItem({ item, activeHref, badgeOverrides, nested }: { item: NavItem; activeHref?: string; badgeOverrides?: Record<string, number>; nested?: boolean }) {
  const active = !!item.href && item.href === activeHref;
  const badge = badgeFor(item, badgeOverrides);
  const className = cn(
    "flex items-center gap-2.5 rounded-[8px] py-2 font-sans text-[12.5px]",
    nested ? "px-3 pl-4" : "px-3",
    active ? "bg-accent-blue font-semibold text-white" : "font-medium text-[#9AA4BE] hover:text-white",
    !item.href && "cursor-default opacity-60"
  );
  const content = (
    <>
      {createElement(iconForLabel(item.label), { size: 15, strokeWidth: 2, className: "flex-shrink-0 opacity-90" })}
      <span className="flex-1">{item.label}</span>
      {!!badge && badge > 0 && (
        <span className="flex-shrink-0 rounded-full bg-danger px-[5px] py-px font-mono text-[9px] font-semibold text-white">{badge}</span>
      )}
      {!item.href && <Lock size={12} className="flex-shrink-0 opacity-50" />}
    </>
  );
  if (!item.href) {
    return <div className={className}>{content}</div>;
  }
  return (
    <Link href={item.href} className={className}>
      {content}
    </Link>
  );
}

export function Sidebar({
  items,
  groups,
  activeGroupKey,
  activeHref,
  badgeOverrides,
}: {
  items: NavItem[];
  /** Mode Sysadmin (owner 2026-09-29): sidebar BERTUMPUK -- tiap modul jadi grup yang bisa
   *  dibuka/ditutup. Kalau diisi, `items` diabaikan. */
  groups?: NavGroup[];
  /** Grup yang dibuka otomatis kalau `activeHref` tidak cocok dengan menu mana pun (halaman
   *  bersarang) -- biasanya modul pemilik halaman yang sedang dibuka. */
  activeGroupKey?: string;
  activeHref?: string;
  /** Badge count real-time dihitung dari store (href → jumlah item pending), override
   *  `NavItem.badge` statis kalau ada nilainya untuk href tsb. */
  badgeOverrides?: Record<string, number>;
}) {
  // Grup yang memuat halaman aktif SELALU terbuka (dipaksa, bukan cuma default) supaya menu yang
  // sedang dipakai tidak pernah tersembunyi; grup lain mengikuti pilihan terakhir user (localStorage,
  // best-effort -- AppShell baru merender Sidebar setelah mount di client, jadi aman dibaca di sini).
  const activeGroup = groups?.find((g) => (activeHref ? g.items.some((i) => i.href === activeHref) : false))?.key ?? activeGroupKey;
  const [openKeys, setOpenKeys] = useState<string[]>(() => (groups ? readOpenGroups() : []));
  const isOpen = (key: string) => key === activeGroup || openKeys.includes(key);
  function toggleGroup(key: string) {
    if (key === activeGroup) return;
    setOpenKeys((prev) => {
      const next = prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key];
      try {
        window.localStorage.setItem(OPEN_GROUPS_KEY, JSON.stringify(next));
      } catch {
        // localStorage bisa tidak tersedia -- state tetap jalan untuk sesi halaman ini.
      }
      return next;
    });
  }

  return (
    <div className="flex w-[212px] flex-none flex-col bg-surface-nav">
      <div className="flex h-[52px] items-center gap-[9px] border-b border-white/8 px-4">
        <span className="font-heading text-[13px] font-bold leading-tight tracking-tight text-white">Tigalapan Indonesia</span>
      </div>
      <div className="flex flex-col gap-0.5 p-2.5">
        {groups
          ? groups.map((group) => {
              const open = isOpen(group.key);
              const groupBadge = group.items.reduce((sum, i) => sum + (badgeFor(i, badgeOverrides) ?? 0), 0);
              const locked = group.key === activeGroup;
              return (
                <div key={group.key} className="flex flex-col gap-0.5">
                  <button
                    type="button"
                    onClick={() => toggleGroup(group.key)}
                    aria-expanded={open}
                    className={cn(
                      "flex items-center gap-1.5 rounded-[8px] px-2 py-2 text-left font-sans text-[11px] font-semibold uppercase tracking-wider",
                      locked ? "cursor-default text-white" : "text-[#7C89A6] hover:text-white"
                    )}
                  >
                    {open ? <ChevronDown size={13} className="flex-shrink-0" /> : <ChevronRight size={13} className="flex-shrink-0" />}
                    <span className="flex-1">{group.label}</span>
                    {!open && groupBadge > 0 && (
                      <span className="flex-shrink-0 rounded-full bg-danger px-[5px] py-px font-mono text-[9px] font-semibold normal-case tracking-normal text-white">{groupBadge}</span>
                    )}
                  </button>
                  {open && group.items.map((item) => <SidebarItem key={item.label} item={item} activeHref={activeHref} badgeOverrides={badgeOverrides} nested />)}
                </div>
              );
            })
          : items.map((item) => <SidebarItem key={item.label} item={item} activeHref={activeHref} badgeOverrides={badgeOverrides} />)}
      </div>
      <div className="mt-auto border-t border-white/8 px-4 py-3.5 font-mono text-[10.5px] text-[#5E7288]">
        v1.0 · Tigalapan Indonesia
      </div>
    </div>
  );
}
