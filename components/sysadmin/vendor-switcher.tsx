"use client";

import { VENDOR_PRODUKSI } from "@/lib/mrp/seed";
import { useSysadminVendorStore } from "@/lib/shell/sysadmin-vendor-store";

const VENDOR_IDS = Object.keys(VENDOR_PRODUKSI);

/** Dropdown ganti vendor -- dipakai di spanduk Mode Sysadmin pada halaman portal Vendor Produksi.
 *  File terpisah dari vendor-picker.tsx (yang memakai AppShell) supaya AppShell bisa mengimpornya
 *  tanpa impor melingkar. */
export function SysadminVendorSwitcher() {
  const vendorId = useSysadminVendorStore((s) => s.vendorId);
  const setVendorId = useSysadminVendorStore((s) => s.setVendorId);
  return (
    <select
      value={vendorId ?? ""}
      onChange={(e) => setVendorId(e.target.value || null)}
      className="rounded-md border border-[#E9D9B0] bg-white px-2 py-1 font-sans text-[11.5px] font-semibold text-text-primary"
      aria-label="Ganti vendor produksi yang dilihat"
    >
      {!vendorId && <option value="">— pilih vendor —</option>}
      {VENDOR_IDS.map((id) => (
        <option key={id} value={id}>
          {VENDOR_PRODUKSI[id].name}
        </option>
      ))}
    </select>
  );
}
