# Pilihan Desain dan Isi Tiap Halaman

> Dibuat 2026-11-15. Menunggu persetujuan owner. Belum ada kode aplikasi yang diubah.
> Contoh yang bisa diklik: `docs/mockup/pilihan-desain.html` (gaya dan model detail) dan
> `docs/mockup/contoh-payment.html` (pola pekerjaan vs riwayat).

## 1. Tiga gaya tampilan

Ketiganya memakai susunan halaman yang sama, jadi yang Anda pilih murni soal rasa dan keterbacaan.

| | A. Biru Kantor | B. Indigo dan Kanvas | C. Label Butik |
|---|---|---|---|
| Kesan | Tampilan sekarang, dirapikan | Hangat, tenang, terasa "pabrik kain" | Tegas, hitam putih, seperti label baju |
| Warna | Navy, biru, abu muda | Indigo celup, kanvas, kuning benang untuk penanda | Hitam, putih, satu merah untuk penanda |
| Navigasi | Sidebar kiri | **Bar di atas** (isi halaman lebih lebar) | Sidebar kiri tipis |
| Perubahan bagi staf | Paling kecil | Sedang | Paling besar |
| Risiko pengerjaan | Paling rendah | Rendah | Rendah |

**Saran saya: B.** Dua alasan praktis, bukan selera:
1. Navigasi di atas memberi lebar sekitar 200 px lebih untuk tabel. Masalah terbesar aplikasi ini justru tabel
   yang kolomnya tidak muat.
2. Indigo adalah warna celup kain, dan titik warna kain di tiap baris (hitam, burgundy, tosca) membuat isi PO
   terbaca sekilas tanpa membuka rincian. Itu khas usaha Anda, bukan hiasan.

Kalau Anda ingin staf nyaris tidak merasa ada perubahan, pilih A. Ketiganya sama ringannya bagi database
karena gaya hanya soal warna dan huruf.

## 2. Pop-up atau bukan

| Model | Cocok untuk | Kelemahan |
|---|---|---|
| **Panel samping** (saran) | Melihat rincian lalu memutuskan, sambil daftar tetap terlihat | Butuh layar agak lebar; di HP jadi layar penuh |
| Pop-up di tengah | Konfirmasi singkat ("Yakin bayar 3 invoice?") | Menutupi daftar; lelah kalau dibuka berkali-kali |
| Dua kolom | Pekerjaan yang dibuka satu per satu berurutan (approval) | Memakan lebar; kurang cocok untuk tabel lebar |

**Saran saya:** panel samping untuk rincian, pop-up **hanya** untuk konfirmasi tindakan yang tidak bisa dibatalkan,
dan baris yang "melebar ke bawah" dihapus (sekarang banyak dipakai dan membuat halaman memanjang tak tentu).

## 2b. Keputusan owner (2026-11-15) dan arah gaya Odoo

- **Disetujui: panel samping** sebagai cara membuka rincian.
- **Arah gaya: mengikuti model Odoo** (contoh: `docs/mockup/gaya-odoo.html`, menunggu persetujuan). Tiga gaya di
  bagian 1 tidak dipakai lagi kecuali warnanya (indigo) yang dibawa ke contoh ini.

Yang diambil dari Odoo dan artinya untuk aplikasi ini:

| Ciri Odoo | Di aplikasi ini | Dampak |
|---|---|---|
| Tombol kisi di pojok kiri atas untuk pindah modul | Membuka daftar 9 modul dari halaman mana pun | **Cara login tidak diubah.** Modul yang sudah dibuka di perangkat itu langsung terbuka; yang lain tetap meminta password seperti sekarang. Daftar ini pada dasarnya halaman "Pilih Modul" yang sudah ada. |
| Menu modul di bar atas, sub-halaman lewat dropdown | Sidebar kiri hilang; Finance jadi: Ringkasan, Persetujuan PO, Pembayaran (Maklon, Ekspedisi, Material), Saldo Deposit, Laporan (Posisi Stok, Laporan HPP), Pengaturan (Entitas) | **Alamat halaman (URL) tidak berubah**, hanya pengelompokan menu. Izin halaman anggota tim vendor dan aturan akses tidak tersentuh. |
| Baris kendali: jejak halaman, kotak cari, penghitung halaman | Menggantikan kartu filter yang sekarang memakan satu kartu penuh | Tidak ada |
| Filter bawaan berupa keping di kotak cari | "Perlu dibayar" jadi filter bawaan. Menghapus kepingnya menampilkan semua, termasuk yang sudah lunas. **Ini menggantikan dua tabel (tugas dan riwayat) dengan satu daftar.** | Tidak ada. Datanya sama. |
| Tombol aksi muncul saat baris dicentang | Tombol Bayar muncul bersama jumlah dan total terpilih | Tidak ada |
| Klik baris membuka formulir satu halaman penuh | **Tidak diikuti**: tetap panel samping sesuai keputusan owner | — |

Catatan pengerjaan yang penting:
- Bar atas dan sidebar berasal dari **satu kerangka yang dipakai semua modul** (`AppShell`). Mengubahnya sekaligus
  berarti semua modul berubah pada hari yang sama. Supaya aman, kerangka baru dipasang lewat pengaturan per modul
  (bawaan = tampilan sekarang), jadi Finance bisa pindah dulu sementara modul lain tetap seperti biasa.
- **Portal vendor tidak ikut** (sudah punya tampilan HP sendiri dengan menu di bawah).
- **Mode Sysadmin** sekarang memakai sidebar bertumpuk berisi menu semua modul. Dengan tombol kisi, kebutuhan itu
  terpenuhi dengan cara lain; perlu diputuskan apakah sidebar bertumpuk dipertahankan.
- Warna contoh memakai indigo, bukan ungu Odoo, supaya tidak terlihat seperti salinan Odoo.

## 3. Kenapa ini tidak memberatkan database

- Semua halaman membaca data yang **sudah dimuat** ke browser. Tidak ada query baru untuk tampilan baru.
- Mengurangi kolom dan memecah riwayat per halaman justru **meringankan** browser, bukan menambah beban.
- Tidak ada tabel, kolom, atau migration baru. Database tidak disentuh sama sekali.

## 4. Isi tiap halaman — modul Finance

Keterangan kolom **Dampak ke halaman lain** berasal dari pemeriksaan kode (file mana dipakai di mana), bukan
perkiraan. "Hanya Finance" berarti file itu tidak dipakai modul lain.

### 4.1 Ringkasan (Dashboard)
| Sekarang tampil | Usul | Dampak ke halaman lain |
|---|---|---|
| 4 kartu angka (PO menunggu, invoice material, invoice vendor, total dibayar) | **Tetap**, angka ditulis ringkas agar tidak meluber | Tidak ada. Dashboard hanya membaca. |
| Payment due (Overdue, Due hari ini, Due berikutnya) — semuanya Rp 0 | **Hapus sementara** sampai dipastikan data jatuh tempo ada | Tidak ada |
| Daftar "Invoice menunggu verifikasi" | **Ganti** jadi tautan "8 invoice menunggu dibayar" ke Pembayaran | Tidak ada. Daftar aslinya tetap di Pembayaran. |
| Tabel "Approval queue" | **Hapus** (duplikat halaman Persetujuan PO) | Tidak ada. Persetujuan tetap dilakukan di halamannya. |
| — | **Tambah**: biaya material dan maklon per periode, tren, pecahan per entitas, material belum didistribusikan; filter hari/bulan/tahun | Memakai hitungan Posisi Stok yang sudah ada, supaya angkanya sama |

