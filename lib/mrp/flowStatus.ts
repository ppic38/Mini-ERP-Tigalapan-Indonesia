import type { MrpDetail } from "./store";
import { invoiceAwaitingPayment, isBillableKoliItem, koliOngkirShare, sellingPriceFor } from "./derive";
import type {
  DeliveryKoli,
  MaklonPO,
  MaterialClaimHistory,
  MaterialPO,
  ProductionBatch,
  RawMaterialInvoice,
  VendorInvoice,
  WarehouseReceipt,
} from "./types";
import type { EkspedisiRateRow, ItemSellingPriceRow } from "./masterData";

/** STATUS STAGING STANDAR seluruh alur (keputusan owner 2026-11-16). SATU daftar untuk semua field status; tiap tingkat (MRP, roll, aduan, koli)
 *  memakai potongannya. Arti = gate TERAKHIR yang sudah dilewati (atau sedang berjalan untuk dua tahap approval):
 *   Approval MRP       : MRP menunggu / sedang approval SCM
 *   Approval PO        : PO sedang approval berjenjang, atau sudah disetujui dan menunggu PV
 *   PV Material        : PV (invoice bahan) sudah dibuat Procurement, belum dibayar
 *   Paid               : invoice bahan dibayar Finance
 *   Delivery Material  : Set Delivery (supplier mengirim kain ke vendor)
 *   Receiving Material : roll diterima vendor (Good Receive)
 *   Resting            : roll masuk resting
 *   Cutting            : hasil cutting diinput, Finish Good belum
 *   Finish Good        : Finish Good mulai diinput, roll belum ditutup
 *   Done FG            : roll ditutup / produksi selesai, belum masuk koli
 *   Packing            : hasilnya (sebagian) sudah di koli, belum semua dikirim
 *   Delivery           : semua sudah dikirim vendor (koli punya ekspedisi dan resi), belum dibongkar gudang
 *   GR DC              : diterima gudang (Bongkar Koli Warehouse)
 *  Status samping (di luar urutan): Ditolak, Dibatalkan, Diretur.
 *  Satu baris yang memuat banyak barang (mis. satu MRP) memakai tahap PALING AWAL yang masih memegang barang. */
export const FLOW_STAGES = [
  "Approval MRP",
  "Approval PO",
  "PV Material",
  "Paid",
  "Delivery Material",
  "Receiving Material",
  "Resting",
  "Cutting",
  "Finish Good",
  "Done FG",
  "Packing",
  "Delivery",
  "GR DC",
] as const;
export type FlowStage = (typeof FLOW_STAGES)[number];
export type FlowSideStatus = "Ditolak" | "Dibatalkan" | "Diretur";

export const flowRank = (s: string) => {
  const i = (FLOW_STAGES as readonly string[]).indexOf(s);
  return i === -1 ? 99 : i;
};

/** Warna badge standar per tahap. */
export function flowTone(s: string): "neutral" | "warning" | "info" | "rework" | "success" | "danger" | "done" {
  if (s === "Ditolak" || s === "Dibatalkan" || s === "Diretur") return "danger";
  const r = flowRank(s);
  if (r <= 1) return "warning";
  if (r <= 5) return "info";
  if (r <= 9) return "rework";
  if (r <= 11) return "success";
  return "done";
}

// ---------------------------------------------------------------- Paying Voucher (Procurement) ----------------------------------------------------------
/** Status Paying Voucher (owner 2026-11-16), hanya enam:
 *   Submitted          : diajukan vendor (invoice vendor produksi)
 *   Approve            : disetujui Procurement (invoice vendor)
 *   Not Paid           : disetujui tetapi belum dibayar (PV invoice bahan yang belum dibayar Finance)
 *   Paid               : sudah dibayar Finance
 *   Delivery Material  : bahan sudah di-Set Delivery
 *   Receiving Material : bahan sudah diterima vendor (Good Receive) */
export const PV_STATUSES = ["Submitted", "Approve", "Not Paid", "Paid", "Delivery Material", "Receiving Material"] as const;
export type PvStatus = (typeof PV_STATUSES)[number] | "Revisi";

export function pvStatusMaterial(inv: Pick<RawMaterialInvoice, "status" | "earlyRelease" | "paidAt" | "deliveredAt" | "rollArrivals" | "receivedAt">): PvStatus {
  const anyArrived = !!inv.receivedAt || Object.values(inv.rollArrivals ?? {}).some((list) => (list ?? []).some(Boolean));
  if (anyArrived && !invoiceAwaitingPayment(inv)) return "Receiving Material";
  if (invoiceAwaitingPayment(inv)) return "Not Paid";
  if (inv.deliveredAt || inv.status === "DELIVERY") return "Delivery Material";
  return "Paid";
}

