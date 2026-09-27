"use client";

import { useState } from "react";
import { exportMaklonPoExcel } from "@/lib/mrp/exportPoExcel";
import { exportMaterialPoExcel } from "@/lib/mrp/exportPoExcel";
import { exportMaklonPoPdf, exportMaklonPoPdfBatch, exportMaterialPoPdf, exportMaterialPoPdfBatch } from "@/lib/mrp/exportPoPdf";
import type { MrpDetail } from "@/lib/mrp/store";
import type { MaklonPO, MaterialPO } from "@/lib/mrp/types";

export type PoDownloadRequest =
  | { kind: "material"; pos: MaterialPO[]; baseName: string }
  | { kind: "maklon"; pos: MaklonPO[]; baseName: string };

/** Popup pilihan format download PO (owner 2026-09-26): PDF (layout lama, tidak diubah) atau Excel
 *  (.xlsx ber-kop logo, header berwarna, lebar kolom pas -- lihat lib/mrp/exportPoExcel.ts). Kedua
 *  format memuat informasi yang sama & tanpa nominal harga. */
export function PoDownloadModal({ request, mrpDetails, onClose }: { request: PoDownloadRequest; mrpDetails: MrpDetail[]; onClose: () => void }) {
  const [busy, setBusy] = useState<"pdf" | "excel" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const count = request.pos.length;

  async function run(format: "pdf" | "excel") {
    setBusy(format);
    setError(null);
    try {
      if (format === "pdf") {
        if (request.kind === "material") {
          if (count === 1) exportMaterialPoPdf(request.pos[0], mrpDetails);
          else exportMaterialPoPdfBatch(request.pos, mrpDetails, `${request.baseName}.pdf`);
        } else if (count === 1) exportMaklonPoPdf(request.pos[0], mrpDetails);
        else exportMaklonPoPdfBatch(request.pos, mrpDetails, `${request.baseName}.pdf`);
      } else if (request.kind === "material") await exportMaterialPoExcel(request.pos, mrpDetails, `${request.baseName}.xlsx`);
      else await exportMaklonPoExcel(request.pos, mrpDetails, `${request.baseName}.xlsx`);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal membuat file.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0B131B]/45 p-4" onClick={onClose}>
      <div className="w-full max-w-[420px] rounded-lg bg-white shadow-[0_8px_24px_rgba(11,19,27,.2)]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-border-subtle px-5 py-3.5">
          <span className="font-sans text-[13px] font-semibold text-text-primary">Download PO</span>
          <button onClick={onClose} className="font-sans text-[13px] font-semibold text-text-muted hover:text-text-primary">
            ✕
          </button>
        </div>
        <div className="px-5 py-4">
          <div className="font-sans text-[11.5px] text-text-muted">
            {count === 1 ? `1 PO ${request.kind === "material" ? "material" : "produksi"}` : `${count} PO ${request.kind === "material" ? "material" : "produksi"} (jadi 1 file)`} — pilih format:
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <button
              onClick={() => run("pdf")}
              disabled={busy != null}
              className="flex flex-col items-center gap-1 rounded-lg border border-[#DDE4EB] px-3 py-4 font-sans hover:border-accent-blue hover:bg-info-bg disabled:opacity-50"
            >
              <span className="text-[15px] font-semibold text-text-primary">PDF</span>
              <span className="text-[10.5px] text-text-muted">{busy === "pdf" ? "Membuat file…" : "Siap cetak, A4"}</span>
            </button>
            <button
              onClick={() => run("excel")}
              disabled={busy != null}
              className="flex flex-col items-center gap-1 rounded-lg border border-[#DDE4EB] px-3 py-4 font-sans hover:border-accent-blue hover:bg-info-bg disabled:opacity-50"
            >
              <span className="text-[15px] font-semibold text-text-primary">Excel</span>
              <span className="text-[10.5px] text-text-muted">{busy === "excel" ? "Membuat file…" : ".xlsx, ber-kop logo"}</span>
            </button>
          </div>
          {error && <div className="mt-3 rounded-md border border-danger bg-danger-bg px-3 py-2 font-sans text-[11.5px] text-danger-fg">{error}</div>}
        </div>
      </div>
    </div>
  );
}
