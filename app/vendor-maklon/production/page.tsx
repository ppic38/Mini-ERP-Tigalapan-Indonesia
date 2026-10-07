"use client";

import { useState } from "react";
import { PackageCheck, RotateCcw, Scissors, BadgeCheck, type LucideIcon } from "lucide-react";
import { AppShell } from "@/components/shell/app-shell";
import { KeepAliveTab } from "@/components/ui/keep-alive-tab";
import { VendorAuthGuard } from "@/components/mrp/vendor-auth-guard";
import { ProductionCuttingTab } from "@/components/mrp/production-cutting-tab";
import { ProductionResultPanel } from "@/components/mrp/production-result-panel";
import { ProductionFinalTab } from "@/components/mrp/production-final-tab";
import { useMrpStore } from "@/lib/mrp/store";
import { useVendorAuthStore } from "@/lib/mrp/vendor-auth-store";
import { vendorAllowedSubTabs } from "@/lib/mrp/vendorPages";
import { countCuttingAwaitingUpdate, countFgShortfallGroups, countProductionFinalReady, countRejectActionableGroups } from "@/lib/shell/badges";
import { VENDOR_PRODUKSI } from "@/lib/mrp/seed";

// "REJECT" = tab gabungan "Reject & Rework" (2026-10-07). Kode izin REWORK tetap ada (akun lama) -- lihat TABS di bawah.
type Tab = "CUTTING" | "FG" | "REJECT" | "FINAL";

