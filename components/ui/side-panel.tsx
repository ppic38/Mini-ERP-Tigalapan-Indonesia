"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

/** Panel samping (redesign paket B6): rincian dan aksi satu baris dibuka di sisi kanan layar, daftar di
 *  belakangnya tetap terlihat. Menggantikan baris yang melebar ke bawah dan pop-up rincian. Ditutup dengan
 *  tombol X, tombol Esc, atau klik di luar panel. Di layar kecil (< 640px) memenuhi layar.
 *  Pop-up konfirmasi (confirmDialog) tetap tampil di atas panel ini. */
export function SidePanel({
  open,
  onClose,
  title,
  subtitle,
  headerExtra,
  footer,
  width = 720,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  subtitle?: ReactNode;
  /** Isi tambahan di bawah judul (mis. deretan status). */
  headerExtra?: ReactNode;
  /** Baris tombol aksi yang menempel di dasar panel. */
  footer?: ReactNode;
  /** Lebar maksimum panel di layar lebar (px). */
  width?: number;
  children: ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panelRef.current?.focus();
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <div className="absolute inset-0 bg-[#0B131B]/35" onClick={onClose} aria-hidden />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        style={{ maxWidth: width }}
        className={cn(
          "relative flex h-full w-full flex-col bg-surface-card shadow-[-12px_0_32px_rgba(11,19,27,.18)] outline-none",
          "max-sm:!max-w-none motion-safe:animate-in motion-safe:slide-in-from-right-8 motion-safe:fade-in motion-safe:duration-200"
        )}
      >
        <div className="flex flex-none items-start gap-3 border-b border-border-subtle px-5 py-4">
          <div className="min-w-0 flex-1">
            <div className="font-heading text-[17px] font-bold leading-tight tracking-tight text-text-primary">{title}</div>
            {subtitle && <div className="mt-1 font-sans text-[12px] text-text-muted">{subtitle}</div>}
            {headerExtra && <div className="mt-2.5">{headerExtra}</div>}
          </div>
          <button type="button" onClick={onClose} aria-label="Tutup panel" className="-mr-1.5 -mt-1 flex h-8 w-8 flex-none items-center justify-center rounded-md text-text-muted hover:bg-[#F1F4F8] hover:text-text-primary">
            <X size={18} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex flex-none flex-wrap items-center gap-2 border-t border-border-subtle bg-[#FAFBFC] px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}

/** Satu baris "label: nilai" di dalam panel samping. */
export function PanelField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="font-sans text-[11px] font-medium text-text-muted">{label}</div>
      <div className="mt-0.5 font-sans text-[12.5px] text-text-primary">{children}</div>
    </div>
  );
}
