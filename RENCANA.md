# Rencana Kerja Berjalan (serah terima antar sesi/akun Claude)

> Dibaca otomatis setiap sesi (lewat CLAUDE.md). Sesi yang menyelesaikan atau mengubah rencana di sini WAJIB
> memperbaruinya sebelum selesai. Riwayat fitur yang SUDAH jadi tetap dicatat di MIGRASI.md.
> Terakhir diperbarui: 2026-11-12.

## Konteks penting (dibaca sebelum mengambil keputusan apa pun)
- Ini **web kantor yang LIVE dan dipakai operasional harian**. Aplikasi rusak = pekerjaan kantor berhenti.
- **Tim IT owner update setiap hari ke live**, kode MAUPUN struktur database. Terukur dari riwayat git:
  2-6 commit per hari langsung ke `main`, tanpa branch (11 Nov: 6 commit, 10 Nov: 5, 12 Nov: 2).
  Commit mereka menyentuh file UI yang sama dengan sasaran redesign (tabel, panel vendor, halaman produksi).
- Push ke `main` = langsung ter-deploy ke production (Vercel). Tidak ada tahap persetujuan otomatis.
- Bukti pola yang GAGAL di repo ini: branch `ui-mobile/vendor-produksi` tertinggal 93 commit dan commit
  terakhirnya "selesaikan konflik MIGRASI.md". **Branch berumur panjang tidak cocok untuk repo ini.**

## Cara melanjutkan di akun Claude lain
- **Laptop yang sama:** buka Claude Code di folder ini, lalu ketik: "lanjutkan dari RENCANA.md".
  Semua file (termasuk yang belum di-commit) ada di folder ini; tidak perlu memindahkan apa pun.
- **Laptop lain / Claude web:** pekerjaan harus di-commit dan di-push dulu ke GitHub
  (`ppic38/Mini-ERP-Tigalapan-Indonesia`); yang belum di-push tidak terlihat dari sana.
- Branch: untuk pekerjaan redesign dipakai **satu branch per modul, umur maksimal 2-3 hari** (lihat bagian 2).
  Branch `pengembangan` ada secara lokal dan isinya masih identik dengan `main` (commit `6c2840b`), belum pernah
  di-push. Jangan push ke `main` tanpa persetujuan owner: push ke `main` langsung ter-deploy ke aplikasi online.
- Catatan teknis laptop ini: nama folder memuat `&`, jadi `npx`/`npm run` gagal. Jalankan lewat node langsung, mis.
  `node node_modules/typescript/bin/tsc --noEmit`, `node node_modules/next/dist/bin/next dev`,
  `node node_modules/supabase/dist/supabase.js <perintah>`.

## 1. Lingkungan lokal (Supabase di Docker) -- SEDANG DIKERJAKAN, PRASYARAT REDESIGN
Tujuan owner: perubahan kode dan database diuji di laptop dulu, tidak langsung ke data/aplikasi live.
Bagian 2 (redesign) TIDAK BOLEH dimulai sebelum bagian ini selesai, khususnya langkah 5
(`.env.local` masih menunjuk LIVE = setiap klik di app lokal menulis ke data operasional kantor).

Sudah (belum di-commit):
- Supabase CLI `2.122.0` dipasang sebagai devDependency (`package.json`, `package-lock.json`).
- `supabase/config.toml` dibuat (`supabase init`): migrations dan seed DIMATIKAN (struktur + data disalin dari live),
  realtime, edge_runtime, analytics dimatikan. Port: API 54321, DB 54322, Studio 54323.
- `scripts/dev/db-sync.sh` (dibuat sesi lain, disesuaikan): kalau `DEV_DB_URL` di `.env.db-sync` kosong, tujuan =
  database lokal `postgresql://postgres:postgres@127.0.0.1:54322/postgres`. LIVE hanya dibaca (pg_dump).
  Sintaks dicek; belum pernah dijalankan sungguhan. PostgreSQL 18 (`psql`, `pg_dump`) sudah terpasang.
- `.env.live-backup` = salinan `.env.local` yang menunjuk LIVE (jangan dihapus).

Status 2026-11-12 (update sore): Docker Desktop & WSL sekarang JALAN NORMAL (sebelumnya macet, lihat riwayat di
bawah). `docker version` menampilkan Server (Docker Desktop 4.98.0, Engine 29.9.2). `wsl -l -v` menampilkan
distro `docker-desktop` Running. Docker Desktop terpasang di lokasi non-default:
`C:\Users\ASUS\AppData\Local\Programs\DockerDesktop\Docker Desktop.exe` (bukan `C:\Program Files\Docker`).

