-- 0077 (2026-10-24): biaya ekspedisi AKTUAL per resi (diisi vendor saat "Set Ekspedisi & Resi", opsional).
-- Disimpan sebagai TOTAL biaya 1 resi di setiap koli pada grup resi yang sama (nilai identik); ongkir per koli dibagi menurut berat koli
-- (koliOngkirShare, lib/mrp/derive.ts). Kosong = ongkir tetap dihitung dari tarif per kg di Master Data Ekspedisi seperti sebelumnya.
-- Tidak ada data yang berubah. Aman dijalankan berulang.
alter table public.delivery_kolis add column if not exists biaya_ekspedisi numeric;
