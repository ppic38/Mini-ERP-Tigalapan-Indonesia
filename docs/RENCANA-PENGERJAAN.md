# Rencana Pengerjaan Redesign — dokumen serah-terima

> Dibuat 2026-11-16. **Baca file ini lebih dulu kalau melanjutkan pekerjaan di sesi atau AI lain.**
> Lalu baca RENCANA.md (aturan keselamatan dan cara menjalankan lingkungan lokal) dan
> docs/DESAIN-DAN-FITUR.md (keputusan desain dan rekomendasi per halaman).
>
> Tanda: `[x]` selesai, `[~]` sedang dikerjakan, `[ ]` belum, `[?]` menunggu keputusan owner.
> Setiap paket yang selesai: ubah tandanya di sini dan tulis hash commit-nya.

## 0. Ringkasan untuk yang baru datang

**Apa ini.** Mini ERP garmen (Next.js + Supabase) yang LIVE dan dipakai kantor setiap hari. Tim IT owner
mengubah kode dan database live setiap hari. Owner ingin tampilan dirapikan tanpa mengganggu yang berjalan.

**Yang sudah diputuskan owner** (jangan ditawar ulang):
1. Gaya **Odoo**: bar menu di atas (bukan sidebar), tombol kisi untuk pindah modul, baris kendali (jejak
   halaman, kotak cari dengan keping filter, penghitung halaman). Contoh: `docs/mockup/gaya-odoo.html`.
2. Rincian dibuka di **panel samping**, bukan pop-up dan bukan baris yang melebar. Pop-up hanya untuk konfirmasi.
3. Halaman utama: kisi modul ala Odoo, **tulisan besar di kiri dipertahankan**, **ikon modul yang sekarang dipakai**.
4. **Filter, kelompokkan (group by), export, dan simpan favorit** ala Odoo, dikerjakan di browser.
5. **Kartu angka** dipakai, maksimal empat, bisa diklik sebagai filter, tidak boleh meluber.
6. **Field fleksibel**: pengguna bebas memilih, mengurutkan, dan menyimpan kolom, karena kebutuhan field belum final.
7. **Pemantauan staging**: status satu PO/MRP dari hulu ke hilir terlihat di satu tempat, tanpa membuka tiap modul.
8. **Login tidak diubah. Modul Vendor Produksi tidak disentuh.**
9. Urutan modul mengikuti alur barang: PPIC, Procurement, Finance, SCM, Produksi, Warehouse, GM, Sysadmin.

**Batas keras** (dari RENCANA.md):
- **Nol perubahan database.** Tidak ada tabel, kolom, migration, RPC, atau Server Action baru untuk membaca.
- **Menambah, bukan mengganti**: komponen bersama diberi prop opsional yang bawaannya = perilaku sekarang.
- **Jangan mengubah URL halaman** (dipakai `proxy.ts`, `vendor_users.allowed_pages`, dan badge).
- **Jangan push ke `main`** tanpa izin owner (push = langsung tayang). Kerja di branch, uji di `localhost`.
- Sebelum menghapus atau mengubah tabel/kolom/filter: jalankan 5 pemeriksaan di RENCANA.md dan laporkan dampaknya.
- Rumus (HPP, posisi stok, ongkir), aturan approval, dan alur impor MRP **tidak disentuh**.

**Kenapa semua ini tidak membebani database.** Aplikasi memuat satu snapshot seluruh data ke store browser
(`lib/mrp/store.ts`) saat dibuka. Semua fitur baru (filter, kelompok, export, favorit, pemantauan staging)
menghitung dari data di store itu. Tidak ada query tambahan ke Supabase.

## 1. Hasil inspeksi otomatis (data nyata, layar 1024 px, 2026-11-16)

Kolom "meluber" = selisih lebar tabel terhadap wadahnya dalam piksel (0 = muat).

