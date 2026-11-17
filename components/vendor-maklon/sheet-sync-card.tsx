"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { getVendorSheetLinksAction, removeVendorSheetLinkAction, saveVendorSheetLinkAction, syncVendorSheetNowAction } from "@/lib/mrp/actions";
import { unwrapAction } from "@/lib/mrp/action-result";
import { useMrpStore } from "@/lib/mrp/store";
import type { SheetSyncSummary, VendorMrpSheetLink } from "@/lib/mrp/vendorSheet";

// Sinkron spreadsheet vendor (owner 2026-11-16, khusus BAYU): SATU spreadsheet "Publish to web" = SATU MRP. Tautan disimpan per MRP dan dibaca otomatis (dipicu halaman
// ERP, lihat StoreHydrator); tombol sinkron per MRP atau semua MRP untuk memaksa membaca ulang saat ada yang tidak sinkron.

const STATUS_LABEL: Record<string, { text: string; cls: string }> = {
  OK: { text: "Sinkron", cls: "bg-success-bg text-success-fg" },
  ADA_MASALAH: { text: "Perlu diperiksa", cls: "bg-warning-bg text-warning-fg" },
  GAGAL: { text: "Gagal", cls: "bg-danger-bg text-danger-fg" },
};

function fmtTime(iso: string | null) {
  if (!iso) return "belum pernah";
  try {
    return new Date(iso).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" });
  } catch {
    return iso;
  }
}

