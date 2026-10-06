-- 0063 (2026-10-06, owner: "saya ingin sysadmin bisa melihat password terbaru dari semua modul akun ...
-- takutnya ada user yang tanya apa passnya ini ke saya jadi saya bisa kasih") -- salinan password
-- TERENKRIPSI (AES-256-GCM, kunci dari SESSION_SECRET server, lihat lib/auth/password-vault.ts)
-- supaya Sysadmin bisa menampilkannya lewat tombol "Lihat Password" (tercatat di sysadmin_audit_log).
-- Login TETAP memakai password_hash (bcrypt) -- kolom ini murni tambahan, tidak dipakai login.
-- Baris yang SUDAH ada tetap NULL sampai passwordnya di-set/di-reset/diganti sekali lagi.
alter table public.internal_accounts add column if not exists password_enc text;
alter table public.internal_role_users add column if not exists password_enc text;
alter table public.vendors_produksi add column if not exists password_enc text;
