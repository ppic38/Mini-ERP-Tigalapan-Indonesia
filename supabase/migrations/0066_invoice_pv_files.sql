-- 0066 (2026-10-08, owner: "user mengoperasikan ERP jangan menunggu buffering lama") -- PINDAHKAN lampiran PDF
-- Paying Voucher keluar dari tabel raw_material_invoices ke tabel terpisah.
-- MASALAH: kolom bukti_pv_storage_path menyimpan PDF base64 (~0,5 MB per invoice) langsung di baris invoice, jadi ikut
-- get_flow_snapshot_raw() -- 97% isi snapshot (13 dari 13,5 MB, ~4-7 detik) setiap refresh tiap user, dan menghabiskan
-- kuota egress Supabase. Sekarang PDF disimpan di invoice_pv_files (pola sama invoice_payment_proofs, migration 0017)
-- dan dibaca HANYA saat tombol "Lihat / Download" diklik (getInvoiceBuktiPvAction).
-- Aman dijalankan berulang. Baris lama disalin dulu, baru kolom lama dikosongkan; nama file diisi supaya penanda
-- "ada lampiran" tetap ada. Kode aplikasi tetap jalan kalau migration ini belum dijalankan (membaca/menulis kolom lama).
create table if not exists public.invoice_pv_files (
  invoice_id text primary key references public.raw_material_invoices(id) on delete cascade,
  data_url text not null,
  file_name text,
  uploaded_at timestamptz not null default now()
);

alter table public.invoice_pv_files enable row level security;
drop policy if exists "service role full access" on public.invoice_pv_files;
create policy "service role full access" on public.invoice_pv_files for all
  using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

insert into public.invoice_pv_files (invoice_id, data_url, file_name)
select id, bukti_pv_storage_path, coalesce(bukti_pv_file_name, 'bukti-pv.pdf')
from public.raw_material_invoices
where bukti_pv_storage_path is not null
on conflict (invoice_id) do nothing;

update public.raw_material_invoices
set bukti_pv_file_name = coalesce(bukti_pv_file_name, 'bukti-pv.pdf')
where bukti_pv_storage_path is not null;

update public.raw_material_invoices r
set bukti_pv_storage_path = null
where r.bukti_pv_storage_path is not null
  and exists (select 1 from public.invoice_pv_files f where f.invoice_id = r.id and f.data_url = r.bukti_pv_storage_path);
