# [redesign] Tampilan gaya Odoo untuk modul internal + dashboard operasional + mode gelap

**Branch:** `redesign-fondasi-tabel` -> `main`  |  **Titik mundur:** `a88eeb7` (commit terakhir `main` saat PR ini dibuat)
**Ukuran:** 86 file, 75 commit. Sudah digabung dengan `main` sampai `a88eeb7` (tanpa konflik tersisa).

## Ringkasan
Hanya TAMPILAN dan fungsi turunan di sisi browser. **Nol migration, nol perubahan struktur database, nol query/RPC/penulisan baru.**
`lib/auth/*` dan `proxy.ts` tidak disentuh. URL halaman tidak ada yang berubah. Aksi (setujui, bayar, kirim) dan perhitungan tidak berubah.
Satu-satunya perubahan di jalur baca data: `lib/mrp/repo/snapshot.ts` memetakan kolom `material_pos.created_at` (sudah ada sejak migration 0001).

## Yang berubah (modul internal)
- **Kerangka:** menu di bar atas + pemindah modul (sidebar jadi laci); halaman utama kisi modul.
- **Tabel bersama (`components/mrp/data-table.tsx`):** kotak cari Odoo + filter ganda, kelompok bertingkat, favorit, urut kolom dengan klik judul, jumlah per kelompok, ingatan kolom, bagi halaman (>100 baris), rincian di panel samping. Semua opsional dan bawaan aman; prop tim IT (`bordered`, `fitExpanded`, `searchRight`, `sortValue`) tetap jalan.
- **Status standar** (`lib/mrp/flowStatus.ts`): satu sumber nama status (Approval PO, PV Material, Paid, ..., GR DC) dan enam status Paying Voucher. Hanya label tampilan; status yang tersimpan di database tidak berubah.
- **Halaman yang dirapikan:** PPIC (MRP, Tracking Item), Procurement (PO, Paying Voucher, Material Tracking, Raw Material), Finance (Payment, Posisi Stok, Laporan HPP, PO Approval), SCM (Approval, Monitoring + Kendala SLA/Yield/HPP), Produksi (SLA Produksi), Warehouse.
- **Dashboard operasional** (PPIC, Procurement, Finance, SCM, GM, Produksi): KPI Yield / HPP, progres PO hingga delivery (matriks 11 gate), SLA lewat. Hanya baca, memakai data yang sudah dimuat.
- **Tombol mode gelap/terang** (disimpan per browser).

## TIDAK berubah
- **Portal Vendor Produksi** (desktop dan HP): tampilan sama seperti sebelumnya, selalu terang, tanpa tombol mode gelap.
- Login, sesi, hak akses, Server Action, perhitungan HPP, export Excel (isi).

## Sudah diuji
Di localhost dengan salinan data live (Supabase lokal): tsc bersih, konsol tanpa error, angka dibandingkan silang dengan halaman sumber (mis. roll Material Tracking 192/38/389/2.058, Laporan HPP, Yield Alert 595 roll, kartu Tracking Item). Detail per halaman ada di `MIGRASI.md` (entri bertanda `[redesign-...]`).

## BELUM diuji, mohon dicek reviewer
1. **Build dan tampilan di Vercel** (belum ada lingkungan preview; sejauh ini hanya localhost).
2. **Aksi sungguhan lewat tampilan baru:** Setujui/Tolak PO, Bayar (Material/Maklon/Ekspedisi), simpan PV, buat PO, Set Delivery, Bongkar Koli. Salinan data lokal tidak punya data yang menunggu.
3. **Mode Sysadmin** (sidebar bertumpuk, kolom Aksi Sysadmin) dan **tampilan HP** modul internal.
4. Performa halaman besar (Tracking Item 4.800 baris, Yield Alert) pada perangkat kantor.

## Catatan untuk tim IT
- `supabase/config.toml` ikut ter-commit (konfigurasi Supabase lokal untuk uji; tidak dipakai Vercel, tidak berisi rahasia).
- Komponen baru yang memakai warna heks terang harus ditambahkan ke daftar mode gelap di akhir `app/globals.css`.
- Konflik berikutnya paling mungkin di `components/mrp/data-table.tsx` dan `MIGRASI.md` (gabungkan kedua sisi).

## Cara membatalkan
Merge commit ini bisa di-revert (`git revert -m 1 <hash merge>`) lalu push; Vercel deploy balik dalam 1-2 menit. Tidak ada data atau struktur yang perlu dikembalikan.

## Usulan jadwal merge
Setelah disetujui, merge di jam sepi (pagi sebelum jam kerja atau sore setelah operasional). Gabungkan `main` terbaru ke branch tepat sebelum merge kalau ada commit baru.
