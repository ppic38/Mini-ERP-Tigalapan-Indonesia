"use client";

import { useEffect, useState } from "react";
import { AppShell } from "@/components/shell/app-shell";
import { Tabs } from "@/components/ui/tabs";
import { HargaMaklonPanel } from "@/components/procurement/harga-maklon-panel";
import { HargaKainPanel } from "@/components/procurement/harga-kain-panel";
import { HargaKainPksPanel } from "@/components/procurement/harga-kain-pks-panel";
import { HargaRibPanel } from "@/components/procurement/harga-rib-panel";
import { EkspedisiRatePanel } from "@/components/procurement/ekspedisi-rate-panel";
import { KerahMansetSettingsPanel } from "@/components/procurement/kerah-manset-settings-panel";
import { HargaKerahMansetPanel } from "@/components/procurement/harga-kerah-manset-panel";
import { VendorSupplierPanel } from "@/components/procurement/vendor-supplier-panel";

// Item revisi 2026-09-15 (owner: tab "Supplier" dihapus dari menu Master Data -- datanya memang
// kosong/tidak pernah dipakai, dicek langsung ke DB sebelum dihapus, lihat catatan di
// components/procurement/supplier-panel.tsx yang TETAP DIBIARKAN ADA sebagai file -- store action
// SENGAJA TIDAK disentuh, murni tab/menu-nya yang disembunyikan sesuai permintaan ("hapus tabnya
// saja"). Update 2026-09-15: merge daftar ini ke dropdown "Vendor material" SUDAH dilepas (lihat
// materialSupplierNamesForWarna di lib/mrp/derive.ts) -- isinya cuma data dummy seed.
//
// Update 2026-09-17 (owner: "buat 1 halaman di paling kanan, highlight biru, isinya daftar vendor
// produksi & vendor material/supplier, hilangkan tab Supplier Kain karena dimuat di halaman baru
// ini"): tab "Supplier Kain" (migration 0042, MaterialSupplierPanel, dulu ditambahkan 2026-09-16)
// DIHAPUS dari sini -- isinya (materialSuppliers, CRUD tambah/hapus) DIGABUNG ke tab "Vendor &
// Supplier" baru (VendorSupplierPanel) bareng daftar Vendor Produksi (read-only, dari
// vendorProduksiList). Ditaruh PALING KANAN & accent biru (lihat prop `accent` di Tabs) supaya
// gampang ditemukan sebelum isi form Harga Maklon/Kain/Kain PKS/RIB/Kerah-Manset (dropdown di
// form-form itu sekarang bersumber dari daftar di sini, bukan lagi ketik bebas -- lihat masing-
// masing panel).
type Tab = "maklon" | "kain" | "kainPks" | "rib" | "ekspedisi" | "kerahManset" | "vendorSupplier";

export default function ProcurementMasterDataPage() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const [tab, setTab] = useState<Tab>("maklon");

  if (!mounted) return null;

  return (
    <AppShell role="procurement" activeHref="/procurement/master-data" breadcrumb={["Dashboard", "Master Data"]} title="Master Data">
      <Tabs
        items={[
          { key: "maklon", label: "Harga Maklon" },
          { key: "kain", label: "Harga Kain" },
          { key: "kainPks", label: "Harga Kain PKS" },
          { key: "rib", label: "Harga RIB" },
          { key: "ekspedisi", label: "Ekspedisi" },
          { key: "kerahManset", label: "Kerah/Manset" },
          { key: "vendorSupplier", label: "Vendor & Supplier", accent: true },
        ]}
        active={tab}
        onChange={(k) => setTab(k as Tab)}
      />
      {tab === "maklon" && <HargaMaklonPanel />}
      {tab === "kain" && <HargaKainPanel />}
      {tab === "kainPks" && <HargaKainPksPanel />}
      {tab === "rib" && <HargaRibPanel />}
      {tab === "ekspedisi" && <EkspedisiRatePanel />}
      {tab === "kerahManset" && (
        <div className="flex flex-col gap-4">
          <KerahMansetSettingsPanel />
          <HargaKerahMansetPanel />
        </div>
      )}
      {tab === "vendorSupplier" && <VendorSupplierPanel />}
    </AppShell>
  );
}