export function pvStatusVendor(inv: Pick<VendorInvoice, "status">): PvStatus {
  if (inv.status === "PAID") return "Paid";
  if (inv.status === "APPROVED") return "Approve";
  if (inv.status === "REVISION") return "Revisi";
  return "Submitted";
}

export function pvTone(s: PvStatus): "neutral" | "warning" | "info" | "success" | "done" | "danger" | "rework" {
  if (s === "Submitted") return "warning";
  if (s === "Approve") return "info";
  if (s === "Not Paid") return "rework";
  if (s === "Paid") return "success";
  if (s === "Revisi") return "danger";
  return "done";
}

// ---------------------------------------------------------------- Roll ------------------------------------------------------------------------------------
export type BatchShipping = { packed: number; shipped: number; received: number };

/** Qty per roll (batch) yang sudah di koli, sudah dikirim, dan sudah dibongkar gudang. Reject tidak dihitung. Koli lama level-koli (`sourceBatchIds`)
 *  dianggap memuat roll itu utuh (Infinity, dibatasi basis di pemakai). */
export function batchShippingMap(kolis: DeliveryKoli[], receipts: WarehouseReceipt[]): Map<string, BatchShipping> {
  const receivedKoli = new Set(receipts.flatMap((r) => r.koliIds));
  const out = new Map<string, BatchShipping>();
  const add = (id: string, qty: number, shipped: boolean, received: boolean) => {
    const cur = out.get(id) ?? { packed: 0, shipped: 0, received: 0 };
    cur.packed += qty;
    if (shipped) cur.shipped += qty;
    if (received) cur.received += qty;
    out.set(id, cur);
  };
  for (const k of kolis) {
    const shipped = !!k.deliveredAt;
    const received = receivedKoli.has(k.id);
    for (const id of k.sourceBatchIds ?? []) add(id, Number.POSITIVE_INFINITY, shipped, received);
    for (const it of k.items) if (it.sourceBatchId && isBillableKoliItem(it)) add(it.sourceBatchId, it.qty, shipped, received);
  }
  return out;
}

const sumQty = (q: Record<string, number> | undefined) => Object.values(q ?? {}).reduce((s, n) => s + (n > 0 ? n : 0), 0);

/** Pcs hasil roll (pembagi HPP): roll ditutup = Finish Good, roll terbuka = hasil cutting. */
export const batchBasis = (b: ProductionBatch) => (b.closedAt ? sumQty(b.fgSizeQty) : sumQty(b.sizeQty));

export function batchFlowStage(b: ProductionBatch, ship: BatchShipping | undefined): FlowStage {
  const basis = batchBasis(b);
  const s = ship ?? { packed: 0, shipped: 0, received: 0 };
  if (b.closedAt && basis > 0) {
    if (s.received >= basis) return "GR DC";
    if (s.shipped >= basis) return "Delivery";
  }
  if (s.packed > 0) return "Packing";
  if (b.closedAt) return "Done FG";
  if (sumQty(b.fgSizeQty) > 0) return "Finish Good";
  if (b.cuttingAt) return "Cutting";
  return "Resting";
}

/** Tahap satu roll kain di invoice bahan. */
export function invoiceRollFlowStage(inv: RawMaterialInvoice, arrived: boolean, batch: ProductionBatch | undefined, ship: BatchShipping | undefined): FlowStage {
  if (batch) return batchFlowStage(batch, ship);
  if (invoiceAwaitingPayment(inv)) return "PV Material";
  if (arrived) return "Receiving Material";
  if (inv.deliveredAt) return "Delivery Material";
  return "Paid";
}

/** Kunci roll yang sudah keluar lewat klaim retur selesai (`invoiceId|warna|lengan|rollIndex`): tidak lagi menahan status kiriman / MRP. */
export function returnedRollKeys(claims: MaterialClaimHistory[]): Set<string> {
  return new Set(claims.filter((c) => c.resolutionKind === "RETUR_REORDER" && c.resolvedAt).map((c) => `${c.invoiceId}|${c.warna}|${c.lengan}|${c.rollIndex}`));
}

export type FlowBreakdown = { stage: FlowStage; rollsByStage: Partial<Record<FlowStage, number>> };

/** Tahap satu invoice bahan (satu kiriman) = tahap PALING AWAL roll-rollnya, plus jumlah roll per tahap (untuk tooltip). Roll yang diretur
 *  tidak dihitung. Invoice tanpa roll memakai status invoicenya. */
