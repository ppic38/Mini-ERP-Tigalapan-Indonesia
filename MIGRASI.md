# Migrasi Project — Status & Riwayat

## Upload invoice FABRIKU + nama file seragam + kode roll otomatis (2026-10-29, tanpa migration)
Owner: Paying Voucher dari invoice supplier FABRIKU (PT Kenari Mulia Lestari), sebelumnya hanya KNITTO. Invoice FABRIKU yang dipakai adalah invoice FINAL (bukan proforma biasa), dibaca dari text layer PDF di browser.
- **Nama file seragam untuk SEMUA supplier**: `NOINVOICE.KODETRANSAKSI.pdf` (kode transaksi 4 digit; contoh `A027.1234.pdf`, `OH131026179.5393.pdf`) -- `lib/invoice-import/filename.ts` (`checkInvoiceFileName`). Nomor invoice dan kode transaksi diambil dari nama file, TIDAK dari isi PDF; vendor tujuan tidak lagi dibaca dari nama file (sudah ditentukan PO yang dibuka). Pola nomor per supplier ada di `fileNameRule` tiap adapter (KNITTO: 2 huruf + angka; FABRIKU: huruf/angka mengandung angka). File yang tidak sesuai DITOLAK (semua file dalam satu pilihan) dengan pesan yang menyebut format dan contoh; area unggah menampilkan format ini. Nama file lama dengan bagian tengah (`OH...YOGI01.5393.pdf`) kini ditolak.
- **Parser FABRIKU** (`lib/invoice-import/parser-fabriku.ts`): kolom NO | PRODUK | WARNA | KODEROL | QTY | HARGA | TOTAL (dipisah 3 spasi oleh `pdf-text.ts`). `S COT <n> ...` = kain roll, `R COT <n> ...` = rib (benang `<n>S`); produk lain TIDAK dikenal dan menggagalkan invoice. Diskon = baris "Diskon" bernilai minus; subtotal dihitung dari jumlah baris; TOTAL dari baris TOTAL. Pemeriksaan wajib: berat x harga = jumlah per baris, jumlah baris - diskon = TOTAL, total kg = "Total Qty". Tidak ada Total Roll-an / KG-an di invoice ini, jadi jumlah roll dihitung dari baris. Kode roll ganda di satu invoice diblokir. Diuji dengan invoice asli (49 roll + 2 rib, Rp 144.178.100, 1.264,39 kg: semua cocok); uji otomatis memakai fixture dummy `scripts/invoice-import-test/fabriku.dummy.txt` (bagian 8 di `run.mjs`).
- **Kode roll otomatis**: kolom KODEROL tiap roll kain disimpan ke `raw_material_invoice_rolls.code_roll` saat PV dibukukan (`ColorEntry.codeRolls`, paralel ke `rolls`; tidak butuh migration, kolomnya sudah ada). Kode harus unik di seluruh ERP -- dicek `assertRollCodesUnique` SEBELUM invoice ditulis. Di Good Receive vendor, Code Roll roll yang belum diterima sudah terisi (tanda "dari invoice"); vendor boleh mengubahnya (tanda "diubah"), Code Lot tetap diisi vendor seperti biasa (wajib di W40+). Rib tidak memakai kode roll. KNITTO dan input manual tidak berubah.
- Catatan: "Batalkan terima roll" (Sysadmin) mengosongkan code_roll, jadi kode bawaan FABRIKU roll itu hilang dan vendor mengisinya manual lagi. Warna FABRIKU ("SUPER BLACK 38") dipetakan ke warna MRP lewat alur pemetaan/alias yang sudah ada (migration 0064).

## Filter No Resi dan Ekspedisi di Riwayat pengiriman (2026-10-28, tanpa migration)
Permintaan owner: halaman Pengiriman vendor (`app/vendor-maklon/pengiriman/page.tsx`), kartu "Riwayat pengiriman" dapat dua filter di header: kolom cari No Resi (mengandung teks, tidak peduli huruf besar/kecil) dan dropdown Ekspedisi (diisi dari ekspedisi yang ada di riwayat). Keduanya digabung (AND), ada penghitung "N dari M resi" dan tombol Reset saat filter aktif. Hanya tampilan; kartu "Koli belum dikirim" tidak ikut difilter.

## Resting: gramasi dan setting WAJIB (2026-10-28, tanpa migration)
Temuan dari export Detail Roll: ada roll yang gramasinya 0 / settingnya kosong karena tombol Resting hanya mensyaratkan berat bersih. Sekarang tombol Resting (`production-cutting-tab.tsx`, `canRest`) baru aktif kalau SETIAP roll punya berat bersih, gramasi > 0, dan setting terisi, dengan pesan jumlah roll yang masih kurang; server (`startProductionBatchesImpl`, `startProductionBatchAction`) menolak gramasi <= 0 atau setting kosong. Data lama tidak diubah otomatis (dicek 2026-10-28: dari 647 roll, 10 roll W39 vendor KK gramasinya 0 dan 4 di antaranya settingnya kosong; diisi lewat SQL dari chat). Impor migrasi data awal (`parseMigrationImport`) tidak ikut aturan ini.

## Export Monitoring Produksi: sheet Detail Roll (2026-10-28, tanpa migration)
Permintaan user modul Produksi: export data vendor dengan rincian berat, gramasi, dan setting bahan, supaya bisa memvalidasi apakah yield rendah disebabkan berat, gramasi, atau setting. Export Excel Monitoring Produksi (`lib/mrp/exportMonitoringProduksiExcel.ts`) kini 3 sheet: Ringkasan, Detail Size, dan **Detail Roll** (satu baris per roll): code roll, Aduan Pola, status, mulai resting, berat kotor (invoice bahan) dan berat bersih (timbang vendor) beserta selisih kg/%, gramasi, setting, target, hasil cutting, yield cutting (merah dan ditandai "Ya" kalau di bawah 99%), berat bersih per pcs hasil cutting, Finish Good, dan catatan alih size. Berat roll dicari lewat code roll ke invoice bahan (`findRawMaterialRollForBatch`, derive.ts, kini di-export); roll yang tidak bisa ditelusuri tampil kosong. Disusun di `buildExportGroups` (app/produksi/monitoring/page.tsx); angka memakai fungsi turunan yang sama dengan layar. Hanya tampilan/export.

