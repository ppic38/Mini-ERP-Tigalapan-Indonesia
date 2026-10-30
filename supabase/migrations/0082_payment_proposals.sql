-- 0082 (2026-10-30, permintaan owner): Proposal Pembayaran + PIC pembayaran Finance.
--
-- 1) vendor_invoices.proposal (jsonb): isi Proposal Pembayaran (no proposal, tanggal, location, nama kegiatan, rekening tujuan,
--    tagihan, DP %, sisa, tanggal mulai kegiatan) yang dibuat Procurement untuk invoice vendor produksi. Satu proposal boleh
--    menaungi beberapa invoice vendor yang sama (isi yang sama disalin ke tiap invoice, dibedakan oleh nomor proposal). Disimpan
--    sebagai kolom di tabel yang SUDAH ikut snapshot, jadi fungsi get_flow_snapshot_raw/core TIDAK perlu diubah.
-- 2) paid_by (text): nama PIC Finance yang memproses pembayaran (akun sub-user atau akun utama), supaya kelihatan siapa yang
--    membayar saat Finance punya lebih dari satu akun. Hanya terisi untuk pembayaran SESUDAH migration ini; data lama tampil "-".
-- Aman dijalankan berulang. Kode aplikasi tetap jalan tanpa migration ini, kecuali saat Procurement menyimpan proposal
-- (pesan error meminta migration ini dijalankan).
alter table public.vendor_invoices add column if not exists proposal jsonb;
alter table public.vendor_invoices add column if not exists paid_by text;
alter table public.raw_material_invoices add column if not exists paid_by text;
