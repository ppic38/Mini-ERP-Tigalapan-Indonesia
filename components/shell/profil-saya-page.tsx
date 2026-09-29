"use client";

import { useEffect, useState } from "react";
import { AppShell } from "@/components/shell/app-shell";
import { Button } from "@/components/ui/button";
import { getMyInternalProfileAction, updateMyInternalProfileAction } from "@/lib/mrp/internalProfileActions";
import type { InternalRole } from "@/lib/internal-auth";

/** "Profil Saya" -- owner 2026-09-29: "buat untuk akun dari tiap modul itu bisa lihat akun
 *  profile. misal username, Full Name, Password. Dan bisa edit itu", lalu direvisi lagi hari yang
 *  sama: "profil saya jangan begini. tapi buat halaman penuh seperti halaman menu kalau dibuka.
 *  bukan pop up" -- jadi halaman PENUH lewat AppShell (bukan modal lagi, lihat riwayat git untuk
 *  versi modal lama), satu komponen dipakai ulang oleh 8 route per modul (lihat PROFILE_HREF di
 *  lib/shell/nav.ts + app/<modul>/profil-saya/page.tsx masing-masing, tiap file cuma 3 baris
 *  render komponen ini dengan `role` beda). Menu "Profil Saya" di topbar (app-shell.tsx) cuma
 *  ditampilkan kalau login lewat akun bernama, tapi halaman ini sendiri tidak "mengunci" akun utama
 *  yang nekat buka URL-nya langsung -- `getMyInternalProfileAction` di server akan menolak dengan
 *  pesan error yang ditampilkan apa adanya (bukan crash/redirect), karena akun utama memang tidak
 *  punya baris `internal_role_users` untuk ditampilkan. Password saat ini WAJIB dicocokkan dulu di
 *  server sebelum ganti password baru. */
export function ProfilSayaPage({ role, activeHref }: { role: InternalRole; activeHref: string }) {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [username, setUsername] = useState("");
  const [name, setName] = useState("");
  const [originalName, setOriginalName] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await getMyInternalProfileAction(role);
      if (cancelled) return;
      if (res.ok) {
        setUsername(res.data.username);
        setName(res.data.name);
        setOriginalName(res.data.name);
      } else {
        setLoadError(res.error);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [role]);

  async function handleSave() {
    setError(null);
    setSuccess(null);
    if (newPassword && newPassword !== confirmPassword) return setError("Konfirmasi password baru tidak cocok.");
    const nameChanged = name.trim() !== originalName;
    if (!nameChanged && !newPassword) return setError("Tidak ada perubahan untuk disimpan.");
    setSaving(true);
    const res = await updateMyInternalProfileAction(role, {
      name: nameChanged ? name.trim() : undefined,
      currentPassword: newPassword ? currentPassword : undefined,
      newPassword: newPassword || undefined,
    });
    setSaving(false);
    if (!res.ok) return setError(res.error);
    setOriginalName(res.data.name);
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setSuccess(
      newPassword
        ? "Tersimpan. Nama baru (kalau diubah) baru muncul di topbar setelah logout & login ulang."
        : "Nama tersimpan. Baru muncul di topbar setelah logout & login ulang."
    );
  }

  return (
    <AppShell role={role} activeHref={activeHref} breadcrumb={["Dashboard", "Profil Saya"]} title="Profil Saya" subtitle="Lihat & ubah nama dan password akun Anda sendiri.">
      <div className="flex max-w-[560px] flex-col gap-4">
        {loading && (
          <div className="rounded-lg border border-border-subtle bg-surface-card px-4 py-8 text-center font-sans text-xs text-text-muted">Memuat…</div>
        )}

        {!loading && loadError && (
          <div className="rounded-md border border-danger bg-danger-bg px-4 py-2.5 font-sans text-[12px] text-danger-fg">{loadError}</div>
        )}

        {!loading && !loadError && (
          <>
            <div className="overflow-hidden rounded-lg border border-border-subtle bg-surface-card">
              <div className="border-b border-border-subtle px-4 py-3 font-sans text-[13px] font-semibold text-text-primary">Informasi Akun</div>
              <div className="flex flex-col gap-3 px-4 py-4">
                <div>
                  <div className="mb-1 font-sans text-[10.5px] font-medium uppercase tracking-wider text-text-muted">Username</div>
                  <input value={username} disabled className="input w-full bg-[#F7F9FB] font-mono text-text-muted" />
                </div>
                <div>
                  <div className="mb-1 font-sans text-[10.5px] font-medium uppercase tracking-wider text-text-muted">Full Name</div>
                  <input value={name} onChange={(e) => setName(e.target.value)} className="input w-full" />
                </div>
              </div>
            </div>

            <div className="overflow-hidden rounded-lg border border-border-subtle bg-surface-card">
              <div className="border-b border-border-subtle px-4 py-3 font-sans text-[13px] font-semibold text-text-primary">Ganti Password (opsional)</div>
              <div className="flex flex-col gap-3 px-4 py-4">
                <div>
                  <div className="mb-1 font-sans text-[10.5px] font-medium uppercase tracking-wider text-text-muted">Password Saat Ini</div>
                  <input
                    type="password"
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    className="input w-full"
                    placeholder="wajib diisi kalau mau ganti password"
                  />
                </div>
                <div>
                  <div className="mb-1 font-sans text-[10.5px] font-medium uppercase tracking-wider text-text-muted">Password Baru</div>
                  <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} className="input w-full" placeholder="min. 6 karakter" />
                </div>
                <div>
                  <div className="mb-1 font-sans text-[10.5px] font-medium uppercase tracking-wider text-text-muted">Konfirmasi Password Baru</div>
                  <input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} className="input w-full" />
                </div>
              </div>
            </div>

            {error && <div className="rounded-md border border-danger bg-danger-bg px-4 py-2.5 font-sans text-[12px] text-danger-fg">{error}</div>}
            {success && <div className="rounded-md border border-success-fg/30 bg-success-bg px-4 py-2.5 font-sans text-[12px] text-success-fg">{success}</div>}

            <div>
              <Button onClick={handleSave} disabled={saving} variant="primary" size="md">
                {saving ? "Menyimpan…" : "Simpan Perubahan"}
              </Button>
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}
