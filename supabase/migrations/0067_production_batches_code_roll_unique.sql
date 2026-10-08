-- 0067 (2026-10-08, owner: "aman untuk multiuser ... dua tim cutting bersama, tidak saling bentrok") -- satu roll
-- fisik (code_roll) hanya boleh punya SATU batch produksi. Server sudah memeriksa duluan (startProductionBatchesAction),
-- indeks unik ini jaring pengaman terakhir kalau dua tim menekan Resting untuk roll yang sama pada milidetik yang sama.
-- Indeks parsial: baris tanpa code_roll tidak terpengaruh. Kalau perintah ini gagal "duplicate key", berarti sudah ada
-- code_roll ganda di data -- cek dengan:
--   select code_roll, count(*) from public.production_batches where code_roll is not null group by 1 having count(*) > 1;
create unique index if not exists production_batches_code_roll_uniq on public.production_batches (code_roll) where code_roll is not null;
