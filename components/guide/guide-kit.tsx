"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";

/** Komponen dasar halaman "Panduan" per modul (owner 2026-10-06: panduan untuk user baru, visual,
 *  contoh pakai DATA DUMMY). Semua data contoh ditulis langsung di file panduan tiap modul --
 *  TIDAK membaca store/database sama sekali, jadi tidak mungkin menyentuh atau menampilkan data asli.
 *  Dipakai ulang oleh panduan modul lain: tinggal susun GuideSection + MockTable + FlowSteps. */

export function DummyBadge() {
  return <span className="rounded bg-warning-bg px-1.5 py-0.5 font-sans text-[9.5px] font-semibold uppercase tracking-wider text-warning-fg">Contoh data dummy</span>;
}

/** Penanda angka kecil -- taruh di dalam sel MockTable, jelaskan artinya lewat <Legend>. */
export function Marker({ n }: { n: number }) {
  return (
    <span className="ml-1.5 inline-flex h-[15px] w-[15px] flex-none items-center justify-center rounded-full bg-accent-blue font-sans text-[9px] font-bold leading-none text-white">{n}</span>
  );
}

/** Alur satu siklus (garis waktu pendek). `here` menandai tahap yang sedang dijelaskan. */
export function FlowSteps({ steps }: { steps: { label: string; sub?: string; here?: boolean }[] }) {
  return (
    <div className="flex flex-wrap items-stretch gap-y-2">
      {steps.map((s, i) => (
        <div key={s.label} className="flex items-center">
          <div className={cn("rounded-md border px-3 py-2", s.here ? "border-accent-blue bg-info-bg" : "border-border-subtle bg-surface-card")}>
            <div className={cn("font-sans text-[11.5px] font-semibold", s.here ? "text-action-primary" : "text-text-primary")}>{s.label}</div>
            {s.sub && <div className="font-sans text-[10px] text-text-muted">{s.sub}</div>}
          </div>
          {i < steps.length - 1 && <ChevronRight size={14} className="mx-1 flex-none text-text-muted" />}
        </div>
      ))}
    </div>
  );
}

/** Tabel tiruan yang mirip tampilan asli. Sel boleh berisi ReactNode (mis. StatusPill + Marker). */
export function MockTable({ columns, rows, align }: { columns: string[]; rows: ReactNode[][]; align?: ("left" | "right")[] }) {
  return (
    <div className="overflow-x-auto rounded-md border border-border-subtle bg-white">
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b-2 border-accent-blue bg-info-bg font-sans text-[10px] font-medium uppercase tracking-wider text-info-fg">
            {columns.map((c, i) => (
              <th key={c} className={cn("whitespace-nowrap px-3 py-2", align?.[i] === "right" ? "text-right" : "text-left")}>
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, ri) => (
            <tr key={ri} className="border-t border-[#F1F4F7] font-sans text-[11.5px] text-[#31414F]">
              {r.map((cell, ci) => (
                <td key={ci} className={cn("whitespace-nowrap px-3 py-2", align?.[ci] === "right" ? "text-right font-mono" : "text-left")}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Kartu angka tiruan (mirip KpiCard dashboard). */
export function MockKpi({ label, value, sub, marker }: { label: string; value: string; sub?: string; marker?: number }) {
  return (
    <div className="rounded-lg border border-border-subtle bg-white px-3.5 py-3">
      <div className="flex items-center font-sans text-[10px] font-medium uppercase tracking-wider text-text-muted">
        {label}
        {marker != null && <Marker n={marker} />}
      </div>
      <div className="mt-1 font-heading text-[22px] font-bold text-text-primary">{value}</div>
      {sub && <div className="font-sans text-[10.5px] text-text-muted">{sub}</div>}
    </div>
  );
}

/** Penjelasan angka penanda di mock di atasnya. */
export function Legend({ items }: { items: string[] }) {
  return (
    <ol className="mt-2 flex flex-col gap-1">
      {items.map((t, i) => (
        <li key={i} className="flex items-start font-sans text-[11.5px] text-[#31414F]">
          <Marker n={i + 1} />
          <span className="ml-1.5">{t}</span>
        </li>
      ))}
    </ol>
  );
}

/** Satu halaman aplikasi = satu bagian panduan, bisa dilipat. */
export function GuideSection({
  title,
  href,
  purpose,
  steps,
  mock,
  tips,
  defaultOpen = false,
}: {
  title: string;
  href: string;
  purpose: string;
  steps: string[];
  mock?: ReactNode;
  tips?: string[];
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="overflow-hidden rounded-lg border border-border-subtle bg-surface-card">
      <button onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-2 px-4 py-3 text-left">
        {open ? <ChevronDown size={15} className="text-text-muted" /> : <ChevronRight size={15} className="text-text-muted" />}
        <span className="font-sans text-[13px] font-semibold text-text-primary">{title}</span>
        <span className="ml-2 truncate font-sans text-[11.5px] text-text-muted">{purpose}</span>
      </button>
      {open && (
        <div className="flex flex-col gap-4 border-t border-border-subtle px-4 py-4">
          <div className="flex items-start gap-3">
            <p className="flex-1 font-sans text-[12.5px] leading-[1.5] text-[#31414F]">{purpose}</p>
            <Link href={href} className="flex flex-none items-center gap-1 rounded-md border border-[#CBD5DF] bg-white px-2.5 py-1.5 font-sans text-[11px] font-semibold text-action-primary">
              Buka halaman <ExternalLink size={11} />
            </Link>
          </div>

          <div>
            <div className="mb-1.5 font-sans text-[10.5px] font-medium uppercase tracking-wider text-text-muted">Langkah</div>
            <ol className="flex flex-col gap-1.5">
              {steps.map((s, i) => (
                <li key={i} className="flex items-start gap-2 font-sans text-[12px] text-[#31414F]">
                  <span className="flex h-[18px] w-[18px] flex-none items-center justify-center rounded-full bg-action-primary font-mono text-[10px] font-semibold text-white">{i + 1}</span>
                  <span className="pt-px">{s}</span>
                </li>
              ))}
            </ol>
          </div>

          {mock && (
            <div>
              <div className="mb-1.5 flex items-center gap-2 font-sans text-[10.5px] font-medium uppercase tracking-wider text-text-muted">
                Contoh tampilan <DummyBadge />
              </div>
              {mock}
            </div>
          )}

          {tips && tips.length > 0 && (
            <div className="rounded-md border border-[#CFE0EF] bg-info-bg px-3 py-2.5">
              <div className="mb-1 font-sans text-[10.5px] font-semibold uppercase tracking-wider text-info-fg">Perlu diingat</div>
              <ul className="flex list-disc flex-col gap-1 pl-4 font-sans text-[11.5px] leading-[1.5] text-info-fg">
                {tips.map((t, i) => (
                  <li key={i}>{t}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
