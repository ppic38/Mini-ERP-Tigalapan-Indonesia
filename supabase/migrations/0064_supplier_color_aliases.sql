-- 0064 (2026-10-06, owner: "nama warna di invoice supplier itu ternyata sedikit berbeda dengan yang
-- di list warna di MRP -- misal HITAM REAKTIF vs HITAM 24S") -- fitur "Upload Invoice Supplier" di
-- Paying Voucher (Procurement). Pemetaan nama warna di invoice supplier -> nama warna di MRP,
-- disimpan PER SUPPLIER supaya invoice berikutnya dari supplier yang sama langsung terpetakan.
--
-- Hanya diisi setelah Procurement MENGONFIRMASI pemetaan itu saat membuat PV (tidak pernah dari
-- tebakan otomatis). Tabel ini murni pelengkap: kalau belum dijalankan, fitur upload tetap jalan
-- (pemetaan hanya tidak teringat untuk invoice berikutnya).
create table if not exists public.supplier_color_aliases (
  id text primary key,
  supplier text not null,
  -- nama warna PERSIS seperti tercetak di invoice supplier (huruf besar, spasi dirapikan) & benang, mis. "24S"
  invoice_warna text not null,
  benang text not null default '',
  -- nama warna MRP lengkap, mis. "HITAM 24S"
  mrp_warna text not null,
  created_at timestamptz not null default now(),
  created_by text,
  unique (supplier, invoice_warna, benang)
);

alter table public.supplier_color_aliases enable row level security;
drop policy if exists "service role full access" on public.supplier_color_aliases;
create policy "service role full access" on public.supplier_color_aliases for all
  using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
