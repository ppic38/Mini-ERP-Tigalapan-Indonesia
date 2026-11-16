# Rencana Kerja Berjalan (serah terima antar sesi/akun Claude)

> Dibaca otomatis setiap sesi (lewat CLAUDE.md). Sesi yang menyelesaikan atau mengubah rencana di sini WAJIB
> memperbaruinya sebelum selesai. Riwayat fitur yang SUDAH jadi tetap dicatat di MIGRASI.md.
> Terakhir diperbarui: 2026-11-13.

## Yang ingin dikerjakan owner (dikonfirmasi 2026-11-13)
Hanya DUA hal:
1. **Perbaiki tampilan** -> bagian 2 (redesign 5 fase).
2. **Tambah modul dashboard** -> bagian 2 Fase 4.

**Login TIDAK jadi diubah** (keputusan owner 2026-11-13 sore, setelah sempat dibahas). Analisisnya tetap
disimpan di bagian 3 kalau suatu saat dibuka lagi, tapi JANGAN dikerjakan tanpa permintaan baru dari owner.

Akibat lingkup yang mengecil ini: seluruh pekerjaan kini **murni kode**. Nol perubahan struktur database,
nol pekerjaan data di live. Satu-satunya jalur ke live adalah git -> Vercel. Risiko terburuk sekarang hanya
"tampilan jelek atau satu halaman error", bukan lagi "seluruh kantor tidak bisa login".
Semua dikerjakan di lokal dulu, baru dinaikkan ke live bertahap.

## TITIK LANJUT BERIKUTNYA (baca ini dulu)
**Lingkungan lokal SUDAH SIAP dan terverifikasi (2026-11-15).** Aplikasi jalan di `http://localhost:3000` memakai
Supabase lokal (Docker) berisi SALINAN data live: 12 MRP, 2.058 roll, 540 koli, 177 invoice material, 64 invoice
vendor, 2.139 SKU, 10 vendor. `.env.local` menunjuk `127.0.0.1:54321` -- klik apa pun di app lokal TIDAK menyentuh
data kantor. Cadangan koneksi live ada di `.env.live-backup` (jangan dihapus). Login Finance diuji berhasil.

**Akun uji lokal**: akun asli TIDAK disalin (tabel akun/password sengaja dikunci tim IT). Password uji semua modul
internal ada di `.env.local` (`INTERNAL_PASSWORD_<MODUL>`, satu nilai acak yang sama untuk 8 modul; tidak di-commit,
JANGAN ditulis di chat). Login lewat form "Password" saja tanpa username. Akun vendor produksi BELUM bisa login di
lokal (baris vendor ada tetapi `password_hash` berisi penanda `!`); buat akun uji kalau portal vendor perlu dilihat.

**Sumber data = akun baca-saja `partner_ro`** (diberikan IT, `LIVE_DB_URL` di `.env.db-sync`, tidak di-commit).
Batas yang dipasang IT dan harus dihormati:
- 12 tabel DIKUNCI (tidak bisa dibaca): `attachment_files`, `internal_accounts`, `internal_action_log`,
  `internal_role_users`, `invoice_payment_proofs`, `sysadmin_audit_log`, `vendor_action_log`,
  `vendor_invoice_payment_proofs`, `vendor_users`, `vendors_produksi` (hanya kolom non-kredensial), `wms_integration_outbox`,
  `wos_outbox`. Di lokal tabel-tabel itu kosong (kecuali vendors_produksi). Struktur 12 tabel itu TIDAK bisa dibaca ulang
  dari live; `db-sync.sh schema --reset` mengamankannya lalu mengembalikannya (jarang berubah; kalau berubah minta DDL ke IT).
- Akun punya atribut BYPASSRLS (semua tabel ber-RLS tanpa policy) dan hanya SELECT.

**Menyegarkan salinan** (ritual pagi): `bash scripts/dev/db-sync.sh all --reset`. Ini MENIMPA seluruh database lokal
dengan versi live terbaru. Hanya data live yang DIBACA; live tidak pernah ditulis. Data akan stale lagi seiring waktu.

