-- 0061 (2026-09-30, owner: "toleransi ditambahkan di master data SCM ... berlaku di semua vendor produksi ...
-- sekarang ganti jadi 8%") -- tabel generik key/value ANGKA untuk pengaturan yang bisa diubah LEWAT APLIKASI
-- (beda dari `app_settings` migration 0052 yang nilainya BOOLEAN). Pemakai pertama: toleransi selisih berat
-- (persen) antara berat kotor invoice dan berat bersih hasil timbang vendor produksi -- diatur SCM di
-- Master Data SCM, berlaku untuk SEMUA vendor produksi (lihat lib/mrp/derive.ts weightVariance).
--
-- Nilai awal 8 (sebelumnya konstanta 2% di kode). Kode aplikasi AMAN kalau migration ini BELUM dijalankan:
-- jatuh ke nilai default 8 yang sama (DEFAULT_WEIGHT_TOLERANCE_PCT), cuma belum bisa diubah dari layar
-- sampai tabelnya ada. Owner menjalankan migration ini manual di SQL Editor Supabase.

create table if not exists public.app_number_settings (
  key text primary key,
  value numeric not null,
  updated_at timestamptz not null default now(),
  updated_by text
);

alter table public.app_number_settings enable row level security;

drop policy if exists "service role full access" on public.app_number_settings;
create policy "service role full access" on public.app_number_settings for all
  using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

insert into public.app_number_settings (key, value, updated_by)
values ('weight_tolerance_pct', 8, 'migration 0061')
on conflict (key) do nothing;

-- Penanda "ada perubahan data?" (migration 0049) -- tabel baru harus ikut dipasangi trigger supaya browser
-- lain tahu ada perubahan (toleransi ikut terbawa di snapshot). Idempotent, hanya untuk tabel ini.
do $$
begin
  if exists (select 1 from pg_proc where proname = 'bump_data_version') then
    execute 'drop trigger if exists trg_bump_data_version on public.app_number_settings';
    execute 'create trigger trg_bump_data_version after insert or update or delete or truncate on public.app_number_settings for each statement execute function public.bump_data_version()';
  end if;
end;
$$;
