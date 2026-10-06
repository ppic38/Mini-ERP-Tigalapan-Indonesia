import type { CorrectionAction } from "@/components/sysadmin/correction-dialog";
import type { DeliveryKoli, Lengan, MaklonPO, ProductionBatch, ProductionGroupMeta, ProductionResult, RawMaterialInvoice, VendorInvoice, VendorInvoiceAdjustment, WarehouseReceipt } from "@/lib/mrp/types";
import {
  sysadminDeleteKoliAction,
  sysadminDeleteVendorInvoiceAdjustmentAction,
  sysadminRevertVendorInvoiceStatusAction,
  sysadminUndoKoliShipmentAction,
  sysadminUndoReworkAction,
  sysadminUndoRollArrivalAction,
  sysadminVoidVendorInvoiceAction,
} from "@/lib/mrp/sysadminActions";
import { sysadminReopenRollAction, sysadminUndoFgConfirmAction, sysadminUndoFinalAction } from "@/lib/mrp/actions";

// Daftar koreksi Sysadmin untuk portal Vendor Produksi (owner 2026-09-30). Sama seperti modul lain:
// aturan di sini hanya untuk UI (tombol nonaktif + alasan), server yang memutuskan.

const WAITING_MATERIAL: MaklonPO["status"][] = ["FULL_WAITING_MATERIAL", "PARTIAL_WAITING_MATERIAL"];

/** "Batalkan Terima" 1 roll di Good Receive: roll kembali belum diterima. Diblokir kalau roll sudah
 *  ditimbang di Cutting atau PO Produksi vendor itu sudah mulai produksi (cermin
 *  sysadminUndoRollArrivalAction). */
export function rollArrivalCorrections(args: {
  invoice: RawMaterialInvoice;
  warna: string;
  lengan: Lengan;
  rollIndex: number;
  vendorId: string;
  maklonPOs: MaklonPO[];
}): CorrectionAction[] {
  const { invoice, warna, lengan, rollIndex, vendorId, maklonPOs } = args;
  const weighed = !!invoice.rollReceipts[`${warna}|${lengan}`]?.[rollIndex];
  const startedPo = maklonPOs.find((p) => p.mrpId === invoice.mrpId && p.vendorProduksi === vendorId && !WAITING_MATERIAL.includes(p.status));
  let block: string | undefined;
  if (weighed) block = "Sudah ditimbang di Cutting — tidak bisa dibatalkan";
  else if (startedPo) block = `PO Produksi ${startedPo.id} sudah mulai produksi — tidak bisa dibatalkan`;
  return [
    {
      key: "undo-arrival",
      label: "Batalkan terima",
      disabledReason: block,
      title: `Batalkan penerimaan Roll ${rollIndex + 1} · ${warna} · ${lengan === "PENDEK" ? "Pendek" : "Panjang"}`,
      impact: [
        "Roll kembali berstatus belum diterima; code roll-nya dikosongkan (code lot tidak berubah).",
        "Vendor bisa menerima roll ini lagi dengan code roll yang benar.",
        "Kalau ini satu-satunya roll yang sudah diterima di invoice, status invoice kembali ke Delivery.",
        "Vendor dan Procurement menerima notifikasi.",
      ],
      confirmLabel: "Batalkan penerimaan",
      run: (reason) => sysadminUndoRollArrivalAction({ invoiceId: invoice.id, warna, lengan, rollIndex }, reason),
    },
  ];
}

// ---------------------------------------------------------------------------------------------
// Finish Good & Final Produksi (owner 2026-09-30). Sysadmin melakukan atas nama vendor langkah "undo"
// yang SUDAH dimiliki vendor, dengan aturan pengaman yang sama (server memakai inti fungsi yang sama).
// Kalau tombol nonaktif/ditolak karena rework/waste atau roll sudah masuk koli, langkah berikutnya yang
// menahan harus dikoreksi dulu (Rework: batalkan; Pengiriman: keluarkan dari koli).
// ---------------------------------------------------------------------------------------------

