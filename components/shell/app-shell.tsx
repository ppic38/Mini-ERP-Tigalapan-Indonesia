"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Sidebar } from "@/components/shell/sidebar";
import { Topbar } from "@/components/shell/topbar";
import { NAV, PROFILE_HREF, SYSADMIN_GROUP_ORDER, sysadminNavGroups } from "@/lib/shell/nav";
import { SysadminVendorSwitcher } from "@/components/sysadmin/vendor-switcher";
import { useMrpStore } from "@/lib/mrp/store";
import { isSysadminActive, useInternalAuthStore } from "@/lib/internal-auth-store";
import { useVendorAuthStore } from "@/lib/mrp/vendor-auth-store";
import { vendorHasPageAccess } from "@/lib/mrp/vendorPages";
import { seenPoKey, useSeenPoIds } from "@/lib/shell/seen-po";
import type { InternalRole } from "@/lib/internal-auth";
import {
  GOOGLE_SHEET_URLS,
  fetchGoogleSheetCsv,
  mapEntitasRows,
  mapHargaKainPksRows,
  mapHargaKainRows,
  mapHargaMaklonRows,
  parseCsvRows,
} from "@/lib/mrp/importGoogleSheet";
import {
  countMaterialClaimsUnresolved,
  countMaterialInvoicesReadyForDelivery,
  countMaterialPOsAwaitingInvoice,
  countMrpAwaitingScmApproval,
  countMrpWithoutPO,
  countPoPendingForRole,
  countPoRejected,
  countPaymentTotal,
  countPoApprovalTotal,
  countProductionYieldUnresolved,
  countVendorGoodReceiveEligible,
  countVendorInvoicePaymentUpdates,
  countVendorInvoicesAwaitingReview,
  countVendorPengirimanReady,
  countVendorProduksiActionable,
  countWarehousePendingReceipt,
} from "@/lib/shell/badges";

const GATED_ROLES: InternalRole[] = ["ppic", "procurement", "finance", "scm", "gm", "produksi", "warehouse", "sysadmin"];

