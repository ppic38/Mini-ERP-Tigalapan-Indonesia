-- 0058 (2026-09-27, owner: skema FOB per-grup + brand + Master Data "Harga FOB") -- lihat diskusi
-- panjang soal template Excel baru yang isinya CAMPUR CMT & FOB dalam 1 file MRP (kolom "CAT PROD"
-- per baris, bukan 1 kategori per file seperti asumsi lama `mrp.is_fob`), plus kolom "BRAND" yang
-- belum ada tempatnya sama sekali di sistem.
--
-- brand          : informasional saja (dari kolom BRAND template, mis. "TIGALAPAN"/"MAMU") --
--                  TIDAK mengubah alur apa pun, murni label/filter.
-- cat_prod       : "CMT" (bahan dari kita, ongkos jahit saja) atau "FOB" (vendor sedia bahan +
--                  jahit, harga jadi per pcs) -- LEVEL GRUP (lengan_groups), bukan lagi level MRP,
--                  karena 1 file bisa campur (contoh: brand MAMU, kategori COMBED = CMT, kategori
--                  CARGO = FOB). Default 'CMT' -- data lama otomatis dianggap CMT, TIDAK perlu
--                  backfill (`mrp.is_fob` LAMA dibiarkan ada, tidak dihapus, supaya kode yang belum
--                  di-update tetap baca nilai lama; akan dibersihkan di migration terpisah setelah
--                  seluruh alur MRP->PO selesai dipindah ke cat_prod per-grup).
--
-- harga_fob      : Master Data baru -- harga jadi per pcs untuk PO Produksi FOB, per vendor
--                  produksi + item (teks bebas, owner: "dari master data, dummy dulu"). Pola sama
--                  seperti harga_maklon (harga per pcs), TAPI key-nya vendor+item (bukan
--                  vendor+lengan+kapasitas) karena harga FOB hasil nego per item, bukan bertingkat
--                  per kapasitas produksi.

alter table mrp add column if not exists brand text;
alter table lengan_groups add column if not exists cat_prod text not null default 'CMT';

create table if not exists public.harga_fob (
  id text primary key,
  vendor_produksi text not null references public.vendors_produksi(id) on delete cascade,
  item text not null,
  harga_per_pcs numeric not null default 0,
  created_at timestamptz not null default now()
);

alter table public.harga_fob enable row level security;
drop policy if exists "service role full access" on public.harga_fob;
create policy "service role full access" on public.harga_fob for all
  using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

-- Data dummy (owner: "saya belum punya datanya jadi buat data dummy saja dulu") -- boleh
-- diedit/dihapus bebas lewat panel Master Data > Harga FOB begitu kode-nya jalan, ini cuma
-- starter supaya tab-nya tidak kosong total & bisa langsung dicoba.
insert into public.harga_fob (id, vendor_produksi, item, harga_per_pcs)
select 'HFOB-DUMMY-1', id, 'CARGO MAMU', 65000 from public.vendors_produksi order by id limit 1
on conflict (id) do nothing;

