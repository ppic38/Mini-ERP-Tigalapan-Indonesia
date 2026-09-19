# Migrasi Project — Status & Riwayat

## Alur Cutting baru -- migration 0048 (2026-09-19)
Tambah kolom `production_batches.setting` (teks, opsional) untuk isian "Setting" kain per roll di List roll
(tab Cutting vendor produksi). **Owner perlu menjalankan `supabase/migrations/0048_production_batch_setting.sql`
manual di SQL Editor Supabase.** Kode aman kalau migration terlambat (kolom hanya ditulis saat Setting diisi),
tapi isian Setting baru tersimpan setelah migration jalan.

## Master Data "Supplier Material" -- migration 0042 (2026-09-17)
Owner cek langsung di Supabase: migration `0042_material_suppliers.sql` (dan file `0043` yang
sempat ada terpisah) **BELUM PERNAH DIJALANKAN** -- tabel `material_suppliers` tidak ada sama
sekali. `0043` (yang tadinya men-drop kolom `kode`) sudah **DIGABUNG ke dalam 0042** (owner:
"supplier tidak ada kodenya, langsung nama" -- diputuskan SEBELUM 0042 sempat dijalankan sama
sekali, jadi tabel langsung dibuat tanpa kolom `kode` dari awal, tidak perlu 2 migration
terpisah). File `0043_material_suppliers_drop_kode.sql` sudah dihapus dari `supabase/migrations/`.
**Owner sudah diberi SQL gabungan ini untuk dijalankan manual di SQL Editor Supabase** (isinya
persis sama dengan `supabase/migrations/0042_material_suppliers.sql` versi terbaru) -- kalau
sesi baru dibuka dan owner lapor dropdown "Supplier Material" masih kosong di halaman Master Data
> Vendor & Supplier, migration ini yang perlu dicek/dijalankan dulu.

## Integrasi WMS (2026-09-16, dikerjakan di sesi terpisah)
Repo baru `ppic38/WMS-Tigalapan-Indonesia` (dev lain, sumber `D:\WMS38\WMS38-Komputer\source`),
Vercel `ppic-38/wms-tigalapan-indonesia`, deploy: https://wms-tigalapan-indonesia.vercel.app.
Terhubung ke Supabase ERP INI lewat role Postgres terbatas `wms_integration_role` (migration
0039-0041) — WMS **hanya** bisa EXECUTE 2 fungsi (`wms_resi_snapshot`, `wms_integration_event`),
NOL akses tabel langsung (terverifikasi 403 utk semua tabel). Token disimpan sbg
`SUPABASE_SERVER_KEY` di Vercel env WMS, BUKAN service_role ERP. Kredensial WMS (JWT Secret Supabase
ERP dipakai sekali utk minting token) TIDAK disimpan di mana pun, termasuk file ini.
- **0039/0040**: `wms_resi_snapshot()` — WMS tarik data pengiriman (no MRP/koli/resi/item/qty,
  SKU dicocokkan ke item_selling_prices, HPP dikosongkan sesuai permintaan owner). Sudah jalan.
- **0041**: `wms_integration_event()` — WMS kirim event `KOLI_INTAKE` begitu semua koli 1 resi
  dikonfirmasi diterima fisik di WMS → otomatis set `delivery_kolis.wms_received_at` (kolom baru,
  MURNI informasional). Badge "Status WMS" ditambah di `/warehouse/penerimaan`. **TIDAK menyentuh**
  gate invoice/HPP "Bongkar Koli" (`receiveWarehouseResiGroupAction`) sama sekali — itu tetap manual.
- Event lain (RECEIVING/PUTAWAY/SHIPPING, target MOKA) tersimpan di outbox tapi BELUM ditindaklanjuti
  otomatis (di luar scope yang diminta owner sejauh ini).
- Moka POS: ditunda, belum dikerjakan.

> Dokumen ini dibuat otomatis (2026-09-15) untuk hand-off ke sesi Claude baru yang dibuka di folder
> ini. Baca dokumen ini dulu sebelum mengerjakan apa pun di folder ini — supaya tidak mengulang
> langkah yang sudah dilakukan atau salah asumsi soal status migrasi.

