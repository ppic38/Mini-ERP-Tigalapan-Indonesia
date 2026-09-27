"use client";

import { useCallback, useEffect, useState } from "react";
import { AppShell } from "@/components/shell/app-shell";
import { Button } from "@/components/ui/button";
import { VendorAuthGuard } from "@/components/mrp/vendor-auth-guard";
import { VENDOR_PRODUKSI } from "@/lib/mrp/seed";
import {
  VENDOR_PAGE_OPTIONS,
  addVendorTeamMemberAction,
  deleteVendorTeamMemberAction,
  listVendorActionLogAction,
  listVendorTeamAction,
  resetVendorTeamMemberPasswordAction,
  updateVendorTeamMemberAction,
  type VendorActionLogRow,
  type VendorTeamMemberRow,
} from "@/lib/mrp/vendorTeamActions";

function fmtTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("id-ID", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function PageCheckboxes({ value, onChange }: { value: string[]; onChange: (next: string[]) => void }) {
  return (
    <div className="grid grid-cols-2 gap-1.5">
      {VENDOR_PAGE_OPTIONS.map((p) => {
        const checked = value.includes(p.href);
        return (
          <label key={p.href} className="flex items-center gap-1.5 rounded-md border border-[#E4E9EE] px-2 py-1.5 font-sans text-[11.5px] text-[#31414F]">
            <input
              type="checkbox"
              checked={checked}
              onChange={(e) => onChange(e.target.checked ? [...value, p.href] : value.filter((v) => v !== p.href))}
              className="h-3.5 w-3.5"
            />
            {p.label}
          </label>
        );
      })}
    </div>
  );
}

function AddMemberModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [username, setUsername] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [pages, setPages] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    setSaving(true);
    setError(null);
    const res = await addVendorTeamMemberAction({ username, name, password, allowedPages: pages });
    setSaving(false);
    if (!res.ok) return setError(res.error);
    onDone();
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0B131B]/45 p-4" onClick={onClose}>
      <div className="w-full max-w-[440px] rounded-lg bg-white shadow-[0_8px_24px_rgba(11,19,27,.2)]" onClick={(e) => e.stopPropagation()}>
        <div className="border-b border-border-subtle px-5 py-3.5 font-sans text-[13px] font-semibold text-text-primary">Tambah Anggota Tim</div>
        <div className="flex max-h-[70vh] flex-col gap-3 overflow-y-auto px-5 py-4">
          <div>
            <div className="mb-1 font-sans text-[10.5px] font-medium uppercase tracking-wider text-text-muted">Username (unik, tanpa spasi)</div>
            <input value={username} onChange={(e) => setUsername(e.target.value)} className="input w-full font-mono" placeholder="mis. budi.cutting" autoFocus />
          </div>
          <div>
            <div className="mb-1 font-sans text-[10.5px] font-medium uppercase tracking-wider text-text-muted">Nama</div>
            <input value={name} onChange={(e) => setName(e.target.value)} className="input w-full" placeholder="mis. Budi Santoso" />
          </div>
          <div>
            <div className="mb-1 font-sans text-[10.5px] font-medium uppercase tracking-wider text-text-muted">Password (min. 6 karakter)</div>
            <input value={password} onChange={(e) => setPassword(e.target.value)} className="input w-full font-mono" />
          </div>
          <div>
            <div className="mb-1 font-sans text-[10.5px] font-medium uppercase tracking-wider text-text-muted">Halaman yang boleh diakses</div>
            <PageCheckboxes value={pages} onChange={setPages} />
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

