-- 0088 (2026-11-05, permintaan owner): Invoice Ekspedisi -- Procurement memvalidasi biaya ekspedisi AKTUAL per resi (dari nota ekspedisi),
-- bisa menyesuaikan no resi, lalu mengajukannya ke Finance untuk dibayar. Biaya yang sudah divalidasi menggantikan tarif per kg Master Data
-- sebagai ongkir di perhitungan HPP (untuk resi itu saja; resi yang belum divalidasi tetap memakai tarif master).
--
-- Satu resi = satu invoice ekspedisi. Datanya disimpan sebagai jsonb di tiap koli grup resi itu (nilai identik di semua koli satu resi),
-- pola sama proposal pembayaran (0082), jadi ikut snapshot lewat to_jsonb tanpa mengubah fungsi get_flow_snapshot_*.
-- Isi jsonb: status (DRAFT/SUBMITTED/PAID), noResi, noResiAsli, biaya, tarifMasterPerKg, beratResi, noNota, catatan,
--   notaCount, buktiCount, savedBy/savedAt, submittedBy/submittedAt, paidBy/paidAt.
-- File nota ekspedisi dan bukti bayar memakai tabel attachment_files (migration 0080) dengan kind EKSPEDISI_NOTA / EKSPEDISI_BUKTI
-- dan ref_id = id grup resi (atau id koli kalau koli lama tanpa grup), jadi TIDAK ikut snapshot.
-- Tidak ada data yang berubah. Aman dijalankan berulang. Jalankan SEBELUM kode baru ter-deploy.

alter table public.delivery_kolis add column if not exists ekspedisi_invoice jsonb;