| Modul | Halaman | Kolom | Baris dirender | Meluber | Pilihan filter | Tinggi halaman | Catatan |
|---|---|---|---|---|---|---|---|
| PPIC | /dashboard/ppic | 7+ | 12 | ya | 0 | — | Tabel proses per MRP terpotong; nama MRP panjang menabrak angka |
| PPIC | /mrp/ppic | 8 | 12 | 0 | 4 | — | Kotak impor memakan separuh layar |
| PPIC | /mrp/ppic/item-tracking | 12 | **881** | 124 | 7+2 | — | Dipakai juga SCM; 7 kartu |
| PPIC | /mrp/ppic/master-data | 9 | **2.139** | — | 2 | — | Tab SKU, Mapping Warna, Migrasi |
| Procurement | /procurement/po-approval | 6 | 12 | 0 | 1 | 1.042 | 3 tab; kartu "MRP tanpa PO" memakai satu kartu penuh |
| Procurement | /raw-material (Paying Voucher) | 6 | 14 | 0 | 0 | 1.071 | 3 tab; dua tabel bertumpuk (belum invoice + riwayat) |
| Procurement | /procurement/material-tracking | 6 | 11 | 0 | 5 | 883 | |
| Procurement | /procurement/raw-material | 12 | 39 | **205** | 0 | **3.581** | Tabel lebar dan halaman sangat panjang |
| Procurement | /procurement/material-claims | 9 | 1 | 0 | 5 | 768 | |
| Procurement | /procurement/master-data | 8 | 48 | 0 | 3 | 821 | 7 tab master |
| SCM | /scm/approval-mrp | 6 | 13 | 0 | 2 | 1.072 | Dua tabel (menunggu + riwayat) |
| SCM | /scm/approval-po | — | 0 | 0 | 0 | 826 | Komponen `PoApprovalQueue`; sudah punya 4 kartu dan kotak cari |
| SCM | /scm/monitoring | 9 | 12 | 102 | 5 | 1.725 | **"Monitoring lintas modul": bibit pemantauan staging** |
| Produksi | /produksi/monitoring | 7 | 12 | 0 | 1 | 1.029 | |
| Produksi | /produksi/reject | 9 | 12 | 35 | 1 | 1.025 | |
| Produksi | /produksi/material-status | 9 | 12 | 34 | 1 | 957 | |
| Produksi | /produksi/yield-alerts | 8 | **595** | 175 | 3 | **47.677** | Halaman 78 layar; badge 248 |
| Finance | (lihat docs/AUDIT-TAMPILAN.md V1–V11) | | | | | | Sudah diinspeksi visual |
| Warehouse, GM, Sysadmin | belum dilihat langsung | | | | | | Lihat sebelum mengerjakan paketnya |

Tiga pola yang berulang di hampir semua modul:
1. **Tabel besar dirender sekaligus** (2.139, 881, 595 baris). Ini sumber lambat di layar, terpisah dari lambat memuat data.
2. **Dua tabel bertumpuk** (yang perlu dikerjakan dan riwayatnya) dengan bentuk yang sama.
3. **Filter berupa deretan `select`** dalam kartu sendiri, tanpa kelompok dan tanpa bisa disimpan.

## 2. Paket kerja

Urutan dipilih supaya manfaat terbesar datang lebih dulu dari perubahan paling kecil. Paket A dan B adalah fondasi
di komponen bersama; setelah itu tiap modul tinggal "menyalakan".

### Paket A — Tabel bersama (`components/mrp/data-table.tsx`, dipakai 17+ halaman)
- [x] **A1. Pilihan kolom tersimpan** per pengguna dan per tabel (localStorage). Kunci bawaan = alamat halaman +
      judul tabel, jadi berlaku di semua tabel tanpa menyentuh tiap halaman. Kolom baru yang ditambah tim IT di
      kemudian hari tetap muncul sesuai bawaannya (simpan daftar "disembunyikan" dan "ditampilkan" terpisah dari bawaan).
- [x] **A2. Bagi halaman otomatis** bila baris > 100 (50 per halaman, bisa 25/50/100/Semua). Hanya tampilan; baris
      yang dihitung export dan total tidak berubah. Memperbaiki 2.139 / 881 / 595 baris sekaligus.
- [ ] **A3. Urutan kolom bisa diubah** (naik/turun di menu Kolom) dan tersimpan. Ini inti "field fleksibel".
- [ ] **A4. Kelompokkan (group by)** satu tingkat dulu: pilih kolom, baris terkumpul per nilai, tiap kelompok bisa
      dibuka-tutup, ada jumlah baris dan total kolom angka. Prop opsional `groupable`.
- [ ] **A5. Filter sebagai keping** di kotak cari, menggantikan deretan `select` (prop opsional; `filterDefs` lama
      tetap diterima dan diubah jadi keping). Dukung banyak nilai per kolom.
- [ ] **A6. Favorit**: simpan gabungan filter + kelompok + kolom + urutan dengan nama; pilih satu sebagai bawaan.
      Disimpan di localStorage per akun (`internalActor.username` atau nama modul) dan per tabel.
- [ ] **A7. Export yang tampil**: tombol yang membuat Excel dari kolom terlihat + filter + kelompok aktif.
      `exceljs` dimuat saat tombol ditekan (`await import`). Export khusus yang sudah ada tidak diganti.
- [ ] **A8. Angka dan teks**: rupiah satu baris rata kanan, kolom pertama menempel saat digeser, nama panjang
      dipotong dengan elipsis dan tooltip.