/** Daftar tautan per MRP milik vendor yang login; `reload` dipanggil setelah simpan/lepas/sinkron. */
export function useSheetLinks() {
  const [links, setLinks] = useState<VendorMrpSheetLink[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const reload = useCallback(async () => {
    try {
      setLinks(unwrapAction(await getVendorSheetLinksAction()));
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoaded(true);
    }
  }, []);
  useEffect(() => {
    let alive = true;
    getVendorSheetLinksAction()
      .then((r) => {
        if (alive) setLinks(unwrapAction(r));
      })
      .catch((e) => {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (alive) setLoaded(true);
      });
    return () => {
      alive = false;
    };
  }, []);
  return { links, loaded, error, reload };
}

/** Isi sel kolom "Spreadsheet" per MRP: status tautan + tombol Atur. */
export function SheetLinkCell({ link, onOpen }: { link?: VendorMrpSheetLink; onOpen: () => void }) {
  const badge = link?.lastStatus ? STATUS_LABEL[link.lastStatus] : null;
  return (
    <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
      {link ? (
        <span className={"rounded px-1.5 py-0.5 font-sans text-[10px] font-semibold " + (badge?.cls ?? "bg-info-bg text-info-fg")} title={`Sinkron terakhir: ${fmtTime(link.lastSyncAt)}`}>
          {badge?.text ?? "Tersambung"}
        </span>
      ) : (
        <span className="font-sans text-[10.5px] text-text-muted">Belum ada</span>
      )}
      <button onClick={onOpen} className="rounded-md border border-[#CBD5DF] px-2 py-0.5 font-sans text-[10.5px] font-semibold text-action-primary hover:bg-[#F2F4F7]">
        {link ? "Atur" : "Tambah"}
      </button>
    </div>
  );
}

/** Kartu ringkasan di atas tabel PO: petunjuk singkat, jumlah MRP tersambung, dan "Sinkron semua". */
export function SheetSyncSummaryCard({ links, loaded, error, reload }: { links: VendorMrpSheetLink[]; loaded: boolean; error: string; reload: () => Promise<void> }) {
  const refresh = useMrpStore((s) => s.refresh);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "err"; text: string } | null>(null);
  const problems = links.filter((l) => l.lastStatus === "ADA_MASALAH" || l.lastStatus === "GAGAL").length;

  async function syncAll() {
    setBusy(true);
    setMessage(null);
    try {
      const res = unwrapAction(await syncVendorSheetNowAction(null));
      const applied = res.reduce((s, r) => s + r.summary.applied, 0);
      await reload();
      if (applied > 0) await refresh();
      setMessage({ tone: "ok", text: `Selesai: ${res.length} MRP dibaca, ${applied} perubahan diterapkan.` });
    } catch (e) {
      setMessage({ tone: "err", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mb-4 rounded-[10px] border border-border-subtle bg-white px-5 py-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-sans text-[13px] font-semibold text-text-primary">Sinkron Spreadsheet</span>
        <span className="font-sans text-[11px] text-text-muted">
          {links.length} MRP tersambung{problems > 0 ? ` · ${problems} perlu diperiksa` : ""}
        </span>
        <button
          onClick={() => void syncAll()}
          disabled={busy || links.length === 0}
          className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-[#CBD5DF] px-3 py-[6px] font-sans text-[11.5px] font-semibold text-action-primary hover:bg-[#F2F4F7] disabled:opacity-50"
        >
          <RefreshCw size={12} className={busy ? "animate-spin" : ""} />
          {busy ? "Menyinkron…" : "Sinkron semua MRP"}
        </button>
      </div>
      <p className="mt-1 font-sans text-[11.5px] leading-relaxed text-text-muted">
        Satu spreadsheet = satu MRP. Unduh <b>Template Sheet</b> MRP itu, unggah ke Google Sheets, publikasikan ke web (File &gt; Bagikan &gt; Publikasikan ke web &gt; Seluruh dokumen &gt; Microsoft Excel .xlsx), lalu klik <b>Tambah</b> di kolom Spreadsheet
        dan tempel tautannya. Tautan baru bisa disimpan setelah minimal satu roll MRP itu di-Good Receive; data tiap roll baru diterima setelah rollnya di-Good Receive dan di-Resting. ERP lalu membaca spreadsheet otomatis tiap beberapa menit saat ada
        yang membuka ERP, jadi tombol sinkron hanya perlu dipakai kalau ada data yang belum sinkron.
      </p>
      {error && <div className="mt-2 font-sans text-[11.5px] font-medium text-danger-fg">{error}</div>}
      {message && <div className={"mt-2 font-sans text-[11.5px] font-medium " + (message.tone === "ok" ? "text-success-fg" : "text-danger-fg")}>{message.text}</div>}
      {loaded && !error && links.length === 0 && <div className="mt-2 font-sans text-[11px] text-text-muted">Belum ada MRP yang tersambung ke spreadsheet.</div>}
    </div>
  );
}

/** Popup tautan spreadsheet satu MRP: tempel/ganti tautan, sinkron MRP ini, lepas tautan, dan hasil sinkron terakhir (perubahan diterapkan + baris yang perlu diperiksa). */
export function SheetLinkDialog({ mrpId, link, onClose, onChanged }: { mrpId: string; link?: VendorMrpSheetLink; onClose: () => void; onChanged: () => Promise<void> }) {
  const refresh = useMrpStore((s) => s.refresh);
  const [url, setUrl] = useState(link?.url ?? "");
  const [busy, setBusy] = useState<"save" | "sync" | "remove" | null>(null);
  const [message, setMessage] = useState<{ tone: "ok" | "err"; text: string } | null>(null);
  const [lastRun, setLastRun] = useState<SheetSyncSummary | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function save() {
    setBusy("save");
    setMessage(null);
    try {
      const res = unwrapAction(await saveVendorSheetLinkAction(mrpId, url));
      setMessage({ tone: "ok", text: `Tautan tersimpan. Tab terbaca: ${res.tabsFound.join(", ")} (${res.rows} baris).${res.issues.length > 0 ? ` ${res.issues.length} baris bermasalah.` : ""} Klik "Sinkron MRP ini" untuk menarik data sekarang.` });
      setLastRun(null);
      await onChanged();
    } catch (e) {
      setMessage({ tone: "err", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  }

  async function syncNow() {
    setBusy("sync");
    setMessage(null);
    try {
      const res = unwrapAction(await syncVendorSheetNowAction(mrpId));
      const r = res[0];
      if (r) setLastRun(r.summary);
      await onChanged();
      if (r && r.summary.applied > 0) await refresh();
      setMessage({ tone: r?.status === "GAGAL" ? "err" : "ok", text: r?.status === "GAGAL" ? "Sinkron gagal." : `Selesai: ${r?.summary.applied ?? 0} perubahan diterapkan, ${r?.summary.unchanged ?? 0} sudah sama.` });
    } catch (e) {
      setMessage({ tone: "err", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    if (!window.confirm(`Lepas tautan spreadsheet MRP ${mrpId}? ERP berhenti membaca spreadsheet itu (data yang sudah masuk tetap).`)) return;
    setBusy("remove");
    setMessage(null);
    try {
      unwrapAction(await removeVendorSheetLinkAction(mrpId));
      await onChanged();
      onClose();
    } catch (e) {
      setMessage({ tone: "err", text: e instanceof Error ? e.message : String(e) });
      setBusy(null);
    }
  }

  const summary = lastRun ?? link?.summary ?? null;
  const badge = link?.lastStatus ? STATUS_LABEL[link.lastStatus] : null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0B131B]/45 p-4" onClick={onClose}>
      <div className="flex max-h-[90vh] w-full max-w-[640px] flex-col overflow-hidden rounded-[9px] bg-white shadow-[0_12px_32px_rgba(11,19,27,.28)]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2.5 bg-info-bg px-5 py-3">
          <span className="h-2 w-2 rounded-full bg-accent-blue" />
          <span className="font-sans text-xs font-semibold text-info-fg">Spreadsheet MRP {mrpId}</span>
          {badge && <span className={"rounded px-2 py-0.5 font-sans text-[10.5px] font-semibold " + badge.cls}>{badge.text}</span>}
          {link && <span className="ml-auto font-sans text-[10.5px] text-text-muted">Sinkron terakhir: {fmtTime(link.lastSyncAt)}</span>}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <label className="block font-sans text-[11px] font-medium uppercase tracking-wider text-text-muted">Tautan Publish to web</label>
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://docs.google.com/spreadsheets/d/e/…/pubhtml"
            className="mt-1 w-full rounded-md border border-border-subtle bg-white px-2.5 py-[8px] font-mono text-[11.5px] text-[#31414F]"
          />
          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            <button onClick={() => void save()} disabled={busy !== null || !url.trim()} className="rounded-md bg-action-primary px-3 py-[7px] font-sans text-[11.5px] font-semibold text-white disabled:opacity-50">
              {busy === "save" ? "Memeriksa…" : link ? "Ganti tautan" : "Simpan tautan"}
            </button>
            <button
              onClick={() => void syncNow()}
              disabled={busy !== null || !link}
              className="inline-flex items-center gap-1.5 rounded-md border border-[#CBD5DF] px-3 py-[7px] font-sans text-[11.5px] font-semibold text-action-primary hover:bg-[#F2F4F7] disabled:opacity-50"
            >
              <RefreshCw size={12} className={busy === "sync" ? "animate-spin" : ""} />
              {busy === "sync" ? "Menyinkron…" : "Sinkron MRP ini"}
            </button>
            {link && (
              <button onClick={() => void remove()} disabled={busy !== null} className="ml-auto font-sans text-[11.5px] font-semibold text-danger-fg disabled:opacity-50">
                Lepas tautan
              </button>
            )}
          </div>
          {message && <div className={"mt-2.5 font-sans text-[11.5px] font-medium " + (message.tone === "ok" ? "text-success-fg" : "text-danger-fg")}>{message.text}</div>}
          {summary && (
            <div className="mt-4 border-t border-[#EEF1F4] pt-3 font-sans text-[11.5px] text-[#31414F]">
              <div>
                Hasil terakhir: <b>{summary.applied}</b> perubahan diterapkan · {summary.unchanged} sudah sama{summary.pending > 0 ? ` · ${summary.pending} menunggu` : ""}
                {summary.tabsFound.length > 0 ? ` · tab: ${summary.tabsFound.join(", ")}` : ""}
              </div>
              {summary.note && <div className="mt-0.5 text-text-muted">{summary.note}</div>}
              {summary.appliedLabels.length > 0 && (
                <details className="mt-1.5">
                  <summary className="cursor-pointer font-semibold text-accent-blue">Perubahan yang diterapkan ({summary.appliedLabels.length})</summary>
                  <ul className="mt-1 list-disc pl-5 text-text-muted">
                    {summary.appliedLabels.map((l, i) => (
                      <li key={i}>{l}</li>
                    ))}
                  </ul>
                </details>
              )}
              {summary.issues.length > 0 && (
                <details className="mt-1.5" open>
                  <summary className="cursor-pointer font-semibold text-danger-fg">Perlu diperiksa ({summary.issues.length})</summary>
                  <ul className="mt-1 list-disc pl-5 text-text-muted">
                    {summary.issues.map((it, i) => (
                      <li key={i}>
                        <span className="font-semibold text-[#31414F]">
                          {it.tab}
                          {it.row ? ` baris ${it.row}` : ""}:
                        </span>{" "}
                        {it.message}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          )}
        </div>
        <div className="flex justify-end border-t border-[#EEF1F4] px-5 py-3">
          <button onClick={onClose} className="rounded-md border border-[#CBD5DF] px-4 py-[7px] font-sans text-[11.5px] font-semibold text-text-primary hover:bg-[#F2F4F7]">
            Tutup
          </button>
        </div>
      </div>
    </div>
  );
}
