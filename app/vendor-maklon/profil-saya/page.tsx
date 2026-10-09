"use client";

import { useEffect, useState } from "react";
import { AppShell } from "@/components/shell/app-shell";
import { Button } from "@/components/ui/button";
import { VendorAuthGuard } from "@/components/mrp/vendor-auth-guard";
import { VENDOR_PRODUKSI } from "@/lib/mrp/seed";
import { changeMyVendorPasswordAction, getMyVendorProfileAction, type VendorProfile } from "@/lib/mrp/vendorProfileActions";

/** Profil Saya portal Vendor Produksi -- akun utama dan anggota tim. Username/nama hanya dilihat (tidak bisa diubah, supaya
 *  jejak nama vendor/anggota tidak berubah); yang bisa diubah hanya password. */
function ProfilContent({ vendorId }: { vendorId: string }) {
  const [profile, setProfile] = useState<VendorProfile | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    let alive = true;
    getMyVendorProfileAction().then((r) => {
      if (!alive) return;
      if (r.ok) setProfile(r.data);
      else setLoadError(r.error);
    });
    return () => {
      alive = false;
    };
  }, []);

  async function save() {
    setError(null);
    setSuccess(false);
    if (!currentPassword) return setError("Masukkan password Anda saat ini.");
    if (newPassword.length < 6) return setError("Password baru minimal 6 karakter.");
    if (newPassword !== confirmPassword) return setError("Konfirmasi password baru tidak cocok.");
    setSaving(true);
    const r = await changeMyVendorPasswordAction(currentPassword, newPassword);
    setSaving(false);
    if (!r.ok) return setError(r.error);
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setSuccess(true);
  }

  return (
    <AppShell
      role="vendorMaklon"
      vendorId={vendorId}
      activeHref="/vendor-maklon/profil-saya"
      breadcrumb={["Dashboard", "Profil Saya"]}
      title="Profil Saya"
      subtitle="Lihat akun Anda dan ubah password."
      roleOverride={VENDOR_PRODUKSI[vendorId]?.name ?? vendorId}
      entityOverride="Vendor Produksi"
    >
      <div className="flex max-w-[560px] flex-col gap-4">
        {!profile && !loadError && <div className="rounded-lg border border-border-subtle bg-surface-card px-4 py-8 text-center font-sans text-xs text-text-muted">Memuat…</div>}
        {loadError && <div className="rounded-md border border-danger bg-danger-bg px-4 py-2.5 font-sans text-[12px] text-danger-fg">{loadError}</div>}

        {profile && (
          <>
            <div className="overflow-hidden rounded-lg border border-border-subtle bg-surface-card">
              <div className="border-b border-border-subtle px-4 py-3 font-sans text-[13px] font-semibold text-text-primary">Informasi Akun</div>
              <div className="flex flex-col gap-3 px-4 py-4">
                <div>
                  <div className="mb-1 font-sans text-[10.5px] font-medium uppercase tracking-wider text-text-muted">{profile.kind === "MAIN" ? "Nama login (nama vendor)" : "Username"}</div>
                  <input value={profile.loginName} disabled className="input w-full bg-[#F7F9FB] font-mono text-text-muted" />
                </div>
                {profile.kind === "MEMBER" && (
                  <>
                    <div>
                      <div className="mb-1 font-sans text-[10.5px] font-medium uppercase tracking-wider text-text-muted">Nama</div>
                      <input value={profile.name} disabled className="input w-full bg-[#F7F9FB] text-text-muted" />
                    </div>
                    <div>
                      <div className="mb-1 font-sans text-[10.5px] font-medium uppercase tracking-wider text-text-muted">Vendor</div>
                      <input value={profile.vendorName} disabled className="input w-full bg-[#F7F9FB] text-text-muted" />
                    </div>
                  </>
                )}
                <div className="font-sans text-[11px] text-text-muted">Username dan nama tidak bisa diubah agar riwayat pekerjaan tetap tercatat dengan benar.</div>
              </div>
            </div>

            <div className="overflow-hidden rounded-lg border border-border-subtle bg-surface-card">
              <div className="border-b border-border-subtle px-4 py-3 font-sans text-[13px] font-semibold text-text-primary">Ganti Password</div>
              <div className="flex flex-col gap-3 px-4 py-4">
                <div>
                  <div className="mb-1 font-sans text-[10.5px] font-medium uppercase tracking-wider text-text-muted">Password Saat Ini</div>
                  <input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} autoComplete="current-password" className="input w-full" />
                </div>
                <div>
                  <div className="mb-1 font-sans text-[10.5px] font-medium uppercase tracking-wider text-text-muted">Password Baru</div>
                  <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} autoComplete="new-password" placeholder="Minimal 6 karakter" className="input w-full" />
                </div>
                <div>
                  <div className="mb-1 font-sans text-[10.5px] font-medium uppercase tracking-wider text-text-muted">Konfirmasi Password Baru</div>
                  <input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} autoComplete="new-password" className="input w-full" />
                </div>
              </div>
            </div>

            {error && <div className="rounded-md border border-danger bg-danger-bg px-4 py-2.5 font-sans text-[12px] text-danger-fg">{error}</div>}
            {success && <div className="rounded-md border border-success-fg/30 bg-success-bg px-4 py-2.5 font-sans text-[12px] text-success-fg">Password berhasil diganti. Gunakan password baru saat login berikutnya.</div>}

            <div>
              <Button onClick={() => void save()} disabled={saving} variant="primary" size="md">
                {saving ? "Menyimpan…" : "Simpan Password"}
              </Button>
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}

export default function VendorProfilPage() {
  return <VendorAuthGuard>{(vendorId) => <ProfilContent vendorId={vendorId} />}</VendorAuthGuard>;
}
