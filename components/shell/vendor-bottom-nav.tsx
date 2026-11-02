"use client";

import { createElement } from "react";
import Link from "next/link";
import { CheckCircle2, FileText, Package, Receipt, Truck, type LucideIcon } from "lucide-react";
import type { NavItem } from "@/lib/shell/nav";

const TABS: { href: string; label: string; icon: LucideIcon; alsoActive?: string[] }[] = [
  { href: "/vendor-maklon/po-produksi", label: "PO", icon: Package, alsoActive: ["/vendor-maklon/po-material"] },
  { href: "/vendor-maklon/receiving", label: "Receive", icon: CheckCircle2 },
  { href: "/vendor-maklon/production", label: "Produksi", icon: FileText },
  { href: "/vendor-maklon/pengiriman", label: "Kirim", icon: Truck },
  { href: "/vendor-maklon/invoice-payment", label: "Invoice", icon: Receipt },
];

const PO_TABS = [
  { href: "/vendor-maklon/po-produksi", label: "PO Produksi" },
  { href: "/vendor-maklon/po-material", label: "PO Material" },
];

/** Pilihan PO Produksi | PO Material di bawah judul, hanya di HP (< md) dan hanya di dua halaman PO -- tab "PO" di bar bawah
 *  membuka PO Produksi, dari sini pindah ke PO Material. Hanya tampil kalau akun boleh membuka keduanya. */
export function VendorPoSwitch({ items, activeHref }: { items: NavItem[]; activeHref?: string }) {
  const allowed = new Set(items.map((i) => i.href));
  if (!PO_TABS.some((t) => t.href === activeHref) || !PO_TABS.every((t) => allowed.has(t.href))) return null;
  return (
    <div className="vp-wrap-pill mx-4 mt-4 flex rounded-full bg-[#EFEBE6] p-1 md:hidden">
      {PO_TABS.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          className={
            "flex min-h-10 flex-1 items-center justify-center rounded-full font-sans text-[13px] font-semibold " +
            (t.href === activeHref ? "bg-white text-action-primary shadow-sm" : "text-text-muted")
          }
        >
          {t.label}
        </Link>
      ))}
    </div>
  );
}

/** Bar menu bawah portal Vendor Produksi, hanya di HP (< md). Menu lain (PO Material, Tim Saya, Panduan) tetap di laci
 *  hamburger. `items` = menu sidebar yang sudah disaring hak akses, jadi akun anggota tim hanya melihat tab yang boleh. */
export function VendorBottomNav({ items, activeHref, badgeOverrides }: { items: NavItem[]; activeHref?: string; badgeOverrides?: Record<string, number> }) {
  const allowed = new Set(items.map((i) => i.href));
  const tabs = TABS.filter((t) => allowed.has(t.href));
  if (tabs.length === 0) return null;
  return (
    <nav aria-label="Menu utama" className="fixed inset-x-0 bottom-0 z-20 border-t border-[#EDE8E2] bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
      <div className="mx-auto flex max-w-md">
        {tabs.map((t) => {
          const active = t.href === activeHref || (!!activeHref && !!t.alsoActive?.includes(activeHref));
          const badge = badgeOverrides?.[t.href] ?? 0;
          return (
            <Link
              key={t.href}
              href={t.href}
              className={
                "relative flex min-h-[62px] flex-1 flex-col items-center justify-center gap-1 font-sans text-[11px] " +
                (active ? "font-semibold text-action-primary" : "font-medium text-text-muted")
              }
            >
              <span className={"flex h-7 w-12 items-center justify-center rounded-full " + (active ? "bg-action-primary/15" : "")}>
                {createElement(t.icon, { size: 20, strokeWidth: active ? 2.3 : 1.9 })}
              </span>
              {t.label}
              {badge > 0 && (
                <span className="absolute left-1/2 top-1.5 ml-2 min-w-4 rounded-full bg-danger px-1 text-center font-mono text-[9px] font-semibold leading-4 text-white">{badge}</span>
              )}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
