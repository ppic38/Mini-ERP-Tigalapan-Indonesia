# Migrasi Project — Status & Riwayat

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
