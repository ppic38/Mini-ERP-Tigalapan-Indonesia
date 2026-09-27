import type { Lengan } from "./types";

/** Tipe bersama (client parser + server action) untuk "Migrasi Data Awal" Konveksi Makassar (owner
 *  2026-09-25) -- memasukkan pekerjaan yang MASIH BERJALAN dari catatan manual langsung di tahap
 *  terakhirnya, tanpa mengulang siklus MRP -> PO -> invoice. Lihat parseMigrationImport.ts (template
 *  Excel 5 sheet) dan importMigrationAction (lib/mrp/actions.ts). */

/** Posisi roll saat ini: G menunggu Good Receive (belum diterima fisik -- kode roll diisi vendor saat
 *  Good Receive), A di gudang (sudah diterima, belum dipotong), B sudah dipotong/resting, C sudah jadi
 *  (FG) belum dikirim, D sudah dikirim belum diinvoice. */
export type MigrationTahap = "G" | "A" | "B" | "C" | "D";

export type MigrationRoll = {
  warna: string;
  lengan: Lengan;
  /** Kosong untuk tahap G (kode roll baru diberi vendor saat Good Receive). */
  codeRoll: string;
  /** Kode pairing aduan pola yang dipakai roll ini saat dipotong (tahap B/C/D) -- wajib kalau baris
   *  warna+lengannya punya lebih dari 1 kode aduan pola. */
  kodePairing?: string;
  grossKg: number;
  codeLot?: string;
  hargaPerKg: number;
  tahap: MigrationTahap;
  /** Tahap B/C/D. `sizes` kosong = baru resting (belum ada hasil potong). */
  cutting?: { restingAt: string; netKg: number; gramasi?: number; setting?: string; sizes: Record<string, number> };
  /** Tahap C/D -- hasil barang jadi (FG) per size. */
  fg?: Record<string, number>;
  /** Tahap D. */
  ship?: { noResi: string; ekspedisi: string; tanggalKirim: string; noKoli: string; beratKoli?: number };
};

export type MigrationLine = {
  kategori: string;
  warna: string;
  lengan: Lengan;
  /** Rencana qty roll dari file (sisa yang masih dikerjakan). Server memakai jumlah roll aktual di sheet roll. */
  qtyRoll: number;
  /** Rencana pcs per size. */
  sizes: Record<string, number>;
  /** Aduan pola per kode pairing (sheet Aduan_Pola, opsional). Kosong = 1 baris ringkasan kode MIGRASI. */
  aduan?: { kode: string; qtyRoll: number; sizes: Record<string, number> }[];
};

export type MigrationMrp = {
  mrpId: string;
  poRef?: string;
  poDate?: string;
  lines: MigrationLine[];
  rolls: MigrationRoll[];
};

export type MigrationIssue = { severity: "error" | "warning"; sheet: string; row?: number; message: string };

export type MigrationImportSummary = { mrpCount: number; lineCount: number; rollCount: number; batchCount: number; koliCount: number };

/** Nama "supplier" khusus PO Material + invoice bahan hasil migrasi (bahan sudah ada di vendor, tidak
 *  ditagih lewat Finance). Disaring dari layar/angka Finance & klaim supplier (lihat isSyntheticSupplier
 *  di derive.ts). */
export const MIGRASI_SUPPLIER = "MIGRASI";
/** Vendor produksi tujuan migrasi -- KONVEKSI MAKASSAR (id "MKS", migration 0002). */
export const MIGRASI_VENDOR_ID = "MKS";
