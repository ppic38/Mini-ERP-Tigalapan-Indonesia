-- 0051 (2026-09-24, owner: "SKU di WMS jelek karena nama warna beda antara MRP dan Master Data
-- SKU -- BENHUR SPECIAL 24S vs BENHUR 24S, FUCHSIA vs FANTA, PUTIH BLUISH vs PUTIH") -- Master
-- Data baru "Alias Warna": pemetaan nama warna MRP -> nama warna di item_selling_prices (Master
-- Data SKU), supaya wms_resi_snapshot() (migration 0039-0045) bisa mencocokkan SKU walau nama
-- warna PPIC & Master Data SKU tidak persis sama, TANPA mengubah data MRP/SKU yang sudah ada.
--
-- `mrp_warna` unik -- satu nama MRP cuma boleh punya SATU tujuan alias (kalau perlu diganti,
-- update baris yang ada, bukan tambah baris baru). `sku_warna` SENGAJA string bebas (bukan FK ke
-- item_selling_prices) -- tabel itu punya baris per size/lengan, bukan per warna, dan boleh saja
-- alias dibuat sebelum baris SKU-nya ada.

create table if not exists public.warna_aliases (
  id text primary key,
  mrp_warna text not null unique,
  sku_warna text not null,
  catatan text,
  created_at timestamptz not null default now()
);

alter table public.warna_aliases enable row level security;

drop policy if exists "service role full access" on public.warna_aliases;
create policy "service role full access" on public.warna_aliases for all
  using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

-- Redefine get_flow_snapshot_raw() -- isi UTUH disalin dari 0042_material_suppliers.sql (terakhir
-- yang me-redefine fungsi ini), TIDAK ada entri lama yang di-drop/diubah, cuma tambah 1 entri baru
-- 'warna_aliases' di akhir (prinsip additive, lihat 0021_stable_snapshot_order.sql).
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
    'warna_aliases', (select coalesce(jsonb_agg(to_jsonb(t) order by t.mrp_warna), '[]'::jsonb) from warna_aliases t)
  );
$$;

-- wms_resi_snapshot (redefine ulang, isi UTUH disalin dari 0045_wms_resi_snapshot_merge_duplicate_sku.sql,
-- terakhir yang me-redefine fungsi ini) -- SKU dicocokkan APA ADANYA dulu (isp.warna = i.warna),
-- kalau tidak ketemu coba lagi lewat warna_aliases (i.warna -> alias.sku_warna -> isp.warna).
-- Kalau masih tidak ketemu juga, tetap jatuh ke label otomatis seperti sebelumnya (TIDAK ADA yang
-- berubah untuk warna yang SUDAH cocok langsung -- alias murni fallback tambahan).
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
    -- Gabungkan baris item per koli+SKU (warna+lengan+size) -- lihat catatan perbaikan 0045.
    -- SKU dicari APA ADANYA dulu, lalu lewat warna_aliases kalau tidak ketemu (0051).
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
