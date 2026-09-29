-- 0060 (2026-09-29, owner: "saya ingin bisa set untuk create akun, di mana satu modul itu bisa
-- multiuser. Misal procurement ternyata ada dua orang dengan nama fulan dan fulin... biar tau
-- saat suatu PO atau PV itu approve itu oleh procurement, tapi siapa PIC-nya") -- meniru PERSIS
-- pola vendor_users/vendor_action_log (migration 0057), diterapkan ke SEMUA modul internal
-- (PPIC/Procurement/Finance/SCM/GM/Produksi/Warehouse/Sysadmin), bukan cuma satu.
--
-- `internal_role_users`: akun anggota tim SATU modul internal. `username` unik SE-APLIKASI (login
-- langsung pakai username, tidak perlu pilih modul dulu -- sama seperti vendor_users). `role` =
-- InternalRole (lib/internal-auth.ts) -- TIDAK ada foreign key (bukan tabel referensi, cukup
-- text). Akun UTAMA tiap modul (password bersama, lib/auth/actions.ts loginInternalAction / tabel
-- internal_accounts migration 0056) TIDAK punya baris di sini & tetap akses penuh seperti biasa --
-- baris di sini murni akun tambahan supaya aksi bisa diatribusikan ke orang tertentu.
create table if not exists public.internal_role_users (
  id text primary key,
  role text not null,
  username text not null unique,
  name text not null,
  password_hash text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists internal_role_users_role_idx on public.internal_role_users(role);

alter table public.internal_role_users enable row level security;
drop policy if exists "service role full access" on public.internal_role_users;
create policy "service role full access" on public.internal_role_users for all
  using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

-- `internal_action_log`: jejak "siapa klik apa" untuk modul internal -- pola sama vendor_action_log,
-- diisi best-effort (lihat logInternalAction, lib/mrp/actions.ts) di titik-titik aksi penting
-- (approval PO Material/Maklon jadi contoh pertama; titik lain bisa menyusul tanpa migration baru).
-- Akun UTAMA modul tetap tercatat (actor_name = label modul, mis. "Procurement") supaya 1 tabel ini
-- konsisten mencakup semua aksi, bukan cuma anggota tim.
create table if not exists public.internal_action_log (
  id text primary key,
  role text not null,
  internal_user_id text references public.internal_role_users(id) on delete set null,
  actor_name text not null,
  action text not null,
  target_type text,
  target_id text,
  created_at timestamptz not null default now()
);
create index if not exists internal_action_log_role_idx on public.internal_action_log(role, created_at desc);

alter table public.internal_action_log enable row level security;
drop policy if exists "service role full access" on public.internal_action_log;
create policy "service role full access" on public.internal_action_log for all
  using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
