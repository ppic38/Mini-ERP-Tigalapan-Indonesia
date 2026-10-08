"use client";

import { useEffect, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { AppShell } from "@/components/shell/app-shell";
import { Button } from "@/components/ui/button";
import { alertDialog, confirmDialog } from "@/components/ui/confirm-dialog";
import { VendorAuthGuard } from "@/components/mrp/vendor-auth-guard";
import { VENDOR_PRODUKSI } from "@/lib/mrp/seed";
import { useVendorTeamStore, type TeamMember } from "@/lib/mrp/vendor-team-store";
import { describeVendorPermissions } from "@/lib/mrp/vendorPages";
import { VendorPermissionPicker } from "@/components/mrp/vendor-permission-picker";

function fmtTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("id-ID", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

/** Aturan yang sama dengan server (addVendorTeamMemberAction) -- dicek di sini dulu supaya kesalahan ketik
 *  langsung tampil tanpa menunggu server, dan supaya penyimpanan yang lolos bisa langsung dianggap berhasil. */
function validateMember(input: { username?: string; name: string; password?: string; pages: string[] }, isNew: boolean): string | null {
  if (isNew && !/^[a-zA-Z0-9._-]{3,32}$/.test((input.username ?? "").trim())) return "Username 3-32 karakter, huruf/angka/titik/garis (tanpa spasi).";
  if (!input.name.trim()) return "Nama wajib diisi.";
  if (isNew && (input.password ?? "").length < 6) return "Password minimal 6 karakter.";
  if (!isNew && input.password && input.password.length < 6) return "Password baru minimal 6 karakter.";
  if (input.pages.length === 0) return "Pilih minimal 1 halaman yang boleh diakses.";
  return null;
}

type AddDraft = { username: string; name: string; password: string; pages: string[] };

function AddMemberModal({ initial, onClose, onSubmit }: { initial?: AddDraft; onClose: () => void; onSubmit: (draft: AddDraft) => void }) {
  const [username, setUsername] = useState(initial?.username ?? "");
  const [name, setName] = useState(initial?.name ?? "");
  const [password, setPassword] = useState(initial?.password ?? "");
  const [pages, setPages] = useState<string[]>(initial?.pages ?? []);
  const [error, setError] = useState<string | null>(null);

  function handleSave() {
    const msg = validateMember({ username, name, password, pages }, true);
    if (msg) return setError(msg);
    onSubmit({ username: username.trim(), name: name.trim(), password, pages });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0B131B]/45 p-4" onClick={onClose}>
      <div className="w-full max-w-[620px] rounded-lg bg-white shadow-[0_8px_24px_rgba(11,19,27,.2)]" onClick={(e) => e.stopPropagation()}>
        <div className="border-b border-border-subtle px-5 py-3.5 font-sans text-[13px] font-semibold text-text-primary">Tambah Anggota Tim</div>
        <div className="flex max-h-[70vh] flex-col gap-3 overflow-y-auto px-5 py-4">
          <div>
            <div className="mb-1 font-sans text-[10.5px] font-medium uppercase tracking-wider text-text-muted">Username (unik, tanpa spasi)</div>
            <input value={username} onChange={(e) => setUsername(e.target.value)} className="input w-full font-mono" autoFocus />
          </div>
          <div>
            <div className="mb-1 font-sans text-[10.5px] font-medium uppercase tracking-wider text-text-muted">Nama</div>
            <input value={name} onChange={(e) => setName(e.target.value)} className="input w-full" />
          </div>
          <div>
            <div className="mb-1 font-sans text-[10.5px] font-medium uppercase tracking-wider text-text-muted">Password (min. 6 karakter)</div>
            <input value={password} onChange={(e) => setPassword(e.target.value)} className="input w-full font-mono" />
          </div>
          <div>
            <div className="mb-1 font-sans text-[10.5px] font-medium uppercase tracking-wider text-text-muted">Halaman yang boleh diakses</div>
            <VendorPermissionPicker value={pages} onChange={setPages} />
          </div>
          {error && <div className="rounded-md border border-danger bg-danger-bg px-3 py-2 font-sans text-[11.5px] text-danger-fg">{error}</div>}
        </div>
        <div className="flex justify-end gap-2 border-t border-border-subtle px-5 py-3.5">
          <button onClick={onClose} className="rounded-md border border-[#CBD5DF] bg-white px-3.5 py-[7px] font-sans text-xs font-semibold text-action-primary">
            Batal
          </button>
          <Button onClick={handleSave} variant="primary" size="sm">
            Tambah
          </Button>
        </div>
      </div>
    </div>
  );
}

function EditMemberModal({
  member,
  onClose,
  onSubmit,
}: {
  member: TeamMember;
  onClose: () => void;
  onSubmit: (v: { name: string; pages: string[]; newPassword: string }) => void;
}) {
  const [name, setName] = useState(member.name);
  const [pages, setPages] = useState<string[]>(member.allowedPages);
  const [newPassword, setNewPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  function handleSave() {
    const msg = validateMember({ name, password: newPassword.trim(), pages }, false);
    if (msg) return setError(msg);
    onSubmit({ name: name.trim(), pages, newPassword: newPassword.trim() });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0B131B]/45 p-4" onClick={onClose}>
      <div className="w-full max-w-[620px] rounded-lg bg-white shadow-[0_8px_24px_rgba(11,19,27,.2)]" onClick={(e) => e.stopPropagation()}>
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
            <VendorPermissionPicker value={pages} onChange={setPages} />
          </div>
          <div>
            <div className="mb-1 font-sans text-[10.5px] font-medium uppercase tracking-wider text-text-muted">Ganti password (kosongkan kalau tidak diganti)</div>
            <input value={newPassword} onChange={(e) => setNewPassword(e.target.value)} className="input w-full font-mono" />
          </div>
          {error && <div className="rounded-md border border-danger bg-danger-bg px-3 py-2 font-sans text-[11.5px] text-danger-fg">{error}</div>}
        </div>
        <div className="flex justify-end gap-2 border-t border-border-subtle px-5 py-3.5">
          <button onClick={onClose} className="rounded-md border border-[#CBD5DF] bg-white px-3.5 py-[7px] font-sans text-xs font-semibold text-action-primary">
            Batal
          </button>
          <Button onClick={handleSave} variant="primary" size="sm">
            Simpan
          </Button>
        </div>
      </div>
    </div>
  );
}

/** Kolom password: titik-titik + tombol mata. Password hanya diambil dari server saat mata diklik, lalu diingat
 *  selama halaman terbuka (tidak ikut dimuat bersama daftar anggota). */
function PasswordCell({ member }: { member: TeamMember }) {
  const revealPassword = useVendorTeamStore((s) => s.revealPassword);
  const [state, setState] = useState<{ shown: boolean; value: string | null | undefined; loading: boolean }>({ shown: false, value: undefined, loading: false });

  async function toggle() {
    if (state.shown) return setState((s) => ({ ...s, shown: false }));
    if (state.value !== undefined) return setState((s) => ({ ...s, shown: true }));
    setState((s) => ({ ...s, loading: true }));
    try {
      const pw = await revealPassword(member.id);
      setState({ shown: true, value: pw, loading: false });
    } catch (err) {
      setState((s) => ({ ...s, loading: false }));
      void alertDialog({ title: "Gagal menampilkan password", message: err instanceof Error ? err.message : String(err), tone: "danger" });
    }
  }

  return (
    <span className="flex items-center gap-1.5">
      {state.shown ? (
        state.value ? (
          <span className="select-all font-mono text-[12px] text-text-primary">{state.value}</span>
        ) : (
          <span className="font-sans text-[10.5px] leading-tight text-text-muted">Belum tersimpan — atur ulang lewat Edit</span>
        )
      ) : (
        <span className="font-mono text-[12px] tracking-widest text-text-muted">••••••••</span>
      )}
      <button
        type="button"
        onClick={toggle}
        disabled={member.pending || state.loading}
        aria-label={state.shown ? "Sembunyikan password" : "Lihat password"}
        title={state.shown ? "Sembunyikan password" : "Lihat password"}
        className="flex h-6 w-6 flex-none items-center justify-center rounded text-text-muted hover:bg-[#F1F4F7] hover:text-text-primary disabled:opacity-40"
      >
        {state.shown ? <EyeOff size={14} /> : <Eye size={14} />}
      </button>
    </span>
  );
}

const ROW_GRID = "minmax(100px,1fr) minmax(110px,1.1fr) 170px minmax(150px,1.5fr) 86px 224px";

function TeamContent({ vendorId }: { vendorId: string }) {
  const members = useVendorTeamStore((s) => s.members);
  const logs = useVendorTeamStore((s) => s.logs);
  const loadTeam = useVendorTeamStore((s) => s.loadTeam);
  const loadLogs = useVendorTeamStore((s) => s.loadLogs);
  const addMember = useVendorTeamStore((s) => s.addMember);
  const updateMember = useVendorTeamStore((s) => s.updateMember);
  const resetPassword = useVendorTeamStore((s) => s.resetPassword);
  const removeMember = useVendorTeamStore((s) => s.removeMember);

  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState<{ draft?: AddDraft } | null>(null);
  const [editing, setEditing] = useState<TeamMember | null>(null);
  const [showLog, setShowLog] = useState(false);
  // Naik tiap kali password anggota diganti -- membuat kolom password dibuat ulang (tidak menampilkan nilai lama yang diingat).
  const [pwVersion, setPwVersion] = useState<Record<string, number>>({});

  // Data lama (kalau ada) langsung tampil; yang baru diambil di belakang layar.
  useEffect(() => {
    loadTeam(vendorId).catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [vendorId, loadTeam]);

  function fail(title: string, err: unknown) {
    void alertDialog({ title, message: err instanceof Error ? err.message : String(err), tone: "danger" });
  }

  function submitAdd(draft: AddDraft) {
    setAdding(null); // modal langsung tertutup -- baris baru sudah muncul di tabel
    addMember({ username: draft.username, name: draft.name, password: draft.password, allowedPages: draft.pages }).catch(async (err) => {
      await alertDialog({ title: "Anggota tim tidak jadi ditambahkan", message: err instanceof Error ? err.message : String(err), tone: "danger" });
      setAdding({ draft }); // buka lagi dengan isian tadi supaya tinggal diperbaiki
    });
  }

  function submitEdit(member: TeamMember, v: { name: string; pages: string[]; newPassword: string }) {
    setEditing(null);
    updateMember(member.id, { name: v.name, allowedPages: v.pages }).catch((err) => fail("Perubahan tidak tersimpan", err));
    if (v.newPassword) {
      setPwVersion((p) => ({ ...p, [member.id]: (p[member.id] ?? 0) + 1 }));
      resetPassword(member.id, v.newPassword).catch((err) => fail("Password tidak berhasil diganti", err));
    }
  }

  async function handleDelete(m: TeamMember) {
    const ok = await confirmDialog({ title: `Hapus akun ${m.username}?`, message: `Akun ${m.name} (${m.username}) akan dihapus. Aksi ini tidak bisa dibatalkan.`, confirmLabel: "Hapus akun", tone: "danger" });
    if (!ok) return;
    removeMember(m.id).catch((err) => fail("Akun tidak berhasil dihapus", err));
  }

  function openLog() {
    setShowLog(true);
    void loadLogs(vendorId);
  }

  return (
    <AppShell
      role="vendorMaklon"
      vendorId={vendorId}
      activeHref="/vendor-maklon/team"
      breadcrumb={["Dashboard", "Tim Saya"]}
      title="Tim Saya"
      subtitle="Buat akun untuk anggota tim Anda dan atur halaman apa saja yang boleh mereka buka."
      roleOverride={VENDOR_PRODUKSI[vendorId]?.name ?? vendorId}
      entityOverride="Vendor Produksi"
    >
      <div className="flex flex-col gap-4">
        {error && <div className="rounded-md border border-danger bg-danger-bg px-4 py-2.5 font-sans text-[12px] text-danger-fg">{error}</div>}

        <div className="overflow-hidden rounded-lg border border-border-subtle bg-surface-card">
          <div className="flex flex-wrap items-center gap-2 border-b border-border-subtle px-4 py-3">
            <span className="font-sans text-[13px] font-semibold text-text-primary">Anggota Tim</span>
            <div className="ml-auto flex items-center gap-1.5">
              <Button onClick={openLog} variant="ghost" size="sm">
                Riwayat Aksi
              </Button>
              <Button onClick={() => setAdding({})} variant="dashed" size="sm">
                + Tambah Anggota
              </Button>
            </div>
          </div>
          <div className="overflow-x-auto">
            <div className="m-fluid min-w-[1020px]">
              <div className="m-hide grid gap-x-3 border-b border-border-subtle bg-[#F7F9FB] px-4 py-[9px] font-sans text-[10.5px] font-medium uppercase tracking-wider text-text-muted" style={{ gridTemplateColumns: ROW_GRID }}>
                <span>Username</span>
                <span>Nama</span>
                <span>Password</span>
                <span>Halaman Diizinkan</span>
                <span>Status</span>
                <span className="text-right">Aksi</span>
              </div>
              {members == null && !error && <div className="px-4 py-6 text-center font-sans text-xs text-text-muted">Memuat…</div>}
              {members != null && members.length === 0 && <div className="px-4 py-6 text-center font-sans text-xs text-text-muted">Belum ada anggota tim — klik &quot;+ Tambah Anggota&quot;.</div>}
              {members?.map((m) => (
                <div
                  key={m.id}
                  className={"m-stack m-grid2 grid items-center gap-x-3 border-b border-[#F1F4F7] px-4 py-[11px] font-sans text-xs text-[#31414F] last:border-b-0 max-md:py-3 " + (m.pending ? "opacity-60" : "")}
                  style={{ gridTemplateColumns: ROW_GRID }}
                >
                  <span className="truncate font-mono max-md:text-[13px] max-md:font-semibold">{m.username}</span>
                  <span data-label="Nama" className="truncate">{m.name}</span>
                  <span data-label="Password" className="max-md:order-3 max-md:col-span-full">
                    <PasswordCell key={m.id + ":" + (pwVersion[m.id] ?? 0)} member={m} />
                  </span>
                  <span data-label="Halaman diizinkan" className="text-[10.5px] leading-snug text-text-muted max-md:order-4 max-md:col-span-full">
                    {describeVendorPermissions(m.allowedPages)}
                  </span>
                  <span data-label="Status" className={"max-md:order-1 " + (m.active ? "font-semibold text-success-fg" : "text-text-muted")}>
                    {m.pending ? "Menyimpan…" : m.active ? "Aktif" : "Nonaktif"}
                  </span>
                  <span className="flex flex-nowrap items-center justify-end gap-1.5 whitespace-nowrap max-md:order-5 max-md:justify-start">
                    <Button onClick={() => setEditing(m)} disabled={m.pending} variant="ghost" size="xs">
                      Edit
                    </Button>
                    <Button onClick={() => updateMember(m.id, { active: !m.active }).catch((err) => fail("Status akun tidak berubah", err))} disabled={m.pending} variant="ghost" size="xs">
                      {m.active ? "Nonaktifkan" : "Aktifkan"}
                    </Button>
                    <Button onClick={() => handleDelete(m)} disabled={m.pending} variant="danger" size="xs">
                      Hapus
                    </Button>
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {showLog && (
          <div className="overflow-hidden rounded-lg border border-border-subtle bg-surface-card">
            <div className="border-b border-border-subtle px-4 py-3 font-sans text-[13px] font-semibold text-text-primary">Riwayat Aksi Tim</div>
            <div className="m-hide grid grid-cols-[150px_1fr_1fr] gap-x-3 border-b border-border-subtle bg-[#F7F9FB] px-4 py-[9px] font-sans text-[10.5px] font-medium uppercase tracking-wider text-text-muted">
              <span>Waktu</span>
              <span>Anggota</span>
              <span>Aksi</span>
            </div>
            {logs == null && <div className="px-4 py-6 text-center font-sans text-xs text-text-muted">Memuat…</div>}
            {logs != null && logs.length === 0 && <div className="px-4 py-6 text-center font-sans text-xs text-text-muted">Belum ada riwayat.</div>}
            {logs?.map((l) => (
              <div key={l.id} className="m-stack grid grid-cols-[150px_1fr_1fr] items-center gap-x-3 border-b border-[#F1F4F7] px-4 py-[10px] font-sans text-xs text-[#31414F] last:border-b-0 max-md:gap-y-1 max-md:py-3">
                <span data-label="Waktu" className="text-[11px] text-text-muted">{fmtTime(l.createdAt)}</span>
                <span data-label="Anggota" className="font-medium">{l.actorName}</span>
                <span data-label="Aksi">{l.action}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {adding && <AddMemberModal initial={adding.draft} onClose={() => setAdding(null)} onSubmit={submitAdd} />}
      {editing && <EditMemberModal member={editing} onClose={() => setEditing(null)} onSubmit={(v) => submitEdit(editing, v)} />}
    </AppShell>
  );
}

export default function VendorTeamPage() {
  return <VendorAuthGuard>{(vendorId) => <TeamContent vendorId={vendorId} />}</VendorAuthGuard>;
}
