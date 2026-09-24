"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { parseWarnaAliasImportFile, downloadWarnaAliasImportTemplate, type ParsedWarnaAliasRow } from "@/lib/mrp/parseWarnaAliasImport";
import { useMrpStore } from "@/lib/mrp/store";
import type { SkuImportSummary } from "@/lib/mrp/actions";

/** Popup "Import Data" untuk Master Data Mapping Warna (owner 2026-09-24) -- pola SAMA PERSIS
 *  dengan ImportSkuModal, dipertahankan sebagai komponen terpisah konsisten dengan gaya tiap
 *  Master Data panel di app ini. Upsert by "Nama di MRP" (lihat bulkUpsertWarnaAliasesAction),
 *  bisa dipakai berkali-kali tanpa menghapus mapping yang sudah ada. */
export function ImportWarnaAliasModal({ onClose }: { onClose: () => void }) {
  const bulkUpsert = useMrpStore((s) => s.bulkUpsertWarnaAliases);
  const inputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [rows, setRows] = useState<ParsedWarnaAliasRow[] | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [result, setResult] = useState<SkuImportSummary | null>(null);

  async function handleFile(file: File) {
    setLoading(true);
    setParseError(null);
    setRows(null);
    setResult(null);
    setSaveError(null);
    setFileName(file.name);
    try {
      const parsed = await parseWarnaAliasImportFile(file);
      setRows(parsed);
    } catch (e) {
      setParseError(e instanceof Error ? e.message : "Gagal membaca file.");
    } finally {
      setLoading(false);
    }
  }

  const validRows = rows?.filter((r) => r.issues.length === 0) ?? [];
  const invalidRows = rows?.filter((r) => r.issues.length > 0) ?? [];

  async function handleSave() {
    if (validRows.length === 0) return;
    setSaving(true);
    setSaveError(null);
    try {
      const summary = await bulkUpsert(validRows.map((r) => ({ mrpWarna: r.mrpWarna, skuWarna: r.skuWarna, catatan: r.catatan || undefined })));
      setResult(summary);
      setRows(null);
      setFileName(null);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Gagal menyimpan data.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0B131B]/45 p-4">
      <div className="flex max-h-[88vh] w-full max-w-[680px] flex-col rounded-lg bg-white shadow-[0_8px_24px_rgba(11,19,27,.2)]">
        <div className="flex items-center justify-between border-b border-border-subtle px-5 py-3.5">
          <span className="font-sans text-[13px] font-semibold text-text-primary">Import Data — Mapping Warna</span>
          <button onClick={onClose} className="font-sans text-[13px] font-semibold text-text-muted hover:text-text-primary">
            ✕
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {result ? (
            <div className="rounded-md border border-success-fg/30 bg-success-bg px-4 py-3 font-sans text-[12.5px] text-success-fg">
              <div className="font-semibold">Berhasil disimpan.</div>
              <div className="mt-1">
                {result.inserted} mapping baru ditambahkan, {result.updated} mapping yang sudah ada diperbarui — total {result.total} baris diproses.
              </div>
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  ref={inputRef}
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleFile(file);
                  }}
                  className="input flex-1 file:mr-2.5 file:rounded file:border-0 file:bg-info-bg file:px-2.5 file:py-1 file:font-sans file:text-[11px] file:font-semibold file:text-info-fg"
                />
                <button onClick={downloadWarnaAliasImportTemplate} className="flex-none font-sans text-[11.5px] font-semibold text-action-primary underline">
                  Download Template ↓
                </button>
              </div>
              <div className="mt-1.5 font-sans text-[10.5px] leading-[1.5] text-text-muted">
                Kolom yang dikenali: <span className="font-mono">Nama di MRP</span>, <span className="font-mono">Nama di SKU</span>, dan{" "}
                <span className="font-mono">Catatan</span> (opsional). Baris dengan Nama di MRP yang SAMA dengan mapping yang sudah ada akan diperbarui,
                bukan digandakan.
              </div>
              {loading && <div className="mt-3 font-sans text-xs text-text-muted">Membaca {fileName}…</div>}
              {parseError && <div className="mt-3 rounded-md border border-danger bg-danger-bg px-3 py-2 font-sans text-[11.5px] text-danger-fg">{parseError}</div>}
              {rows && (
                <div className="mt-4">
                  <div className="flex flex-wrap items-center gap-3 font-sans text-[11.5px]">
                    <span className="font-semibold text-text-primary">{fileName}</span>
                    <span className="text-success-fg">{validRows.length} baris siap disimpan</span>
                    {invalidRows.length > 0 && <span className="text-danger-fg">{invalidRows.length} baris bermasalah (dilewati)</span>}
                  </div>
                  <div className="mt-2 max-h-[320px] overflow-y-auto overflow-x-auto rounded-md border border-[#E4E9EE]">
                    <table className="w-full border-collapse font-sans text-[11px]">
                      <thead className="sticky top-0 bg-[#F2F5F8]">
                        <tr className="text-left uppercase tracking-wider text-text-muted">
                          <th className="px-2.5 py-1.5">Baris</th>
                          <th className="px-2.5 py-1.5">Nama di MRP</th>
                          <th className="px-2.5 py-1.5">Nama di SKU</th>
                          <th className="px-2.5 py-1.5">Catatan</th>
                          <th className="px-2.5 py-1.5">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.slice(0, 300).map((r) => (
                          <tr key={r.rowNum} className={"border-t border-[#F1F4F7] " + (r.issues.length > 0 ? "bg-danger-bg/40" : "")}>
                            <td className="px-2.5 py-1 font-mono text-text-muted">{r.rowNum}</td>
                            <td className="px-2.5 py-1">{r.mrpWarna || "—"}</td>
                            <td className="px-2.5 py-1">{r.skuWarna || "—"}</td>
                            <td className="px-2.5 py-1 text-text-muted">{r.catatan || "—"}</td>
                            <td className="px-2.5 py-1">
                              {r.issues.length > 0 ? <span className="text-danger-fg">{r.issues.join("; ")}</span> : <span className="text-success-fg">OK</span>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {rows.length > 300 && (
                      <div className="border-t border-[#F1F4F7] px-2.5 py-1.5 text-center font-sans text-[10.5px] text-text-muted">
                        …dan {rows.length - 300} baris lain (tetap ikut diproses saat disimpan).
                      </div>
                    )}
                  </div>
                </div>
              )}
              {saveError && <div className="mt-3 rounded-md border border-danger bg-danger-bg px-3 py-2 font-sans text-[11.5px] text-danger-fg">{saveError}</div>}
            </>
          )}
        </div>
        <div className="flex justify-end gap-2 border-t border-border-subtle px-5 py-3.5">
          <button onClick={onClose} className="rounded-md border border-[#CBD5DF] bg-white px-3.5 py-[7px] font-sans text-xs font-semibold text-action-primary">
            {result ? "Tutup" : "Batal"}
          </button>
          {!result && (
            <Button onClick={handleSave} disabled={validRows.length === 0 || saving} variant="primary" size="sm">
              {saving ? "Menyimpan…" : `Simpan ${validRows.length} baris →`}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
