import type { MrpDetail } from "./store";
import { isBillableKoliItem, materialKgPerRollForGroup, type AduanMaterialKind } from "./derive";
import type { DeliveryKoli, Lengan, MaterialClaimHistory, ProductionBatch, RawMaterialInvoice } from "./types";

/** Posisi Stok (Finance): nilai bahan yang sudah dibeli, dipecah menurut tahap fisiknya SAAT INI. Berhenti di pengiriman vendor; penerimaan gudang
 *  menyusul dari feedback sistem warehouse. Selalu berlaku: dibeli = belumDiterima + diVendor + resting + cuttingFg + tutup + terkirim + diretur + tidakDilacak. */

export type StockBucket = { roll: number; kg: number; nilai: number };

export const STOCK_STAGES = ["dibeli", "belumDiterima", "diVendor", "resting", "cuttingFg", "tutup", "terkirim", "diretur"] as const;
export type StockStage = (typeof STOCK_STAGES)[number];

export type StockTotals = Record<StockStage, StockBucket> & {
  /** Finish Good/hasil cutting yang belum dikirim dari roll yang sedang diproduksi. */
  pcsBelumKirim: number;
  /** Item tambahan selain rib/kerah/manset: pemakaiannya tidak dilacak, jadi tidak masuk tahap mana pun. */
  tidakDilacak: number;
};

export type StockLine = StockTotals & {
  key: string;
  mrpId: string;
  vendorProduksi: string;
  invoiceId: string;
  noInvoice: string;
  supplier: string;
  bookedAt: string;
  kind: "KAIN" | "TAMBAHAN";
  warna: string;
  jenis: string;
  /** Rib/kerah/manset: pembagian tahapnya estimasi dari roll kain warna yang sama. */
  estimasi?: boolean;
};

export type StockPositionResult = {
  lines: StockLine[];
  /** Roll di produksi yang tidak ketemu di invoice mana pun, jadi nilainya tidak terhitung di halaman ini. */
  unmatchedBatches: ProductionBatch[];
};

const emptyBucket = (): StockBucket => ({ roll: 0, kg: 0, nilai: 0 });

export function emptyTotals(): StockTotals {
  return {
    dibeli: emptyBucket(),
    belumDiterima: emptyBucket(),
    diVendor: emptyBucket(),
    resting: emptyBucket(),
    cuttingFg: emptyBucket(),
    tutup: emptyBucket(),
    terkirim: emptyBucket(),
    diretur: emptyBucket(),
    pcsBelumKirim: 0,
    tidakDilacak: 0,
  };
}

export function addTotals(target: StockTotals, source: StockTotals): void {
  for (const stage of STOCK_STAGES) {
    target[stage].roll += source[stage].roll;
    target[stage].kg += source[stage].kg;
    target[stage].nilai += source[stage].nilai;
  }
  target.pcsBelumKirim += source.pcsBelumKirim;
  target.tidakDilacak += source.tidakDilacak;
}

export function sumStock(rows: StockTotals[]): StockTotals {
  const total = emptyTotals();
  rows.forEach((row) => addTotals(total, row));
  return total;
}

export const belumProduksi = (t: StockTotals): StockBucket => mergeBuckets(t.belumDiterima, t.diVendor);
export const prosesProduksi = (t: StockTotals): StockBucket => mergeBuckets(t.resting, t.cuttingFg, t.tutup);

function mergeBuckets(...buckets: StockBucket[]): StockBucket {
  return buckets.reduce((acc, b) => ({ roll: acc.roll + b.roll, kg: acc.kg + b.kg, nilai: acc.nilai + b.nilai }), emptyBucket());
}

function addTo(bucket: StockBucket, kg: number, nilai: number, roll = 0): void {
  bucket.roll += roll;
  bucket.kg += kg;
  bucket.nilai += nilai;
}

const sumQty = (sizeQty: Record<string, number> | undefined) => Object.values(sizeQty ?? {}).reduce((sum, qty) => sum + (qty > 0 ? qty : 0), 0);

