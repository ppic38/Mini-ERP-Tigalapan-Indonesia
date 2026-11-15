# Audit Tampilan ERP 38 — Fase 1

> Dibuat 2026-11-13. Bagian dari rencana redesign di RENCANA.md bagian 2.
> **Audit STRUKTUR saja.** Bagian visual belum bisa dinilai (lihat Batasan di bawah).

## Ringkasan temuan

1. **Menunya tidak banyak — kerumitan ada di dalam halaman.** 2–8 menu per role, tapi satu halaman bisa
   memuat 79 kolom dan 25 tab.
2. **Pilihan kolom user tidak pernah tersimpan.** Setiap kali halaman dibuka, susunan kolom kembali ke bawaan.
   Berlaku di 17 halaman yang memakai `DataTable`.
3. **Ada 24 dari 71 halaman yang tidak terjangkau dari menu** — sebagian memang sengaja, tapi ada satu
   subsistem utuh yang tampaknya sudah mati.
4. **Approval sama sekali belum digarap untuk HP** (nol penanda responsif di keempat halaman approval),
   padahal owner menyebut approval sering dikerjakan dari HP.
5. **Approval punya dua implementasi berbeda** — kandidat kuat "fungsi berulang" yang dikeluhkan owner.
6. **Dashboard sudah ada tapi sangat tipis** (Finance hanya 3 kartu). Pekerjaannya memperkaya, bukan membuat
   dari nol.

## Batasan audit ini

Yang **belum** bisa dinilai karena aplikasi belum bisa dijalankan di lokal (database lokal masih kosong,
`.env.local` masih menunjuk live):
- Bagaimana tampilannya sungguhan: jarak antar elemen, keselarasan, hierarki visual, tabel yang meluber.
- Halaman mana yang terasa lambat bagi pemakainya.
- **Mana yang benar-benar tidak dipakai user** — ini butuh jawaban dari user, bukan dari kode.

Jadi dokumen ini menjawab "apa saja yang ada dan bagaimana keterkaitannya", belum "mana yang jelek" dan
belum "mana yang boleh dibuang".

## Angka pokok

| Ukuran | Nilai |
|---|---|
| Total halaman | 71 |
| Halaman tidak ada di menu | 24 (34%) |
| Menu menunjuk halaman yang tidak ada | 0 |
| Menu per role | 2–8 (PPIC 4, Procurement 8, Finance 8, SCM 7, Produksi 4, Warehouse 2, GM 2, Sysadmin 4, vendor 7) |
| File export Excel/PDF | 12 |
| Fungsi turunan di `derive.ts` | 211+ (5.556 baris) |

## Temuan 1 — Kerumitan terpusat di beberapa halaman raksasa

| Halaman | Baris | Kolom | Tab | Catatan |
|---|---|---|---|---|
| `/procurement/master-data` | 120 | **79** | **25** | Terberat di aplikasi |
| `/finance/payment` | 62 | **44** | 9 | |
| `/vendor-maklon/production` | 139 | **36** | 12 | |
| `/procurement/po-approval` | **1.239** | 24 | 2 | 8 fungsi export |
| `/mrp/ppic/item-tracking` | 18 | 22 | 0 | juga dipakai SCM |
| `/vendor-maklon/pengiriman` | **1.617** | 20 | 0 | file terbesar |
| `/vendor-maklon/receiving` | **1.051** | 11 | 0 | |
| `/procurement/material-tracking` | 854 | 2 | 0 | |

Halaman dengan 20+ kolom hampir pasti menampilkan lebih banyak daripada yang dibutuhkan satu orang dalam satu
pekerjaan. Tapi **jangan dipangkas berdasarkan tebakan** — perlu jawaban user dulu (lihat Fase 1 di RENCANA.md).

## Temuan 2 — Pilihan kolom tidak tersimpan

`components/mrp/data-table.tsx` tidak memakai `localStorage` sama sekali (nol kemunculan). Tombol "Kolom"
memakai state lokal React, jadi hilang setiap kali halaman ditinggalkan.

Dampaknya berlipat karena `DataTable` dipakai **17 halaman**. Seorang staf Finance yang menyembunyikan 6 kolom
tak terpakai harus mengulanginya setiap kali membuka halaman — berkali-kali sehari, setiap hari.

