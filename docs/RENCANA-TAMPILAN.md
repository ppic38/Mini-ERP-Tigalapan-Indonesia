# Rencana Perbaikan Tampilan dan Kecepatan — per Modul

> Dibuat 2026-11-15. Pegangan kerja redesign. Aturan keselamatan tetap di RENCANA.md bagian 2
> (nol perubahan database, menambah bukan mengganti, branch pendek, tidak push ke `main` tanpa izin owner).
>
> **Cara baca tanda:** `[x]` sudah dikerjakan, `[ ]` belum, `[~]` sedang dikerjakan, `[?]` menunggu keputusan owner.
> Setiap kali satu butir selesai, tandanya diubah di file ini dan disebut commit-nya.

## Cara kerja yang disepakati

1. Saya buat **contoh layout** (file HTML di `docs/mockup/`) untuk satu pola.
2. Owner melihat dan menyetujui atau meminta ubahan.
3. Baru setelah disetujui, pola itu diterapkan ke kode, satu modul per branch.
4. Hasilnya dilihat owner di `localhost`, baru di-merge ke `main` atas izin owner.

## Status keseluruhan

- [x] Lingkungan lokal dengan salinan data live (`c479494`)
- [x] Audit struktur 71 halaman (`docs/AUDIT-TAMPILAN.md`)
- [x] Audit visual Finance: Dashboard, Payment, PO Approval, Posisi Stok, Laporan HPP (V1–V11)
- [x] Tujuan tiap menu Finance dari owner (`docs/IA-FINANCE.md`)
- [~] Contoh layout pola "Pekerjaan vs Riwayat" (`docs/mockup/contoh-payment.html`) — **menunggu persetujuan owner**
- [ ] Audit visual modul lain (Procurement, SCM, PPIC, Produksi, Warehouse, GM, Sysadmin)
- [ ] Belum ada satu baris kode tampilan yang diubah

---

## A. Lima pola bersama (dikerjakan sekali, dipakai semua modul)

Sebagian besar masalah berulang di banyak halaman. Memperbaikinya di komponen bersama jauh lebih murah dan
lebih aman daripada menyunting 71 halaman satu per satu.

### A1. Pekerjaan vs Riwayat
Masalah: dua tabel berbentuk mirip ditumpuk (yang harus dikerjakan, dan yang sudah lewat). Terlihat di
PO Approval, tiga jenis Payment, Warehouse Penerimaan, Invoice Vendor.
- [?] Halaman dibuka pada **pekerjaan**; riwayat jadi tampilan kedua (tombol sakelar), bukan tabel di bawahnya.
- [?] Pekerjaan berbentuk **daftar keputusan** (baris besar, tombol aksi); riwayat berbentuk **tabel padat** dengan
      cari, rentang tanggal, dan halaman.
- [?] Kalau tab pertama kosong tetapi tab lain punya pekerjaan, **buka tab yang punya pekerjaan** (temuan V2).
- [?] Keadaan kosong ditulis jelas ("Tidak ada yang menunggu dibayar") dan menunjuk ke tab lain yang masih berisi.

### A2. Kartu angka yang tidak pernah meluber
Masalah: angka rupiah besar menabrak tepi kartu (V1 Dashboard, V7 Laporan HPP).
- [ ] Angka besar ditulis ringkas (`Rp 8,13 M`) dengan nilai lengkap di baris kecil di bawahnya.
- [ ] Satu komponen kartu angka dipakai semua halaman.

### A3. Tabel yang mengingat pilihan pengguna
Masalah: `DataTable` dipakai 17 halaman; pilihan kolom hilang setiap halaman dibuka; beberapa tabel 13–79 kolom.
- [ ] Pilihan kolom dan urutan tersimpan per pengguna per tabel (localStorage).
- [ ] Susunan kolom bawaan dirancang per peran berdasarkan jawaban pengguna, bukan menumpuk.
- [ ] Angka rupiah satu baris, rata kanan, huruf mono; kolom pertama tetap terlihat saat digeser.
- [ ] Tabel panjang dibagi halaman (25/50/100) supaya layar tidak merender ribuan baris sekaligus.