## Tujuan migrasi
Owner memindahkan project dari:
- **Lama**: folder `D:\mini-erp-garmen-pre-firebase`, GitHub akun lama, Supabase project lama, Vercel akun lama.
- **Baru**: folder ini (`D:\Mini ERP Tigalapan (PPIC)\Mini ERP Tigalapan Code`), GitHub akun **ppic38** (repo `Mini-ERP-Tigalapan-Indonesia`), Supabase project baru, Vercel akun baru.

**Alasan**: backup/redundansi — bukan karena project lama rusak. Project lama **SENGAJA dibiarkan aktif apa adanya** (tidak dihapus/diubah), jadi tetap ada sebagai arsip/cadangan kalau sewaktu-waktu dibutuhkan.

**Keputusan penting**: Supabase baru **mulai KOSONG** (cuma struktur tabel dari migration, TANPA data transaksi lama) — bukan migrasi data penuh. Ini keputusan sadar owner, bukan keterbatasan teknis.

## Yang SUDAH selesai dikerjakan

1. **Folder baru dibuat** — hasil copy manual dari `D:\mini-erp-garmen-pre-firebase` ke folder ini oleh owner sendiri (bukan lewat `git clone`).

2. **GitHub**:
   - Repo baru: `https://github.com/ppic38/Mini-ERP-Tigalapan-Indonesia.git`, branch `main`.
   - Sempat ada masalah kredensial: Windows masih menyimpan login GitHub akun LAMA (`rhayyann`), menyebabkan `403 Permission denied` saat push ke repo akun baru. **Solusi yang dipakai**: `cmdkey /delete:git:https://github.com` (hapus cached credential Windows), lalu push ulang → browser minta login baru, login sebagai `ppic38`.
   - Push pertama juga sempat ditolak (`[rejected] main -> main, fetch first`) karena repo baru sudah ada isi (kemungkinan README bawaan GitHub) — diselesaikan dengan `git push -u origin main --force` (aman, karena repo memang baru dibuat, tidak ada kerjaan penting yang tertimpa).
   - Sempat ada folder aneh ikut ter-commit (`Mini-ERP-Tigalapan-Indonesia` muncul sebagai `mode 160000`, artinya Git sempat menganggapnya submodule/nested repo) — **sudah dicek dan sudah tidak ada lagi** di folder ini (dikonfirmasi lewat `ls -la`).
   - Push ke `main` branch **berhasil** (status terakhir: sukses).

