-- 0057 (2026-09-27, owner: "vendor produksi itu ada berbagai macam user, seperti tim cutting, tim
-- finish good, packing" -- akun turunan per vendor dengan hak akses fleksibel per sub-modul) --
--
-- `vendor_users`: akun anggota tim SATU vendor produksi. `username` unik SE-APLIKASI (login
-- langsung pakai username, TIDAK perlu pilih nama vendor dulu -- beda dari akun utama vendor yang
-- login pakai nama vendor). `allowed_pages` = daftar path halaman portal vendor yang boleh diakses
-- (mis. '{/vendor-maklon/production,/vendor-maklon/pengiriman}') -- FLEKSIBEL, PPIC/vendor pilih
-- sendiri kombinasi apa saja saat membuat akun, bukan preset peran tetap. Akun UTAMA vendor (login
-- lewat nama vendor seperti sekarang, lib/auth/actions.ts loginVendorAction) TIDAK punya baris di
-- sini & otomatis akses PENUH ke semua halaman TERMASUK "Tim Saya" (kelola tabel ini) -- baris di
-- sini murni untuk anggota tim yang dibuatkan akun terbatas.
create table if not exists public.vendor_users (
  id text primary key,
  vendor_produksi text not null references public.vendors_produksi(id) on delete cascade,
  username text not null unique,
  name text not null,
  password_hash text not null,
  allowed_pages text[] not null default '{}',
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists vendor_users_vendor_idx on public.vendor_users(vendor_produksi);

alter table public.vendor_users enable row level security;
drop policy if exists "service role full access" on public.vendor_users;
create policy "service role full access" on public.vendor_users for all
  using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

-- `vendor_action_log`: jejak "anggota tim mana yang benar-benar klik" untuk beberapa aksi kunci
-- (mulai Resting, Tutup Roll, buat Koli, Set Ekspedisi & Resi, Good Receive, Submit Invoice --
-- lihat pemanggilnya di lib/mrp/actions.ts) -- akun UTAMA vendor tetap tercatat (actor_name =
-- nama vendor) supaya satu tabel ini konsisten mencakup SEMUA aksi, bukan cuma sub-user.
create table if not exists public.vendor_action_log (
  id text primary key,
  vendor_produksi text not null references public.vendors_produksi(id) on delete cascade,
  vendor_user_id text references public.vendor_users(id) on delete set null,
  actor_name text not null,
  action text not null,
  target_type text,
  target_id text,
  created_at timestamptz not null default now()
);
create index if not exists vendor_action_log_vendor_idx on public.vendor_action_log(vendor_produksi, created_at desc);

alter table public.vendor_action_log enable row level security;
drop policy if exists "service role full access" on public.vendor_action_log;
create policy "service role full access" on public.vendor_action_log for all
  using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