export function invoiceFlowStage(
  inv: RawMaterialInvoice,
  batchByCode: Map<string, ProductionBatch>,
  shipping: Map<string, BatchShipping>,
  returned: Set<string> = new Set()
): FlowBreakdown {
  const rollsByStage: Partial<Record<FlowStage, number>> = {};
  for (const c of inv.colorEntries) {
    const key = `${c.warna}|${c.lengan}`;
    const arrivals = inv.rollArrivals[key] ?? [];
    const receipts = inv.rollReceipts[key] ?? [];
    c.rolls.forEach((_, idx) => {
      if (returned.has(`${inv.id}|${c.warna}|${c.lengan}|${idx}`)) return;
      const code = arrivals[idx]?.codeRoll || receipts[idx]?.codeRoll || c.codeRolls?.[idx] || "";
      const batch = code ? batchByCode.get(code) : undefined;
      const st = invoiceRollFlowStage(inv, !!arrivals[idx], batch, batch ? shipping.get(batch.id) : undefined);
      rollsByStage[st] = (rollsByStage[st] ?? 0) + 1;
    });
  }
  const first = (FLOW_STAGES as readonly FlowStage[]).find((st) => (rollsByStage[st] ?? 0) > 0);
  return { stage: first ?? invoiceRollFlowStage(inv, false, undefined, undefined), rollsByStage };
}

/** "Receiving Material: 9 roll / Cutting: 45 roll" -- teks tooltip rincian roll per tahap. */
export function rollsByStageText(by: Partial<Record<FlowStage, number>>): string {
  return (FLOW_STAGES as readonly FlowStage[])
    .filter((st) => (by[st] ?? 0) > 0)
    .map((st) => `${st}: ${by[st]} roll`)
    .join(String.fromCharCode(10));
}

// ---------------------------------------------------------------- MRP -------------------------------------------------------------------------------------
export type MrpFlow = { stage: FlowStage | FlowSideStatus; rollsByStage: Partial<Record<FlowStage, number>> };

/** Tahap satu MRP = tahap paling awal roll-rollnya (roll PO yang belum diinvoice dihitung "Approval PO"). Jumlah roll per tahap ikut dikembalikan
 *  untuk tooltip. */
export function mrpFlowStage(
  detail: MrpDetail | undefined,
  mrpId: string,
  materialPOs: MaterialPO[],
  invoices: RawMaterialInvoice[],
  batchByCode: Map<string, ProductionBatch>,
  shipping: Map<string, BatchShipping>,
  returned: Set<string> = new Set()
): MrpFlow {
  const rollsByStage: Partial<Record<FlowStage, number>> = {};
  const bump = (s: FlowStage, n = 1) => (rollsByStage[s] = (rollsByStage[s] ?? 0) + n);
  if (detail?.ppicApproval === "REJECTED") return { stage: "Ditolak", rollsByStage };
  if (detail && detail.ppicApproval !== "PPIC_APPROVED") return { stage: "Approval MRP", rollsByStage };

  const pos = materialPOs.filter((p) => p.mrpId === mrpId && p.status !== "CANCELLED");
  if (pos.length === 0 || pos.some((p) => !p.approved)) {
    bump("Approval PO", pos.reduce((s, p) => s + p.rollCount, 0));
    return { stage: "Approval PO", rollsByStage };
  }
  const invoicedByPo = new Map<string, number>();
  for (const inv of invoices) {
    if (inv.mrpId !== mrpId || inv.status === "WAITING_INVOICE") continue;
    for (const c of inv.colorEntries) {
      const key = `${c.warna}|${c.lengan}`;
      invoicedByPo.set(`${inv.poId}|${key}`, (invoicedByPo.get(`${inv.poId}|${key}`) ?? 0) + c.rolls.length);
      const arrivals = inv.rollArrivals[key] ?? [];
      const receipts = inv.rollReceipts[key] ?? [];
      c.rolls.forEach((_, idx) => {
        if (returned.has(`${inv.id}|${c.warna}|${c.lengan}|${idx}`)) return;
        const code = arrivals[idx]?.codeRoll || receipts[idx]?.codeRoll || c.codeRolls?.[idx] || "";
        const batch = code ? batchByCode.get(code) : undefined;
        bump(invoiceRollFlowStage(inv, !!arrivals[idx], batch, batch ? shipping.get(batch.id) : undefined));
      });
    }
  }
  for (const p of pos) {
    for (const c of p.colorBreakdown) {
      const key = `${p.id}|${c.warna}|${c.lengan}`;
      const done = invoicedByPo.get(key) ?? 0;
      const sisa = Math.max(0, Math.round(c.rollCount) - done);
      invoicedByPo.set(key, Math.max(0, done - Math.round(c.rollCount)));
      if (sisa > 0) bump("Approval PO", sisa);
    }
  }
  const present = (FLOW_STAGES as readonly FlowStage[]).filter((s) => (rollsByStage[s] ?? 0) > 0);
  return { stage: present[0] ?? "Approval PO", rollsByStage };
}