Riwayat di MIGRASI.md memperkuat ini: sudah **6+ kali** owner meminta "kolom ini disembunyikan saja secara
bawaan" di halaman berbeda (Finance Payment Material, Invoice Ekspedisi, Warehouse Penerimaan, Payment Maklon,
PO Produksi, Finance Payment). Pola itu menunjukkan susunan kolom tidak pernah dirancang, melainkan menumpuk
lalu dipangkas satu per satu setiap ada yang mengeluh.

**Ini kandidat perbaikan dengan rasio manfaat/risiko terbaik di seluruh audit:** satu perubahan di satu
komponen bersama, langsung terasa di 17 halaman, nol sentuhan database.

## Temuan 3 — Halaman yang tidak terjangkau dari menu (24)

### Memang sengaja, biarkan (11)
- 8 × `/*/profil-saya` — dibuka dari menu profil di topbar.
- `/` dan `/vendor-maklon/login` — halaman login.
- `/vendor-maklon/panduan` — dibuka dari blok bantuan di sidebar vendor.

### Sisa reorganisasi lama — hanya pengalihan, tidak berbahaya (5)
`/finance/payment-maklon`, `/finance/po-maklon`, `/finance/po-material`, `/procurement/po-list`,
`/procurement/invoice-vendor`. Masing-masing 6–8 baris berisi `redirect()` ke lokasi barunya. Aman dibiarkan;
berguna kalau ada yang menyimpan bookmark lama.

### Sengaja dilepas dari sidebar, halaman masih hidup (3)
- `/finance/ledger` (129 baris) — menunya dikomentari di `nav.ts`, halaman dibiarkan utuh atas keputusan
  terdahulu. **Pola yang bagus dan akan diikuti saat menghapus menu lain.**
- `/sysadmin/invoice-status` (551 baris) dan `/sysadmin/po` (145 baris) — dilepas dari sidebar Sysadmin
  (MIGRASI.md 2026-09-30) karena koreksinya dipindah jadi tombol di halaman modul masing-masing.

### Perlu keputusan owner (5)
| Halaman | Ukuran | Dugaan |
|---|---|---|
| `/gate-to-gate` | 210 baris + `lib/g2g/` 303 baris + 2 komponen | **Kandidat kuat kode mati** — lihat di bawah |
| `/finance/invoice-maklon` | 113 baris, 11 kolom, 13 filter | Halaman lengkap tapi tak terjangkau; kemungkinan digantikan `/finance/payment?tab=maklon` |
| `/mrp/ppic/new` | 153 baris | Input MRP manual; mungkin masih dipakai sesekali |
| `/dashboard/vendor-maklon` | 165 baris | |
| `/dashboard/ppic/profil-saya` | 8 baris | Duplikat profil |

**Soal `/gate-to-gate`:** subsistem ini berdiri sendiri — punya store sendiri (`lib/g2g/store.ts`),
perhitungan sendiri (`lib/g2g/derive.ts`, `gates.ts`), dan dua komponen khusus (`gate-statusbar.tsx`,
`stage-card.tsx`). Ia **tidak memakai `useMrpStore`** sama sekali, artinya tidak terhubung ke data ERP yang
sekarang. Tidak ada satu pun halaman lain yang merujuknya. Totalnya sekitar 500+ baris yang tampaknya warisan
rancangan lama. **Perlu konfirmasi owner sebelum dihapus** — tapi kalau benar tidak dipakai, ini pembersihan
paling bersih yang bisa dilakukan.

## Temuan 4 — Kesiapan HP

Diukur dari jumlah penanda responsif (`sm:` / `md:` / `lg:`) di file halaman.

| Halaman | Penanda | Status |
|---|---|---|
| `/vendor-maklon/pengiriman` | 113 | Digarap serius |
| `/vendor-maklon/receiving` | 83 | Digarap serius |
| `/vendor-maklon/po-material` | 39 | Digarap |
| `/vendor-maklon/team` | 12 | Digarap |
| `/procurement/raw-material` | 7 | Sebagian |
| `/finance/posisi-stok` | 6 | Sebagian |
| **`/finance/po-approval`** | **0** | **Belum sama sekali** |
| **`/procurement/po-approval`** | **0** | **Belum sama sekali** |
| **`/scm/approval-po`** | **0** | **Belum sama sekali** |
| **`/gm/approval-po`** | **0** | **Belum sama sekali** |
| Hampir semua halaman internal lain | 0 | Belum |

