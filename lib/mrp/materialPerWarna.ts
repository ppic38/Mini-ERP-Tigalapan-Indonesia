import { ROLL_KG_ESTIMATE } from "./seed";
import type { MrpDetail } from "./store";
import type { Lengan, MaterialPO, RawMaterialInvoice } from "./types";

// Monitoring material PER WARNA lintas vendor produksi (permintaan owner 2026-11-02): PO Material mengalir ke supplier lalu ke vendor produksi,
// jadi satu warna bisa dikerjakan beberapa vendor dan kebutuhannya harus dijumlah manual. Murni turunan data yang sudah ada:
//  - roll rencana per vendor  : Aduan Pola (qtyRoll) vendor itu untuk warna·lengan itu
//  - roll di PO Material      : colorBreakdown PO Material vendor itu (PO yang SUDAH terbit)
//  - roll diinvoice / diterima: invoice bahan (Paying Voucher) tujuan vendor itu, rollArrivals per roll
// Estimasi kg = roll x ROLL_KG_ESTIMATE; kg invoice = jumlah berat kotor roll di invoice.

export type MaterialVendorSplit = {
  vendor: string;
  suppliers: string[];
  poIds: string[];
  /** Roll rencana dari Aduan Pola vendor ini. */
  rollRencana: number;
  /** Roll yang sudah ada di PO Material (semua status). */
  rollPo: number;
  rollInvoice: number;
  kgInvoice: number;
  rollDiterima: number;
};

export type MaterialWarnaRow = {
  key: string;
  warna: string;
  lengan: Lengan;
  rollRencana: number;
  kgEstimasi: number;
  rollPo: number;
  rollInvoice: number;
  kgInvoice: number;
  rollDiterima: number;
  vendors: MaterialVendorSplit[];
};

export function buildMaterialPerWarna(mrpId: string, mrpDetails: MrpDetail[], materialPOs: MaterialPO[], invoices: RawMaterialInvoice[]): MaterialWarnaRow[] {
  const detail = mrpDetails.find((d) => d.mrp.id === mrpId);
  if (!detail) return [];
  const rows = new Map<string, MaterialWarnaRow>();
  const split = (warna: string, lengan: Lengan, vendor: string): MaterialVendorSplit => {
    const key = warna + "|" + lengan;
    let row = rows.get(key);
    if (!row) {
      row = { key, warna, lengan, rollRencana: 0, kgEstimasi: 0, rollPo: 0, rollInvoice: 0, kgInvoice: 0, rollDiterima: 0, vendors: [] };
      rows.set(key, row);
    }
    let v = row.vendors.find((x) => x.vendor === vendor);
    if (!v) {
      v = { vendor, suppliers: [], poIds: [], rollRencana: 0, rollPo: 0, rollInvoice: 0, kgInvoice: 0, rollDiterima: 0 };
      row.vendors.push(v);
    }
    return v;
  };

  for (const a of detail.aduanRows) {
    if (!a.vendor || a.qtyRoll <= 0) continue;
    split(a.warna, a.lengan, a.vendor).rollRencana += a.qtyRoll;
  }
  for (const po of materialPOs) {
    if (po.mrpId !== mrpId || po.status === "CANCELLED") continue;
    for (const c of po.colorBreakdown) {
      const v = split(c.warna, c.lengan, po.vendorProduksi);
      v.rollPo += c.rollCount;
      if (!v.suppliers.includes(po.supplier)) v.suppliers.push(po.supplier);
      if (!v.poIds.includes(po.id)) v.poIds.push(po.id);
    }
  }
  for (const inv of invoices) {
    if (inv.mrpId !== mrpId || !inv.destinationVendor) continue;
    for (const c of inv.colorEntries) {
      const v = split(c.warna, c.lengan, inv.destinationVendor);
      const arrivals = inv.rollArrivals[c.warna + "|" + c.lengan] ?? [];
      v.rollInvoice += c.rolls.length;
      v.kgInvoice += c.rolls.reduce((s, kg) => s + kg, 0);
      v.rollDiterima += c.rolls.filter((_, i) => arrivals[i] != null).length;
      if (inv.supplier && !v.suppliers.includes(inv.supplier)) v.suppliers.push(inv.supplier);
    }
  }

  const out = Array.from(rows.values());
  for (const r of out) {
    r.vendors.sort((a, b) => a.vendor.localeCompare(b.vendor));
    for (const v of r.vendors) {
      r.rollRencana += v.rollRencana;
      r.rollPo += v.rollPo;
      r.rollInvoice += v.rollInvoice;
      r.kgInvoice += v.kgInvoice;
      r.rollDiterima += v.rollDiterima;
    }
    r.kgEstimasi = r.rollRencana * ROLL_KG_ESTIMATE;
  }
  return out.sort((a, b) => a.warna.localeCompare(b.warna) || (a.lengan === b.lengan ? 0 : a.lengan === "PENDEK" ? -1 : 1));
}
