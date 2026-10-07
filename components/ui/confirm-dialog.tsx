"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Pengganti window.confirm / window.alert dengan dialog buatan sendiri (tampilan sama di semua browser,
 * sesuai gaya modal aplikasi). Dipakai lewat fungsi biasa -- tidak perlu hook/state di pemanggil:
 *
 *   if (!(await confirmDialog({ title: "Hapus akun?", message: "...", tone: "danger" }))) return;
 *   await alertDialog({ title: "Gagal", message: err.message });
 *
 * `<DialogHost />` harus terpasang SEKALI di root layout. Kalau belum terpasang (mis. dipanggil di server /
 * sebelum hidrasi) fungsi jatuh kembali ke dialog bawaan browser supaya aksi tidak pernah "hilang".
 */

type DialogRequest = {
  kind: "confirm" | "alert";
  title: string;
  message?: string;
  /** Daftar poin peringatan (1 per baris) -- tampil di kotak kuning di bawah pesan. */
  details?: string[];
  detailsTitle?: string;
  confirmLabel: string;
  cancelLabel: string;
  tone: "default" | "danger";
  resolve: (ok: boolean) => void;
};

export type ConfirmOptions = {
  title: string;
  message?: string;
  details?: string[];
  detailsTitle?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "default" | "danger";
};

let enqueue: ((req: DialogRequest) => void) | null = null;

function plainText(o: { title: string; message?: string; details?: string[]; detailsTitle?: string }) {
  return [o.title, o.message, o.details?.length ? (o.detailsTitle ? o.detailsTitle + "\n" : "") + o.details.join("\n") : ""].filter(Boolean).join("\n\n");
}

export function confirmDialog(opts: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    if (!enqueue) {
      resolve(typeof window !== "undefined" ? window.confirm(plainText(opts)) : false);
      return;
    }
    enqueue({
      kind: "confirm",
      title: opts.title,
      message: opts.message,
      details: opts.details,
      detailsTitle: opts.detailsTitle,
      confirmLabel: opts.confirmLabel ?? "Lanjutkan",
      cancelLabel: opts.cancelLabel ?? "Batal",
      tone: opts.tone ?? "default",
      resolve,
    });
  });
}

export function alertDialog(opts: { title?: string; message: string; tone?: "default" | "danger" }): Promise<void> {
  return new Promise((resolve) => {
    if (!enqueue) {
      if (typeof window !== "undefined") window.alert(opts.message);
      resolve();
      return;
    }
    enqueue({
      kind: "alert",
      title: opts.title ?? "Perhatian",
      message: opts.message,
      confirmLabel: "OK",
      cancelLabel: "",
      tone: opts.tone ?? "default",
      resolve: () => resolve(),
    });
  });
}

export function DialogHost() {
  const [queue, setQueue] = useState<DialogRequest[]>([]);
  const okRef = useRef<HTMLButtonElement>(null);
  const current = queue[0];

  useEffect(() => {
    enqueue = (req) => setQueue((q) => [...q, req]);
    return () => {
      enqueue = null;
    };
  }, []);

  function close(ok: boolean) {
    if (!current) return;
    current.resolve(ok);
    setQueue((q) => q.slice(1));
  }

  useEffect(() => {
    if (!current) return;
    okRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current]);

  if (!current) return null;
  const danger = current.tone === "danger";
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-[#0B131B]/45 p-4" onMouseDown={(e) => e.target === e.currentTarget && close(false)} role="presentation">
      <div role="alertdialog" aria-modal="true" aria-labelledby="dialog-title" className="flex max-h-[88vh] w-full max-w-[480px] flex-col overflow-hidden rounded-xl bg-white shadow-[0_12px_32px_rgba(11,19,27,.25)]">
        <div className="overflow-y-auto px-6 pb-2 pt-5">
          <h2 id="dialog-title" className="font-sans text-[15px] font-semibold leading-snug text-text-primary">
            {current.title}
          </h2>
          {current.message && <p className="mt-2 whitespace-pre-line font-sans text-[12.5px] leading-[1.55] text-[#4B5B6B]">{current.message}</p>}
          {current.details && current.details.length > 0 && (
            <div className="mt-3 rounded-md border border-[#F0DFC2] bg-warning-bg px-3 py-2.5">
              {current.detailsTitle && <div className="font-sans text-[11.5px] font-semibold text-warning-fg">{current.detailsTitle}</div>}
              <ul className={"space-y-0.5 font-sans text-[11.5px] leading-[1.5] text-warning-fg " + (current.detailsTitle ? "mt-1" : "")}>
                {current.details.map((d, i) => (
                  <li key={i}>{d}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
        <div className="flex justify-end gap-2 px-6 pb-5 pt-4">
          {current.kind === "confirm" && (
            <button onClick={() => close(false)} className="rounded-md border border-[#CBD5DF] bg-white px-4 py-2 font-sans text-xs font-semibold text-[#31414F] hover:bg-[#F7F9FB]">
              {current.cancelLabel}
            </button>
          )}
          <button
            ref={okRef}
            onClick={() => close(true)}
            className={"rounded-md px-4 py-2 font-sans text-xs font-semibold text-white focus:outline-none focus:ring-2 focus:ring-offset-1 " + (danger ? "bg-danger focus:ring-danger" : "bg-action-primary focus:ring-accent-blue")}
          >
            {current.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
