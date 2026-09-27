-- 0055 (2026-09-26, owner: "Approval Matrix Purchase Order" -- Level 1-4 berdasarkan nilai PO,
-- berlapis berurutan, Level 3 = FAT Manager (Finance) + SCM Manager, Level 4 = General Manager;
-- berlaku untuk PO Material & PO Produksi, menggantikan approval Finance tunggal). Logika level ada
-- di lib/mrp/poApproval.ts.
--
-- approval_level : level yang dibutuhkan (1-4) SAAT PO diajukan. NULL = PO lama (sebelum matriks ini)
--                  -> tetap alur lama (1 approval Finance), tidak diubah.
-- approval_log   : array JSON riwayat langkah approval/penolakan [{step, role, action, at, note}].
-- approval_submitted_at : waktu (pengajuan ulang) terakhir -- dasar hitung SLA langkah pertama.
-- Snapshot (get_flow_snapshot_raw) memakai to_jsonb(t), jadi kolom baru otomatis ikut terbaca.
-- Nomor 0055 (bukan 0053) supaya tidak bentrok dengan draf migration "stok awal" yang sempat dibuat
-- lalu ditarik kembali.

alter table material_pos add column if not exists approval_level integer;
alter table material_pos add column if not exists approval_log jsonb not null default '[]'::jsonb;
alter table material_pos add column if not exists approval_submitted_at timestamptz;

alter table maklon_pos add column if not exists approval_level integer;
alter table maklon_pos add column if not exists approval_log jsonb not null default '[]'::jsonb;
alter table maklon_pos add column if not exists approval_submitted_at timestamptz;