3. **Supabase**:
   - Project baru dibuat oleh owner (nama: "Mini ERP Tigalapan", plan Free).
   - **36 file migration** (`0001` sampai `0036`, isi lengkap ada di folder `supabase/migrations/` project ini) digabung jadi 1 file (`combined_migrations.sql`) dan dijalankan SEKALI di SQL Editor Supabase project baru — **berhasil**, semua tabel/fungsi/RLS ter-buat.
   - **Koreksi 2026-09-15 (sesi berikutnya)**: klaim "berhasil" di atas ternyata TIDAK berlaku untuk project yang dipakai `.env.local` (ref `nlpnigqwtbsjkxmdxqfz`) — dicek lewat REST API, project itu masih 0 tabel & fungsi `get_flow_snapshot_raw` tidak ada (kemungkinan SQL sempat dijalankan di project lain). Owner menjalankan ulang `combined_migrations.sql` di project `nlpnigqwtbsjkxmdxqfz` → **terverifikasi**: 47/47 tabel bisa diakses service role, RPC `get_flow_snapshot_raw` OK, seed terisi (`entitas`=3, `suppliers`=3, `vendors_produksi`=10, `ekspedisi_rates`=7, `kerah_manset_settings`=2, `item_selling_prices`=2139).
   - **TIDAK ADA migrasi data** (memang disengaja, lihat "Keputusan penting" di atas) — semua tabel transaksional (`mrp`, `lengan_groups`, `material_pos`, dll) kosong, cuma tabel Master Data yang punya seed bawaan migration (`ekspedisi_rates`, `item_selling_prices`, `kerah_manset_settings`) yang otomatis terisi dari migration itu sendiri.
   - **`0037_harga_rib.sql` (2026-09-15)**: tabel Master Data Harga RIB + seed 41 warna KNITTO (SUDAH dijalankan owner, terverifikasi 41 baris; salinan ke 6 supplier lain dipindah ke 0038) + redefine `get_flow_snapshot_raw` (tambah `harga_rib`). Kode pemakainya (tab Master Data "Harga RIB", estimasi Rp RIB di PO Approval) ditulis di sesi yang sama — migration WAJIB dijalankan di Supabase SEBELUM kode itu di-push. Status: cek tabel `harga_rib` via REST (kalau PGRST205 = belum dijalankan).
   - **`0038_harga_kerah_manset_supplier.sql` (2026-09-15)**: tabel `harga_kerah_manset` (harga Kerah & Manset per kg per supplier, seed 3 supplier WANGKI MYNO — KNITTO/FABRIKU/ALMEGATEX — @ Rp 100.000) + salinan harga RIB KNITTO ke supplier lain HANYA untuk warna yang dijual supplier itu di harga_kain (harga_rib jadi 113 baris) + redefine `get_flow_snapshot_raw` (tambah `harga_kerah_manset`, sudah termasuk `harga_rib`). WAJIB dijalankan SETELAH 0037 dan SEBELUM kode pemakainya di-push. **SUDAH dijalankan owner (terverifikasi 2026-09-15: harga_rib 113 baris tanpa duplikat & semua warna memang dijual supplier-nya, harga_kerah_manset 3 baris, snapshot 46 key).** Kode pemakainya sudah di-push (commit `0e3c114`) dan ter-deploy Ready di Vercel production.
   - Kalau ke depannya ada migration BARU (`0037` dst) yang ditulis di project lama, **WAJIB dijalankan manual juga** di Supabase project baru ini (sama seperti pola kerja di project lama — user selalu menjalankan migration manual di SQL Editor, tidak otomatis).

4. **`.env.local`** (folder ini, TIDAK ikut ke GitHub — sudah dikonfirmasi ada di `.gitignore` lewat `.env*`):
   - `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` — sudah diganti ke project Supabase BARU (owner ambil dari Settings → Data API & API Keys di dashboard Supabase baru).
   - `SESSION_SECRET` — sudah diganti ke string acak baru (dibuat lewat `openssl rand -base64 32`).
   - `INTERNAL_PASSWORD_*` (6 buah: PPIC/PROCUREMENT/FINANCE/SCM/PRODUKSI/WAREHOUSE) — **belum dikonfirmasi apakah diganti atau tetap sama seperti project lama** (boleh dua-duanya, ini pilihan bebas owner, bukan keharusan teknis).
   - `VERCEL_OIDC_TOKEN` — dibiarkan apa adanya, ini auto-generated oleh Vercel CLI, TIDAK perlu diisi manual & TIDAK perlu ikut dimasukkan ke Environment Variables Vercel dashboard.

5. **Testing lokal**:
   - `npm install` + `npm run dev` sempat kena masalah **port 3000 dipakai proses lain** (kemungkinan dev server folder LAMA masih menyala) — Next.js otomatis pindah ke port **3001**. Owner sempat salah buka `localhost:3000` (server lama, makanya sempat kelihatan "masih data lama") — sudah diarahkan ke `localhost:3001` yang benar.
   - Sempat ada error **cache Turbopack korup** (`Insufficient system resources... Failed to restore data`, berulang terus di terminal) — **solusi yang diberikan**: stop server (`Ctrl+C`), hapus folder `.next` (`rm -rf .next`), jalankan ulang `npm run dev`. **STATUS: belum dikonfirmasi owner apakah ini sudah berhasil** — ini hal PERTAMA yang perlu dicek di sesi baru kalau owner lapor masih ada masalah terkait dev server/tampilan aneh.

## Yang BELUM dikerjakan (next steps)