### 4.2 Persetujuan PO
| Sekarang tampil | Usul | Dampak ke halaman lain |
|---|---|---|
| Tab PO Material dan PO Maklon | **Tetap** | Hanya Finance |
| Kartu filter "No MRP (menunggu approval)" | **Ganti** jadi pil filter kecil; tersembunyi kalau tidak ada PO | Tidak ada |
| Pesan kecil "Tidak ada PO..." | **Ganti** pesan jelas | Tidak ada |
| Tabel Riwayat ditumpuk di bawah | **Pindah** ke tampilan kedua ("Riwayat") dengan cari dan halaman | Tidak ada. Datanya sama. |
| Baris PO melebar ke bawah berisi rincian warna | **Ganti** panel samping | Tidak ada |
| Pilih entitas | **Tetap, wajib** | **Jangan dihapus**: entitas dipakai Paying Voucher Procurement, export PO, dan invoice material |
| Badge jumlah PO di menu | **Tetap** | Fungsi badge dipakai juga Procurement, SCM, GM. Tidak diubah. |

### 4.3 Pembayaran
| Sekarang tampil | Usul | Dampak ke halaman lain |
|---|---|---|
| 3 tab: Material, Maklon, Ekspedisi | **Tetap**, tetapi buka tab yang punya pekerjaan | Hanya Finance |
| Material: 13 kolom | **Kurangi** ke 8 yang Anda sebut (MRP, supplier, vendor maklon, no invoice, kode transaksi, nominal, entitas, status). Sisanya lewat menu Kolom. | Tidak ada. Kolom yang disembunyikan tetap ada datanya. |
| Maklon: 13 kolom | **Kurangi** ke no invoice, vendor, total tagihan, status (jatuh tempo menyusul kalau datanya ada) | Tidak ada |
| Ekspedisi: 15 kolom | **Kurangi** ke resi, MRP, vendor, ekspedisi, tanggal kirim, koli, biaya, status | Tidak ada |
| Tabel riwayat di bawah | **Pindah** ke tampilan "Riwayat" | Tidak ada |
| Unggah bukti bayar | **Tetap, wajib** | **Jangan dihapus**: bukti dilihat vendor di portalnya dan Procurement |
| Potong saldo deposit | **Tetap** | **Jangan dihapus**: mengurangi saldo di halaman Saldo Deposit |
| Tombol koreksi Sysadmin | **Tetap** (hanya muncul di Mode Sysadmin) | Dipakai Sysadmin. Harus tetap ada di tampilan baru. |

### 4.4 Saldo Deposit
Belum saya lihat dengan data nyata; usul ini dari pembacaan kode dan perlu dicek ulang.
| Sekarang tampil | Usul | Dampak ke halaman lain |
|---|---|---|
| Kartu Jumlah Transaksi, Saldo Berjalan, Status | **Ganti** satu kartu saldo per pihak (supplier, vendor, ekspedisi) | Tidak ada |
| Tabel mutasi | **Tetap**: tanggal, nama pihak, jenis, deskripsi, nilai | Memakai tabel bersama (17 halaman). Diatur lewat pengaturan, komponennya tidak diubah. |
| Form tambah deposit | **Tetap** | **Jangan dihapus**: satu-satunya tempat mencatat deposit; dipakai Pembayaran |

### 4.5 Posisi Stok
| Sekarang tampil | Usul | Dampak ke halaman lain |
|---|---|---|
| 4 kartu (dibeli, belum produksi, proses, sudah delivery) | **Tetap** | Hanya Finance |
| Tabel 13 kolom per MRP dan vendor | **Kurangi** bawaan ke MRP, vendor, roll, nilai, posisi (total belum produksi, total proses, sudah delivery). Rincian tahap lewat panel samping. | Tidak ada |
| — | **Tambah** Export Excel untuk laporan bulanan | Tidak ada |
| Hitungan nilai | **Tidak diubah** | Akan dipakai Dashboard; mengubahnya membuat dua halaman berbeda angka |