/** Pembagi sama dengan HPP per roll: roll tertutup = Finish Good aktual, roll terbuka = hasil cutting. */
function rollOutputBasis(batch: ProductionBatch): number {
  return batch.closedAt ? sumQty(batch.fgSizeQty) : sumQty(batch.sizeQty);
}

/** Pcs roll yang kolinya SUDAH dikirim (reject tidak dihitung). Koli baru yang belum di-set ekspedisi masih dianggap belum delivery. */
function shippedPcs(batch: ProductionBatch, shippedByBatch: Map<string, number>, legacyShipped: Set<string>): number {
  if (legacyShipped.has(batch.id)) return Number.POSITIVE_INFINITY;
  return shippedByBatch.get(batch.id) ?? 0;
}

const MATERIAL_KINDS: AduanMaterialKind[] = ["rib", "kerah", "manset"];
const USED_STAGES = ["terkirim", "tutup", "cuttingFg", "resting"] as const;
type UsedStage = (typeof USED_STAGES)[number];
type MaterialPool = Record<UsedStage, Record<AduanMaterialKind, number>>;

function emptyPool(): MaterialPool {
  const kinds = () => ({ rib: 0, kerah: 0, manset: 0 });
  return { terkirim: kinds(), tutup: kinds(), cuttingFg: kinds(), resting: kinds() };
}

