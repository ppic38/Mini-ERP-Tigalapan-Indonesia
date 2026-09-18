-- Perbaikan wms_resi_snapshot (0039/0040): WMS menolak "Baris SKU + PO dalam koli duplikat"
-- (phase1.js validatePackingList) begitu 1 koli punya >1 baris delivery_koli_items dengan
-- warna+lengan+size (jadi SKU) yang SAMA -- kejadian nyata (terverifikasi 2026-09-18, koli
-- MKS 01 resi JXS2182312312: 2 baris terpisah "CREAM 24S PANJANG L 50pcs"). Di ERP ini valid
-- (dientri sebagai baris terpisah saat packing), tapi kontrak WMS mengasumsikan 1 baris = 1
-- SKU per koli (lihat "Baris SKU + PO dalam koli duplikat" di WMS, itu proteksi anti dobel-hitung
-- qty, BUKAN bug).
--
-- Fix: gabungkan (SUM qty) baris item per koli+SKU SEBELUM dikirim ke WMS -- total qty per koli
-- tidak berubah, cuma jumlah barisnya yang dirapikan jadi 1 per SKU. TIDAK mengubah data
-- delivery_koli_items ERP sama sekali, murni bentuk output RPC snapshot ini.
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
  ),
  resi_totals as (
    select resi_key, count(distinct koli_id) as total_koli
    from resi_scope
    group by resi_key
  ),
  items_merged as (
    -- Gabungkan baris item per koli+SKU (warna+lengan+size) -- lihat catatan perbaikan di atas.
    select
      i.delivery_koli_id as koli_id,
      coalesce(isp.sku, upper(i.warna) || '-' || i.lengan::text || '-' || i.size) as sku,
      sum(i.qty) as qty
    from delivery_koli_items i
    left join item_selling_prices isp
      on isp.warna = i.warna and isp.lengan = i.lengan::text and isp.size = i.size
    group by i.delivery_koli_id, coalesce(isp.sku, upper(i.warna) || '-' || i.lengan::text || '-' || i.size)
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
