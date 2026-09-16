-- Perbaikan 0039: wms_resi_snapshot() dibuat `security invoker` -- artinya fungsi jalan pakai hak
-- akses PEMANGGILNYA (wms_integration_role), yang SENGAJA tidak diberi akses tabel apa pun secara
-- langsung (cuma EXECUTE fungsi ini). Akibatnya fungsi gagal "permission denied for table
-- delivery_kolis" begitu benar-benar dites dari role itu (terverifikasi 2026-09-16 lewat token
-- WMS asli -- apikey=anon key project, Authorization=Bearer token role wms_integration_role;
-- request diterima gateway & role WMS aktif, TAPI query di dalam fungsi ditolak RLS/grant tabel).
--
-- Fix: `security definer` -- fungsi jalan pakai hak akses PEMBUAT fungsi (superuser SQL Editor,
-- bypass RLS by design), sementara wms_integration_role TETAP HANYA punya EXECUTE ke fungsi ini,
-- tidak ada SELECT langsung ke tabel mana pun. `search_path` tetap dikunci ke public,pg_temp
-- (wajib untuk SECURITY DEFINER, mencegah search_path hijacking).
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
  rows_all as (
    select
      rs.external_resi_no,
      rs.vendor_name,
      rs.delivered_at,
      rs.ekspedisi,
      rt.total_koli,
      rs.no_koli as vendor_koli_no,
      rs.external_resi_no as po_number,
      coalesce(isp.sku, upper(i.warna) || '-' || i.lengan::text || '-' || i.size) as sku,
      i.qty,
      rs.koli_id
    from resi_scope rs
    join resi_totals rt on rt.resi_key = rs.resi_key
    join delivery_koli_items i on i.delivery_koli_id = rs.koli_id
    left join item_selling_prices isp
      on isp.warna = i.warna and isp.lengan = i.lengan::text and isp.size = i.size
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