/** "Buka lagi" 1 roll yang sudah ditutup (Tutup Roll). Kosong kalau roll belum ditutup. */
export function rollReopenCorrections(b: ProductionBatch, groupFinalDone: boolean): CorrectionAction[] {
  if (!b.closedAt) return [];
  return [
    {
      key: "reopen-roll",
      label: "Buka lagi",
      disabledReason: groupFinalDone ? "Grup sudah Final Produksi — buka kunci Final dulu" : undefined,
      title: `Buka lagi roll ${b.codeRoll ?? b.id} · ${b.warna}`,
      impact: [
        "Roll kembali terbuka; Finish Good yang sudah tersimpan tetap utuh, vendor bisa melanjutkan/mengoreksi lalu Tutup Roll lagi.",
        "Ditolak server kalau roll sudah masuk koli pengiriman, atau reject grup sudah dirework/dibuang (aturan sama seperti tombol vendor).",
        "Reject grup dihitung ulang kalau grupnya sudah Selesai Produksi. Vendor menerima notifikasi.",
      ],
      confirmLabel: "Buka lagi roll",
      run: (reason) => sysadminReopenRollAction(b.id, reason),
    },
  ];
}

/** Buka kunci "Selesai Produksi" (tahap 1, Finish Good) grup warna·lengan. */
export function fgConfirmCorrections(args: { groupKey: string; warna: string; lengan: Lengan; isFinalDone: boolean }): CorrectionAction[] {
  const { groupKey, warna, lengan, isFinalDone } = args;
  return [
    {
      key: "undo-fg-confirm",
      label: "Buka kunci Finish Good",
      disabledReason: isFinalDone ? "Grup sudah Final Produksi — buka kunci Final dulu" : undefined,
      title: `Buka kunci Selesai Produksi ${warna} · ${lengan === "PENDEK" ? "Pendek" : "Panjang"}`,
      impact: [
        "Kunci Finish Good grup dibuka: input FG bisa dilanjutkan; roll yang ditutup saat konfirmasi (dan belum masuk koli) dibuka lagi.",
        "Reject otomatis grup dihapus dan dihitung ulang saat vendor menandai Selesai lagi.",
        "Ditolak server kalau reject grup sudah dirework/dibuang (aturan sama seperti tombol vendor). Vendor menerima notifikasi.",
      ],
      confirmLabel: "Buka kunci",
      run: (reason) => sysadminUndoFgConfirmAction(groupKey, reason),
    },
  ];
}

/** Buka kunci Final Produksi (tahap 2). Ditolak server kalau PO Produksi-nya sudah ditutup (Close PO). */
export function finalUndoCorrections(args: { groupKey: string; warna: string; lengan: Lengan }): CorrectionAction[] {
  const { groupKey, warna, lengan } = args;
  return [
    {
      key: "undo-final",
      label: "Buka kunci Final",
      title: `Buka kunci Final Produksi ${warna} · ${lengan === "PENDEK" ? "Pendek" : "Panjang"}`,
      impact: [
        "Kunci Final Produksi grup dibuka; Finish Good/Reject/Rework bisa dikoreksi lagi (mulai dari tab Finish Good).",
        "Ditolak kalau PO Produksi-nya sudah ditutup (Close PO) — buka lagi PO-nya dulu.",
        "Vendor menerima notifikasi.",
      ],
      confirmLabel: "Buka kunci Final",
      run: (reason) => sysadminUndoFinalAction(groupKey, reason),
    },
  ];
}

// ---------------------------------------------------------------------------------------------
// Pengiriman (owner 2026-09-30). Vendor tidak bisa membatalkan resi yang salah setelah terkirim dan
// tidak bisa menghapus koli -- dua koreksi Sysadmin ini mengisi celah itu.
// ---------------------------------------------------------------------------------------------

/** "Batalkan pengiriman" 1 grup resi: semua koli di grup kembali ke "belum ada ekspedisi". Diblokir kalau
 *  sudah diinvoice, sudah dibongkar Warehouse, atau sudah dikonfirmasi WMS (cermin
 *  sysadminUndoKoliShipmentAction). */
