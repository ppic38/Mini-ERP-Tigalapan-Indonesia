import type { MrpDetail } from "./store";
import { invoiceAwaitingPayment } from "./derive";
import { batchBasis, batchShippingMap, invoiceRollFlowStage, type FlowStage } from "./flowStatus";
import { benangFromKategori } from "./rawMaterialReport";
import type { DeliveryKoli, Lengan, MaterialClaimHistory, ProductionBatch, RawMaterialInvoice, WarehouseReceipt } from "./types";

/** Material per ROLL yang SUDAH DIBAYAR (Procurement > Raw Material dan Finance > Posisi Stok, tabel yang sama; owner 2026-11-16).
 *  Satu baris = satu roll kain di invoice bahan yang sudah dibayar Finance.
 *  Nilai roll = harga/kg x berat kotor + porsi rib - porsi diskon, rumus yang SAMA dengan HPP (`rawRollCostShares` di derive.ts):
 *   - porsi rib    = biaya item tambahan (rib/kerah/manset) warna itu di invoice / total kg kain warna itu x berat roll
 *   - porsi diskon = diskon invoice / total kg kain invoice x berat roll
 *  Status = status staging standar (`lib/mrp/flowStatus.ts`, owner 2026-11-16): Paid -> Delivery Material -> Receiving Material -> Resting -> Cutting ->
 *  Finish Good -> Done FG -> Packing -> Delivery -> GR DC; Diretur = roll keluar lewat klaim retur. */

export const RM_ROLL_STATUSES = ["Paid", "Delivery Material", "Receiving Material", "Resting", "Cutting", "Finish Good", "Done FG", "Packing", "Delivery FG", "GR DC", "Diretur"] as const;
export type RmRollStatus = Exclude<FlowStage, "Approval MRP" | "Approval PO" | "PV Material"> | "Diretur";

/** Posisi ringkas untuk kartu (sama pengelompokan Posisi Stok). */
export const RM_ROLL_POSITIONS = ["Belum produksi", "Proses produksi", "Sudah delivery", "Diretur"] as const;
export type RmRollPosition = (typeof RM_ROLL_POSITIONS)[number];

export function positionOf(status: RmRollStatus): RmRollPosition {
  if (status === "Paid" || status === "Delivery Material" || status === "Receiving Material") return "Belum produksi";
  if (status === "Delivery FG" || status === "GR DC") return "Sudah delivery";
  if (status === "Diretur") return "Diretur";
  return "Proses produksi";
}

export type RmRollRow = {
  key: string;
  status: RmRollStatus;
  position: RmRollPosition;
  mrpId: string;
  poId: string;
  entitas: string;
  supplier: string;
  vendorProduksi: string;
  warna: string;
  lengan: Lengan;
  kategori: string;
  benang: string;
  invoiceId: string;
  noInvoice: string;
  no: number;
  codeRoll: string;
  beratKotor: number;
  beratBersih?: number;
  hargaPerKg: number;
  /** harga/kg x berat kotor */
  nilaiKain: number;
  ribRoll: number;
  diskonRoll: number;
  /** nilaiKain + ribRoll - diskonRoll */
  nilai: number;
  /** Porsi nilai roll yang pcs-nya sudah terkirim. */
  nilaiTerkirim: number;
  /** Nilai yang masih berupa stok (belum terkirim). Diretur = 0. */
  nilaiStok: number;
  pcsBelumKirim: number;
  invoiceAt?: string;
  paidAt?: string;
  deliveryAt?: string;
  grAt?: string;
  restingAt?: string;
  cuttingAt?: string;
  closedAt?: string;
};

const day = (iso?: string) => (iso ? iso.slice(0, 10) : undefined);

