-- 0068 (2026-10-09) -- Persetujuan akun utama atas hasil cutting yang KURANG dari target (OPSIONAL per vendor).
-- Permintaan vendor: "approval cutting dari sub tim ke main account ... kalau ada hasil cutting yang kurang dari target".
-- Diatur vendor sendiri di Tim Saya (akun utama), default MATI -- vendor yang tidak butuh tidak terpengaruh sama sekali.
--
-- vendors_produksi.cutting_approval_required : true = hasil cutting yang diinput ANGGOTA TIM dan ada size di bawah target
--                                              menunggu persetujuan akun utama. Akun utama menyimpan sendiri = tanpa persetujuan.
-- production_batches.cutting_approval_status : NULL (tanpa persetujuan / tidak perlu) | 'PENDING' | 'APPROVED' | 'REJECTED'
--                                              PENDING mengunci Finish Good roll itu sampai diputuskan.
--                                              REJECTED = hasil cutting dikosongkan lagi (cutting_at null) + alasan di cutting_decision_note.
-- production_batches.cutting_submitted_by/at : siapa dan kapan mengajukan.
-- production_batches.cutting_decided_by/at/note : siapa, kapan, dan catatan keputusan akun utama.
--
-- Murni penambahan kolom (tanpa mengubah data/fungsi lain). Snapshot memakai to_jsonb(production_batches), jadi
-- kolom baru ikut otomatis. Aman dijalankan berulang.

alter table public.vendors_produksi
  add column if not exists cutting_approval_required boolean not null default false;

alter table public.production_batches
  add column if not exists cutting_approval_status text,
  add column if not exists cutting_submitted_by text,
  add column if not exists cutting_submitted_at timestamptz,
  add column if not exists cutting_decided_by text,
  add column if not exists cutting_decided_at timestamptz,
  add column if not exists cutting_decision_note text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'production_batches_cutting_approval_status_chk') then
    alter table public.production_batches
      add constraint production_batches_cutting_approval_status_chk
      check (cutting_approval_status is null or cutting_approval_status in ('PENDING', 'APPROVED', 'REJECTED'));
  end if;
end $$;