export function koliShipmentCorrections(kolis: DeliveryKoli[], warehouseReceipts: WarehouseReceipt[]): CorrectionAction[] {
  if (kolis.length === 0) return [];
  const first = kolis[0];
  const ids = new Set(kolis.map((k) => k.id));
  let block: string | undefined;
  if (kolis.some((k) => k.resiInvoicedAt)) block = "Sudah diajukan invoice — kembalikan/revisi invoice vendornya dulu di Procurement";
  else if (warehouseReceipts.some((r) => r.koliIds.some((id) => ids.has(id)))) block = "Sudah dibongkar Warehouse — Batalkan bongkar koli dulu";
  else if (kolis.some((k) => k.wmsReceivedAt)) block = "Sudah dikonfirmasi diterima di WMS";
  const label = kolis.map((k) => k.noKoli || k.id).join(", ");
  return [
    {
      key: "undo-shipment",
      label: "Batalkan pengiriman",
      danger: true,
      disabledReason: block,
      title: `Batalkan pengiriman resi ${first.noResi ?? "—"}`,
      impact: [
        `Semua koli di resi ini (${label}) kembali ke “Belum ada ekspedisi”: ekspedisi, no resi, catatan, dan berat dikosongkan.`,
        "Vendor bisa Set Ekspedisi & Resi ulang dengan data yang benar. Foto lampiran lama tidak dihapus (ditimpa upload berikutnya, tidak ditampilkan lagi).",
        "Hanya untuk resi yang belum diinvoice, belum dibongkar Warehouse, dan belum dikonfirmasi WMS. Data lama tercatat di Log Audit.",
        "Vendor dan Warehouse menerima notifikasi.",
      ],
      confirmLabel: "Batalkan pengiriman",
      confirmText: first.noResi || undefined,
      run: (reason) => sysadminUndoKoliShipmentAction(first.id, reason),
    },
  ];
}

/** "Hapus koli" untuk koli yang BELUM dikirim (salah isi/kosong). */
export function koliDeleteCorrections(k: DeliveryKoli): CorrectionAction[] {
  return [
    {
      key: "delete-koli",
      label: "Hapus koli",
      danger: true,
      disabledReason: k.deliveredAt ? "Koli sudah dikirim — batalkan pengiriman resinya dulu" : undefined,
      title: `Hapus koli ${k.noKoli || k.id}`,
      impact: [
        "PERMANEN. Koli dan isinya dihapus; roll/item di dalamnya kembali tersedia untuk koli baru.",
        "Hanya untuk koli yang belum dikirim. Isi koli tercatat di Log Audit. Vendor menerima notifikasi.",
      ],
      confirmLabel: "Hapus koli",
      confirmText: k.noKoli || undefined,
      run: (reason) => sysadminDeleteKoliAction(k.id, reason),
    },
  ];
}

// ---------------------------------------------------------------------------------------------
// Rework & invoice vendor (owner 2026-09-30). Vendor tidak punya cara membatalkan rework yang salah;
// Procurement tidak punya cara memundurkan invoice vendor yang salah disetujui atau menghapus item
// denda/reward yang salah input.
// ---------------------------------------------------------------------------------------------

/** "Batalkan rework" untuk 1 baris Riwayat rework (baris FG hasil rework). Diblokir kalau grup asal/tujuan
 *  sudah Final Produksi (cermin sysadminUndoReworkAction); pengecekan "sudah masuk koli" dan pasangan
 *  reject dilakukan server. */
export function reworkUndoCorrections(r: ProductionResult, groupMeta: ProductionGroupMeta[]): CorrectionAction[] {
  const fromLengan = (r.note ?? "").match(/^Rework dari (\S+) size/)?.[1];
  const sourceKey = fromLengan ? `${r.mrpId}|${r.warna}|${fromLengan}` : undefined;
  const finalDone = groupMeta.some((g) => !!g.doneAt && (g.groupKey === r.groupKey || g.groupKey === sourceKey));
  const qty = Object.values(r.sizeQty).reduce((a, b) => a + b, 0);
  return [
    {
      key: "undo-rework",
      label: "Batalkan rework",
      danger: true,
      disabledReason: finalDone ? "Grup asal/tujuan sudah Final Produksi — buka kunci Final dulu" : undefined,
      title: `Batalkan rework ${qty} pcs ${r.warna} · ${r.lengan}`,
      impact: [
        "Kedua catatan rework dihapus (pengurangan di reject asal dan penambahan FG di tujuan); sisa reject grup asal kembali utuh.",
        "Vendor bisa rework ulang dengan size/lengan yang benar.",
        "Ditolak kalau hasil rework sudah masuk koli pengiriman, atau pasangan catatannya tidak ditemukan pasti. Vendor menerima notifikasi.",
      ],
      confirmLabel: "Batalkan rework",
      run: (reason) => sysadminUndoReworkAction(r.id, reason),
    },
  ];
}

