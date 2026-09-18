-- Perbaikan 0043: wms_master_sku_snapshot() dibuat `security invoker` -- bug yang SAMA PERSIS
-- dengan wms_resi_snapshot di 0039 (lihat 0040_wms_resi_snapshot_security_definer.sql) --
-- terverifikasi 2026-09-18 lewat token WMS asli: gateway & role wms_integration_role aktif, TAPI
-- query ke item_selling_prices di dalam fungsi ditolak (permission denied -- muncul sebagai HTTP
-- 403 di WMS, "Sistem tujuan menolak permintaan").
--
-- Fix: `security definer`, sama seperti 0040 -- fungsi jalan pakai hak akses pembuat fungsi
-- (superuser SQL Editor, bypass RLS/grant tabel by design), wms_integration_role TETAP HANYA
-- punya EXECUTE ke fungsi ini, tidak ada SELECT langsung ke tabel mana pun. `search_path` tetap
-- dikunci ke public,pg_temp (wajib untuk SECURITY DEFINER, mencegah search_path hijacking).
create or replace function public.wms_master_sku_snapshot(p_limit integer default 50000)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with scope as (
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
