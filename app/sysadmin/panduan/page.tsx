"use client";

import { useEffect, useState } from "react";
import { AppShell } from "@/components/shell/app-shell";
import { Button } from "@/components/ui/button";
import { confirmDialog } from "@/components/ui/confirm-dialog";
import { GuideMedia } from "@/components/guide/guide-media";
import { VENDOR_GUIDE_SECTIONS, type GuideItem, type GuideKind } from "@/lib/guide/sections";
import { imageSrcFromUrl, parseHttpsUrl, videoEmbedFromUrl } from "@/lib/guide/embed";
import { deleteGuideItemAction, listGuideItemsAction, moveGuideItemAction, saveGuideItemAction } from "@/lib/mrp/guideActions";

type FormState = { id?: string; sectionKey: string; kind: GuideKind; title: string; url: string; caption: string; active: boolean };

const KIND_LABEL: Record<GuideKind, string> = { VIDEO: "Video", IMAGE: "Gambar", LINK: "Tautan" };
const KIND_HINT: Record<GuideKind, string> = {
  VIDEO: "Tempel tautan video YouTube (disarankan: Unlisted), Vimeo, Loom, atau tautan berbagi file Google Drive. Video disematkan di halaman panduan.",
  IMAGE: "Tempel tautan gambar langsung (https). Gambar Google Drive: bagikan sebagai \"Siapa saja yang memiliki link\", lalu tempel tautan berbagi file.",
  LINK: "Tautan biasa (https) yang dibuka di tab baru, misalnya dokumen PDF atau halaman bantuan.",
};

/** Kelola media panduan (video, gambar, tautan) yang tampil di halaman Panduan Penggunaan portal Vendor Produksi
 *  (owner 2026-10-22, migration 0073). Hanya tautan yang disimpan -- file video/gambar ditaruh di layanan lain
 *  (YouTube, Google Drive, dst.). */
