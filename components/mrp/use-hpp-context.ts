"use client";

import { useMemo } from "react";
import { useMrpStore } from "@/lib/mrp/store";
import { buildHppContext, type PoHppContext } from "@/lib/mrp/poHppEstimate";

/** Konteks estimasi HPP bersama (lib/mrp/poHppEstimate.ts) untuk semua halaman: MRP PPIC, SCM, Dashboard, Approval PO, Tracking Item.
 *  Dibangun sekali per perubahan data store (indeks Aduan Pola, PO, angka terkunci, rata-rata ongkir, rasio diskon); nol query baru. */
export function useHppContext(): PoHppContext {
  const mrpDetails = useMrpStore((s) => s.mrpDetails);
  const materialPOs = useMrpStore((s) => s.materialPOs);
  const maklonPOs = useMrpStore((s) => s.maklonPOs);
  const invoices = useMrpStore((s) => s.invoices);
  const deliveryKolis = useMrpStore((s) => s.deliveryKolis);
  const ekspedisiRates = useMrpStore((s) => s.ekspedisiRates);
  const hargaKain = useMrpStore((s) => s.hargaKain);
  const hargaKainPks = useMrpStore((s) => s.hargaKainPks);
  const hargaRib = useMrpStore((s) => s.hargaRib);
  const hargaKerahManset = useMrpStore((s) => s.hargaKerahManset);
  const kerahMansetSettings = useMrpStore((s) => s.kerahMansetSettings);
  const hargaMaklon = useMrpStore((s) => s.hargaMaklon);
  const itemSellingPrices = useMrpStore((s) => s.itemSellingPrices);
  // Penanda perubahan saja: Mapping Warna dibaca sellingPriceFor lewat variabel modul yang diisi store sebelum state di-set.
  const warnaAliases = useMrpStore((s) => s.warnaAliases);
  return useMemo(
    () =>
      buildHppContext({ mrpDetails, materialPOs, maklonPOs, invoices, deliveryKolis, ekspedisiRates, hargaKain, hargaKainPks, hargaRib, hargaKerahManset, kerahMansetSettings, hargaMaklon, itemSellingPrices }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mrpDetails, materialPOs, maklonPOs, invoices, deliveryKolis, ekspedisiRates, hargaKain, hargaKainPks, hargaRib, hargaKerahManset, kerahMansetSettings, hargaMaklon, itemSellingPrices, warnaAliases]
  );
}
