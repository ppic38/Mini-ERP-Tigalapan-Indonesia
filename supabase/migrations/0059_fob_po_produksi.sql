-- 0059 (2026-09-27, tahap 3 skema FOB, lanjutan 0058) -- pembuatan PO Produksi untuk grup FOB +
-- jalur invoice-nya sendiri. Owner 2026-09-27: "langsung ke invoice, tanpa tracking" (PO FOB TIDAK
-- lewat Cutting/Finish Good seperti CMT -- vendor sedia bahan+jahit sendiri, ERP kita cuma perlu
-- tahu harga jadi per pcs & catat invoice-nya) + "hidupkan lagi tabel maklon_invoices, khusus FOB"
-- (jalur lama per-PO base-fee yang sudah ditutup untuk CMT sejak pindah ke Invoice Vendor per-pcs,
-- lihat app/finance/invoice-maklon/page.tsx -- TABELNYA tetap sama, cuma dipakai lagi khusus FOB).
--
-- lengan_groups.kategori      : kolom `KATEGORI` per BARIS (lihat catatan CatProd, migration 0058
--                                -- 1 MRP bisa punya banyak kategori berbeda), dipakai cocokkan
--                                grup FOB ke Master Data Harga FOB (vendor + item).
-- lengan_groups.sent_to_po_at : analog `material_rows.sent_to_po_at` untuk grup CMT -- mencegah
--                                grup FOB yang sama terkirim jadi PO Produksi 2x.
-- maklon_pos.is_fob           : true kalau PO ini dari grup FOB (harga jadi per pcs, BUKAN ongkos
--                                maklon) -- dibuat LANGSUNG berstatus 'DELIVERY' (skip tracking
--                                produksi), tanpa PO Material sama sekali.
-- maklon_pos.kategori         : kategori/item yang dipakai mencocokkan Harga FOB, murni info.
--
-- Kolom baru di tabel yang SUDAH ada -- get_flow_snapshot_raw() TIDAK perlu di-redefine (pakai
-- to_jsonb(t), otomatis membawa kolom apa pun yang ada saat ini, lihat catatan di 0058).

alter table lengan_groups add column if not exists kategori text;
alter table lengan_groups add column if not exists sent_to_po_at timestamptz;

alter table maklon_pos add column if not exists is_fob boolean not null default false;
alter table maklon_pos add column if not exists kategori text;
