"use client";

import { useEffect, useState } from "react";
import { getMyInternalProfileAction, updateMyInternalProfileAction } from "@/lib/mrp/internalProfileActions";
import type { InternalRole } from "@/lib/internal-auth";

/** "Profil Saya" -- owner 2026-09-29: "buat untuk akun dari tiap modul itu bisa lihat akun
 *  profile. misal username, Full Name, Password. Dan bisa edit itu". Muncul di topbar HANYA untuk
 *  akun yang login lewat username sendiri (internal_role_users, migration 0060) -- akun utama
 *  (password bersama modul) tidak punya baris personal untuk diedit lewat sini (lihat AppShell,
 *  ganti password akun utama tetap lewat Sysadmin). Password saat ini WAJIB diisi kalau mau ganti
 *  password baru -- dicek di server (updateMyInternalProfileAction), bukan cuma validasi client. */
export function MyProfileModal({ role, onClose }: { role: InternalRole; onClose: () => void }) {
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0B131B]/45 p-4" onClick={onClose}>
      <div className="w-full max-w-[440px] rounded-lg bg-white shadow-[0_8px_24px_rgba(11,19,27,.2)]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center border-b border-border-subtle px-5 py-3.5">
          <span className="font-sans text-[13px] font-semibold text-text-primary">Profil Saya</span>
          <button onClick={onClose} className="ml-auto font-sans text-lg leading-none text-text-muted hover:text-danger-fg">
            ×
          </button>
        </div>

        {loading && <div className="px-5 py-8 text-center font-sans text-xs text-text-muted">Memuat…</div>}

        {!loading && loadError && (
          <div className="px-5 py-4">
            <div className="rounded-md border border-danger bg-danger-bg px-3 py-2 font-sans text-[11.5px] text-danger-fg">{loadError}</div>
          </div>
        )}

        {!loading && !loadError && (
          <div className="flex flex-col gap-3 px-5 py-4">
            <div>
              <div className="mb-1 font-sans text-[10.5px] font-medium uppercase tracking-wider text-text-muted">Username</div>
              <input value={username} disabled className="input w-full bg-[#F7F9FB] font-mono text-text-muted" />
            </div>
            <div>
              <div className="mb-1 font-sans text-[10.5px] font-medium uppercase tracking-wider text-text-muted">Full Name</div>
              <input value={name} onChange={(e) => setName(e.target.value)} className="input w-full" />
            </div>

            <div className="mt-1 border-t border-border-subtle pt-3">
              <div className="mb-2 font-sans text-[11px] font-semibold text-text-primary">Ganti Password (opsional)</div>
              <div className="flex flex-col gap-2.5">
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

            {error && <div className="rounded-md border border-danger bg-danger-bg px-3 py-2 font-sans text-[11.5px] text-danger-fg">{error}</div>}
            {success && <div className="rounded-md border border-success bg-success-bg px-3 py-2 font-sans text-[11.5px] text-success-fg">{success}</div>}
          </div>
        )}

        <div className="flex justify-end gap-2 border-t border-border-subtle px-5 py-3.5">
          <button onClick={onClose} className="rounded-md border border-[#CBD5DF] bg-white px-3.5 py-[7px] font-sans text-xs font-semibold text-action-primary">
            Tutup
          </button>
          {!loading && !loadError && (
            <button
              onClick={handleSave}
              disabled={saving}
              className="rounded-md bg-action-primary px-3.5 py-[7px] font-sans text-xs font-semibold text-white disabled:opacity-60"
            >
              {saving ? "Menyimpan…" : "Simpan"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
