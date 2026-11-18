# Information Architecture — Modul Finance (Fase 2)

> Dibuat 2026-11-13 dari penjelasan owner. Bagian dari rencana redesign di RENCANA.md bagian 2 Fase 2.
> Ini DOKUMEN, belum ada kode yang diubah. Usulan di sini perlu persetujuan owner dulu.

## Tujuan tiap menu (dari owner)

| Menu | Tujuan | Irama | Sifat |
|---|---|---|---|
| Dashboard | Ringkasan aktivitas FAT, tren biaya | Mingguan & bulanan | **Monitoring saja, nol aksi** |
| PO Approval | Setujui/tolak PO Material & PO Produksi | Mingguan | Aksi |
| Payment | Bayar supplier, maklon, ekspedisi | **Harian** | Aksi |
| Saldo | Info DP / selisih bayar per pihak | Harian | Aksi ringan (input deposit) |
| Posisi Stok | Material paid yang belum delivery | **Bulanan** | Monitoring (bahan laporan keuangan) |
| Laporan HPP | Biaya produksi, COGS, ongkir, HPP, ratio | Harian | Monitoring |

Irama pemakaian ini penting: **Payment dipakai tiap hari, Posisi Stok sebulan sekali.** Keduanya tidak
pantas mendapat perlakuan tampilan yang sama. Yang harian harus paling sedikit kliknya.

---

## Masalah lintas-menu: tampilan "Tugas" vs "Riwayat"

Owner: *"ada tabel pekerjaan yang sudah di-approve namun saya bingung, informasi ini penting namun UI task
dan UI history task tampilannya seperti apa — hampir semua modul saat ini seperti ini."*

Ini keluhan paling berharga di seluruh masukan, karena polanya berulang di mana-mana:

| Menu | Tabel "tugas" | Tabel "riwayat" |
|---|---|---|
| PO Approval | PO menunggu persetujuan | PO sudah disetujui |
| Payment Material | Invoice siap dibayar | Riwayat pembayaran |
| Payment Maklon | Invoice siap dibayar | Sudah dibayar |
| Payment Ekspedisi | Siap dibayar | Riwayat |
| Warehouse | Siap dibongkar | Riwayat penerimaan |

Sekarang keduanya ditumpuk di satu halaman sebagai dua tabel sejajar yang bentuknya mirip. Akibatnya mata
harus bekerja membedakan "ini yang harus saya kerjakan" dari "ini yang sudah lewat".

### Prinsip yang saya usulkan

**1. Halaman dibuka pada PEKERJAAN, bukan arsip.**
Yang menunggu tindakan tampil pertama dan penuh. Riwayat dipindah ke tab kedua, bukan tabel kedua di bawahnya.
Riwayat dibuka hanya saat seseorang mencari sesuatu — itu pekerjaan yang berbeda dari menyetujui.

**2. Tugas dan riwayat harus BEDA BENTUK, bukan beda judul.**
Dua tabel yang bentuknya sama persis akan selalu tertukar. Tugas sebaiknya berupa daftar keputusan dengan
tombol aksi di tiap baris; riwayat berupa tabel padat untuk ditelusuri. Beda bentuk = tidak perlu membaca
judul untuk tahu sedang di mana.

**3. Satu baris = satu keputusan utuh.**
Orang tidak perlu membuka baris untuk tahu apa yang disetujui. Tampilkan 4–5 hal yang menentukan keputusan;
sisanya di balik "Detail". Untuk PO Material menurut owner: **supplier, nilai, entitas** (warna dan vendor
maklon opsional).

**4. Kosong itu kabar baik, tampilkan begitu.**
Tabel kosong sekarang terlihat seperti kegagalan memuat. Ganti dengan pernyataan jelas: "Tidak ada PO yang
menunggu persetujuan Anda." Itu informasi, bukan ruang hampa.

**5. Riwayat untuk MENCARI, bukan untuk dibaca berurutan.**
Riwayat tidak akan pernah dibaca dari atas ke bawah. Yang dibutuhkan: cari cepat (no invoice, no PO, no resi),
rentang tanggal, dan halaman — bukan tabel panjang tanpa ujung.

**6. Jumlah yang menunggu harus terlihat sebelum halaman dibuka.**
Badge di menu sudah ada. Pertahankan, dan pastikan angkanya = jumlah yang betul-betul menunggu orang ini.

