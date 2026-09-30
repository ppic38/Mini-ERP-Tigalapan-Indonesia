"use client";

import { AppShell } from "@/components/shell/app-shell";
import { WeightTolerancePanel } from "@/components/scm/weight-tolerance-panel";

// Master Data SCM (owner 2026-09-30: "toleransi ditambahkan di master data SCM ... berlaku di semua vendor
// produksi"). Saat ini berisi satu pengaturan: toleransi selisih berat berat kotor vs berat bersih.
// Tidak perlu guard "mounted" di sini -- AppShell tidak merender anaknya sebelum terpasang di client.
export default function ScmMasterDataPage() {
  return (
    <AppShell role="scm" activeHref="/scm/master-data" breadcrumb={["Dashboard", "Master Data"]} title="Master Data" subtitle="Pengaturan acuan yang berlaku untuk semua vendor produksi">
      <WeightTolerancePanel />
    </AppShell>
  );
}