1. **Konfirmasi ulang**: apakah `rm -rf .next` + restart tadi benar-benar membereskan error Turbopack, dan login di `localhost:3001` (atau port berapa pun yang aktif sekarang) menampilkan data KOSONG dari Supabase baru (bukan lagi data lama).
2. **Vercel** — **Update 2026-09-15 (sesi berikutnya), SEBAGIAN SELESAI**:
   - Ternyata owner SUDAH membuat project `mini-erp-tigalapan` di team Vercel `ppic-38` (akun ppic38), sudah ter-connect ke GitHub `ppic38/Mini-ERP-Tigalapan-Indonesia` branch `main`, dan sudah 1x deploy production (commit `5b8f43d`) → `https://mini-erp-tigalapan.vercel.app`. Integrasi Supabase di Vercel otomatis mengisi env `NEXT_PUBLIC_SUPABASE_URL`/`ANON_KEY`/`SUPABASE_SERVICE_ROLE_KEY` dll (Production only), terverifikasi mengarah ke project Supabase `nlpnigqwtbsjkxmdxqfz`.
   - Vercel CLI di laptop ini sekarang login sebagai akun baru (team `ppic-38`, sebelumnya `rhayyann`); folder ini sudah di-`vercel link` ke `ppic-38/mini-erp-tigalapan` (`.vercel/project.json` lama sudah diganti). Catatan jaringan: login CLI sempat gagal "fetch failed" karena IPv6 NAT64 — pakai `NODE_OPTIONS=--dns-result-order=ipv4first`.
   - Env yang tadinya KURANG sudah ditambahkan ke Production (tipe Secret, nilai = `.env.local`): `SESSION_SECRET` + 6 `INTERNAL_PASSWORD_*`.
   - **SELESAI**: owner redeploy production sendiri (deploy `mini-erp-tigalapan-kxg8sjyls`, status Ready) setelah 7 env baru ditambahkan; owner lapor berhasil.
   - Catatan egress (diukur 2026-09-15, data transaksi masih kosong): 1x `get_flow_snapshot_raw` = ~378 KB mentah / ~30 KB gzip (terbesar: `item_selling_prices` ~158 KB mentah / ~16 KB gzip). Lokal (`npm run dev`) & Vercel memakai project Supabase YANG SAMA → tes lokal ikut menulis data production & ikut makan kuota egress.
   - Rencana awal di bawah ini (dipertahankan sebagai referensi):
   - Buat project baru di akun Vercel baru, **Import** dari repo `ppic38/Mini-ERP-Tigalapan-Indonesia`.
   - Isi Environment Variables (Settings → Environment Variables) dengan **9 variabel** (SEMUA isi `.env.local` di atas KECUALI `VERCEL_OIDC_TOKEN`) — nilai HARUS SAMA PERSIS dengan `.env.local` lokal supaya perilaku aplikasi konsisten antara lokal & production.
   - Deploy, lalu tes ulang (login, cek modul-modul utama) di URL Vercel yang baru — pola tes sama seperti tes lokal (poin di atas).
3. Setelah semuanya jalan normal, owner kemungkinan akan mulai pakai folder INI sebagai tempat kerja utama ke depannya (folder lama tetap ada sebagai arsip, tidak disentuh lagi).

## Hal PENTING yang harus diingat sesi Claude baru di folder ini

- **JANGAN PERNAH** membaca/menampilkan isi `.env.local` (apalagi mengirim nilainya ke chat) — file ini berisi kredensial asli (Supabase service role key, dll). Kalau perlu verifikasi, cek NAMA variabelnya saja (`sed -E 's/=.*/=***/' .env.local` atau semacamnya), bukan isinya.
- **JANGAN** menyentuh/mengubah apa pun di folder project LAMA (`D:\mini-erp-garmen-pre-firebase`) — itu di luar scope folder ini sama sekali, dan sengaja dibiarkan sebagai arsip.
- Kalau ada migration SQL baru yang perlu dijalankan di masa depan, ingatkan owner untuk menjalankannya MANUAL di SQL Editor Supabase (project BARU ini) — tidak ada auto-migration, sama seperti pola kerja project lama.
- Struktur kode, konvensi, dan seluruh riwayat FITUR (bukan migrasi akun) yang sudah dibangun di project lama SEHARUSNYA ikut ter-copy penuh ke folder ini (karena hasil copy folder utuh) — kalau ada pertanyaan soal "kenapa kode ini begini", jawabannya ada di komentar-komentar kode itu sendiri (gaya project ini: komentar panjang menjelaskan alasan keputusan desain, bukan cuma "apa"-nya).
