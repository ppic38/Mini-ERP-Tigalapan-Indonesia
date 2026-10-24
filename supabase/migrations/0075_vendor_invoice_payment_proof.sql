-- 0075 (2026-10-24, permintaan owner): bukti pembayaran WAJIB untuk invoice vendor produksi (maklon) -- Finance harus melampirkan bukti
-- sebelum bisa menandai invoice lunas, dan vendor bisa melihatnya di Invoice & Payment. Pola sama bukti bayar invoice material (migration 0017).
--
-- `bukti_bayar_at` / `bukti_bayar_file_name` di vendor_invoices hanya PENANDA murah yang ikut snapshot (kolom baru ikut otomatis lewat
-- get_flow_snapshot_raw yang memakai to_jsonb per tabel). File-nya (data URI PDF/JPG/PNG, bisa ratusan KB) sengaja disimpan di tabel terpisah
-- dan diambil on-demand lewat Server Action, supaya tidak ikut ter-download di setiap refresh snapshot -- JANGAN menambahkan tabel ini ke snapshot.
-- Aman dijalankan berulang. Jalankan SEBELUM kode baru ter-deploy: setelah itu Finance wajib melampirkan bukti saat membayar.
alter table public.vendor_invoices add column if not exists bukti_bayar_at timestamptz;
alter table public.vendor_invoices add column if not exists bukti_bayar_file_name text;

create table if not exists public.vendor_invoice_payment_proofs (
  invoice_id text primary key references public.vendor_invoices(id) on delete cascade,
  data_url text not null,
  file_name text,
  uploaded_at timestamptz not null default now()
);
alter table public.vendor_invoice_payment_proofs enable row level security;