**Jebakan Windows yang sudah memakan waktu (jangan diulang)**: `psql.exe` menulis akhir baris CR+LF, sehingga nama tabel
hasil query berakhiran CR dan pola `pg_dump -t/-T` tidak cocok dengan apa pun TANPA pesan error (dump nyaris kosong).
`tr -d ''` ternyata tidak bekerja di dalam script ini; yang terbukti bekerja adalah mengekstrak identifier saja
(`grep -oE '[A-Za-z0-9_]+'`). Script kini menolak jalan kalau dump berisi < 20 tabel.

**Menunggu tim IT (jangan diselesaikan sendiri):**
1. Cabut akses `partner_ro` ke kolom `vendors_produksi.password_enc` (salinan password terenkripsi yang bisa dibuka
   dengan SESSION_SECRET; kolom ini TERBACA oleh akun baca-saja walau `password_hash` tidak). Tidak disalin ke lokal.
2. Ganti password `partner_ro` setelah pekerjaan ini selesai (pernah terlihat di chat).
Cara cek `LIVE_DB_URL` terisi yang BENAR (pola `.*` ikut cocok dengan nilai kosong):
`awk -F= '/^LIVE_DB_URL=/{v=substr($0,14); gsub(//,"",v); print length(v)}' .env.db-sync` -- harus > 0.

**Pekerjaan berikutnya**: lihat **docs/RENCANA-PENGERJAAN.md** (dokumen serah-terima redesign: keputusan owner,
hasil inspeksi, paket kerja A-E dengan tanda selesai). Keputusan desain dan rekomendasi per halaman ada di
docs/DESAIN-DAN-FITUR.md; contoh layout di docs/mockup/.

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
  Status `pengembangan` per 2026-11-13 siang: **sudah memuat SEMUA pekerjaan tim IT** (`git merge origin/main`
  dijalankan, bersih tanpa konflik, merge commit `43c52db`), di depan `origin/main` dan BELUM DI-PUSH.
  **Belum ada satu pun pekerjaan redesign yang dimulai.** Isi commit kita sejauh ini: `4fb6951` Posisi Stok
  (fitur warisan sesi lama yang tertinggal belum di-commit, bukan pekerjaan redesign), `b036813` lingkungan uji
  lokal, sisanya pembaruan RENCANA.md saja.
  Jangan push ke `main` tanpa persetujuan owner: push ke `main` langsung ter-deploy ke aplikasi online.
