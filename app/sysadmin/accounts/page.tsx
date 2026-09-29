"use client";

import { useCallback, useEffect, useState } from "react";
import { AppShell } from "@/components/shell/app-shell";
import { Button } from "@/components/ui/button";
import { Tabs } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import {
  listInternalAccountsAction,
  listInternalRoleUsersAction,
  listVendorAccountsAction,
  resetVendorPasswordAction,
  setInternalAccountPasswordAction,
  sysadminAddInternalRoleUserAction,
  sysadminDeleteInternalRoleUserAction,
  sysadminResetInternalRoleUserPasswordAction,
  sysadminUpdateInternalRoleUserAction,
  type InternalAccountRow,
  type InternalRoleUserRow,
  type VendorAccountRow,
} from "@/lib/mrp/sysadminActions";
import { INTERNAL_ACCOUNTS, type InternalRole } from "@/lib/internal-auth";

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

/** Popup dengan alasan wajib (sama seperti PasswordModal) tapi untuk aksi non-password yang tetap
 *  butuh justifikasi, mis. nonaktifkan/hapus akun. */
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

/** Tambah akun login modul internal (migration 0060) -- Revisi 2026-09-29 (owner: "kita harus
 *  select dulu mau create akun apa di suatu modul yang dipilih") -- modul TIDAK lagi dipilih di
 *  dalam modal ini (dulu ada dropdown role di sini), tapi sudah ditentukan lewat chip modul yang
 *  dipilih di halaman utama (lihat SysadminAccountsPage) -- modal ini cuma tampilkan modulnya
 *  sebagai label statis. Akses akun yang dibuat selalu PENUH ke role itu, sama seperti password
 *  modul lama -- lihat catatan panjang di lib/mrp/sysadminActions.ts. Alasan WAJIB, sama seperti
 *  semua mutasi Sysadmin lain di halaman ini. */
function AddInternalRoleUserModal({ role, onClose, onDone }: { role: InternalRole; onClose: () => void; onDone: () => void }) {
  const label = INTERNAL_ACCOUNTS.find((a) => a.role === role)?.label ?? role;
  const [username, setUsername] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    if (!reason.trim()) return setError("Alasan wajib diisi.");
    setSaving(true);
    setError(null);
    const res = await sysadminAddInternalRoleUserAction({ role, username, name, password }, reason.trim());
    setSaving(false);
    if (!res.ok) return setError(res.error);
    onDone();
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0B131B]/45 p-4" onClick={onClose}>
      <div className="w-full max-w-[480px] rounded-lg bg-white shadow-[0_8px_24px_rgba(11,19,27,.2)]" onClick={(e) => e.stopPropagation()}>
        <div className="border-b border-border-subtle px-5 py-3.5 font-sans text-[13px] font-semibold text-text-primary">
          Tambah Akun Login — <span className="text-action-primary">{label}</span>
        </div>
        <div className="flex flex-col gap-3 px-5 py-4">
          <div>
            <div className="mb-1 font-sans text-[10.5px] font-medium uppercase tracking-wider text-text-muted">Username (unik, tanpa spasi)</div>
            <input value={username} onChange={(e) => setUsername(e.target.value)} className="input w-full font-mono" placeholder="mis. procurement1" autoFocus />
          </div>
          <div>
            <div className="mb-1 font-sans text-[10.5px] font-medium uppercase tracking-wider text-text-muted">Nama (PIC)</div>
            <input value={name} onChange={(e) => setName(e.target.value)} className="input w-full" placeholder="mis. Budi Santoso" />
          </div>
          <div>
            <div className="mb-1 font-sans text-[10.5px] font-medium uppercase tracking-wider text-text-muted">Password (min. 6 karakter)</div>
            <input value={password} onChange={(e) => setPassword(e.target.value)} className="input w-full font-mono" />
          </div>
          <div>
            <div className="mb-1 font-sans text-[10.5px] font-medium uppercase tracking-wider text-text-muted">Alasan (wajib, tercatat ke log audit)</div>
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} className="input w-full" placeholder="mis. PIC baru di modul ini" />
          </div>
          {error && <div className="rounded-md border border-danger bg-danger-bg px-3 py-2 font-sans text-[11.5px] text-danger-fg">{error}</div>}
        </div>
        <div className="flex justify-end gap-2 border-t border-border-subtle px-5 py-3.5">
          <button onClick={onClose} className="rounded-md border border-[#CBD5DF] bg-white px-3.5 py-[7px] font-sans text-xs font-semibold text-action-primary">
            Batal
          </button>
          <Button onClick={handleSave} disabled={saving} variant="primary" size="sm">
            {saving ? "Menyimpan…" : "Tambah"}
          </Button>
        </div>
      </div>
    </div>
  );
}

