-- 0052 (2026-09-24, owner: "disable saja juga untuk yang di master data. hide saja (tapi bisa
-- diaktifkan kembali melalui erp untuk master datanya)") -- tabel generik key/value BOOLEAN kecil
-- untuk toggle fitur yang bisa dinyala/matikan LEWAT APLIKASI (bukan lewat kode+redeploy), beda
-- dari HARGA_KAIN_PKS_ENABLED di lib/mrp/derive.ts (itu murni disable perhitungan otomatisnya,
-- ini murni sembunyikan/tampilkan tab Master Data "Harga Kain PKS" -- dua hal independen,
-- lihat harga-kain-pks-panel.tsx & app/procurement/master-data/page.tsx). Baris default 'false'
-- di bawah = tab disembunyikan begitu migration ini jalan; owner bisa tampilkan lagi kapan saja
-- lewat tombol "Tampilkan Harga Kain PKS" di halaman Master Data itu sendiri, tanpa perlu minta
-- kode/deploy baru.

create table if not exists public.app_settings (
  key text primary key,
  value boolean not null,
  updated_at timestamptz not null default now()
);

alter table public.app_settings enable row level security;

drop policy if exists "service role full access" on public.app_settings;
create policy "service role full access" on public.app_settings for all
  using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

insert into public.app_settings (key, value)
values ('harga_kain_pks_tab_visible', false)
on conflict (key) do nothing;