- Catatan teknis laptop ini:
  - **Localhost "tidak bisa dirender" / halaman error 500 setelah folder `.next` dihapus (2026-11-16)**: Next mengunduh font Google
    (Inter, Space Grotesk, IBM Plex Mono) saat start; unduhan lewat IPv6 gagal di jaringan laptop ini ("Can't resolve
    @vercel/turbopack-next/internal/font/google/font"). Selama cache `.next` ada, font tersimpan sehingga tidak terasa. Jalankan dev server dengan
    `node --dns-result-order=ipv4first node_modules/next/dist/bin/next dev` (sudah di `.claude/launch.json`, file itu tidak di-commit).
    Jangan hapus `.next` kalau tidak perlu; kalau dihapus, pakai opsi IPv4 di atas.
  - Nama folder memuat `&`, jadi `npx`/`npm run` gagal. Jalankan lewat node langsung, mis.
    `node node_modules/typescript/bin/tsc --noEmit`, `node node_modules/next/dist/bin/next dev`,
    `node node_modules/supabase/dist/supabase.js <perintah>`.
  - **Git belum punya identitas di laptop ini** (tidak ada `~/.gitconfig`), jadi `git commit` biasa GAGAL dengan
    "Author identity unknown". Sampai owner menjalankan `git config --global user.name/user.email` sendiri,
    commit harus memakai identitas yang sama dengan seluruh riwayat repo lewat opsi per-perintah:
    `git -c user.name="ppic38" -c user.email="ppic3803@gmail.com" commit -m "..."`.
    JANGAN menulis `git config` tanpa diminta owner.

## 1. Lingkungan lokal (Supabase di Docker) -- SEDANG DIKERJAKAN, PRASYARAT REDESIGN
Tujuan owner: perubahan kode dan database diuji di laptop dulu, tidak langsung ke data/aplikasi live.
Bagian 2 (redesign) TIDAK BOLEH dimulai sebelum bagian ini selesai, khususnya langkah 5
(`.env.local` masih menunjuk LIVE = setiap klik di app lokal menulis ke data operasional kantor).

Sudah (SUDAH di-commit di `b036813`, branch `pengembangan`, belum di-push):
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

### Keputusan owner yang mengikat (2026-11-13)
**Boleh MENGHAPUS, bukan cuma menyembunyikan.** Owner mengizinkan menghapus menu/kolom/fitur yang tidak
dipakai, dengan dasar kebutuhan user + rekomendasi dari hasil audit. Yang dihapus HANYA tampilan:
- Kolom disembunyikan / definisi kolom dihapus / menu dihapus / file halaman dihapus -> **data di database UTUH**.
- Satu-satunya yang menghapus data adalah migration DROP, dan itu memang dilarang di redesign ini.
- Preseden yang sudah ada di repo: menu Ledger di `lib/shell/nav.ts` dimatikan (dikomentari) sementara
  halamannya dibiarkan utuh dan tetap bisa dibuka lewat URL. Ikuti pola ini: **komentari dulu, jangan hapus
  file halaman**, supaya gampang dikembalikan kalau ada yang protes.

**Risiko sebenarnya bukan data hilang, tapi PROSES PUTUS.** Sebelum menghapus apa pun, pastikan:
- Halaman itu BUKAN satu-satunya tempat menginput suatu data (kalau ya: data lama tetap ada, tapi tidak ada
  data baru yang masuk lagi -- baru ketahuan berminggu-minggu kemudian).
- Tombol itu BUKAN satu-satunya cara menjalankan suatu aksi/approval.
Kalau duplikat dari tempat lain -> aman dihapus. Kalau satu-satunya -> TANYA OWNER DULU.
Catatan: menyembunyikan menu BUKAN pengamanan -- halaman tetap bisa dibuka lewat URL; keamanan ada di `proxy.ts`.

#### WAJIB: 5 pemeriksaan sebelum MENYARANKAN penghapusan tabel/kolom/filter
Diminta owner 2026-11-13: "jangan sampai 1 tabel dihapus di halaman tertentu ternyata jadi dasar tampilan
halaman lain atau output export-nya." Dari sisi DATABASE memang selalu aman (tiap halaman membaca store
terpusat, bukan dari halaman lain), tetapi di sisi TAMPILAN ada tiga keterkaitan nyata. Jalankan lima cek ini
dan **laporkan hasilnya ke owner SEBELUM menghapus**, sebutkan halaman lain yang ikut terdampak:

1. **Komponennya dipakai berapa halaman?** `grep -rl "NamaKomponen" app --include=*.tsx`
   Beberapa "halaman berbeda" sebenarnya komponen yang SAMA: `DataTable` 17 halaman,
   `MrpWarnaBreakdownTable` 3 (PPIC+SCM), `LaporanHppView` 2 (Finance+SCM), `ItemTrackingView` 2 (PPIC+SCM),
   `MaterialPerWarnaView` 2 (Procurement+SCM). Hapus di satu tempat = HILANG DI SEMUA.
   -> Kalau dipakai >1 halaman: jangan dihapus, jadikan OPSIONAL lewat prop (bawaan = perilaku sekarang).
2. **Ada export yang mengikuti filter itu?** Ada 12 file `lib/mrp/export*.ts`, dan banyak tombol unduh memakai
   baris yang SUDAH TERSARING (lihat `filterLabel` dan `exportExcel()` di `item-tracking-view.tsx`).
   Menghapus filter = MENGUBAH ISI EXCEL yang diterima orang, bukan sekadar mengubah tampilan.
