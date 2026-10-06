// Tipe bersama fitur "Upload Invoice Supplier" di Paying Voucher (Procurement).

/** 1 baris barang di invoice supplier: berat (kg), harga per kg, jumlah (Rp) -- sesuai yang tercetak. */
export type InvoiceLine = { w: number; price: number; amount: number; fixed?: string };

/** 1 blok barang di invoice: kain roll ("COMBED 24S - TOSCA MUDA") atau rib ("RIB COMBED 24S - TOSCA MUDA"). */
export type ParsedInvoiceGroup = {
  kind: "roll" | "rib";
  /** Nama warna PERSIS seperti tercetak di invoice supplier (belum dipetakan ke nama warna MRP). */
  warna: string;
  /** Benang, mis. "24S". */
  benang: string;
  lines: InvoiceLine[];
};

export type ParsedInvoice = {
  fileName: string;
  /** Nomor invoice supplier (KNITTO: "No Penjualan"). Dipakai sebagai "No invoice vendor material". */
  noPenjualan: string;
  tanggal: { d: number; m: number; y: number } | null;
  customer: string;
  /** Dari NAMA FILE (NOINVOICE.KODETRANSAKSI.pdf) -- tidak ada di isi invoice. */
  kodeTransfer: string;
  groups: ParsedInvoiceGroup[];
  totals: {
    subtotal: number;
    diskon: number;
    totalBayar: number;
    /** "Total KG-an" (rib): total kg + jumlah baris, sesuai cetakan invoice. */
    kgan: { kg: number; n: number } | null;
    /** "Total Roll-an": total kg + jumlah roll, sesuai cetakan invoice. */
    rollan: { kg: number; n: number } | null;
  };
  warnings: string[];
  rawText: string;
};

export type InvoiceCheck = { id: string; label: string; ok: boolean; detail: string; blocking: boolean };

/** Adapter per supplier: tiap supplier punya template invoice sendiri. */
export type InvoiceAdapter = {
  id: string;
  label: string;
  matchesSupplier: (supplierName: string) => boolean;
  parse: (text: string, fileName: string) => ParsedInvoice;
  validate: (inv: ParsedInvoice) => InvoiceCheck[];
};

/** Ringkasan invoice yang sudah diterapkan ke form Paying Voucher -- pembanding "tanpa selisih" yang
 *  terus dicek langsung terhadap isi form (kalau user mengedit sesudahnya, selisihnya langsung kelihatan). */
export type AppliedImport = {
  adapterLabel: string;
  fileName: string;
  noInvoice: string;
  totalBayar: number;
  subtotal: number;
  diskon: number;
  rollCount: number;
  rollKg: number;
  ribKg: number;
  /** Pemetaan yang dikonfirmasi user & layak diingat untuk invoice berikutnya dari supplier ini. */
  aliases: { invoiceWarna: string; benang: string; mrpWarna: string }[];
};
