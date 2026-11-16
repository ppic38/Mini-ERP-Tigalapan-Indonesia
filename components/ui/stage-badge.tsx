import { cn } from "@/lib/utils";

/** Status tahapan gaya Odoo dalam satu sel tabel. Revisi owner 2026-11-16 ("cukup status saja"): hanya nama tahap saat ini
 *  yang tampil; posisinya di alur ada di tooltip. `tone` "danger" untuk status di luar alur (mis. ditolak); tahap terakhir hijau. */
export function StageBadge({ stages, current, tone }: { stages: readonly string[]; current: string; tone?: "danger" | "done" }) {
  const idx = stages.indexOf(current);
  const t = tone ?? (idx === stages.length - 1 ? "done" : undefined);
  return (
    <span
      title={idx >= 0 ? `Tahap ${idx + 1} dari ${stages.length}: ${current}` : current}
      className={cn(
        "inline-flex whitespace-nowrap rounded px-1.5 py-px font-sans text-[11px] font-semibold",
        t === "danger" ? "bg-danger-bg text-danger-fg" : t === "done" ? "bg-success-bg text-success-fg" : "bg-info-bg text-info-fg"
      )}
    >
      {current}
    </span>
  );
}
