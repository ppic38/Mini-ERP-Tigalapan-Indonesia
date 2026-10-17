-- 0070 (2026-10-17, owner: kasus nota supplier sementara vs final -- "kelebihan bayar" jadi saldo deposit):
-- Finance boleh melampirkan SATU dokumen pendukung (mis. nota awal/sementara) saat membayar invoice material, di samping
-- bukti pembayaran. Payload-nya dipisah dari snapshot (pola sama invoice_payment_proofs, migration 0017): hanya nama
-- file (kolom support_file_name) yang ikut snapshot sebagai penanda; isinya dibaca saat "Nota pendukung" diklik.
-- Aman dijalankan berulang. Kode aplikasi tetap jalan kalau migration ini belum dijalankan, kecuali saat Finance
-- memilih melampirkan dokumen pendukung (pesan error meminta migration ini dijalankan, pembayaran tidak diproses).
alter table public.raw_material_invoices add column if not exists support_file_name text;

create table if not exists public.invoice_support_files (
  invoice_id text primary key references public.raw_material_invoices(id) on delete cascade,
  data_url text not null,
  file_name text,
  uploaded_at timestamptz not null default now()
);

alter table public.invoice_support_files enable row level security;
drop policy if exists "service role full access" on public.invoice_support_files;
create policy "service role full access" on public.invoice_support_files for all
  using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
