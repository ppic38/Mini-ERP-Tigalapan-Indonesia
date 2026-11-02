-- 0087 (2026-11-02, owner) -- klasifikasi reject per warna·lengan: total reject (selisih target dan Finish Good, dihitung otomatis) dibagi
-- vendor menjadi reject MATERIAL (cacat bahan) dan reject PRODUKSI / PROSES (cacat jahit, potong, dst.). Hanya dua kolom angka (pcs) di
-- production_group_meta yang sudah ada; ikut snapshot otomatis lewat to_jsonb. Kosong = vendor belum mengklasifikasi. Aman dijalankan berulang.

alter table public.production_group_meta add column if not exists reject_material_qty integer;
alter table public.production_group_meta add column if not exists reject_proses_qty integer;
