import type { CorrectionAction } from "@/components/sysadmin/correction-dialog";
import type { PoApprovalEntry } from "@/lib/mrp/poApproval";
import type { MaklonPO, MaterialPO, RawMaterialInvoice } from "@/lib/mrp/types";
import {
  sysadminCancelMaklonPoAction,
  sysadminCancelMaterialPoAction,
  sysadminRecallMaterialPoAction,
  sysadminRevertInvoiceDeliveryAction,
  sysadminRevertPoApprovalStepAction,
} from "@/lib/mrp/sysadminActions";

// Daftar koreksi Sysadmin untuk modul Procurement (owner 2026-09-29: "mulai dari modul Procurement
// dulu"). Aturan boleh/tidak di sini HANYA untuk UI (tombol nonaktif + alasan) -- server
// (lib/mrp/sysadminActions.ts) memeriksa ulang semuanya dan itulah yang memutuskan. Pola: "Kembalikan"
// = mundur ke keadaan sebelum langkah itu supaya user bisa mengulang; "Batalkan" = permanen.

/** Alasan approval PO tidak bisa dimundurkan, atau undefined kalau bisa (cermin
 *  sysadminRevertPoApprovalStepAction). */
function revertApprovalBlock(p: { approved: boolean; approvalLevel?: number; approvalLog?: PoApprovalEntry[] }): string | undefined {
  if (p.approved) return "PO sudah final disetujui — tidak bisa dimundurkan (sudah memicu efek lain)";
  if (p.approvalLevel == null) return "PO lama tanpa matriks approval — tidak ada langkah untuk dimundurkan";
  const last = p.approvalLog?.[p.approvalLog.length - 1];
  if (!last) return "Belum ada riwayat approval";
  if (last.action !== "APPROVED") return "Langkah terakhir bukan persetujuan (penolakan) — pakai “Ajukan ulang” di portal Procurement";
  return undefined;
}

const REVERT_APPROVAL_IMPACT = [
  "Persetujuan terakhir dibatalkan; PO kembali menunggu approval pada langkah itu.",
  "Hanya 1 langkah mundur, dan hanya selama PO belum final disetujui.",
  "Modul yang persetujuannya dibatalkan + Procurement menerima notifikasi.",
];

export function materialPoCorrections(p: MaterialPO): CorrectionAction[] {
  const cancelled = p.status === "CANCELLED";
  return [
    {
      key: "recall",
      label: "Tarik kembali",
      disabledReason: cancelled ? "PO sudah dibatalkan" : p.invoicedRolls > 0 ? "Sudah pernah diinvoice (Paying Voucher) — tidak aman ditarik kembali" : undefined,
      title: `Tarik kembali ${p.id}`,
      impact: [
        "PO dibatalkan dan keluar dari antrean approval & Finance.",
        "Baris material terkait dilepas: warnanya muncul lagi di “MRP tanpa PO” untuk dikirim ulang dengan supplier/vendor yang benar.",
        "Hanya untuk PO yang belum pernah diinvoice. Procurement & Finance menerima notifikasi.",
      ],
      confirmLabel: "Tarik kembali PO",
      run: (reason) => sysadminRecallMaterialPoAction(p.id, reason),
    },
    {
      key: "revert-approval",
      label: "Mundurkan approval",
      disabledReason: revertApprovalBlock(p),
      title: `Mundurkan approval ${p.id}`,
      impact: REVERT_APPROVAL_IMPACT,
      confirmLabel: "Mundurkan approval",
      run: (reason) => sysadminRevertPoApprovalStepAction("MATERIAL", p.id, reason),
    },
    {
      key: "cancel",
      label: "Batalkan",
      danger: true,
      disabledReason: cancelled ? "PO sudah dibatalkan" : undefined,
      title: `Batalkan ${p.id}`,
      impact: [
        "PERMANEN. PO hanya dikeluarkan dari daftar aktif, approval, dan Finance.",
        "Roll/invoice bahan yang sudah tercatat TIDAK dibongkar (data historis/HPP tetap utuh).",
        "Baris material TIDAK dilepas — kalau PO perlu dikirim ulang, pakai “Tarik kembali” (untuk PO yang belum diinvoice).",
      ],
      confirmLabel: "Batalkan PO",
      confirmText: p.id,
      run: (reason) => sysadminCancelMaterialPoAction(p.id, reason),
    },
  ];
}

export function maklonPoCorrections(p: MaklonPO): CorrectionAction[] {
  const closed = !!p.closedAt;
  return [
    {
      key: "revert-approval",
      label: "Mundurkan approval",
      disabledReason: revertApprovalBlock(p),
      title: `Mundurkan approval ${p.id}`,
      impact: REVERT_APPROVAL_IMPACT,
      confirmLabel: "Mundurkan approval",
      run: (reason) => sysadminRevertPoApprovalStepAction("MAKLON", p.id, reason),
    },
    {
      key: "cancel",
      label: "Batalkan",
      danger: true,
      disabledReason: closed ? "PO sudah ditutup/dibatalkan" : undefined,
      title: `Batalkan ${p.id}`,
      impact: [
        "PERMANEN. PO ditutup: tidak ada lagi produksi/pengiriman baru untuk PO ini.",
        "Finish Good/koli yang sudah ada tidak dibongkar.",
        "Vendor produksi, Procurement, dan Finance menerima notifikasi.",
      ],
      confirmLabel: "Batalkan PO",
      confirmText: p.id,
      run: (reason) => sysadminCancelMaklonPoAction(p.id, reason),
    },
  ];
}

/** "Kembalikan Delivery" untuk 1 batch invoice (Material Tracking). Hanya batch berstatus DELIVERY yang
 *  bisa dikembalikan ke PAID (batal “Set Delivery”); status lain punya alasan terpisah. */
export function invoiceDeliveryCorrections(inv: RawMaterialInvoice): CorrectionAction[] {
  let block: string | undefined;
  if (inv.status === "PAID") block = "Belum di-Set Delivery";
  else if (inv.status !== "DELIVERY") block = "Vendor sudah mulai menerima roll — tidak bisa dikembalikan dari sini";
  return [
    {
      key: "revert-delivery",
      label: "Kembalikan Delivery",
      disabledReason: block,
      title: `Kembalikan status Delivery ${inv.kodeTransaksi || inv.id}`,
      impact: [
        "Status batch kembali ke Paid (Set Delivery dibatalkan); tanggal delivery dikosongkan.",
        "Batch hilang dari Good Receive vendor sampai Procurement Set Delivery ulang.",
        "Procurement dan vendor tujuan menerima notifikasi.",
      ],
      confirmLabel: "Kembalikan ke Paid",
      run: (reason) => sysadminRevertInvoiceDeliveryAction([inv.id], reason),
    },
  ];
}
