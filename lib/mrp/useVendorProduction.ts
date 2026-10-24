"use client";

import { useMemo } from "react";
import { onlyVendor } from "./derive";
import { useMrpStore } from "./store";

/** Data produksi MILIK SATU VENDOR saja (batch, hasil, status grup). Satu warna·lengan bisa dikerjakan beberapa vendor, dan perhitungan
 *  grup (`mrp|warna|lengan`) tidak membedakan vendor, jadi layar vendor harus membaca data yang sudah disaring supaya target dan Finish
 *  Good vendor lain tidak ikut terjumlah (kasus W39 Hitam 30S Pendek, 2026-10-24). */
export function useVendorProduction(vendorId: string) {
  const allBatches = useMrpStore((s) => s.productionBatches);
  const allResults = useMrpStore((s) => s.productionResults);
  const allMeta = useMrpStore((s) => s.productionGroupMeta);
  return useMemo(
    () => ({
      productionBatches: onlyVendor(allBatches, vendorId),
      productionResults: onlyVendor(allResults, vendorId),
      productionGroupMeta: onlyVendor(allMeta, vendorId),
    }),
    [allBatches, allResults, allMeta, vendorId]
  );
}
