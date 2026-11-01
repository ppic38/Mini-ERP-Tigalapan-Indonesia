-- 0085 (2026-11-01, permintaan owner): rekening tujuan pembayaran per vendor produksi, untuk Proposal Pembayaran (Finance > Payment Maklon >
-- Download proposal). Tiga kolom teks di vendors_produksi; kosong = proposal menampilkan "-". Dibaca/ditulis lewat aksi server khusus
-- (listVendorBankAccountsAction / updateVendorBankAccountAction), TIDAK ikut snapshot, jadi tidak sampai ke browser vendor.
-- Data awal dari owner: YOGI 01 dan YOGI 02 (GI-01, GI-02) BCA 3462401431 a.n. YOGI ADI WIDYATAMA; KOKO (KK) 367801027482532 a.n. OKON RIZKON
-- (nama bank KOKO belum diketahui, dibiarkan kosong; isi lewat Master Data > Vendor Produksi). Aman dijalankan berulang.
alter table public.vendors_produksi add column if not exists bank_name text;
alter table public.vendors_produksi add column if not exists bank_account_no text;
alter table public.vendors_produksi add column if not exists bank_account_name text;

update public.vendors_produksi
set bank_name = 'Bank Central Asia (BCA)', bank_account_no = '3462401431', bank_account_name = 'YOGI ADI WIDYATAMA'
where id in ('GI-01', 'GI-02') and bank_account_no is null;

update public.vendors_produksi
set bank_account_no = '367801027482532', bank_account_name = 'OKON RIZKON'
where id = 'KK' and bank_account_no is null;
