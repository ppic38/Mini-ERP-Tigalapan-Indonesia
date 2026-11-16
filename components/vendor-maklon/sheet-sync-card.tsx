"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { getVendorSheetStatusAction, saveVendorSheetLinkAction, syncVendorSheetNowAction } from "@/lib/mrp/actions";
import { unwrapAction } from "@/lib/mrp/action-result";
import { useMrpStore } from "@/lib/mrp/store";
import type { SheetSyncSummary, VendorSheetStatus } from "@/lib/mrp/vendorSheet";

const STATUS_LABEL: Record<string, { text: string; cls: string }> = {
  OK: { text: "Berhasil", cls: "bg-success-bg text-success-fg" },
  ADA_MASALAH: { text: "Ada yang perlu diperiksa", cls: "bg-warning-bg text-warning-fg" },
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

/** Kartu "Sinkron Spreadsheet" di PO Produksi Saya (khusus vendor yang memakai fitur ini, mis. BAYU; owner 2026-11-16): tempel tautan "Publish to web", simpan, sinkron
 *  sekarang, dan lihat hasil terakhir termasuk baris yang ditolak ERP beserta alasannya. Pembacaan otomatis berjalan dari halaman manapun (StoreHydrator). */
export function SheetSyncCard() {
  const [status, setStatus] = useState<VendorSheetStatus>(null);
  const [loaded, setLoaded] = useState(false);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState<"save" | "sync" | null>(null);
  const [message, setMessage] = useState<{ tone: "ok" | "err"; text: string } | null>(null);
  const [lastRun, setLastRun] = useState<SheetSyncSummary | null>(null);
  const refresh = useMrpStore((s) => s.refresh);

  const load = useCallback(async () => {
    try {
      const s = unwrapAction(await getVendorSheetStatusAction());
      setStatus(s);
      if (s) setUrl((cur) => cur || s.url);
    } catch (e) {
      setMessage({ tone: "err", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setLoaded(true);
    }
  }, []);
  useEffect(() => {
    let alive = true;
    getVendorSheetStatusAction()
      .then((r) => {
        if (!alive) return;
        const s = unwrapAction(r);
        setStatus(s);
        if (s) setUrl((cur) => cur || s.url);
      })
      .catch((e) => {
        if (alive) setMessage({ tone: "err", text: e instanceof Error ? e.message : String(e) });
      })
      .finally(() => {
        if (alive) setLoaded(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  async function save() {
    setBusy("save");
    setMessage(null);
    try {
      const res = unwrapAction(await saveVendorSheetLinkAction(url, true));
      setMessage({ tone: "ok", text: `Tautan tersimpan. Tab terbaca: ${res.tabsFound.join(", ")} (${res.rows} baris).${res.issues.length > 0 ? ` ${res.issues.length} baris bermasalah, lihat hasil sinkron.` : ""} Klik "Sinkron sekarang" untuk menarik data.` });
      await load();
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
      const res = unwrapAction(await syncVendorSheetNowAction());
      setLastRun(res.summary);
      await load();
      if (res.summary.applied > 0) await refresh();
      setMessage({ tone: res.status === "GAGAL" ? "err" : "ok", text: res.status === "GAGAL" ? "Sinkron gagal." : `Selesai: ${res.summary.applied} perubahan diterapkan, ${res.summary.unchanged} sudah sama.` });
    } catch (e) {
      setMessage({ tone: "err", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  }

  const summary = lastRun ?? status?.summary ?? null;
  const badge = status?.lastStatus ? STATUS_LABEL[status.lastStatus] : null;

  return (
    <div className="mb-4 rounded-[10px] border border-border-subtle bg-white px-5 py-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-sans text-[13px] font-semibold text-text-primary">Sinkron Spreadsheet</span>
        {badge && <span className={"rounded px-2 py-0.5 font-sans text-[10.5px] font-semibold " + badge.cls}>{badge.text}</span>}
        {status && <span className="font-sans text-[11px] text-text-muted">Sinkron terakhir: {fmtTime(status.lastSyncAt)}</span>}
      </div>
      <p className="mt-1 font-sans text-[11.5px] leading-relaxed text-text-muted">
        Unduh <b>Template Sheet</b> (kolom di tabel PO di bawah), unggah ke Google Sheets, publikasikan ke web (File &gt; Bagikan &gt; Publikasikan ke web &gt; Seluruh dokumen &gt; Microsoft Excel .xlsx), lalu tempel tautannya di sini. Setelah itu ERP
        membaca spreadsheet otomatis tiap beberapa menit saat ada yang membuka ERP; perubahan dari Google bisa terlambat beberapa menit.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://docs.google.com/spreadsheets/d/e/…/pubhtml"
          className="min-w-[260px] flex-1 rounded-md border border-border-subtle bg-white px-2.5 py-[7px] font-mono text-[11.5px] text-[#31414F]"
        />
        <button
          onClick={() => void save()}
          disabled={busy !== null || !url.trim()}
          className="rounded-md bg-action-primary px-3 py-[7px] font-sans text-[11.5px] font-semibold text-white disabled:opacity-50"
        >
          {busy === "save" ? "Memeriksa…" : "Simpan tautan"}
        </button>
        <button
          onClick={() => void syncNow()}
          disabled={busy !== null || !status}
          className="inline-flex items-center gap-1.5 rounded-md border border-[#CBD5DF] px-3 py-[7px] font-sans text-[11.5px] font-semibold text-action-primary hover:bg-[#F2F4F7] disabled:opacity-50"
        >
          <RefreshCw size={12} className={busy === "sync" ? "animate-spin" : ""} />
          {busy === "sync" ? "Menyinkron…" : "Sinkron sekarang"}
        </button>
      </div>
      {message && <div className={"mt-2 font-sans text-[11.5px] font-medium " + (message.tone === "ok" ? "text-success-fg" : "text-danger-fg")}>{message.text}</div>}
      {!status && loaded && !message && <div className="mt-2 font-sans text-[11px] text-text-muted">Belum ada tautan tersimpan.</div>}
      {summary && (
        <div className="mt-3 border-t border-[#EEF1F4] pt-3 font-sans text-[11.5px] text-[#31414F]">
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
                    <span className="font-semibold text-[#31414F]">{it.tab}{it.row ? ` baris ${it.row}` : ""}:</span> {it.message}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </div>
  );
}