3. **Fungsi turunannya dipakai siapa lagi?** `grep -rn "namaFungsi" app components lib`
   Jangan hapus fungsi di `derive.ts` hanya karena satu tabel tidak memakainya lagi (211+ fungsi, dipakai silang).
4. **Apakah ini satu-satunya tempat input atau aksi?** (lihat aturan "PROSES PUTUS" di atas)
5. **Apakah kolom/data itu dipakai badge, notifikasi, atau gerbang?** Cek `lib/shell/badges.ts` dan
   `gateReason` di `derive.ts` -- angka badge sidebar dan syarat tombol sering memakai data yang sama.

### Lingkup perangkat (owner 2026-11-13)
- **REVISI owner 2026-11-16: vendor produksi ikut pola Odoo HANYA di desktop (>= 1024 px); tampilan HP vendor tetap JANGAN disentuh.** Tahap 1 selesai (menu atas + tabel bersama, lihat MIGRASI.md [redesign-vendor]); sisa: Good Receive, Produksi, Pengiriman, Invoice & Payment. Uji pakai akun vendor uji lokal CECEP (`VENDOR_TEST_PASSWORD_CE` di .env.local). Catatan lama:
  **Modul vendor produksi: JANGAN DISENTUH.** Sudah disederhanakan owner dan pas di HP (halaman Pengiriman
  vendor punya 113 penanda responsif -- garapannya serius). Bukan bagian redesign ini.
- **Modul internal: desktop/laptop**, KECUALI dua alur yang wajib jalan enak di HP:
  1. **Approval** -- dipakai dari HP saat approver sedang di luar. Kondisi sekarang: `po-approval-queue.tsx`
     hanya punya 3 penanda responsif (praktis belum digarap untuk HP). Komponen itu dipakai bersama oleh
     **GM, SCM, dan Procurement** (satu pekerjaan menutup tiga role). **Finance TIDAK memakainya** -- punya
     implementasi sendiri (`PoMaterialPanel`, `PoMaklonPanel`), jadi approval ada DUA versi di aplikasi ini.
     Ini kandidat kuat "fungsi berulang" yang dikeluhkan owner: pertimbangkan menyatukannya lebih dulu.
  2. **Dashboard baru (Fase 4)** -- rancang untuk HP SEJAK AWAL, jangan ditambal belakangan. File baru, jadi
     biayanya nyaris nol kalau dipikirkan dari menit pertama.
- Halaman internal lain: cukup tidak rusak di layar kecil, tidak perlu dioptimalkan.

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

#### Temuan awal (sudah dicek 2026-11-13, sebelum audit penuh)
- **Menu TIDAK banyak**: 2-8 menu per role (PPIC 4, Procurement 8, Finance 8, SCM 7, Produksi 4, Warehouse 2,
  GM 2, Sysadmin 4, vendor 7). Jadi keluhan "menu makin banyak" kemungkinan BUKAN akar masalahnya.
- **Kerumitan ada DI DALAM halaman**: Tracking Item 22 kolom, Payment Ekspedisi 15, Harga Kain PKS 14,
  Input Resting & Cutting 14, Payment Material / Payment Maklon / Posisi Stok masing-masing 13.
- **Pilihan kolom user TIDAK tersimpan**: `components/mrp/data-table.tsx` nol pemakaian `localStorage`, jadi
  user yang menyembunyikan kolom harus mengulanginya SETIAP KALI halaman dibuka.
- Riwayat MIGRASI.md menunjukkan sudah 6+ kali owner minta "kolom ini disembunyikan saja secara bawaan" di
  halaman berbeda -> susunan kolom tidak pernah dirancang, melainkan menumpuk lalu dipangkas saat ada protes.