### 4.6 Laporan HPP
| Sekarang tampil | Usul | Dampak ke halaman lain |
|---|---|---|
| Kartu "Filter No. MRP (untuk card di bawah)" | **Ganti** satu filter yang berlaku untuk kartu dan tabel | **Ikut berubah di SCM** (halaman yang sama dipakai SCM > Laporan HPP) |
| 4 kartu angka (meluber) | **Tetap**, ditulis ringkas | Ikut berubah di SCM |
| Tabel MRP lalu vendor | **Tetap** | Ikut berubah di SCM |
| — | **Tambah** yield, dan filter per delivery (resi atau tanggal kirim) | Ikut muncul di SCM. Perlu dicek dulu datanya. |
| Tombol Download dan Template HPP | **Tetap** | Unduhan memakai pilihan di pop-up-nya sendiri, tidak terpengaruh perubahan tabel |

### 4.7 Master Data (Entitas)
| Sekarang tampil | Usul | Dampak ke halaman lain |
|---|---|---|
| Daftar entitas | **Tetap** | **Jangan dihapus**: jadi pilihan entitas di Persetujuan PO dan dipakai export |

## 5. Ringkasan keamanan perubahan

- **Aman dihapus atau diganti** (tidak dipakai halaman lain): kartu dan tabel duplikat di Dashboard, kartu filter,
  susunan kolom bawaan, baris yang melebar ke bawah, letak tabel riwayat.
- **Harus tetap ada walau tampilannya berubah**: pilih entitas, unggah bukti bayar, potong deposit, form tambah
  deposit, tombol koreksi Sysadmin, badge menu.
- **Berubah di lebih dari satu modul**: Laporan HPP (Finance dan SCM). Saya akan menyebut ini setiap kali menyentuhnya.
- **Tidak disentuh sama sekali**: rumus (HPP, posisi stok, ongkir), aturan approval, database.

## 6. Keputusan owner 2026-11-16

- **Gaya Odoo disetujui** (bar atas, tombol kisi pindah modul, baris kendali, panel samping).
- **Halaman utama (pilih modul)**: susunan kisi ala Odoo, tetapi **tulisan besar di sisi kiri dipertahankan**
  seperti sekarang ("Selamat Datang di Mini ERP Tigalapan") dan **ikon modul memakai ikon yang sekarang**,
  bukan huruf awal.
- **Urutan kerja**: inspeksi dari hulu aplikasi, per modul, owner meninjau tiap rekomendasi sebelum dikerjakan.
  Urutan mengikuti alur barang: PPIC, Procurement, Finance, SCM, Produksi, Warehouse, General Manager, Sysadmin.
- Setiap usul hapus atau ubah tabel wajib disertai hasil cek keterkaitan ke halaman lain.

## 7. Filter, grouping, export, dan simpan favorit ala Odoo

**Bisa dibuat, dan tidak membebani database.** Alasannya: seluruh data sudah dimuat ke browser saat aplikasi
dibuka. Menyaring, mengelompokkan, menjumlah, dan membuat file Excel semuanya dikerjakan browser dari data itu.
Tidak ada query baru ke Supabase.

| Kemampuan | Cara kerja | Beban database |
|---|---|---|
| Filter bebas | Kolom apa pun, banyak nilai, rentang tanggal dan angka; tampil sebagai keping di kotak cari | Nol |
| Kelompokkan (group by) | Satu atau dua tingkat (mis. Vendor lalu Status), tiap kelompok bisa dibuka-tutup dan punya jumlah baris serta total kolom angka | Nol |
| Export tampilan | "Export yang tampil": kolom yang terlihat, filter, dan pengelompokan aktif, jadi Excel. Dibuat di browser. | Nol |
| Simpan favorit | Gabungan filter + kelompok + kolom + urutan diberi nama ("Belum dibayar per vendor"), bisa dijadikan bawaan | Nol (lihat batasan) |

