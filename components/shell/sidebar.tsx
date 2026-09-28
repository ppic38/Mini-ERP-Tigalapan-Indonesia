"use client";

import { createElement, useState } from "react";
import Link from "next/link";
import {
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
  ChevronDown,
  ChevronRight,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { NavItem } from "@/lib/shell/nav";

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

function NavLink({ item, active, badgeOverrides }: { item: NavItem; active: boolean; badgeOverrides?: Record<string, number> }) {
  // `createElement` (bukan JSX `<Icon .../>`) SENGAJA di sini -- iconForLabel MEMILIH di antara
  // komponen ikon yang sudah stabil (bukan bikin komponen baru tiap render), tapi eslint
  // (react-hooks/static-components) tidak bisa membedakan itu dari pola "component dibuat saat
  // render" kalau ditulis sebagai tag JSX biasa. createElement menghindari heuristik itu tanpa
  // mengubah perilaku sama sekali.
  const badge = (item.href && badgeOverrides?.[item.href]) ?? item.badge;
  const className = cn(
    "flex items-center gap-2.5 rounded-[8px] px-3 py-2 font-sans text-[12.5px]",
    active ? "bg-accent-blue font-semibold text-white" : "font-medium text-[#9AA4BE] hover:text-white",
    !item.href && "cursor-default opacity-60"
  );
  const content = (
    <>
      {createElement(iconForLabel(item.label), { size: 15, strokeWidth: 2, className: "flex-shrink-0 opacity-90" })}
      <span className="flex-1">{item.label}</span>
      {!!badge && badge > 0 && <span className="flex-shrink-0 rounded-full bg-danger px-[5px] py-px font-mono text-[9px] font-semibold text-white">{badge}</span>}
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

/** Revisi 2026-09-28 (owner: "terlalu banyak tampilan sidebar, buat hierarki select, di mana pilih
 *  dulu modul baru tampil list-nya") -- navigator lintas-modul Sysadmin (sysadminCombinedNavItems,
 *  30+ baris rata) dulu SELALU tampil penuh terbuka, sekarang jadi accordion: klik nama modul dulu
 *  baru daftar halamannya kebuka, cuma 1 modul terbuka dalam satu waktu. Modul yang berisi halaman
 *  yang lagi dibuka (activeHref) OTOMATIS terbuka begitu sidebar ini dimuat, supaya user tidak
 *  "kehilangan" posisinya sendiri. Nav biasa (non-sysadmin, tidak ada isSection) TIDAK terpengaruh
 *  sama sekali -- grouping di bawah cuma aktif kalau item.isSection memang ada di `items`. */
function groupBysection(items: NavItem[]): { header: NavItem | null; items: NavItem[] }[] {
  const groups: { header: NavItem | null; items: NavItem[] }[] = [];
  let current: { header: NavItem | null; items: NavItem[] } = { header: null, items: [] };
  for (const item of items) {
    if (item.isSection) {
      if (current.header || current.items.length > 0) groups.push(current);
      current = { header: item, items: [] };
    } else {
      current.items.push(item);
    }
  }
  if (current.header || current.items.length > 0) groups.push(current);
  return groups;
}

export function Sidebar({
  items,
  activeHref,
  badgeOverrides,
}: {
  items: NavItem[];
  activeHref?: string;
  /** Badge count real-time dihitung dari store (href → jumlah item pending), override
   *  `NavItem.badge` statis kalau ada nilainya untuk href tsb. */
  badgeOverrides?: Record<string, number>;
}) {
  const groups = groupBysection(items);
  const activeGroupHeader = groups.find((g) => g.items.some((i) => i.href === activeHref))?.header?.label;
  const [openSection, setOpenSection] = useState<string | null>(activeGroupHeader ?? null);

  return (
    <div className="sticky top-0 flex h-screen w-[212px] flex-none flex-col bg-surface-nav">
      <div className="flex h-[52px] flex-none items-center gap-[9px] border-b border-white/8 px-4">
        <span className="font-heading text-[13px] font-bold leading-tight tracking-tight text-white">Tigalapan Indonesia</span>
      </div>
      {/* min-h-0 WAJIB di sini -- tanpanya flex item ini tidak pernah menyusut lebih kecil dari
         konten-nya sendiri (default min-height:auto flexbox), jadi overflow-y-auto tidak pernah
         kepakai. */}
      <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto p-2.5">
        {groups.map((group, gi) => {
          if (!group.header) {
            // Tanpa header (nav biasa, non-sysadmin) -- tampil datar apa adanya, tidak accordion.
            return group.items.map((item) => <NavLink key={item.label} item={item} active={!!item.href && item.href === activeHref} badgeOverrides={badgeOverrides} />);
          }
          const open = openSection === group.header.label;
          return (
            <div key={group.header.label + gi}>
              <button
                type="button"
                onClick={() => setOpenSection(open ? null : group.header!.label)}
                className="mt-2.5 flex w-full select-none items-center gap-1 rounded-[8px] px-3 pb-1 pt-2 text-left font-sans text-[10px] font-bold uppercase tracking-wider text-[#5E7288] hover:text-[#B7C0D6] first:mt-0"
              >
                {open ? <ChevronDown size={11} className="flex-shrink-0" /> : <ChevronRight size={11} className="flex-shrink-0" />}
                <span className="flex-1">{group.header.label}</span>
                {!!group.items.some((i) => !!i.href && badgeOverrides?.[i.href]) && !open && <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-danger" />}
              </button>
              {open && (
                <div className="flex flex-col gap-0.5">
                  {group.items.map((item) => (
                    <NavLink key={item.label} item={item} active={!!item.href && item.href === activeHref} badgeOverrides={badgeOverrides} />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div className="mt-auto flex-none border-t border-white/8 px-4 py-3.5 font-mono text-[10.5px] text-[#5E7288]">
        v1.0 · Tigalapan Indonesia
      </div>
    </div>
  );
}
