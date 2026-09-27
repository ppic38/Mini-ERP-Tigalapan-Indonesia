"use client";

import { useCallback, useEffect, useState } from "react";
import { AppShell } from "@/components/shell/app-shell";
import { Button } from "@/components/ui/button";
import {
  listAllVendorTeamMembersAction,
  listInternalAccountsAction,
  listVendorAccountsAction,
  resetVendorPasswordAction,
  setInternalAccountPasswordAction,
  sysadminDeleteVendorTeamMemberAction,
  sysadminResetVendorTeamMemberPasswordAction,
  sysadminUpdateVendorTeamMemberAction,
  type InternalAccountRow,
  type VendorAccountRow,
  type VendorTeamMemberOverviewRow,
} from "@/lib/mrp/sysadminActions";
import { describeVendorPermissions } from "@/lib/mrp/vendorPages";
import { VendorPermissionPicker } from "@/components/mrp/vendor-permission-picker";

function fmtTime(iso?: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString("id-ID", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

/** Popup ganti/reset password -- password baru & alasan WAJIB, dipakai untuk akun modul internal
 *  maupun vendor produksi (owner 2026-09-27, Sysadmin). Semua aksi tercatat ke sysadmin_audit_log. */
function PasswordModal({ title, onSave, onClose }: { title: string; onSave: (password: string, reason: string) => Promise<{ ok: boolean; error?: string }>; onClose: () => void }) {
  const [password, setPassword] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    if (password.length < 6) return setError("Password minimal 6 karakter.");
    if (!reason.trim()) return setError("Alasan wajib diisi.");
    setSaving(true);
    setError(null);
    const res = await onSave(password, reason.trim());
    setSaving(false);
    if (!res.ok) return setError(res.error ?? "Gagal menyimpan.");
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0B131B]/45 p-4" onClick={onClose}>
      <div className="w-full max-w-[440px] rounded-lg bg-white shadow-[0_8px_24px_rgba(11,19,27,.2)]" onClick={(e) => e.stopPropagation()}>
        <div className="border-b border-border-subtle px-5 py-3.5 font-sans text-[13px] font-semibold text-text-primary">{title}</div>
        <div className="flex flex-col gap-3 px-5 py-4">
          <div>
            <div className="mb-1 font-sans text-[10.5px] font-medium uppercase tracking-wider text-text-muted">Password baru (min. 6 karakter)</div>
            <input type="text" value={password} onChange={(e) => setPassword(e.target.value)} className="input w-full font-mono" autoFocus />
          </div>
          <div>
            <div className="mb-1 font-sans text-[10.5px] font-medium uppercase tracking-wider text-text-muted">Alasan (wajib, tercatat ke log audit)</div>
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} className="input w-full" placeholder="mis. lupa password, ganti PIC, dst." />
          </div>
          {error && <div className="rounded-md border border-danger bg-danger-bg px-3 py-2 font-sans text-[11.5px] text-danger-fg">{error}</div>}
        </div>
        <div className="flex justify-end gap-2 border-t border-border-subtle px-5 py-3.5">
          <button onClick={onClose} className="rounded-md border border-[#CBD5DF] bg-white px-3.5 py-[7px] font-sans text-xs font-semibold text-action-primary">
            Batal
          </button>
          <Button onClick={handleSave} disabled={saving} variant="primary" size="sm">
            {saving ? "Menyimpan…" : "Simpan Password"}
          </Button>
        </div>
      </div>
    </div>
  );
}

/** Edit izin halaman + nama anggota tim vendor -- jalur darurat Sysadmin (owner 2026-09-27: "apa
 *  bisa terpantau di sysadmin? bisa diedit juga?"), terpisah dari reset password (PasswordModal). */