export function buildStockPosition(invoices: RawMaterialInvoice[], batches: ProductionBatch[], kolis: DeliveryKoli[], claims: MaterialClaimHistory[], mrpDetails: MrpDetail[]): StockPositionResult {
  const batchByCode = new Map<string, ProductionBatch>();
  for (const batch of batches) if (batch.codeRoll) batchByCode.set(batch.codeRoll, batch);
  const detailById = new Map(mrpDetails.map((d) => [d.mrp.id, d]));

  const shippedByBatch = new Map<string, number>();
  const legacyShipped = new Set<string>();
  for (const koli of kolis) {
    if (!koli.deliveredAt) continue;
    for (const id of koli.sourceBatchIds ?? []) legacyShipped.add(id);
    for (const item of koli.items) {
      if (!item.sourceBatchId || !isBillableKoliItem(item)) continue;
      shippedByBatch.set(item.sourceBatchId, (shippedByBatch.get(item.sourceBatchId) ?? 0) + item.qty);
    }
  }

  // Roll lama dianggap keluar dari stok saat klaimnya selesai lewat retur + pesan ulang; penggantinya tercatat di invoice pengganti.
  const returnedRolls = new Set(claims.filter((c) => c.resolutionKind === "RETUR_REORDER" && c.resolvedAt).map((c) => `${c.invoiceId}|${c.warna}|${c.lengan}|${c.rollIndex}`));

  const matchedBatchIds = new Set<string>();
  const lines: StockLine[] = [];

  for (const inv of invoices) {
    if (inv.status === "WAITING_INVOICE") continue;
    const vendor = inv.destinationVendor || inv.vendorProduksi;
    const detail = detailById.get(inv.mrpId);
    const baseTotal = inv.colorEntries.reduce((sum, c) => sum + c.rolls.reduce((s, kg) => s + c.hargaPerRoll * kg, 0), 0) + inv.addBuys.reduce((sum, a) => sum + a.totalHarga, 0);
    // Faktor setelah diskon sama dengan laporan Raw Material, supaya total pembelian selalu sama dengan tagihan invoice.
    const factor = baseTotal > 0 && inv.totalBiaya > 0 ? inv.totalBiaya / baseTotal : 1;
    const shared = { mrpId: inv.mrpId, vendorProduksi: vendor, invoiceId: inv.id, noInvoice: inv.noInvoiceVendor?.trim() || inv.id, supplier: inv.supplier, bookedAt: inv.bookedAt };
    const pools = new Map<string, MaterialPool>();

    const addToPool = (warna: string, lengan: Lengan, stage: UsedStage, share: number) => {
      const group = detail?.lenganGroups.find((g) => g.warna === warna && g.lengan === lengan);
      if (!group) return;
      let pool = pools.get(warna);
      if (!pool) pools.set(warna, (pool = emptyPool()));
      for (const kind of MATERIAL_KINDS) pool[stage][kind] += materialKgPerRollForGroup(group, kind) * share;
    };

    inv.colorEntries.forEach((color, colorIndex) => {
      const rollKey = `${color.warna}|${color.lengan}`;
      const arrivals = inv.rollArrivals[rollKey] ?? [];
      const receipts = inv.rollReceipts[rollKey] ?? [];
      const line: StockLine = {
        ...emptyTotals(),
        ...shared,
        key: `${inv.id}|${colorIndex}|${rollKey}`,
        kind: "KAIN",
        warna: color.warna,
        jenis: detail?.lenganGroups.find((g) => g.warna === color.warna && g.lengan === color.lengan)?.kategori || detail?.mrp.kategori || "Kain",
      };

      color.rolls.forEach((kg, rollIndex) => {
        const nilai = color.hargaPerRoll * kg * factor;
        addTo(line.dibeli, kg, nilai, 1);

        const code = arrivals[rollIndex]?.codeRoll || receipts[rollIndex]?.codeRoll;
        const batch = code ? batchByCode.get(code) : undefined;
        if (batch) matchedBatchIds.add(batch.id);

        if (returnedRolls.has(`${inv.id}|${color.warna}|${color.lengan}|${rollIndex}`)) {
          addTo(line.diretur, kg, nilai, 1);
          return;
        }
        if (!batch) {
          addTo(arrivals[rollIndex] ? line.diVendor : line.belumDiterima, kg, nilai, 1);
          return;
        }

        const stage: UsedStage = batch.closedAt ? "tutup" : batch.cuttingAt ? "cuttingFg" : "resting";
        const basis = rollOutputBasis(batch);
        const shipped = Math.min(shippedPcs(batch, shippedByBatch, legacyShipped), basis);
        const shippedShare = basis > 0 ? shipped / basis : 0;
        const remainingShare = 1 - shippedShare;

        addTo(line.terkirim, kg * shippedShare, nilai * shippedShare, shippedShare === 1 ? 1 : 0);
        addTo(line[stage], kg * remainingShare, nilai * remainingShare, shippedShare === 1 ? 0 : 1);
        line.pcsBelumKirim += basis - shipped;
        if (shippedShare > 0) addToPool(color.warna, color.lengan, "terkirim", shippedShare);
        if (remainingShare > 0) addToPool(color.warna, color.lengan, stage, remainingShare);
      });
      lines.push(line);
    });

    inv.addBuys.forEach((addBuy, addBuyIndex) => {
      const nilai = addBuy.totalHarga * factor;
      const line: StockLine = { ...emptyTotals(), ...shared, key: `${inv.id}|add|${addBuyIndex}`, kind: "TAMBAHAN", warna: addBuy.warna || "-", jenis: addBuy.item };
      addTo(line.dibeli, addBuy.beratKg, nilai);

      const kind = MATERIAL_KINDS.find((k) => k === addBuy.item.trim().toLowerCase());
      if (!kind || addBuy.beratKg <= 0) {
        line.tidakDilacak = nilai;
        lines.push(line);
        return;
      }

      line.estimasi = true;
      const perKg = nilai / addBuy.beratKg;
      let remainingKg = addBuy.beratKg;
      const pool = pools.get(addBuy.warna);
      if (pool) {
        for (const stage of USED_STAGES) {
          const usedKg = Math.min(pool[stage][kind], remainingKg);
          addTo(line[stage], usedKg, usedKg * perKg);
          // Item tambahan lain berwarna dan berjenis sama memakai sisa jatah, bukan jatah yang sama dua kali.
          pool[stage][kind] -= usedKg;
          remainingKg -= usedKg;
        }
      }
      const received = !!inv.addBuyReceipts[addBuy.id];
      addTo(received ? line.diVendor : line.belumDiterima, remainingKg, remainingKg * perKg);
      lines.push(line);
    });
  }

  return { lines, unmatchedBatches: batches.filter((b) => !matchedBatchIds.has(b.id)) };
}
