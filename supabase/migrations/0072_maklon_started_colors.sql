-- 0072 (2026-10-22, permintaan owner: "mulai produksi per warna agar lebih fleksibel"): daftar warna|lengan yang sudah
-- DIMULAI produksinya oleh vendor di Good Receive, per PO Produksi. Contoh: ["HITAM 24S|PENDEK","NAVY 24S|PENDEK"].
-- NULL/kosong = perilaku lama: begitu PO berstatus produksi, SEMUA bahan yang diterima boleh diproses. Terisi = hanya
-- warna di daftar yang boleh masuk resting/cutting (warna lain menunggu tombol "Mulai" masing-masing atau "Mulai semua").
-- Aman dijalankan berulang. Kode aplikasi tetap jalan kalau migration ini belum dijalankan (mulai per warna menjawab
-- "jalankan migration 0072"; tombol "Mulai semua" tetap berfungsi seperti dulu).
alter table public.maklon_pos add column if not exists started_colors jsonb;
