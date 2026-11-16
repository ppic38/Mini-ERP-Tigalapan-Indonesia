import type { MrpDetail } from "./store";
import { invoiceAwaitingPayment, isBillableKoliItem, isSyntheticSupplier } from "./derive";
import { benangFromKategori } from "./rawMaterialReport";
import { ROLL_KG_ESTIMATE } from "./seed";
import type { DeliveryKoli, Lengan, MaterialClaimHistory, MaterialPO, ProductionBatch, RawMaterialInvoice } from "./types";

/** Raw Material per ROLL (Procurement, owner 2026-11-16: "raw material sama dengan posisi stok, namun by roll yang sudah di PO, sudah di paid, dengan
 *  field gabungan antara raw material dan posisi stok"). Satu baris = satu roll kain, dari PO sampai terkirim:
 *   - Roll yang sudah ada di PO Material tetapi belum ada di invoice bahan: satu baris per roll sisa PO, berat dan nilai ESTIMASI
 *     (berat = ROLL_KG_ESTIMATE, nilai = nilai PO / jumlah roll PO).
 *   - Roll di invoice bahan: nilai = harga per kg x berat kotor x faktor diskon invoice (rumus yang SAMA dengan Raw Material dan Posisi Stok, jadi
 *     jumlahnya = nilai kain invoice), lalu tahap fisiknya dengan aturan Posisi Stok (`buildStockPosition`): belum diterima vendor, di vendor,
 *     resting, cutting & FG, roll ditutup, sudah delivery (semua pcs roll itu sudah ada di koli terkirim), diretur.
 *  Item tambahan (rib, kerah, manset) tidak per roll, jadi tidak ada di sini; nilainya tetap di tab Per MRP dan vendor. */

export const RM_ROLL_STATUSES = [
  "PO, belum invoice",
  "Belum dibayar",
  "Belum diterima vendor",
  "Di vendor",
  "Resting",
  "Cutting & FG",
  "Roll ditutup",
  "Sudah delivery",
  "Diretur",
] as const;
export type RmRollStatus = (typeof RM_ROLL_STATUSES)[number];

/** Posisi ringkas (sama pengelompokan kartu Posisi Stok Finance). */
export const RM_ROLL_POSITIONS = ["Belum dibayar", "Belum produksi", "Proses produksi", "Sudah delivery", "Diretur"] as const;
export type RmRollPosition = (typeof RM_ROLL_POSITIONS)[number];

export function positionOf(status: RmRollStatus): RmRollPosition {
  if (status === "PO, belum invoice" || status === "Belum dibayar") return "Belum dibayar";
  if (status === "Belum diterima vendor" || status === "Di vendor") return "Belum produksi";
  if (status === "Sudah delivery") return "Sudah delivery";
  if (status === "Diretur") return "Diretur";
  return "Proses produksi";
}

export type RmRollRow = {
  key: string;
  status: RmRollStatus;
  position: RmRollPosition;
  /** Berat dan nilai dari PO (roll belum diinvoice). */
  estimasi: boolean;
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
  /** Urutan roll di warna x lengan pada invoice / PO (mulai 1). */
  no: number;
  codeRoll: string;
  beratKotor: number;
  beratBersih?: number;
  hargaPerKg: number;
  nilaiSebelumDiskon: number;
  nilai: number;
  diskon: number;
  /** Porsi nilai roll yang pcs-nya sudah terkirim (aturan Posisi Stok). */
  nilaiTerkirim: number;
  /** Nilai yang masih berupa stok (belum terkirim). Diretur = 0. */
  nilaiStok: number;
  pcsBelumKirim: number;
  poAt?: string;
  invoiceAt?: string;
  paidAt?: string;
  deliveryAt?: string;
  grAt?: string;
  restingAt?: string;
  cuttingAt?: string;
  closedAt?: string;
};

const day = (iso?: string) => (iso ? iso.slice(0, 10) : undefined);
const sumQty = (q: Record<string, number> | undefined) => Object.values(q ?? {}).reduce((s, n) => s + (n > 0 ? n : 0), 0);

