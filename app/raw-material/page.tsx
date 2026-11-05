"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AppShell } from "@/components/shell/app-shell";
import { Tabs } from "@/components/ui/tabs";
import { KeepAliveTab } from "@/components/ui/keep-alive-tab";
import { PayingVoucherMaterialPanel } from "@/components/procurement/paying-voucher-material-panel";
import { InvoiceVendorReviewPanel } from "@/components/procurement/invoice-vendor-review-panel";
import { EkspedisiInvoicePanel } from "@/components/procurement/ekspedisi-invoice-panel";
import { countEkspedisiToProcess } from "@/lib/mrp/ekspedisiInvoice";
import { useMrpStore } from "@/lib/mrp/store";
import { countMaterialPOsAwaitingInvoice, countVendorInvoicesAwaitingReview } from "@/lib/shell/badges";

type Tab = "material" | "vendor" | "ekspedisi";

// Sebelumnya "Invoice Vendor" adalah halaman standalone di sidebar Procurement
// (/procurement/invoice-vendor) — dipindah ke sini jadi tab kedua supaya sidebar lebih ringkas
// (konsisten dengan pola PO Approval & Payment yang juga digabung jadi 1 halaman ber-tab).
// Route lama sudah jadi redirect ke sini dengan ?tab=vendor.
function RawMaterialContent() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const searchParams = useSearchParams();
  const tabParam = searchParams.get("tab");
  const initialTab: Tab = tabParam === "vendor" ? "vendor" : tabParam === "ekspedisi" ? "ekspedisi" : "material";
  const [tab, setTab] = useState<Tab>(initialTab);

  const materialPOs = useMrpStore((s) => s.materialPOs);
  const vendorInvoices = useMrpStore((s) => s.vendorInvoices);
  const deliveryKolis = useMrpStore((s) => s.deliveryKolis);
  const ekspedisiRates = useMrpStore((s) => s.ekspedisiRates);

  if (!mounted) return null;

  const materialBadge = countMaterialPOsAwaitingInvoice(materialPOs);
  const vendorBadge = countVendorInvoicesAwaitingReview(vendorInvoices);
  const ekspedisiBadge = countEkspedisiToProcess(deliveryKolis, ekspedisiRates);

  return (
    <AppShell role="procurement" activeHref="/raw-material" breadcrumb={["Dashboard", "Paying Voucher (Invoice)"]} title="Paying Voucher (Invoice)">
      <Tabs
        items={[
          { key: "material", label: "Invoice Material", badge: materialBadge },
          { key: "vendor", label: "Invoice Vendor", badge: vendorBadge },
          { key: "ekspedisi", label: "Invoice Ekspedisi", badge: ekspedisiBadge },
        ]}
        active={tab}
        onChange={(k) => setTab(k as Tab)}
      />
      <KeepAliveTab active={tab === "material"}><PayingVoucherMaterialPanel /></KeepAliveTab>
      <KeepAliveTab active={tab === "vendor"}><InvoiceVendorReviewPanel /></KeepAliveTab>
      <KeepAliveTab active={tab === "ekspedisi"}><EkspedisiInvoicePanel /></KeepAliveTab>
    </AppShell>
  );
}

// useSearchParams() WAJIB dibungkus <Suspense> supaya bisa di-static-export (Next.js
// mengharuskan ini sejak beberapa versi terakhir — tanpa ini `next build` gagal total dengan
// error "should be wrapped in a suspense boundary"). Halaman lain di app ini tidak kena karena
// cuma ini satu-satunya yang baca query string.
export default function RawMaterialPage() {
  return (
    <Suspense fallback={null}>
      <RawMaterialContent />
    </Suspense>
  );
}
