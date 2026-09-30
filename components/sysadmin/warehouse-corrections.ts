import type { CorrectionAction } from "@/components/sysadmin/correction-dialog";
import { formatRupiah } from "@/lib/mrp/derive";
import type { WarehouseReceipt } from "@/lib/mrp/types";
import { sysadminUndoWarehouseReceiptAction } from "@/lib/mrp/sysadminActions";

// Daftar koreksi Sysadmin untuk modul Warehouse (owner 2026-09-30). Sama seperti modul lain: teks di sini
// untuk UI, server (lib/mrp/sysadminActions.ts) yang memutuskan.

/** "Batalkan bongkar koli" untuk 1 penerimaan di Riwayat Penerimaan: resi kembali ke daftar Penerimaan. */
export function warehouseReceiptCorrections(receipt: WarehouseReceipt): CorrectionAction[] {
  const totalNilai = receipt.items.reduce((s, it) => s + it.qty * it.hppPerItem, 0);
  return [
    {
      key: "undo-receipt",
      label: "Batalkan bongkar koli",
      danger: true,
      title: `Batalkan bongkar koli ${receipt.resiGroupId}`,
      impact: [
        `Penerimaan ${receipt.id} (${receipt.koliIds.length} koli, ${receipt.items.length} item, nilai ${formatRupiah(totalNilai)}) dihapus dari Riwayat.`,
        "Resi kembali muncul di Penerimaan; Warehouse bisa membongkar ulang.",
        "HPP per item disimpan sebagai snapshot saat dibongkar — pembongkaran ulang mengambil snapshot BARU dari HPP live saat itu, bukan angka lama.",
        "Data lama tercatat lengkap di Log Audit. Warehouse, Finance, dan Produksi menerima notifikasi.",
      ],
      confirmLabel: "Batalkan bongkar koli",
      confirmText: receipt.resiGroupId,
      run: (reason) => sysadminUndoWarehouseReceiptAction(receipt.id, reason),
    },
  ];
}
