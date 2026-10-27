import type { FlowState } from "./store";
import type { AduanPolaRow, LenganGroup } from "./types";

/** Grup warna·lengan versi vendor: satu grup bisa dikerjakan beberapa vendor dan `sizes`/`totalQty`/rib/kerah/manset/roll aslinya memuat SEMUA vendor.
 *  Untuk vendor, isinya dipotong ke bagian vendor itu sendiri: size dan qty dari Aduan Pola-nya, sedangkan rib, kerah, manset, dan estimasi roll dikali porsi qty-nya
 *  (rasio kg per roll tetap sama). Kode vendor default hanya dipertahankan kalau milik vendor itu. */
function scopeGroupToVendor(g: LenganGroup, mine: AduanPolaRow[], vendorId: string): LenganGroup {
  const bySize = new Map<string, number>();
  for (const a of mine) for (const x of a.sizes) bySize.set(x.size, (bySize.get(x.size) ?? 0) + x.qty);
  const mineQty = mine.reduce((sum, a) => sum + a.qty, 0);
  const share = g.totalQty > 0 ? Math.min(1, mineQty / g.totalQty) : 1;
  return {
    ...g,
    sizes: Array.from(bySize, ([size, qty]) => ({ size, qty })),
    totalQty: mineQty,
    ribKg: g.ribKg * share,
    kerahKg: g.kerahKg * share,
    mansetKg: g.mansetKg * share,
    rollEstimate: g.rollEstimate * share,
    vendorDefault: g.vendorDefault === vendorId ? g.vendorDefault : "",
  };
}

/** ISOLASI ANTAR VENDOR (owner 2026-10-24: "jangan sampai ada bocor data dari satu vendor ke vendor lain").
 *  Snapshot dari database memuat SEMUA vendor; sesi vendor murni hanya boleh menerima data vendornya sendiri, jadi layar vendor
 *  tidak pernah menampilkan (dan vendor tidak bisa keliru mengoperasikan) data vendor lain. Dipanggil di getFlowSnapshotAction.
 *  Yang tetap ada: baris MRP (judul, minggu, tanggal) dengan qty vendor itu saja, grup lengan yang dirujuk baris Aduan Pola vendor itu sendiri (dipotong ke
 *  bagian vendor itu, lihat `scopeGroupToVendor`), master non-vendor (entitas, supplier, tarif ekspedisi). */
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
      const lenganGroups = d.lenganGroups.filter((g) => groupIds.has(g.id)).map((g) => scopeGroupToVendor(g, aduanRows.filter((a) => a.lenganGroupId === g.id), vendorId));
      // Total qty MRP (semua vendor) tidak ikut: yang tersisa hanya qty vendor ini.
      return { ...d, mrp: { ...d.mrp, qty: aduanRows.reduce((sum, a) => sum + a.qty, 0) }, aduanRows, lenganGroups, materialRows: [] };
    });

  return {
    ...state,
    mrpDetails,
    staticMrps: state.staticMrps
      .filter((m) => mrpIdsMine.has(m.id))
      .map((m) => {
        const mine = maklonPOs.filter((p) => p.mrpId === m.id).reduce((sum, p) => sum + p.qty, 0);
        return mine > 0 ? { ...m, qty: mine } : m;
      }),
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

/** Nama pelaku di portal vendor (akun utama/anggota tim, migration 0078) hanya untuk vendor itu sendiri dan Sysadmin: modul internal lain tidak
 *  menerimanya, jadi tidak ada di snapshot yang sampai ke browser mereka. */
export function stripVendorActorNames<T extends FlowState>(state: T, keepVendorId?: string): T {
  // `keepVendorId`: sesi yang SEKALIGUS login sebagai vendor itu (satu browser, dua login) tetap menerima nama pelaku baris vendornya sendiri,
  // supaya kolom PIC di portal vendor terisi; nama baris vendor lain tetap dibuang.
  const keep = (vendor: string | null | undefined) => !!keepVendorId && vendor === keepVendorId;
  return {
    ...state,
    deliveryKolis: state.deliveryKolis.map((k) => (keep(k.vendorProduksi) ? k : { ...k, createdBy: undefined, shippedBy: undefined })),
    productionBatches: state.productionBatches.map((b) => (keep(b.vendorProduksi) ? b : { ...b, restingBy: undefined, cuttingBy: undefined, fgBy: undefined, closedBy: undefined })),
    vendorInvoices: state.vendorInvoices.map((v) => (keep(v.vendorProduksi) ? v : { ...v, submittedBy: undefined })),
    invoices: state.invoices.map((i) =>
      keep(i.destinationVendor)
        ? i
        : {
            ...i,
            rollArrivals: Object.fromEntries(Object.entries(i.rollArrivals).map(([key, arr]) => [key, arr.map((a) => (a ? { ...a, receivedBy: undefined } : a))])),
          }
    ),
  };
}
