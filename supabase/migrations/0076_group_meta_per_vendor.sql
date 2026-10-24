-- 0076 (2026-10-24): status grup produksi (Selesai Produksi tahap 1 & 2, remark sisa reject) menjadi PER VENDOR.
-- Sebelumnya production_group_meta berkunci group_key saja (`mrp|warna|lengan`, tanpa vendor), padahal satu warna·lengan bisa dikerjakan
-- beberapa vendor sekaligus (kasus W39 Hitam 30S Pendek: CE, GI-01, GI-02, KK, MKS). Vendor kedua yang menandai Selesai Produksi akan
-- menimpa baris vendor pertama, atau gagal karena kunci ganda. Kunci diganti menjadi (group_key, vendor_produksi).
-- Tidak ada data yang berubah: kolom vendor_produksi sudah terisi di semua baris. Aman dijalankan berulang.
alter table public.production_group_meta drop constraint if exists production_group_meta_pkey;
alter table public.production_group_meta add constraint production_group_meta_pkey primary key (group_key, vendor_produksi);
