# Usulan: tabel SLA lead time antar gate (untuk tim IT)

Status: USULAN, belum dijalankan. Redesign tidak mengambil nomor migration; nomor dan eksekusi SQL tetap milik tim IT.

## Tabel yang diisi bersama owner

Daftar tahap yang perlu SLA, usulan angkanya, dan kolom "Disepakati" yang diisi owner ada di spreadsheet
"SLA Lead Time Antar Gate": https://claude.ai/artifact/Jn7ScZHgrgeJxaztxgxymy (20 baris, kolom "Kunci (untuk IT)" = nilai `key`
di tabel `sla_settings` di bawah). Tim IT mengisi tabel database dari kolom "Disepakati", bukan dari kolom "Usulan".
Spreadsheet itu privat sampai owner membagikannya dari menu Share.

## Kenapa perlu

Halaman SCM > Monitoring (tab Kendala SLA) dan Produksi > SLA Produksi menandai pekerjaan yang terlambat antar gate.
Saat ini angka SLA-nya ditulis di kode (`lib/mrp/opsMonitor.ts`, `SLA_DEFAULTS`):

| Kunci | Tahap | Bawaan | Sumber |
|---|---|---|---|
| PO_APPROVE_TO_PV | PO disetujui -> PV Material dibuat | 2 hari | owner 2026-11-16 |
| PV_TO_PAID | PO disetujui -> PV dibayar | 2 hari | owner 2026-11-16 |
| DELIVERY_TO_RECEIVE | Delivery Material -> Receiving Material | 3 hari | owner 2026-11-16 |
| RECEIVE_TO_RESTING | Receiving Material -> Resting | 3 hari | usulan, belum ditetapkan |
| RESTING_TO_CUTTING | Resting -> Cutting | 2 hari | usulan, belum ditetapkan |
| CUTTING_TO_DONE_FG | Cutting -> Done FG (roll ditutup) | 3 hari | estimasi Tracking Item |
| DONE_FG_TO_DELIVERY | Done FG -> Delivery | 1 hari | estimasi Tracking Item |
| DELIVERY_TO_GR_DC | Delivery -> GR DC | 7 hari (Konveksi Makassar 1) | LT tiba Tracking Item |

Mengubah angka di kode berarti menunggu programmer dan deploy. Dengan tabel, SCM bisa mengubahnya sendiri dari Master Data,
dan SLA bisa berbeda per vendor (mis. lead time kirim Makassar 1 hari, Bandung 7 hari).

## Rancangan tabel

Satu tabel kecil, hanya MENAMBAH (tidak mengubah tabel lain), aman dijalankan sebelum kode baru ter-deploy.

```sql
create table if not exists public.sla_settings (
  key text not null,                 -- salah satu kunci di tabel atas, mis. 'RESTING_TO_CUTTING'
  vendor_produksi text not null default '',  -- '' = berlaku untuk semua vendor; isi kode vendor (mis. 'MKS') untuk pengecualian
  days numeric not null check (days >= 0),
  note text,
  updated_at timestamptz default now(),
  updated_by text,
  primary key (key, vendor_produksi)
);

alter table public.sla_settings enable row level security;  -- sama seperti tabel lain: diakses lewat server (service role)

-- Isi awal = angka yang dipakai kode sekarang
insert into public.sla_settings (key, vendor_produksi, days, note) values
  ('PO_APPROVE_TO_PV', '', 2, 'owner 2026-11-16'),
  ('PV_TO_PAID', '', 2, 'owner 2026-11-16'),
  ('DELIVERY_TO_RECEIVE', '', 3, 'owner 2026-11-16'),
  ('RECEIVE_TO_RESTING', '', 3, 'usulan'),
  ('RESTING_TO_CUTTING', '', 2, 'usulan'),
  ('CUTTING_TO_DONE_FG', '', 3, 'estimasi Tracking Item'),
  ('DONE_FG_TO_DELIVERY', '', 1, 'estimasi Tracking Item'),
  ('DELIVERY_TO_GR_DC', '', 7, 'LT tiba default'),
  ('DELIVERY_TO_GR_DC', 'MKS', 1, 'Konveksi Makassar')
on conflict (key, vendor_produksi) do nothing;
```

Tabel ini juga perlu ikut penanda perubahan data (trigger `trg_bump_data_version`, pola migration 0049) dan dimuat di snapshot
seperti `app_number_settings` (migration 0061), supaya perubahan langsung terbaca semua browser.

## Langkah penerapan (urut)

1. **Tim IT** menyimpan SQL di atas sebagai migration berikutnya (nomor dari tim IT), lalu menjalankannya MANUAL di Supabase live.
   Tidak ada kode yang rusak kalau tabel sudah ada lebih dulu.
2. **Kode** (pekerjaan programmer, kecil): snapshot membaca `sla_settings`; `opsMonitor.ts` memakai nilai tabel dengan cadangan
   `SLA_DEFAULTS` kalau baris tidak ada (pola yang sama dengan toleransi berat, `weightTolerancePct`); satu aksi server untuk menyimpan
   (hanya role SCM, tercatat di `internal_action_log`).
3. **Tampilan**: SCM > Master Data dapat tab "SLA Lead Time" (tabel bersama, ubah angka per baris, tambah pengecualian per vendor).
   Produksi > SLA Produksi tab "Aturan SLA" otomatis membaca angka yang sama.
4. Selama langkah 2-3 belum di-deploy, halaman tetap memakai angka di kode. Tidak ada jeda yang membuat aplikasi error.

## Yang perlu diputuskan owner

- Angka yang masih usulan: Receiving -> Resting (3 hari) dan Resting -> Cutting (2 hari).
- Apakah hari dihitung hari kalender (seperti sekarang) atau hari kerja (perlu daftar hari libur).
- Siapa yang boleh mengubah SLA (usul: SCM).
