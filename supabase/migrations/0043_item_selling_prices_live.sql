-- Master Data "SKU (Harga Jual per Item)" jadi live (owner 2026-09-18) -- sebelumnya cuma seed
-- sekali via migration 0035, TIDAK ADA CRUD/halaman sama sekali (lihat komentar 0035). Sekarang
-- PPIC bisa tambah/edit/hapus lewat halaman baru Master Data > /mrp/ppic/master-data (kode di
-- lib/mrp/actions.ts + components/mrp/item-selling-price-panel.tsx).
--
-- Alasan utama: integrasi WMS. wms_resi_snapshot (migration 0039) mencocokkan SKU koli ke tabel
-- ini, tapi WMS punya katalog "Master SKU" SENDIRI (terpisah total, tersimpan di IndexedDB
-- browser WMS) yang harus didaftarkan manual di sana dulu -- kalau SKU belum terdaftar di WMS,
-- import resi ke Receiving ditolak WMS ("SKU belum ada / tidak aktif di Master SKU"). RPC baru di
-- bawah (wms_master_sku_snapshot) memberi WMS cara menarik daftar SKU terbaru dari ERP ini
-- (pola sama seperti wms_resi_snapshot: WMS yang menarik, bukan ERP yang mendorong; role
-- wms_integration_role yang sudah ada dipakai lagi, TIDAK ada tabel baru yang diberi akses
-- langsung) supaya WMS bisa auto-sinkron Master SKU-nya sendiri saat ada SKU baru/berubah.
alter table item_selling_prices add column if not exists updated_at timestamptz not null default now();

create or replace function public.wms_master_sku_snapshot(p_limit integer default 50000)
returns jsonb
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with scope as (
    -- Hanya baris yang SUDAH punya SKU asli -- baris tanpa SKU (482/2139 dari seed awal) tidak
    -- relevan buat WMS (tidak akan pernah muncul di wms_resi_snapshot juga, lihat migration 0039
    -- yang fallback ke kode gabungan warna+lengan+size kalau sku null, BUKAN sku asli).
    select id, sku, item_name, kategori, warna, lengan, size, price, updated_at
    from item_selling_prices
    where sku is not null and trim(sku) <> ''
  ),
  counted as (select count(*) as n from scope)
  select jsonb_build_object(
    'snapshotId', md5(
      (select n from counted)::text || '|' ||
      coalesce((select max(updated_at) from scope)::text, '')
    ),
    'totalRows', (select n from counted),
    'truncated', (select n from counted) > p_limit,
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
        'sku', t.sku,
        'itemName', t.item_name,
        'kategori', t.kategori,
        'warna', t.warna,
        'lengan', t.lengan,
        'size', t.size,
        'price', t.price,
        'updatedAt', t.updated_at
      ) order by t.sku)
      from (select * from scope order by sku limit p_limit) t
    ), '[]'::jsonb)
  );
$$;

revoke all on function public.wms_master_sku_snapshot(integer) from public, anon, authenticated;
grant execute on function public.wms_master_sku_snapshot(integer) to wms_integration_role;