Owner menyatakan approval sering dikerjakan dari HP. Keempat halaman approval **nol**. Ini kesenjangan paling
jelas antara cara pemakaian nyata dan kondisi aplikasi.

## Temuan 5 — Duplikasi: ada yang sehat, ada yang tidak

### Sehat — pembungkus tipis atas komponen bersama (jangan diubah)
| Komponen bersama | Dipakai |
|---|---|
| `DataTable` | 17 halaman |
| `MrpWarnaBreakdownTable` | 3 halaman (PPIC, SCM) |
| `LaporanHppView` | Finance + SCM (masing-masing pembungkus 8 baris) |
| `ItemTrackingView` | PPIC + SCM (pembungkus 18 baris) |
| `MaterialPerWarnaView` | Procurement + SCM |
| `PoApprovalQueue` | GM + SCM + Procurement |
| Profil Saya | 8 role |

Pola ini justru benar. **Tapi konsekuensinya penting:** mengubah satu = berubah di semua. Lihat daftar
5 pemeriksaan wajib di RENCANA.md sebelum menghapus apa pun dari komponen ini.

### Tidak sehat — dua implementasi untuk pekerjaan yang sama
**Approval PO ada dua versi.** GM, SCM, dan Procurement memakai `PoApprovalQueue`. Finance memakai
`PoMaterialPanel` dan `PoMaklonPanel` buatan sendiri. Artinya setiap perbaikan approval harus dikerjakan dua
kali, dan tampilannya bisa berbeda antar role untuk pekerjaan yang sebenarnya sama.

Ini kandidat paling kuat untuk "banyak fungsi yang berulang" yang dikeluhkan owner.

## Temuan 6 — Dashboard yang sudah ada

Sudah ada enam: `/dashboard/finance`, `/dashboard/ppic`, `/dashboard/procurement`, `/dashboard/admin`,
`/dashboard/vendor-supplier`, `/gm/dashboard`. Semuanya tipis — Dashboard Finance misalnya hanya punya tiga
kartu: PO Menunggu Approval, Invoice Material Menunggu Bayar, Invoice Vendor Menunggu Bayar. Nol filter,
nol tabel, dan **nol penanda responsif**.

Jadi pekerjaan dashboard di Fase 4 sebaiknya dibaca sebagai **memperkaya yang sudah ada**, bukan membangun
dari nol — sekaligus membuatnya enak di HP sejak awal.

## Rekomendasi awal, diurutkan manfaat terhadap risiko

### Risiko sangat rendah, manfaat tinggi
1. **Simpan pilihan kolom per user.** Satu komponen (`data-table.tsx`), efek ke 17 halaman. Tidak menghapus
   apa pun, tidak menyentuh database.
2. **Rancang ulang susunan kolom bawaan per role** — berdasarkan jawaban user, bukan tebakan.

### Risiko rendah
3. **Approval enak di HP.** Satu komponen bersama menutup GM + SCM + Procurement sekaligus; Finance perlu
   pekerjaan terpisah (atau disatukan dulu, lihat nomor 6).
4. **Perkaya dashboard yang sudah ada** + buat responsif sejak awal.

### Perlu keputusan owner lebih dulu
5. **Hapus `/gate-to-gate` dan `lib/g2g/`** kalau benar tidak dipakai (~500 baris kode mati).
6. **Satukan dua implementasi approval** menjadi satu komponen bersama.
7. **Putuskan nasib** `/finance/invoice-maklon`, `/finance/ledger`, `/mrp/ppic/new`.

### Butuh masukan user dulu
8. **Pangkas kolom** di `/procurement/master-data` (79), `/finance/payment` (44),
   `/vendor-maklon/production` (36).

## Yang dibutuhkan untuk melanjutkan

1. **Jawaban dari satu user per role** (tiga pertanyaan di RENCANA.md Fase 1) — tanpa ini, nomor 2 dan 8
   hanya tebakan.
