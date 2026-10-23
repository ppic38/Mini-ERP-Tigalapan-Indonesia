-- 0074 (2026-10-23, permintaan owner): reject boleh masuk koli pengiriman (delivery_koli_items.kind = 'REJECT'), tetapi reject TIDAK
-- boleh ikut ke WMS sebagai stok. wms_resi_snapshot() (terakhir didefinisikan di 0051) di-redefine dengan dua perubahan:
--   1. items_merged hanya menghitung item yang BUKAN reject.
--   2. resi_scope hanya memuat koli yang punya minimal satu item bukan-reject, supaya total_koli yang dilihat WMS cocok dengan
--      baris yang benar-benar dikirim (koli yang isinya reject semua tidak dihitung).
-- Isi fungsi selebihnya disalin UTUH dari 0051. Aman dijalankan berulang (create or replace).
-- JALANKAN MIGRATION INI SEBELUM vendor mulai mengirim reject, kalau tidak reject yang dikirim akan terbaca WMS sebagai barang biasa.
create or replace function public.wms_resi_snapshot(p_limit integer default 50000)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with resi_scope as (
    select
      k.id as koli_id,
      coalesce(k.resi_group_id, k.id) as resi_key,
      coalesce(k.no_resi, k.id) as external_resi_no,
      v.name as vendor_name,
      k.delivered_at,
      k.ekspedisi,
      k.no_koli,
      k.created_at
    from delivery_kolis k
    join vendors_produksi v on v.id = k.vendor_produksi
    where k.delivered_at is not null
      and exists (
        select 1 from delivery_koli_items ki
        where ki.delivery_koli_id = k.id and coalesce(ki.kind, 'FG') <> 'REJECT'
      )
  ),
  resi_totals as (
    select resi_key, count(distinct koli_id) as total_koli
    from resi_scope
    group by resi_key
  ),
  items_merged as (
    -- Gabungkan baris item per koli+SKU (warna+lengan+size) -- lihat catatan perbaikan 0045.
    -- SKU dicari APA ADANYA dulu, lalu lewat warna_aliases kalau tidak ketemu (0051). Reject tidak ikut (0074).
    select
      i.delivery_koli_id as koli_id,
      coalesce(
        isp.sku,
        isp_alias.sku,
        upper(i.warna) || '-' || i.lengan::text || '-' || i.size
      ) as sku,
      sum(i.qty) as qty
    from delivery_koli_items i
    left join item_selling_prices isp
      on isp.warna = i.warna and isp.lengan = i.lengan::text and isp.size = i.size
    left join warna_aliases wa
      on wa.mrp_warna = i.warna and isp.sku is null
    left join item_selling_prices isp_alias
      on isp_alias.warna = wa.sku_warna and isp_alias.lengan = i.lengan::text and isp_alias.size = i.size
    where coalesce(i.kind, 'FG') <> 'REJECT'
    group by
      i.delivery_koli_id,
      coalesce(isp.sku, isp_alias.sku, upper(i.warna) || '-' || i.lengan::text || '-' || i.size)
  ),
  rows_all as (
    select
      rs.external_resi_no,
      rs.vendor_name,
      rs.delivered_at,
      rs.ekspedisi,
      rt.total_koli,
      rs.no_koli as vendor_koli_no,
      rs.external_resi_no as po_number,
      im.sku,
      im.qty,
      rs.koli_id
    from resi_scope rs
    join resi_totals rt on rt.resi_key = rs.resi_key
    join items_merged im on im.koli_id = rs.koli_id
  ),
  counted as (
    select count(*) as n from rows_all
  )
  select jsonb_build_object(
    'snapshotId', md5(
      (select n from counted)::text || '|' ||
      coalesce((select max(created_at) from resi_scope)::text, '') || '|' ||
      coalesce((select max(delivered_at) from resi_scope)::text, '')
    ),
    'totalRows', (select n from counted),
    'truncated', (select n from counted) > p_limit,
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
        'externalResiNo', t.external_resi_no,
        'vendorName', t.vendor_name,
        'shippingDate', to_char(t.delivered_at, 'YYYY-MM-DD'),
        'expedition', coalesce(t.ekspedisi, ''),
        'totalKoli', t.total_koli,
        'vendorKoliNo', coalesce(t.vendor_koli_no, ''),
        'poNumber', t.po_number,
        'sku', t.sku,
        'qty', t.qty,
        'hpp/item', null
      ) order by t.external_resi_no, t.koli_id)
      from (select * from rows_all order by external_resi_no, koli_id limit p_limit) t
    ), '[]'::jsonb)
  );
$$;

revoke all on function public.wms_resi_snapshot(integer) from public, anon, authenticated;
grant execute on function public.wms_resi_snapshot(integer) to wms_integration_role;
