import type { FlowState } from "./store";

/** ISOLASI ANTAR VENDOR (owner 2026-10-24: "jangan sampai ada bocor data dari satu vendor ke vendor lain").
 *  Snapshot dari database memuat SEMUA vendor; sesi vendor murni hanya boleh menerima data vendornya sendiri, jadi layar vendor
 *  tidak pernah menampilkan (dan vendor tidak bisa keliru mengoperasikan) data vendor lain. Dipanggil di getFlowSnapshotAction.
 *  Yang tetap utuh: baris MRP (judul, minggu, tanggal) dan grup lengan yang dirujuk baris Aduan Pola vendor itu sendiri, master
 *  non-vendor (entitas, supplier, tarif ekspedisi). */
export function scopeStateToVendor<T extends FlowState>(state: T, vendorId: string): T {
  const isMine = (v: string | null | undefined) => v === vendorId;

  const maklonPOs = state.maklonPOs.filter((p) => isMine(p.vendorProduksi));
  const materialPOs = state.materialPOs.filter((p) => isMine(p.vendorProduksi));
  const invoices = state.invoices.filter((i) => isMine(i.destinationVendor));
  const maklonInvoices = state.maklonInvoices.filter((i) => isMine(i.vendorProduksi));
  const productionBatches = state.productionBatches.filter((b) => isMine(b.vendorProduksi));
  const productionResults = state.productionResults.filter((r) => isMine(r.vendorProduksi));
  const productionGroupMeta = state.productionGroupMeta.filter((m) => isMine(m.vendorProduksi));
  const deliveryKolis = state.deliveryKolis.filter((k) => isMine(k.vendorProduksi));
  const vendorInvoices = state.vendorInvoices.filter((i) => isMine(i.vendorProduksi));
  const warehouseReceipts = state.warehouseReceipts.filter((r) => isMine(r.vendorProduksi));

  const invoiceIds = new Set(invoices.map((i) => i.id));
  const poIds = new Set([...maklonPOs.map((p) => p.id), ...materialPOs.map((p) => p.id)]);
  const batchIds = new Set(productionBatches.map((b) => b.id));
  const byInvoiceKey = <V,>(rec: Record<string, V>): Record<string, V> =>
    Object.fromEntries(Object.entries(rec).filter(([key]) => invoiceIds.has(key.split("|")[0])));

  // MRP yang punya jejak vendor ini; baris Aduan Pola dibatasi ke vendor ini, grup lengan ke yang dirujuk baris itu.
  const mrpIdsMine = new Set<string>([
    ...maklonPOs.map((p) => p.mrpId),
    ...materialPOs.map((p) => p.mrpId),
    ...invoices.map((i) => i.mrpId),
    ...productionBatches.map((b) => b.mrpId),
    ...deliveryKolis.map((k) => k.mrpId),
  ]);
  for (const d of state.mrpDetails) if (d.aduanRows.some((a) => isMine(a.vendor))) mrpIdsMine.add(d.mrp.id);
  const mrpDetails = state.mrpDetails
    .filter((d) => mrpIdsMine.has(d.mrp.id))
    .map((d) => {
      const aduanRows = d.aduanRows.filter((a) => isMine(a.vendor));
      const groupIds = new Set(aduanRows.map((a) => a.lenganGroupId));
      return { ...d, aduanRows, lenganGroups: d.lenganGroups.filter((g) => groupIds.has(g.id)), materialRows: [] };
    });

  return {
    ...state,
    mrpDetails,
    staticMrps: state.staticMrps.filter((m) => mrpIdsMine.has(m.id)),
    materialPOs,
    maklonPOs,
    invoices,
    maklonInvoices,
    productionBatches,
    productionResults,
    productionGroupMeta,
    deliveryKolis,
    vendorInvoices,
    warehouseReceipts,
    notifications: state.notifications.filter((n) => n.audience.includes("vendorMaklon") && (!n.vendorId || n.vendorId === vendorId)),
    rejectRemarks: Object.fromEntries(Object.entries(state.rejectRemarks).filter(([poId]) => poIds.has(poId))),
    materialClaimResolutions: byInvoiceKey(state.materialClaimResolutions),
    materialClaimReturRequests: byInvoiceKey(state.materialClaimReturRequests),
    materialClaimReturDeliveries: byInvoiceKey(state.materialClaimReturDeliveries),
    materialClaimReturReceipts: byInvoiceKey(state.materialClaimReturReceipts),
    materialClaimAcceptances: byInvoiceKey(state.materialClaimAcceptances),
    materialClaimReplacements: byInvoiceKey(state.materialClaimReplacements),
    materialClaimHistory: state.materialClaimHistory.filter((h) => invoiceIds.has(h.invoiceId) || isMine(h.vendorProduksi)),
    vendorDeposits: [],
    productionYieldResolutions: Object.fromEntries(Object.entries(state.productionYieldResolutions).filter(([batchId]) => batchIds.has(batchId))),
    vendorProduksiList: state.vendorProduksiList.filter((v) => isMine(v.id)),
  };
}
