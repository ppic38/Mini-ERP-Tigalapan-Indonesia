import type { MrpDetail } from "./store";
import { invoiceAwaitingPayment, isBillableKoliItem, localDateString, mrpDetailFor, targetSizesForBatch } from "./derive";
import { LT_CUTTING_KE_FG, LT_FG_KE_KIRIM, dayKey, ltTiba } from "./itemEstimates";
import type { DeliveryKoli, Lengan, MaterialPO, ProductionBatch, RawMaterialInvoice, WarehouseReceipt } from "./types";

/** Monitoring kendala operasional (owner 2026-11-16, SCM Monitoring dan Produksi): baris yang MELEWATI batas waktu (SLA) antar gate.
 *  Semua turunan data yang sudah ada; tidak ada tabel baru. Angka SLA di sini adalah BAWAAN sementara -- usulan tabel database supaya bisa
 *  diatur dari Master Data ada di docs/usulan-sla-leadtime.md. Satuan hari kalender. */
export type SlaKey =
  | "PO_APPROVE_TO_PV"
  | "PV_TO_PAID"
  | "DELIVERY_TO_RECEIVE"
  | "RECEIVE_TO_RESTING"
  | "RESTING_TO_CUTTING"
  | "CUTTING_TO_DONE_FG"
  | "DONE_FG_TO_DELIVERY"
  | "DELIVERY_TO_GR_DC";

export type SlaRule = { key: SlaKey; label: string; days: number; area: "Material" | "Produksi" | "Pengiriman"; sumber: string };

export const SLA_DEFAULTS: SlaRule[] = [
  { key: "PO_APPROVE_TO_PV", label: "PO disetujui -> PV Material dibuat", days: 2, area: "Material", sumber: "owner 2026-11-16" },
  { key: "PV_TO_PAID", label: "PO disetujui -> PV dibayar (Paid)", days: 2, area: "Material", sumber: "owner 2026-11-16" },
  { key: "DELIVERY_TO_RECEIVE", label: "Delivery Material -> Receiving Material", days: 3, area: "Material", sumber: "owner 2026-11-16" },
  { key: "RECEIVE_TO_RESTING", label: "Receiving Material -> Resting", days: 3, area: "Produksi", sumber: "usulan, belum ditetapkan" },
  { key: "RESTING_TO_CUTTING", label: "Resting -> Cutting", days: 2, area: "Produksi", sumber: "usulan, belum ditetapkan" },
  { key: "CUTTING_TO_DONE_FG", label: "Cutting -> Done FG (roll ditutup)", days: LT_CUTTING_KE_FG, area: "Produksi", sumber: "estimasi Tracking Item" },
  { key: "DONE_FG_TO_DELIVERY", label: "Done FG -> Delivery (dikirim vendor)", days: LT_FG_KE_KIRIM, area: "Pengiriman", sumber: "estimasi Tracking Item" },
  { key: "DELIVERY_TO_GR_DC", label: "Delivery -> GR DC (lead time kirim per vendor)", days: 7, area: "Pengiriman", sumber: "LT tiba Tracking Item (MKS 1 hari)" },
];
export const slaDays = (key: SlaKey) => SLA_DEFAULTS.find((r) => r.key === key)!.days;

export type OpsIssue = {
  key: string;
  area: "Material" | "Produksi" | "Pengiriman";
  kendala: string;
  sla: SlaKey;
  mrpId: string;
  vendorProduksi: string;
  supplier: string;
  warna: string;
  lengan?: Lengan;
  ref: string;
  roll: number;
  pcs: number;
  sejak: string;
  umur: number;
  batas: number;
  lewat: number;
};

const daysSince = (from: string, today: string) => Math.round((Date.parse(today) - Date.parse(from)) / 86_400_000);
const sumQty = (q: Record<string, number> | undefined) => Object.values(q ?? {}).reduce((s, n) => s + (n > 0 ? n : 0), 0);

/** Tanggal PO disetujui penuh: persetujuan terakhir di log approval; cadangan tanggal Approve PO MRP. */
function poApprovedDay(po: MaterialPO, detail: MrpDetail | undefined): string | undefined {
  const last = (po.approvalLog ?? []).filter((e) => e.action === "APPROVED").map((e) => e.at).sort().pop();
  return dayKey(last) ?? dayKey(detail?.dates?.poApproved);
}

