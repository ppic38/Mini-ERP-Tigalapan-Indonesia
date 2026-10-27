-- 0080 (2026-10-27): lampiran LEBIH DARI SATU file (bukti bayar, foto resi, foto klaim).
-- File PERTAMA tetap di tabel lama (invoice_payment_proofs, vendor_invoice_payment_proofs, delivery_koli_ekspedisi_photos, material_claim_photos),
-- jadi lampiran yang sudah ada tidak berubah dan jalur lama tetap jalan. File TAMBAHAN (ke-2 dan seterusnya) disimpan di tabel baru ini.
-- Penampil memakai satu tombol "Lihat / Download" yang membuka semua file sekaligus.
-- Kunci: kind = jenis lampiran, ref_id = id yang dilampiri (id invoice; id invoice vendor; id grup resi (atau id koli kalau tanpa grup); claim_key).
-- Tidak ada data yang berubah. Aman dijalankan berulang.

create table if not exists public.attachment_files (
  id bigint generated always as identity primary key,
  kind text not null,
  ref_id text not null,
  data_url text not null,
  file_name text,
  created_at timestamptz not null default now()
);
create index if not exists attachment_files_ref_idx on public.attachment_files(kind, ref_id, id);

alter table public.attachment_files enable row level security;
drop policy if exists "service role full access" on public.attachment_files;
create policy "service role full access" on public.attachment_files for all
  using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
