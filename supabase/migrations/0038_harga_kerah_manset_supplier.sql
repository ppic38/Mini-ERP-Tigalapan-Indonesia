-- Master Data "Harga Kerah/Manset per Supplier" (harga per kg, live) -- sumber estimasi Rp Kerah &
-- Manset di PO Approval Procurement, menggantikan harga GLOBAL `kerah_manset_settings.harga_per_kg`
-- (migration 0036) sebagai sumber utama. `kerah_manset_settings` TETAP dipakai untuk konversi
-- pcs->kg (`kg_per_pcs`), dan `harga_per_kg`-nya jadi fallback terakhir (lihat
-- hargaKerahMansetRateInfo di lib/mrp/derive.ts): supplier sendiri -> KNITTO -> global.
--
-- WAJIB dijalankan SETELAH 0037_harga_rib.sql -- get_flow_snapshot_raw() di bawah menyertakan
-- 'harga_rib' dari migration itu.
create table harga_kerah_manset (
  id text primary key,
  kode_supplier text not null,
  nama_supplier text not null,
  harga_kerah_per_kg numeric not null default 0,
  harga_manset_per_kg numeric not null default 0
);

-- RLS: sama pola tabel master data lain (harga_kain dst, lihat 0001_init.sql) -- aktif, TANPA
-- policy (default deny untuk anon/authenticated, service role selalu bypass).
alter table harga_kerah_manset enable row level security;

-- Seed default dari owner (2026-09-15): Rp 100.000/kg untuk Kerah & Manset, HANYA untuk supplier yang
-- menjual kategori WANGKI MYNO di harga_kain (dicek 2026-09-15: KNITTO, FABRIKU, ALMEGATEX -- kerah/
-- manset cuma ada di kategori itu). Kode = nama, persis seperti di harga_kain. Placeholder sampai
-- harga asli per supplier diketahui, bisa diedit/ditambah dari Master Data > Kerah/Manset.
insert into harga_kerah_manset (id, kode_supplier, nama_supplier, harga_kerah_per_kg, harga_manset_per_kg) values
  ('HKM-000001', 'KNITTO', 'KNITTO', 100000, 100000),
  ('HKM-000002', 'FABRIKU', 'FABRIKU', 100000, 100000),
  ('HKM-000003', 'ALMEGATEX', 'ALMEGATEX', 100000, 100000);

-- Harga RIB (lanjutan 0037, owner 2026-09-15): supplier lain belum punya price list RIB sendiri --
-- baris KNITTO di harga_rib DISALIN ke 6 supplier lain yang ada di harga_kain (kode = nama, persis
-- seperti di harga_kain), TAPI HANYA untuk warna yang memang dijual supplier itu di harga_kain
-- (kategori apa pun) -- mengikuti pembatasan dropdown supplier per warna di PO Approval
-- (materialSupplierNamesForWarna). Hasil dicek 2026-09-15: KNITTO 41 + NIRWANA 26 + FABRIKU 20 +
-- TEBEKA 13 + MULIA LESTARI 9 + ALMEGATEX 2 + DN TEXTILE 2 = 113 baris. Ditaruh di sini (bukan di
-- 0037) karena 0037 versi 41-baris SUDAH dijalankan di Supabase sebelum keputusan ini. ID lanjut
-- dari jumlah baris yang ada, dan `not exists` menjaga supaya supplier+warna yang sudah ada tidak
-- terduplikasi.
insert into harga_rib (id, kode_supplier, nama_supplier, warna, harga_per_kg)
select
  'HRIB-' || lpad(((select count(*) from harga_rib) + row_number() over (order by s.urutan, k.id))::text, 6, '0'),
  s.kode,
  s.kode,
  k.warna,
  k.harga_per_kg
from harga_rib k
cross join (values
  (1, 'FABRIKU'),
  (2, 'TEBEKA'),
  (3, 'NIRWANA'),
  (4, 'MULIA LESTARI'),
  (5, 'ALMEGATEX'),
  (6, 'DN TEXTILE')
) as s(urutan, kode)
where k.kode_supplier = 'KNITTO'
  and exists (
    select 1 from harga_kain hk where hk.kode_supplier = s.kode and hk.warna = k.warna
  )
  and not exists (
    select 1 from harga_rib x where x.kode_supplier = s.kode and x.warna = k.warna
  );

-- Redefine get_flow_snapshot_raw() -- isi UTUH disalin dari 0037_harga_rib.sql (terakhir yang
-- me-redefine fungsi ini), TIDAK ada entri lama yang di-drop, cuma tambah 1 entri baru
-- 'harga_kerah_manset' di akhir (prinsip additive, lihat 0021_stable_snapshot_order.sql).
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
    -- Migration 0031 (Portal Warehouse) -- 3 entri baru, `order by` stabil sama pola tabel lain.
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
    'harga_kerah_manset', (select coalesce(jsonb_agg(to_jsonb(t) order by t.id), '[]'::jsonb) from harga_kerah_manset t)
  );
$$;