export function buildOpsIssues(input: {
  materialPOs: MaterialPO[];
  invoices: RawMaterialInvoice[];
  batches: ProductionBatch[];
  kolis: DeliveryKoli[];
  receipts: WarehouseReceipt[];
  mrpDetails: MrpDetail[];
  today?: string;
}): OpsIssue[] {
  const today = input.today ?? localDateString(new Date());
  const out: OpsIssue[] = [];
  const push = (i: Omit<OpsIssue, "umur" | "batas" | "lewat">, batas: number) => {
    const umur = daysSince(i.sejak, today);
    if (umur > batas) out.push({ ...i, umur, batas, lewat: umur - batas });
  };
  const batchByCode = new Map(input.batches.filter((b) => b.codeRoll).map((b) => [b.codeRoll as string, b]));

  // ---- Material: PV belum dibuat / belum dibayar setelah PO disetujui ----
  const invoicedByPo = new Map<string, number>();
  for (const inv of input.invoices) {
    if (inv.status === "WAITING_INVOICE") continue;
    const n = inv.colorEntries.reduce((s, c) => s + c.rolls.length, 0);
    invoicedByPo.set(inv.poId, (invoicedByPo.get(inv.poId) ?? 0) + n);
  }
  for (const po of input.materialPOs) {
    if (po.status === "CANCELLED" || !po.approved) continue;
    const detail = mrpDetailFor(po.mrpId, input.mrpDetails);
    const approvedDay = poApprovedDay(po, detail);
    if (!approvedDay) continue;
    const sisa = Math.max(0, Math.round(po.rollCount) - (invoicedByPo.get(po.id) ?? 0));
    if (sisa > 0)
      push(
        { key: `pv|${po.id}`, area: "Material", kendala: "PV Material belum dibuat", sla: "PO_APPROVE_TO_PV", mrpId: po.mrpId, vendorProduksi: po.vendorProduksi, supplier: po.supplier, warna: po.colorBreakdown.map((c) => c.warna).filter((v, i, a) => a.indexOf(v) === i).join(", "), ref: po.id, roll: sisa, pcs: 0, sejak: approvedDay },
        slaDays("PO_APPROVE_TO_PV")
      );
    for (const inv of input.invoices.filter((i) => i.poId === po.id && invoiceAwaitingPayment(i)))
      push(
        { key: `paid|${inv.id}`, area: "Material", kendala: "PV Material belum dibayar", sla: "PV_TO_PAID", mrpId: inv.mrpId, vendorProduksi: inv.destinationVendor, supplier: inv.supplier, warna: inv.colorEntries.map((c) => c.warna).join(", "), ref: inv.noInvoiceVendor || inv.id, roll: inv.colorEntries.reduce((s, c) => s + c.rolls.length, 0), pcs: 0, sejak: approvedDay },
        slaDays("PV_TO_PAID")
      );
  }

  // ---- Material: sudah Delivery tetapi roll belum diterima vendor; roll diterima tetapi belum Resting ----
  for (const inv of input.invoices) {
    const delivered = dayKey(inv.deliveredAt);
    for (const c of inv.colorEntries) {
      const key = `${c.warna}|${c.lengan}`;
      const arrivals = inv.rollArrivals[key] ?? [];
      const receipts = inv.rollReceipts[key] ?? [];
      let notArrived = 0;
      const waitingRest: string[] = [];
      c.rolls.forEach((_, idx) => {
        const a = arrivals[idx];
        if (!a) {
          notArrived++;
          return;
        }
        const code = a.codeRoll || receipts[idx]?.codeRoll || "";
        if (!code || !batchByCode.has(code)) waitingRest.push(dayKey(a.arrivedAt) ?? "");
      });
      if (delivered && notArrived > 0)
        push(
          { key: `recv|${inv.id}|${key}`, area: "Material", kendala: "Delivery belum diterima vendor", sla: "DELIVERY_TO_RECEIVE", mrpId: inv.mrpId, vendorProduksi: inv.destinationVendor, supplier: inv.supplier, warna: c.warna, lengan: c.lengan, ref: inv.noInvoiceVendor || inv.id, roll: notArrived, pcs: 0, sejak: delivered },
          slaDays("DELIVERY_TO_RECEIVE")
        );
      const oldest = waitingRest.filter(Boolean).sort()[0];
      if (oldest)
        push(
          { key: `rest|${inv.id}|${key}`, area: "Produksi", kendala: "Roll diterima belum Resting", sla: "RECEIVE_TO_RESTING", mrpId: inv.mrpId, vendorProduksi: inv.destinationVendor, supplier: inv.supplier, warna: c.warna, lengan: c.lengan, ref: inv.noInvoiceVendor || inv.id, roll: waitingRest.length, pcs: 0, sejak: oldest },
          slaDays("RECEIVE_TO_RESTING")
        );
    }
  }

  // ---- Produksi per roll ----
  const shippedByBatch = new Map<string, number>();
  for (const k of input.kolis) {
    if (!k.deliveredAt) continue;
    for (const it of k.items) if (it.sourceBatchId && isBillableKoliItem(it)) shippedByBatch.set(it.sourceBatchId, (shippedByBatch.get(it.sourceBatchId) ?? 0) + it.qty);
    for (const id of k.sourceBatchIds ?? []) shippedByBatch.set(id, Number.POSITIVE_INFINITY);
  }
  for (const b of input.batches) {
    const base = { mrpId: b.mrpId, vendorProduksi: b.vendorProduksi, supplier: "", warna: b.warna, lengan: b.lengan, ref: b.codeRoll || b.id, roll: 1 };
    const resting = dayKey(b.restingAt);
    const cutting = dayKey(b.cuttingAt);
    const closed = dayKey(b.closedAt);
    if (resting && !cutting) push({ ...base, key: `cut|${b.id}`, area: "Produksi", kendala: "Resting belum Cutting", sla: "RESTING_TO_CUTTING", pcs: 0, sejak: resting }, slaDays("RESTING_TO_CUTTING"));
    if (cutting && !closed) push({ ...base, key: `fg|${b.id}`, area: "Produksi", kendala: "Cutting belum Done FG", sla: "CUTTING_TO_DONE_FG", pcs: sumQty(b.sizeQty) - sumQty(b.fgSizeQty), sejak: cutting }, slaDays("CUTTING_TO_DONE_FG"));
    if (closed) {
      const basis = sumQty(b.fgSizeQty);
      const sisa = basis - Math.min(shippedByBatch.get(b.id) ?? 0, basis);
      if (sisa > 0) push({ ...base, key: `ship|${b.id}`, area: "Pengiriman", kendala: "Done FG belum Delivery", sla: "DONE_FG_TO_DELIVERY", pcs: sisa, sejak: closed }, slaDays("DONE_FG_TO_DELIVERY"));
    }
  }

  // ---- Pengiriman: koli sudah dikirim, belum GR DC (Bongkar Warehouse) ----
  const receivedKoli = new Set(input.receipts.flatMap((r) => r.koliIds));
  for (const k of input.kolis) {
    const sent = dayKey(k.deliveredAt);
    if (!sent || receivedKoli.has(k.id)) continue;
    const pcs = k.items.filter(isBillableKoliItem).reduce((s, it) => s + it.qty, 0);
    push(
      { key: `gr|${k.id}`, area: "Pengiriman", kendala: "Delivery belum GR DC", sla: "DELIVERY_TO_GR_DC", mrpId: k.mrpId, vendorProduksi: k.vendorProduksi, supplier: "", warna: Array.from(new Set(k.items.map((i) => i.warna))).join(", "), ref: `${k.noResi || "-"} · koli ${k.noKoli}`, roll: 0, pcs, sejak: sent },
      ltTiba(k.vendorProduksi)
    );
  }
  return out.sort((a, b) => b.lewat - a.lewat);
}