`node node_modules/supabase/dist/supabase.js start` SUDAH dijalankan dan BERHASIL (unduh image pertama selesai,
~8 menit). Supabase lokal AKTIF dengan nilai dari `supabase status`:
- `API_URL` = `http://127.0.0.1:54321`, `STUDIO_URL` = `http://127.0.0.1:54323`,
  `DB_URL` = `postgresql://postgres:postgres@127.0.0.1:54322/postgres`
- `ANON_KEY` dan `SERVICE_ROLE_KEY` = nilai DEMO BAWAAN Supabase CLI (sama untuk semua instance lokal, bukan
  rahasia spesifik project ini) -- jalankan `node node_modules/supabase/dist/supabase.js status` di terminal
  sendiri untuk melihat nilainya saat dibutuhkan, jangan disalin dari sini ke tempat lain tanpa perlu.
- **Database lokal masih KOSONG** (hanya role/schema bawaan Postgres) karena `migrations`/`seed` dimatikan di
  `config.toml` -- strukturnya memang sengaja belum disalin, menunggu langkah db-sync di bawah.

Status riwayat (pagi, SUDAH SELESAI): virtualisasi aktif, WSL belum terpasang, Docker macet di "Starting the
Docker Engine...". `wsl --install` gagal ("connection with the server was reset") karena jaringan laptop ini
tidak bisa menjangkau server unduhan GitHub lewat IPv6 (lewat IPv4 bisa; pakai `curl -4`). Installer resmi
`wsl.3.0.5.0.x64.msi` diunduh lewat IPv4, owner menjalankan installer tsb + membuka Docker -> sekarang beres.

Langkah berikutnya:
1. ~~Pastikan Docker jalan~~ SELESAI.
2. Owner mengisi `LIVE_DB_URL=` di `.env.db-sync` (Supabase > Connect > Session pooler, dengan password database;
   karakter khusus di-encode). JANGAN minta password dikirim ke chat; JANGAN tampilkan isi file `.env*`.
   **Status: masih kosong** (dicek sore 2026-11-12) -- ini satu-satunya yang menahan langkah berikutnya.
3. ~~`supabase start`~~ SELESAI (lihat di atas). Versi Postgres lokal `17.11.0.006` (config.toml `major_version = 17`);
   cocokkan dengan live kalau nanti salin struktur gagal karena beda versi.
4. `bash scripts/dev/db-sync.sh all` (struktur + data live -> lokal, tanpa tabel file lampiran). Cek jumlah tabel/baris.
   **Menunggu langkah 2.**
5. Ganti `.env.local` ke nilai lokal dari `supabase status` (`NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321`,
   anon key, service role key); `SESSION_SECRET` boleh tetap. Live tetap ada di `.env.live-backup`.
6. Jalankan app lokal (`.claude/launch.json`, port 3000/3001) dan pastikan login + data tampil dari database lokal.
7. Catat hasilnya di MIGRASI.md (entri baru di atas) dan tandai selesai di sini.

Catatan laptop restart/sleep: kalau Docker Desktop belum otomatis start, jalankan
`Start-Process "C:\Users\ASUS\AppData\Local\Programs\DockerDesktop\Docker Desktop.exe"` lalu tunggu ~15-20 detik
sebelum `docker version`/`supabase start` dicoba lagi.
Aturan setelah ini: migration baru diuji dulu di lokal; `bash scripts/dev/db-sync.sh diff` (LIVE_DB_URL vs DEV)
menunjukkan struktur yang belum ada di live. Migration ke live tetap dijalankan MANUAL oleh owner.

## 2. Redesign tampilan ERP (5 fase) -- BELUM DIMULAI, MENUNGGU BAGIAN 1
Tujuan owner: merapikan tampilan web (menu makin banyak, halaman makin lambat dan berantakan) TANPA merusak
backend, database, business logic, dan alur transaksi yang sudah berjalan. Dikerjakan di lokal dulu, lalu
dinaikkan ke live secara aman dan bertahap.

### Tiga prinsip yang tidak boleh dilanggar
1. **Redesign = NOL perubahan database.** Struktur database tetap milik tim IT owner. Dengan begitu perubahan
   SQL harian mereka tidak mungkin bentrok dengan pekerjaan redesign. Kalau dashboard butuh angka baru, ambil
   dari fungsi turunan yang sudah ada di `lib/mrp/derive.ts`, JANGAN bikin tabel/kolom/migration baru.
   Kalau ternyata data yang dibutuhkan memang belum ada: catat sebagai permintaan terpisah ke tim IT, keluarkan
   dari lingkup redesign.