### A4. Filter yang hemat tempat
Masalah: satu `select` memakai satu kartu penuh, bahkan saat belum ada yang bisa dipilih (V4, V8).
- [ ] Filter jadi satu baris pil di atas tabel (pola `MultiSelectFilter` yang sudah ada), bukan kartu tersendiri.
- [ ] Filter disembunyikan kalau tidak ada data untuk disaring.

### A5. Notifikasi dan badge yang bermakna
Masalah: badge Notifikasi 183 (V5); badge menu tidak selalu sama dengan pekerjaan di layar (V2).
- [ ] Badge menu = jumlah yang betul-betul menunggu peran itu, dan klik membawa ke tempat pekerjaannya.
- [ ] Notifikasi lama dikelompokkan atau diberi "tandai semua dibaca"; angka di atas 99 ditulis `99+`.

---

## B. Kecepatan loading

Fakta yang sudah diukur atau dicek di kode:
- Setiap pembukaan aplikasi memuat **satu snapshot 4–5 MB** berisi seluruh tabel, dan layar **ditahan total**
  dengan tulisan "Memuat data…" sampai selesai (1,2–2,6 detik rata-rata, pernah 8 detik lalu timeout).
- Snapshot **tidak disimpan di browser**: buka tab baru atau muat ulang berarti menunggu dari nol lagi.
- Pustaka Excel (`exceljs`) di-import statis di **10 file**, pustaka PDF/XLSX/OCR di **8 file**. Pustaka besar ini
  ikut diunduh browser saat halaman dibuka, walaupun pengguna tidak menekan Download.
- Halaman berat menghitung ulang seluruh turunan setiap render (Laporan HPP pernah diperbaiki dengan `useMemo`).

### B1. Tanpa menyentuh database (bisa saya kerjakan)
- [ ] **Tampilkan dulu, perbarui kemudian.** Snapshot terakhir disimpan di browser (IndexedDB). Saat aplikasi
      dibuka, data terakhir langsung tampil, lalu diperbarui di latar belakang kalau versi data berubah.
      Pengecekan versi yang sudah ada (`get_data_version`) dipakai apa adanya. Perkiraan dampak: layar pertama
      muncul hampir seketika pada kunjungan kedua dan seterusnya.
      Catatan keamanan: data tersimpan di perangkat pengguna; harus dihapus saat logout dan dipisah per akun.
- [ ] **Kerangka halaman, bukan layar kosong.** Sidebar, judul, dan kerangka tabel tampil lebih dulu; hanya isi
      yang menunggu.
- [ ] **Pustaka unduhan dimuat saat tombol ditekan** (`await import`) di 18 file yang masih statis. Separuh file
      export sudah memakai cara ini, jadi polanya sudah ada.
- [ ] **Hitungan berat di-memo** di halaman yang belum (ukur dulu, jangan menebak).
- [ ] **Tabel dibagi halaman** (lihat A3) supaya render awal ringan.
- [ ] Ukur sebelum dan sesudah tiap butir di atas, catat angkanya di sini.

### B2. Butuh tim IT (bukan lingkup saya; dicatat sebagai permintaan)
- [?] Snapshot per modul: Finance tidak perlu memuat data cutting, vendor tidak perlu data Finance. Ini perbaikan
      terbesar, tetapi mengubah fungsi database.
- [?] Versi data per kelompok tabel, supaya input produksi tidak memaksa semua modul memuat ulang.
- [?] Periksa `EXPLAIN ANALYZE` fungsi snapshot dan region/ukuran compute Supabase.

---

## C. Rekomendasi per modul

Tanda `(visual)` = sudah dilihat dengan data nyata. `(struktur)` = baru dari pembacaan kode; perlu audit visual
sebelum dikerjakan.

