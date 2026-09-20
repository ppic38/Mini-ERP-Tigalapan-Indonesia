"use client";

import { useState } from "react";
import { AppShell } from "@/components/shell/app-shell";
import { Tabs } from "@/components/ui/tabs";
import { KeepAliveTab } from "@/components/ui/keep-alive-tab";
import { VendorAuthGuard } from "@/components/mrp/vendor-auth-guard";
import { InvoiceVendorPanel } from "@/components/vendor-maklon/invoice-vendor-panel";
import { InvoiceMaklonPanel } from "@/components/vendor-maklon/invoice-maklon-panel";
import { useMrpStore } from "@/lib/mrp/store";
import { vendorInvoicePaymentTokens } from "@/lib/shell/badges";
import { seenPoKey, useMarkPoSeen } from "@/lib/shell/seen-po";
import { VENDOR_PRODUKSI } from "@/lib/mrp/seed";

function InvoicePaymentContent({ vendorId }: { vendorId: string }) {
  const vendorInvoices = useMrpStore((s) => s.vendorInvoices);
  const maklonInvoices = useMrpStore((s) => s.maklonInvoices);

  const [tab, setTab] = useState<"vendor" | "maklon">("vendor");

  // Badge menu Invoice & Payment = invoice baru / berubah status; hilang begitu halaman ini dibuka
  // (lihat lib/shell/badges.ts & lib/shell/seen-po.ts). Kalau ada perubahan saat halaman terbuka,
  // langsung ditandai terlihat juga.
  useMarkPoSeen(seenPoKey(vendorId, "invoice-payment"), vendorInvoicePaymentTokens(vendorId, vendorInvoices, maklonInvoices));

  return (
    <AppShell
      role="vendorMaklon"
      vendorId={vendorId}
      activeHref="/vendor-maklon/invoice-payment"
      breadcrumb={["Dashboard", "Invoice & Payment"]}
      title="Invoice & Payment"
      roleOverride={VENDOR_PRODUKSI[vendorId]?.name ?? vendorId}
      entityOverride="Vendor Produksi"
    >
      <Tabs
        items={[
          { key: "vendor", label: "Invoice Vendor (per pcs)" },
          { key: "maklon", label: "Invoice Maklon (Arsip)" },
        ]}
        active={tab}
        onChange={(k) => setTab(k as "vendor" | "maklon")}
      />
      <KeepAliveTab active={tab === "vendor"}><InvoiceVendorPanel vendorId={vendorId} /></KeepAliveTab>
      <KeepAliveTab active={tab === "maklon"}><InvoiceMaklonPanel vendorId={vendorId} /></KeepAliveTab>
    </AppShell>
  );
}

export default function VendorInvoicePaymentPage() {
  return <VendorAuthGuard>{(vendorId) => <InvoicePaymentContent vendorId={vendorId} />}</VendorAuthGuard>;
}
