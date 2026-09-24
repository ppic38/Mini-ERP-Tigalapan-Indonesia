"use client";

import { useEffect, useState } from "react";
import { AppShell } from "@/components/shell/app-shell";
import { Tabs } from "@/components/ui/tabs";
import { KeepAliveTab } from "@/components/ui/keep-alive-tab";
import { ItemSellingPricePanel } from "@/components/mrp/item-selling-price-panel";
import { WarnaAliasPanel } from "@/components/mrp/warna-alias-panel";

// Revisi 2026-09-24 (owner: nama warna di MRP beda dari Master Data SKU -- "BENHUR SPECIAL 24S"
// vs "BENHUR 24S" dst., bikin pencocokan SKU di WMS gagal): tab kedua "Mapping Warna" (owner:
// "ganti jadi mapping warna dulu, jangan alias warna" -- ini nama TAMPILAN, kode/tipe internal
// tetap "WarnaAlias") ditambahkan di sini (SATU halaman dengan SKU, sama-sama milik PPIC) --
// lihat WarnaAliasPanel & catatan lengkap di lib/mrp/masterData.ts (WarnaAliasRow) dan migration
// 0051_warna_aliases.sql.
type Tab = "sku" | "warnaAlias";

export default function PpicMasterDataPage() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const [tab, setTab] = useState<Tab>("sku");

  if (!mounted) return null;

  return (
    <AppShell role="ppic" activeHref="/mrp/ppic/master-data" breadcrumb={["Dashboard", "Master Data"]} title="Master Data">
      <Tabs
        items={[
          { key: "sku", label: "SKU (Harga Jual per Item)" },
          { key: "warnaAlias", label: "Mapping Warna" },
        ]}
        active={tab}
        onChange={(k) => setTab(k as Tab)}
      />
      <KeepAliveTab active={tab === "sku"}><ItemSellingPricePanel /></KeepAliveTab>
      <KeepAliveTab active={tab === "warnaAlias"}><WarnaAliasPanel /></KeepAliveTab>
    </AppShell>
  );
}