Uji tiap butir: `tsc` bersih, lalu buka minimal tiga halaman pemakai `DataTable` dari modul berbeda dan pastikan
tampilan bawaan tidak berubah kecuali yang dimaksud. Untuk A2 dan A5: bandingkan hasil export halaman yang
"mengikuti filter" (Tracking Item) sebelum dan sesudah.

### Paket B — Kerangka gaya Odoo (`components/shell/*`, `lib/shell/nav.ts`, `app/page.tsx`)
- [ ] **B1. Kerangka baru di samping yang lama**: `AppShell` menerima pilihan tata letak per modul
      (bawaan = sidebar sekarang). Modul pindah satu per satu.
- [ ] **B2. Bar atas**: tombol kisi, nama modul, menu dengan dropdown (dari `nav.ts`, ditambah pengelompokan opsional),
      notifikasi (`99+`), profil. Badge tetap dari `lib/shell/badges.ts`.
- [ ] **B3. Kisi pindah modul**: lapisan berisi 9 modul dengan ikon yang sekarang. Modul yang sesinya masih aktif
      langsung terbuka; yang lain membuka form password yang sudah ada. **Tidak menyentuh `lib/auth/*`.**
- [ ] **B4. Halaman utama** (`app/page.tsx`): tulisan besar kiri tetap, kanan jadi kisi modul.
- [ ] **B5. Baris kendali** (komponen baru): jejak halaman, kotak cari + keping, favorit, penghitung halaman, tombol aksi.
- [ ] **B6. Panel samping** (komponen baru) dengan penutup Esc, fokus terjaga, layar penuh di HP.
- [ ] **B7. Kartu angka** (komponen baru): ringkas, tidak meluber, bisa diklik sebagai filter.
- [?] **B8. Mode Sysadmin**: sidebar bertumpuk dipertahankan atau diganti kisi. Menunggu owner.

### Paket C — Pemantauan staging ("Lacak")
Kebutuhan owner: melihat status satu PO/MRP di semua tahap tanpa membuka tiap modul.
Bahan yang sudah ada: `components/dashboard/mrp-progress-table.tsx` (proses ujung ke ujung per MRP di Ringkasan
PPIC), `app/scm/monitoring/page.tsx` (status lintas modul per MRP), `mrpStatusBadges`, `materialPoFullStatus`,
`maklonPoDisplayStatus`, dan `lib/mrp/itemTracking.ts`.
- [ ] **C1. Fungsi turunan `stagingOf(mrpId)`** di `lib/mrp/` yang menyusun tahap berurutan dari data store:
      MRP dibuat, disetujui SCM, PO Material (per supplier) dan PO Produksi (per vendor) dengan tahap approvalnya,
      invoice material, dibayar, dikirim supplier, diterima vendor, resting, cutting, finish good, masuk koli,
      dikirim, invoice vendor, dibayar, diterima gudang. **Memanggil fungsi yang sudah ada, tidak menulis ulang rumus.**
- [ ] **C2. Pita tahapan** (seperti status bar Odoo): satu baris per MRP, tiap tahap berupa ruas dengan persen
      dan penanda "macet di sini". Klik ruas membuka panel samping berisi rincian tahap itu dan tautan ke halamannya.
- [ ] **C3. Halaman Lacak** tersedia dari semua modul internal (menu di bar atas), memakai Paket A untuk filter,
      kelompok (per vendor, per supplier, per tahap macet), dan favorit.
- [ ] **C4. Cari lintas modul** di bar atas: ketik nomor MRP, PO, invoice, resi, atau roll, hasilnya menunjuk ke
      baris Lacak. Pencarian di data store, tanpa query.
- [ ] Uji silang: cocokkan minimal tiga MRP dengan halaman aslinya (PO Approval, Payment, Monitoring Produksi).
- Catatan izin: Lacak hanya menampilkan status dan jumlah. Nilai rupiah mengikuti apa yang memang sudah boleh
  dilihat modul itu; tanyakan owner sebelum menampilkan nilai ke modul yang sekarang tidak melihatnya.

### Paket D — Kecepatan (tanpa database)
- [x] **D1.** Bagi halaman tabel (sama dengan A2).
- [ ] **D2. Pustaka unduhan dimuat saat tombol ditekan** di 18 file yang masih impor statis (`exceljs` 10 file,
      PDF/XLSX/OCR 8 file). Cari: `grep -rlE "^import .* from ['\"](exceljs|jspdf|jspdf-autotable|pdfjs-dist|xlsx|tesseract\.js)['\"]" lib components app`.
- [ ] **D3. Kerangka halaman tampil lebih dulu**: ganti layar "Memuat data…" yang menahan semuanya
      (`components/shell/app-shell.tsx` sekitar baris 432) dengan kerangka menu + isi yang menunggu.