export function buildRawMaterialRolls(
  pos: MaterialPO[],
  invoices: RawMaterialInvoice[],
  batches: ProductionBatch[],
  kolis: DeliveryKoli[],
  claims: MaterialClaimHistory[],
  mrpDetails: MrpDetail[]
): RmRollRow[] {
  const batchByCode = new Map<string, ProductionBatch>();
  for (const b of batches) if (b.codeRoll) batchByCode.set(b.codeRoll, b);
  const detailById = new Map(mrpDetails.map((d) => [d.mrp.id, d]));
  const kategoriOf = (mrpId: string, warna: string, lengan: Lengan) => {
    const d = detailById.get(mrpId);
    return d?.lenganGroups.find((g) => g.warna === warna && g.lengan === lengan && g.kategori)?.kategori || d?.mrp.kategori || "-";
  };

  // Pcs terkirim per roll (sama Posisi Stok): item koli yang sudah dikirim, reject tidak dihitung; koli lama level-koli = roll terkirim utuh.
  const shippedByBatch = new Map<string, number>();
  const legacyShipped = new Set<string>();
  for (const k of kolis) {
    if (!k.deliveredAt) continue;
    for (const id of k.sourceBatchIds ?? []) legacyShipped.add(id);
    for (const it of k.items) {
      if (!it.sourceBatchId || !isBillableKoliItem(it)) continue;
      shippedByBatch.set(it.sourceBatchId, (shippedByBatch.get(it.sourceBatchId) ?? 0) + it.qty);
    }
  }
  const returnedRolls = new Set(claims.filter((c) => c.resolutionKind === "RETUR_REORDER" && c.resolvedAt).map((c) => `${c.invoiceId}|${c.warna}|${c.lengan}|${c.rollIndex}`));

  const out: RmRollRow[] = [];
  const invoicedRolls = new Map<string, number>(); // poId|warna|lengan -> roll di invoice

  for (const inv of invoices) {
    // Sama dengan Posisi Stok: semua invoice kecuali WAITING_INVOICE (termasuk invoice migrasi data awal), supaya jumlah roll dan nilai cocok.
    if (inv.status === "WAITING_INVOICE") continue;
    const vendor = inv.destinationVendor || inv.vendorProduksi;
    const baseTotal = inv.colorEntries.reduce((s, c) => s + c.rolls.reduce((t, kg) => t + c.hargaPerRoll * kg, 0), 0) + inv.addBuys.reduce((s, a) => s + a.totalHarga, 0);
    const factor = baseTotal > 0 && inv.totalBiaya > 0 ? inv.totalBiaya / baseTotal : 1;
    const paid = !invoiceAwaitingPayment(inv);

    inv.colorEntries.forEach((c) => {
      const key = `${c.warna}|${c.lengan}`;
      const poKey = `${inv.poId}|${key}`;
      invoicedRolls.set(poKey, (invoicedRolls.get(poKey) ?? 0) + c.rolls.length);
      const arrivals = inv.rollArrivals[key] ?? [];
      const receipts = inv.rollReceipts[key] ?? [];
      const kategori = kategoriOf(inv.mrpId, c.warna, c.lengan);
      c.rolls.forEach((kg, idx) => {
        const arrival = arrivals[idx] ?? null;
        const receipt = receipts[idx] ?? null;
        const codeRoll = arrival?.codeRoll || receipt?.codeRoll || c.codeRolls?.[idx] || "";
        const batch = codeRoll ? batchByCode.get(codeRoll) : undefined;
        const sebelum = c.hargaPerRoll * kg;
        const nilai = sebelum * factor;

        let status: RmRollStatus;
        let shippedShare = 0;
        let pcsBelumKirim = 0;
        if (returnedRolls.has(`${inv.id}|${c.warna}|${c.lengan}|${idx}`)) status = "Diretur";
        else if (!paid) status = "Belum dibayar";
        else if (!batch) status = arrival ? "Di vendor" : "Belum diterima vendor";
        else {
          const basis = batch.closedAt ? sumQty(batch.fgSizeQty) : sumQty(batch.sizeQty);
          const shipped = legacyShipped.has(batch.id) ? basis : Math.min(shippedByBatch.get(batch.id) ?? 0, basis);
          shippedShare = basis > 0 ? shipped / basis : 0;
          pcsBelumKirim = basis - shipped;
          status = shippedShare >= 1 ? "Sudah delivery" : batch.closedAt ? "Roll ditutup" : batch.cuttingAt ? "Cutting & FG" : "Resting";
        }
        // Roll yang belum dibayar tetapi sudah dipakai produksi (dispensasi terima lebih awal) tetap dihitung porsi kirimnya.
        if (status === "Belum dibayar" && batch) {
          const basis = batch.closedAt ? sumQty(batch.fgSizeQty) : sumQty(batch.sizeQty);
          const shipped = legacyShipped.has(batch.id) ? basis : Math.min(shippedByBatch.get(batch.id) ?? 0, basis);
          shippedShare = basis > 0 ? shipped / basis : 0;
          pcsBelumKirim = basis - shipped;
        }
        const nilaiTerkirim = status === "Diretur" ? 0 : nilai * shippedShare;
        out.push({
          key: `${inv.id}|${key}|${idx}`,
          status,
          position: positionOf(status),
          estimasi: false,
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
          nilaiSebelumDiskon: sebelum,
          nilai,
          diskon: sebelum - nilai,
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

  // Roll PO Material yang belum ada di invoice bahan mana pun.
  for (const po of pos) {
    if (po.status === "CANCELLED" || isSyntheticSupplier(po.supplier)) continue;
    const perRoll = po.rollCount > 0 ? po.amount / po.rollCount : 0;
    for (const c of po.colorBreakdown) {
      const key = `${c.warna}|${c.lengan}`;
      const poKey = `${po.id}|${key}`;
      const sudah = invoicedRolls.get(poKey) ?? 0;
      const sisa = Math.max(0, c.rollCount - sudah);
      invoicedRolls.set(poKey, Math.max(0, sudah - c.rollCount)); // PO bisa memuat warna x lengan yang sama lebih dari sekali
      const kategori = kategoriOf(po.mrpId, c.warna, c.lengan);
      for (let i = 0; i < sisa; i++) {
        out.push({
          key: `${po.id}|${key}|po${sudah + i}`,
          status: "PO, belum invoice",
          position: "Belum dibayar",
          estimasi: true,
          mrpId: po.mrpId,
          poId: po.id,
          entitas: c.entitas || po.entity || "",
          supplier: po.supplier || "Belum ada supplier",
          vendorProduksi: po.vendorProduksi,
          warna: c.warna,
          lengan: c.lengan,
          kategori,
          benang: benangFromKategori(kategori),
          invoiceId: "",
          noInvoice: "",
          no: sudah + i + 1,
          codeRoll: "",
          beratKotor: ROLL_KG_ESTIMATE,
          hargaPerKg: 0,
          nilaiSebelumDiskon: perRoll,
          nilai: perRoll,
          diskon: 0,
          nilaiTerkirim: 0,
          nilaiStok: perRoll,
          pcsBelumKirim: 0,
          poAt: day(po.createdAt ?? po.approvalSubmittedAt),
        });
      }
    }
  }
  return out;
}
