-- Master Data "Harga RIB" (harga RIB per kg, per supplier + warna, live) -- sumber estimasi Rp RIB
-- di PO Approval Procurement (Rib kg x harga/kg), melengkapi estimasi Kerah/Manset yang sudah ada
-- (kerah_manset_settings, migration 0036). Bentuk kolom sengaja mengikuti harga_kain (tanpa
-- `kategori` -- RIB tidak dibedakan per kategori kain), bisa di-CRUD Procurement/Finance dari
-- halaman Master Data.
create table harga_rib (
  id text primary key,
  kode_supplier text not null,
  nama_supplier text not null,
  warna text not null,
  harga_per_kg numeric not null default 0
);

-- RLS: sama pola tabel master data lain (harga_kain dst, lihat 0001_init.sql) -- aktif, TANPA
-- policy (default deny untuk anon/authenticated, service role selalu bypass).
alter table harga_rib enable row level security;

-- Seed 41 baris dari price list KNITTO kategori COMBED 24S (kolom "RIB 1 KG", 2026-09-15, dari
-- owner). Kolom "HARGA WARNA KG" di sheet yang sama sudah dicocokkan 41/41 ke harga_kain KNITTO.
-- Nama warna mengikuti harga_kain (keputusan owner): "FUCHSIA 24S" di sheet = "FANTA 24S",
-- "HITAM REAKTIF 24S" di sheet = "HITAM 24S". BENHUR SPECIAL 24S Rp 214.000 memang BENAR
-- (dikonfirmasi owner) walau warna lain polanya harga warna + 9.000. Salinan ke 6 supplier lain ada
-- di 0038_harga_kerah_manset_supplier.sql (diputuskan setelah file ini dijalankan); supplier yang
-- kelak ditambahkan TANPA baris sendiri tetap memakai harga KNITTO untuk warna yang sama (lihat
-- hargaRibRateInfo di lib/mrp/derive.ts).
insert into harga_rib (id, kode_supplier, nama_supplier, warna, harga_per_kg) values
  ('HRIB-000001', 'KNITTO', 'KNITTO', 'MERAH CABE 24S', 127000),
  ('HRIB-000002', 'KNITTO', 'KNITTO', 'MAROON 24S', 127000),
  ('HRIB-000003', 'KNITTO', 'KNITTO', 'BURGUNDY 24S', 127000),
  ('HRIB-000004', 'KNITTO', 'KNITTO', 'BLUSH RED 24S', 124000),
  ('HRIB-000005', 'KNITTO', 'KNITTO', 'SALMON RED 24S', 124000),
  ('HRIB-000006', 'KNITTO', 'KNITTO', 'SALEM 24S', 121000),
  ('HRIB-000007', 'KNITTO', 'KNITTO', 'FANTA 24S', 127000),
  ('HRIB-000008', 'KNITTO', 'KNITTO', 'LILAC 24S', 121000),
  ('HRIB-000009', 'KNITTO', 'KNITTO', 'PINK 24S', 121000),
  ('HRIB-000010', 'KNITTO', 'KNITTO', 'ORANGE 24S', 124000),
  ('HRIB-000011', 'KNITTO', 'KNITTO', 'ORANGE BATA 24S', 127000),
  ('HRIB-000012', 'KNITTO', 'KNITTO', 'MUSTARD 24S', 124000),
  ('HRIB-000013', 'KNITTO', 'KNITTO', 'DARK MUSTARD 24S', 127000),
  ('HRIB-000014', 'KNITTO', 'KNITTO', 'HONEY 24S', 124000),
  ('HRIB-000015', 'KNITTO', 'KNITTO', 'KUNING KENARI 24S', 124000),
  ('HRIB-000016', 'KNITTO', 'KNITTO', 'ELECTRIC LIME 24S', 124000),
  ('HRIB-000017', 'KNITTO', 'KNITTO', 'HIJAU FUJI 24S', 127000),
  ('HRIB-000018', 'KNITTO', 'KNITTO', 'HIJAU BOTOL SPECIAL 24S', 127000),
  ('HRIB-000019', 'KNITTO', 'KNITTO', 'ARMY GREEN 24S', 127000),
  ('HRIB-000020', 'KNITTO', 'KNITTO', 'CACTUS GREEN 24S', 127000),
  ('HRIB-000021', 'KNITTO', 'KNITTO', 'SAGE GREEN 24S', 124000),
  ('HRIB-000022', 'KNITTO', 'KNITTO', 'TOSCA 24S', 127000),
  ('HRIB-000023', 'KNITTO', 'KNITTO', 'TOSCA MUDA 24S', 121000),
  ('HRIB-000024', 'KNITTO', 'KNITTO', 'TURKIS 24S', 127000),
  ('HRIB-000025', 'KNITTO', 'KNITTO', 'SKY BLUE 24S', 121000),
  ('HRIB-000026', 'KNITTO', 'KNITTO', 'DEEP BLUE 24S', 127000),
  ('HRIB-000027', 'KNITTO', 'KNITTO', 'STEEL BLUE 24S', 124000),
  ('HRIB-000028', 'KNITTO', 'KNITTO', 'BENHUR SPECIAL 24S', 214000),
  ('HRIB-000029', 'KNITTO', 'KNITTO', 'NAVY 24S', 127000),
  ('HRIB-000030', 'KNITTO', 'KNITTO', 'UNGU TUA 24S', 127000),
  ('HRIB-000031', 'KNITTO', 'KNITTO', 'CREAM 24S', 121000),
  ('HRIB-000032', 'KNITTO', 'KNITTO', 'BEIGE 24S', 121000),
  ('HRIB-000033', 'KNITTO', 'KNITTO', 'COKLAT SUSU 24S', 124000),
  ('HRIB-000034', 'KNITTO', 'KNITTO', 'COKLAT KOPI 24S', 127000),
  ('HRIB-000035', 'KNITTO', 'KNITTO', 'CINNAMON 24S', 127000),
  ('HRIB-000036', 'KNITTO', 'KNITTO', 'ABU MUDA 24S', 121000),
  ('HRIB-000037', 'KNITTO', 'KNITTO', 'ABU TUA 24S', 127000),
  ('HRIB-000038', 'KNITTO', 'KNITTO', 'HITAM 24S', 127000),
  ('HRIB-000039', 'KNITTO', 'KNITTO', 'PUTIH BLUISH 24S', 116000),
  ('HRIB-000040', 'KNITTO', 'KNITTO', 'MAGENTA 24S', 127000),
  ('HRIB-000041', 'KNITTO', 'KNITTO', 'OLIVE GREEN 24S', 124000);

-- Redefine get_flow_snapshot_raw() -- isi UTUH disalin dari 0036_kerah_manset_settings.sql
-- (terakhir yang me-redefine fungsi ini), TIDAK ada entri lama yang di-drop, cuma tambah 1 entri
-- baru 'harga_rib' di akhir (prinsip additive, lihat 0021_stable_snapshot_order.sql).
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
    'harga_rib', (select coalesce(jsonb_agg(to_jsonb(t) order by t.id), '[]'::jsonb) from harga_rib t)
  );
$$;
