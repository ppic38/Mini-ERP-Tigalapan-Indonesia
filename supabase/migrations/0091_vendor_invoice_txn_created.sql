-- 0091 (2026-11-13, permintaan owner): penanda "transaksi sudah dibuat" (sudah transfer) per invoice vendor produksi di Finance > Payment Maklon,
-- sama dengan yang sudah ada di Payment Material (migration 0071, raw_material_invoices).
-- Finance membuat transaksi di bank DULU, bukti pembayaran baru ada sesudahnya; selama itu invoice tetap di tabel "Invoice vendor siap dibayar".
-- Penanda ini (centang) membedakan invoice yang transaksinya sudah dibuat dari yang belum -- TIDAK mengubah status invoice dan tidak memindahkannya
-- ke Riwayat (itu tetap terjadi saat Bayar Penuh + bukti). Kolom baru ikut snapshot otomatis (to_jsonb), fungsi snapshot tidak diubah.
-- Aman dijalankan berulang. Kode aplikasi tetap jalan kalau migration ini belum dijalankan (kolom hanya ditulis saat Finance mencentang;
-- pesan error meminta migration ini dijalankan).
alter table public.vendor_invoices add column if not exists txn_created_at timestamptz;
alter table public.vendor_invoices add column if not exists txn_created_by text;