/** Mundurkan status invoice vendor (APPROVED/REVISION -> menunggu review). PAID dibatalkan dulu di Finance. */
export function vendorInvoiceStatusCorrections(inv: VendorInvoice): CorrectionAction[] {
  if (inv.status === "SUBMITTED") return [];
  return [
    {
      key: "revert-invoice-status",
      label: "Kembalikan ke menunggu review",
      disabledReason: inv.status === "PAID" ? "Sudah dibayar — Batalkan pembayaran dulu di Finance (Payment Maklon)" : undefined,
      title: `Kembalikan status invoice ${inv.id}`,
      impact: [
        `Status invoice dari ${inv.status} kembali ke menunggu review (SUBMITTED); persetujuan dibatalkan.`,
        "Procurement bisa menambah/menghapus denda-reward lalu menyetujui ulang. Invoice hilang dari antrean Payment Finance sampai disetujui lagi.",
        "Procurement, Finance, dan vendor menerima notifikasi.",
      ],
      confirmLabel: "Kembalikan status",
      run: (reason) => sysadminRevertVendorInvoiceStatusAction(inv.id, reason),
    },
  ];
}

/** Hapus 1 item denda/reward yang salah input -- hanya selagi invoice belum disetujui. */
export function invoiceAdjustmentCorrections(inv: VendorInvoice, adj: VendorInvoiceAdjustment): CorrectionAction[] {
  const label = adj.kind === "DENDA" ? "denda" : adj.kind === "REWARD" ? "reward" : "catatan";
  return [
    {
      key: "delete-adjustment",
      label: "Hapus",
      danger: true,
      disabledReason: inv.status === "APPROVED" || inv.status === "PAID" ? "Invoice sudah disetujui/dibayar — kembalikan ke menunggu review dulu" : undefined,
      title: `Hapus item ${label} “${adj.label}”`,
      impact: [
        `Item ${label} “${adj.label}” dihapus dari invoice ${inv.id}; nilai akhir invoice dihitung ulang tanpa item ini.`,
        "Hanya selagi invoice belum disetujui. Item lama tercatat di Log Audit. Procurement dan vendor menerima notifikasi.",
      ],
      confirmLabel: "Hapus item",
      run: (reason) => sysadminDeleteVendorInvoiceAdjustmentAction(adj.id, reason),
    },
  ];
}

/** Batalkan invoice vendor yang salah dibuat (owner 2026-10-06) -- grup pengiriman asal direset supaya
 *  vendor bisa submit ulang. Hanya sebelum disetujui; server memeriksa ulang (termasuk kecocokan grup). */
export function vendorInvoiceVoidCorrections(inv: VendorInvoice): CorrectionAction[] {
  const block = inv.status !== "SUBMITTED" && inv.status !== "REVISION" ? "Sudah disetujui/dibayar — kembalikan statusnya dulu" : undefined;
  return [
    {
      key: "void-vendor-invoice",
      label: "Batalkan invoice",
      danger: true,
      disabledReason: block,
      title: `Batalkan invoice vendor ${inv.id}`,
      impact: [
        "Invoice dihapus, dan grup pengiriman asalnya bisa diajukan invoice-nya lagi oleh vendor dari halaman Pengiriman.",
        "Hanya kalau grup asal bisa ditentukan pasti dan belum dibongkar Warehouse.",
        "Procurement dan vendor menerima notifikasi.",
      ],
      confirmLabel: "Batalkan invoice",
      confirmText: inv.id,
      run: (reason) => sysadminVoidVendorInvoiceAction(inv.id, reason),
    },
  ];
}
