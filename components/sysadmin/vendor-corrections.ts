import type { CorrectionAction } from "@/components/sysadmin/correction-dialog";
import type { Lengan, MaklonPO, RawMaterialInvoice } from "@/lib/mrp/types";
import { sysadminUndoRollArrivalAction } from "@/lib/mrp/sysadminActions";

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