2. **Menambah, bukan mengganti.** Komponen bersama (`components/mrp/data-table.tsx`, `components/shell/*`) dan
   `app/globals.css` diubah dengan cara MENAMBAH prop opsional (nilai bawaan = perilaku sekarang) dan token baru;
   token/prop lama tidak dihapus. Jangan menulis ulang halaman secara utuh. Akibatnya: kalau tim IT menambah
   kolom di sebuah tabel sementara redesign mengubah gaya tabel, git bisa menggabungkan keduanya tanpa konflik.
3. **Umur branch maksimal 2-3 hari.** Satu modul = satu branch = selesai = merge. Jangan pernah ada branch
   "redesign" yang hidup berminggu-minggu (lihat bukti kegagalan `ui-mobile/vendor-produksi` di Konteks di atas).

### Fase 0 -- Amankan lingkungan kerja (WAJIB, sebelum apa pun)
Sama dengan bagian 1 di atas. Yang paling mendesak: ganti `.env.local` ke Supabase lokal. Selama belum diganti,
menjalankan app lokal berarti menulis ke data live kantor.

### Fase 0b -- Lingkungan uji online (sangat disarankan, belum dikerjakan)
Saat ini TIDAK ADA tempat uji selain laptop. Deployment preview Vercel kemungkinan besar tidak jalan karena env
var Supabase hanya diisi untuk scope Production (lihat MIGRASI.md entri Vercel 2026-09-15). Untuk web yang dipakai
operasional harian, mengandalkan localhost saja terlalu tipis.
`scripts/dev/db-sync.sh` memang sudah dirancang untuk ini (`DEV_DB_URL` = project Supabase UJI, bukan lokal):
1. Buat project Supabase kedua (gratis) sebagai "UJI".
2. Isi `DEV_DB_URL` di `.env.db-sync` ke project itu, lalu `bash scripts/dev/db-sync.sh all`.
3. Di Vercel, isi env var untuk scope **Preview** mengarah ke project UJI (jangan ke live).
Hasilnya setiap branch dapat URL preview berisi salinan data nyata, bisa dilihat owner/staf sebelum masuk `main`.

### Fase 1 -- Audit tampilan (dokumen, nol risiko kode)
Inventaris seluruh menu, submenu, halaman, tabel. Sumber: `lib/shell/nav.ts` (menu per role) dan struktur folder
`app/`. Keluaran: dokumen daftar halaman -- role, URL, tabel/form apa, masalah tampilannya apa.
Tidak menyentuh kode, jadi bebas dikerjakan kapan saja tanpa memikirkan konflik.

### Fase 2 -- Information Architecture (dokumen + satu commit kecil)
**ATURAN KERAS: jangan mengubah URL halaman.** URL dipakai di tiga tempat sekaligus: aturan akses di `proxy.ts`,
izin anggota tim vendor yang TERSIMPAN DI DATABASE (`vendor_users.allowed_pages`, mis.
`/vendor-maklon/production:CUTTING`), dan badge sidebar (`lib/shell/badges.ts`). Memindahkan URL bisa mencabut
akses user secara diam-diam.
Yang boleh: mengelompokkan ulang menu, mengganti label, mengatur urutan -- semuanya cukup di `lib/shell/nav.ts`.
Kalau URL benar-benar harus pindah: wajib disertai redirect DAN SQL pembaruan `allowed_pages`, dijalankan owner.

### Fase 3 -- Design System (fondasi, additive)
Dikerjakan di dua tempat saja:
- `app/globals.css` -- tambah token warna, tipografi, spacing baru. Token lama JANGAN dihapus.
- Komponen bersama -- `DataTable`, tombol, modal, `AppShell` dapat varian/prop baru yang opsional,
  nilai bawaannya = tampilan sekarang.
Kunci keamanan: setelah fase ini selesai, seluruh aplikasi HARUS tampil persis seperti sebelumnya. Belum ada
perubahan visual; yang bertambah hanya "kosakata" desain untuk dipakai fase 4-5. Target 2-3 hari, satu branch.

### Fase 4 -- Redesign Dashboard (file baru, nol konflik)
Dashboard operasional + dashboard progres per role. File BARU = tidak mungkin bentrok dengan pekerjaan tim IT.
Hanya baca (tanpa aksi tulis), angka dari fungsi turunan yang sudah ada, nol migration.

### Fase 5 -- Implementasi bertahap per modul
Urutan yang disarankan, dari risiko terendah (berdasarkan seberapa sering tim IT menyentuhnya belakangan):
1. Warehouse  2. Finance  3. Procurement  4. SCM / PPIC / Produksi  5. Vendor Produksi (terakhir: paling sering
diubah tim dan sudah punya tampilan HP tersendiri yang rumit).
Per modul: buat branch -> kerjakan 2-3 hari -> uji di lokal -> merge ke `main` -> modul berikutnya.

