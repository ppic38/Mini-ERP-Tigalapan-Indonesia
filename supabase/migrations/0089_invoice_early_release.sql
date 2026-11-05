-- 0089: "Terima lebih awal" untuk invoice material (dispensasi Sysadmin).
-- Kasus: bahan sudah fisik ada di vendor tetapi baru diproses di ERP, jadi vendor harus bisa Good Receive & input produksi
-- walau invoice material belum dibayar. Invoice yang diberi dispensasi dimajukan ke status DELIVERY, penanda ini menjaga
-- supaya Finance tetap bisa membayarnya (dan Procurement tetap bisa melengkapi lampiran) setelah itu.
-- Belum dibayar = early_release = true DAN paid_at kosong. Tidak ada tabel/RPC lain yang berubah (snapshot memakai to_jsonb).
alter table public.raw_material_invoices add column if not exists early_release boolean not null default false;
