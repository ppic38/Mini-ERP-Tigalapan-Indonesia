import type { CorrectionAction } from "@/components/sysadmin/correction-dialog";
import type { MrpDetail } from "@/lib/mrp/store";
import type { DeliveryKoli, MaklonInvoice, MaklonPO, MaterialPO, ProductionBatch, RawMaterialInvoice, VendorInvoice } from "@/lib/mrp/types";
import { sysadminDeleteMrpAction } from "@/lib/mrp/actions";
import { sysadminRevertMrpApprovalAction } from "@/lib/mrp/sysadminActions";

// Daftar koreksi Sysadmin untuk modul PPIC (owner 2026-09-30). Sama seperti modul lain: aturan
// boleh/tidak di sini hanya untuk UI (tombol nonaktif + alasan), server yang memutuskan -- server juga
// memeriksa hal yang tidak terlihat di klien (riwayat klaim, pemakaian deposit).

type MrpApprovalData = {
  detail: MrpDetail | undefined;
  materialPOs: MaterialPO[];
  maklonPOs: MaklonPO[];
};

type MrpCorrectionData = MrpApprovalData & {
  invoices: RawMaterialInvoice[];
  vendorInvoices: VendorInvoice[];
  maklonInvoices: MaklonInvoice[];
  productionBatches: ProductionBatch[];
  deliveryKolis: DeliveryKoli[];
};

/** Alasan MRP belum boleh dihapus, atau undefined kalau boleh (cermin sysadminDeleteMrpAction). */
function deleteBlock(mrpId: string, d: MrpCorrectionData): string | undefined {
  const started = d.invoices.find((i) => i.mrpId === mrpId && i.status !== "INVOICED" && i.status !== "WAITING_INVOICE");
  if (started) return `Invoice material ${started.id} sudah ${started.status} — kembalikan dulu (Batalkan pembayaran / Kembalikan Delivery)`;
  if (d.productionBatches.some((b) => b.mrpId === mrpId)) return "Produksi sudah berjalan — MRP tidak bisa dihapus";
  if (d.deliveryKolis.some((k) => k.mrpId === mrpId)) return "Sudah ada koli pengiriman — MRP tidak bisa dihapus";
  const maklonInv = d.maklonInvoices.find((i) => i.mrpId === mrpId && (i.status === "APPROVED" || i.status === "PAID"));
  if (maklonInv) return `Invoice PO Produksi ${maklonInv.id} sudah ${maklonInv.status} — mundurkan dulu`;
  const vendorInv = d.vendorInvoices.find((i) => i.lines.some((l) => l.mrpId === mrpId) && (i.status === "APPROVED" || i.status === "PAID"));
  if (vendorInv) return `Invoice vendor ${vendorInv.id} sudah ${vendorInv.status} — mundurkan dulu`;
  return undefined;
}

/** Koreksi approval SCM atas 1 MRP (dipakai halaman MRP PPIC dan riwayat Approval MRP SCM): MRP yang
 *  sudah disetujui -> "Mundurkan approval SCM", yang ditolak -> "Ajukan ulang ke SCM". Kosong untuk MRP
 *  yang sudah menunggu approval (tidak ada yang dikoreksi) atau MRP demo tanpa detail. */
export function mrpApprovalCorrections(mrpId: string, d: MrpApprovalData): CorrectionAction[] {
  if (!d.detail) return [];
  const approval = d.detail.ppicApproval;
  if (approval !== "PPIC_APPROVED" && approval !== "REJECTED") return [];
  const poCount = d.materialPOs.filter((p) => p.mrpId === mrpId && p.status !== "CANCELLED").length + d.maklonPOs.filter((p) => p.mrpId === mrpId).length;
  const resubmit = approval === "REJECTED";
  return [
    {
      key: "revert-approval",
      label: resubmit ? "Ajukan ulang ke SCM" : "Mundurkan approval SCM",
      disabledReason: approval === "PPIC_APPROVED" && (d.detail.poSent || poCount > 0) ? "Procurement sudah membuat PO — tarik/batalkan PO dulu" : undefined,
      title: `${resubmit ? "Ajukan ulang ke SCM" : "Mundurkan approval SCM"} — ${mrpId}`,
      impact: [
        resubmit ? "Penolakan SCM dihapus; MRP kembali menunggu approval SCM tanpa perlu impor ulang." : "Persetujuan SCM dibatalkan; MRP kembali menunggu approval SCM.",
        "Procurement tidak bisa membuat PO dari MRP ini sampai SCM menyetujui lagi.",
        "Hanya untuk MRP yang belum dibuatkan PO. SCM, PPIC, dan Procurement menerima notifikasi.",
      ],
      confirmLabel: resubmit ? "Ajukan ulang" : "Mundurkan approval",
      run: (reason) => sysadminRevertMrpApprovalAction(mrpId, reason),
    },
  ];
}

export function mrpCorrections(mrpId: string, d: MrpCorrectionData): CorrectionAction[] {
  // MRP demo/statis (tanpa detail) tidak punya data transaksi -- tidak ada yang dikoreksi.
  if (!d.detail) return [];
  const poCount = d.materialPOs.filter((p) => p.mrpId === mrpId && p.status !== "CANCELLED").length + d.maklonPOs.filter((p) => p.mrpId === mrpId).length;
  const invoiceCount = d.invoices.filter((i) => i.mrpId === mrpId).length + d.vendorInvoices.filter((i) => i.lines.some((l) => l.mrpId === mrpId)).length;

  const actions: CorrectionAction[] = [...mrpApprovalCorrections(mrpId, d)];
  actions.push({
    key: "delete",
    label: "Hapus MRP",
    danger: true,
    disabledReason: deleteBlock(mrpId, d),
    title: `Hapus MRP ${mrpId}`,
    impact: [
      "PERMANEN. MRP ini dihapus beserta semua data turunannya: baris warna/aduan, PO material & produksi" + `${poCount > 0 ? ` (${poCount} PO)` : ""}` + ", invoice yang belum dibayar" + `${invoiceCount > 0 ? ` (${invoiceCount} invoice)` : ""}` + ".",
      "Hanya untuk MRP yang belum punya jejak uang atau fisik: invoice belum dibayar, produksi belum jalan, belum ada koli, tanpa klaim/deposit. Selain itu server menolak.",
      "Data lama tercatat di Log Audit. PPIC, SCM, dan Procurement menerima notifikasi. Impor ulang MRP yang benar kalau diperlukan.",
    ],
    confirmLabel: "Hapus MRP",
    confirmText: mrpId,
    run: (reason) => sysadminDeleteMrpAction(mrpId, reason),
  });
  return actions;
}