- **Hipotesis kerja**: masalahnya bukan terlalu banyak halaman, tapi setiap halaman menampilkan segalanya ke
  semua orang sepanjang waktu, dan melupakan pilihan user. Kalau benar, perbaikan besar bisa didapat dari
  perubahan kecil yang aman (mis. menyimpan pilihan kolom per user -- satu komponen bersama, efeknya ke semua
  tabel sekaligus). **Verifikasi dulu lewat audit, jangan langsung dikerjakan.**

#### Masukan yang DIBUTUHKAN dari owner (tanpa ini auditnya menebak)
1. **10 menit per role dengan user aslinya** (jawaban tertulis cukup, tidak perlu rapat). Tiga pertanyaan:
   halaman mana yang dibuka tiap hari; apa yang paling bikin kesal / paling sering diulang; kolom atau tombol
   mana yang tidak pernah dipakai. Satu orang per role sudah sangat membantu.
2. **Tangkapan layar saat mereka benar-benar bekerja** (ada data aslinya), satu per role.
3. **Data pemakaian dari aplikasi sendiri**: setelah database lokal ada, baca `internal_action_log` dan
   `vendor_action_log`. Keterbatasan yang harus disebutkan saat melapor: hanya ~33 jenis aksi yang dicatat
   (14 titik internal + 19 vendor di `lib/mrp/actions.ts`), dan hanya aksi MENULIS -- halaman yang sekadar
   dibuka tidak tercatat. Jadi ini melengkapi wawancara, bukan menggantikan.

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

#### Sumber angka: HANYA kasus A dan B (ditegaskan owner 2026-11-13)
- **A. Sudah ada fungsinya** di `lib/mrp/derive.ts` (per 13 Nov: 5.556 baris, 211+ fungsi turunan) -> panggil saja.
- **B. Datanya ada tapi terpencar** di beberapa tabel -> buat fungsi turunan BARU, tetap nol perubahan database.
- **C. Data tidak pernah dicatat siapa pun** -> owner menyatakan kasus ini TIDAK ADA. Kalau suatu sesi merasa
  menemukannya: **BERHENTI.** Jangan bikin kolom/tabel/migration, jangan karang angkanya. Laporkan ke owner
  sebagai permintaan terpisah ke tim IT. Itu fitur baru, bukan dashboard.

#### Aturan KONSISTEN (supaya angka dashboard sama dengan halaman aslinya)
Bahaya terbesar dashboard: angkanya beda tipis dengan halaman aslinya (dashboard 1.000, Finance 998). Sekali itu
terjadi, orang kantor berhenti percaya dan dashboard jadi sia-sia. Penyebabnya selalu sama: rumus ditulis dua kali.
1. **Panggil fungsi yang sudah ada, JANGAN tulis ulang rumusnya.** Ini aturan nomor satu.
2. Sebelum menulis hitungan apa pun, **cari dulu di `derive.ts`** (`grep -n "export function" lib/mrp/derive.ts`).
   Kemungkinan besar sudah ada.
3. Kalau memang harus bikin fungsi baru, **taruh di `derive.ts` juga**, bukan di dalam file halaman dashboard --
   supaya halaman lain ikut memakainya dan tidak lahir rumus kembar.
4. Tiap angka harus bisa ditelusuri: sebutkan nama fungsi sumbernya, supaya kalau ada yang protes "kok beda
   dengan halaman X" bisa langsung dicek.
5. **Uji silang sebelum merge**: buka dashboard dan halaman aslinya berdampingan di app lokal, cocokkan minimal
   3 angka per dashboard. Kalau beda, cari sebabnya -- jangan dibiarkan "kira-kira wajar".

