-- 0078 (2026-10-24): nama pelaku (akun utama atau anggota tim vendor) disematkan di baris data, supaya daftar di portal vendor bisa
-- menampilkan "dibuat/dikerjakan oleh siapa". Isinya teks bebas, mis. "Budi (@budi.cutting)" atau "CECEP (akun utama)".
-- Hanya terisi untuk aksi SESUDAH migration ini; data lama tetap kosong (tampil "-"). Tidak ada data yang berubah. Aman dijalankan berulang.
alter table public.delivery_kolis
  add column if not exists created_by text,
  add column if not exists shipped_by text;

alter table public.production_batches
  add column if not exists resting_by text,
  add column if not exists cutting_by text,
  add column if not exists fg_by text,
  add column if not exists closed_by text;

alter table public.raw_material_invoice_rolls
  add column if not exists received_by text;

alter table public.vendor_invoices
  add column if not exists submitted_by text;
