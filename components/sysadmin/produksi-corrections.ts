import type { CorrectionAction } from "@/components/sysadmin/correction-dialog";
import { sysadminReopenYieldAlertAction } from "@/lib/mrp/sysadminActions";

// Daftar koreksi Sysadmin untuk modul Produksi (owner 2026-09-30). Halaman Monitoring Produksi,
// Monitoring Reject, dan Kebutuhan Bahan hanya membaca data -- satu-satunya aksi tulis di modul ini
// adalah Yield Alert, jadi koreksinya cuma di sana. Koreksi data produksi sebenarnya (Cutting, Finish
// Good, dst.) ada di portal Vendor Produksi.

/** "Buka lagi" Yield Alert yang sudah ditandai ditindak: kembali "Belum ditindak" supaya Produksi bisa
 *  menindaklanjuti ulang dengan catatan yang benar. */
export function yieldAlertCorrections(args: { batchId: string; mrpId: string; codeRoll?: string }): CorrectionAction[] {
  const { batchId, mrpId, codeRoll } = args;
  return [
    {
      key: "reopen-yield",
      label: "Buka lagi",
      title: `Buka lagi yield alert ${mrpId}${codeRoll ? ` · roll ${codeRoll}` : ""}`,
      impact: [
        "Status alert kembali menjadi “Belum ditindak”; catatan tindak lanjut sebelumnya dihapus (tersimpan di Log Audit).",
        "Produksi bisa menindaklanjuti ulang dengan catatan yang benar.",
        "Hanya penanda alert — tidak mengubah data produksi lain. Produksi menerima notifikasi.",
      ],
      confirmLabel: "Buka lagi alert",
      run: (reason) => sysadminReopenYieldAlertAction(batchId, reason),
    },
  ];
}
