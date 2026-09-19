-- Revisi 2026-09-19 (owner, alur Cutting baru): tiap roll yang dimasukkan ke Resting sekarang punya
-- isian "Setting" (setting kain, mis. lebar / heat setting) selain berat bersih & gramasi.
-- Kolom opsional & bebas isi (teks) -- kode aplikasi TIDAK menulisnya kalau kosong, jadi aman kalau
-- migration ini terlambat dijalankan; TAPI isian Setting baru tersimpan setelah migration ini jalan.
-- Snapshot (get_flow_snapshot_raw) memakai to_jsonb(t), jadi kolom baru otomatis ikut terbaca.

alter table production_batches add column if not exists setting text;