/** Edit akun login modul internal -- Revisi 2026-09-29 (owner: "gabung saja yang reset pass
 *  dengan edit") -- SEBELUMNYA "Edit" (nama saja) dan "Reset Pass" (password saja) 2 tombol/modal
 *  terpisah, sekarang 1 modal: Nama + Password Baru (opsional, kosongkan kalau tidak mau ganti).
 *  Nonaktifkan/Hapus TETAP modal terpisah (ReasonModal) -- itu aksi destructive/status, beda
 *  kategori dari "edit data". `onSaveName`/`onSavePassword` dipanggil terpisah (2 server action
 *  beda) tapi dari 1 form & 1 alasan yang sama. */
function EditInternalRoleUserModal({
  member,
  onSaveName,
  onSavePassword,
  onClose,
}: {
  member: InternalRoleUserRow;
  onSaveName: (name: string, reason: string) => Promise<{ ok: boolean; error?: string }>;
  onSavePassword: (password: string, reason: string) => Promise<{ ok: boolean; error?: string }>;
  onClose: () => void;
}) {
  const [name, setName] = useState(member.name);
  const [newPassword, setNewPassword] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    if (!reason.trim()) return setError("Alasan wajib diisi.");
    if (newPassword && newPassword.length < 6) return setError("Password baru minimal 6 karakter.");
    setSaving(true);
    setError(null);
    if (name.trim() && name.trim() !== member.name) {
      const res = await onSaveName(name.trim(), reason.trim());
      if (!res.ok) {
        setSaving(false);
        return setError(res.error ?? "Gagal menyimpan nama.");
      }
    }
    if (newPassword) {
      const res = await onSavePassword(newPassword, reason.trim());
      if (!res.ok) {
        setSaving(false);
        return setError(res.error ?? "Gagal menyimpan password.");
      }
    }
    setSaving(false);
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0B131B]/45 p-4" onClick={onClose}>
      <div className="w-full max-w-[440px] rounded-lg bg-white shadow-[0_8px_24px_rgba(11,19,27,.2)]" onClick={(e) => e.stopPropagation()}>
        <div className="border-b border-border-subtle px-5 py-3.5 font-sans text-[13px] font-semibold text-text-primary">
          Edit — <span className="font-mono">{member.username}</span>
        </div>
        <div className="flex flex-col gap-3 px-5 py-4">
          <div>
            <div className="mb-1 font-sans text-[10.5px] font-medium uppercase tracking-wider text-text-muted">Nama</div>
            <input value={name} onChange={(e) => setName(e.target.value)} className="input w-full" autoFocus />
          </div>
          <div>
            <div className="mb-1 font-sans text-[10.5px] font-medium uppercase tracking-wider text-text-muted">Password Baru (opsional, kosongkan kalau tidak diganti)</div>
            <input value={newPassword} onChange={(e) => setNewPassword(e.target.value)} className="input w-full font-mono" placeholder="min. 6 karakter" />
          </div>
          <div>
            <div className="mb-1 font-sans text-[10.5px] font-medium uppercase tracking-wider text-text-muted">Alasan (wajib, tercatat ke log audit)</div>
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} className="input w-full" />
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