2. **Database lokal jalan** — untuk menilai tampilan visual dan membaca `internal_action_log` /
   `vendor_action_log` sebagai bukti pemakaian nyata.
3. **Konfirmasi owner** untuk nomor 5, 6, 7.

## Temuan visual (data nyata, 2026-11-15)

Dinilai dari aplikasi lokal berisi salinan data live, login Finance, layar 1024 px. Baru dua halaman dilihat;
daftar ini akan bertambah.

| # | Halaman | Temuan | Jenis |
|---|---|---|---|
| V1 | Dashboard Finance | Angka "TOTAL SUDAH DIBAYAR" (Rp 8.129.153.05x) **meluber keluar kartu** dan terpotong di tepi kanan. Kartu lain (Rp 145.389.130) muat. Angka rupiah besar tidak dirancang untuk lebar kartu. | Bug tata letak |
| V2 | Sidebar Finance | Badge **Payment = 22**, tetapi halaman Payment terbuka di tab *Payment Material* yang menampilkan "Tidak ada invoice yang siap dibayar saat ini". 22 pekerjaan sebenarnya ada di tab lain (Maklon 8 + Ekspedisi 14). Pengguna membuka menu karena ada angka, lalu disambut halaman "kosong". | Masalah alur |
| V3 | Payment > Material | Pesan kosong hanya teks kecil abu-abu di kartu putih lebar, sedangkan "Riwayat Pembayaran" di bawahnya tampil penuh. Mata langsung tertarik ke arsip, bukan ke pekerjaan. Ini wujud nyata pola "Tugas vs Riwayat" di docs/IA-FINANCE.md. | Hierarki |
| V4 | Payment > Material | Filter "NO MRP (SIAP DIBAYAR)" dengan placeholder "— pilih MRP —" mengisi satu kartu penuh, padahal belum ada yang bisa dipilih. | Ruang terbuang |
| V5 | Dashboard Finance | Badge Notifikasi menampilkan **183**. Angka sebesar itu berhenti bermakna. | Kegunaan |
| V6 | Dashboard Finance | "Payment due" menampilkan Overdue / Due hari ini / Due berikutnya semuanya Rp 0, sementara 8 invoice vendor menunggu dibayar. Perlu dicek apakah data jatuh tempo memang terisi (terkait pertanyaan "Jatuh Tempo" di docs/IA-FINANCE.md). | Perlu dicek |

**V2 adalah temuan paling berharga**: perbaikannya cukup membuka tab pertama yang punya pekerjaan, tanpa menyentuh
logika bisnis apa pun.

### Tambahan (PO Approval, Posisi Stok, Laporan HPP; layar 1024 px)

| # | Halaman | Temuan | Jenis |
|---|---|---|---|
| V7 | Laporan HPP | Kartu ringkasan **meluber dan terpotong**: "Total biaya produksi" (Rp 662.861.794) menabrak tepi kartu, "Total COGS bahan" terpotong jadi "Rp 3.417.590.3...". Gejala sama dengan V1 di Dashboard, jadi kemungkinan satu komponen kartu angka yang sama; satu perbaikan menutup keduanya. | Bug tata letak |
| V8 | PO Approval | Pola sama dengan Payment (V3): pesan kosong kecil lalu riwayat penuh di bawahnya. Filter "NO MRP (MENUNGGU APPROVAL)" juga memakai satu kartu penuh. | Hierarki |
| V9 | Laporan HPP | Belum ada **yield**, dan filter hanya per MRP (kebutuhan owner: per delivery). Kartu atas "Filter No. MRP (untuk card di bawah)" hanya memengaruhi kartu, bukan tabel, sehingga membingungkan. | Kebutuhan baru |
| V10 | Posisi Stok | Tabel 39 baris punya lebih banyak kolom daripada lebar layar; kolom di kanan (Proses produksi, belum dikirim) terpotong dan harus digeser. Angka rupiah dua baris ("Rp" di atas angka) membuat baris tabel tinggi. | Kepadatan |
| V11 | Posisi Stok | **Positif**: angka konsisten (Belum produksi + Proses + Sudah delivery = Stok dibeli, Rp 7.737.841.270). Halaman ini baru dan sudah terbukti jalan dengan data asli. | Terverifikasi |