// ---- Yield per roll ----
export type RollYieldRow = {
  key: string;
  mrpId: string;
  vendorProduksi: string;
  warna: string;
  lengan: Lengan;
  codeRoll: string;
  gramasi: number;
  target: number;
  cutting: number;
  fg: number;
  closed: boolean;
  cuttingAt?: string;
};

/** Yield per roll: hasil cutting dibanding target roll (`targetSizesForBatch`, sama dengan Yield Alert Produksi) dan Finish Good dibanding hasil
 *  cutting (roll yang sudah ditutup). Hanya roll yang sudah dicutting. */
export function buildRollYields(batches: ProductionBatch[], mrpDetails: MrpDetail[]): RollYieldRow[] {
  const out: RollYieldRow[] = [];
  for (const b of batches) {
    if (!b.cuttingAt || !b.sizeQty) continue;
    const detail = mrpDetailFor(b.mrpId, mrpDetails);
    const target = sumQty(targetSizesForBatch(b, detail?.aduanRows ?? []));
    out.push({
      key: b.id,
      mrpId: b.mrpId,
      vendorProduksi: b.vendorProduksi,
      warna: b.warna,
      lengan: b.lengan,
      codeRoll: b.codeRoll || "",
      gramasi: b.gramasi,
      target,
      cutting: sumQty(b.sizeQty),
      fg: sumQty(b.fgSizeQty),
      closed: !!b.closedAt,
      cuttingAt: dayKey(b.cuttingAt),
    });
  }
  return out;
}

/** Yield gabungan (tertimbang): jumlah hasil / jumlah target. */
export const yieldPct = (num: number, den: number) => (den > 0 ? (num / den) * 100 : null);
