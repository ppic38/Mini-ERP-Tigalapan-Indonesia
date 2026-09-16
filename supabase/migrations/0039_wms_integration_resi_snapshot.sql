-- Integrasi WMS (WMS-Tigalapan-Indonesia, repo & Supabase project TERPISAH) -- WMS menarik snapshot
-- resi lewat RPC ini (dipanggil server WMS sendiri, lihat wms.../source/server/integration-gateway.js
-- & integration/README.md di repo WMS: kontrak `{snapshotId,totalRows,truncated,rows[]}`).
--
-- SENGAJA BUKAN service_role -- WMS diberi role Postgres BARU yang HANYA boleh EXECUTE fungsi ini,
-- tidak ada akses tabel apa pun secara langsung (owner: "saya cuma ingin WMS terima data pengiriman
-- vendor produksi -- no MRP, no koli, no resi, item yang dikirim -- bukan semua data ERP"). Kalau
-- token WMS suatu saat bocor, yang bisa dilakukan penyerang CUMA memanggil fungsi ini -- tidak bisa
-- baca tabel finance/invoice/password vendor dsb.
create role wms_integration_role nologin;
grant usage on schema public to wms_integration_role;
-- `authenticator` adalah role koneksi PostgREST/Supabase -- wajib di-grant supaya SET ROLE lewat
-- klaim JWT "role":"wms_integration_role" bisa diterima (lihat catatan minting token di bawah).
grant wms_integration_role to authenticator;

create or replace function public.wms_resi_snapshot(p_limit integer default 50000)
returns jsonb
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with resi_scope as (
    -- Cakupan: SEMUA koli yang sudah delivered vendor (delivered_at terisi) -- SAMA seperti yang
    -- tampil di Warehouse > Penerimaan (warehouseReceivableGroups di lib/mrp/derive.ts), TIDAK
    -- dibatasi status invoice/HPP (keputusan owner 2026-09-16: WMS boleh tarik semua yang sudah
    -- dikirim fisik, terlepas dari proses billing internal ERP).
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
      -- PO opsional di kontrak WMS -- ERP tidak punya 1 nomor PO representatif per koli (bisa lebih
      -- dari satu PO material/maklon di belakang 1 MRP), jadi fallback ke nomor resi (sesuai
      -- integration/README.md: "PO opsional, fallback ke nomor resi").
      rs.external_resi_no as po_number,
      -- SKU: cocokkan ke Master Data "Harga Jual per Item" (item_selling_prices.sku, Finance) dulu
      -- lewat warna+lengan+size -- ~77% baris punya SKU asli di situ (lihat migration 0035). Kalau
      -- tidak ketemu, fallback ke kode gabungan otomatis supaya baris tetap terisi (owner: "belum
      -- bisa" tidak masalah, tapi jangan kosong kalau ada cara wajar mengisinya).
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
        -- HPP per item SENGAJA dikosongkan untuk sekarang (owner 2026-09-16: "kosongkan dulu") --
        -- kontrak WMS sudah punya tempatnya (kolom "hpp/item"), tinggal diisi belakangan tanpa
        -- ubah struktur kalau owner berubah pikiran. Null = "belum tersedia" (BUKAN 0/gratis),
        -- sesuai kontrak integration/README.md WMS.
        'hpp/item', null
      ) order by t.external_resi_no, t.koli_id)
      from (select * from rows_all order by external_resi_no, koli_id limit p_limit) t
    ), '[]'::jsonb)
  );
$$;

revoke all on function public.wms_resi_snapshot(integer) from public, anon, authenticated;
grant execute on function public.wms_resi_snapshot(integer) to wms_integration_role;

-- CATATAN untuk sesi Claude berikutnya (minting token WMS_SERVER_KEY):
-- 1. Ambil "JWT Secret" (legacy) dari Supabase Dashboard project ERP ini -- Settings > API > JWT
--    Settings. Nilainya HANYA dipakai lokal untuk membuat token, TIDAK PERNAH ditampilkan di chat
--    atau disimpan di repo mana pun.
-- 2. Buat JWT dengan payload {"role":"wms_integration_role"} (+ "iss"/"iat" opsional), signed HS256
--    pakai JWT Secret itu (lib `jose`, sama seperti lib/auth/session.ts pakai) -- masa berlaku
--    panjang (mis. beberapa tahun), karena ini kredensial server-ke-server yang diganti manual,
--    bukan sesi user.
-- 3. Token hasilnya jadi SUPABASE_SERVER_KEY di environment variable Vercel project WMS
--    (ppic-38/wms-tigalapan-indonesia), BUKAN service_role key ERP. SUPABASE_URL WMS = URL project
--    Supabase ERP ini (nlpnigqwtbsjkxmdxqfz). MINI_ERP_RESI_RPC = "wms_resi_snapshot".
