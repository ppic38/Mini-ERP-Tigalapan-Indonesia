-- 0069 (2026-10-09) -- Master Data "Rib per Pcs": faktor kebutuhan rib (kg per pcs) yang dipakai saat PPIC upload MRP
-- (kolom RIB KILOGRAM kosong). Sebelumnya konstanta 6,5 gram/pcs di kode; owner minta 7 gram dan bisa diatur seperti Kerah/Manset.
-- Memakai tabel yang sama dengan Kerah/Manset (kerah_manset_settings): tambah kind 'RIB' (kg_per_pcs 0,007 = 7 gram).
-- Hanya berlaku untuk upload MRP BARU; MRP yang sudah tersimpan tidak berubah. Aman dijalankan berulang.
alter table public.kerah_manset_settings drop constraint if exists kerah_manset_settings_kind_check;
alter table public.kerah_manset_settings
  add constraint kerah_manset_settings_kind_check check (kind in ('KERAH', 'MANSET', 'RIB'));

insert into public.kerah_manset_settings (kind, kg_per_pcs, harga_per_kg)
values ('RIB', 0.007, 0)
on conflict (kind) do nothing;
