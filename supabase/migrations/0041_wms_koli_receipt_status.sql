-- Lanjutan integrasi WMS (0039/0040) -- arah SEBALIKNYA: WMS -> Mini ERP. Owner (2026-09-16): WMS
-- sudah otomatis membuat event KOLI_INTAKE begitu semua koli 1 resi dikonfirmasi datang di WMS
-- (lihat source/src/lib/phase1.js repo WMS) -- owner HANYA ingin ini menyalakan STATUS "sudah
-- diterima di WMS" di portal Warehouse ERP, TERPISAH TOTAL dari "Bongkar Koli"
-- (receiveWarehouseResiGroupAction, actions.ts) yang tetap manual & tetap mensyaratkan invoice
-- vendor lunas seperti sekarang -- TIDAK ada logika HPP/finance yang disentuh migration ini.

-- Kolom status murni informasional -- TIDAK memengaruhi warehouseReceivableGroups/gate manapun.
alter table delivery_kolis add column if not exists wms_received_at timestamptz;

-- Outbox: arsip SEMUA event yang pernah dikirim WMS (audit trail), sama kontraknya dengan
-- integration/outbox.sql di repo WMS -- TAPI SENGAJA TIDAK di-grant ke wms_integration_role sama
-- sekali (beda dari draf outbox.sql asli yang men-grant ke service_role). Baik tabel ini maupun
-- delivery_kolis HANYA disentuh lewat wms_integration_event() di bawah (security definer) --
-- wms_integration_role tetap CUMA punya EXECUTE ke fungsi, nol akses tabel langsung, konsisten
-- dengan wms_resi_snapshot (migration 0039/0040).
create table if not exists wms_integration_outbox (
  id text primary key,
  target text not null check (target in ('MINI_ERP', 'MOKA')),
  event text not null,
  payload jsonb not null,
  source_created_at timestamptz,
  received_at timestamptz not null default now(),
  status text not null default 'QUEUED' check (status in ('QUEUED', 'APPLIED', 'FAILED')),
  external_id text,
  applied_at timestamptz,
  last_error text,
  constraint wms_outbox_applied_requires_evidence check (
    status <> 'APPLIED' or (external_id is not null and length(external_id) > 0 and applied_at is not null)
  )
);
alter table wms_integration_outbox enable row level security;
revoke all on wms_integration_outbox from public, anon, authenticated, wms_integration_role;

create or replace function public.wms_integration_event(p_action text, p_event jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  row_data wms_integration_outbox;
  event_id text := p_event->>'id';
  v_target text := p_event->>'target';
  v_event text := p_event->>'event';
  v_external_resi_no text;
  v_matched integer;
begin
  if event_id is null or event_id !~ '^[a-zA-Z0-9_-]{1,100}$' or p_action not in ('submit', 'status') then
    raise exception 'Invalid request';
  end if;

  if p_action = 'submit' then
    if v_target not in ('MINI_ERP', 'MOKA') or jsonb_typeof(p_event->'payload') <> 'object' then
      raise exception 'Invalid event';
    end if;

    insert into wms_integration_outbox (id, target, event, payload, source_created_at)
    values (event_id, v_target, v_event, p_event->'payload', (p_event->>'createdAt')::timestamptz)
    on conflict (id) do nothing;

    select * into row_data from wms_integration_outbox where id = event_id;

    -- Auto-apply HANYA untuk KOLI_INTAKE ke MINI_ERP (satu-satunya event yang owner minta
    -- ditindaklanjuti otomatis sekarang) -- dan HANYA kalau event ini baru pertama kali diterima
    -- (row_data.status masih QUEUED, belum pernah diproses) supaya idempotent/tidak dobel kerja
    -- kalau WMS mengirim ulang event yang sama.
    if row_data.status = 'QUEUED' and v_target = 'MINI_ERP' and v_event = 'KOLI_INTAKE' then
      v_external_resi_no := row_data.payload->>'externalResiNo';

      if v_external_resi_no is not null then
        update delivery_kolis k
        set wms_received_at = coalesce(k.wms_received_at, now())
        where coalesce(k.no_resi, k.id) = v_external_resi_no
          -- Samakan seluruh koli dalam resi group yang sama (bukan cuma baris yang persis cocok),
          -- konsisten dengan cara resi group diidentifikasi di wms_resi_snapshot (migration 0040).
          or coalesce(k.resi_group_id, k.id) in (
            select coalesce(k2.resi_group_id, k2.id) from delivery_kolis k2 where coalesce(k2.no_resi, k2.id) = v_external_resi_no
          );
        get diagnostics v_matched = row_count;

        if v_matched > 0 then
          update wms_integration_outbox
          set status = 'APPLIED', external_id = v_external_resi_no, applied_at = now()
          where id = event_id
          returning * into row_data;
        else
          update wms_integration_outbox
          set status = 'FAILED', last_error = 'Resi ' || v_external_resi_no || ' tidak ditemukan di Mini ERP.'
          where id = event_id
          returning * into row_data;
        end if;
      else
        update wms_integration_outbox
        set status = 'FAILED', last_error = 'Event KOLI_INTAKE tidak menyertakan externalResiNo.'
        where id = event_id
        returning * into row_data;
      end if;
    end if;
  end if;

  select * into row_data from wms_integration_outbox where id = event_id;
  if not found then
    return jsonb_build_object('id', event_id, 'status', 'NOT_FOUND');
  end if;
  if row_data.target is distinct from v_target or row_data.event is distinct from v_event or row_data.payload is distinct from p_event->'payload' then
    raise exception 'Event ID already belongs to a different payload';
  end if;

  return jsonb_build_object('id', event_id, 'status', row_data.status, 'externalId', row_data.external_id);
end;
$$;

revoke all on function public.wms_integration_event(text, jsonb) from public, anon, authenticated;
grant execute on function public.wms_integration_event(text, jsonb) to wms_integration_role;

-- CATATAN status lain (RECEIVING/PUTAWAY/SHIPPING, target MOKA): tetap TERSIMPAN di outbox (audit),
-- TAPI belum ditindaklanjuti otomatis apa pun -- itu di luar permintaan owner sekarang (2026-09-16:
-- "statusnya saja yang berubah ... jika sudah diterima di WMS"). Kalau nanti perlu, tambah cabang
-- serupa di fungsi ini, jangan bikin worker terpisah selama masih sesederhana update 1 kolom.
