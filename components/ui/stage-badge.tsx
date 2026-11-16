import { cn } from "@/lib/utils";

/** Status tahapan gaya Odoo dalam satu sel tabel: nama tahap saat ini dan deretan titik posisi di alur (titik terisi = tahap
 *  yang sudah dilewati / sedang berjalan). `tone` "danger" untuk status di luar alur (mis. ditolak). */
export function StageBadge({ stages, current, tone }: { stages: readonly string[]; current: string; tone?: "danger" | "done" }) {
  const idx = stages.indexOf(current);
  const t = tone ?? (idx === stages.length - 1 ? "done" : undefined);
  return (
    <span className="inline-flex items-center gap-2 whitespace-nowrap" title={idx >= 0 ? `Tahap ${idx + 1} dari ${stages.length}: ${current}` : current}>
      {idx >= 0 && (
        <span className="flex items-center gap-[3px]" aria-hidden>
          {stages.map((s, i) => (
            <span
              key={s}
              className={cn(
                "h-[6px] rounded-full",
                i === idx ? "w-3.5" : "w-[6px]",
                i < idx ? "bg-[#9DB8E8]" : i === idx ? (t === "done" ? "bg-success-fg" : "bg-accent-blue") : "bg-[#DCE2EA]"
              )}
            />
          ))}
        </span>
      )}
      <span
        className={cn(
          "rounded px-1.5 py-px font-sans text-[11px] font-semibold",
          t === "danger" ? "bg-danger-bg text-danger-fg" : t === "done" ? "bg-success-bg text-success-fg" : "bg-info-bg text-info-fg"
        )}
      >
        {current}
      </span>
    </span>
  );
}
