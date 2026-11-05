-- 0090: dispensasi "proses sebelum approval" per PO (Sysadmin), untuk kasus bahan yang sudah ada di vendor padahal PO-nya masih menunggu approval.
-- PO Material bertanda ini boleh dibuatkan Paying Voucher walau belum approved; PO Produksi bertanda ini boleh "Mulai Produksi" oleh vendor.
-- Approval PO tetap berjalan normal; pembayaran Finance invoice-nya tetap menunggu PO Material approved. Snapshot memakai to_jsonb, tidak ada RPC yang berubah.
alter table public.material_pos add column if not exists early_release boolean not null default false;
alter table public.maklon_pos add column if not exists early_release boolean not null default false;
