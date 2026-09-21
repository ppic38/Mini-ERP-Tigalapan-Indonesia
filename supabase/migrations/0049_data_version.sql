-- 0049 (2026-09-21) -- penanda "ada perubahan data?" untuk penghematan egress Supabase.
-- Browser tidak perlu menarik snapshot penuh (get_flow_snapshot_raw, ratusan KB) tiap kali tab
-- difokuskan kalau tidak ada yang berubah: cukup tanya angka versi ini (beberapa byte) dulu.
--
-- Cara kerja: sequence `app_data_version_seq` dinaikkan oleh trigger tingkat-STATEMENT di SEMUA tabel
-- schema public setiap ada INSERT/UPDATE/DELETE/TRUNCATE. `get_data_version()` mengembalikan nilainya.
-- Naik lebih sering dari perlu (mis. transaksi yang di-rollback) aman -- efeknya cuma 1 refetch ekstra.
--
-- AMAN kalau migration ini BELUM dijalankan: kode aplikasi otomatis jatuh ke perilaku lama (selalu
-- ambil snapshot penuh). Kalau nanti ada tabel BARU, jalankan ulang blok DO di bawah (idempotent).

create sequence if not exists public.app_data_version_seq;

create or replace function public.bump_data_version()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform nextval('public.app_data_version_seq');
  return null;
end;
$$;

create or replace function public.get_data_version()
returns bigint
language sql
security definer
set search_path = public
as $$
  select case when is_called then last_value else 0 end from public.app_data_version_seq;
$$;

do $$
declare
  t record;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('drop trigger if exists trg_bump_data_version on public.%I', t.tablename);
    execute format(
      'create trigger trg_bump_data_version after insert or update or delete or truncate on public.%I for each statement execute function public.bump_data_version()',
      t.tablename
    );
  end loop;
end;
$$;