export default function SysadminPanduanPage() {
  const [items, setItems] = useState<GuideItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState<GuideItem | null>(null);

  async function reload() {
    const res = await listGuideItemsAction("vendor");
    if (res.ok) {
      setItems(res.data);
      setError(null);
    } else {
      setError(res.error);
      setItems([]);
    }
  }

  useEffect(() => {
    void listGuideItemsAction("vendor").then((res) => {
      if (res.ok) setItems(res.data);
      else {
        setError(res.error);
        setItems([]);
      }
    });
  }, []);

  function openNew(sectionKey: string) {
    setFormError(null);
    setForm({ sectionKey, kind: "VIDEO", title: "", url: "", caption: "", active: true });
  }
  function openEdit(it: GuideItem) {
    setFormError(null);
    setForm({ id: it.id, sectionKey: it.sectionKey, kind: it.kind, title: it.title, url: it.url, caption: it.caption, active: it.active });
  }

  async function save() {
    if (!form || saving) return;
    setSaving(true);
    setFormError(null);
    const res = await saveGuideItemAction({ id: form.id, sectionKey: form.sectionKey, kind: form.kind, title: form.title, url: form.url, caption: form.caption, active: form.active });
    setSaving(false);
    if (!res.ok) {
      setFormError(res.error);
      return;
    }
    setForm(null);
    await reload();
  }

  async function toggleActive(it: GuideItem) {
    const res = await saveGuideItemAction({ id: it.id, sectionKey: it.sectionKey, kind: it.kind, title: it.title, url: it.url, caption: it.caption, active: !it.active });
    if (!res.ok) setError(res.error);
    await reload();
  }

  async function move(it: GuideItem, direction: "UP" | "DOWN") {
    const res = await moveGuideItemAction(it.id, direction);
    if (!res.ok) setError(res.error);
    await reload();
  }

  async function remove(it: GuideItem) {
    const ok = await confirmDialog({ title: "Hapus media panduan?", message: `"${it.title || it.url}" akan dihapus dari halaman panduan vendor.`, confirmLabel: "Hapus", tone: "danger" });
    if (!ok) return;
    const res = await deleteGuideItemAction(it.id);
    if (!res.ok) setError(res.error);
    await reload();
  }

  // Pratinjau langsung di form selama tautan valid.
  const previewable =
    form && parseHttpsUrl(form.url) && ((form.kind === "VIDEO" && videoEmbedFromUrl(form.url)) || (form.kind === "IMAGE" && imageSrcFromUrl(form.url)) || form.kind === "LINK");

  return (
    <AppShell
      role="sysadmin"
      activeHref="/sysadmin/panduan"
      breadcrumb={["Dashboard", "Panduan Vendor"]}
      title="Panduan Vendor"
      subtitle="Sematkan video, gambar, dan tautan tutorial ke halaman Panduan Penggunaan portal Vendor Produksi."
    >
      {error && <div className="rounded-md border border-danger bg-danger-bg px-4 py-2.5 font-sans text-[12px] text-danger-fg">{error}</div>}
      {items == null && !error && <div className="font-sans text-xs text-text-muted">Memuat…</div>}

      <div className="flex flex-col gap-3">
        {VENDOR_GUIDE_SECTIONS.map((sec) => {
          const list = (items ?? []).filter((i) => i.sectionKey === sec.key);
          return (
            <div key={sec.key} className="overflow-hidden rounded-lg border border-border-subtle bg-surface-card">
              <div className="flex items-center justify-between gap-2 border-b border-border-subtle bg-[#F7F9FB] px-4 py-2.5">
                <span className="font-sans text-[13px] font-semibold text-text-primary">
                  {sec.title} <span className="font-mono text-[11px] font-normal text-text-muted">({list.length} media)</span>
                </span>
                <Button variant="primary" size="sm" onClick={() => openNew(sec.key)}>
                  + Tambah media
                </Button>
              </div>
              {list.length === 0 ? (
                <div className="px-4 py-3 font-sans text-[11.5px] text-text-muted">Belum ada media. Bagian ini hanya menampilkan teks panduan.</div>
              ) : (
                list.map((it, idx) => (
                  <div key={it.id} className="grid grid-cols-[70px_1fr_auto] items-center gap-x-3 border-b border-[#F1F4F7] px-4 py-2.5 font-sans text-xs text-[#31414F] last:border-b-0 max-md:grid-cols-1 max-md:gap-y-1.5">
                    <span className="flex items-center gap-1.5">
                      <span className="rounded bg-[#EEF3F8] px-1.5 py-0.5 text-[10.5px] font-semibold text-info-fg">{KIND_LABEL[it.kind]}</span>
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate font-medium">
                        {it.title || <span className="text-text-muted">(tanpa judul)</span>}
                        {!it.active && <span className="ml-2 rounded bg-[#FDECEA] px-1.5 py-0.5 text-[10px] font-semibold text-danger-fg">Disembunyikan</span>}
                      </span>
                      <span className="block truncate font-mono text-[10.5px] text-text-muted">{it.url}</span>
                      {it.caption && <span className="block truncate text-[11px] text-text-muted">{it.caption}</span>}
                    </span>
                    <span className="flex flex-wrap items-center justify-end gap-1.5">
                      <Button size="xs" variant="muted" onClick={() => void move(it, "UP")} disabled={idx === 0} aria-label="Naikkan">
                        ▲
                      </Button>
                      <Button size="xs" variant="muted" onClick={() => void move(it, "DOWN")} disabled={idx === list.length - 1} aria-label="Turunkan">
                        ▼
                      </Button>
                      <Button size="xs" variant="ghost" onClick={() => setPreview(it)}>
                        Lihat
                      </Button>
                      <Button size="xs" variant="ghost" onClick={() => void toggleActive(it)}>
                        {it.active ? "Sembunyikan" : "Tampilkan"}
                      </Button>
                      <Button size="xs" variant="accent" onClick={() => openEdit(it)}>
                        Edit
                      </Button>
                      <Button size="xs" variant="danger" onClick={() => void remove(it)}>
                        Hapus
                      </Button>
                    </span>
                  </div>
                ))
              )}
            </div>
          );
        })}
      </div>

      {preview && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-[#0B131B]/45 p-4 sm:p-8" onClick={() => setPreview(null)}>
          <div className="my-auto w-full max-w-[760px] rounded-lg bg-white shadow-[0_8px_24px_rgba(11,19,27,.2)]" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-border-subtle px-4 py-3">
              <span className="font-sans text-[13px] font-semibold text-text-primary">Pratinjau</span>
              <Button size="xs" variant="ghost" onClick={() => setPreview(null)}>
                Tutup
              </Button>
            </div>
            <div className="p-4">
              <GuideMedia item={preview} />
            </div>
          </div>
        </div>
      )}

      {form && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-[#0B131B]/45 p-4 sm:p-8">
          <div className="my-auto w-full max-w-[640px] rounded-lg bg-white shadow-[0_8px_24px_rgba(11,19,27,.2)]">
            <div className="border-b border-border-subtle px-5 py-3.5 font-sans text-[13px] font-semibold text-text-primary">{form.id ? "Edit media panduan" : "Tambah media panduan"}</div>
            <div className="flex flex-col gap-3 px-5 py-4 font-sans text-xs text-[#31414F]">
              <label className="flex flex-col gap-1">
                <span className="text-[10.5px] font-medium uppercase tracking-wider text-text-muted">Bagian panduan</span>
                <select value={form.sectionKey} onChange={(e) => setForm({ ...form, sectionKey: e.target.value })} className="input">
                  {VENDOR_GUIDE_SECTIONS.map((s) => (
                    <option key={s.key} value={s.key}>
                      {s.title}
                    </option>
                  ))}
                </select>
              </label>
              <div className="flex flex-col gap-1">
                <span className="text-[10.5px] font-medium uppercase tracking-wider text-text-muted">Jenis</span>
                <div className="inline-flex overflow-hidden rounded-md border border-[#CBD5DF]">
                  {(["VIDEO", "IMAGE", "LINK"] as GuideKind[]).map((k) => (
                    <button
                      key={k}
                      type="button"
                      onClick={() => setForm({ ...form, kind: k })}
                      className={"px-3.5 py-1.5 text-[11.5px] font-semibold " + (form.kind === k ? "bg-accent-blue text-white" : "bg-white text-action-primary hover:bg-info-bg") + (k !== "VIDEO" ? " border-l border-[#CBD5DF]" : "")}
                    >
                      {KIND_LABEL[k]}
                    </button>
                  ))}
                </div>
                <span className="text-[11px] text-text-muted">{KIND_HINT[form.kind]}</span>
              </div>
              <label className="flex flex-col gap-1">
                <span className="text-[10.5px] font-medium uppercase tracking-wider text-text-muted">Judul {form.kind === "LINK" ? "(wajib)" : "(opsional)"}</span>
                <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} maxLength={120} className="input" placeholder="Contoh: Cara Good Receive" />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[10.5px] font-medium uppercase tracking-wider text-text-muted">Tautan (https)</span>
                <input value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} className="input font-mono text-[11.5px]" placeholder="https://www.youtube.com/watch?v=..." />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[10.5px] font-medium uppercase tracking-wider text-text-muted">Keterangan (opsional)</span>
                <textarea value={form.caption} onChange={(e) => setForm({ ...form, caption: e.target.value })} maxLength={400} rows={2} className="input" placeholder="Penjelasan singkat di bawah media" />
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} className="h-3.5 w-3.5" />
                <span>Tampilkan di halaman panduan vendor</span>
              </label>
              {previewable && (
                <div className="rounded-md border border-dashed border-[#CBD5DF] bg-[#FAFBFC] p-3">
                  <div className="mb-2 text-[10.5px] font-medium uppercase tracking-wider text-text-muted">Pratinjau</div>
                  <GuideMedia item={{ kind: form.kind, title: form.title, url: form.url, caption: form.caption }} />
                </div>
              )}
              {formError && <div className="rounded-md border border-danger bg-danger-bg px-3 py-2 text-[11.5px] text-danger-fg">{formError}</div>}
            </div>
            <div className="flex justify-end gap-2 border-t border-border-subtle px-5 py-3.5">
              <Button variant="ghost" size="md" onClick={() => setForm(null)} disabled={saving}>
                Batal
              </Button>
              <Button variant="primary" size="md" onClick={() => void save()} disabled={saving || !form.url.trim()}>
                {saving ? "Menyimpan…" : "Simpan"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}
