"use client";

import { useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { useMrpStore } from "@/lib/mrp/store";
import { useSysadminMode } from "@/lib/shell/use-sysadmin-mode";
import type { ActionResult } from "@/lib/mrp/action-result";

/** Dialog koreksi Sysadmin (owner 2026-09-29: Sysadmin "melihat dan mengoreksi" langsung di halaman
 *  modul). Selalu menampilkan DAMPAK aksi dulu, minta ALASAN wajib (masuk Log Audit + notifikasi ke
 *  modul terdampak), dan -- untuk aksi permanen -- minta ketik ulang teks konfirmasi. Setelah
 *  sukses, dialog menampilkan hasilnya; store baru di-refresh saat "Tutup" (kalau di-refresh
 *  langsung, baris yang baru dibatalkan hilang dari daftar dan dialog ikut hilang sebelum sempat
 *  dibaca). */
export function CorrectionDialog({
  title,
  impact,
  confirmLabel,
  danger,
  confirmText,
  extraValid = true,
  children,
  onRun,
  onClose,
}: {
  title: string;
  /** Poin dampak yang ditampilkan sebelum konfirmasi ("apa yang akan terjadi"). */
  impact: string[];
  confirmLabel: string;
  danger?: boolean;
  /** Kalau diisi, user harus mengetik ulang persis teks ini (aksi permanen). */
  confirmText?: string;
  /** false = tombol konfirmasi dinonaktifkan (validasi field tambahan di `children`). */
  extraValid?: boolean;
  /** Field tambahan (mis. input code lot baru), tampil di atas kolom alasan. */
  children?: ReactNode;
  onRun: (reason: string) => Promise<ActionResult<unknown>>;
  onClose: () => void;
}) {
  const [reason, setReason] = useState("");
  const [typed, setTyped] = useState("");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const refresh = useMrpStore((s) => s.refresh);

  const canRun = reason.trim().length > 0 && extraValid && (!confirmText || typed.trim() === confirmText) && !running;

  async function run() {
    if (!canRun) return;
    setRunning(true);
    setError(null);
    try {
      const res = await onRun(reason.trim());
      if (!res.ok) setError(res.error);
      else setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  }

  async function close() {
    onClose();
    if (done) await refresh();
  }

  return createPortal(
    // stopPropagation: dialog dirender dari dalam baris tabel yang punya onClick (buka/tutup rincian);
    // event React tetap naik lewat portal, jadi tanpa ini klik di dialog ikut menutup/membuka baris.
    <div onClick={(e) => e.stopPropagation()} className="fixed inset-0 z-[60] flex items-center justify-center bg-[#0B131B]/45 p-4">
      <div className="w-full max-w-[520px] overflow-hidden rounded-[9px] bg-surface-card shadow-[0_12px_32px_rgba(11,19,27,.28)]">
        <div className="flex items-center gap-2 border-b border-border-subtle px-5 py-4">
          <span className="rounded-full bg-warning-bg px-2 py-px font-sans text-[10px] font-semibold uppercase tracking-wider text-warning-fg">Sysadmin</span>
          <div className="font-sans text-[15px] font-bold text-text-primary">{title}</div>
        </div>
        {done ? (
          <div className="flex flex-col gap-3 px-5 py-4">
            <div className="rounded-md border border-success-fg/30 bg-success-bg px-3 py-2 font-sans text-[12px] text-success-fg">
              Berhasil. Perubahan tercatat di Log Audit dan modul terdampak sudah diberi notifikasi.
            </div>
            <div className="flex justify-end">
              <Button onClick={close} variant="primary" size="md">
                Tutup
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3 px-5 py-4">
            <div>
              <div className="mb-1 font-sans text-[10.5px] font-medium uppercase tracking-wider text-text-muted">Dampak</div>
              <ul className="list-disc space-y-0.5 pl-4 font-sans text-[11.5px] leading-[1.5] text-[#31414F]">
                {impact.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </div>
            {children}
            <div>
              <div className="mb-1 font-sans text-[10.5px] font-medium uppercase tracking-wider text-text-muted">Alasan (wajib)</div>
              <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} className="input w-full" placeholder="mis. salah pilih supplier, salah ketik, dst." />
            </div>
            {confirmText && (
              <div>
                <div className="mb-1 font-sans text-[10.5px] font-medium uppercase tracking-wider text-text-muted">
                  Ketik ulang <span className="font-mono">{confirmText}</span> untuk konfirmasi
                </div>
                <input value={typed} onChange={(e) => setTyped(e.target.value)} className="input w-full font-mono" />
              </div>
            )}
            {error && <div className="rounded-md border border-danger bg-danger-bg px-3 py-2 font-sans text-[11.5px] text-danger-fg">{error}</div>}
            <div className="flex justify-end gap-2">
              <Button onClick={onClose} variant="muted" size="md" disabled={running}>
                Batal
              </Button>
              <Button onClick={run} variant={danger ? "danger" : "primary"} size="md" disabled={!canRun}>
                {running ? "Memproses…" : confirmLabel}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}

export type CorrectionAction = {
  key: string;
  /** Label tombol di baris. */
  label: string;
  /** Kalau terisi, tombol nonaktif dan teks ini muncul sebagai tooltip (kenapa tidak bisa). */
  disabledReason?: string;
  danger?: boolean;
  title: string;
  impact: string[];
  confirmLabel: string;
  confirmText?: string;
  run: (reason: string) => Promise<ActionResult<unknown>>;
};

/** Deretan tombol koreksi Sysadmin untuk 1 baris (mis. 1 PO). Tidak render apa-apa kalau bukan mode
 *  Sysadmin. Tombol yang tidak boleh dijalankan tetap tampil tapi nonaktif + tooltip alasannya --
 *  supaya Sysadmin tahu aksinya ada tapi kenapa belum bisa (mis. "sudah diinvoice"). */
export function SysadminActionsBar({ actions }: { actions: CorrectionAction[] }) {
  const sysadmin = useSysadminMode();
  const [openKey, setOpenKey] = useState<string | null>(null);
  if (!sysadmin) return null;
  const open = actions.find((a) => a.key === openKey);
  return (
    // onClick stopPropagation: tombol berada di dalam baris tabel yang bisa di-klik (buka rincian).
    <div onClick={(e) => e.stopPropagation()} className="mt-1 flex flex-wrap items-center gap-1">
      <span className="font-sans text-[9.5px] font-semibold uppercase tracking-wider text-warning-fg">Sysadmin</span>
      {actions.map((a) => (
        <Button key={a.key} onClick={() => setOpenKey(a.key)} disabled={!!a.disabledReason} title={a.disabledReason} variant={a.danger ? "danger" : "ghost"} size="xs">
          {a.label}
        </Button>
      ))}
      {open && (
        <CorrectionDialog
          title={open.title}
          impact={open.impact}
          confirmLabel={open.confirmLabel}
          danger={open.danger}
          confirmText={open.confirmText}
          onRun={open.run}
          onClose={() => setOpenKey(null)}
        />
      )}
    </div>
  );
}