### Ritual harian (wajib, ~5 menit, sebelum mulai kerja)
```
git pull                                  # ambil pekerjaan tim IT
bash scripts/dev/db-sync.sh diff          # cek apakah struktur DB live berubah
```
Kalau `diff` menunjukkan perbedaan berarti tim IT menjalankan migration baru -> tarik ulang database lokal:
`bash scripts/dev/db-sync.sh all --reset` (ini MENIMPA seluruh database lokal dengan versi live).
Kalau sedang di tengah branch modul, tambahkan `git merge main` SETIAP HARI. Konflik 1 hari mudah; 1 minggu tidak.

### Aturan merge ke `main` (= langsung tayang ke kantor)
- Merge hanya setelah diuji sendiri di lokal: login per role (termasuk akun anggota tim vendor), tampilan desktop
  DAN HP (batas < 1024px), semua tombol aksi utama jalan, `tsc` dan `eslint` bersih.
- Merge di JAM SEPI: pagi sebelum jam kerja atau sore setelah operasional selesai. Jangan tengah hari.
- Label commit per modul: `[redesign-warehouse]`, `[redesign-finance]`, dst. Supaya satu modul bisa di-`revert`
  tanpa ikut membatalkan fitur tim IT. (Tim sudah terbiasa: ada commit `Revert` di riwayat, mis. `020cd3e`.)
- Catat hash commit SEBELUM merge sebagai titik mundur. Kalau ada laporan masalah dari kantor: `git revert` lalu
  push, Vercel deploy balik dalam 1-2 menit.
- Kalau sampai ada migration (seharusnya tidak ada di redesign): SQL dijalankan manual di LIVE DULU, baru kode
  di-merge. Tidak boleh dibalik -- kode yang memakai kolom yang belum ada di live = production langsung error.
  Migration juga hanya boleh MENAMBAH (kolom nullable / tabel baru), tidak rename/drop, karena ada jeda antara
  SQL dijalankan dan deploy selesai.

### Koordinasi dengan tim IT (bagian manusia, paling sering terlewat)
1. **Umumkan modul yang sedang dirombak** di bagian "Status redesign" di bawah, mis. "12-15 Nov: modul Warehouse".
   Tim tetap bebas menambah fitur di modul lain; untuk modul yang sedang dirombak sebaiknya menunggu/mengabari.
2. **MIGRASI.md: saat konflik, SELALU gabungkan dua-duanya**, jangan pilih salah satu. File ini disentuh di
   30 dari 30 commit terakhir (100%) karena tiap orang menambah entri di bagian paling atas -- bentrok itu normal.
3. **Nomor migration tetap milik tim IT** (terakhir `0090`). Redesign tidak mengambil nomor sama sekali.
4. Tim IT cukup tetap mencatat perubahan struktur di MIGRASI.md seperti sekarang; `db-sync.sh diff` akan
   menangkapnya otomatis setiap pagi.

### Status redesign (perbarui tiap sesi)
- Fase 0 (lingkungan lokal): SEDANG DIKERJAKAN, lihat bagian 1.
- Fase 0b (Supabase UJI + Vercel Preview): belum, menunggu keputusan owner.
- Fase 1-5: belum dimulai.
- Modul yang sedang dirombak saat ini: (belum ada).

## 3. Halaman Finance > Posisi Stok -- KODE SELESAI, BELUM DIUJI DENGAN DATA ASLI, BELUM DI-COMMIT
File: `app/finance/posisi-stok/page.tsx`, `lib/mrp/stockPosition.ts`, menu di `lib/shell/nav.ts`; entri MIGRASI.md
"Posisi Stok di Finance (2026-11-06)". tsc bersih, uji data buatan lulus.
Berikutnya: setelah lingkungan lokal jalan, login Finance di app lokal dan cocokkan angka (total dibeli = total invoice,
tahap Belum produksi / Proses produksi masuk akal), cek tampilan HP. Belum ada Export Excel.

## 4. Lain-lain tertunda
- Migration 0087 (klasifikasi reject) ditunda owner; status 0088-0090 di live belum dikonfirmasi. Setelah ada database
  lokal, cek kolom/tabel yang belum ada di live lewat `db-sync.sh diff`.
- File yang BUKAN bagian pekerjaan dan jangan ikut di-commit tanpa ditanya: `.claude/launch.json` (diubah supaya dev
  server jalan lewat node), `.claude/scheduled_tasks.lock` (terhapus), folder `.codex/`.
