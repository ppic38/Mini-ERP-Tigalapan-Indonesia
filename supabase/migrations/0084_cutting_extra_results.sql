-- 0084 (2026-10-30, permintaan owner): hasil tambahan dari sisa kain saat Input Hasil Cutting.
-- Kain roll yang masih bersisa setelah target tercapai boleh dijadikan baju lain (lengan, usia, size apa pun). Baris hasil tambahan
-- disimpan sebagai jsonb di production_batches.extra_results: [{ "lengan", "usia", "size", "qty", "resultId"? }]. `resultId` terisi
-- begitu hasil tambahan SAH (disimpan akun utama, atau disetujui akun utama kalau disimpan anggota tim) dan tercatat sebagai Finish
-- Good di production_results (note diawali "Sisa kain"). Kolom ikut snapshot lewat to_jsonb(production_batches), jadi fungsi
-- get_flow_snapshot_raw/core TIDAK perlu diubah. Aman dijalankan berulang. Kode aplikasi tetap jalan tanpa migration ini
-- (hasil tambahan tidak bisa disimpan: pesan error meminta migration ini dijalankan).
alter table public.production_batches add column if not exists extra_results jsonb;