-- Redefine get_flow_snapshot_raw() -- isi UTUH disalin dari 0051_warna_aliases.sql (terakhir yang
-- me-redefine fungsi ini), TIDAK ada entri lama yang di-drop/diubah, cuma tambah 1 entri baru
-- 'harga_fob' di akhir (prinsip additive, lihat 0021_stable_snapshot_order.sql). Kolom baru
-- `brand`/`cat_prod` di atas TIDAK perlu disentuh di sini -- `to_jsonb(t)` otomatis membawa kolom
-- apa pun yang ada di tabel `mrp`/`lengan_groups` saat ini.
create or replace function get_flow_snapshot_raw()
returns jsonb
language sql
stable
as $$
  select jsonb_build_object(
    'mrp', (select coalesce(jsonb_agg(to_jsonb(t) order by t.created_at, t.id), '[]'::jsonb) from mrp t),
    'lengan_groups', (select coalesce(jsonb_agg(to_jsonb(t) order by t.id), '[]'::jsonb) from lengan_groups t),
    'lengan_group_sizes', (select coalesce(jsonb_agg(to_jsonb(t) order by t.id), '[]'::jsonb) from lengan_group_sizes t),
    'aduan_pola_rows', (select coalesce(jsonb_agg(to_jsonb(t) order by t.id), '[]'::jsonb) from aduan_pola_rows t),
    'aduan_pola_sizes', (select coalesce(jsonb_agg(to_jsonb(t) order by t.id), '[]'::jsonb) from aduan_pola_sizes t),
    'material_rows', (select coalesce(jsonb_agg(to_jsonb(t) order by t.id), '[]'::jsonb) from material_rows t),
    'material_pos', (select coalesce(jsonb_agg(to_jsonb(t) order by t.created_at, t.id), '[]'::jsonb) from material_pos t),
    'material_po_color_breakdown', (select coalesce(jsonb_agg(to_jsonb(t) order by t.id), '[]'::jsonb) from material_po_color_breakdown t),
    'material_po_invoiced_by_color', (select coalesce(jsonb_agg(to_jsonb(t) order by t.material_po_id, t.color_key), '[]'::jsonb) from material_po_invoiced_by_color t),
    'maklon_pos', (select coalesce(jsonb_agg(to_jsonb(t) order by t.id), '[]'::jsonb) from maklon_pos t),
    'maklon_po_cancelled_lines', (select coalesce(jsonb_agg(to_jsonb(t) order by t.id), '[]'::jsonb) from maklon_po_cancelled_lines t),
    'raw_material_invoices', (select coalesce(jsonb_agg(to_jsonb(t) order by t.booked_at, t.id), '[]'::jsonb) from raw_material_invoices t),
    'raw_material_invoice_colors', (select coalesce(jsonb_agg(to_jsonb(t) order by t.id), '[]'::jsonb) from raw_material_invoice_colors t),
    'raw_material_invoice_rolls', (select coalesce(jsonb_agg(to_jsonb(t) order by t.id), '[]'::jsonb) from raw_material_invoice_rolls t),
    'raw_material_invoice_addbuys', (select coalesce(jsonb_agg(to_jsonb(t) order by t.id), '[]'::jsonb) from raw_material_invoice_addbuys t),
    'maklon_invoices', (select coalesce(jsonb_agg(to_jsonb(t) order by t.submitted_at, t.id), '[]'::jsonb) from maklon_invoices t),
    'production_batches', (select coalesce(jsonb_agg(to_jsonb(t) order by t.created_at, t.id), '[]'::jsonb) from production_batches t),
    'production_batch_sizes', (select coalesce(jsonb_agg(to_jsonb(t) order by t.id), '[]'::jsonb) from production_batch_sizes t),
    'production_batch_fg_sizes', (select coalesce(jsonb_agg(to_jsonb(t) order by t.id), '[]'::jsonb) from production_batch_fg_sizes t),
    'production_yield_resolutions', (select coalesce(jsonb_agg(to_jsonb(t) order by t.production_batch_id), '[]'::jsonb) from production_yield_resolutions t),
    'production_results', (select coalesce(jsonb_agg(to_jsonb(t) order by t.recorded_at, t.id), '[]'::jsonb) from production_results t),
    'production_result_sizes', (select coalesce(jsonb_agg(to_jsonb(t) order by t.id), '[]'::jsonb) from production_result_sizes t),
    'production_group_meta', (select coalesce(jsonb_agg(to_jsonb(t) order by t.group_key), '[]'::jsonb) from production_group_meta t),
    'delivery_kolis', (select coalesce(jsonb_agg(to_jsonb(t) order by t.created_at, t.id), '[]'::jsonb) from delivery_kolis t),
    'delivery_koli_items', (select coalesce(jsonb_agg(to_jsonb(t) order by t.id), '[]'::jsonb) from delivery_koli_items t),
    'delivery_koli_batches', (select coalesce(jsonb_agg(to_jsonb(t) order by t.id), '[]'::jsonb) from delivery_koli_batches t),
    'vendor_invoices', (select coalesce(jsonb_agg(to_jsonb(t) order by t.submitted_at, t.id), '[]'::jsonb) from vendor_invoices t),
    'vendor_invoice_lines', (select coalesce(jsonb_agg(to_jsonb(t) order by t.id), '[]'::jsonb) from vendor_invoice_lines t),
    'vendor_invoice_adjustments', (select coalesce(jsonb_agg(to_jsonb(t) order by t.added_at, t.id), '[]'::jsonb) from vendor_invoice_adjustments t),
    'warehouse_receipts', (select coalesce(jsonb_agg(to_jsonb(t) order by t.created_at, t.id), '[]'::jsonb) from warehouse_receipts t),
    'warehouse_receipt_kolis', (select coalesce(jsonb_agg(to_jsonb(t) order by t.id), '[]'::jsonb) from warehouse_receipt_kolis t),
    'warehouse_receipt_items', (select coalesce(jsonb_agg(to_jsonb(t) order by t.id), '[]'::jsonb) from warehouse_receipt_items t),
    'material_claim_history', (select coalesce(jsonb_agg(to_jsonb(t) order by t.id), '[]'::jsonb) from material_claim_history t),
    'vendor_deposits', (select coalesce(jsonb_agg(to_jsonb(t) order by t.created_at, t.id), '[]'::jsonb) from vendor_deposits t),
    'vendors_produksi', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'kategori', kategori, 'base_capacity', base_capacity) order by id), '[]'::jsonb) from vendors_produksi),
    'notifications', (select coalesce(jsonb_agg(to_jsonb(t) order by t.time, t.id), '[]'::jsonb) from notifications t),
    'harga_maklon', (select coalesce(jsonb_agg(to_jsonb(t) order by t.id), '[]'::jsonb) from harga_maklon t),
    'harga_kain', (select coalesce(jsonb_agg(to_jsonb(t) order by t.id), '[]'::jsonb) from harga_kain t),
    'harga_kain_pks', (select coalesce(jsonb_agg(to_jsonb(t) order by t.id), '[]'::jsonb) from harga_kain_pks t),
    'entitas', (select coalesce(jsonb_agg(to_jsonb(t) order by t.id), '[]'::jsonb) from entitas t),
    'suppliers', (select coalesce(jsonb_agg(to_jsonb(t) order by t.id), '[]'::jsonb) from suppliers t),
    'ekspedisi_rates', (select coalesce(jsonb_agg(to_jsonb(t) order by t.id), '[]'::jsonb) from ekspedisi_rates t),
    'item_selling_prices', (select coalesce(jsonb_agg(to_jsonb(t) order by t.id), '[]'::jsonb) from item_selling_prices t),
    'kerah_manset_settings', (select coalesce(jsonb_agg(to_jsonb(t) order by t.kind), '[]'::jsonb) from kerah_manset_settings t),
    'harga_rib', (select coalesce(jsonb_agg(to_jsonb(t) order by t.id), '[]'::jsonb) from harga_rib t),
    'harga_kerah_manset', (select coalesce(jsonb_agg(to_jsonb(t) order by t.id), '[]'::jsonb) from harga_kerah_manset t),
    'material_suppliers', (select coalesce(jsonb_agg(to_jsonb(t) order by t.id), '[]'::jsonb) from material_suppliers t),
    'warna_aliases', (select coalesce(jsonb_agg(to_jsonb(t) order by t.mrp_warna), '[]'::jsonb) from warna_aliases t),
    'harga_fob', (select coalesce(jsonb_agg(to_jsonb(t) order by t.id), '[]'::jsonb) from harga_fob t)
  );
