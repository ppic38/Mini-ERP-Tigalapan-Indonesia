-- 0083 (2026-10-30, permintaan owner): PIC Procurement yang menyetujui invoice vendor produksi, ditampilkan di blok tanda tangan PDF proposal
-- pembayaran (Payment Maklon). Hanya terisi untuk persetujuan SESUDAH migration ini; invoice yang sudah disetujui sebelumnya tampil "-".
-- Aman dijalankan berulang. Kode aplikasi tetap jalan tanpa migration ini (PIC hanya kosong).
alter table public.vendor_invoices add column if not exists approved_by text;