#### Aturan CEPAT (supaya tidak memperlambat seluruh aplikasi)
Aplikasi ini SUDAH berat memuat data: snapshot ~4-5 MB berisi 32+ tabel, RPC `get_flow_snapshot_core` rata-rata
1,2-2,6 detik dan pernah kena timeout 8 detik, Supabase pernah memperingatkan Disk IO hampir habis
(MIGRASI.md 2026-11-02, 2026-11-05, 2026-11-10). Dashboard yang rakus bisa memperlambat SEMUA halaman, bukan
cuma dirinya sendiri.
1. **NOL query baru ke database.** Dashboard hanya membaca data yang SUDAH dimuat store. Jangan bikin Server
   Action, RPC, atau fetch baru. Data sudah ada di browser, jadi menghitung darinya praktis gratis.
2. **Bungkus semua perhitungan dalam `useMemo`** dengan dependency data mentahnya, jangan dihitung ulang tiap
   render. Laporan HPP pernah lambat persis karena ini dan sudah diperbaiki dengan pola yang sama
   (MIGRASI.md 2026-11-02).
3. **Jangan `.find()` di dalam loop.** Kalau butuh pencarian berulang, bangun `Map` sekali di luar loop (pola
   `sellingPriceFor` di `derive.ts`).
4. **Batasi cakupan bawaan**: tampilkan MRP aktif / periode berjalan saja, jangan seluruh riwayat sejak awal.
   Sediakan filter untuk yang ingin melihat lebih banyak.
5. **Dashboard = ringkasan, bukan tabel raksasa.** Jangan render ribuan baris; rincian lewat tautan ke halaman
   yang sudah ada.
6. Ukur dulu sebelum mengoptimasi lebih jauh -- jangan menebak bagian mana yang lambat.

#### Yang TIDAK boleh di Fase 4
Tabel/kolom/migration baru, materialized view, Server Action baru untuk membaca, dan aksi tulis apa pun
(dashboard murni baca).

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

## 3. Sederhanakan alur login -- DIBATALKAN OWNER (2026-11-13), JANGAN DIKERJAKAN
> **Owner memutuskan tidak mengubah metode login.** Bagian ini disimpan sebagai hasil analisis saja, kalau
> suatu saat dibuka lagi. JANGAN mulai mengerjakannya tanpa permintaan baru dari owner. Lewati bagian ini.

Lingkup yang sempat dipilih owner sebelum dibatalkan: **sederhanakan alur akun**, bukan sekadar mempercantik
halaman login, bukan 2FA, bukan perbaikan kecepatan. Tujuan: kurangi kebingungan empat jalur login berbeda.

### PERINGATAN: ini area paling berbahaya di seluruh aplikasi
Kalau halaman produksi rusak, satu halaman tidak bisa dipakai. Kalau LOGIN rusak, **seluruh kantor terkunci
dan tidak bisa bekerja sama sekali**. Aturan khusus untuk bagian ini:
- Jalur login LAMA tidak boleh dihapus sebelum jalur baru terbukti dipakai semua orang. Keduanya hidup
  berdampingan selama masa transisi.
- Wajib diuji di lokal untuk SETIAP jenis akun (7 modul internal + Sysadmin + akun utama vendor + anggota tim
  vendor + anggota tim internal) sebelum merge.
- Merge paling akhir, setelah redesign lain selesai, dan di jam paling sepi.

### Kondisi sekarang: empat jalur login terpisah (`lib/auth/actions.ts`)
1. `loginInternalAction(role, password)` -- pilih modul dulu, lalu password BERSAMA satu modul
   (`internal_accounts`, cadangan env var `INTERNAL_PASSWORD_*`). Tidak ada username, jadi tidak ketahuan siapa.
2. `loginInternalUserAction(username, password)` -- akun bernama per modul (`internal_role_users`, migration 0060).
3. `loginVendorAction(nameOrId, password)` -- akun utama vendor, ketik nama/kode vendor (`vendors_produksi`).
4. `loginVendorUserAction(username, password)` -- anggota tim vendor (`vendor_users`, migration 0057),
   username unik se-aplikasi, TIDAK perlu pilih vendor dulu. **Ini pola yang paling sederhana dan jadi acuan.**