Batasan yang perlu owner tahu:
1. **Favorit tersimpan di browser perangkat itu**, per akun dan per tabel. Kalau staf pindah komputer atau ganti
   browser, favoritnya tidak ikut. Supaya ikut ke semua perangkat atau bisa dibagikan ke rekan satu tim, perlu satu
   tabel kecil di database, dan itu permintaan ke tim IT. Saran: mulai dari versi browser dulu.
2. **Export khusus yang sudah ada tidak diganti** (template BY38, WIP Tracking, Laporan HPP berumus, PO Moka,
   Form Rasio). Formatnya dibuat khusus untuk pihak lain. "Export tampilan" adalah tambahan, bukan pengganti.
3. Mesin ini dipasang di komponen tabel bersama (`DataTable`, 17 halaman) sebagai tambahan; tabel lama tetap
   bekerja seperti biasa sampai dinyalakan per halaman. Halaman yang memakai tabel buatan sendiri dipindahkan
   bertahap.
4. Tabel besar dibagi per halaman supaya ringan: saat ini Tracking Item merender 881 baris dan Master SKU 2.139
   baris sekaligus.

## 8. Kartu angka di atas halaman

**Cocok dipakai, dengan empat aturan** supaya berguna dan tidak jadi hiasan:
1. **Maksimal empat kartu** per halaman, hanya angka yang memicu tindakan atau keputusan.
2. **Kartu bisa diklik dan berfungsi sebagai filter** (klik "Di cutting" menyaring tabel ke barang yang masih di
   cutting).
3. **Angka mengikuti filter aktif**, jadi kartu dan tabel selalu bercerita hal yang sama.
4. **Angka tidak boleh meluber**: "Rp" dan angkanya satu baris, ditulis ringkas (Rp 3,42 M) dengan nilai lengkap di
   bawahnya. Pada tangkapan layar Laporan HPP dari owner, "Rp" terpisah baris dan angka menyentuh tepi kartu.

## 9. Isi tiap halaman — modul PPIC (hulu aplikasi)

Diinspeksi 2026-11-16 dengan data nyata (12 MRP, 347.115 pcs terjadwal). Menu gaya Odoo untuk PPIC:
**Ringkasan | MRP | Tracking Item | Pengaturan (SKU, Mapping Warna, Migrasi Data)**. Alamat halaman tidak berubah.

PPIC adalah hulu: MRP yang diimpor di sini dipakai Procurement (PO), vendor (Aduan Pola), Finance, dan semua
laporan. Karena itu **cara impor dan isi data tidak disentuh sama sekali**; yang diubah hanya penataan layar.

### 9.1 Ringkasan (Overview produksi)
| Sekarang tampil | Usul | Dampak ke halaman lain |
|---|---|---|
| 4 kartu: MRP aktif, menunggu approval SCM, PO dikirim, completion | **Tetap**, jadi kartu yang bisa diklik | Tidak ada |
| Tabel "End-to-end proses per MRP": 8+ kolom angka, terpotong di kanan; nama MRP panjang menabrak angka | **Ganti** satu baris per MRP dengan pita tahapan (PO, bayar, terima, cutting, FG, kirim) dalam persen. Angka rinci di panel samping. | Tidak ada. Tabel ini hanya dipakai Ringkasan PPIC. |
| Baris MRP melebar ke bawah per vendor lalu per warna | **Ganti** panel samping | Tidak ada |

