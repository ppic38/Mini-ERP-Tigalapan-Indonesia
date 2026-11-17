-- 0093: Sinkron spreadsheet vendor PER MRP (owner 2026-11-16, revisi dari 0092): satu spreadsheet "Publish to web" = satu MRP, dan satu vendor boleh punya banyak tautan
-- (satu per MRP). Menggantikan tabel vendor_sheet_sync (0092, satu tautan per vendor) yang belum dipakai; aman diulang.

create table if not exists public.vendor_mrp_sheets (
  vendor_produksi text not null,
  mrp_id text not null,
  sheet_url text not null,
  enabled boolean not null default true,
  -- waktu sinkron terakhir DIMULAI (juga penanda "baru/sedang dikerjakan" supaya dua pemicu tidak berjalan bersamaan)
  last_sync_at timestamptz,
  -- OK / ADA_MASALAH / GAGAL
  last_status text,
  -- { applied, unchanged, pending, issues: [{tab,row,message}], appliedLabels: [] }
  last_summary jsonb,
  -- hash isi spreadsheet terakhir yang diterapkan tanpa masalah (isi sama = tidak diproses ulang)
  content_hash text,
  updated_at timestamptz not null default now(),
  updated_by text,
  primary key (vendor_produksi, mrp_id)
);

alter table public.vendor_mrp_sheets enable row level security;

-- Tautan publish-to-web = tautan rahasia; tidak terbuka untuk role baca-saja partner.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'partner_ro') then
    execute 'revoke all on public.vendor_mrp_sheets from partner_ro';
  end if;
end $$;

-- Tabel 0092 digantikan (belum dipakai: tidak ada tautan yang sempat tersimpan).
drop table if exists public.vendor_sheet_sync;