Sesi: dua cookie terpisah (`erp_internal_session` isinya ARRAY role aktif + actor per role, dan
`erp_vendor_session`). Satu browser boleh memegang beberapa role internal sekaligus PLUS satu sesi vendor --
inilah sumber bug "identitas aktif" yang pernah diperbaiki (MIGRASI.md 2026-09-30).

### Arah yang dituju: satu pintu login
Satu form: **username + password saja**. Server yang menentukan orang ini siapa (modul apa / vendor mana) lalu
mengarahkan ke halaman yang sesuai. Pola ini SUDAH ADA dan terbukti jalan di jalur 4, tinggal diperluas.

### Langkah (urut, jangan dilompati)
1. **Inventaris** (butuh database lokal dulu): berapa orang per modul yang sudah punya akun bernama
   (`internal_role_users`), dan modul mana yang masih bergantung pada password bersama. Ini menentukan besar
   pekerjaan datanya.
2. **Pastikan semua orang punya akun bernama.** Ini pekerjaan DATA, bukan struktur -- tabelnya sudah ada.
   Sysadmin membuat akun lewat halaman yang sudah ada (`/sysadmin/accounts`). Kemungkinan besar NOL MIGRATION.
3. **Tambah jalur login baru** (username + password, tanpa pilih modul) DI SAMPING yang lama. Belum ada yang
   dihapus. Yang belum punya akun bernama tetap bisa masuk lewat cara lama.
4. **Pindahkan pengguna** ke jalur baru, pantau beberapa hari.
5. **Baru matikan password bersama modul** setelah dipastikan tidak ada lagi yang memakainya. Baris
   `internal_accounts` tidak perlu dihapus, cukup tidak dipakai lagi.

### Yang harus ikut diperiksa saat mengerjakan
- `proxy.ts` -- aturan akses halaman membaca sesi; `vendor_users.allowed_pages` memakai path halaman
  (lihat larangan mengubah URL di bagian 2 Fase 2).
- `lib/auth/session.ts` -- bentuk cookie. Mengubah bentuk token = semua orang yang sedang login ter-logout.
  Kalau bentuknya harus berubah, lakukan secara menambah (field baru opsional), bukan mengganti.
- Store klien `internal-auth-store.ts` / `vendor-auth-store.ts` dan `activeIdentity` (penentu identitas aktif).
- Catatan keamanan yang ditemukan sambil jalan (BUKAN bagian lingkup ini, laporkan saja ke owner): password
  disimpan juga sebagai salinan terenkripsi yang bisa dibaca balik Sysadmin (`password_enc`, migration 0063/0065)
  supaya ada fitur "Lihat Password". Itu kelemahan keamanan tersendiri, keputusan owner apakah mau diubah.

## 4. Halaman Finance > Posisi Stok -- KODE SELESAI & DI-COMMIT, BELUM DIUJI DENGAN DATA ASLI
Di-commit sebagai `4fb6951` di branch `pengembangan` (belum di-push, belum masuk `main`, jadi belum tayang).
File: `app/finance/posisi-stok/page.tsx`, `lib/mrp/stockPosition.ts`, menu di `lib/shell/nav.ts`; entri MIGRASI.md
"Posisi Stok di Finance (2026-11-06)". tsc bersih, uji data buatan lulus.
Berikutnya: setelah lingkungan lokal jalan, login Finance di app lokal dan cocokkan angka (total dibeli = total invoice,
tahap Belum produksi / Proses produksi masuk akal), cek tampilan HP. Belum ada Export Excel.

## 5. Lain-lain tertunda
- Migration 0087 (klasifikasi reject) ditunda owner; status 0088-0090 di live belum dikonfirmasi. Setelah ada database
  lokal, cek kolom/tabel yang belum ada di live lewat `db-sync.sh diff`.
- File yang BUKAN bagian pekerjaan dan jangan ikut di-commit tanpa ditanya: `.claude/launch.json` (diubah supaya dev
  server jalan lewat node), `.claude/scheduled_tasks.lock` (terhapus), folder `.codex/`.
