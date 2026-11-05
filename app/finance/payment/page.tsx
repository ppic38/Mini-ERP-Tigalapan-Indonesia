"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AppShell } from "@/components/shell/app-shell";
import { Tabs } from "@/components/ui/tabs";
import { KeepAliveTab } from "@/components/ui/keep-alive-tab";
import { PaymentPanel } from "@/components/finance/payment-panel";
import { PaymentMaklonPanel } from "@/components/finance/payment-maklon-panel";
import { PaymentEkspedisiPanel } from "@/components/finance/payment-ekspedisi-panel";
import { useMrpStore } from "@/lib/mrp/store";
import { countPaymentMaklonReady, countPaymentMaterialReady } from "@/lib/shell/badges";
import { countEkspedisiReadyToPay } from "@/lib/mrp/ekspedisiInvoice";

type Tab = "material" | "maklon" | "ekspedisi";

function FinancePaymentContent() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const searchParams = useSearchParams();
  const invoices = useMrpStore((s) => s.invoices);
  const vendorInvoices = useMrpStore((s) => s.vendorInvoices);
  const deliveryKolis = useMrpStore((s) => s.deliveryKolis);
  const ekspedisiRates = useMrpStore((s) => s.ekspedisiRates);
  const tabParam = searchParams.get("tab");
  const [tab, setTab] = useState<Tab>(tabParam === "maklon" ? "maklon" : tabParam === "ekspedisi" ? "ekspedisi" : "material");

  if (!mounted) return null;

  const materialBadge = countPaymentMaterialReady(invoices);
  const maklonBadge = countPaymentMaklonReady(vendorInvoices);
  const ekspedisiBadge = countEkspedisiReadyToPay(deliveryKolis, ekspedisiRates);

  return (
    <AppShell role="finance" activeHref="/finance/payment" breadcrumb={["Dashboard", "Payment"]} title="Payment">
      <Tabs
        items={[
          { key: "material", label: "Payment Material", badge: materialBadge },
          { key: "maklon", label: "Payment Maklon", badge: maklonBadge },
          { key: "ekspedisi", label: "Payment Ekspedisi", badge: ekspedisiBadge },
        ]}
        active={tab}
        onChange={(k) => setTab(k as Tab)}
      />
      <KeepAliveTab active={tab === "material"}><PaymentPanel /></KeepAliveTab>
      <KeepAliveTab active={tab === "maklon"}><PaymentMaklonPanel /></KeepAliveTab>
      <KeepAliveTab active={tab === "ekspedisi"}><PaymentEkspedisiPanel /></KeepAliveTab>
    </AppShell>
  );
}

// useSearchParams() WAJIB dibungkus <Suspense> supaya bisa di-static-export (lihat catatan sama
// di app/raw-material/page.tsx).
export default function FinancePaymentPage() {
  return (
    <Suspense fallback={null}>
      <FinancePaymentContent />
    </Suspense>
  );
}