export function AppShell({
  role,
  activeHref,
  breadcrumb,
  title,
  subtitle,
  actions,
  children,
  notifCount,
  roleOverride,
  entityOverride,
  vendorId,
}: {
  role: keyof typeof NAV;
  activeHref?: string;
  breadcrumb: string[];
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
  notifCount?: number;
  roleOverride?: string;
  entityOverride?: string;
  vendorId?: string;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  // Revisi 2026-09-07: `hydrated` sudah lama ada di store (di-set true begitu getFlowSnapshot()
  // pertama SUKSES lewat StoreHydrator) tapi TIDAK PERNAH dibaca di mana pun -- akibatnya tiap
  // halaman langsung render dengan array store yang masih KOSONG selama snapshot awal masih
  // di-fetch (`mounted` cuma menandai React sudah hydrate di client, BUKAN datanya sudah
  // sampai). Beberapa halaman (mis. Purchase Order -> panel "Material") punya warning "belum ada
  // X" yang dihitung dari array itu -- selama window ini warning itu SELALU salah muncul (bukan
  // benar-benar kosong, cuma belum sempat ke-load), baru hilang begitu snapshot beneran selesai.
  // Fix-nya di SINI (bukan per halaman) supaya berlaku otomatis untuk SEMUA halaman yang pakai
  // AppShell -- children diganti indikator "Memuat data..." sampai hydrated, tanpa AppShell
  // sendiri (sidebar/topbar) ikut hilang seperti behavior lama.
  const hydrated = useMrpStore((s) => s.hydrated);

  const router = useRouter();
  const unlockedRoles = useInternalAuthStore((s) => s.unlockedRoles);
  const internalActors = useInternalAuthStore((s) => s.actors);
  const logoutInternal = useInternalAuthStore((s) => s.logout);
  const logoutVendor = useVendorAuthStore((s) => s.logout);
  const vendorActor = useVendorAuthStore((s) => s.actor);

  const isGated = GATED_ROLES.includes(role as InternalRole);
  // Revisi 2026-09-29 (owner: Sysadmin "akses ke semua modul ... sidebar bertumpuk ... tidak ingin
  // ada conflict, login sysadmin lalu masuk procurement jangan jadi sidebar procurement saja"):
  // MODE SYSADMIN = sesi ini punya Sysadmin terbuka DAN halaman yang dibuka adalah halaman modul
  // internal (isGated). Di mode ini identitas shell (sidebar bertumpuk, topbar, logout, profil)
  // SELALU milik Sysadmin, tidak peduli `role` halaman -- `role` cuma menentukan ISI halaman.
  // Revisi 2026-09-30 (owner: Sysadmin ikut melihat & mengoreksi Vendor Produksi): portal vendor
  // (vendorMaklon) SEKARANG ikut -- shell-nya juga milik Sysadmin kalau sesi ini punya Sysadmin
  // terbuka (vendor yang dilihat dipilih lewat SysadminVendorSwitcher, lihat VendorAuthGuard).
  //
  // Revisi 2026-09-30 (bug report owner: login vendor tapi tampilan jadi milik Sysadmin): mode ini HANYA
  // aktif kalau identitas aktif di browser ini Sysadmin (login terakhir -- isSysadminActive). Sesi
  // Sysadmin yang lupa di-logout tidak lagi menimpa tampilan modul/vendor yang login sesudahnya.
  const activeIdentity = useInternalAuthStore((s) => s.activeIdentity);
  const setActiveIdentity = useInternalAuthStore((s) => s.setActiveIdentity);
  const sysadminMode = (isGated || role === "vendorMaklon") && isSysadminActive(unlockedRoles, activeIdentity);
  const authorized = !isGated || sysadminMode || unlockedRoles.includes(role as InternalRole);

  useEffect(() => {
    if (mounted && isGated && !authorized) router.replace("/");
  }, [mounted, isGated, authorized, router]);

  // Membuka halaman milik Sysadmin sendiri (mis. lewat bookmark) = kembali memakai identitas Sysadmin,
  // meski login terakhir di browser ini modul/vendor lain.
  useEffect(() => {
    if (mounted && role === "sysadmin" && unlockedRoles.includes("sysadmin") && activeIdentity !== null && activeIdentity !== "sysadmin") setActiveIdentity("sysadmin");
  }, [mounted, role, unlockedRoles, activeIdentity, setActiveIdentity]);

  // Identitas shell: di mode Sysadmin selalu Sysadmin (lihat komentar sysadminMode di atas).
  const shellRole: keyof typeof NAV = sysadminMode ? "sysadmin" : role;
  const nav = NAV[shellRole];
  const allNotifications = useMrpStore((s) => s.notifications);
  const markNotificationRead = useMrpStore((s) => s.markNotificationRead);
  const markAllNotificationsRead = useMrpStore((s) => s.markAllNotificationsRead);
  const dismissNotification = useMrpStore((s) => s.dismissNotification);

  const myNotifications = allNotifications
    .filter((n) => n.audience.includes(role) && (role !== "vendorMaklon" || !n.vendorId || n.vendorId === vendorId))
    .sort((a, b) => (a.time < b.time ? 1 : -1));

  const materialPOs = useMrpStore((s) => s.materialPOs);
  const maklonPOs = useMrpStore((s) => s.maklonPOs);
  const invoices = useMrpStore((s) => s.invoices);
  const vendorInvoices = useMrpStore((s) => s.vendorInvoices);
  const maklonInvoices = useMrpStore((s) => s.maklonInvoices);
  const mrpDetails = useMrpStore((s) => s.mrpDetails);
  const staticMrps = useMrpStore((s) => s.staticMrps);
  const productionResults = useMrpStore((s) => s.productionResults);
  const productionBatches = useMrpStore((s) => s.productionBatches);
  const productionGroupMeta = useMrpStore((s) => s.productionGroupMeta);
  const deliveryKolis = useMrpStore((s) => s.deliveryKolis);
  const warehouseReceipts = useMrpStore((s) => s.warehouseReceipts);
  const ekspedisiRates = useMrpStore((s) => s.ekspedisiRates);
  const itemSellingPrices = useMrpStore((s) => s.itemSellingPrices);
  const materialClaimResolutions = useMrpStore((s) => s.materialClaimResolutions);
  const materialClaimReturRequests = useMrpStore((s) => s.materialClaimReturRequests);
  const materialClaimReturDeliveries = useMrpStore((s) => s.materialClaimReturDeliveries);
  const materialClaimReturReceipts = useMrpStore((s) => s.materialClaimReturReceipts);
  const productionYieldResolutions = useMrpStore((s) => s.productionYieldResolutions);

  // Auto-import Master Data (Harga Maklon/Kain/Kain PKS/Entitas) begitu terdeteksi kosong — SAMA
  // pola dengan `autoImportIfEmpty` di components/mrp/import-sheet-button.tsx, tapi dipasang di
  // sini (AppShell, mount di SETIAP halaman Procurement/Finance) supaya jalan otomatis walau user
  // tidak pernah buka halaman Master Data / tab-nya secara manual sama sekali — sebelumnya
  // auto-import cuma jalan kalau panel tab yang bersangkutan sempat DIRENDER (mis. tab "Harga
  // Kain" tidak pernah diklik → hargaKain tetap kosong selamanya, bikin dropdown "Vendor
  // material" di PO kosong walau user merasa "sudah pernah import").
  const hargaMaklon = useMrpStore((s) => s.hargaMaklon);
  const hargaKain = useMrpStore((s) => s.hargaKain);
  const hargaKainPks = useMrpStore((s) => s.hargaKainPks);
  const entitasList = useMrpStore((s) => s.entitasList);
  const replaceHargaMaklon = useMrpStore((s) => s.replaceHargaMaklon);
  const replaceHargaKain = useMrpStore((s) => s.replaceHargaKain);
  const replaceHargaKainPks = useMrpStore((s) => s.replaceHargaKainPks);
  const replaceEntitas = useMrpStore((s) => s.replaceEntitas);
  useEffect(() => {
    if (role !== "procurement" && role !== "finance") return;
    // Sysadmin hanya melihat & mengoreksi -- jangan ikut memicu import/tulis Master Data otomatis
    // (itu tugas user Procurement/Finance sendiri saat membuka halamannya).
    if (sysadminMode) return;
    // BUG FIX 2026-09-12 (user-reported: edit Master Data "balik lagi" ke nilai lama setelah hard
    // refresh): state awal store SEBELUM StoreHydrator selesai fetch snapshot dari Supabase
    // memang `[]` untuk hargaKain/hargaMaklon/dst (lihat lib/mrp/store.ts initialState) -- effect
    // ini dulu cuma cek `.length === 0` TANPA menunggu hydrasi selesai, jadi di jendela waktu
    // sebelum snapshot selesai (setiap mount/hard-refresh halaman Procurement/Finance), kondisi
    // "kosong" itu SELALU true sesaat, memicu replaceHargaKain/dst dari Google Sheets -- yaitu
    // DELETE SEMUA baris + insert ulang dari Sheets (masih berisi nilai lama) -- yang diam-diam
    // MENIMPA edit manual yang baru saja disimpan ke Supabase tapi belum sempat disinkronkan balik
    // ke Google Sheets. Sekarang tunggu `hydrated` dulu sebelum menilai array itu "genuinely
    // kosong" (baru boleh auto-import kalau snapshot ASLI dari Supabase memang kosong).
    if (!hydrated) return;
    if (hargaMaklon.length === 0) {
      fetchGoogleSheetCsv(GOOGLE_SHEET_URLS.hargaMaklon)
        .then((csv) => replaceHargaMaklon(mapHargaMaklonRows(parseCsvRows(csv))))
        .catch(() => {}); // gagal diam-diam — tombol Import manual di halaman Master Data tetap ada sebagai fallback
    }
    if (hargaKain.length === 0) {
      fetchGoogleSheetCsv(GOOGLE_SHEET_URLS.hargaKain)
        .then((csv) => replaceHargaKain(mapHargaKainRows(parseCsvRows(csv))))
        .catch(() => {});
    }
    if (hargaKainPks.length === 0) {
      fetchGoogleSheetCsv(GOOGLE_SHEET_URLS.hargaKainPks)
        .then((csv) => replaceHargaKainPks(mapHargaKainPksRows(parseCsvRows(csv))))
        .catch(() => {});
    }
    if (entitasList.length === 0) {
      fetchGoogleSheetCsv(GOOGLE_SHEET_URLS.entitas)
        .then((csv) => replaceEntitas(mapEntitasRows(parseCsvRows(csv))))
        .catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role, sysadminMode, hydrated, hargaMaklon.length, hargaKain.length, hargaKainPks.length, entitasList.length]);

  // Badge "PO Produksi Saya" / "PO Material Saya" = PO tujuan vendor ini yang belum pernah dilihat
  // (lib/shell/seen-po.ts). Hook dipanggil tanpa syarat (aturan hooks); nilainya cuma dipakai di
  // cabang vendorMaklon di bawah.
  const seenPoProduksi = useSeenPoIds(seenPoKey(vendorId, "po-produksi"));
  const seenPoMaterial = useSeenPoIds(seenPoKey(vendorId, "po-material"));
  const seenInvoicePayment = useSeenPoIds(seenPoKey(vendorId, "invoice-payment"));

  // Dihitung PER modul (parameter `role` di sini sengaja menimpa prop `role` di luar) supaya mode
  // Sysadmin bisa menggabungkan badge SEMUA modul untuk sidebar bertumpuknya.
  function computeBadges(role: keyof typeof NAV): Record<string, number> | undefined {
  let badgeOverrides: Record<string, number> | undefined;
  if (role === "finance") {
    badgeOverrides = {
      "/finance/po-approval": countPoApprovalTotal(materialPOs, maklonPOs),
      "/finance/payment": countPaymentTotal(invoices, vendorInvoices),
    };
  } else if (role === "procurement") {
    badgeOverrides = {
      // Revisi 2026-09-28: tab "Approval PO Saya" (Level 2) + PO ditolak sekarang di DALAM halaman
      // ini juga (bukan menu terpisah lagi) -- badge sidebar digabung jadi 1 angka.
      "/procurement/po-approval": countMrpWithoutPO(mrpDetails) + countPoPendingForRole("procurement", materialPOs, maklonPOs) + countPoRejected(materialPOs, maklonPOs),
      // "Invoice Vendor" sekarang tab kedua di halaman ini (bukan halaman terpisah lagi) —
      // badge-nya digabung ke sini juga.
      "/raw-material": countMaterialPOsAwaitingInvoice(materialPOs) + countVendorInvoicesAwaitingReview(vendorInvoices),
      "/procurement/material-tracking": countMaterialInvoicesReadyForDelivery(invoices),
      "/procurement/material-claims": countMaterialClaimsUnresolved(invoices, materialClaimResolutions),
    };
  } else if (role === "scm") {
    badgeOverrides = {
      "/scm/approval-mrp": countMrpAwaitingScmApproval(mrpDetails),
      "/scm/approval-po": countPoPendingForRole("scm", materialPOs, maklonPOs),
    };
  } else if (role === "gm") {
    badgeOverrides = {
      "/gm/approval-po": countPoPendingForRole("gm", materialPOs, maklonPOs),
    };
  } else if (role === "produksi") {
    badgeOverrides = {
      "/produksi/yield-alerts": countProductionYieldUnresolved(productionBatches, mrpDetails, productionYieldResolutions),
    };
  } else if (role === "warehouse") {
    badgeOverrides = {
      "/warehouse/penerimaan": countWarehousePendingReceipt(
        deliveryKolis,
        vendorInvoices,
        mrpDetails,
        staticMrps,
        productionBatches,
        productionResults,
        productionGroupMeta,
        invoices,
        warehouseReceipts,
        ekspedisiRates,
        itemSellingPrices
      ),
    };
  } else if (role === "vendorMaklon" && vendorId) {
    badgeOverrides = {
      // PO Produksi Saya & PO Material Saya 100% monitoring (tidak ada tombol aksi), jadi badge-nya
      // bukan "pekerjaan pending" melainkan PO baru yang belum pernah dibuka -- hilang begitu
      // halamannya dikunjungi sekali (revisi 2026-09-19, lihat lib/shell/seen-po.ts). Filter PO
      // di sini HARUS sama dengan yang ditampilkan halamannya masing-masing.
      "/vendor-maklon/po-produksi": maklonPOs.filter((p) => p.vendorProduksi === vendorId && p.approved && !seenPoProduksi.has(p.id)).length,
      "/vendor-maklon/po-material": materialPOs.filter((p) => p.vendorProduksi === vendorId && p.approved && p.status !== "CANCELLED" && !seenPoMaterial.has(p.id)).length,
      "/vendor-maklon/receiving": countVendorGoodReceiveEligible(vendorId, invoices),
      "/vendor-maklon/production": countVendorProduksiActionable(vendorId, productionBatches, productionResults, invoices, productionGroupMeta, {
        resolutions: materialClaimResolutions,
        returRequests: materialClaimReturRequests,
        returDeliveries: materialClaimReturDeliveries,
        returReceipts: materialClaimReturReceipts,
      }, maklonPOs),
      "/vendor-maklon/pengiriman": countVendorPengirimanReady(vendorId, productionResults, deliveryKolis, productionGroupMeta, maklonPOs, productionBatches),
      // Invoice & Payment 100% arsip (tidak ada aksi), jadi badge = invoice BARU terbit / BERUBAH STATUS
      // (disetujui, revisi, lunas, dst.) sejak halamannya terakhir dibuka (revisi 2026-09-20).
      "/vendor-maklon/invoice-payment": countVendorInvoicePaymentUpdates(vendorId, vendorInvoices, seenInvoicePayment),
    };
  }
  return badgeOverrides;
  }
  const badgeOverrides: Record<string, number> | undefined = sysadminMode
    ? Object.assign({}, ...SYSADMIN_GROUP_ORDER.map((r) => computeBadges(r) ?? {}))
    : computeBadges(role);

  if (!mounted || (isGated && !authorized)) return null;

  // Akun anggota tim vendor (migration 0057) -- sidebar disaring ke halaman yang diizinkan saja
  // (proteksi sesungguhnya tetap di proxy.ts; ini murni supaya menu yang ditutup tidak ditampilkan
  // sebagai link mati), dan nama topbar menyertakan nama anggota yang login.
  const sidebarItems = role === "vendorMaklon" && vendorActor ? nav.items.filter((i) => !i.href || vendorHasPageAccess(vendorActor.allowedPages, i.href)) : nav.items;
  // Akun anggota tim modul internal (migration 0060) -- tidak ada penyaringan sidebar (akses tetap
  // seutuhnya sama dengan akun utama modul itu, cuma soal atribusi "siapa PIC-nya"), topbar cukup
  // menambahkan nama orangnya.
  // shellRole (bukan role halaman): di mode Sysadmin nama/profil/logout selalu milik akun Sysadmin.
  const internalActor = internalActors[shellRole as InternalRole];
  // Di mode Sysadmin nama halaman/vendor (roleOverride/entityOverride milik halaman vendor) TIDAK
  // dipakai -- topbar selalu menampilkan identitas Sysadmin.
  const topbarRole = sysadminMode
    ? internalActor
      ? `${nav.role} · ${internalActor.name}`
      : nav.role
    : role === "vendorMaklon" && vendorActor
      ? `${roleOverride ?? nav.role} · ${vendorActor.name}`
      : internalActor
        ? `${roleOverride ?? nav.role} · ${internalActor.name}`
        : (roleOverride ?? nav.role);
  // Logout/profil milik shell internal (bukan shell vendor) -- termasuk Sysadmin yang sedang di halaman vendor.
  const internalShell = isGated || sysadminMode;

  return (
    <div className="flex min-h-screen bg-surface-page">
      <Sidebar
        items={sidebarItems}
        groups={sysadminMode ? sysadminNavGroups() : undefined}
        activeGroupKey={role}
        activeHref={activeHref}
        badgeOverrides={badgeOverrides}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar
          role={topbarRole}
          entity={sysadminMode ? nav.entity : (entityOverride ?? nav.entity)}
          notifications={myNotifications}
          onMarkRead={markNotificationRead}
          onMarkAllRead={() => markAllNotificationsRead(myNotifications.map((n) => n.id))}
          onDismiss={dismissNotification}
          // Revisi 2026-09-29 (owner: "tambahkan menu notifikasi di navbar erp untuk lihat status
          // disitu"): lonceng sekarang tampil di SEMUA modul internal (bukan cuma vendor produksi),
          // termasuk pemberitahuan koreksi dari Sysadmin. Mode Sysadmin sendiri tidak menampilkan
          // lonceng -- tidak ada notifikasi yang ditujukan ke Sysadmin (jejaknya ada di Log Audit).
          showNotifications={!sysadminMode && (role === "vendorMaklon" || isGated)}
          // Revisi 2026-09-29 (owner: "profil saya jangan begini. tapi buat halaman penuh ...
          // bukan pop up") -- navigasi ke halaman penuh per modul (PROFILE_HREF, lib/shell/nav.ts),
          // BUKAN modal lagi. Hanya ditampilkan kalau login lewat akun bernama (internalActor ada).
          onOpenProfile={internalShell && internalActor && PROFILE_HREF[shellRole as InternalRole] ? () => router.push(PROFILE_HREF[shellRole as InternalRole]!) : undefined}
          onLogout={
            internalShell
              ? () => {
                  logoutInternal(shellRole as InternalRole);
                  router.push("/");
                }
              : role === "vendorMaklon"
                ? () => {
                    logoutVendor();
                    router.push("/vendor-maklon/login");
                  }
                : undefined
          }
        />
        {/* Revisi 2026-09-30 (owner: hilangkan teks kuning, filter vendor dibuat simpel): spanduk
            "Mode Sysadmin" dihapus; di halaman portal Vendor Produksi cukup pemilih vendor saja. */}
        {sysadminMode && role === "vendorMaklon" && (
          <div className="flex items-center gap-2 border-b border-border-subtle bg-white px-[22px] py-2 font-sans text-[11.5px] text-text-muted">
            <span>Vendor:</span>
            <SysadminVendorSwitcher />
          </div>
        )}
        <div className="flex items-center gap-2 px-[22px] pt-3.5 font-sans text-xs text-[#94A3B0]">
          {breadcrumb.map((crumb, i) => (
            <span key={i} className={i === breadcrumb.length - 1 ? "font-medium text-[#31414F]" : undefined}>
              {crumb}
              {i < breadcrumb.length - 1 ? " /" : ""}
            </span>
          ))}
        </div>
        <div className="flex items-end gap-3 px-[22px] pb-0 pt-2">
          <div>
            <div className="font-heading text-[22px] font-bold tracking-tight text-text-primary">{title}</div>
            {subtitle && <div className="mt-0.5 font-sans text-xs text-text-muted">{subtitle}</div>}
          </div>
          {actions && <div className="ml-auto flex gap-2">{actions}</div>}
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-3.5 px-[22px] py-4">
          {hydrated ? (
            children
          ) : (
            <div className="flex flex-1 items-center justify-center py-20">
              <div className="flex items-center gap-2 font-sans text-[12.5px] text-text-muted">
                <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-border-subtle border-t-action-primary" />
                Memuat data…
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