function EditTeamMemberModal({ member, onSave, onClose }: { member: VendorTeamMemberOverviewRow; onSave: (patch: { name: string; allowedPages: string[] }, reason: string) => Promise<{ ok: boolean; error?: string }>; onClose: () => void }) {
  const [name, setName] = useState(member.name);
  const [pages, setPages] = useState<string[]>(member.allowedPages);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    if (!reason.trim()) return setError("Alasan wajib diisi.");
    setSaving(true);
    setError(null);
    const res = await onSave({ name, allowedPages: pages }, reason.trim());
    setSaving(false);
    if (!res.ok) return setError(res.error ?? "Gagal menyimpan.");
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0B131B]/45 p-4" onClick={onClose}>
      <div className="w-full max-w-[620px] rounded-lg bg-white shadow-[0_8px_24px_rgba(11,19,27,.2)]" onClick={(e) => e.stopPropagation()}>
        <div className="border-b border-border-subtle px-5 py-3.5 font-sans text-[13px] font-semibold text-text-primary">
          Edit — <span className="font-mono">{member.username}</span> ({member.vendorName})
        </div>
        <div className="flex max-h-[70vh] flex-col gap-3 overflow-y-auto px-5 py-4">
          <div>
            <div className="mb-1 font-sans text-[10.5px] font-medium uppercase tracking-wider text-text-muted">Nama</div>
            <input value={name} onChange={(e) => setName(e.target.value)} className="input w-full" />
          </div>
          <div>
            <div className="mb-1 font-sans text-[10.5px] font-medium uppercase tracking-wider text-text-muted">Halaman yang boleh diakses</div>
            <VendorPermissionPicker value={pages} onChange={setPages} />
          </div>
          <div>
            <div className="mb-1 font-sans text-[10.5px] font-medium uppercase tracking-wider text-text-muted">Alasan (wajib, tercatat ke log audit)</div>
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} className="input w-full" placeholder="mis. vendor minta bantuan ubah akses" />
          </div>
          {error && <div className="rounded-md border border-danger bg-danger-bg px-3 py-2 font-sans text-[11.5px] text-danger-fg">{error}</div>}
        </div>
        <div className="flex justify-end gap-2 border-t border-border-subtle px-5 py-3.5">
          <button onClick={onClose} className="rounded-md border border-[#CBD5DF] bg-white px-3.5 py-[7px] font-sans text-xs font-semibold text-action-primary">
            Batal
          </button>
          <Button onClick={handleSave} disabled={saving} variant="primary" size="sm">
            {saving ? "Menyimpan…" : "Simpan"}
          </Button>
        </div>
      </div>
    </div>
  );
}

/** Popup dengan alasan wajib (sama seperti PasswordModal) tapi untuk aksi non-password yang tetap
 *  butuh justifikasi, mis. nonaktifkan/hapus anggota tim. */
function ReasonModal({ title, danger, onConfirm, onClose }: { title: string; danger?: boolean; onConfirm: (reason: string) => Promise<{ ok: boolean; error?: string }>; onClose: () => void }) {
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleConfirm() {
    if (!reason.trim()) return setError("Alasan wajib diisi.");
    setSaving(true);
    setError(null);
    const res = await onConfirm(reason.trim());
    setSaving(false);
    if (!res.ok) return setError(res.error ?? "Gagal menyimpan.");
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0B131B]/45 p-4" onClick={onClose}>
      <div className="w-full max-w-[400px] rounded-lg bg-white shadow-[0_8px_24px_rgba(11,19,27,.2)]" onClick={(e) => e.stopPropagation()}>
        <div className="border-b border-border-subtle px-5 py-3.5 font-sans text-[13px] font-semibold text-text-primary">{title}</div>
        <div className="px-5 py-4">
          <div className="mb-1 font-sans text-[10.5px] font-medium uppercase tracking-wider text-text-muted">Alasan (wajib, tercatat ke log audit)</div>
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} className="input w-full" autoFocus />
          {error && <div className="mt-2 rounded-md border border-danger bg-danger-bg px-3 py-2 font-sans text-[11.5px] text-danger-fg">{error}</div>}
        </div>
        <div className="flex justify-end gap-2 border-t border-border-subtle px-5 py-3.5">
          <button onClick={onClose} className="rounded-md border border-[#CBD5DF] bg-white px-3.5 py-[7px] font-sans text-xs font-semibold text-action-primary">
            Batal
          </button>
          <Button onClick={handleConfirm} disabled={saving} variant={danger ? "danger" : "primary"} size="sm">
            {saving ? "Menyimpan…" : "Konfirmasi"}
          </Button>
        </div>
      </div>
    </div>
  );
}

