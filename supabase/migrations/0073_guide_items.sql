-- 0073 (2026-10-22, permintaan owner): konten media panduan (video, gambar, tautan) yang dikelola Sysadmin dan tampil di
-- halaman Panduan Penggunaan portal Vendor Produksi. Satu baris = satu media di satu bagian panduan.
-- `section_key` = kunci bagian panduan (lib/guide/sections.ts). `kind`: VIDEO (tautan YouTube/Vimeo/Loom/Google Drive yang
-- disematkan), IMAGE (tautan gambar https), LINK (tautan biasa). Hanya tautan yang disimpan, bukan file -- hosting video dan
-- gambar ada di layanan lain.
-- Aman dijalankan berulang. Halaman Panduan tetap tampil normal (teks saja) kalau migration ini belum dijalankan.
create table if not exists public.guide_items (
  id text primary key,
  portal text not null default 'vendor',
  section_key text not null,
  kind text not null check (kind in ('VIDEO', 'IMAGE', 'LINK')),
  title text not null default '',
  url text not null,
  caption text,
  sort_order integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists guide_items_portal_section_idx on public.guide_items (portal, section_key, sort_order);
alter table public.guide_items enable row level security;
