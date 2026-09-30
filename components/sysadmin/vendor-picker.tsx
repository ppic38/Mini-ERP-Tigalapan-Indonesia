"use client";

import { AppShell } from "@/components/shell/app-shell";
import { Button } from "@/components/ui/button";
import { VENDOR_PRODUKSI } from "@/lib/mrp/seed";
import { useSysadminVendorStore } from "@/lib/shell/sysadmin-vendor-store";

const VENDOR_IDS = Object.keys(VENDOR_PRODUKSI);

/** Layar pilih vendor -- tampil di halaman portal Vendor Produksi kalau Sysadmin belum memilih vendor. */
export function SysadminVendorPicker() {
  const setVendorId = useSysadminVendorStore((s) => s.setVendorId);
  return (
    <AppShell role="vendorMaklon" breadcrumb={["Sysadmin", "Vendor Produksi"]} title="Pilih Vendor Produksi" subtitle="Pilih vendor yang portalnya ingin dilihat dan dikoreksi.">
      <div className="grid grid-cols-2 gap-2.5 md:grid-cols-3 lg:grid-cols-4">
        {VENDOR_IDS.map((id) => (
          <Button key={id} onClick={() => setVendorId(id)} variant="ghost" size="md" className="justify-start py-3">
            {VENDOR_PRODUKSI[id].name}
            <span className="ml-auto font-mono text-[10px] font-normal text-text-muted">{id}</span>
          </Button>
        ))}
      </div>
    </AppShell>
  );
}
