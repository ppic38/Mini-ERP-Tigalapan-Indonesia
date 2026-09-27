-- 0056 (2026-09-27, owner: modul Sysadmin/super admin -- bisa membatalkan PO yang sudah diapprove
-- "just in case ada kesalahan data", dan mengelola/reset password akun modul lain) --
--
-- 1. `internal_accounts`: password 7 modul internal (PPIC/Procurement/Finance/SCM/GM/Produksi/
--    Warehouse) DIPINDAH dari env var (INTERNAL_PASSWORD_<ROLE>, plaintext di Vercel) ke sini
--    (bcrypt hash, sama pola dengan vendors_produksi.password_hash). loginInternalAction (lib/
--    auth/actions.ts) sekarang cek baris DB ini DULU; kalau belum ada baris untuk role itu,
--    FALLBACK ke env var lama (additive, tidak mem-break login yang sudah jalan sebelum owner
--    sempat set password lewat Sysadmin). Begitu Sysadmin set password sekali, baris DB ini yang
--    dipakai seterusnya untuk role itu -- env var lama boleh dibiarkan atau dihapus dari Vercel.
--
-- 2. `sysadmin_audit_log`: riwayat PERMANEN tiap aksi Sysadmin (reset password, cancel PO, dst)
--    -- alasan WAJIB, snapshot before/after data yang diubah. Read-only dari UI (tidak ada tombol
--    hapus di app), murni pertanggungjawaban ("siapa ubah apa, kapan, kenapa").

create table if not exists public.internal_accounts (
  role text primary key,
  password_hash text not null,
  updated_at timestamptz not null default now()
);

alter table public.internal_accounts enable row level security;
drop policy if exists "service role full access" on public.internal_accounts;
create policy "service role full access" on public.internal_accounts for all
  using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

create table if not exists public.sysadmin_audit_log (
  id text primary key,
  action text not null,
  target_type text not null,
  target_id text not null,
  reason text not null,
  before jsonb,
  after jsonb,
  created_at timestamptz not null default now()
);
create index if not exists sysadmin_audit_log_target_idx on public.sysadmin_audit_log (target_type, target_id);

alter table public.sysadmin_audit_log enable row level security;
drop policy if exists "service role full access" on public.sysadmin_audit_log;
create policy "service role full access" on public.sysadmin_audit_log for all
  using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