$$;

-- Redefine get_flow_snapshot_core() (migration 0050) -- tambah 'harga_fob' ke daftar tabel master
-- yang dibuang dari snapshot "core" (hemat egress). Isi fungsi tidak berubah selain array ini.
create or replace function public.get_flow_snapshot_core()
returns jsonb
language sql
security definer
set search_path = public
as $$
  select public.get_flow_snapshot_raw() - array['harga_maklon', 'harga_kain', 'harga_kain_pks', 'harga_rib', 'harga_kerah_manset', 'item_selling_prices', 'harga_fob'];
$$;

-- harga_fob ikut trigger versi master (migration 0050) -- jarang berubah, boleh di-skip snapshot
-- kalau versinya sama seperti 6 tabel master lain.
drop trigger if exists trg_bump_master_version on public.harga_fob;
create trigger trg_bump_master_version after insert or update or delete or truncate on public.harga_fob
  for each statement execute function public.bump_master_data_version();

-- harga_fob (tabel BARU) ikut trigger versi data umum (migration 0049) -- jalankan ulang blok DO
-- idempotent itu supaya trigger `trg_bump_data_version` juga terpasang di tabel baru ini (tabel
-- lain yang sudah ada sebelumnya tidak terpengaruh, cuma di-drop+create ulang triggernya, sama).
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
