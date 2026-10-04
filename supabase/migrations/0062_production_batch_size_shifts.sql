-- Revisi 2026-10-04 (owner, alur Cutting): sisa kain sebuah roll yang tidak cukup untuk 1 pcs lagi di
-- size target boleh dialihkan ke size LEBIH KECIL dari kain yang sama (mis. target L 100 -> hasil
-- 99 L + 1 M). Hasil cutting AKTUAL tetap di production_batch_sizes (99 L, 1 M) -- kolom ini HANYA
-- penanda "pcs ini hasil alih size dari sisa kain": [{"from":"L","to":"M","qty":1}].
-- Kolom opsional -- kode aplikasi TIDAK menulisnya kalau tidak ada alih size, jadi aman kalau migration
-- ini terlambat dijalankan; TAPI penanda baru tersimpan setelah migration ini jalan.
-- Snapshot (get_flow_snapshot_raw) memakai to_jsonb(t), jadi kolom baru otomatis ikut terbaca.

alter table production_batches add column if not exists size_shifts jsonb;
