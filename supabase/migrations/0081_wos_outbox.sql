-- 0081 (2026-10-28): antrean pengiriman data resi ke Warehouse Operation System (WOS) milik partner.
-- Begitu vendor selesai "Set Ekspedisi & Resi", ERP mendorong satu kejadian `resi.created` ke alamat WOS (webhook).
-- Kiriman yang gagal (WOS sedang mati, jaringan putus) TIDAK menggagalkan aksi vendor: barisnya tinggal di sini
-- berstatus PENDING/FAILED dan dicoba ulang otomatis (lihat lib/mrp/wosPush.ts, rute /api/wos/retry).
-- Satu resi hanya punya satu baris per jenis kejadian (unique), jadi aksi yang terpanggil dua kali tidak mengirim dobel.
-- Fitur MATI selama env WOS_WEBHOOK_URL dan WOS_WEBHOOK_SECRET belum diisi di Vercel; tabel ini aman dibuat lebih dulu.
-- Tidak ada data yang berubah. Aman dijalankan berulang.

create table if not exists public.wos_outbox (
  id bigint generated always as identity primary key,
  event text not null,
  resi_group_id text not null,
  payload jsonb not null,
  status text not null default 'PENDING' check (status in ('PENDING', 'SENT', 'FAILED')),
  attempts integer not null default 0,
  last_http_status integer,
  last_error text,
  created_at timestamptz not null default now(),
  last_attempt_at timestamptz,
  sent_at timestamptz,
  unique (event, resi_group_id)
);
create index if not exists wos_outbox_status_idx on public.wos_outbox(status, id);

alter table public.wos_outbox enable row level security;
drop policy if exists "service role full access" on public.wos_outbox;
create policy "service role full access" on public.wos_outbox for all
  using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