// ---------------------------------------------------------------- Estimasi HPP per MRP --------------------------------------------------------------------
export type MrpHppEstimate = { material: number; maklon: number; delivery: number; total: number; hargaJual: number; pct: number | null; pcs: number; pcsTanpaHarga: number };

/** Estimasi HPP % satu MRP sampai tahap Approval PO (owner 2026-11-16): (nilai PO Material + nilai PO Produksi + estimasi ongkir) / nilai jual qty MRP.
 *  - Material = jumlah nilai PO Material MRP itu (bukan CANCELLED), estimasi dari Master Data harga kain saat PO dibuat.
 *  - Maklon   = jumlah nilai PO Produksi MRP itu.
 *  - Ongkir   = qty MRP x rata-rata ongkir per pcs vendor itu dari koli yang sudah dikirim (tarif Master Data Ekspedisi atau biaya aktual invoice
 *               ekspedisi, rumus yang sama dengan HPP); vendor tanpa riwayat memakai rata-rata semua vendor.
 *  - Harga jual = qty per warna x lengan x size x harga jual Master SKU (lewat Mapping Warna). Size tanpa harga jual memakai rata-rata harga per pcs size lain MRP itu
 *               (jumlah pcs-nya dilaporkan di `pcsTanpaHarga`). */
export function ongkirPerPcsByVendor(kolis: DeliveryKoli[], rates: EkspedisiRateRow[]): { byVendor: Map<string, number>; overall: number } {
  const acc = new Map<string, { biaya: number; pcs: number }>();
  let tb = 0;
  let tp = 0;
  for (const k of kolis) {
    if (!k.deliveredAt) continue;
    const pcs = k.items.filter(isBillableKoliItem).reduce((s, it) => s + it.qty, 0);
    if (pcs <= 0) continue;
    const biaya = koliOngkirShare(k, kolis, rates);
    const cur = acc.get(k.vendorProduksi) ?? { biaya: 0, pcs: 0 };
    cur.biaya += biaya;
    cur.pcs += pcs;
    acc.set(k.vendorProduksi, cur);
    tb += biaya;
    tp += pcs;
  }
  const byVendor = new Map<string, number>();
  for (const [v, a] of acc) if (a.pcs > 0) byVendor.set(v, a.biaya / a.pcs);
  return { byVendor, overall: tp > 0 ? tb / tp : 0 };
}

export function mrpHppEstimate(
  detail: MrpDetail | undefined,
  mrpId: string,
  materialPOs: MaterialPO[],
  maklonPOs: MaklonPO[],
  ongkir: { byVendor: Map<string, number>; overall: number },
  sellingPrices: ItemSellingPriceRow[]
): MrpHppEstimate {
  const material = materialPOs.filter((p) => p.mrpId === mrpId && p.status !== "CANCELLED").reduce((s, p) => s + p.amount, 0);
  const maklon = maklonPOs.filter((p) => p.mrpId === mrpId).reduce((s, p) => s + p.amount, 0);
  let hargaJual = 0;
  let pcs = 0;
  let pcsTanpaHarga = 0;
  for (const g of detail?.lenganGroups ?? []) {
    for (const sz of g.sizes) {
      if (sz.qty <= 0) continue;
      pcs += sz.qty;
      const price = sellingPriceFor(g.warna, g.lengan, sz.size, sellingPrices);
      if (price == null || price <= 0) pcsTanpaHarga += sz.qty;
      else hargaJual += price * sz.qty;
    }
  }
  // Ongkir: per vendor menurut qty Aduan Pola vendor itu; tanpa Aduan Pola, rata-rata semua vendor untuk seluruh qty.
  const aduan = detail?.aduanRows ?? [];
  let delivery = 0;
  if (aduan.length > 0) {
    for (const a of aduan) delivery += (a.qty || 0) * (ongkir.byVendor.get(a.vendor) ?? ongkir.overall);
  } else delivery = pcs * ongkir.overall;
  const total = material + maklon + delivery;
  // Size tanpa harga jual memakai rata-rata harga per pcs size lain di MRP yang sama (biaya material dan maklon sudah mencakup seluruh qty).
  const pricedPcs = pcs - pcsTanpaHarga;
  if (pricedPcs > 0 && pcsTanpaHarga > 0) hargaJual += (hargaJual / pricedPcs) * pcsTanpaHarga;
  return { material, maklon, delivery, total, hargaJual, pct: hargaJual > 0 ? (total / hargaJual) * 100 : null, pcs, pcsTanpaHarga };
}
