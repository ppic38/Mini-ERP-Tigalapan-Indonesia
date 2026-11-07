"use client";

import { useCallback, useEffect, useState } from "react";
import { AppShell } from "@/components/shell/app-shell";
import { Button } from "@/components/ui/button";
import { enqueueOldResisAction, getWosOutboxSummaryAction, refreshWosHppAction, resetWosOutboxAction, sendWosOutboxAction, type WosOutboxSummary } from "@/lib/mrp/wosActions";

const DEST_LABEL: Record<WosOutboxSummary["destination"], string> = {
  SHEETS: "Google Sheets (tab ERP_INCOMING)",
  WEBHOOK: "Webhook ke endpoint WOS",
  NONE: "Belum dikonfigurasi (env belum lengkap, tidak ada yang dikirim)",
};

function fmtTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("id-ID", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

/** Pantau dan jalankan pengiriman data resi ke WOS (owner 2026-11-05): lihat antrean, antrekan SEMUA resi lama, kirim, dan coba lagi yang gagal. */
export default function SysadminWosPage() {
  const [summary, setSummary] = useState<WosOutboxSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await getWosOutboxSummaryAction();
    if (res.ok) {
      setSummary(res.data);
      setError(null);
    } else setError(res.error);
  }, []);

  useEffect(() => {
    void getWosOutboxSummaryAction().then((res) => {
      if (res.ok) setSummary(res.data);
      else setError(res.error);
    });
  }, []);

  async function enqueueOld() {
    setBusy(true);
    setMsg(null);
    const res = await enqueueOldResisAction();
    if (!res.ok) setError(res.error);
    else {
      setError(null);
      const r = res.data;
      setMsg(
        `${r.queued} resi tervalidasi dimasukkan ke antrean (${r.alreadyQueued} sudah pernah diantrekan atau terkirim, ${r.awaitingValidation} belum tervalidasi ongkirnya oleh Procurement sehingga belum dikirim, ${r.skipped} dilewati karena tanpa isi barang jadi).${r.queued > 0 ? ' Tekan "Kirim antrean" untuk mengirimnya.' : ""}`
      );
    }
    await load();
    setBusy(false);
  }

  // Kirim gelombang demi gelombang sampai antrean habis; berhenti begitu ada yang gagal supaya galatnya terlihat.
  async function sendAll() {
    setBusy(true);
    setMsg(null);
    let sent = 0;
    for (let round = 0; round < 100; round++) {
      const res = await sendWosOutboxAction(40);
      if (!res.ok) {
        setError(res.error);
        break;
      }
      sent += res.data.sent;
      setMsg(`Terkirim ${sent} resi…`);
      if (res.data.failed > 0) {
        setError("Ada pengiriman yang gagal; lihat pesan galat di bawah.");
        break;
      }
      if (res.data.sent === 0 || res.data.remaining <= 0) break;
    }
    setMsg((m) => (m && m.startsWith("Terkirim") ? `${m.replace("…", "")}. Selesai.` : m));
    await load();
    setBusy(false);
  }

  // Hitung ulang HPP semua resi di antrean, lalu langsung kirim ulang (menimpa kolom items dan hpp_total di sheet).
  async function refreshHpp() {
    setBusy(true);
    setMsg(null);
    const res = await refreshWosHppAction();
    if (!res.ok) {
      setError(res.error);
      setBusy(false);
      return;
    }
    setError(null);
    const lepas = res.data.withdrawn > 0 ? ` ${res.data.withdrawn} resi yang ongkirnya belum divalidasi Procurement dilepas dari antrean (dikirim otomatis setelah divalidasi; baris lamanya di sheet tidak dihapus ERP).` : "";
    setMsg(`HPP ${res.data.updated} dari ${res.data.resis} resi dihitung ulang.${lepas} Mengirim…`);
    await load();
    setBusy(false);
    await sendAll();
  }

  async function resetFailed() {
    setBusy(true);
    const res = await resetWosOutboxAction();
    if (!res.ok) setError(res.error);
    else {
      setError(null);
      setMsg(`${res.data.reset} baris yang sudah menyerah dikembalikan ke antrean.`);
    }
    await load();
    setBusy(false);
  }

  const waiting = summary ? summary.pending + summary.failed - summary.exhausted : 0;

  return (
    <AppShell role="sysadmin" activeHref="/sysadmin/wos" breadcrumb={["Dashboard", "Kirim ke WOS"]} title="Kirim ke WOS" subtitle="Antrean pengiriman data resi ke Warehouse Operation System">
      {error && <div className="mb-3 rounded-md border border-danger bg-danger-bg px-4 py-2.5 font-sans text-[12px] text-danger-fg">{error}</div>}
      {msg && <div className="mb-3 rounded-md border border-[#A8C5DF] bg-info-bg px-4 py-2.5 font-sans text-[12px] text-info-fg">{msg}</div>}

      <div className="mb-4 rounded-lg border border-border-subtle bg-surface-card px-4 py-3 font-sans text-xs text-[#31414F]">
        <span className="text-text-muted">Tujuan pengiriman: </span>
        <span className="font-semibold">{summary ? DEST_LABEL[summary.destination] : "Memuat…"}</span>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          { label: "Menunggu / gagal", value: summary ? waiting : "…", tone: "text-warning-fg" },
          { label: "Sudah terkirim", value: summary?.sent ?? "…", tone: "text-success-fg" },
          { label: "Gagal (akan dicoba lagi)", value: summary?.failed ?? "…", tone: "text-danger-fg" },
          { label: "Menyerah (percobaan habis)", value: summary?.exhausted ?? "…", tone: "text-danger-fg" },
        ].map((c) => (
          <div key={c.label} className="rounded-lg border border-border-subtle bg-surface-card px-4 py-3">
            <div className="font-sans text-[10.5px] font-medium uppercase tracking-wider text-text-muted">{c.label}</div>
            <div className={"mt-1 font-mono text-[22px] font-semibold " + c.tone}>{c.value}</div>
          </div>
        ))}
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-border-subtle bg-surface-card px-4 py-3">
        <Button onClick={enqueueOld} disabled={busy || summary?.destination === "NONE"} variant="ghost" size="md">
          1. Antrekan resi tervalidasi
        </Button>
        <Button onClick={sendAll} disabled={busy || summary?.destination === "NONE" || waiting <= 0} variant="primary" size="md">
          2. Kirim antrean sekarang{waiting > 0 ? ` (${waiting})` : ""}
        </Button>
        <Button onClick={refreshHpp} disabled={busy || summary?.destination !== "SHEETS"} variant="accent" size="md">
          Kirim ulang HPP semua resi
        </Button>
        {summary && summary.exhausted > 0 && (
          <Button onClick={resetFailed} disabled={busy} variant="danger" size="md">
            Coba lagi yang menyerah ({summary.exhausted})
          </Button>
        )}
        <Button onClick={() => void load()} disabled={busy} variant="muted" size="md">
          Muat ulang
        </Button>
        <span className="font-sans text-[11px] text-text-muted">
          Resi dikirim otomatis begitu Procurement memvalidasi ongkirnya (resi susulan ikut sendiri). Langkah 1 hanya menyusulkan resi tervalidasi yang belum masuk antrean (aman dijalankan berulang, yang sudah terkirim tidak dikirim lagi); langkah 2 yang mengirim.
        </span>
      </div>

      {summary && summary.awaitingValidation !== null && (
        <div className="mb-4 rounded-lg border border-border-subtle bg-surface-card px-4 py-3 font-sans text-xs text-[#31414F]">
          <span className="font-semibold">{summary.awaitingValidation}</span> resi sudah dikirim vendor tetapi ongkirnya belum divalidasi Procurement, jadi belum dikirim ke WOS.
          {summary.readyNotQueued !== null && summary.readyNotQueued > 0 && (
            <span className="ml-1 text-warning-fg">
              {summary.readyNotQueued} resi sudah tervalidasi tetapi belum masuk antrean: tekan &quot;1. Antrekan resi tervalidasi&quot;.
            </span>
          )}
        </div>
      )}

      <div className="overflow-hidden rounded-lg border border-border-subtle bg-surface-card">
        <div className="border-b border-border-subtle bg-[#F7F9FB] px-4 py-[9px] font-sans text-[10.5px] font-medium uppercase tracking-wider text-text-muted">Galat terakhir</div>
        {summary && summary.recentErrors.length === 0 && <div className="px-4 py-5 text-center font-sans text-xs text-text-muted">Tidak ada galat tercatat.</div>}
        {summary?.recentErrors.map((e) => (
          <div key={e.resiGroupId} className="border-b border-[#F1F4F7] px-4 py-3 font-sans text-xs text-[#31414F] last:border-b-0">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="font-mono font-semibold">{e.resiGroupId}</span>
              <span className="text-[11px] text-text-muted">
                percobaan {e.attempts} · {fmtTime(e.at)}
              </span>
            </div>
            <div className="mt-1 break-words font-mono text-[11px] text-danger-fg">{e.error}</div>
          </div>
        ))}
      </div>
    </AppShell>
  );
}
