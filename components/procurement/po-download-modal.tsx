"use client";

import { useState } from "react";
import { exportMaklonPoExcel, exportMaklonPoRasioExcel } from "@/lib/mrp/exportPoExcel";
import { exportMaterialPoExcel } from "@/lib/mrp/exportPoExcel";
import { exportMaklonPoPdf, exportMaklonPoPdfBatch, exportMaterialPoPdf, exportMaterialPoPdfBatch, type PoExportVariant } from "@/lib/mrp/exportPoPdf";
import type { MrpDetail } from "@/lib/mrp/store";
import type { MaklonPO, MaterialPO } from "@/lib/mrp/types";

export type PoDownloadRequest =
  | { kind: "material"; pos: MaterialPO[]; baseName: string }
  | { kind: "maklon"; pos: MaklonPO[]; baseName: string };

/** Popup pilihan download PO (owner 2026-09-26): PDF (layout lama, tidak diubah) atau Excel (.xlsx
 *  ber-kop logo, header berwarna, lebar kolom pas -- lihat lib/mrp/exportPoExcel.ts). Kedua format
 *  memuat informasi yang sama & tanpa nominal harga.
 *
 *  Revisi 2026-09-28 (owner: "versi internal pake sekarang dan versi eksternal untuk ke supplier
 *  dan vendor produksi, bedanya tidak dibagi pendek/panjang, langsung totalan") -- tambah pilihan
 *  "Versi" (Internal/Eksternal) DI ATAS pilihan format, berlaku untuk PDF maupun Excel. Lihat
 *  PoExportVariant (lib/mrp/exportPoPdf.ts) untuk penjelasan lengkap bedanya. */
export function PoDownloadModal({ request, mrpDetails, onClose }: { request: PoDownloadRequest; mrpDetails: MrpDetail[]; onClose: () => void }) {
  const [variant, setVariant] = useState<PoExportVariant>("internal");
  const [busy, setBusy] = useState<"pdf" | "excel" | "rasio" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const count = request.pos.length;
  const suffix = variant === "external" ? "-eksternal" : "";

  async function run(format: "pdf" | "excel" | "rasio") {
    setBusy(format);
    setError(null);
    try {
      if (format === "rasio") {
        if (request.kind === "maklon") await exportMaklonPoRasioExcel(request.pos, mrpDetails, `${request.baseName}-rasio.xlsx`);
      } else if (format === "pdf") {
        if (request.kind === "material") {
          if (count === 1) exportMaterialPoPdf(request.pos[0], mrpDetails, variant);
          else exportMaterialPoPdfBatch(request.pos, mrpDetails, `${request.baseName}${suffix}.pdf`, variant);
        } else if (count === 1) exportMaklonPoPdf(request.pos[0], mrpDetails, variant);
        else exportMaklonPoPdfBatch(request.pos, mrpDetails, `${request.baseName}${suffix}.pdf`, variant);
      } else if (request.kind === "material") await exportMaterialPoExcel(request.pos, mrpDetails, `${request.baseName}${suffix}.xlsx`, variant);
      else await exportMaklonPoExcel(request.pos, mrpDetails, `${request.baseName}${suffix}.xlsx`, variant);
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
            {count === 1 ? `1 PO ${request.kind === "material" ? "material" : "produksi"}` : `${count} PO ${request.kind === "material" ? "material" : "produksi"} (jadi 1 file)`}
          </div>

          <div className="mt-3 font-sans text-[11px] font-semibold uppercase tracking-wider text-text-muted">Versi</div>
          <div className="mt-1.5 grid grid-cols-2 gap-2">
            <button
              onClick={() => setVariant("internal")}
              disabled={busy != null}
              className={
                "rounded-md border px-3 py-2 text-left font-sans disabled:opacity-50 " +
                (variant === "internal" ? "border-accent-blue bg-info-bg" : "border-[#DDE4EB] hover:border-accent-blue")
              }
            >
              <div className="text-[12px] font-semibold text-text-primary">Internal</div>
              <div className="text-[10px] text-text-muted">Rincian per warna + lengan (pendek/panjang terpisah)</div>
            </button>
            <button
              onClick={() => setVariant("external")}
              disabled={busy != null}
              className={
                "rounded-md border px-3 py-2 text-left font-sans disabled:opacity-50 " +
                (variant === "external" ? "border-accent-blue bg-info-bg" : "border-[#DDE4EB] hover:border-accent-blue")
              }
            >
              <div className="text-[12px] font-semibold text-text-primary">Eksternal</div>
              <div className="text-[10px] text-text-muted">Untuk supplier/vendor produksi — per warna, langsung totalan</div>
            </button>
          </div>

          <div className="mt-4 font-sans text-[11px] font-semibold uppercase tracking-wider text-text-muted">Format</div>
          <div className="mt-1.5 grid grid-cols-2 gap-3">
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
          {request.kind === "maklon" && (
            <button
              onClick={() => run("rasio")}
              disabled={busy != null}
              className="mt-3 flex w-full flex-col items-center gap-1 rounded-lg border border-[#DDE4EB] px-3 py-3 font-sans hover:border-accent-blue hover:bg-info-bg disabled:opacity-50"
            >
              <span className="text-[13px] font-semibold text-text-primary">Form Rasio (Excel)</span>
              <span className="text-[10.5px] text-text-muted">{busy === "rasio" ? "Membuat file…" : "Tabel MRP per size: roll, aduan pola, rib, kerah/manset"}</span>
            </button>
          )}
          {error && <div className="mt-3 rounded-md border border-danger bg-danger-bg px-3 py-2 font-sans text-[11.5px] text-danger-fg">{error}</div>}
        </div>
      </div>
    </div>
  );
}