### 9.2 MRP
| Sekarang tampil | Usul | Dampak ke halaman lain |
|---|---|---|
| Kotak besar "Import dokumen MRP" di atas, memakan hampir separuh layar | **Pindah** ke tombol "Import MRP" yang membuka panel samping. Daftar MRP naik ke atas. | Tidak ada. Proses impornya sama persis. |
| 4 pilihan filter (Vendor, Status PO, Status Raw Material, Status Produksi) | **Ganti** kotak cari + keping filter + kelompokkan (mis. per Status Produksi) | Tidak ada |
| Tabel: No MRP, Qty, 4 kolom status, Aksi | **Tetap**. Kolom tanggal tetap pilihan di menu Kolom, dan pilihannya tersimpan. | Tidak ada |
| Baris melebar: rincian warna, roll, rib, vendor | **Pindah** ke panel samping, memakai tabel rincian yang sama | Tabel rincian itu dipakai juga SCM (Approval MRP, Monitoring). Komponennya tidak diubah, hanya tempat tampilnya di PPIC. |
| Tombol Form Rasio, Reset MRP di tiap baris | **Pindah** ke panel samping (Reset tetap dengan konfirmasi pop-up) | Form Rasio juga dipakai vendor dan Procurement; tidak diubah |
| Tombol "Input manual" | **Tetap** sebagai pilihan kedua di samping Import | Halaman input manual tidak diubah |
| Tombol koreksi Sysadmin (Hapus MRP, Mundurkan approval) | **Tetap** di Mode Sysadmin | **Jangan dihapus**: dipakai Sysadmin |

### 9.3 Tracking Item
| Sekarang tampil | Usul | Dampak ke halaman lain |
|---|---|---|
| 7 kartu posisi barang, dua baris | **Tetap 7** (memang tujuh posisi barang), satu baris ringkas dan **bisa diklik sebagai filter** | **Ikut berubah di SCM** (halaman yang sama) |
| 7 pilihan filter + 2 tanggal dalam satu kartu besar | **Ganti** kotak cari + keping + kelompokkan (Warna, Kategori, MRP, Vendor) + favorit | Ikut berubah di SCM |
| Tabel 881 baris dirender sekaligus | **Bagi per halaman** (50 baris) | Ikut berubah di SCM. Lebih ringan. |
| 11 kolom bawaan dari 22 | **Tetap**, pilihan kolom tersimpan | Tidak ada |
| Tombol Export Excel (template WIP, mengikuti filter) | **Tetap, perilakunya tidak diubah** | **Hati-hati**: export ini mengikuti filter layar. Filter baru harus menghasilkan baris yang sama dengan filter lama untuk pilihan yang sama. Diuji sebelum dan sesudah. |
| Klik baris membuka pop-up rincian per MRP, vendor, dan koli | **Ganti** panel samping, isi sama | Ikut berubah di SCM |

### 9.4 Pengaturan (Master Data)
| Sekarang tampil | Usul | Dampak ke halaman lain |
|---|---|---|
| Tab SKU, Mapping Warna, Migrasi Data | **Pindah** jadi tiga pilihan di menu Pengaturan | Hanya PPIC |
| SKU: 2.139 baris dirender sekaligus | **Bagi per halaman**, bisa dikelompokkan per Kategori | Tidak ada. Data SKU dipakai Laporan HPP, export Warehouse, dan WMS; **isinya tidak disentuh**. |
| Import Data, Tambah SKU, Edit | **Tetap** | Tidak ada |
| Migrasi Data (alat sekali pakai untuk data awal) | **Tetap**, paling bawah di menu | Tidak ada |

### Ringkasan PPIC
- **Aman**: semua perubahan di atas hanya memindahkan letak dan cara menampilkan. Tidak ada tabel yang dibuang isinya.
- **Berubah di dua modul**: Tracking Item (PPIC dan SCM).
- **Perlu diuji khusus**: export Tracking Item, karena mengikuti filter.
- **Yang diusulkan dihapus**: tidak ada fitur yang dihapus di PPIC. Yang hilang hanya kotak impor besar dan
  baris yang melebar ke bawah, keduanya diganti panel samping.

## 10. Yang belum dicakup dokumen ini

Procurement, SCM, Produksi, Warehouse, General Manager, dan Sysadmin belum dijabarkan per halaman. Dikerjakan
berurutan setelah rekomendasi PPIC ditinjau owner. Finance sudah ada di bagian 4 (ditulis sebelum gaya Odoo
dipilih; menu dan filter mengikuti bagian 2b dan 7).
