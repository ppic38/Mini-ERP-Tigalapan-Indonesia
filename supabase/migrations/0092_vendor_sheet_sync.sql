-- 0092: Sinkronisasi spreadsheet vendor (khusus vendor BAYU, owner 2026-11-16).
-- Satu baris per vendor: tautan "Publish to web" Google Sheets yang dibaca ERP, status sinkron terakhir, dan hasilnya (jumlah perubahan + daftar masalah per baris).
-- Aman diulang (IF NOT EXISTS). Tidak mengubah tabel lain; kode tetap jalan tanpa migration ini (fitur sinkron saja yang menolak dengan pesan jelas).

create table if not exists public.vendor_sheet_sync (
  vendor_produksi text primary key,
  sheet_url text not null,
  enabled boolean not null default true,
  -- waktu sinkron terakhir DIMULAI (dipakai juga sebagai penanda "sedang/baru dikerjakan" supaya dua pemicu tidak berjalan bersamaan)
  last_sync_at timestamptz,
  -- OK / ADA_MASALAH / GAGAL
  last_status text,
  -- { applied, unchanged, pending, issues: [{tab,row,message}], applied_labels: [] }
  last_summary jsonb,
  -- hash isi spreadsheet terakhir yang berhasil dibaca tanpa masalah (isi sama = tidak perlu diproses ulang)
  content_hash text,
  updated_at timestamptz not null default now(),
  updated_by text
);

-- Tabel diakses hanya lewat service_role dari server (sama seperti tabel lain: RLS aktif tanpa policy).
alter table public.vendor_sheet_sync enable row level security;

-- Tautan publish-to-web = tautan rahasia; jangan terbuka untuk role baca-saja partner.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'partner_ro') then
    execute 'revoke all on public.vendor_sheet_sync from partner_ro';
  end if;
end $$;