function EditMemberModal({ member, onClose, onDone }: { member: VendorTeamMemberRow; onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState(member.name);
  const [pages, setPages] = useState<string[]>(member.allowedPages);
  const [newPassword, setNewPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    setSaving(true);
    setError(null);
    const res = await updateVendorTeamMemberAction(member.id, { name, allowedPages: pages });
    if (res.ok && newPassword.trim()) {
      const pwRes = await resetVendorTeamMemberPasswordAction(member.id, newPassword.trim());
      if (!pwRes.ok) {
        setSaving(false);
        return setError(pwRes.error);
      }
    }
    setSaving(false);
    if (!res.ok) return setError(res.error);
    onDone();
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0B131B]/45 p-4" onClick={onClose}>
      <div className="w-full max-w-[440px] rounded-lg bg-white shadow-[0_8px_24px_rgba(11,19,27,.2)]" onClick={(e) => e.stopPropagation()}>
        <div className="border-b border-border-subtle px-5 py-3.5 font-sans text-[13px] font-semibold text-text-primary">
          Edit — <span className="font-mono">{member.username}</span>
        </div>
        <div className="flex max-h-[70vh] flex-col gap-3 overflow-y-auto px-5 py-4">
          <div>
            <div className="mb-1 font-sans text-[10.5px] font-medium uppercase tracking-wider text-text-muted">Nama</div>
            <input value={name} onChange={(e) => setName(e.target.value)} className="input w-full" />
          </div>
          <div>
            <div className="mb-1 font-sans text-[10.5px] font-medium uppercase tracking-wider text-text-muted">Halaman yang boleh diakses</div>
            <PageCheckboxes value={pages} onChange={setPages} />
          </div>
          <div>
            <div className="mb-1 font-sans text-[10.5px] font-medium uppercase tracking-wider text-text-muted">Reset password (kosongkan kalau tidak diganti)</div>
            <input value={newPassword} onChange={(e) => setNewPassword(e.target.value)} className="input w-full font-mono" placeholder="Password baru (min. 6 karakter)" />
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

function TeamContent({ vendorId }: { vendorId: string }) {
  const [members, setMembers] = useState<VendorTeamMemberRow[] | null>(null);
  const [logs, setLogs] = useState<VendorActionLogRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState<VendorTeamMemberRow | null>(null);
  const [showLog, setShowLog] = useState(false);

  const reload = useCallback(async () => {
    const res = await listVendorTeamAction();
    if (res.ok) setMembers(res.data);
    else setError(res.error);
  }, []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void reload();
  }, [reload]);

  async function toggleActive(m: VendorTeamMemberRow) {
    const res = await updateVendorTeamMemberAction(m.id, { active: !m.active });
    if (!res.ok) window.alert(res.error);
    void reload();
  }

  async function handleDelete(m: VendorTeamMemberRow) {
    if (!window.confirm(`Hapus akun ${m.username} (${m.name})? Aksi ini tidak bisa dibatalkan.`)) return;
    const res = await deleteVendorTeamMemberAction(m.id);
    if (!res.ok) window.alert(res.error);
    void reload();
  }

  async function openLog() {
    setShowLog(true);
    if (!logs) {
      const res = await listVendorActionLogAction();
      if (res.ok) setLogs(res.data);
    }
  }

  return (
    <AppShell
      role="vendorMaklon"
      vendorId={vendorId}
      activeHref="/vendor-maklon/team"
      breadcrumb={["Dashboard", "Tim Saya"]}
      title="Tim Saya"
      subtitle="Kelola akun anggota tim (cutting, finish good, packing, dst) & halaman yang boleh mereka akses"
      roleOverride={VENDOR_PRODUKSI[vendorId]?.name ?? vendorId}
      entityOverride="Vendor Produksi"
    >
      <div className="flex flex-col gap-4">
        {error && <div className="rounded-md border border-danger bg-danger-bg px-4 py-2.5 font-sans text-[12px] text-danger-fg">{error}</div>}

        <div className="overflow-hidden rounded-lg border border-border-subtle bg-surface-card">
          <div className="flex items-center gap-2 border-b border-border-subtle px-4 py-3">
            <span className="font-sans text-[13px] font-semibold text-text-primary">Anggota Tim</span>
            <div className="ml-auto flex items-center gap-1.5">
              <Button onClick={openLog} variant="ghost" size="sm">
                Riwayat Aksi
              </Button>
              <Button onClick={() => setShowAdd(true)} variant="dashed" size="sm">
                + Tambah Anggota
              </Button>
            </div>
          </div>
          <div className="grid grid-cols-[1fr_1fr_1.4fr_90px_150px] gap-x-3 border-b border-border-subtle bg-[#F7F9FB] px-4 py-[9px] font-sans text-[10.5px] font-medium uppercase tracking-wider text-text-muted">
            <span>Username</span>
            <span>Nama</span>
            <span>Halaman Diizinkan</span>
            <span>Status</span>
            <span className="text-right">Aksi</span>
          </div>
          {members == null && <div className="px-4 py-6 text-center font-sans text-xs text-text-muted">Memuat…</div>}
          {members != null && members.length === 0 && <div className="px-4 py-6 text-center font-sans text-xs text-text-muted">Belum ada anggota tim — klik &quot;+ Tambah Anggota&quot;.</div>}
          {members?.map((m) => (
            <div key={m.id} className="grid grid-cols-[1fr_1fr_1.4fr_90px_150px] items-center gap-x-3 border-b border-[#F1F4F7] px-4 py-[11px] font-sans text-xs text-[#31414F] last:border-b-0">
              <span className="font-mono">{m.username}</span>
              <span>{m.name}</span>
              <span className="text-[10.5px] text-text-muted">
                {m.allowedPages.map((p) => VENDOR_PAGE_OPTIONS.find((o) => o.href === p)?.label ?? p).join(", ") || "—"}
              </span>
              <span className={m.active ? "font-semibold text-success-fg" : "text-text-muted"}>{m.active ? "Aktif" : "Nonaktif"}</span>
              <span className="flex items-center justify-end gap-1.5">
                <Button onClick={() => setEditing(m)} variant="ghost" size="xs">
                  Edit
                </Button>
                <Button onClick={() => toggleActive(m)} variant="ghost" size="xs">
                  {m.active ? "Nonaktifkan" : "Aktifkan"}
                </Button>
                <Button onClick={() => handleDelete(m)} variant="danger" size="xs">
                  Hapus
                </Button>
              </span>
            </div>
          ))}
        </div>

        {showLog && (
          <div className="overflow-hidden rounded-lg border border-border-subtle bg-surface-card">
            <div className="border-b border-border-subtle px-4 py-3 font-sans text-[13px] font-semibold text-text-primary">Riwayat Aksi Tim</div>
            <div className="grid grid-cols-[150px_1fr_1fr] gap-x-3 border-b border-border-subtle bg-[#F7F9FB] px-4 py-[9px] font-sans text-[10.5px] font-medium uppercase tracking-wider text-text-muted">
              <span>Waktu</span>
              <span>Anggota</span>
              <span>Aksi</span>
            </div>
            {logs == null && <div className="px-4 py-6 text-center font-sans text-xs text-text-muted">Memuat…</div>}
            {logs != null && logs.length === 0 && <div className="px-4 py-6 text-center font-sans text-xs text-text-muted">Belum ada riwayat.</div>}
            {logs?.map((l) => (
              <div key={l.id} className="grid grid-cols-[150px_1fr_1fr] items-center gap-x-3 border-b border-[#F1F4F7] px-4 py-[10px] font-sans text-xs text-[#31414F] last:border-b-0">
                <span className="text-[11px] text-text-muted">{fmtTime(l.createdAt)}</span>
                <span className="font-medium">{l.actorName}</span>
                <span>{l.action}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {showAdd && <AddMemberModal onClose={() => setShowAdd(false)} onDone={reload} />}
      {editing && <EditMemberModal member={editing} onClose={() => setEditing(null)} onDone={reload} />}
    </AppShell>
  );
}

export default function VendorTeamPage() {
  return <VendorAuthGuard>{(vendorId) => <TeamContent vendorId={vendorId} />}</VendorAuthGuard>;
}
