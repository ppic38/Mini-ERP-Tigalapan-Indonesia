-- 0071 (2026-10-20, permintaan user Finance): penanda "transaksi sudah dibuat" per invoice material.
-- Finance membuat transaksi di bank/sistem pembayaran DULU, bukti pembayaran baru ada sesudahnya; selama itu invoice
-- tetap di tabel "Invoice siap dibayar". Penanda ini (centang) membedakan invoice yang transaksinya sudah dibuat dari
-- yang belum -- TIDAK mengubah status invoice dan tidak memindahkannya ke Riwayat (itu tetap terjadi saat Bayar + bukti).
-- Aman dijalankan berulang. Kode aplikasi tetap jalan kalau migration ini belum dijalankan (kolom hanya ditulis saat
-- Finance mencentang; pesan error meminta migration ini dijalankan).
alter table public.raw_material_invoices add column if not exists txn_created_at timestamptz;
alter table public.raw_material_invoices add column if not exists txn_created_by text;