export function buildRawMaterialRolls(
  invoices: RawMaterialInvoice[],
  batches: ProductionBatch[],
  kolis: DeliveryKoli[],
  claims: MaterialClaimHistory[],
  mrpDetails: MrpDetail[],
  receipts: WarehouseReceipt[]
): RmRollRow[] {
  const batchByCode = new Map<string, ProductionBatch>();
  for (const b of batches) if (b.codeRoll) batchByCode.set(b.codeRoll, b);
  const detailById = new Map(mrpDetails.map((d) => [d.mrp.id, d]));
  const kategoriOf = (mrpId: string, warna: string, lengan: Lengan) => {
    const d = detailById.get(mrpId);
    return d?.lenganGroups.find((g) => g.warna === warna && g.lengan === lengan && g.kategori)?.kategori || d?.mrp.kategori || "-";
  };

  const shipping = batchShippingMap(kolis, receipts);
  const returnedRolls = new Set(claims.filter((c) => c.resolutionKind === "RETUR_REORDER" && c.resolvedAt).map((c) => `${c.invoiceId}|${c.warna}|${c.lengan}|${c.rollIndex}`));

  const out: RmRollRow[] = [];
  for (const inv of invoices) {
    // Hanya material yang SUDAH dibayar Finance.
    if (inv.status === "WAITING_INVOICE" || invoiceAwaitingPayment(inv)) continue;
    const vendor = inv.destinationVendor || inv.vendorProduksi;
    const kgOf = (rows: RawMaterialInvoice["colorEntries"]) => rows.reduce((t, e) => t + e.rolls.reduce((a, w) => a + w, 0), 0);
    const fabricKg = kgOf(inv.colorEntries);

    inv.colorEntries.forEach((c) => {
      const key = `${c.warna}|${c.lengan}`;
      const arrivals = inv.rollArrivals[key] ?? [];
      const receipts = inv.rollReceipts[key] ?? [];
      const kategori = kategoriOf(inv.mrpId, c.warna, c.lengan);
      const colorKg = kgOf(inv.colorEntries.filter((e) => e.warna === c.warna));
      const ribCost = inv.addBuys.filter((a) => a.warna === c.warna).reduce((t, a) => t + a.totalHarga, 0);

      c.rolls.forEach((kg, idx) => {
        const arrival = arrivals[idx] ?? null;
        const receipt = receipts[idx] ?? null;
        const codeRoll = arrival?.codeRoll || receipt?.codeRoll || c.codeRolls?.[idx] || "";
        const batch = codeRoll ? batchByCode.get(codeRoll) : undefined;
        const nilaiKain = c.hargaPerRoll * kg;
        const ribRoll = colorKg > 0 ? (ribCost * kg) / colorKg : 0;
        const diskonRoll = fabricKg > 0 ? ((inv.diskon ?? 0) * kg) / fabricKg : 0;
        const nilai = nilaiKain + ribRoll - diskonRoll;

        const returned = returnedRolls.has(`${inv.id}|${c.warna}|${c.lengan}|${idx}`);
        const ship = batch ? shipping.get(batch.id) : undefined;
        const status: RmRollStatus = returned ? "Diretur" : (invoiceRollFlowStage(inv, !!arrival, batch, ship) as RmRollStatus);
        let shippedShare = 0;
        let pcsBelumKirim = 0;
        if (batch) {
          const basis = batchBasis(batch);
          const shipped = Math.min(ship?.shipped ?? 0, basis);
          shippedShare = basis > 0 ? shipped / basis : 0;
          pcsBelumKirim = basis - shipped;
        }
        const nilaiTerkirim = status === "Diretur" ? 0 : nilai * shippedShare;
        out.push({
          key: `${inv.id}|${key}|${idx}`,
          status,
          position: positionOf(status),
          mrpId: inv.mrpId,
          poId: inv.poId,
          entitas: inv.entity || "",
          supplier: inv.supplier || "Belum ada supplier",
          vendorProduksi: vendor,
          warna: c.warna,
          lengan: c.lengan,
          kategori,
          benang: benangFromKategori(kategori),
          invoiceId: inv.id,
          noInvoice: inv.noInvoiceVendor?.trim() || "",
          no: idx + 1,
          codeRoll,
          beratKotor: kg,
          beratBersih: receipt?.netKg,
          hargaPerKg: c.hargaPerRoll,
          nilaiKain,
          ribRoll,
          diskonRoll,
          nilai,
          nilaiTerkirim,
          nilaiStok: status === "Diretur" ? 0 : nilai - nilaiTerkirim,
          pcsBelumKirim,
          invoiceAt: day(inv.bookedAt),
          paidAt: day(inv.paidAt),
          deliveryAt: day(inv.deliveredAt),
          grAt: day(arrival?.arrivedAt),
          restingAt: day(batch?.restingAt),
          cuttingAt: day(batch?.cuttingAt),
          closedAt: day(batch?.closedAt),
        });
      });
    });
  }
  return out;
}
