-- Duplikat MRP W40 -> W43_TEST (hanya tahap "PPIC sudah upload MRP").
-- Yang disalin: mrp, lengan_groups (+sizes), aduan_pola_rows (+sizes), material_rows.
-- Tidak disalin: PO material/maklon, invoice, produksi, pengiriman.
-- Aman dijalankan ulang: berhenti bila W43_TEST sudah ada.
begin;

do $$
begin
  if exists (select 1 from public.mrp where id = 'W43_TEST') then
    raise exception 'MRP W43_TEST sudah ada, tidak ada yang disalin.';
  end if;
end $$;

-- 1) Header MRP: status Menunggu Approval SCM (seperti hasil upload PPIC), jejak approval/PO/invoice dikosongkan
insert into public.mrp (id, kategori, warna, target_date, live, qty, is_fob, ppic_approval,
                        ppic_rejection_note, po_sent, created_at, ppic_submitted_at, ppic_approved_at,
                        po_sent_at, po_approved_at, first_invoice_at, first_payment_at, brand)
select 'W43_TEST', kategori, warna, target_date, live, qty, is_fob, 'WAITING_PPIC_APPROVAL',
       null, false, created_at, created_at, null,
       null, null, null, null, brand
  from public.mrp where id = 'W40';

-- 2) Grup lengan (id: W40-lg-N -> W43_TEST-lg-N)
insert into public.lengan_groups (id, mrp_id, warna, lengan, total_qty, rib_kg, roll_estimate, vendor_default,
                                  kerah_kg, manset_kg, cat_prod, kategori, sent_to_po_at)
select 'W43_TEST' || substr(id, 4), 'W43_TEST', warna, lengan, total_qty, rib_kg, roll_estimate, vendor_default,
       kerah_kg, manset_kg, cat_prod, kategori, null
  from public.lengan_groups where mrp_id = 'W40';

insert into public.lengan_group_sizes (lengan_group_id, size, qty)
select 'W43_TEST' || substr(s.lengan_group_id, 4), s.size, s.qty
  from public.lengan_group_sizes s
  join public.lengan_groups g on g.id = s.lengan_group_id
 where g.mrp_id = 'W40';

-- 3) Aduan pola per vendor
insert into public.aduan_pola_rows (id, lengan_group_id, mrp_id, warna, lengan, kode, qty_roll, qty, vendor, rib_allocated_roll)
select 'W43_TEST' || substr(id, 4), 'W43_TEST' || substr(lengan_group_id, 4), 'W43_TEST',
       warna, lengan, kode, qty_roll, qty, vendor, rib_allocated_roll
  from public.aduan_pola_rows where mrp_id = 'W40';

insert into public.aduan_pola_sizes (aduan_row_id, size, qty)
select 'W43_TEST' || substr(s.aduan_row_id, 4), s.size, s.qty
  from public.aduan_pola_sizes s
  join public.aduan_pola_rows r on r.id = s.aduan_row_id
 where r.mrp_id = 'W40';

-- 4) Kebutuhan material
insert into public.material_rows (id, lengan_group_id, mrp_id, warna, lengan, qty_roll, rib_kg, supplier, entitas,
                                  kerah_kg, manset_kg, sent_to_po_at)
select 'W43_TEST' || substr(id, 4), 'W43_TEST' || substr(lengan_group_id, 4), 'W43_TEST',
       warna, lengan, qty_roll, rib_kg, supplier, entitas, kerah_kg, manset_kg, null
  from public.material_rows where mrp_id = 'W40';

commit;

-- Cek: jumlah baris harus sama dengan W40 (164 grup, 229 aduan, 164 material)
select 'W40' as mrp,
       (select count(*) from public.lengan_groups where mrp_id='W40') lengan_groups,
       (select count(*) from public.aduan_pola_rows where mrp_id='W40') aduan,
       (select count(*) from public.material_rows where mrp_id='W40') material
union all
select 'W43_TEST',
       (select count(*) from public.lengan_groups where mrp_id='W43_TEST'),
       (select count(*) from public.aduan_pola_rows where mrp_id='W43_TEST'),
       (select count(*) from public.material_rows where mrp_id='W43_TEST');
