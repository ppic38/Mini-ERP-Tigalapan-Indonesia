import type { CorrectionAction } from "@/components/sysadmin/correction-dialog";
import type { Lengan, MaklonPO, ProductionBatch, RawMaterialInvoice } from "@/lib/mrp/types";
import { sysadminUndoRollArrivalAction } from "@/lib/mrp/sysadminActions";
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