export default function SysadminAccountsPage() {
  // Revisi 2026-09-29 (owner: "buat per sub tab ... seperti di PO Approval milik finance") --
  // halaman dipecah 2 sub-tab: "Akun Internal" (password modul + akun login multi-user PPIC dst,
  // digabung per modul lewat chip pemilih) dan "Akun Vendor Produksi" (password vendor). Tabel
  // "Anggota Tim Vendor Produksi" (jalur darurat lama) dihapus dari tampilan per instruksi owner.
  const [tab, setTab] = useState<"internal" | "vendor">("internal");
  const [selectedRole, setSelectedRole] = useState<InternalRole>(INTERNAL_ACCOUNTS[0].role);

  const [internalAccounts, setInternalAccounts] = useState<InternalAccountRow[] | null>(null);
  const [vendorAccounts, setVendorAccounts] = useState<VendorAccountRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editingInternal, setEditingInternal] = useState<InternalAccountRow | null>(null);
  const [editingVendor, setEditingVendor] = useState<VendorAccountRow | null>(null);
  const [vendorSearch, setVendorSearch] = useState("");

  // Akun login modul internal (migration 0060) -- lihat catatan panjang di
  // lib/mrp/sysadminActions.ts kenapa ini SATU-SATUNYA jalur kelola (tidak ada portal self-service
  // per modul seperti "Tim Saya" vendor).
  const [internalRoleUsers, setInternalRoleUsers] = useState<InternalRoleUserRow[] | null>(null);
  const [internalUserSearch, setInternalUserSearch] = useState("");
  const [showAddInternalUser, setShowAddInternalUser] = useState(false);
  const [editingInternalUser, setEditingInternalUser] = useState<InternalRoleUserRow | null>(null);
  const [togglingInternalUser, setTogglingInternalUser] = useState<InternalRoleUserRow | null>(null);
  const [deletingInternalUser, setDeletingInternalUser] = useState<InternalRoleUserRow | null>(null);

  const reload = useCallback(async () => {
    const [ia, va, iu] = await Promise.all([listInternalAccountsAction(), listVendorAccountsAction(), listInternalRoleUsersAction()]);
    if (ia.ok) setInternalAccounts(ia.data);
    if (va.ok) setVendorAccounts(va.data);
    if (iu.ok) setInternalRoleUsers(iu.data);
    if (!ia.ok) setLoadError(ia.error);
    else if (!va.ok) setLoadError(va.error);
    else if (!iu.ok) setLoadError(iu.error);
    else setLoadError(null);
  }, []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void reload();
  }, [reload]);

  const filteredVendors = (vendorAccounts ?? []).filter((v) => v.name.toLowerCase().includes(vendorSearch.toLowerCase()));
  const selectedAccount = internalAccounts?.find((a) => a.role === selectedRole) ?? null;
  const selectedLabel = INTERNAL_ACCOUNTS.find((a) => a.role === selectedRole)?.label ?? selectedRole;
  const q = internalUserSearch.trim().toLowerCase();
  const roleUsers = (internalRoleUsers ?? []).filter((m) => m.role === selectedRole && (!q || `${m.username} ${m.name}`.toLowerCase().includes(q)));

  return (
    <AppShell role="sysadmin" activeHref="/sysadmin/accounts" breadcrumb={["Dashboard", "Akun & Password"]} title="Akun & Password">
      <Tabs
        items={[
          { key: "internal", label: "Akun Internal" },
          { key: "vendor", label: "Akun Vendor Produksi" },
        ]}
        active={tab}
        onChange={(k) => setTab(k as "internal" | "vendor")}
      />

      {loadError && <div className="mt-4 rounded-md border border-danger bg-danger-bg px-4 py-2.5 font-sans text-[12px] text-danger-fg">{loadError}</div>}

      {tab === "internal" && (
        <div className="mt-4 flex flex-col gap-4">
          <div className="flex flex-wrap gap-1.5">
            {INTERNAL_ACCOUNTS.map((a) => (
              <button
                key={a.role}
                onClick={() => setSelectedRole(a.role)}
                className={cn(
                  "rounded-full border px-3.5 py-1.5 font-sans text-[12px] font-semibold transition-colors",
                  selectedRole === a.role ? "border-action-primary bg-action-primary text-white" : "border-border-subtle bg-surface-card text-text-muted hover:text-text-primary"
                )}
              >
                {a.label}
              </button>
            ))}
          </div>

          <div className="overflow-hidden rounded-lg border border-border-subtle bg-surface-card">
            <div className="flex items-center gap-3 border-b border-border-subtle px-4 py-3">
              <span className="font-sans text-[13px] font-semibold text-text-primary">Password Modul — {selectedLabel}</span>
              <span className="font-sans text-[11px] text-text-muted">
                Sumber:{" "}
                {selectedAccount?.hasDbPassword ? <span className="font-semibold text-success-fg">Database</span> : <span className="text-warning-fg">Env var (belum diatur)</span>}
                {" · "}Terakhir diubah: {fmtTime(selectedAccount?.updatedAt)}
              </span>
              <Button onClick={() => selectedAccount && setEditingInternal(selectedAccount)} variant="ghost" size="xs" className="ml-auto">
                Ganti Password
              </Button>
            </div>

            <div className="flex items-center gap-2 border-b border-border-subtle bg-[#F7F9FB] px-4 py-3">
              <span className="font-sans text-[13px] font-semibold text-text-primary">Akun Login — {selectedLabel}</span>
              <input
                value={internalUserSearch}
                onChange={(e) => setInternalUserSearch(e.target.value)}
                placeholder="Cari username/nama…"
                className="input ml-auto w-[200px] !py-1 !text-[11.5px]"
              />
              <Button onClick={() => setShowAddInternalUser(true)} variant="dashed" size="sm">
                + Tambah Akun
              </Button>
            </div>
            <div className="grid grid-cols-[1fr_1fr_100px_260px] gap-x-4 border-b border-border-subtle bg-[#F7F9FB] px-4 py-[9px] font-sans text-[10.5px] font-medium uppercase tracking-wider text-text-muted">
              <span>Username</span>
              <span>Nama</span>
              <span>Status</span>
              <span className="text-right">Aksi</span>
            </div>
            {internalRoleUsers == null && <div className="px-4 py-6 text-center font-sans text-xs text-text-muted">Memuat…</div>}
            {internalRoleUsers != null && roleUsers.length === 0 && (
              <div className="px-4 py-6 text-center font-sans text-xs text-text-muted">Belum ada akun login untuk modul {selectedLabel}.</div>
            )}
            {roleUsers.map((m) => (
              <div key={m.id} className="grid grid-cols-[1fr_1fr_100px_260px] items-center gap-x-4 border-b border-[#F1F4F7] px-4 py-3 font-sans text-xs text-[#31414F] last:border-b-0">
                <span className="font-mono">{m.username}</span>
                <span>{m.name}</span>
                <span className={m.active ? "font-semibold text-success-fg" : "text-text-muted"}>{m.active ? "Aktif" : "Nonaktif"}</span>
                <span className="flex items-center justify-end gap-2">
                  <Button onClick={() => setEditingInternalUser(m)} variant="ghost" size="xs">
                    Edit
                  </Button>
                  <Button onClick={() => setTogglingInternalUser(m)} variant="ghost" size="xs">
                    {m.active ? "Nonaktifkan" : "Aktifkan"}
                  </Button>
                  <Button onClick={() => setDeletingInternalUser(m)} variant="danger" size="xs">
                    Hapus
                  </Button>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === "vendor" && (
        <div className="mt-4 flex flex-col gap-4">
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
        </div>
      )}

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

      {showAddInternalUser && <AddInternalRoleUserModal role={selectedRole} onClose={() => setShowAddInternalUser(false)} onDone={reload} />}
      {editingInternalUser && (
        <EditInternalRoleUserModal
          member={editingInternalUser}
          onClose={() => setEditingInternalUser(null)}
          onSaveName={async (name, reason) => {
            const res = await sysadminUpdateInternalRoleUserAction(editingInternalUser.id, { name }, reason);
            if (res.ok) void reload();
            return res.ok ? { ok: true } : { ok: false, error: res.error };
          }}
          onSavePassword={async (password, reason) => {
            const res = await sysadminResetInternalRoleUserPasswordAction(editingInternalUser.id, password, reason);
            if (res.ok) void reload();
            return res.ok ? { ok: true } : { ok: false, error: res.error };
          }}
        />
      )}
      {togglingInternalUser && (
        <ReasonModal
          title={`${togglingInternalUser.active ? "Nonaktifkan" : "Aktifkan"} — ${togglingInternalUser.username}`}
          onClose={() => setTogglingInternalUser(null)}
          onConfirm={async (reason) => {
            const res = await sysadminUpdateInternalRoleUserAction(togglingInternalUser.id, { active: !togglingInternalUser.active }, reason);
            if (res.ok) void reload();
            return res.ok ? { ok: true } : { ok: false, error: res.error };
          }}
        />
      )}
      {deletingInternalUser && (
        <ReasonModal
          title={`Hapus akun ${deletingInternalUser.username}`}
          danger
          onClose={() => setDeletingInternalUser(null)}
          onConfirm={async (reason) => {
            const res = await sysadminDeleteInternalRoleUserAction(deletingInternalUser.id, reason);
            if (res.ok) void reload();
            return res.ok ? { ok: true } : { ok: false, error: res.error };
          }}
        />
      )}
    </AppShell>
  );
}