function ProductionContent({ vendorId }: { vendorId: string }) {
  const [tab, setTab] = useState<Tab>("CUTTING");
  // Anggota tim (migration 0057, owner 2026-09-28: "bisa akses sub modul apa saja di dalam
  // Produksi") -- kalau sub-user cuma diberi sebagian tab (mis. cuma Cutting), tab lain disaring
  // dari daftar & tab aktif otomatis pindah ke yang pertama diizinkan. Akun UTAMA vendor (actor
  // null) selalu "ALL", tidak berubah dari sebelumnya.
  const actor = useVendorAuthStore((s) => s.actor);
  const allowedSub = vendorAllowedSubTabs(actor?.allowedPages ?? null, "/vendor-maklon/production");

  const productionBatches = useMrpStore((s) => s.productionBatches);
  const productionResults = useMrpStore((s) => s.productionResults);
  const productionGroupMeta = useMrpStore((s) => s.productionGroupMeta);
  const mrpDetails = useMrpStore((s) => s.mrpDetails);
  const invoices = useMrpStore((s) => s.invoices);
  const maklonPOs = useMrpStore((s) => s.maklonPOs);
  const materialClaimResolutions = useMrpStore((s) => s.materialClaimResolutions);
  const materialClaimReturRequests = useMrpStore((s) => s.materialClaimReturRequests);
  const materialClaimReturDeliveries = useMrpStore((s) => s.materialClaimReturDeliveries);
  const materialClaimReturReceipts = useMrpStore((s) => s.materialClaimReturReceipts);

  const cuttingBadge = countCuttingAwaitingUpdate(vendorId, productionBatches, invoices, {
    resolutions: materialClaimResolutions,
    returRequests: materialClaimReturRequests,
    returDeliveries: materialClaimReturDeliveries,
    returReceipts: materialClaimReturReceipts,
  }, maklonPOs);
  const fgBadge = countFgShortfallGroups(vendorId, productionBatches, productionResults, productionGroupMeta, mrpDetails);
  // Reject SENGAJA baru badge begitu Finish Good sudah mulai dilaporkan untuk grup itu — sebelum
  // ada input FG sama sekali, belum ada dasar bilang ada reject (lihat catatan di badges.ts).
  const rejectBadge = countRejectActionableGroups(vendorId, productionBatches, productionResults, productionGroupMeta, mrpDetails);
  const finalBadge = countProductionFinalReady(vendorId, productionBatches, productionResults, productionGroupMeta, mrpDetails);

  const ALL_TABS: { key: Tab; label: string; badge: number }[] = [
    { key: "CUTTING", label: "Cutting", badge: cuttingBadge },
    { key: "FG", label: "Finish Good", badge: fgBadge },
    { key: "REJECT", label: "Reject & Rework", badge: rejectBadge },
    { key: "FINAL", label: "Final Produksi", badge: finalBadge },
  ];
  // Tab gabungan tampil kalau akun punya izin REJECT ATAU REWORK; tombol rework di dalamnya hanya aktif kalau punya izin REWORK.
  const TABS = allowedSub === "ALL" ? ALL_TABS : ALL_TABS.filter((t) => (t.key === "REJECT" ? allowedSub.includes("REJECT") || allowedSub.includes("REWORK") : allowedSub.includes(t.key)));
  const canRework = allowedSub === "ALL" || allowedSub.includes("REWORK");
  // Dihitung langsung saat render (BUKAN lewat useEffect, sama pola dengan effectiveMrpId di
  // po-maklon-panel.tsx) -- begitu tab yang lagi aktif ternyata tidak lagi diizinkan (mis. actor
  // baru login & TABS berubah), otomatis "jatuh" ke tab pertama yang diizinkan.
  const effectiveTab = TABS.some((t) => t.key === tab) ? tab : (TABS[0]?.key ?? tab);
  // HP: sub-menu Produksi jadi bar ikon di bawah layar (seperti menu aplikasi) -- tab di atas disembunyikan.
  const TAB_ICON: Record<Tab, LucideIcon> = { CUTTING: Scissors, FG: PackageCheck, REJECT: RotateCcw, FINAL: BadgeCheck };

  return (
    <AppShell
      role="vendorMaklon"
      vendorId={vendorId}
      activeHref="/vendor-maklon/production"
      breadcrumb={["Dashboard", "Produksi"]}
      title="Produksi"
      roleOverride={VENDOR_PRODUKSI[vendorId]?.name ?? vendorId}
      entityOverride="Vendor Produksi"
    >
      <div className="flex gap-2 overflow-x-auto rounded-lg border border-border-subtle bg-surface-card p-1.5 max-md:hidden">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={
              "flex flex-none items-center gap-1.5 whitespace-nowrap rounded-md px-3.5 py-[7px] font-sans text-[12.5px] font-semibold " +
              (effectiveTab === t.key ? "bg-action-primary text-white" : "text-text-muted hover:bg-[#F7F9FB]")
            }
          >
            {t.label}
            {t.badge > 0 && (
              <span className="flex-shrink-0 rounded-full bg-danger px-[5px] py-px font-mono text-[9px] font-semibold text-white">{t.badge}</span>
            )}
          </button>
        ))}
      </div>

      {TABS.length === 0 && (
        <div className="rounded-lg border border-border-subtle bg-surface-card px-4 py-6 text-center font-sans text-xs text-text-muted">Anda belum diberi akses ke tab Produksi manapun.</div>
      )}
      {TABS.some((t) => t.key === "CUTTING") && <KeepAliveTab active={effectiveTab === "CUTTING"}><ProductionCuttingTab vendorId={vendorId} /></KeepAliveTab>}
      {TABS.some((t) => t.key === "FG") && <KeepAliveTab active={effectiveTab === "FG"}><ProductionResultPanel vendorId={vendorId} kind="FG" title="Finish Good" /></KeepAliveTab>}
      {TABS.some((t) => t.key === "REJECT") && <KeepAliveTab active={effectiveTab === "REJECT"}><ProductionResultPanel vendorId={vendorId} kind="REJECT" title="Reject & Rework" canRework={canRework} /></KeepAliveTab>}
      {TABS.some((t) => t.key === "FINAL") && <KeepAliveTab active={effectiveTab === "FINAL"}><ProductionFinalTab vendorId={vendorId} /></KeepAliveTab>}
      {/* Bar menu bawah (HP saja). Ruang kosong di bawah konten supaya isi terakhir tidak tertutup bar. */}
      {TABS.length > 0 && (
        <>
          <div className="h-16 md:hidden" aria-hidden />
          <nav className="fixed inset-x-0 bottom-0 z-30 flex border-t border-border-subtle bg-white pb-[env(safe-area-inset-bottom)] shadow-[0_-2px_10px_rgba(11,19,27,.08)] md:hidden" aria-label="Menu Produksi">
            {TABS.map((t) => {
              const Icon = TAB_ICON[t.key];
              const active = effectiveTab === t.key;
              return (
                <button
                  key={t.key}
                  onClick={() => setTab(t.key)}
                  aria-current={active ? "page" : undefined}
                  className={"relative flex flex-1 flex-col items-center gap-0.5 px-1 pb-2 pt-2.5 font-sans text-[10.5px] font-semibold " + (active ? "text-action-primary" : "text-text-muted")}
                >
                  {active && <span className="absolute inset-x-5 top-0 h-[3px] rounded-b-full bg-action-primary" />}
                  <span className="relative">
                    <Icon size={22} strokeWidth={active ? 2.4 : 2} />
                    {t.badge > 0 && (
                      <span className="absolute -right-3 -top-1.5 rounded-full bg-danger px-[5px] py-px font-mono text-[9px] font-semibold leading-none text-white">{t.badge}</span>
                    )}
                  </span>
                  <span className="max-w-full truncate">{t.label}</span>
                </button>
              );
            })}
          </nav>
        </>
      )}
    </AppShell>
  );
}

export default function VendorProductionPage() {
  return <VendorAuthGuard>{(vendorId) => <ProductionContent vendorId={vendorId} />}</VendorAuthGuard>;
}
