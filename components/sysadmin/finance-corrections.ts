import type { CorrectionAction } from "@/components/sysadmin/correction-dialog";
import { formatRupiah } from "@/lib/mrp/derive";
import type { MaklonInvoice, MaklonPO, RawMaterialInvoice, VendorDepositEntry, VendorInvoice } from "@/lib/mrp/types";
import {
  sysadminDeleteDepositEntryAction,
  sysadminRevertMaklonInvoiceAction,
  sysadminRevertMaterialInvoicePaidAction,
  sysadminRevertVendorInvoicePaidAction,
} from "@/lib/mrp/sysadminActions";

// Daftar koreksi Sysadmin untuk modul Finance (owner 2026-09-29). Sama seperti
// procurement-corrections.ts: aturan boleh/tidak di sini hanya untuk UI, server yang memutuskan.

/** Pembayaran invoice material: PAID -> INVOICED. Dua varian kalau ada deposit yang dipakai untuk
 *  invoice ini: (1) status saja, (2) status + pulihkan saldo deposit -- dipisah jadi 2 tombol supaya
 *  Sysadmin sadar memilih (tidak ada checkbox tersembunyi). Invoice yang belum dibayar tidak
 *  mendapat tombol sama sekali. */
export function materialInvoicePaymentCorrections(inv: RawMaterialInvoice, vendorDeposits: VendorDepositEntry[]): CorrectionAction[] {
  if (inv.status === "INVOICED" || inv.status === "WAITING_INVOICE") return [];
  let block: string | undefined;
  if (inv.sourceClaimId) block = "PV pengganti klaim — pembayarannya terikat ledger deposit klaim";
  else if (inv.status !== "PAID") block = `Sudah berstatus ${inv.status} — kembalikan langkah setelahnya dulu (mis. Kembalikan Delivery di Material Tracking)`;

  const debits = vendorDeposits.filter((d) => d.kind === "DEBIT" && d.sourceInvoiceId === inv.id);
  const debitTotal = debits.reduce((a, d) => a + d.amount, 0);
  const base = [
    "Status invoice kembali ke Invoiced; Finance bisa membayar ulang (upload bukti baru).",
    "Bukti pembayaran lama tidak dihapus — ditimpa saat upload berikutnya.",
    "Finance dan Procurement menerima notifikasi.",
  ];
  const actions: CorrectionAction[] = [
    {
      key: "revert-paid",
      label: "Batalkan pembayaran",
      disabledReason: block,
      title: `Batalkan pembayaran ${inv.kodeTransaksi || inv.id}`,
      impact: debits.length > 0 ? [...base, `Saldo deposit yang sudah terpotong untuk invoice ini (${formatRupiah(debitTotal)}) TIDAK dipulihkan pada tombol ini.`] : base,
      confirmLabel: "Batalkan pembayaran",
      run: (reason) => sysadminRevertMaterialInvoicePaidAction(inv.id, false, reason),
    },
  ];
  if (debits.length > 0) {
    actions.push({
      key: "revert-paid-deposit",
      label: `Batalkan + pulihkan deposit (${formatRupiah(debitTotal)})`,
      disabledReason: block,
      title: `Batalkan pembayaran + pulihkan deposit ${inv.kodeTransaksi || inv.id}`,
      impact: [...base, `Saldo deposit supplier yang terpakai untuk invoice ini (${formatRupiah(debitTotal)}, ${debits.length} baris) dipulihkan, supaya tidak terpotong dua kali saat dibayar ulang.`],
      confirmLabel: "Batalkan & pulihkan deposit",
      run: (reason) => sysadminRevertMaterialInvoicePaidAction(inv.id, true, reason),
    });
  }
  return actions;
}

/** Pembayaran invoice vendor produksi (per pcs): PAID -> APPROVED. */
export function vendorInvoicePaymentCorrections(inv: VendorInvoice): CorrectionAction[] {
  if (inv.status !== "PAID") return [];
  return [
    {
      key: "revert-paid",
      label: "Batalkan pembayaran",
      title: `Batalkan pembayaran ${inv.id}`,
      impact: [
        "Status invoice kembali ke Disetujui; menunggu pembayaran Finance lagi.",
        "Bongkar Koli yang sudah dilakukan Warehouse TIDAK dibatalkan (HPP sudah tercatat). Resi yang belum dibongkar tertahan lagi sampai invoice dibayar ulang.",
        "Finance, Procurement, dan vendor produksi menerima notifikasi.",
      ],
      confirmLabel: "Batalkan pembayaran",
      run: (reason) => sysadminRevertVendorInvoicePaidAction(inv.id, reason),
    },
  ];
}

/** Invoice PO Produksi FOB: PAID -> APPROVED atau APPROVED -> SUBMITTED. Hanya FOB (PO-nya dicek). */
export function fobInvoiceCorrections(inv: MaklonInvoice, po: MaklonPO | undefined): CorrectionAction[] {
  if (!po?.isFob) return [];
  if (inv.status === "PAID") {
    return [
      {
        key: "revert-paid",
        label: "Batalkan pembayaran",
        disabledReason: po.status !== "FULLY_PAID" ? `PO Produksi berstatus ${po.status} — tidak bisa dimundurkan otomatis` : undefined,
        title: `Batalkan pembayaran ${inv.id}`,
        impact: [
          "Status invoice kembali ke Disetujui dan PO Produksi kembali ke Delivery (status sebelum dibayar).",
          "Finance bisa membayar ulang.",
          "Finance dan vendor produksi menerima notifikasi.",
        ],
        confirmLabel: "Batalkan pembayaran",
        run: (reason) => sysadminRevertMaklonInvoiceAction(inv.id, "PAID", reason),
      },
    ];
  }
  if (inv.status === "APPROVED") {
    return [
      {
        key: "revert-approval",
        label: "Mundurkan approval",
        title: `Mundurkan approval ${inv.id}`,
        impact: ["Status invoice kembali ke Menunggu approval; Finance bisa menyetujui ulang.", "Finance dan vendor produksi menerima notifikasi."],
        confirmLabel: "Mundurkan approval",
        run: (reason) => sysadminRevertMaklonInvoiceAction(inv.id, "APPROVED", reason),
      },
    ];
  }
  return [];
}

/** Hapus 1 entri ledger saldo deposit vendor yang keliru (owner 2026-10-06). */
export function depositEntryCorrections(entry: { id: string; kind: "CREDIT" | "DEBIT"; amount: number; supplier: string }): CorrectionAction[] {
  return [
    {
      key: "delete-deposit",
      label: "Hapus entri",
      danger: true,
      title: `Hapus entri deposit ${entry.supplier}`,
      impact: [
        `Entri ${entry.kind === "CREDIT" ? "kredit masuk" : "dipakai bayar"} ${formatRupiah(entry.amount)} dihapus PERMANEN dari ledger.`,
        "Saldo supplier langsung terhitung ulang (saldo selalu dijumlah dari semua entri).",
        "Isi entri yang dihapus tersimpan di Log Audit. Finance & Procurement menerima notifikasi.",
      ],
      confirmLabel: "Hapus entri",
      confirmText: entry.id,
      run: (reason) => sysadminDeleteDepositEntryAction(entry.id, reason),
    },
  ];
}
