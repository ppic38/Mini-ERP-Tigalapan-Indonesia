"use client";

import { useEffect, useState } from "react";
import { AppShell } from "@/components/shell/app-shell";
import { listAuditLogAction, type AuditLogRow } from "@/lib/mrp/sysadminActions";

function fmtTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("id-ID", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

const ACTION_LABEL: Record<string, string> = {
  SET_INTERNAL_PASSWORD: "Ganti password modul internal",
  RESET_VENDOR_PASSWORD: "Reset password vendor produksi",
  CANCEL_MATERIAL_PO: "Batalkan PO Material",
  CANCEL_MAKLON_PO: "Batalkan PO Produksi",
};

/** Riwayat PERMANEN semua aksi Sysadmin -- read-only, tidak ada tombol hapus (owner 2026-09-27:
 *  pertanggungjawaban "siapa ubah apa, kapan, kenapa"). Lihat sysadmin_audit_log (migration 0056). */
export default function SysadminAuditLogPage() {
  const [rows, setRows] = useState<AuditLogRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    void listAuditLogAction().then((res) => {
      if (res.ok) setRows(res.data);
      else setError(res.error);
    });
  }, []);

  return (
    <AppShell role="sysadmin" activeHref="/sysadmin/audit-log" breadcrumb={["Dashboard", "Log Audit"]} title="Log Audit" subtitle="Riwayat permanen semua aksi Sysadmin — tidak bisa dihapus dari sini">
      {error && <div className="rounded-md border border-danger bg-danger-bg px-4 py-2.5 font-sans text-[12px] text-danger-fg">{error}</div>}
      <div className="overflow-hidden rounded-lg border border-border-subtle bg-surface-card">
        <div className="grid grid-cols-[150px_150px_1fr_1fr_90px] gap-x-3 border-b border-border-subtle bg-[#F7F9FB] px-4 py-[9px] font-sans text-[10.5px] font-medium uppercase tracking-wider text-text-muted">
          <span>Waktu</span>
          <span>Aksi</span>
          <span>Target</span>
          <span>Alasan</span>
          <span className="text-right">Detail</span>
        </div>
        {rows == null && !error && <div className="px-4 py-6 text-center font-sans text-xs text-text-muted">Memuat…</div>}
        {rows != null && rows.length === 0 && <div className="px-4 py-6 text-center font-sans text-xs text-text-muted">Belum ada aksi Sysadmin yang tercatat.</div>}
        {rows?.map((r) => (
          <div key={r.id} className="border-b border-[#F1F4F7] last:border-b-0">
            <div className="grid grid-cols-[150px_150px_1fr_1fr_90px] items-center gap-x-3 px-4 py-[11px] font-sans text-xs text-[#31414F]">
              <span className="text-[11px] text-text-muted">{fmtTime(r.createdAt)}</span>
              <span className="font-medium">{ACTION_LABEL[r.action] ?? r.action}</span>
              <span className="font-mono text-[11px]">
                {r.targetType} · {r.targetId}
              </span>
              <span className="truncate">{r.reason}</span>
              <span className="text-right">
                <button onClick={() => setExpanded(expanded === r.id ? null : r.id)} className="font-sans text-[11px] font-semibold text-action-primary underline">
                  {expanded === r.id ? "Tutup" : "Lihat"}
                </button>
              </span>
            </div>
            {expanded === r.id && (
              <div className="grid grid-cols-2 gap-3 border-t border-[#F1F4F7] bg-[#FBFCFD] px-4 py-3 font-mono text-[10.5px] text-[#31414F]">
                <div>
                  <div className="mb-1 font-sans text-[10px] font-semibold uppercase text-text-muted">Sebelum</div>
                  <pre className="whitespace-pre-wrap break-words">{r.before ? JSON.stringify(r.before, null, 2) : "—"}</pre>
                </div>
                <div>
                  <div className="mb-1 font-sans text-[10px] font-semibold uppercase text-text-muted">Sesudah</div>
                  <pre className="whitespace-pre-wrap break-words">{r.after ? JSON.stringify(r.after, null, 2) : "—"}</pre>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </AppShell>
  );
}
