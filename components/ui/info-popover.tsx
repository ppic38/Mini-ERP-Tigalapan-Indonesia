"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Info } from "lucide-react";

/** Ikon "i" kecil di header kolom: klik membuka kartu penjelasan (dari mana nilai ini dan rumusnya). Kartu dirender di body (portal) supaya tidak
 *  terpotong tabel/popup yang bisa digulir. Tutup lewat klik di luar, Esc, atau gulir. */
export function InfoPopover({ title, children, width = 340 }: { title: string; children: ReactNode; width?: number }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const btnRef = useRef<HTMLButtonElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (cardRef.current?.contains(t) || btnRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // Hanya menutup kartu ini; popup induk (yang juga menutup dengan Esc) tidak ikut tertutup.
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
    };
    const close = () => setOpen(false);
    document.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [open]);

  function toggle(e: React.MouseEvent) {
    e.stopPropagation();
    if (!open && btnRef.current) {
      const r = btnRef.current.getBoundingClientRect();
      const left = Math.min(Math.max(8, r.left + r.width / 2 - width / 2), window.innerWidth - width - 8);
      setPos({ top: r.bottom + 6, left });
    }
    setOpen((o) => !o);
  }

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={toggle}
        aria-label={`Penjelasan ${title}`}
        title="Lihat asal nilai dan rumusnya"
        className="ml-1 inline-flex h-4 w-4 flex-none items-center justify-center rounded-full align-middle text-text-muted hover:bg-[#E4E9EE] hover:text-action-primary"
      >
        <Info size={12} strokeWidth={2.25} />
      </button>
      {open &&
        createPortal(
          <div
            ref={cardRef}
            role="dialog"
            aria-label={title}
            style={{ position: "fixed", top: pos.top, left: pos.left, width }}
            className="z-[80] rounded-lg border border-border-subtle bg-white p-3.5 text-left font-sans text-[12px] font-normal normal-case leading-[1.55] tracking-normal text-[#31414F] shadow-[0_8px_24px_rgba(11,19,27,.18)]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-1.5 text-[12.5px] font-semibold text-text-primary">{title}</div>
            {children}
          </div>,
          document.body
        )}
    </>
  );
}
