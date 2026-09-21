-- 0050 (2026-09-21) -- penghematan egress Supabase, tahap 2: data MASTER HARGA tidak ikut ditarik
-- di setiap refresh snapshot kalau tidak berubah. (Lanjutan 0049 -- jalankan 0049 dulu.)
--
-- Tabel master harga (harga_maklon, harga_kain, harga_kain_pks, harga_rib, harga_kerah_manset,
-- item_selling_prices) jarang berubah tapi ukurannya besar (item_selling_prices ~2000+ baris).
-- Browser mengirim "versi master" yang ia pegang; server hanya menarik tabel-tabel itu kalau versinya
-- sudah berbeda. Perubahan harga tetap langsung terlihat karena trigger di bawah menaikkan versinya.
--
-- AMAN kalau BELUM dijalankan: kode otomatis kembali menarik snapshot penuh seperti sebelumnya.

create sequence if not exists public.master_data_version_seq;

create or replace function public.bump_master_data_version()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform nextval('public.master_data_version_seq');
  return null;
end;
$$;

create or replace function public.get_master_data_version()
returns bigint
language sql
security definer
set search_path = public
as $$
  select case when is_called then last_value else 0 end from public.master_data_version_seq;
$$;

do $$
declare
  t text;
begin
  foreach t in array array['harga_maklon', 'harga_kain', 'harga_kain_pks', 'harga_rib', 'harga_kerah_manset', 'item_selling_prices']
  loop
    execute format('drop trigger if exists trg_bump_master_version on public.%I', t);
    execute format(
      'create trigger trg_bump_master_version after insert or update or delete or truncate on public.%I for each statement execute function public.bump_master_data_version()',
      t
    );
  end loop;
end;
$$;

-- Snapshot TANPA 6 tabel master di atas -- dibentuk dari get_flow_snapshot_raw() (definisi apa pun
-- yang sedang berlaku), jadi tidak perlu menyalin ulang fungsi besar itu. Yang dikirim ke server
-- (egress) hanya hasil akhirnya.
create or replace function public.get_flow_snapshot_core()
returns jsonb
language sql
security definer
set search_path = public
as $$
  select public.get_flow_snapshot_raw() - array['harga_maklon', 'harga_kain', 'harga_kain_pks', 'harga_rib', 'harga_kerah_manset', 'item_selling_prices'];
$$;