**7. Aksi massal hanya kalau keputusannya memang berulang.**
Payment harian cocok (centang beberapa invoice, bayar sekaligus) dan sudah ada. Konfirmasinya wajib
menampilkan total nilai dan jumlah baris sebelum dieksekusi.

> Catatan penting: usulan ini mengubah SUSUNAN, bukan logika. Tidak ada tabel database, aksi server, atau
> aturan bisnis yang tersentuh.

---

## Catatan per menu

### Dashboard — perlu dibangun, bukan diperbaiki
Kondisi sekarang hanya tiga kartu (PO menunggu approval, invoice material menunggu bayar, invoice vendor
menunggu bayar), nol filter, nol tren.

Yang diminta owner:
- Filter **hari / bulan / tahun**.
- Ringkasan aktivitas FAT berkala (mingguan dan bulanan).
- Biaya yang sudah dikeluarkan: **material dan maklon**, beserta **trennya**.
- Pecahan **per entitas**.
- Ringkasan **outstanding**: material sudah dibeli tetapi belum didistribusikan.
- **Nol aksi** — murni monitoring.

Catatan teknis: "outstanding material sudah dibeli belum didistribusikan" sangat dekat dengan perhitungan
yang sudah ada di `lib/mrp/stockPosition.ts` (halaman Posisi Stok). Pakai fungsi itu, jangan hitung ulang —
kalau dua halaman menampilkan angka berbeda untuk hal yang sama, kepercayaan hilang.

### PO Approval
- Entitas dipilih saat menyetujui **PO Material**; **PO Produksi mengikuti otomatis** (perilaku ini sudah
  ada sejak 2026-11-08, lihat MIGRASI.md).
- Kolom yang menentukan keputusan: nama supplier, nilai, entitas. Warna dan vendor maklon opsional.
- Finance memakai implementasi sendiri (`PoMaterialPanel`, `PoMaklonPanel`), **berbeda dari GM/SCM/Procurement**
  yang memakai `PoApprovalQueue`. Pertimbangkan menyatukan lebih dulu supaya perbaikan tidak dikerjakan dua kali.
- Approval juga dipakai dari HP (lihat lingkup perangkat di RENCANA.md).

### Payment — paling sering dipakai, prioritaskan
Tiga jenis dengan kolom berbeda menurut owner:
- **Material**: No MRP, Supplier, Vendor Maklon, No Invoice, Kode Transaksi, Nominal, Entitas, Status Payment.
- **Maklon**: No Invoice, Vendor, Total Tagihan, **Jatuh Tempo**, Status Payment.
- **Ekspedisi**: No Resi, No MRP, Vendor, Ekspedisi, Tanggal Kirim, Jumlah Koli, Biaya Ekspedisi, Status Payment.

Aksi: memasukkan nilai transfer, mengunggah bukti bayar, atau memotong saldo deposit.

**Yang perlu dicek saat mengerjakan**: owner menyebut "Jatuh Tempo" di Payment Maklon. Perlu dipastikan
apakah data jatuh tempo memang sudah ada di sistem — kalau belum pernah dicatat siapa pun, itu kasus C
(lihat aturan Fase 4) dan harus dilaporkan ke owner, bukan dikarang.

### Saldo
- Isi: DP atau selisih bayar per vendor / supplier / ekspedisi.
- Kolom: tanggal register deposit, nama pihak, jenis, deskripsi, nilai.
- Owner menyebut **layout**-nya juga perlu dirapikan, bukan hanya kolomnya.

### Posisi Stok
- Dipakai **bulanan**, sebagai bahan laporan keuangan.
- Kolom inti: jumlah roll, nilai material, posisi.
- Halaman ini baru selesai dibuat (commit `4fb6951`) dan **belum pernah diuji dengan data asli** — itu
  pekerjaan pertama begitu database lokal siap.

### Laporan HPP
- Isi sudah sesuai, dua kekurangan:
  1. **Butuh yield** ikut ditampilkan.
  2. **Filter harus bisa per delivery**, bukan hanya per MRP. Ini perubahan paling berarti di menu ini —
     Finance melihat biaya per pengiriman, bukan per PO.
- Owner: "tampilannya masih belum menarik".

---

## Yang masih dibutuhkan sebelum lanjut

1. Konfirmasi owner atas tujuh prinsip "Tugas vs Riwayat" di atas — karena polanya akan dipakai di semua modul.
2. Kepastian soal data **Jatuh Tempo** di Payment Maklon (ada atau belum).
3. Masukan dari staf Finance yang memakainya sehari-hari (tiga pertanyaan di RENCANA.md Fase 1).
