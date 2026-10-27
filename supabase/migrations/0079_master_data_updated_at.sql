-- 0079 (2026-10-27): tanggal "terakhir diupdate" di semua Master Data (kolom "Terakhir diupdate" di tabel Master Data).
-- Kolom `updated_at` baru (nullable): baris yang sudah ada SENGAJA dibiarkan kosong (tampil "-") supaya tidak semuanya berpura-pura
-- diupdate hari ini; baris baru dan baris yang berubah sesudah migration ini terisi otomatis lewat trigger.
-- Trigger hanya mengisi kalau isi baris benar-benar berubah (menyimpan ulang nilai yang sama tidak mengubah tanggal).
-- Tidak ada data yang berubah. Aman dijalankan berulang.

create or replace function public.touch_updated_at() returns trigger language plpgsql as $fn$
begin
  if to_jsonb(new) is distinct from to_jsonb(old) then
    new.updated_at := now();
  end if;
  return new;
end;
$fn$;

-- Vendor produksi: baris yang sama juga dipakai login (password, pengaturan persetujuan cutting), jadi tanggal hanya bergerak kalau
-- yang berubah data master-nya (nama, kategori, kapasitas per minggu).
create or replace function public.touch_updated_at_vendor() returns trigger language plpgsql as $fn$
begin
  if new.name is distinct from old.name or new.kategori is distinct from old.kategori or new.base_capacity is distinct from old.base_capacity then
    new.updated_at := now();
  end if;
  return new;
end;
$fn$;

do $$
declare
  t text;
begin
  foreach t in array array[
    'harga_maklon', 'harga_kain', 'harga_kain_pks', 'harga_rib', 'harga_fob', 'ekspedisi_rates', 'harga_kerah_manset',
    'kerah_manset_settings', 'material_suppliers', 'suppliers', 'entitas', 'warna_aliases', 'vendors_produksi', 'item_selling_prices'
  ] loop
    execute format('alter table public.%I add column if not exists updated_at timestamptz', t);
    execute format('alter table public.%I alter column updated_at set default now()', t);
    if t = 'vendors_produksi' then
      execute format('drop trigger if exists trg_touch_updated_at on public.%I', t);
      execute format('create trigger trg_touch_updated_at before update on public.%I for each row execute function public.touch_updated_at_vendor()', t);
    else
      execute format('drop trigger if exists trg_touch_updated_at on public.%I', t);
      execute format('create trigger trg_touch_updated_at before update on public.%I for each row execute function public.touch_updated_at()', t);
    end if;
  end loop;
end $$;
