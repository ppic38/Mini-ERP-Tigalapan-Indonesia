-- 0065 (2026-10-08, owner: "bisa tampilkan password user dari Tim Saya") -- salinan password TERENKRIPSI
-- (AES-256-GCM, kunci dari SESSION_SECRET, lihat lib/auth/password-vault.ts) untuk akun anggota tim
-- vendor produksi, supaya akun utama vendor bisa menampilkannya di halaman Tim Saya (tombol mata).
-- Login TETAP memakai password_hash (bcrypt) -- kolom ini murni tambahan, tidak dipakai login.
-- Anggota tim yang SUDAH ada tetap NULL sampai passwordnya di-reset sekali lagi lewat Edit.
alter table public.vendor_users add column if not exists password_enc text;