### C1. Finance (visual) — modul pertama
| Menu | Irama | Rekomendasi | Tanda |
|---|---|---|---|
| Dashboard | Mingguan, bulanan | Dibangun ulang sebagai monitoring: filter hari/bulan/tahun, biaya material dan maklon beserta tren, pecahan per entitas, outstanding material (pakai `stockPosition.ts`). Nol aksi. Enak di HP. | [ ] |
| PO Approval | Mingguan | Pola A1. Baris keputusan: supplier, nilai, entitas (dipilih di tempat), tombol Setujui/Tolak. Enak di HP. Disatukan dengan komponen approval GM/SCM/Procurement. | [?] |
| Payment | **Harian** | Pola A1 + buka tab yang berisi pekerjaan. Kolom per jenis sesuai daftar owner. Bar bayar menempel di bawah saat ada yang dicentang. | [?] |
| Saldo Deposit | Harian | Kartu saldo per pihak di atas, daftar mutasi di bawah, tombol "Tambah deposit" satu. Belum diaudit visual. | [ ] |
| Posisi Stok | Bulanan | Sudah benar angkanya (V11). Rapikan tabel (A3), tambah Export Excel untuk laporan bulanan. | [ ] |
| Laporan HPP | Harian | Kartu angka (A2), tambah yield, filter per **delivery** selain per MRP, satukan filter kartu dan tabel. | [ ] |

### C2. Procurement (struktur)
- [ ] `/procurement/master-data` punya **79 kolom dan 25 tab**: dipecah menjadi daftar kiri (jenis master) dan
      satu tabel di kanan, bukan 25 tab sejajar.
- [ ] `/procurement/po-approval` (1.239 baris kode, 24 kolom, 8 tombol unduh): pola A1, unduhan dikumpulkan
      dalam satu menu "Unduh".
- [ ] Paying Voucher, Invoice Vendor, Invoice Ekspedisi: pola A1.
- [ ] Material Tracking, Raw Material, Material per Warna: tabel (A3) dan filter (A4).

### C3. SCM, PPIC, Produksi (struktur)
- [ ] Approval MRP dan Approval PO: pola A1, enak di HP.
- [ ] Tracking Item (22 kolom, dipakai PPIC dan SCM): kolom bawaan dipangkas ke posisi barang; sisanya di menu Kolom
      yang tersimpan (A3). Perubahan berlaku di kedua modul sekaligus.
- [ ] Monitoring Produksi, Monitoring Reject, Yield Alert: ringkasan di atas, rincian lewat klik.

### C4. Warehouse (struktur)
- [ ] Penerimaan: pola A1 ("Siap dibongkar" sebagai pekerjaan, Riwayat sebagai tampilan kedua).

### C5. General Manager (struktur)
- [ ] Approval PO dipakai dari HP: daftar keputusan satu kolom, tombol besar, nilai dan supplier paling menonjol.
- [ ] Dashboard GM: ringkasan lintas modul, nol aksi.

### C6. Sysadmin (struktur)
- [ ] Sidebar bertumpuk tetap; hanya ikut pola bersama.

### C7. Vendor Produksi
- Tidak disentuh (keputusan owner: sudah dirapikan untuk HP).

### Pembersihan (menunggu keputusan owner)
- [?] `/gate-to-gate` dan `lib/g2g/` (sekitar 500 baris, tidak terhubung ke data ERP): dihapus atau dibiarkan.
- [?] `/finance/invoice-maklon`, `/finance/ledger`, `/mrp/ppic/new`: dipertahankan atau disembunyikan.

---

## D. Urutan pengerjaan yang saya usulkan

1. [~] Contoh layout pola A1 disetujui owner.
2. [ ] Pola bersama A2, A3 (simpan pilihan kolom), A4 di komponen bersama. Tampilan lama tetap sama kecuali yang diperbaiki.
3. [ ] Kecepatan B1 butir pustaka unduhan dan kerangka halaman (risiko rendah), lalu "tampilkan dulu, perbarui kemudian".
4. [ ] Finance: Payment, lalu PO Approval, lalu Laporan HPP, lalu Dashboard.
5. [ ] Audit visual modul berikutnya, contoh layout bila polanya baru, lalu penerapan. Urutan: Warehouse, Procurement, SCM/PPIC/Produksi, GM.

## Catatan perubahan
| Tanggal | Yang berubah | Commit |
|---|---|---|
| 2026-11-15 | Rencana ini dibuat; contoh layout Payment dibuat | (belum di-commit) |
