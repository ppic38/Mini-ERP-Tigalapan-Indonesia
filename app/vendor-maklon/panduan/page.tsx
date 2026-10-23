"use client";

import { useEffect, useState } from "react";
import { MessageCircle } from "lucide-react";
import { AppShell } from "@/components/shell/app-shell";
import { VendorAuthGuard } from "@/components/mrp/vendor-auth-guard";
import { VENDOR_PRODUKSI } from "@/lib/mrp/seed";
import { GuideMedia } from "@/components/guide/guide-media";
import { VENDOR_GUIDE_SECTIONS, type GuideItem } from "@/lib/guide/sections";
import { listGuideItemsAction } from "@/lib/mrp/guideActions";

const WHATSAPP_URL = "https://wa.me/6285395257703";
const PHONE_LABEL = "0853-9525-7703";

function MediaBlock({ items }: { items: GuideItem[] }) {
  if (items.length === 0) return null;
  return (
    <div className="flex flex-col gap-4">
      {items.map((m) => (
        <GuideMedia key={m.id} item={m} />
      ))}
    </div>
  );
}

/** Nama sub-tab = judul media yang diberi Sysadmin, tanpa awalan "Tutorial Mini ERP - " (mis. "Proses Resting", "Pengajuan Claim"). */
function mediaTabLabel(m: GuideItem, index: number): string {
  const t = m.title.replace(/^Tutorial\s+Mini\s+ERP\s*[-\u2013\u2014:]\s*/i, "").trim();
  return t || `Media ${index + 1}`;
}

/** Satu media = tampil langsung. Dua media atau lebih dalam satu bagian = sub-tab, satu tab per media, supaya vendor
 *  memilih topik yang dicari (mis. Resting, Claim) tanpa menggulir semua video. */
function MediaTabs({ items }: { items: GuideItem[] }) {
  const [activeId, setActiveId] = useState<string | null>(null);
  if (items.length === 0) return null;
  if (items.length === 1) return <MediaBlock items={items} />;
  const active = items.find((m) => m.id === activeId) ?? items[0];
  return (
    <div>
      <div role="tablist" className="flex flex-wrap gap-1.5 border-b border-border-subtle">
        {items.map((m, i) => {
          const on = m.id === active.id;
          return (
            <button
              key={m.id}
              type="button"
              role="tab"
              aria-selected={on}
              onClick={() => setActiveId(m.id)}
              className={
                "-mb-px rounded-t-md border border-b-0 px-3.5 py-2 font-sans text-[12px] font-semibold " +
                (on ? "border-border-subtle bg-white text-action-primary" : "border-transparent text-text-muted hover:text-text-primary")
              }
            >
              {mediaTabLabel(m, i)}
            </button>
          );
        })}
      </div>
      <div role="tabpanel" className="pt-3">
        <GuideMedia key={active.id} item={active} />
      </div>
    </div>
  );
}

function PanduanContent({ vendorId }: { vendorId: string }) {
  // Media panduan (video/gambar/tautan) yang dikelola Sysadmin (migration 0073). Gagal memuat = halaman tetap tampil teks saja.
  const [media, setMedia] = useState<GuideItem[]>([]);
  useEffect(() => {
    void listGuideItemsAction("vendor").then((res) => {
      if (res.ok) setMedia(res.data);
    });
  }, []);
  const mediaFor = (key: string) => (VENDOR_GUIDE_SECTIONS.some((s) => s.key === key) ? media.filter((m) => m.sectionKey === key) : []);
  // Satu bagian terbuka sekali waktu, dan isinya (video) HANYA dirender selagi bagian itu terbuka: menutup bagian atau
  // membuka bagian lain membongkar iframe-nya sehingga video yang lupa dihentikan ikut berhenti (owner 2026-10-23).
  const [openKey, setOpenKey] = useState<string | null>(null);
  return (
    <AppShell
      role="vendorMaklon"
      vendorId={vendorId}
      activeHref="/vendor-maklon/panduan"
      breadcrumb={["Dashboard", "Panduan Penggunaan"]}
      title="Panduan Penggunaan"
      subtitle="Cara memakai portal Vendor Produksi, urut sesuai menu di sebelah kiri."
      roleOverride={VENDOR_PRODUKSI[vendorId]?.name ?? vendorId}
      entityOverride="Vendor Produksi"
    >
      <div className="flex flex-col gap-3">
        <a
          href={WHATSAPP_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-3 rounded-lg border border-border-subtle bg-surface-card px-4 py-3 hover:border-accent-blue"
        >
          <span className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-info-bg text-info-fg">
            <MessageCircle size={18} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block font-sans text-[13px] font-semibold text-text-primary">Ada kendala, saran, atau feedback?</span>
            <span className="block font-sans text-[11.5px] text-text-muted">Hubungi kami lewat WhatsApp di nomor {PHONE_LABEL}.</span>
          </span>
          <span className="font-mono text-[12px] font-semibold text-action-primary">{PHONE_LABEL}</span>
        </a>

        {VENDOR_GUIDE_SECTIONS.map((s) => (
          <details key={s.key} open={openKey === s.key} className="group overflow-hidden rounded-lg border border-border-subtle bg-surface-card">
            <summary
              onClick={(e) => {
                e.preventDefault();
                setOpenKey((prev) => (prev === s.key ? null : s.key));
              }}
              className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 font-sans text-[13px] font-semibold text-text-primary marker:hidden [&::-webkit-details-marker]:hidden"
            >
              <span className="flex-1">{s.title}</span>
              <span className="font-sans text-[11px] font-medium text-text-muted group-open:hidden">Buka</span>
              <span className="hidden font-sans text-[11px] font-medium text-text-muted group-open:inline">Tutup</span>
            </summary>
            {openKey === s.key && (
              <div className="border-t border-border-subtle px-4 py-3">
                {mediaFor(s.key).length === 0 ? (
                  <p className="font-sans text-[12px] text-text-muted">Panduan untuk bagian ini belum tersedia.</p>
                ) : (
                  <MediaTabs items={mediaFor(s.key)} />
                )}
              </div>
            )}
          </details>
        ))}
      </div>
    </AppShell>
  );
}

export default function VendorPanduanPage() {
  return <VendorAuthGuard>{(vendorId) => <PanduanContent vendorId={vendorId} />}</VendorAuthGuard>;
}