export default function SysadminAccountsPage() {
  const [internalAccounts, setInternalAccounts] = useState<InternalAccountRow[] | null>(null);
  const [vendorAccounts, setVendorAccounts] = useState<VendorAccountRow[] | null>(null);
  const [teamMembers, setTeamMembers] = useState<VendorTeamMemberOverviewRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editingInternal, setEditingInternal] = useState<InternalAccountRow | null>(null);
  const [editingVendor, setEditingVendor] = useState<VendorAccountRow | null>(null);
  const [vendorSearch, setVendorSearch] = useState("");
  const [teamSearch, setTeamSearch] = useState("");
  const [editingMember, setEditingMember] = useState<VendorTeamMemberOverviewRow | null>(null);
  const [resettingMember, setResettingMember] = useState<VendorTeamMemberOverviewRow | null>(null);
  const [togglingMember, setTogglingMember] = useState<VendorTeamMemberOverviewRow | null>(null);
  const [deletingMember, setDeletingMember] = useState<VendorTeamMemberOverviewRow | null>(null);

  const reload = useCallback(async () => {
    const [ia, va, ta] = await Promise.all([listInternalAccountsAction(), listVendorAccountsAction(), listAllVendorTeamMembersAction()]);
    if (ia.ok) setInternalAccounts(ia.data);
    if (va.ok) setVendorAccounts(va.data);
    if (ta.ok) setTeamMembers(ta.data);
    if (!ia.ok) setLoadError(ia.error);
    else if (!va.ok) setLoadError(va.error);
    else if (!ta.ok) setLoadError(ta.error);
    else setLoadError(null);
  }, []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void reload();
  }, [reload]);

  const filteredVendors = (vendorAccounts ?? []).filter((v) => v.name.toLowerCase().includes(vendorSearch.toLowerCase()));

  return (
    <AppShell role="sysadmin" activeHref="/sysadmin/accounts" breadcrumb={["Dashboard", "Akun & Password"]} title="Akun & Password">
      <div className="flex flex-col gap-4">
        <div className="rounded-md border border-[#CFE0EF] bg-info-bg px-4 py-2.5 font-sans text-[11.5px] leading-[1.5] text-info-fg">
          Password modul internal awalnya diatur lewat env var Vercel (<span className="font-mono">INTERNAL_PASSWORD_&lt;ROLE&gt;</span>). Begitu Anda set password di sini, login modul itu
          langsung memakai password baru ini (env var lama boleh dibiarkan). Setiap ganti password WAJIB isi alasan, tercatat permanen di Log Audit.
        </div>
        {loadError && <div className="rounded-md border border-danger bg-danger-bg px-4 py-2.5 font-sans text-[12px] text-danger-fg">{loadError}</div>}

        <div className="overflow-hidden rounded-lg border border-border-subtle bg-surface-card">
          <div className="border-b border-border-subtle px-4 py-3 font-sans text-[13px] font-semibold text-text-primary">Akun Modul Internal</div>
          <div className="grid grid-cols-[1fr_140px_180px_100px] gap-x-3 border-b border-border-subtle bg-[#F7F9FB] px-4 py-[9px] font-sans text-[10.5px] font-medium uppercase tracking-wider text-text-muted">
            <span>Modul</span>
            <span>Sumber Password</span>
            <span>Terakhir Diubah</span>
            <span className="text-right">Aksi</span>
          </div>
          {internalAccounts == null && <div className="px-4 py-6 text-center font-sans text-xs text-text-muted">Memuat…</div>}
          {internalAccounts?.map((a) => (
            <div key={a.role} className="grid grid-cols-[1fr_140px_180px_100px] items-center gap-x-3 border-b border-[#F1F4F7] px-4 py-[11px] font-sans text-xs text-[#31414F] last:border-b-0">
              <span className="font-medium">{a.label}</span>
              <span>
                {a.hasDbPassword ? (
                  <span className="font-semibold text-success-fg">Database</span>
                ) : (
                  <span className="text-warning-fg">Env var (belum diatur)</span>
                )}
              </span>
              <span className="text-text-muted">{fmtTime(a.updatedAt)}</span>
              <span className="text-right">
                <Button onClick={() => setEditingInternal(a)} variant="ghost" size="xs">
                  Ganti Password
                </Button>
              </span>
            </div>
          ))}
        </div>

        <div className="overflow-hidden rounded-lg border border-border-subtle bg-surface-card">
          <div className="flex items-center gap-2 border-b border-border-subtle px-4 py-3">
            <span className="font-sans text-[13px] font-semibold text-text-primary">Akun Vendor Produksi</span>
            <input value={vendorSearch} onChange={(e) => setVendorSearch(e.target.value)} placeholder="Cari vendor…" className="input ml-auto w-[220px] !py-1 !text-[11.5px]" />
          </div>
          <div className="grid grid-cols-[1fr_1fr_100px] gap-x-3 border-b border-border-subtle bg-[#F7F9FB] px-4 py-[9px] font-sans text-[10.5px] font-medium uppercase tracking-wider text-text-muted">
            <span>Kode</span>
            <span>Nama Vendor</span>
            <span className="text-right">Aksi</span>
          </div>
          {vendorAccounts == null && <div className="px-4 py-6 text-center font-sans text-xs text-text-muted">Memuat…</div>}
          {vendorAccounts != null && filteredVendors.length === 0 && <div className="px-4 py-6 text-center font-sans text-xs text-text-muted">Tidak ada vendor yang cocok.</div>}
          {filteredVendors.map((v) => (
            <div key={v.id} className="grid grid-cols-[1fr_1fr_100px] items-center gap-x-3 border-b border-[#F1F4F7] px-4 py-[11px] font-sans text-xs text-[#31414F] last:border-b-0">
              <span className="font-mono">{v.id}</span>
              <span>{v.name}</span>
              <span className="text-right">
                <Button onClick={() => setEditingVendor(v)} variant="ghost" size="xs">
                  Reset Password
                </Button>
              </span>
            </div>
          ))}
        </div>

        <div className="overflow-hidden rounded-lg border border-border-subtle bg-surface-card">
          <div className="flex items-center gap-2 border-b border-border-subtle px-4 py-3">
            <div>
              <span className="font-sans text-[13px] font-semibold text-text-primary">Anggota Tim Vendor Produksi</span>
              <div className="font-sans text-[10.5px] text-text-muted">Dikelola sehari-hari oleh vendor sendiri (menu &quot;Tim Saya&quot;) — ini jalur darurat Sysadmin.</div>
            </div>
            <input value={teamSearch} onChange={(e) => setTeamSearch(e.target.value)} placeholder="Cari username/nama/vendor…" className="input ml-auto w-[240px] !py-1 !text-[11.5px]" />
          </div>
          <div className="grid grid-cols-[1fr_1fr_1fr_1.3fr_80px_170px] gap-x-3 border-b border-border-subtle bg-[#F7F9FB] px-4 py-[9px] font-sans text-[10.5px] font-medium uppercase tracking-wider text-text-muted">
            <span>Username</span>
            <span>Nama</span>
            <span>Vendor</span>
            <span>Halaman Diizinkan</span>
            <span>Status</span>
            <span className="text-right">Aksi</span>
          </div>
          {teamMembers == null && <div className="px-4 py-6 text-center font-sans text-xs text-text-muted">Memuat…</div>}
          {teamMembers != null &&
            (() => {
              const q = teamSearch.trim().toLowerCase();
              const filtered = q ? teamMembers.filter((m) => `${m.username} ${m.name} ${m.vendorName}`.toLowerCase().includes(q)) : teamMembers;
              if (filtered.length === 0) return <div className="px-4 py-6 text-center font-sans text-xs text-text-muted">Belum ada anggota tim vendor.</div>;
              return filtered.map((m) => (
                <div key={m.id} className="grid grid-cols-[1fr_1fr_1fr_1.3fr_80px_170px] items-center gap-x-3 border-b border-[#F1F4F7] px-4 py-[11px] font-sans text-xs text-[#31414F] last:border-b-0">
                  <span className="font-mono">{m.username}</span>
                  <span>{m.name}</span>
                  <span>{m.vendorName}</span>
                  <span className="text-[10.5px] text-text-muted">{describeVendorPermissions(m.allowedPages)}</span>
                  <span className={m.active ? "font-semibold text-success-fg" : "text-text-muted"}>{m.active ? "Aktif" : "Nonaktif"}</span>
                  <span className="flex items-center justify-end gap-1.5">
                    <Button onClick={() => setEditingMember(m)} variant="ghost" size="xs">
                      Edit
                    </Button>
                    <Button onClick={() => setResettingMember(m)} variant="ghost" size="xs">
                      Reset Pass
                    </Button>
                    <Button onClick={() => setTogglingMember(m)} variant="ghost" size="xs">
                      {m.active ? "Nonaktifkan" : "Aktifkan"}
                    </Button>
                    <Button onClick={() => setDeletingMember(m)} variant="danger" size="xs">
                      Hapus
                    </Button>
                  </span>
                </div>
              ));
            })()}
        </div>
      </div>

      {editingInternal && (
        <PasswordModal
          title={`Ganti Password — ${editingInternal.label}`}
          onClose={() => setEditingInternal(null)}
          onSave={async (password, reason) => {
            const res = await setInternalAccountPasswordAction(editingInternal.role, password, reason);
            if (res.ok) void reload();
            return res.ok ? { ok: true } : { ok: false, error: res.error };
          }}
        />
      )}
      {editingVendor && (
        <PasswordModal
          title={`Reset Password — ${editingVendor.name}`}
          onClose={() => setEditingVendor(null)}
          onSave={async (password, reason) => {
            const res = await resetVendorPasswordAction(editingVendor.id, password, reason);
            if (res.ok) void reload();
            return res.ok ? { ok: true } : { ok: false, error: res.error };
          }}
        />
      )}
      {editingMember && (
        <EditTeamMemberModal
          member={editingMember}
          onClose={() => setEditingMember(null)}
          onSave={async (patch, reason) => {
            const res = await sysadminUpdateVendorTeamMemberAction(editingMember.id, patch, reason);
            if (res.ok) void reload();
            return res.ok ? { ok: true } : { ok: false, error: res.error };
          }}
        />
      )}
      {resettingMember && (
        <PasswordModal
          title={`Reset Password — ${resettingMember.username} (${resettingMember.vendorName})`}
          onClose={() => setResettingMember(null)}
          onSave={async (password, reason) => {
            const res = await sysadminResetVendorTeamMemberPasswordAction(resettingMember.id, password, reason);
            if (res.ok) void reload();
            return res.ok ? { ok: true } : { ok: false, error: res.error };
          }}
        />
      )}
      {togglingMember && (
        <ReasonModal
          title={`${togglingMember.active ? "Nonaktifkan" : "Aktifkan"} — ${togglingMember.username} (${togglingMember.vendorName})`}
          onClose={() => setTogglingMember(null)}
          onConfirm={async (reason) => {
            const res = await sysadminUpdateVendorTeamMemberAction(togglingMember.id, { active: !togglingMember.active }, reason);
            if (res.ok) void reload();
            return res.ok ? { ok: true } : { ok: false, error: res.error };
          }}
        />
      )}
      {deletingMember && (
        <ReasonModal
          title={`Hapus akun ${deletingMember.username} (${deletingMember.vendorName})`}
          danger
          onClose={() => setDeletingMember(null)}
          onConfirm={async (reason) => {
            const res = await sysadminDeleteVendorTeamMemberAction(deletingMember.id, reason);
            if (res.ok) void reload();
            return res.ok ? { ok: true } : { ok: false, error: res.error };
          }}
        />
      )}
    </AppShell>
  );
}