## Integrasi dorong resi ke WOS partner -- migration 0081 (2026-10-28)
Owner: partner punya Warehouse Operation System (WOS) terpisah (BUKAN WMS `ppic38/WMS-Tigalapan-Indonesia` yang memakai jalur tarik di bagian Integrasi WMS). Begitu vendor selesai "Set Ekspedisi & Resi", ERP mendorong kejadian `resi.created` (No. MRP, nama vendor, nomor resi, ekspedisi, tanggal kirim, koli beserta item dan SKU, tautan lampiran resi) ke alamat WOS. Spesifikasi untuk partner + contoh endpoint penerima: `docs/integrasi-wos.md`. **Tidak aktif sampai env diisi di Vercel ERP**: `WOS_WEBHOOK_URL` (endpoint WOS), `WOS_WEBHOOK_SECRET` (kunci bersama, >= 32 karakter), opsional `APP_BASE_URL` (bawaan https://mini-erp-tigalapan.vercel.app, dipakai untuk tautan lampiran), dan `CRON_SECRET` (untuk cron kirim ulang).
- **Migration 0081** (`0081_wos_outbox.sql`, owner menjalankan manual): tabel antrean `wos_outbox` (satu baris per resi per kejadian, status PENDING/SENT/FAILED, jumlah percobaan, status HTTP terakhir, pesan error). Kode aman tanpa migration (gagal menulis antrean hanya dicatat di log).
- `lib/mrp/wosPush.ts`: `notifyWosResiCreated` dipanggil lewat `after()` di `setKoliEkspedisiResiGroupAction` (tidak menahan vendor, tidak pernah menggagalkan aksi): susun isi dari data resi, tulis ke antrean, tunda ~12 detik (file ke-2 dst. foto resi baru disimpan klien sesudah aksi utama), lalu POST dengan header `X-ERP-Signature` (HMAC-SHA256 atas `timestamp.body`), `X-ERP-Timestamp`, `Idempotency-Key`. Batas waktu 8 detik; selain 2xx = FAILED dan dicoba ulang (maks 8 kali) oleh `processWosOutbox` yang dipanggil tiap ada resi baru dan oleh cron harian `/api/wos/retry` (vercel.json, jam 02:00, header `Authorization: Bearer CRON_SECRET`). Item Reject tidak dikirim. Tanda tangan murni di `lib/mrp/wosSign.ts` (diuji: cocok, body/scope/index/resi diubah ditolak, kedaluwarsa ditolak).
- Lampiran resi dikirim sebagai tautan bertanda tangan berlaku 7 hari, tanpa login: `/api/wos/resi-files` (daftar file terbaru, JSON) dan `/api/wos/resi-file` (satu file). `proxy.ts` membuka `/api/wos/` untuk umum karena rute itu memeriksa tanda tangan sendiri.
- Belum: pembatalan resi (Sysadmin "Batalkan pengiriman") belum dikirim ke WOS (bisa jadi kejadian `resi.cancelled`); konfirmasi balik WOS ke ERP (barang diterima) belum ada; endpoint penerima di sisi WOS belum ditulis (menunggu akses repo partner, rencana lewat branch/PR).

## Finish Good per size: popup Detail pengiriman (2026-10-28, tanpa migration)
Owner: qty yang sudah masuk koli dan yang sudah terkirim per size, plus isi per koli. Tabel "Finish Good per size" (tab Finish Good vendor, `components/mrp/production-result-panel.tsx`) tetap 4 kolom; tombol "Cek Koli" (semula "Lihat detail pengiriman") di header tabel membuka popup lebar (920 px, isi tabel rata tengah dengan jarak antar kolom, header berwarna seperti tabel lain, rincian per koli di panel abu terpisah, baris "Total semua size" di bawah berwarna tegas sehingga tidak tertukar dengan ringkasan satu size) (`FgShippingDetailButton`): per size Finish Good, Di koli (belum dikirim), dan Terkirim (koli sudah di-set ekspedisi & resi, `deliveredAt` terisi) beserta baris total; klik satu size membuka rincian per koli (nomor koli, qty, status Terkirim + tanggal atau Belum dikirim, ekspedisi dan nomor resi). Dihitung dari isi koli vendor itu untuk warna·lengan grup; item Reject tidak dihitung; qty size yang sama dalam satu koli (dari beberapa roll/usia) dijumlah. Hanya tampilan.

## Lampiran lebih dari satu file -- migration 0080 (2026-10-27)
Owner: bukti pembayaran, foto resi, dan foto klaim boleh diunggah lebih dari satu file, tetapi yang tampil tetap SATU tombol "Lihat / Download" yang membuka semuanya. **Migration 0080** (`0080_attachment_files.sql`, owner menjalankan manual): tabel `attachment_files(kind, ref_id, data_url, file_name)`. File PERTAMA tetap di tabel lama (`invoice_payment_proofs`, `vendor_invoice_payment_proofs`, `delivery_koli_ekspedisi_photos`, `material_claim_photos`), jadi lampiran lama dan jalur lama tidak berubah; file ke-2 dst. (maks 4 tambahan, total 5) di tabel baru. Kunci `ref_id`: id invoice (bukti bayar material), id invoice vendor (bukti bayar maklon), id grup resi atau id koli tanpa grup (foto resi, satu salinan per resi), `claim_key` (foto klaim). Tanpa migration, unggah satu file tetap jalan; tambahan file gagal dengan pesan "jalankan migration 0080".
- Server (actions.ts): `clearAttachmentExtrasAction`, `addAttachmentExtraAction` (satu file per panggilan supaya di bawah batas 2 MB Server Action; aturan akses dan tipe/ukuran file per jenis; file utama harus sudah ada), `getAttachmentFilesAction` (file utama lewat getter lama yang aturan aksesnya tidak berubah, ditambah file tambahan). Reset MRP dan "Batalkan pembayaran" invoice vendor (Sysadmin) ikut menghapus file tambahan.
- Klien: `lib/mrp/attachments.ts` (`saveExtraAttachments` selalu membersihkan file tambahan lama dulu lalu menambah yang baru; `viewAttachments` membuka satu tab, satu file langsung dibuka seperti sebelumnya, beberapa file lewat `fillPreviewWindowMulti` di clientFiles.ts: gambar langsung tampil, PDF di bingkai, tombol Download per file dan Unduh semua), kotak unggah `components/mrp/multi-file-input.tsx`. Dipasang di: Finance > Payment material (bar bayar dan unggah belakangan per baris) dan Payment maklon (sama), Pengiriman vendor (foto resi di dialog Set Ekspedisi & Resi), Produksi vendor (foto klaim di popup claim). Penampil satu tombol dipakai di Finance, Procurement (Paying Voucher material, Klaim Material, lampiran resi), Saldo Deposit, dan portal vendor (bukti bayar invoice). File ke-2 dst. disimpan SETELAH aksi utama sukses; kegagalannya hanya memunculkan pemberitahuan (pembayaran/resi/klaim tidak dibatalkan).
- Belum ikut: bukti PV, nota pendukung invoice, dan bukti invoice pengganti klaim (tetap satu file).

## Kolom Aksi PO Produksi Saya disembunyikan (2026-10-27, tanpa migration)
Owner: kolom "Aksi" di PO Produksi Saya (portal vendor) disembunyikan secara default, tetap bisa dimunculkan lewat menu Kolom. Pengecualian: vendor yang punya PO FOB tetap melihatnya karena tombol "Ajukan Invoice" PO FOB ada di kolom itu. Isi kolom untuk PO CMT hanya teks status.

## Resting: dua baris Aduan Pola berkode dan berwarna sama (2026-10-27, tanpa migration)
Laporan owner (Konveksi Makassar W38_MKS): popup "Tambah roll ke resting" S-XL Pendek menampilkan "BURGUNDY 24S (1 roll)" dan "1 tersedia" tetapi "maks 0 roll", sehingga roll R2609035767 tidak bisa dipilih. Penyebab: setelah kode S-2XL diubah jadi S-XL lewat SQL, kode S-XL punya DUA baris Aduan Pola berwarna Burgundy (satu sudah penuh di-resting, satu masih punya jatah 1 roll). `components/mrp/production-cutting-tab.tsx` mengambil jatah dari baris PERTAMA yang cocok warna (`rows.find`), yaitu baris yang sudah penuh. Perbaikan: jatah dijumlahkan dari semua baris kode itu per warna (`warnaOptions`, `pickGroupsData`), dan saat Resting disimpan, tiap roll dimasukkan ke baris yang masih punya jatah (bukan selalu baris pertama). Tidak ada data yang perlu diubah. Kasus yang sama bisa terjadi dari import Excel yang punya dua baris Aduan Pola berkode dan berwarna sama.

## Rincian isi koli digabung per size (2026-10-27, tanpa migration)
Owner: baris yang tampak duplikat di rincian isi koli (mis. XL Finish Good 15 pcs dan XL 47 pcs). Penyebab: tiap item koli menyimpan roll asalnya sendiri (migration 0024), jadi satu size dari dua roll menjadi dua baris. `mergeKoliItems` (components/mrp/koli-items-detail.tsx) menjumlahkan item yang jenis produk, warna, lengan, size, dan usianya sama; dipakai `ItemsDetailPanel` (Riwayat pengiriman, Koli belum dikirim, Siap diajukan invoice) dan hitungan "N varian" di `summarizeItems`. Hanya tampilan; data koli (per roll) tidak berubah. Tombol "Lihat detail roll" di panel itu membuka popup tabel qty per roll (code roll dari `sourceBatchId` ke batch produksi, jenis produk, warna, lengan, size, qty, total); item tanpa roll asal (Rework, koli lama) bertanda "—".

## Nomor koli: berurutan dan hanya angka (2026-10-27, tanpa migration)
Owner: daftar koli di Pengiriman berurut menurut nomor koli, dan kolom "No koli" hanya menerima angka. `compareNoKoli` (derive.ts): angka dibandingkan sebagai angka (2 sebelum 10, "0010" = 10), nomor non-angka dari data lama memakai urutan natural; urutan MRP mengikuti kemunculan pertamanya. Kolom No koli (app/vendor-maklon/pengiriman/page.tsx) membuang huruf/simbol saat diketik atau ditempel, lalu menampilkan peringatan merah "Nomor koli hanya menerima angka" selama 2,5 detik; keyboard angka di perangkat sentuh (`inputMode="numeric"`). Server (`createDeliveryKoliAction`) menolak nomor non-angka juga. Koli lama bernomor huruf tetap tampil, hanya tidak bisa dibuat baru.

## Kolom "Terakhir diupdate" di semua Master Data -- migration 0079 (2026-10-27)
Owner: tahu kapan sebuah master data terakhir diubah. **Migration 0079** (`0079_master_data_updated_at.sql`, owner menjalankan manual; kode aman sebelum dan sesudahnya): kolom `updated_at` (nullable, default now()) di harga_maklon, harga_kain, harga_kain_pks, harga_rib, harga_fob, ekspedisi_rates, harga_kerah_manset, kerah_manset_settings, material_suppliers, suppliers, entitas, warna_aliases, vendors_produksi, item_selling_prices (yang terakhir sudah punya kolomnya sejak 0043) + trigger `trg_touch_updated_at` (BEFORE UPDATE) yang mengisi `now()` HANYA kalau isi baris benar-benar berubah (simpan ulang nilai yang sama atau upsert identik tidak mengubah tanggal); vendors_produksi punya fungsi sendiri (`touch_updated_at_vendor`) yang hanya bereaksi pada nama, kategori, kapasitas per minggu (baris itu juga dipakai login, jadi ganti password tidak menggeser tanggal). Baris yang SUDAH ada sengaja dibiarkan kosong (tampil "—") supaya tidak semuanya mengaku diupdate hari migration. Kode: tipe `updatedAt?` di lib/mrp/masterData.ts, mapper di lib/mrp/repo/snapshot.ts, kolom "Terakhir diupdate" (default tampil, bisa disembunyikan lewat menu Kolom) di Harga Maklon, Kain, Kain PKS, RIB, FOB, Ekspedisi, Kerah/Manset (dua tabel), Vendor Produksi, Supplier Material, SKU, Mapping Warna; List Entitas menampilkannya di tiap baris. Perubahan yang baru disimpan baru menampilkan tanggalnya setelah refresh data berikutnya (beberapa detik).

## Kartu qty per jenis lengan di PO Produksi Saya (2026-10-27, tanpa migration)
Owner: bisa menjelaskan ke vendor kenapa harga maklon sebuah MRP sebesar itu (tarif ditentukan per lengan dari qty kumulatif). Revisi (owner): kartu dipindah dari atas halaman ke dalam baris PO yang dibuka, tepat di atas daftar warna, dan menghitung PO itu saja (tanpa pilihan MRP). Empat kartu qty (di atas daftar warna saat baris PO dibuka): Pendek (PDK), Panjang (PJG), Wangki Pendek, Wangki Panjang, dihitung dari Aduan Pola vendor itu sendiri (`LenganQtyCards`, app/vendor-maklon/po-produksi/page.tsx); Wangki = grup berkategori WANGKI MYNO (`LenganGroup.kategori`). PO FOB tidak punya rincian ini (tanpa Aduan Pola). Catatan harga: baris Master Data Harga Maklon bertipe lengan "Wangky PDK/PJG" tidak pernah dipakai perhitungan (`matchesLengan` hanya mengenali PDK/PENDEK/PJG/PANJANG), jadi qty Wangki saat ini dihargai dengan tarif PDK/PJG biasa.

## Kolom PIC kosong di sesi campuran vendor + modul internal (2026-10-27, tanpa migration)
Laporan owner: kolom PIC kosong di semua halaman portal vendor CECEP. Penyebab yang ditemukan di kode: `getFlowSnapshotAction` membuang semua nama pelaku (`stripVendorActorNames`) untuk sesi yang punya peran internal non-Sysadmin; satu browser yang login sebagai vendor DAN modul internal (mis. PPIC) dianggap internal, jadi portal vendornya tidak pernah menerima nama. Perbaikan: `stripVendorActorNames(state, keepVendorId)` -- sesi campuran tetap menerima nama pelaku baris vendornya sendiri (`session.vendorId`), nama baris vendor lain tetap dibuang. Sesi vendor murni dan Sysadmin tidak berubah. Data lama (sebelum migration 0078, 2026-10-26) tetap "-" kecuali diisi dari `vendor_action_log` (SQL di chat).

## Data MRP untuk vendor dipotong ke bagian vendor itu (2026-10-26, tanpa migration)
Audit isolasi vendor: snapshot untuk browser vendor masih memuat grup warna·lengan UTUH (`sizes`, `totalQty`, rib/kerah/manset, estimasi roll semua vendor yang mengerjakan grup itu) dan total qty MRP semua vendor; tidak tampil di layar tetapi terlihat lewat alat pengembang browser. `scopeStateToVendor` (lib/mrp/vendorScope.ts) sekarang memotongnya: tiap grup yang dirujuk Aduan Pola vendor dibentuk ulang dari Aduan Pola vendor itu (`scopeGroupToVendor`: size dan qty dari Aduan Pola-nya; rib, kerah, manset, dan estimasi roll dikali porsi qty sehingga kg per roll tetap sama; `vendorDefault` hanya kalau milik vendor itu), `mrp.qty` = jumlah qty vendor itu, MRP lama (static) memakai qty PO vendor itu. Sesi internal dan Sysadmin tidak berubah (tetap data penuh). Form Rasio diuji identik dari data penuh maupun data vendor. Yang masih ada di kode aplikasi untuk semua browser: daftar tetap vendor (`VENDOR_PRODUKSI`, nama, kapasitas, tarif cadangan).

## Filter vendor di rincian warna MRP (2026-10-26, tanpa migration)
Owner: rincian warna di baris MRP (halaman MRP PPIC, juga Approval/Monitoring SCM; komponen `MrpWarnaBreakdownTable`) bisa difilter per vendor. Dropdown "Semua vendor" (muncul kalau >1 vendor) membatasi baris ke warna yang dikerjakan vendor itu, dengan angka BAGIAN vendor itu: qty dan roll dari Aduan Pola-nya (panjang/pendek), rib dan kerah/manset = kg grup warna·lengan dikali porsi qty vendor terhadap total grup (jumlah semua vendor = kg grup). Datanya dari `MrpWarnaBreakdown.vendors` (derive.ts, tipe `MrpWarnaVendorPart`), sekarang dipecah per lengan. Revisi (owner: posisi filter): dropdown vendor dan warna memakai `SingleSelectFilter` (components/mrp/single-select-filter.tsx; tombol ringkas, daftar dirender lewat portal tepat di bawah tombol atau naik ke atas kalau tidak muat, kotak cari kalau pilihan >8), bukan `<select>` bawaan browser yang lebarnya mengikuti opsi terpanjang dan popup-nya melompat; pilihan warna berurut abjad; kolom cari warna di paling kanan.

## Perbaikan Form Rasio PO: qty hanya milik vendor PO itu (2026-10-26, tanpa migration)
Bug (vendor CECEP, W40): Form Rasio (Excel dari PO Produksi Saya) menulis total qty PO 10.052 pcs di header, tetapi kolom QTY kalau dijumlah 23.464. Penyebab: `rasioSheet` (lib/mrp/exportPoExcel.ts) menuliskan SEMUA baris size grup warna·lengan (`LenganGroup.sizes` = satu entri per baris Excel MRP, jadi memuat semua vendor yang mengerjakan warna·lengan itu dan size yang sama bisa muncul beberapa kali), padahal Aduan Pola hanya sebagian milik vendor itu. Akibat ikutan: roll per item dan Total Roll terhitung berkali-kali (satu kali per entri size kembar), serta rib/kerah/manset ikut porsi semua vendor. Sekarang qty per size diambil dari Aduan Pola vendor PO itu sendiri (size kembar dijumlahkan, size ber-qty 0 tidak ditampilkan, grup tanpa Aduan Pola vendor itu dilewati), rib dan kerah/manset dibagi menurut porsi vendor terhadap total grup, dan Aduan Pola difilter ke vendor PO (juga saat diunduh dari dialog Download PO internal). Grup lama tanpa Aduan Pola sama sekali memakai baris grup apa adanya.

## Gramasi dan Setting kain di Monitoring Produksi (2026-10-26, tanpa migration)
Permintaan user: bisa tahu gramasi dan setting kain dari roll. Datanya sudah tersimpan per roll di `production_batches.gramasi` (gsm, 0 = belum diisi) dan `production_batches.setting` (migration 0048), diisi vendor saat Resting, tidak bisa diedit sesudahnya; sebelumnya hanya tampil di tab Cutting portal vendor. Revisi: awalnya jadi kolom di tabel, lalu (owner) dipindah ke popup. Sekarang di Monitoring Produksi (drill-down per vendor) tiap baris warna·lengan punya tombol "Detail roll" yang membuka popup tabel: No., Code roll, Gramasi (gsm), Setting, Mulai resting, Status (Resting/Cutting/Selesai). Roll yang belum di-resting belum punya data. Export Excel: lihat entri "Export Monitoring Produksi: sheet Detail Roll" di atas.

## Biaya ekspedisi tidak lagi diisi vendor (2026-10-26, tanpa migration; membatalkan sebagian entri 0077 di bawah)
Owner: harga ekspedisi tidak diinput vendor, pakai Master Data Ekspedisi. Kolom "Biaya ekspedisi resi ini" di dialog Set Ekspedisi & Resi dan tulisan "Biaya ekspedisi" di Riwayat pengiriman dihapus; server (`setKoliEkspedisiResiGroupAction`) tidak lagi menerima atau menulis biaya. `koliOngkirShare` (derive.ts) selalu memakai tarif per kg Master Data x berat koli (dibagi sesuai berat dalam satu resi), jadi HPP dan ongkir kembali seperti sebelum 0077. Kolom `delivery_kolis.biaya_ekspedisi` TETAP ada di database (migration 0077 tidak dibatalkan) tetapi tidak dibaca lagi; nilai yang pernah diisi vendor diabaikan.

## Tracking Item (PPIC dan SCM) (2026-10-26, tanpa migration)
Owner: halaman monitoring per ITEM (warna + lengan + size, mis. "HITAM 24S PDK L"), bukan per warna: berapa yang akan diproduksi, sudah diproduksi, dan sudah dikirim. Halaman `/mrp/ppic/item-tracking` (menu PPIC "Tracking Item") dan `/scm/item-tracking` (menu SCM), isi sama (`components/mrp/item-tracking-view.tsx`), murni turunan data yang ada (`lib/mrp/itemTracking.ts`, `buildItemTracking`). Tahap: Target MRP (qty size itu di grup warna·lengan; sisa yang belum punya vendor ditandai "Belum dialokasikan", MRP ditolak tidak dihitung) -> Cutting (hasil cutting aktual roll) -> Finish Good dan Reject (akumulasi hasil produksi, termasuk koreksi dan hasil rework) -> Di koli belum dikirim -> Dikirim (koli yang sudah dikirim, reject tidak dihitung) -> Diterima gudang (penerimaan Warehouse, reject tidak dihitung). Filter: cari item, warna, lengan, size, kategori, No. MRP, vendor; kartu tahapan dan total mengikuti filter; klik baris membuka rincian per MRP dan vendor; Export Excel (ringkasan dan rincian).

## Master Data: teks keterangan dihapus + Import Data di semua tabel (2026-10-26, tanpa migration)
Owner: hilangkan teks abu-abu keterangan di Master Data semua modul, dan usahakan tiap Master Data punya Import Data. Semua `subtitle` kartu di panel Master Data (Harga Maklon/Kain/Kain PKS/RIB, Ekspedisi, Vendor & Supplier, SKU, Mapping Warna), keterangan kecil di List Entitas, dan subjudul halaman SCM Master Data dihapus. Import Data umum: `components/mrp/master-import-modal.tsx` (`MasterImportModal`, `upsertRows`): pilih Excel/CSV, pratinjau per baris (baris bermasalah dilewati), UPSERT per kunci. Kini ada di: Harga Maklon (vendor+tipe lengan+jenis harga+kapasitas min), Harga Kain PKS (supplier+kategori+warna+tonase min), Harga RIB (supplier+warna), Harga FOB (vendor+item), Ekspedisi (nama), Harga Kerah/Manset (supplier), Supplier Material dan Entitas (nama; yang sudah ada dilewati); sebelumnya sudah ada di Harga Kain, SKU, Mapping Warna, dan Migrasi Data PPIC. Vendor/supplier di file harus sudah ada di Master Data Vendor & Supplier (kalau tidak, barisnya ditolak). Belum ada import: Vendor Produksi (akun login, butuh password), Rib/Kerah/Manset (2-3 baris tetap), Toleransi berat SCM (satu angka).

## Halaman Raw Material Procurement (2026-10-26, tanpa migration)
Permintaan client via owner: data bahan per MRP, total tagihan invoice setelah diskon, WIP dan sisa bahan baku (nominal) per vendor dan per MRP, total diskon, qty roll, jenis bahan per kategori produk, untuk pelaporan bulanan. Halaman `/procurement/raw-material` (menu Procurement "Raw Material"); murni turunan data yang sudah ada.
- `lib/mrp/rawMaterialReport.ts`: nilai tiap roll kain = harga per kg x berat kotor roll (invoice `colorEntries`); diskon invoice dibagi sebanding nilai tiap item dengan faktor `totalBiaya / (kain + item tambahan)`, jadi jumlah laporan selalu sama dengan total invoice tercatat. Pemakaian roll ditelusuri lewat code roll (Good Receive/penimbangan) ke batch produksi: batch ada dan belum ditutup = WIP, batch ditutup = Selesai, tanpa batch = Sisa (dibeli dikurangi WIP dan Selesai, termasuk roll yang belum diterima vendor, mengikuti spreadsheet RAW MATERIAL). Item tambahan rib/kerah/manset: pemakaiannya ESTIMASI (2026-10-26, owner: pakai hitungan rib per roll) -- kg per roll = kg rib grup warna+lengan di MRP / jumlah roll grup itu (`materialKgPerRollForGroup`, aturan yang sama dengan alokasi rib di PO/PV), dikalikan roll kain WIP/selesai warna yang sama dalam invoice itu, nilai = kg estimasi x harga per kg setelah diskon (maks sebesar kg yang dibeli); sisa = dibeli - WIP - selesai. Ditandai "≈" di popup; item tambahan lain tetap hanya pembelian. Benang (24S/30S) dibaca dari kategori produk grup lengan (fallback kategori MRP).
- Halaman: kartu total (invoice setelah diskon, diskon, nilai WIP, sisa bahan baku), filter Bulan invoice/No. MRP/Vendor/Kategori produk/Jenis bahan, tabel per MRP x vendor yang bisa dibuka per warna dan jenis bahan, tombol Export Excel (`lib/mrp/exportRawMaterialExcel.ts`: sheet Ringkasan dan sheet Rincian per warna). Filter bulan memakai tanggal invoice dibuat; angka WIP dan sisa selalu kondisi saat ini.

## Nama pelaku di daftar portal vendor -- migration 0078 (2026-10-26)
Owner: vendor punya akun utama dan akun tim (username); daftar-daftar di portal vendor harus menunjukkan proses itu dikerjakan siapa (contoh: koli di Pengiriman). Nama disematkan di baris data (lebih andal daripada mencocokkan ke `vendor_action_log`, yang terbatas dan hanya mencatat sebagian aksi).
- **Migration 0078** (`0078_vendor_actor_names.sql`, owner menjalankan manual SEBELUM deploy): kolom teks `delivery_kolis.created_by/shipped_by`, `production_batches.resting_by/cutting_by/fg_by/closed_by`, `raw_material_invoice_rolls.received_by`, `vendor_invoices.submitted_by`. Isi = `Nama (@username)` untuk anggota tim, `NamaVendor (akun utama)` untuk akun utama (`actorLabel` dari `requireVendorSessionWithActor`). Hanya terisi untuk aksi SESUDAH migration; data lama kosong dan tidak ditampilkan.
- Server: `stampActor` (best-effort, terpisah dari aksi utama, jadi aksi vendor tidak gagal kalau migration belum jalan) dipanggil di buat koli, set ekspedisi & resi, mulai resting, input hasil cutting (tunggal dan banyak), simpan progres FG, Edit FG, Tutup Roll, Selesai Produksi (roll yang ikut tertutup), Good Receive (satu dan banyak roll), dan pengajuan invoice vendor. Input hasil cutting, simpan progres/Edit FG, dan pengajuan invoice sebelumnya tidak tercatat di `vendor_action_log` -- tetap belum; yang baru hanya nama di baris datanya.
- Visibilitas (keputusan owner: vendor saja): `getFlowSnapshotAction` membuang semua kolom nama ini (`stripVendorActorNames`, vendorScope.ts) untuk sesi internal non-Sysadmin, jadi tidak ikut sampai ke browser Procurement/Finance/Warehouse. Vendor sendiri dan Sysadmin menerimanya.
- UI (revisi 2026-10-26, owner: jangan disematkan di satu informasi, buat kolom): kolom **PIC** berisi username saja (`PicText`/`picUsername`, components/mrp/actor-tag.tsx; sub-user tampil `username`, akun utama tampil "Akun utama", nama lengkap di tooltip, "-" kalau belum ada). Pengiriman: "PIC Buat" di tiga daftar koli dan "PIC Kirim" di riwayat; Produksi: "PIC Resting" dan "PIC Cutting" di tabel Input Resting dan Cutting, "PIC FG" di tabel progres per batch tab Finish Good; Good Receive: "PIC" di tabel roll; Invoice: "PIC" di daftar invoice. Perubahan lokal yang optimistic (cutting, FG) baru menampilkan username setelah refresh data berikutnya.

## Biaya ekspedisi aktual per resi -- migration 0077 (2026-10-24)
Owner: harga ekspedisi di Master Data bisa sering berubah, jadi biaya riil per resi (dari nota ekspedisi) diisi vendor langsung. Dialog "Set Ekspedisi & Resi" dapat kolom "Biaya ekspedisi resi ini (Rp) — opsional" (disembunyikan untuk "Pengiriman Internal"); ada estimasi tarif master sebagai petunjuk.
- **Migration 0077** (`0077_koli_biaya_ekspedisi.sql`, owner menjalankan manual SEBELUM deploy): kolom `delivery_kolis.biaya_ekspedisi` (numeric). Nilai = TOTAL biaya 1 resi, disimpan identik di semua koli grup resi itu. Kosong = perilaku lama (tarif per kg Master Data). Kode aman tanpa migration selama biaya tidak diisi (penulisannya terpisah dan error diabaikan kalau kosong).
- `koliOngkirShare` (derive.ts): kalau ada biaya aktual di grup resi, ongkir koli = biaya x berat koli / total berat grup (berat semua 0 = dibagi rata); koli tanpa grup resi memakai biayanya langsung. Karena HPP (per roll dan pool lama) dan `autoOngkirForInvoice` memakai fungsi ini, Laporan HPP otomatis memakai biaya aktual. Resi lama tanpa biaya tidak berubah.
- Server `setKoliEkspedisiResiGroupAction` menerima `biayaEkspedisi` (opsional, dibulatkan, > 0, maks 1 miliar); store ikut mem-patch lokal; Riwayat pengiriman menampilkan "Biaya ekspedisi" di header resi. Belum ada layar internal untuk mengoreksi biaya setelah tersimpan (koreksi lewat Sysadmin "Batalkan pengiriman" lalu set ulang).

## Finish Good per roll langsung bisa dikirim, tanpa Tutup Roll (2026-10-24) [fg-ship]
Permintaan vendor ARTHA (Turkis 24S Pendek XL: FG diinput 600 pcs tapi sisa bisa dikirim 360): pengiriman dulu hanya membaca FG dari roll yang sudah ditutup. Sekarang FG per roll per size yang sudah diinput langsung jadi sisa kirim. **Tidak ada migration.** Titik kembali sebelum fitur ini: commit `c275c45` (keyword "kembalikan FG langsung kirim" = revert commit `[fg-ship]`).
- `derive.ts`: `rollRemainingBySizeForMrp` dan `mrpIdsWithClosedRolls` ikut menghitung roll TERBUKA yang sudah punya FG (`rollHasFg`); `rollShippedBySize` = qty per size yang sudah masuk koli dari 1 roll (batas bawah FG). `hppRowsForInvoicePerRoll` tidak lagi mensyaratkan roll ditutup; baris dari roll terbuka diberi `sementara` (kain per pcs = biaya roll / FG yang sudah diinput; sisa menggantung belum dihitung reject). Reject tetap baru terbentuk saat roll ditutup + Selesai Produksi tahap 1.
- `actions.ts`: `assertFgBounds` dipakai Simpan progres, Tutup Roll, dan Edit FG: FG tidak boleh melebihi hasil cutting dan tidak boleh kurang dari qty yang sudah masuk koli (roll yang terkirim lewat koli lama level-koli tetap terkunci). Edit FG tidak lagi menolak semua roll yang sudah punya koli; Buka lagi boleh untuk roll yang sebagian FG-nya sudah dikirim (hanya koli lama yang tetap menolak). Validasi qty koli di server (`clampDeliveryItemsBySourceBatch`) otomatis ikut karena memakai fungsi sisa kirim yang sama.
- UI: Buat koli menandai sumber roll berlabel "terbuka" dan punya tombol "Isi semua sisa"; Finish Good: popup konfirmasi Tutup Roll yang masih punya sisa, keterangan "dikirim N pcs" dan banner untuk roll terbuka yang sudah dikirim, Edit FG punya batas bawah; Laporan HPP: penanda "Sementara" dan catatan jumlah baris sementara di kartu HPP (%).
- Perbaikan riwayat FG (2026-10-24, commit terpisah [fg-log]): "Simpan progres" / Tutup Roll (`logFgProgressDelta`) sekarang juga mencatat koreksi TURUN sebagai baris "Roll X (koreksi)" ber-qty negatif (pola sama `editRollFgAction`), sehingga FG naik-turun-naik tidak lagi terhitung dua kali di riwayat FG kumulatif grup (progres FG / status PO). Optimistic client (`optimisticFgLog`) ikut. Data lama yang sudah terlanjur kelebihan tidak diperbaiki otomatis -- cek dengan SQL baca-saja di chat.

## Perhitungan produksi dibatasi PER VENDOR -- migration 0076 (2026-10-24)
Bug (owner, W39 Hitam 30S Pendek di YOGI 01): tab Finish Good vendor menampilkan target 4024 pcs dan FG 1828 pcs padahal hasil cutting YOGI 01 hanya L 424 dan FG-nya 0. Penyebab: data produksi dikelompokkan per `mrp|warna|lengan` TANPA vendor, sedangkan satu warna·lengan bisa dikerjakan beberapa vendor (Hitam 30S Pendek: CE, GI-01, GI-02, KK, MKS), jadi target/FG/reject vendor lain ikut terjumlah. Pengecekan 2026-10-24: 4 warna·lengan di W39 sudah multi-vendor (Hitam 30S Pendek, Abu Muda 24S Panjang, Burgundy 24S Panjang, Tosca 24S Panjang); aduan terbagi >1 vendor: W39 7 grup, W40 6, W41 2. Data di database (batch, hasil, FG per vendor) benar; yang salah penggabungan di layar dan perhitungan.
- `onlyVendor` (derive.ts): fungsi perhitungan per vendor menyaring batch/hasil/status ke vendor itu di titik masuk (`materialPoFullStatus`, `maklonProductionFullyDone`, `mrpIdsWithRemainingReject`, `invoiceYieldSummary`, `groupCloseSummary`, `productionYieldByWarna`, `vendorItemSizeProgress`, `productionYieldBySize` (parameter vendor opsional), `hppRowsForInvoice`, `hppRowsForInvoicePerRoll`) dan di badge (`productionGroupGaps`, `countRemainingRejectGroupsForMrp`). `productionGroupMetaFor(groupKey, metas, vendor?)` ikut vendor. Layar vendor (Finish Good, Reject & Rework, Final Produksi) membaca data lewat hook `useVendorProduction(vendorId)`.
- **Migration 0076**: kunci `production_group_meta` jadi `(group_key, vendor_produksi)`, supaya status Selesai Produksi dan remark reject tidak saling menimpa antar vendor. Semua query status grup dan hasil di server (actions.ts, sysadminActions.ts) kini memakai filter `vendor_produksi`; reject otomatis yang dihitung ulang hanya milik vendor itu. `undoFgConfirm`, `undoProductionGroupDone`, `setGroupRejectRemark`, dan koreksi Sysadmin (`sysadminUndoFgConfirmAction`, `sysadminUndoFinalAction`) menerima vendor. **Owner menjalankan migration manual SEBELUM deploy**; tanpa itu hanya vendor KEDUA di grup yang sama yang gagal menandai Selesai Produksi (kunci ganda).
- Belum diubah: tampilan lintas-vendor modul internal (mis. Monitoring Reject, Monitoring Produksi) yang memang menampilkan agregat per MRP.
- Penjagaan kepemilikan di server (2026-10-24, owner: data satu vendor tidak boleh memengaruhi vendor lain): semua aksi vendor kini memeriksa bahwa invoice bahan, roll, koli, PO produksi, dan baris Aduan Pola yang disentuh milik vendor yang sedang login (`assertSameVendor`, `assertInvoiceOwnedByVendor`, `assertBatchesOwnedByVendor`, `assertMaklonPoOwnedByVendor`, `assertRollCodesOwnedByVendor` di actions.ts). Aksi yang menerima `vendorProduksi` dari browser (hasil produksi, rework, Selesai Produksi, koli, invoice vendor) menolak jika berbeda dari vendor sesi. Tidak ada migration baru. Snapshot untuk sesi vendor juga disaring di server (`lib/mrp/vendorScope.ts`, dipanggil di `getFlowSnapshotAction`): browser vendor hanya menerima PO, invoice bahan, batch, hasil produksi, status grup, koli, invoice vendor, notifikasi, klaim, dan baris Aduan Pola milik vendornya sendiri. Baris MRP dan grup lengan yang dirujuk Aduan Pola vendor itu tetap ada; `materialRows`, saldo deposit, dan kapasitas vendor lain tidak dikirim.

## Bukti bayar WAJIB untuk invoice vendor produksi (maklon) -- migration 0075 (2026-10-24)
Owner: Finance harus mengunggah bukti bayar sebelum bisa mengklik Bayar untuk invoice maklon (pola sama pembayaran invoice material), dan vendor bisa melihat buktinya. Label status PAID di tabel invoice vendor kini tampil "LUNAS" (`vendorInvoiceBadge`, dipakai bersama modul vendor, Procurement, dan Finance; nilai status di data tetap PAID).
- **Migration 0075** (`0075_vendor_invoice_payment_proof.sql`, owner menjalankan manual SEBELUM kode ter-deploy): kolom penanda `vendor_invoices.bukti_bayar_at/bukti_bayar_file_name` + tabel `vendor_invoice_payment_proofs` (file-nya terpisah, TIDAK masuk snapshot, diambil on-demand).
- Server: `payVendorInvoicesAction(ids, proof)` menolak tanpa bukti (PDF/JPG/PNG), bukti disimpan DULU baru status jadi PAID; satu bukti boleh untuk beberapa invoice yang dibayar bersamaan; invoice yang belum APPROVED ditolak. `setVendorInvoicePaymentProofAction` melampirkan bukti belakangan untuk invoice yang sudah lunas (kolom "Bukti Bayar" > Upload di riwayat Finance). `getVendorInvoicePaymentProofAction`: Finance/Procurement/Sysadmin atau vendor pemilik (akses internal diperiksa dulu). Semuanya mengembalikan `ActionResult`.
- UI: Finance > Payment > Payment Maklon: kolom unggah "Bukti pembayaran (wajib)" di bar pembayaran, tombol Bayar Penuh nonaktif sampai bukti terpilih. Modul vendor: detail invoice berstatus LUNAS punya tombol "Lihat bukti bayar".
- Sysadmin "Batalkan pembayaran" invoice vendor ikut menghapus bukti lama, jadi pembayaran ulang wajib melampirkan bukti baru. Invoice yang SUDAH lunas sebelum aturan ini tidak punya bukti sampai Finance menekan Upload di riwayat.

## Hapus koli yang belum dikirim -- vendor produksi (2026-10-24, tanpa migration)
Owner: vendor boleh menghapus koli yang salah isi, dan quantity-nya kembali ke daftar untuk dimasukkan ke koli lain. Tombol "Hapus" di tabel "Koli belum dikirim" (halaman Pengiriman, disembunyikan di Mode Sysadmin yang punya koreksi sendiri). Popup konfirmasi memuat total pieces dan rincian per jenis produk, warna, lengan, size, usia yang akan dikembalikan.
- Server: `deleteDeliveryKoliAction` (actions.ts) mengembalikan `ActionResult` (alasan penolakan sampai ke layar). Hanya koli milik vendor sendiri dan BELUM delivered/diinvoice; foto ekspedisi, tautan batch, dan isi dihapus dulu baru kolinya, dan isi dipulihkan otomatis kalau penghapusan induk gagal. Tercatat di vendor_action_log. Koli yang sudah terkirim tetap hanya bisa dibatalkan lewat koreksi Sysadmin.
- Tidak ada angka yang "dikembalikan manual": sisa per warna·lengan·size (Finish Good, Rework, Reject, dan roll) selalu dihitung dari isi koli yang ada, jadi quantity otomatis tersedia lagi begitu koli hilang. Store (`deleteDeliveryKoli`) optimistic dengan rollback kalau server menolak.

## Reject boleh dikirim lewat Pengiriman -- migration 0074 (2026-10-23)
Owner: sisa reject boleh masuk koli pengiriman, dengan syarat remark sisa reject warna·lengan itu sudah DIKONFIRMASI di tab Reject & Rework. Keputusan owner: boleh dicampur dengan Finish Good dalam satu koli; TIDAK ditagihkan di invoice vendor; Warehouse hanya mencatat (tanpa stok/HPP) dan TIDAK dikirim ke WMS.
- `ShippableKind` kini "FG" | "REWORK" | "REJECT". `availableRejectToShip` (derive.ts): sisa reject per size (reject otomatis dikurangi rework) dikurangi reject yang sudah masuk koli, hanya untuk warna·lengan yang `remarkSisaReject`-nya terisi. Remark dibatalkan = reject yang belum dikemas tidak tersedia lagi (yang sudah terkirim tetap tercatat). Muncul di tabel "Rework, Reject & sisa FG lama" halaman Pengiriman dan ikut badge/dropdown MRP.
- Server (`clampDeliveryItemsBySourceBatch`) menghitung ULANG reject yang boleh dikirim dari data segar; qty dari klien tidak dipercaya. Rework (`reworkRejectSizeAction`) ditolak kalau melebihi sisa reject yang belum dikirim; di UI "Sisa reject" menampilkan jumlah yang sudah dikirim dan tombol Rework memakai sisa yang belum dikirim.
- `isBillableKoliItem` (derive.ts): item REJECT dikeluarkan dari penagihan (`deliveredQtyByMrp`, `resiGroupInvoiceLines`, `koliBreakdownForLine`), dari penyebut HPP/ongkir per pcs, dan dari daftar "Siap diajukan invoice" (resi yang isinya hanya reject tidak muncul).
- Warehouse (`warehouseReceivableGroups`): item reject masuk daftar penerimaan dengan HPP 0 dan tidak membuat gate "HPP tidak bisa ditelusuri"; resi yang HANYA berisi reject boleh langsung dibongkar tanpa invoice (resi campuran tetap mengikuti gate invoice PAID). Tercatat di Riwayat sebagai item "Reject".
- **Migration 0074** (`0074_wms_snapshot_exclude_reject.sql`, owner menjalankan manual SEBELUM vendor mengirim reject): `wms_resi_snapshot()` mengecualikan item reject dan koli yang isinya reject semua (supaya total koli yang dilihat WMS cocok).
- Tidak ada data koli lama yang berisi reject (dicek 2026-10-23), jadi pengecualian dari penagihan tidak mengubah tagihan yang sudah ada.

## Approval PO Level 2: dari "Asisten Manager Procurement" ke SCM (2026-10-14, tanpa migration)
Owner: tidak ada akun/jabatan "Asisten Manager" sehingga PO Level 2 (Rp 2 jt - 50 jt) tidak pernah ada yang menyetujui; minta diganti SCM. lib/mrp/poApproval.ts: `APPROVAL_STEP_ROLES[2] = ["scm"]` (dulu procurement), label "Level 2 · SCM". Persetujuan langkah 2 yang SUDAH tercatat oleh Procurement di data lama tetap dianggap sah (`APPROVAL_STEP_LEGACY_ROLES`) supaya PO yang sudah lewat Level 2 tidak mundur. Antrean Level 2 kini ada di SCM > Approval PO (14 PO W39 langsung muncul); tab Procurement berganti nama "Status Approval PO" (PO ditolak + pantauan). PO > Rp 50 jt: SCM menyetujui dua kali (Level 2 lalu Level 3 bersama Finance), sesuai matriks berlapis.

## Upload MRP: baca roll/rib/kerah/manset dari Excel (tanpa hitung ERP) + vendor per baris aduan + vendor per warna di PPIC (2026-10-14, tanpa migration)
Owner: roll di ERP beda dengan Excel (file ERP_W39: roll ERP 597 vs Excel 642, rib 489,9 vs 389,9; 38 dari 63 grup warna-lengan roll-nya beda). Penyebab: template baru memakai judul ROLL (SIZE) / RIB (SIZE) / KERAH (SIZE) / MANSET (SIZE) yang tidak dikenali parser, sehingga ERP memakai rumus cadangan (qty / 117 per roll, qty x gram per pcs). Perubahan di lib/mrp/parseImport.ts:
- Roll, rib, kerah, manset DIBACA dari Excel: jumlah kolom (SIZE) per warna+lengan (roll dibulatkan ke atas). Template lama (RAW MATERIAL (ROLL), RIB KILOGRAM, KERAH, MANSET) tetap dibaca. Judul dicocokkan tanpa peduli huruf besar/spasi ganda. TIDAK ADA lagi rumus cadangan: kolom roll/rib tidak ada = import ditolak; grup ber-qty dengan roll kosong/0 = ditolak dengan pesan jelas. Master Data "Rib per Pcs" (0069) tidak lagi dipakai upload (barisnya dibiarkan).
- Vendor per baris aduan dibaca dari kolom VENDOR sheet "Aduan Pola" (satu warna+lengan boleh dikerjakan banyak vendor; dulu semua baris grup dipaksa ke vendor pertama). Sheet tanpa kolom VENDOR memakai vendor default grup. Baris ber-roll tanpa vendor = ditolak.
- Aduan SATU size (mis. "3XL" dengan Qty1=36, Qty2=36) kini menjumlah SEMUA kolom Qty (72); dulu hanya Qty1 sehingga qty vendor BAYU/YOGI-02 kurang 78/36 dibanding sheet utama.
- Diuji dengan file W39 asli: total roll 642 (= Excel = sheet Aduan Pola), rib 389,86 (= Excel), qty per vendor kedua sheet identik, 10 grup dibagi >1 vendor terbaca benar.
- PPIC: kolom "Vendor produksi" di pratinjau import dan di tabel rincian warna (MrpWarnaBreakdownTable; juga dipakai SCM): daftar vendor per warna beserta pcs dan roll (`MrpWarnaBreakdown.vendors`, derive.ts).

## Material Tracking Procurement: tanggal kirim & terima per kiriman (2026-10-13, tanpa migration)
Owner: Procurement perlu tahu kapan material dikirim dan kapan diterima vendor; satu PO bisa dikirim parsial, jadi tampil saat baris PO dibuka (app/procurement/material-tracking/page.tsx). Tiga kotak: Tgl dikirim (deliveredAt, Set Delivery), Mulai diterima vendor (tanggal roll pertama dari rollArrivals, fallback receivedAt) + progres roll, Lengkap diterima (tanggal roll TERAKHIR, hanya kalau semua roll sudah masuk; selain itu "Belum lengkap, sisa N roll"). Tabel warna/lengan dapat kolom "Diterima vendor" (jumlah roll + tanggal atau rentang tanggal). Murni turunan data yang sudah ada.

## Logout vendor kembali ke tempat login (2026-10-12, tanpa migration; menyempurnakan entri logout di bawahnya)
Owner: logout dari portal vendor harus kembali ke halaman asal login -- login dari panel di halaman utama ("/") kembali ke sana, login dari /vendor-maklon/login kembali ke sana. `useVendorAuthStore.loginOrigin` ("chooser" | "login", ikut disimpan di localStorage) diisi saat login sukses (app/page.tsx = chooser, app/vendor-maklon/login = login). Tombol Logout (app-shell) dan VendorAuthGuard sama-sama mengarah ke `/?masuk=vendor` (chooser; halaman utama membuka panel login vendor otomatis lalu membersihkan alamat) atau `/vendor-maklon/login`. Akar bug sebelumnya: dua pengalihan (Logout dan penjaga halaman) berebut arah; sekarang tujuannya sama.

## Logout vendor produksi: tidak lagi terlempar ke halaman pilih modul (2026-10-12, tanpa migration)
Owner: setelah logout dari vendor produksi terlempar ke halaman pilih modul ("/"), seharusnya ke login vendor. Penyebab yang ditemukan di kode: penangan error global (`guardAction`, lib/mrp/store.ts) menganggap aksi yang gagal "Unauthorized" sebagai sesi kedaluwarsa, menampilkan dialog "Sesi berakhir", lalu `window.location.href = "/"` -- padahal setelah logout cookie memang sudah dihapus, jadi aksi apa pun yang masih berjalan/antre ikut memicunya. Perbaikan: (1) logout vendor menandai `markIntentionalLogout()` (10 detik) sehingga error auth pada jendela itu diabaikan senyap; (2) pengalihan "sesi berakhir" untuk halaman /vendor-maklon sekarang ke /vendor-maklon/login (modul internal tetap ke "/"). Catatan: di lingkungan uji logout sudah mengarah benar sebelum perbaikan, jadi pemicu persis di produksi belum terbukti; kalau masih terjadi, periksa apakah ada sesi Sysadmin di browser yang sama.

## Reset MRP kini ikut membersihkan notifikasi (2026-10-12, tanpa migration)
Owner: notifikasi "PO Produksi ... telah disetujui Finance" masih tampil padahal MRP-nya sudah direset. Sebabnya: tabel notifications hanya berisi teks (tanpa kolom mrp_id) sehingga resetMrpCore sengaja tidak menyentuhnya. Sekarang resetMrpCore mengumpulkan nomor MRP, nomor PO material/produksi, dan nomor invoice (material + vendor) milik MRP itu SEBELUM dihapus, lalu `deleteNotificationsMentioning` menghapus notifikasi yang menyebut nomor tersebut (batas nomor penuh: "MRP-W36" tidak menghapus notifikasi "MRP-W36-B"). Best-effort: gagal membersihkan notifikasi tidak menggagalkan reset. Notifikasi yatim yang sudah terlanjur ada dibersihkan dengan skrip SQL sekali jalan (dibuat di chat, bukan migration): notifikasi yang menyebut nomor PO/VINV/INV tetapi tidak satu pun nomornya masih ada di material_pos, maklon_pos, vendor_invoices, raw_material_invoices.

## Panduan & kontak feedback di sidebar Vendor Produksi; Form Rasio (2026-10-12, tanpa migration)
Owner: kolom FORM RASIO di PO Produksi Saya dipindah ke paling kanan; dasar sidebar vendor produksi memuat "Panduan Penggunaan" + nomor feedback 0853-9525-7703 (WhatsApp wa.me/6285395257703), HANYA modul vendor produksi (bukan mode Sysadmin).
- `components/shell/sidebar.tsx` prop `help` (diisi di app-shell untuk role vendorMaklon); dengan blok bantuan sidebar `lg:sticky h-screen` supaya selalu di dasar layar. Halaman `/vendor-maklon/panduan` (app/vendor-maklon/panduan/page.tsx, isi panduan per menu -- perbarui kalau alur halaman berubah); `proxy.ts` mengizinkan anggota tim membukanya apa pun allowedPages-nya (seperti Profil Saya).
- Form Rasio Excel: Total/Total Roll/Rib Total/Kerah-Manset Total sekarang RUMUS SUM, format angka 0.00 (bukan 0.## yang menampilkan "1."), kategori jatuh ke kategori MRP bila grup kosong, pembekuan baris header dengan topLeftCell eksplisit.

## Master Data "Rib per Pcs" -- migration 0069 (2026-10-09)
Owner: faktor rib naik dari 6,5 ke 7 gram/pcs "di data terbaru saja", dan bisa diatur seperti Kerah/Manset. `kerah_manset_settings` dapat baris `RIB` (kg_per_pcs 0,007; constraint kind diperluas). Dipakai `parseMrpImportFile` (lib/mrp/parseImport.ts) HANYA saat upload MRP baru dan kolom RIB KILOGRAM kosong (`ribKg = totalQty x kgPerPcs`, bawaan 0,007 kalau baris belum ada); MRP lama tidak dihitung ulang. Diedit di Procurement > Master Data > "Rib / Kerah / Manset". **Owner menjalankan migration manual**; sebelum itu baris Rib belum tampil di panel tapi upload tetap memakai 7 gram. Halaman input MRP manual (app/mrp/ppic/new) memakai konstanta 7 gram.

## Profil Saya portal Vendor Produksi (2026-10-09, tanpa migration baru)
Permintaan owner: halaman profil untuk akun utama dan anggota tim vendor, untuk mengganti password; username tidak boleh diubah.
- Halaman `/vendor-maklon/profil-saya` (`app/vendor-maklon/profil-saya/page.tsx`), dibuka dari menu profil di topbar. Menampilkan username/nama (akun utama: nama vendor) TERKUNCI; hanya password yang bisa diganti. Logika: `lib/mrp/vendorProfileActions.ts` (password saat ini wajib cocok, baru min. 6 karakter dan harus beda, hash bcrypt + salinan terenkripsi `savePasswordCopy`, tercatat di vendor_action_log tanpa isi password).
- `proxy.ts`: halaman ini selalu boleh dibuka anggota tim, tidak tergantung allowedPages. Sesi yang berjalan tetap valid setelah ganti password. Nama anggota tim tidak bisa diubah dari sini (jejak log memakai nama itu); perubahan nama tetap lewat Tim Saya (akun utama).

## Persetujuan hasil cutting (opsional per vendor) + Form Rasio PO -- migration 0068 (2026-10-09)
Permintaan vendor: (1) export form PO format tabel MRP untuk info rasio, (2) approval cutting sub tim -> akun utama kalau hasil kurang dari target, OPSIONAL per vendor.
- **Form Rasio (Excel)**: `exportMaklonPoRasioExcel` (lib/mrp/exportPoExcel.ts). Kolom meniru template MRP (kategori, warna, item, lengan+size, qty, total, kebutuhan roll per item, total roll, aduan pola, vendor, rib per item, rib total, kerah/manset PDK/PJG/total), TANPA harga. Roll per size = qtyRoll aduan x qty size / qty aduan; rib per size = ribKg grup x qty size / total grup. Tombol: portal vendor (PO Produksi Saya, kolom Form Rasio) + dialog Download PO internal (tombol Form Rasio). Kategori dari grup (baris pertama), jadi baris KIDS dalam grup campuran memakai kategori grup.
- **Migration 0068** (`0068_cutting_approval.sql`, owner menjalankan manual): `vendors_produksi.cutting_approval_required` (default false) + kolom `production_batches.cutting_approval_status/submitted_by/submitted_at/decided_by/decided_at/decision_note`. Kode aman sebelum migration (fitur mati, toggle disembunyikan).
- **Aturan**: vendor menyalakan toggle di Tim Saya (akun utama). Anggota tim menyimpan hasil cutting dan ada size di bawah target (setelah alih size sisa kain diperhitungkan) -> roll PENDING (server, `applyCuttingApproval`), Finish Good roll itu terkunci (UI: roll tidak muncul di tab FG; server: `assertCuttingNotPending` di Tutup Roll/progres FG/Edit FG). Akun utama menyetujui atau menolak (`decideCuttingApprovalAction`; tolak = hasil cutting dikosongkan lagi + alasan wajib tampil ke tim). Akun utama yang menyimpan sendiri tidak perlu persetujuan. Notifikasi vendor + vendor_action_log.

## Kecepatan & multi-user: lampiran PV keluar dari snapshot (0066), penjaga 2 tim (0067) (2026-10-08)
Owner: "user tidak menunggu buffering lama" + "aman untuk multiuser, dua tim cutting bersama tidak saling bentrok".
- **Akar lambat (terukur):** 97% isi snapshot (13,1 dari 13,5 MB) = lampiran PDF Paying Voucher yang tertanam di
  `raw_material_invoices.bukti_pv_storage_path`. Tiap pengambilan data 4-27 detik (kadang timeout 57014), dan karena Server Action
  satu browser dikerjakan BERURUTAN, klik tulis ikut antre di belakang snapshot -> terasa "buffering". Kode sekarang TIDAK mengirim
  PDF ke browser (`buktiPvAvailable` saja; PDF diambil saat diklik lewat `getInvoiceBuktiPvAction`, `lib/mrp/viewInvoicePv.ts`).
- **Migration 0066** (`invoice_pv_files`): memindahkan PDF ke tabel terpisah + mengosongkan kolom lama (isi disalin dulu) supaya
  snapshot di SISI DATABASE juga kecil (egress). **Owner menjalankan manual. SEBAIKNYA DULU sebelum polling 20 detik bermanfaat.**
  Kode jalan sebelum maupun sesudah migration (tulis ke tabel baru, fallback kolom lama; baca tabel baru, fallback kolom lama).
- **Polling versi data tiap 20 detik** (`components/shell/store-hydrator.tsx`, RPC get_data_version, beberapa byte) -> perubahan tim lain
  muncul dalam detik. Otomatis diperlebar (8x durasi, maks 10 menit) kalau pengambilan data lambat; berhenti di halaman tanpa sesi.
- **Penjaga bentrok** (`assertBatchesUnchanged`, actions.ts): Simpan Hasil Cutting (modal membawa keadaan roll saat dibuka), Simpan
  progres FG & Tutup Roll (membawa angka FG yang dilihat layar) ditolak server kalau roll sudah diubah orang lain -- pesan jelas, data
  dimuat ulang, tidak ada yang tertimpa. **Resting**: satu code_roll hanya boleh punya satu batch (cek server + rollback bila gagal di
  tengah daftar) + **migration 0067** (indeks unik parsial) sebagai jaring terakhir. Catatan jujur: cek-lalu-tulis tidak atomik
  (jendela milidetik, bukan lagi menit-jam); atomik penuh butuh fungsi database/kolom versi.
- Diuji (BAYU, data dipulihkan): cutting & resting ditolak benar + jalur normal sukses; FG jalur normal sukses (angka dasar terkirim),
  penolakan FG tervalidasi lewat helper yang sama (uji konflik FG lewat UI tidak konklusif).

## Tim Saya: password terlihat + tanpa menunggu -- migration 0065 (2026-10-08)
Owner: "tampilkan password user dari Tim Saya", "jangan sampai lama memuat/simpan ... tapi jangan conflict atau corrupt".
- **Migration 0065** (`vendor_users.password_enc`): salinan password anggota tim TERENKRIPSI (AES-256-GCM, kunci dari
  SESSION_SECRET -- pola sama migration 0063, `lib/auth/password-vault.ts`). Login tetap bcrypt. **Owner menjalankan manual**
  di SQL Editor: `alter table public.vendor_users add column if not exists password_enc text;`. Kode aman kalau belum jalan
  (tombol mata menjawab "jalankan migration 0065"). Anggota yang dibuat SEBELUM ini tampil "Belum tersimpan" sampai passwordnya
  di-ganti sekali lewat Edit. Hanya akun UTAMA vendor yang bisa melihat (`revealVendorTeamMemberPasswordAction`); password
  diambil dari server hanya saat mata diklik (tidak ikut daftar).
- **Tanpa menunggu**: `lib/mrp/vendor-team-store.ts` -- daftar anggota/riwayat di-cache di memori (pindah halaman tidak "Memuat…"
  lagi), tambah/ubah/nonaktifkan/hapus mengubah layar seketika dan server menyusul; ditolak server = dibatalkan + pemberitahuan
  (tambah: modal dibuka lagi dengan isian tadi). Anti-bentrok: hasil ambil-ulang dibuang kalau ada tulisan yang dimulai sesudahnya
  (epoch), lalu disamakan dengan server sekali setelah tulisan terakhir selesai; rollback per-baris.
- Login vendor: contoh "Cecep" dihapus. Redaksi subjudul, urutan kolom (sempat tertukar Status/Halaman di versi mobile -- diperbaiki),
  tombol aksi satu baris.

## Upload Invoice Supplier di Paying Voucher -- migration 0064 (2026-10-06)
Owner: "upload invoice dari supplier ... nama warna di invoice beda dengan di MRP ... tidak ingin ada selisih".
Di wizard Buat PV (Procurement) muncul pilihan **Upload invoice KNITTO** / **Input manual** (hanya untuk supplier
yang punya adapter, `lib/invoice-import/adapters.ts`; supplier lain tetap manual). Alur: PDF dibaca DI BROWSER
(text layer / OCR Tesseract -- aset di `public/invoice-ocr/`, publik di proxy.ts) -> parser KNITTO
(`lib/invoice-import/parser-knitto.ts`, port converter mandiri) -> **pemetaan warna** invoice -> warna MRP
(`mapping.ts`; cocok persis/alias tersimpan = otomatis, nama mirip = wajib klik Konfirmasi, tak dikenal = diblokir) ->
rekonsiliasi per warna (Total PO / Sudah PV / Invoice ini / Sisa) -> isi form PV (tetap bisa diedit, submit =
`bookInvoiceAction` yang sama). Invoice bertahap didukung (roll tiap warna dibatasi sisa PO; sisa menunggu invoice
berikutnya). Cek silang: Total PV = Total Bayar invoice, jumlah/berat roll & rib = Total Roll-an/KG-an, nomor invoice ganda (nama file
NOINVOICE.KODETRANSAKSI.pdf; vendor tujuan mengikuti PO yang dibuka, tidak dibaca dari nama file). File invoice jadi lampiran PV (maks ~1,4 MB).
**Migration 0064** (`supplier_color_aliases`): ingatan pemetaan nama warna per supplier -- OPSIONAL, fitur tetap jalan
tanpanya (hanya tidak teringat untuk invoice berikutnya). Jalankan MANUAL di SQL Editor. Tes logika:
`node scripts/invoice-import-test/run.mjs` (fixture dummy, tanpa data invoice asli).

## Koreksi Sysadmin tambahan (2026-10-06, tanpa migration baru)
Owner: "apa semua proses sudah bisa dikoreksi Sysadmin? mis. Procurement salah input invoice ... kerjakan semua".
Semua pakai pola yang sama (registry components/sysadmin/*-corrections.ts + SysadminActionsBar, alasan wajib,
log audit, notifikasi). Baru: **Batalkan invoice material** (sysadminVoidMaterialInvoiceAction -- kebalikan
bookInvoiceAction, hanya status INVOICED & belum ada roll diterima), **Mundurkan tahap klaim material**
(sysadminRevertClaimStageAction -- TIDAK mencakup tahap PV pengganti ke atas, terikat ledger deposit),
**Hapus entri saldo deposit** (sysadminDeleteDepositEntryAction), **Batalkan invoice vendor produksi**
(sysadminVoidVendorInvoiceAction -- grup resi asal dicari lewat kecocokan isi invoice, ditolak kalau tidak
pasti 1), **Buka lagi PO Produksi** dan **Mundurkan status produksi** (sysadminReopenMaklonPoAction,
sysadminRevertMaklonProductionStepAction). Belum ada: pindah vendor Aduan Pola, pilihan supplier/entitas
per warna (Procurement masih bisa membalik sendiri / Tarik kembali PO).


## Sysadmin "Lihat Password" -- migration 0063 (2026-10-06)
`supabase/migrations/0063_password_enc.sql`: kolom `password_enc` (salinan password TERENKRIPSI
AES-256-GCM, kunci dari `SESSION_SECRET`, lihat `lib/auth/password-vault.ts`) di `internal_accounts`,
`internal_role_users`, `vendors_produksi`. Owner: "sysadmin bisa melihat password terbaru dari semua
modul akun ... ada user yang tanya apa passnya". Login TETAP bcrypt (`password_hash`, tidak berubah).
Salinan diisi di setiap jalur ganti password: Sysadmin (set/reset/tambah akun) dan Profil Saya
(ganti sendiri). Tombol "Lihat Password" di Sysadmin > Akun & Password (modul, akun bernama, vendor),
tiap tampil tercatat di `sysadmin_audit_log` (REVEAL_PASSWORD, tanpa isi password). Penyimpanan salinan
BEST-EFFORT & terpisah dari update hash -- kode aman kalau migration belum jalan. Akun yang passwordnya
di-set SEBELUM ini (dan password modul dari env var) tampil "belum tersimpan" sampai di-reset sekali.
Mengganti `SESSION_SECRET` membuat salinan lama tidak terbuka lagi (reset password akunnya).
Akun tim vendor (`vendor_users`) belum ikut -- tidak ditampilkan di Sysadmin.
**Owner menjalankan migration manual di SQL Editor Supabase.**

## Alih size sisa kain saat Cutting -- migration 0062 (2026-10-04)
Owner: kalau roll target L 100 hanya jadi 99 L tapi sisa kain muat 1 pcs size lebih kecil, operator boleh
mengalihkannya (99 L + 1 M, tanpa waste). BUKAN rework (tidak ada reject, tidak lewat alur Rework FG); opsional --
kalau tidak diisi, flow lama persis (selisih tidak jadi apa-apa). Tidak perlu approval; infonya tampil di Monitoring
Produksi internal. `supabase/migrations/0062_production_batch_size_shifts.sql`: kolom `production_batches.size_shifts`
(jsonb, `[{from,to,qty}]`) -- HANYA penanda; qty resmi tetap di `production_batch_sizes` (sizeQty), jadi FG/Tutup Roll/
HPP/yield tidak berubah. **Owner menjalankan migration manual.** Kode aman kalau terlambat (kolom hanya ditulis saat
alih size dipakai; error jelas "jalankan migration 0062"). Aturan (UI `production-cutting-tab.tsx` + server
`validateSizeShifts` di actions.ts): hanya ke size LEBIH KECIL (`SIZE_ORDER`), qty <= kekurangan hasil size asal terhadap
target, pcs tujuan harus ada di hasil cutting. Monitoring (`vendorItemSizeProgress`) kini juga menampilkan size di luar
rencana (target 0) + info `sizeShiftsForGroup`. Sysadmin "Batalkan cutting" ikut mengosongkan penanda.


## Input Hasil Cutting boleh melebihi target MRP (2026-09-30, tanpa migration)
Owner: "di lapangan bisa input cutting lebih dari target yang diberikan, jangan set maks, tapi fungsi tombol Maks
dan naik-turun satu angka tetap dipertahankan". `SizeQtyControl` (`components/mrp/size-qty-control.tsx`) dapat prop
`allowExceed`: `max` jadi TARGET, bukan batas -- ketikan dan tombol ▲ boleh melampauinya (kelebihan ditandai "+N"),
tombol "Maks" tetap mengisi sebesar target, ▼/▲ tetap +-1. Dipakai HANYA di modal Input Hasil Cutting
(`production-cutting-tab.tsx`); "Edit FG" (`production-result-panel.tsx`) tetap dibatasi (FG tidak boleh melebihi
hasil cutting, juga ditegakkan server di `editRollFgImpl`). Server tidak pernah membatasi hasil cutting terhadap
target (hanya UI yang membatasi), jadi tidak ada perubahan server. Yield per roll bisa >100%; batas yang sudah ada
di turunan (persentase progres dikunci 100%, dst.) aman.

## Toleransi selisih berat di Master Data SCM -- migration 0061 (2026-09-30)
Owner: "toleransi ditambahkan di master data SCM ... berlaku di semua vendor produksi ... sekarang ganti jadi 8%".
Sebelumnya konstanta 2% di `derive.ts`. Sekarang: angka (%) diatur role SCM di halaman baru **SCM > Master Data**
(`/scm/master-data`, `components/scm/weight-tolerance-panel.tsx`), SATU angka untuk SEMUA vendor produksi, default
**8**. `supabase/migrations/0061_weight_tolerance_setting.sql`: tabel `app_number_settings` (key/value NUMERIC --
`app_settings` migration 0052 hanya boolean) + baris `weight_tolerance_pct` = 8 + trigger penanda perubahan data
(migration 0049). **Owner menjalankan migration manual di SQL Editor.** Kode aman kalau belum dijalankan: jatuh ke
default 8 yang sama; tombol Simpan akan menjawab "jalankan migration 0061 dulu".
Cara kerja: `derive.ts` menyimpan toleransi AKTIF di variabel modul (`getWeightTolerancePct`/`setWeightTolerancePct`)
-- `weightVariance(gross, net, tolerancePct?)` & `materialClaimsList(invoices, tolerancePct?)` memakainya, jadi
puluhan pemanggil lama tidak diubah. Browser mengisinya dari `getFlowSnapshotAction` (field `weightTolerancePct`,
dipasang di `store.refresh` SEBELUM state di-set); server membacanya segar dari database di awal aksi yang memakainya
(`loadWeightTolerancePct`, `lib/mrp/weightToleranceServer.ts`): `receiveRawMaterialRollAction`,
`confirmRollWeighAction`, `fetchOneInvoiceForClaims`, `sysadminSetBatchNetWeightAction`. PENEGAKAN: server menolak
menyimpan berat bersih yang lebih ringan dari toleransi tanpa klaim (kecuali bahan migrasi/supplier sintetis).
Simpan = `setWeightTolerancePctAction` (hanya SCM, tercatat di internal_action_log, notifikasi ke Procurement & semua
vendor). Panel menampilkan SIMULASI DAMPAK sebelum simpan (klaim yang hilang / roll yang baru jadi klaim) dan
MEMBLOKIR kalau ada klaim yang sedang diproses (diterima/PV pengganti/retur) yang akan berubah status, karena klaim
diturunkan LIVE dari berat tersimpan vs toleransi -- mengubah angka memengaruhi roll yang SUDAH ditimbang. Sysadmin
hanya melihat (aksi ditolak server untuk non-SCM).

## Sysadmin: sidebar bertumpuk + lihat semua modul + notifikasi koreksi (2026-09-29, tanpa migration baru)
Owner: Sysadmin "punya akses ke semua modul ... sidebar seperti modul lain tapi di-stack ... hanya bisa
melihat dan mengoreksi ... jangan ada conflict sidebar jadi procurement saja saat masuk modul".
- **Mode Sysadmin** (`components/shell/app-shell.tsx`, `sysadminMode`): aktif kalau sesi punya Sysadmin
  terbuka DAN halaman yang dibuka halaman modul internal. Identitas shell (sidebar bertumpuk, topbar,
  Profil Saya, Logout) SELALU Sysadmin, apa pun `role` halaman -- `role` hanya menentukan ISI halaman.
  Logout di mode ini hanya mengeluarkan Sysadmin. Portal vendor produksi TIDAK ikut (shell-nya tetap
  shell vendor); melihat portal vendor dari Sysadmin butuh pemilih vendor -- belum dikerjakan.
- **Akses lihat saja**: `proxy.ts` meloloskan Sysadmin ke semua route modul internal, TAPI Server Action
  transaksi tetap `requireInternalRole(role)` -> ditolak (pesan jelas di `lib/auth/session.ts`). Tiga
  getter foto/bukti (bukti bayar, foto ekspedisi, foto klaim) ikut mengizinkan Sysadmin (baca saja).
  Auto-import Master Data di AppShell dilewati di mode Sysadmin (tidak menulis apa pun).
- **Sidebar bertumpuk**: `sysadminNavGroups()` (`lib/shell/nav.ts`) mengambil menu dari `NAV[role]` tiap
  modul (bukan salinan) -- menu baru otomatis ikut. Grup yang memuat halaman aktif otomatis terbuka saat halaman dibuka tapi boleh ditutup manual; menu Dashboard & Master Data tiap modul TIDAK dipasang di sidebar ini (revisi 2026-09-30); grup
  lain ingat pilihan user (localStorage `sidebar-open-groups-v1`). Badge = gabungan semua modul.
- **Notifikasi**: lonceng navbar sekarang tampil di semua modul internal (dulu hanya vendor produksi).
  Aksi koreksi Sysadmin yang sudah ada (batalkan PO Material/Produksi, tarik PO Material, mundurkan
  approval, batalkan Delivery invoice) menulis notifikasi ke modul/vendor terdampak
  (`notifyAffected`, `lib/mrp/sysadminActions.ts`, best-effort -- gagal notifikasi tidak menggagalkan
  koreksi). Mode Sysadmin tidak menampilkan lonceng (tidak ada notifikasi yang ditujukan ke Sysadmin).
- **Identitas aktif (perbaikan 2026-09-30)**: satu browser boleh menyimpan beberapa sesi sekaligus
  (cookie sesi dipakai bersama), jadi `useInternalAuthStore.activeIdentity` mencatat login TERAKHIR
  (role internal atau "vendor"). Mode Sysadmin (`isSysadminActive`) hanya aktif kalau identitas
  aktifnya Sysadmin -- sebelumnya sesi Sysadmin yang lupa di-logout membuat portal vendor yang baru
  login tampil sebagai Sysadmin (bug report owner). Login modul/vendor lain memindahkan identitas;
  membuka halaman milik Sysadmin (bookmark) mengembalikannya. `proxy.ts` tidak lagi membuka
  pembatasan halaman anggota tim vendor hanya karena ada sesi Sysadmin di browser yang sama.
- **Tahap 3 -- koreksi langsung di halaman Procurement** (mode Sysadmin saja; tombol dari
  `components/sysadmin/`): halaman Purchase Order (tab PO Material: Tarik kembali / Mundurkan approval /
  Batalkan; tab PO Produksi: Mundurkan approval / Batalkan) dan Material Tracking (detail batch:
  Kembalikan Delivery + tabel koreksi code lot/code roll per roll, aksi baru
  `sysadminSetRollCodeAction`). Semua lewat `CorrectionDialog`: tampil dampak, alasan wajib, aksi
  permanen wajib ketik ulang No. PO; setelah sukses masuk Log Audit + notifikasi ke modul terdampak.
  Aturan boleh/tidak di UI hanya cermin -- server (`sysadminActions.ts`) yang memutuskan. Code roll
  hanya bisa diubah kalau roll sudah diterima & belum ditimbang; code lot bebas (label saja).
  Belum dikerjakan: Paying Voucher, Klaim Material, Master Data.
- **Revisi 2026-09-30 (sidebar)**: grup Sysadmin paling atas & di-highlight ungu ("UTAMA"), grup Vendor Produksi oranye (mengikuti warna kartu di halaman login); menu
  "Batalkan PO" & "Kembalikan Data" dihapus dari sidebar (koreksinya sekarang tombol di halaman modul;
  halaman lamanya `/sysadmin/po` & `/sysadmin/invoice-status` masih ada lewat URL).
- **Tahap 3 -- modul Vendor Produksi (2026-09-30)**: Sysadmin ikut melihat portal vendor. Portal vendor
  dibangun per-vendor, jadi Sysadmin MEMILIH vendor yang dilihat (`useSysadminVendorStore`, dropdown di
  spanduk Mode Sysadmin / layar pilih vendor) -- `VendorAuthGuard` memberi `vendorId` pilihan itu kalau
  Sysadmin terbuka, `proxy.ts` meloloskan Sysadmin ke `/vendor-maklon/*`, shell (sidebar bertumpuk,
  topbar, logout) tetap milik Sysadmin di halaman vendor. Grup sidebar baru "Vendor Produksi" (tanpa
  "Tim Saya"). Aksi transaksi vendor tetap ditolak (`requireVendorSession` butuh `session.vendorId`).
  Koreksi pertama: Good Receive -- "Batalkan terima" per roll (`sysadminUndoRollArrivalAction`; diblokir
  kalau roll sudah ditimbang atau PO Produksi vendor sudah mulai produksi) + tabel koreksi code lot/roll.
  Belum: Cutting (berat timbang), Produksi, Pengiriman, Invoice & Payment vendor.
- **Tahap 3 -- Vendor Produksi: Reject/Rework & Invoice vendor (2026-09-30)**: (1) Riwayat rework --
  "Batalkan rework" (`sysadminUndoReworkAction`): reworkRejectSizeAction menulis SEPASANG
  production_results (REJECT negatif di grup asal + FG di grup tujuan, menit yang sama) tanpa kolom
  penaut, jadi pasangan dicari lewat recorded_at + isi note + size/qty yang cocok; kalau tidak ketemu
  pasti DITOLAK (tidak menebak). Ditolak juga kalau grup asal/tujuan Final Produksi atau hasil rework
  sudah masuk koli (item kind REWORK). (2) Tampilan Reject: tombol "Buka lagi" roll diganti padanan
  Sysadmin (aksi sama dengan Finish Good). (3) Procurement > Invoice Vendor: "Kembalikan ke menunggu
  review" (`sysadminRevertVendorInvoiceStatusAction`, APPROVED/REVISION -> SUBMITTED; PAID harus
  dibatalkan dulu di Finance) dan "Hapus" item denda/reward (`sysadminDeleteVendorInvoiceAdjustmentAction`,
  hanya selagi belum disetujui). TIDAK ada "batalkan/hapus invoice": invoice REVISION sudah dilepas dari
  hitungan invoiced (invoicedQtyByMrp) lewat alur Revisi bawaan, dan invoice tidak menyimpan koli mana
  yang ditagihkan -- penelusuran balik ke `resi_invoiced_at` tidak tegas.
- **Tahap 3 -- Vendor Produksi: Pengiriman (2026-09-30)** (halaman Pengiriman, `vendor-corrections.ts`):
  vendor TIDAK bisa membatalkan resi yang salah setelah terkirim dan tidak bisa menghapus koli -- dua
  koreksi Sysadmin mengisi celah itu. (1) "Batalkan pengiriman" di header grup Riwayat pengiriman
  (`sysadminUndoKoliShipmentAction`): SEMUA koli satu grup resi kembali ke "belum ada ekspedisi"
  (delivered_at/berat/ekspedisi/no_resi/resi_group_id/catatan dikosongkan; foto lampiran lama tidak
  dihapus) supaya vendor mengulang Set Ekspedisi & Resi; DITOLAK kalau ada koli yang sudah diinvoice
  (`resi_invoiced_at`), sudah dibongkar Warehouse, atau sudah dikonfirmasi WMS; wajib ketik ulang No.
  Resi. (2) "Hapus koli" untuk koli yang belum dikirim (`sysadminDeleteKoliAction`, isi tercatat di Log
  Audit, isi dipulihkan otomatis kalau penghapusan induk gagal). TIDAK ada koreksi "batalkan submit
  invoice": tabel vendor_invoices tidak menyimpan koli mana yang ditagihkan (hanya baris
  warna/lengan/qty), jadi penelusuran baliknya tidak pasti -- pakai alur Revisi invoice di Procurement.
- **Tahap 3 -- Vendor Produksi: Finish Good & Final Produksi (2026-09-30)**: vendor SUDAH punya undo
  sendiri (Buka lagi roll, Buka kunci FG, Buka kunci Final) dengan pengaman ketat, jadi Sysadmin
  melakukan LANGKAH YANG SAMA atas nama vendor -- inti fungsinya dipakai bersama
  (`reopenProductionBatchCore`, `undoFgConfirmCore` hasil refaktor di actions.ts, tidak diduplikasi)
  sehingga aturan pengamannya persis sama; ditambah alasan wajib, Log Audit, notifikasi vendor.
  Aksi: `sysadminReopenRollAction`, `sysadminUndoFgConfirmAction`, `sysadminUndoFinalAction` (ada di
  actions.ts karena inti tidak di-export). Beda dari versi vendor: "Buka kunci Final" Sysadmin ditolak
  kalau PO Produksi sudah ditutup (Close PO). Tombol: tab Finish Good (header grup "Buka kunci Finish
  Good", baris roll "Buka lagi") dan tab Final Produksi ("Buka kunci Final"); tombol vendor
  disembunyikan di Mode Sysadmin. Kalau ditolak karena reject sudah dirework/dibuang atau roll sudah
  masuk koli -> koreksi Rework / Pengiriman dulu (belum dikerjakan). "Edit FG" & "Tutup Roll" tidak
  punya padanan Sysadmin (vendor mengedit sendiri setelah Sysadmin membuka).
- **Tahap 3 -- Vendor Produksi: Cutting (2026-09-30)** (`components/sysadmin/batch-corrections.tsx`, tab
  Cutting -> "Lihat roll" per roll): (1) "Batalkan resting" (hapus batch belum-dicutting, roll kembali ke
  pool resting -- `sysadminUndoRestingAction`), (2) "Batalkan cutting" (cutting_at kosong + hapus hasil
  per size + hapus resolusi yield alert -- `sysadminUndoCuttingAction`), (3) "Koreksi berat" (net_kg
  roll fisik, ditelusuri lewat pencocokan code_roll seperti submitCuttingDefectClaimAction --
  `sysadminSetBatchNetWeightAction`). Semua HANYA untuk roll yang belum ditutup, belum punya
  progres/hasil Finish Good, belum masuk koli, dan grupnya belum Selesai/Final (`loadBatchUntouchedByFg`).
  Koreksi berat ditolak kalau berat baru masuk klaim selisih berat (butuh foto + alur retur), atau roll
  punya klaim cacat fisik/retur, atau code_roll tidak unik. Belum: Finish Good/Reject/Rework/Final,
  Pengiriman, Invoice & Payment vendor.
- **Tahap 3 -- modul Produksi (2026-09-30)** (`components/sysadmin/produksi-corrections.ts`): halaman
  Monitoring Produksi, Monitoring Reject, dan Kebutuhan Bahan read-only -- satu-satunya aksi tulis di
  modul ini adalah Yield Alert, jadi koreksinya cuma di sana: "Buka lagi" alert yang sudah ditindak
  (`sysadminReopenYieldAlertAction`, hapus baris `production_yield_resolutions`; catatan lama masuk Log
  Audit). Di Mode Sysadmin tombol "Buka lagi"/"Tandai ditindak" milik Produksi disembunyikan (server
  menolak Sysadmin). Koreksi data produksi sebenarnya (Cutting/Finish Good/dst.) ada di portal Vendor
  Produksi -- belum dikerjakan.
- **Tahap 3 -- modul SCM (2026-09-30)**: (1) Approval MRP -- tabel Riwayat: "Mundurkan approval SCM" /
  "Ajukan ulang ke SCM" per MRP (`mrpApprovalCorrections`, dipisah dari `mrpCorrections` PPIC supaya
  dipakai bersama; aksi server sama `sysadminRevertMrpApprovalAction`). (2) Approval PO -- tombol
  Sysadmin (Tarik kembali / Mundurkan approval / Batalkan, dari `materialPoCorrections` &
  `maklonPoCorrections`) dipasang di `PoApprovalQueue`, komponen antrean yang DIPAKAI BERSAMA
  Procurement (tab "Approval PO Saya"), SCM, dan GM -- jadi satu titik ini menutup ketiganya
  (menutup juga celah tab approval Procurement yang dicatat di tahap Procurement). Halaman
  Monitoring SCM read-only, tidak ada koreksi.
- **Tahap 3 -- modul PPIC (2026-09-30)** (`components/sysadmin/ppic-corrections.ts`, halaman MRP): kolom
  Aksi -- "Mundurkan approval SCM" / "Ajukan ulang ke SCM" (MRP PPIC_APPROVED/REJECTED -> menunggu
  approval; PPIC_APPROVED hanya kalau belum ada PO; `sysadminRevertMrpApprovalAction`) dan "Hapus MRP"
  (`sysadminDeleteMrpAction` di actions.ts, memakai `resetMrpCore` hasil refaktor resetMrpAction --
  validasi lintas-MRP & urutan hapus tidak berubah). Hapus MRP versi Sysadmin punya PENGAMAN jejak
  uang/fisik: ditolak kalau invoice material sudah dibayar/berjalan, produksi jalan, ada koli, ada
  riwayat klaim, invoice vendor/maklon disetujui/dibayar, atau ada pemakaian deposit -- mundurkan dulu
  lewat tombol koreksi modul terkait. Tombol "Reset MRP" bawaan PPIC disembunyikan di Mode Sysadmin.
- **Tahap 3 -- modul Warehouse (2026-09-30)** (`components/sysadmin/warehouse-corrections.ts`): Riwayat
  Penerimaan -- "Batalkan bongkar koli" per penerimaan (`sysadminUndoWarehouseReceiptAction`): menghapus
  warehouse_receipts + koli + item supaya resi muncul lagi di Penerimaan dan bisa dibongkar ulang
  (snapshot `hpp_per_item` BARU dari HPP live saat itu). Wajib ketik ulang No. Resi; data lama tersimpan
  di Log Audit; penghapusan anak-lalu-induk dipulihkan otomatis kalau gagal di tengah. Warehouse,
  Finance, Produksi diberi notifikasi. Tidak ada koreksi di halaman Penerimaan (yang belum dibongkar
  tidak ada yang perlu dikembalikan).
- **Tahap 3 -- modul Finance** (`components/sysadmin/finance-corrections.ts`): Payment Material
  (detail invoice: Batalkan pembayaran PAID->INVOICED, plus varian "pulihkan deposit" kalau ada deposit
  yang terpotong untuk invoice itu; PV pengganti klaim DITOLAK karena terikat ledger klaim), Payment
  Maklon (invoice vendor per pcs: PAID->APPROVED; Bongkar Koli Warehouse yang sudah terjadi tidak
  dibatalkan), Invoice Maklon FOB (PAID->APPROVED + PO kembali DELIVERY, APPROVED->SUBMITTED; CMT
  arsip tidak didukung), dan PO Material disetujui (Tarik kembali/Batalkan). Aksi server:
  `sysadminRevertMaterialInvoicePaidAction`, `sysadminRevertVendorInvoicePaidAction`,
  `sysadminRevertMaklonInvoiceAction`. Belum: mundurkan approval di antrean Finance (bisa dari halaman
  Purchase Order Procurement), halaman Saldo Deposit (tombol Hapus-nya sudah dihilangkan dari UI).

## Multi-user per modul internal + atribusi approval -- migration 0060 (2026-09-29)
`supabase/migrations/0060_internal_role_users.sql`: tabel `internal_role_users` (akun anggota tim
per modul internal -- PPIC/Procurement/Finance/SCM/GM/Produksi/Warehouse/Sysadmin, username unik
se-aplikasi, TIDAK ada picker halaman -- akses selalu PENUH ke role itu, sama seperti akun utama;
BEDA dari vendor_users yang punya allowed_pages) + `internal_action_log` (jejak "siapa klik apa",
pola sama vendor_action_log). Owner: "procurement ternyata ada dua orang, fulan dan fulin ... biar
tau siapa PIC-nya" -- pola PERSIS migration 0057 (vendor_users), diterapkan ke SEMUA modul internal
sekaligus, bukan cuma satu.

Login: **Revisi 2026-09-29 (owner tolak model berjenjang)** -- modal login modul internal
(app/page.tsx) SEMPAT punya toggle "Akun Utama"/"Anggota Tim" (commit `c1704fa`), tapi owner minta
model FLAT ("procurement1"/"procurement2", akses sama, tanpa toggle) -- sekarang cuma SATU form:
Username (opsional) + Password. Submit coba `login()` (akun utama) dulu, kalau username diisi
dicoba `loginUser()` (`loginInternalUserAction`, lib/auth/actions.ts) juga. Sesi cookie internal
bawa `internalActors` per-role (lib/auth/session.ts, `InternalActor`) -- role yang login lewat akun
utama TIDAK punya entri di situ (fallback ke label modul, mis. "Procurement"). Login Vendor Produksi
(app/vendor-maklon/login) direvisi sama persis di hari yang sama.

Atribusi: `PoApprovalEntry.actorName` (lib/mrp/poApproval.ts, field opsional -- entri lama sebelum
migration ini TIDAK punya field ini, jsonb jadi tidak perlu migrasi data) diisi lewat
`requireInternalRoleWithActor`/`recordApprovalStep` di SEMUA jalur approve PO Material & PO Maklon
(approvePoStepAction/rejectPoStepAction, approveMaterialPoAction, approveMaklonPoAction,
approveAllMaterialPosAction, approveVendorMaterialPosAction, approveMaterialPosByIdsAction) --
ditampilkan di "Riwayat approval" (components/mrp/po-approval-queue.tsx). Titik aksi LAIN (bukan
approval PO) belum ikut mencatat ke `internal_action_log` -- bisa menyusul tanpa migration baru
kalau dibutuhkan (helper `logInternalAction` sudah ada, lib/mrp/actions.ts).

Kelola akun (Sysadmin): "Akun & Password" (app/sysadmin/accounts/page.tsx) **direstrukturisasi
2026-09-29** jadi 2 sub-tab (pola `Tabs` sama dengan PO Approval Finance) -- "Akun Internal" (pilih
modul lewat chip dulu, baru kelola: baris Password Modul/env var + tabel Akun Login khusus modul
itu, bisa tambah akun kedua dst di modul yang sama) dan "Akun Vendor Produksi" (tabel vendor, tidak
berubah). Tabel flat lama ("Anggota Tim Vendor Produksi" jalur darurat & "Akun Login Modul Internal
(Multi-User)") dihapus dari tampilan. Ini SATU-SATUNYA jalur ADMIN (tambah/reset password
paksa/nonaktifkan/hapus akun siapa saja) -- WAJIB alasan, tercatat ke `sysadmin_audit_log`.

Profil Saya (self-service, BEDA dari jalur Sysadmin di atas): owner 2026-09-29 "akun dari tiap
modul itu bisa lihat akun profile ... username, Full Name, Password. Dan bisa edit itu" --
`lib/mrp/internalProfileActions.ts` (`getMyInternalProfileAction`/`updateMyInternalProfileAction`)
+ `components/shell/my-profile-modal.tsx`, dipicu dari menu "Profil Saya" di dropdown topbar
(components/shell/topbar.tsx, AppShell). HANYA muncul untuk akun yang login lewat username sendiri
(`internalActor` ada di sesi) -- akun utama tidak punya baris personal untuk diedit lewat sini.
Ganti password WAJIB password saat ini dicocokkan dulu di server (tidak butuh alasan, ini
self-service bukan aksi admin darurat). Nama baru baru tampil di topbar setelah logout+login ulang
(nama dibaca dari token sesi, bukan query ulang tiap request) -- keterbatasan yang sama seperti
vendor_users, bukan bug baru.

**Owner menjalankan migration manual di SQL Editor Supabase.** Kode aman kalau migration belum
jalan: login akun utama semua modul TIDAK berubah sama sekali; login "Anggota Tim" & bagian
"Anggota Tim Modul Internal" di Sysadmin baru bisa dipakai setelah tabelnya ada (sebelum itu,
listInternalRoleUsersAction gagal dengan pesan error yang ditangkap normal, TIDAK meng-crash
halaman Akun & Password -- bagian lain di halaman itu tetap tampil).

## Sub-izin Produksi + picker izin baru (2026-09-28, tanpa migration baru)
Izin akun tim vendor (migration 0057) sekarang bisa dipecah SAMPAI KE TAB dalam modul "Produksi"
(Cutting, Finish Good, Reject, Rework, Final Produksi) -- bukan cuma "boleh/tidak" 1 halaman utuh.
Format key: modul biasa tetap `/vendor-maklon/xxx`; modul Produksi punya sub-key
`/vendor-maklon/production:CUTTING` dst (lihat lib/mrp/vendorPages.ts -- VENDOR_MODULE_TREE,
vendorHasPageAccess, vendorAllowedSubTabs). Akun lama yang masih tersimpan sebagai key bare
`/vendor-maklon/production` (dibuat SEBELUM revisi ini) tetap valid & dianggap akses PENUH ke
semua tab -- tidak perlu migrasi data. Tampilan pilih izin di "Tim Saya" & Sysadmin diganti total
(components/mrp/vendor-permission-picker.tsx): modul di kiri + badge "x/y", panel sub-izin di
kanan dengan Select All/Deselect All, pencarian, "N dari M dipilih".

## Tim Vendor Produksi (Sub-user) -- migration 0057 (2026-09-27)
`supabase/migrations/0057_vendor_users.sql`: tabel `vendor_users` (akun anggota tim per vendor produksi --
cutting/finish good/packing/dst, username unik se-aplikasi, login TIDAK perlu pilih nama vendor dulu, `allowed_pages`
= daftar halaman portal yang boleh diakses, FLEKSIBEL dipilih sendiri oleh admin vendor, bukan preset peran tetap) +
`vendor_action_log` (jejak "siapa klik apa": Mulai Resting, Tutup Roll, Good Receive, Buat Koli, Set Ekspedisi & Resi
-- lihat requireVendorSessionWithActor/logVendorAction di lib/mrp/actions.ts). Dikelola vendor SENDIRI dari menu baru
"Tim Saya" (`/vendor-maklon/team`, hanya untuk akun utama -- proxy.ts + server action menutup akses sub-user ke
halaman ini). Login sub-user: toggle "Anggota Tim" di halaman login vendor (username + password, terpisah dari
"Akun Utama" yang ketik nama vendor). Sidebar & proxy.ts membatasi sub-user ke `allowed_pages` saja. Logika:
`lib/mrp/vendorTeamActions.ts`. **Owner menjalankan migration manual di SQL Editor.** Kode aman kalau migration
belum jalan (akun utama vendor tetap login & akses penuh seperti biasa; menu "Tim Saya"/login "Anggota Tim" baru
bisa dipakai setelah tabelnya ada).

## Modul Sysadmin -- migration 0056 (2026-09-27)
`supabase/migrations/0056_sysadmin.sql`: tabel `internal_accounts` (password 7 modul internal PPIC/Procurement/
Finance/SCM/GM/Produksi/Warehouse, DIPINDAH dari env var ke bcrypt hash di DB -- login FALLBACK ke env var lama
selama Sysadmin belum set password di DB untuk role itu, lihat loginInternalAction di lib/auth/actions.ts) +
`sysadmin_audit_log` (riwayat permanen semua aksi Sysadmin: ganti/reset password, batalkan PO -- alasan wajib,
snapshot before/after, read-only dari UI). Portal baru `/sysadmin/accounts` (kelola & reset password akun internal
+ vendor produksi), `/sysadmin/po` (batalkan PO Material/Produksi, WAJIB alasan + ketik ulang No. PO untuk
konfirmasi -- TIDAK membongkar roll/invoice yang sudah tercatat), `/sysadmin/audit-log`. Logika: `lib/mrp/
sysadminActions.ts`. **Owner menjalankan migration manual + tambah env var `INTERNAL_PASSWORD_SYSADMIN`** (password
login Sysadmin) di `.env.local` + Vercel. Kode aman kalau migration belum jalan (login modul lain tetap pakai env
var seperti biasa; portal Sysadmin sendiri baru bisa diakses setelah `INTERNAL_PASSWORD_SYSADMIN` diisi & migration
jalan, karena butuh tabel `internal_accounts`/`sysadmin_audit_log`).

## Matriks Approval PO + portal General Manager -- migration 0055 (2026-09-26)
`supabase/migrations/0055_po_approval_matrix.sql`: kolom `approval_level`, `approval_log` (jsonb), `approval_submitted_at` di
`material_pos` & `maklon_pos`. Level 1-4 dari NILAI PO (<=2jt / <=50jt / <=200jt / >200jt), berlapis berurutan:
L1 = pengajuan Procurement (otomatis), L2 = portal Procurement (menu "Approval PO"), L3 = Finance (FAT Manager) + SCM
(keduanya), L4 = portal General Manager BARU (`/gm/dashboard`, `/gm/approval-po`). Ditolak -> kembali ke Procurement,
diajukan ulang. PO lama (approval_level kosong) tetap alur lama (1 approval Finance). Logika: `lib/mrp/poApproval.ts`.
**Owner menjalankan migration manual di SQL Editor** DAN menambah env var **`INTERNAL_PASSWORD_GM`** (password login GM) di
`.env.local` + Vercel (Production). Nomor 0055 (bukan 0053) karena draf migration "stok awal" sempat memakai 0053/0054.
Selain itu: download PO bisa PDF atau Excel (`lib/mrp/exportPoExcel.ts`), dan alat "Migrasi Data Awal" Konveksi Makassar
(tab Master Data PPIC > Migrasi Data, `lib/mrp/parseMigrationImport.ts`, template di `public/templates/`).

## Hemat egress tahap 2 -- migration 0050 (2026-09-21)
`supabase/migrations/0050_master_data_version.sql`: versi khusus 6 tabel master harga (harga_maklon, harga_kain,
harga_kain_pks, harga_rib, harga_kerah_manset, item_selling_prices) + RPC `get_flow_snapshot_core()` (snapshot tanpa
tabel itu). `getFlowSnapshotAction(clientMasterVersion)` hanya menarik master kalau versinya berbeda; sesi vendor
murni tidak pernah menarik master. **Owner menjalankan manual.** Aman kalau belum jalan (snapshot penuh seperti dulu).
Rollback: "kembalikan hemat egress".

## Hemat egress -- migration 0049 (2026-09-21)
`supabase/migrations/0049_data_version.sql` menambah sequence + trigger tingkat-statement di semua tabel `public` dan
fungsi `get_data_version()`. Dipakai `refreshIfChanged()` (lib/mrp/store.ts) supaya fokus-tab tidak menarik snapshot
penuh kalau tidak ada tulisan baru. **Owner menjalankan manual di SQL Editor.** Kode aman kalau migration belum jalan
(otomatis ambil snapshot penuh seperti dulu). Tabel BARU di masa depan: jalankan ulang blok `do $$ ... $$` di file itu.
Rollback: keyword "kembalikan hemat egress" (commit ber-prefix `[hemat-egress]`, baseline `19ad97e`).

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
