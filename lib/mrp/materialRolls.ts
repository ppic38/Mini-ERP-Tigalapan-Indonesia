import type { DeliveryKoli, ProductionBatch, RawMaterialInvoice, Lengan, WarehouseReceipt } from "./types";
import { FLOW_STAGES, batchShippingMap, invoiceRollFlowStage, type FlowStage } from "./flowStatus";

/** Material Tracking per ROLL (Procurement, owner 2026-11-16: "tabel per roll, statusnya hingga material itu sudah di produksi atau
 *  sudah delivery"). Satu baris = satu roll kain di invoice bahan (`colorEntries[].rolls[i]`). Semua turunan dari data yang sudah ada:
 *   - Dibayar          : invoice sudah dibayar Finance, belum di-set delivery
 *   - Delivery         : sudah di-set delivery (dikirim supplier ke vendor produksi), roll belum ditandai diterima
 *   - Diterima vendor  : roll sudah ditandai fisik diterima di Good Receive vendor, belum dipakai produksi
 *   - Di produksi      : code roll sudah masuk Resting / Cutting / sesudahnya (ada `production_batches` dengan code roll itu)
 *  Roll yang diterima tanpa code roll tidak bisa dicocokkan ke produksi, jadi berhenti di "Diterima vendor" sampai code rollnya ada. */
// Status memakai status staging standar (lib/mrp/flowStatus.ts, owner 2026-11-16): PV Material, Paid, Delivery Material, Receiving Material, Resting ... GR DC.
export const MATERIAL_ROLL_STAGES = FLOW_STAGES.slice(2) as readonly FlowStage[];
export type MaterialRollStage = FlowStage;

export type MaterialRollRow = {
  key: string;
  invoiceId: string;
  noInvoice: string;
  poId: string;
  mrpId: string;
  supplier: string;
  vendorProduksi: string;
  entitas: string;
  warna: string;
  lengan: Lengan;
  /** Urutan roll di warna x lengan itu pada invoice (mulai 1). */
  no: number;
  codeRoll: string;
  codeLot: string;
  beratKotor: number;
  beratBersih?: number;
  status: MaterialRollStage;
  /** Tahap produksi roll (hanya untuk status "Di produksi"). */
  tahapProduksi?: "Resting" | "Cutting" | "Selesai";
  paidAt?: string;
  deliveryAt?: string;
  grAt?: string;
  restingAt?: string;
  cuttingAt?: string;
};

const day = (iso?: string) => (iso ? iso.slice(0, 10) : undefined);

export function buildMaterialRolls(invoices: RawMaterialInvoice[], batches: ProductionBatch[], kolis: DeliveryKoli[] = [], receipts: WarehouseReceipt[] = []): MaterialRollRow[] {
  const shipping = batchShippingMap(kolis, receipts);
  const batchByCode = new Map<string, ProductionBatch>();
  for (const b of batches) if (b.codeRoll) batchByCode.set(b.codeRoll, b);

  const out: MaterialRollRow[] = [];
  for (const inv of invoices) {
    for (const c of inv.colorEntries) {
      const key = c.warna + "|" + c.lengan;
      const arrivals = inv.rollArrivals[key] ?? [];
      const receipts = inv.rollReceipts[key] ?? [];
      c.rolls.forEach((kg, idx) => {
        const arrival = arrivals[idx] ?? null;
        const receipt = receipts[idx] ?? null;
        const codeRoll = arrival?.codeRoll || receipt?.codeRoll || c.codeRolls?.[idx] || "";
        const batch = codeRoll ? batchByCode.get(codeRoll) : undefined;
        const status: MaterialRollStage = invoiceRollFlowStage(inv, !!arrival, batch, batch ? shipping.get(batch.id) : undefined);
        out.push({
          key: `${inv.id}|${key}|${idx}`,
          invoiceId: inv.id,
          noInvoice: inv.noInvoiceVendor || "",
          poId: inv.poId,
          mrpId: inv.mrpId,
          supplier: inv.supplier || "Belum ada supplier",
          vendorProduksi: inv.destinationVendor,
          entitas: inv.entity,
          warna: c.warna,
          lengan: c.lengan,
          no: idx + 1,
          codeRoll,
          codeLot: arrival?.codeLot || receipt?.codeLot || c.lots?.[idx] || "",
          beratKotor: kg,
          beratBersih: receipt?.netKg,
          status,
          tahapProduksi: batch ? (batch.closedAt ? "Selesai" : batch.cuttingAt ? "Cutting" : "Resting") : undefined,
          paidAt: day(inv.paidAt),
          deliveryAt: day(inv.deliveredAt),
          grAt: day(arrival?.arrivedAt),
          restingAt: day(batch?.restingAt),
          cuttingAt: day(batch?.cuttingAt),
        });
      });
    }
  }
  return out;
}