- [ ] **D4. Tampilkan data terakhir lalu perbarui** (snapshot disimpan di IndexedDB, dipisah per akun, dihapus saat
      logout). Paling berdampak, paling perlu hati-hati; kerjakan setelah D1–D3 dan ukur.
- [ ] **D5.** Ukur waktu sebelum dan sesudah tiap butir, catat di sini.
- [?] Di luar lingkup (permintaan ke tim IT): snapshot per modul, versi data per kelompok tabel.

### Paket E — Penerapan per modul (setelah A dan B)
Tiap modul = satu branch pendek. Langkah: nyalakan kerangka Odoo, pindahkan filter ke keping, satukan tabel
"tugas + riwayat" menjadi satu daftar dengan filter bawaan, pindahkan rincian ke panel samping, pasang kartu.
Rekomendasi per halaman ada di docs/DESAIN-DAN-FITUR.md (PPIC bagian 9, Finance bagian 4).

- [ ] **E1. PPIC** (disetujui owner). Kotak impor jadi tombol + panel; pita tahapan di Ringkasan; Tracking Item
      (ikut berubah di SCM); Master Data jadi menu Pengaturan.
- [ ] **E2. Procurement.** Purchase Order: kartu "MRP tanpa PO" jadi keping/penanda; 3 tab tetap. Paying Voucher:
      dua tabel jadi satu daftar berfilter "Belum invoice". Raw Material: tabel 12 kolom dipangkas + bagi halaman
      (halaman 3.581 px). Master Data: 7 tab jadi menu Pengaturan.
- [ ] **E3. Finance.** Payment buka tab yang berisi pekerjaan; PO Approval; Laporan HPP (ikut berubah di SCM);
      Dashboard diperkaya.
- [ ] **E4. SCM.** Approval MRP dua tabel jadi satu; Monitoring digantikan atau ditautkan ke Lacak (Paket C).
- [ ] **E5. Produksi.** Yield Alert: filter bawaan "Belum ditindak", kelompok per vendor, bagi halaman
      (sekarang 595 baris, 47.677 px).
- [ ] **E6. Warehouse.** Penerimaan: "Siap dibongkar" sebagai filter bawaan.
- [ ] **E7. General Manager.** Approval enak di HP.
- [ ] **E8. Sysadmin.**

Yang harus tetap ada di tampilan baru (jangan hilang saat merapikan): pilih entitas di approval PO Material, unggah
bukti bayar, potong saldo deposit, form tambah deposit, tombol koreksi Sysadmin di tiap halaman, badge menu, semua
export khusus.

## 3. Catatan teknis untuk yang melanjutkan

- Jalankan aplikasi lokal: lihat "TITIK LANJUT BERIKUTNYA" di RENCANA.md. Ringkasnya: nyalakan Docker Desktop,
  container Supabase hidup sendiri, lalu dev server (`.claude/launch.json`, port 3000). `.env.local` menunjuk
  database lokal; password uji semua modul ada di `.env.local` (`INTERNAL_PASSWORD_*`), jangan ditulis di chat.
- Nama folder memuat `&`: jalankan lewat node langsung, mis. `node node_modules/typescript/bin/tsc --noEmit`.
- Commit: `git -c user.name="ppic38" -c user.email="ppic3803@gmail.com" commit ...` (laptop ini tanpa identitas git).
- Baca `node_modules/next/dist/docs/` sebelum menulis kode Next (versi ini berbeda dari yang umum; lihat AGENTS.md).
- Setiap perubahan fitur dicatat di MIGRASI.md (entri baru di atas), mengikuti kebiasaan repo.
- Login otomatis untuk inspeksi: di halaman `/`, klik elemen teks nama modul yang **terakhir** cocok (kata yang sama
  juga muncul di teks besar kiri), isi `input[type=password]` lewat setter bawaan + event `input`, lalu `form.requestSubmit()`.

## 4. Log pengerjaan

| Tanggal | Paket | Yang dikerjakan | Commit |
|---|---|---|---|
| 2026-11-16 | — | Rencana ini dibuat; inspeksi otomatis PPIC, Procurement, SCM, Produksi | (lihat git log) |
| 2026-11-16 | A1, A2, D1 | `DataTable`: pilihan kolom tersimpan (selisih dari bawaan, kunci = alamat halaman + judul) dan bagi halaman otomatis di atas 100 baris. Diuji: Yield Alert 595 baris jadi 50 (tinggi halaman 47.677 px jadi 4.771 px), SKU 2.139 jadi 50, Tracking Item 881 jadi 50; tabel 48 dan 39 baris tidak berubah; kolom yang dimatikan bertahan setelah muat ulang. Branch `redesign-fondasi-tabel`, BELUM di-merge ke `main`. | `fbe0d5f` |
