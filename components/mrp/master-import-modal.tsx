"use client";

import { useState } from "react";
import * as XLSX from "xlsx";
import { Button } from "@/components/ui/button";

/** Popup "Import Data" umum untuk Master Data (owner 2026-10-26: "usahakan di setiap master data ada fitur import data"). Pola sama dengan popup
 *  Import Harga Kain/SKU/Mapping Warna: pilih file Excel/CSV, pratinjau tiap baris (baris bermasalah dilewati), lalu simpan. Tiap panel cukup memberi daftar
 *  kolom, aturan validasi, dan fungsi `save` (UPSERT: baris yang kuncinya sama dengan data yang sudah ada diperbarui, bukan digandakan). */

export type ImportColumn = {
  key: string;
  /** Judul kolom di template dan di pratinjau. */
  label: string;
  /** Nama kolom lain yang dikenali di file (tidak peduli huruf besar/kecil). */
  aliases?: string[];
  /** Wajib ada kolomnya di file DAN terisi di tiap baris. */
  required?: boolean;
  /** Nilai angka (dibaca dari "Rp 65.000", "65000", "1,5", dst.); kosong menjadi "". */
  number?: boolean;
  /** Contoh isi untuk file template. */
  example: string | number;
};

export type ImportValues = Record<string, string | number>;
export type ImportSummary = { inserted: number; updated: number; skipped?: number };

/** Simpan baris import satu per satu: kunci yang sama dengan data yang sudah ada = diperbarui (kalau `update` diberikan, kalau tidak = dilewati);
 *  kunci baru = ditambahkan; kunci yang muncul dua kali di file yang sama hanya ditambahkan sekali. */
export async function upsertRows(
  rows: ImportValues[],
  keyOf: (v: ImportValues) => string,
  existing: Map<string, string>,
  add: (v: ImportValues) => Promise<void>,
  update?: (id: string, v: ImportValues) => Promise<void>
): Promise<ImportSummary> {
  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  const added = new Set<string>();
  for (const v of rows) {
    const k = keyOf(v);
    const id = existing.get(k);
    if (id && update) {
      await update(id, v);
      updated++;
    } else if (id || added.has(k)) {
      skipped++;
    } else {
      await add(v);
      added.add(k);
      inserted++;
    }
  }
  return { inserted, updated, skipped };
}

/** Kunci pencocokan: huruf kecil, spasi rapi. */
export const normKey = (...parts: (string | number | undefined)[]) => parts.map((x) => String(x ?? "").trim().toLowerCase().replace(/\s+/g, " ")).join("|");

type ParsedRow = { rowNum: number; values: ImportValues; issues: string[] };

function toNumber(raw: unknown): number | "" {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : "";
  let s = String(raw ?? "").replace(/Rp/gi, "").replace(/\s/g, "").trim();
  if (!s) return "";
  if (s.includes(",") && s.includes(".")) s = s.replace(/\./g, "").replace(",", ".");
  else if (s.includes(",")) s = s.replace(",", ".");
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, "");
  const n = Number(s);
  return Number.isFinite(n) ? n : "";
}

async function parseFile(file: File, columns: ImportColumn[], validate?: (v: ImportValues) => string[]): Promise<ParsedRow[]> {
  const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) throw new Error("File tidak punya sheet data.");
  const rows: Record<string, unknown>[] = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { defval: null });
  if (rows.length === 0) throw new Error("Sheet kosong -- tidak ada baris data untuk diimpor.");

  const headers = Object.keys(rows[0]);
  const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
  const headerOf = new Map<string, string>();
  for (const c of columns) {
    const names = [c.label, ...(c.aliases ?? [])].map(norm);
    const found = headers.find((h) => names.includes(norm(h)));
    if (found) headerOf.set(c.key, found);
    else if (c.required) throw new Error(`Kolom "${c.label}" tidak ditemukan di file ini.`);
  }

  return rows.map((row, i) => {
    const values: ImportValues = {};
    const issues: string[] = [];
    for (const c of columns) {
      const h = headerOf.get(c.key);
      const raw = h ? row[h] : null;
      if (c.number) {
        const n = toNumber(raw);
        if (String(raw ?? "").trim() !== "" && n === "") issues.push(`${c.label} bukan angka`);
        values[c.key] = n;
      } else {
        values[c.key] = String(raw ?? "").trim();
      }
      if (c.required && (values[c.key] === "" || values[c.key] === undefined)) issues.push(`${c.label} kosong`);
    }
    if (issues.length === 0 && validate) issues.push(...validate(values));
    return { rowNum: i + 2, values, issues };
  });
}

export function MasterImportModal({
  title,
  columns,
  templateName,
  matchNote,
  validate,
  save,
  onClose,
}: {
  title: string;
  columns: ImportColumn[];
  templateName: string;
  /** Kalimat singkat: kombinasi kolom apa yang dianggap "baris yang sama" (diperbarui, bukan digandakan). */
  matchNote: string;
  validate?: (values: ImportValues) => string[];
  save: (rows: ImportValues[]) => Promise<ImportSummary>;
  onClose: () => void;
}) {
  const [fileName, setFileName] = useState<string | null>(null);
  const [rows, setRows] = useState<ParsedRow[] | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportSummary | null>(null);

  async function handleFile(file: File) {
    setLoading(true);
    setParseError(null);
    setRows(null);
    setResult(null);
    setSaveError(null);
    setFileName(file.name);
    try {
      setRows(await parseFile(file, columns, validate));
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
      setResult(await save(validRows.map((r) => r.values)));
      setRows(null);
      setFileName(null);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Gagal menyimpan data.");
    } finally {
      setSaving(false);
    }
  }

  function downloadTemplate() {
    const wb = XLSX.utils.book_new();
    const example: Record<string, string | number> = {};
    for (const c of columns) example[c.label] = c.example;
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([example]), "Data");
    XLSX.writeFile(wb, templateName);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0B131B]/45 p-4">
      <div className="flex max-h-[88vh] w-full max-w-[760px] flex-col rounded-lg bg-white shadow-[0_8px_24px_rgba(11,19,27,.2)]">
        <div className="flex items-center justify-between border-b border-border-subtle px-5 py-3.5">
          <span className="font-sans text-[13px] font-semibold text-text-primary">Import Data — {title}</span>
          <button onClick={onClose} className="font-sans text-[13px] font-semibold text-text-muted hover:text-text-primary">
            ✕
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {result ? (
            <div className="rounded-md border border-success-fg/30 bg-success-bg px-4 py-3 font-sans text-[12.5px] text-success-fg">
              <div className="font-semibold">Berhasil disimpan.</div>
              <div className="mt-1">
                {result.inserted} baris baru ditambahkan, {result.updated} baris yang sudah ada diperbarui
                {result.skipped ? `, ${result.skipped} baris dilewati (sudah ada)` : ""}.
              </div>
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void handleFile(file);
                  }}
                  className="input flex-1 file:mr-2.5 file:rounded file:border-0 file:bg-info-bg file:px-2.5 file:py-1 file:font-sans file:text-[11px] file:font-semibold file:text-info-fg"
                />
                <button onClick={downloadTemplate} className="flex-none font-sans text-[11.5px] font-semibold text-action-primary underline">
                  Download Template ↓
                </button>
              </div>
              <div className="mt-1.5 font-sans text-[10.5px] leading-[1.5] text-text-muted">
                Kolom yang dikenali:{" "}
                {columns.map((c, i) => (
                  <span key={c.key}>
                    <span className="font-mono">{c.label.toUpperCase()}</span>
                    {c.required ? "" : " (opsional)"}
                    {i < columns.length - 1 ? ", " : ". "}
                  </span>
                ))}
                {matchNote}
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
                  <div className="mt-2 max-h-[320px] overflow-x-auto overflow-y-auto rounded-md border border-[#E4E9EE]">
                    <table className="w-full border-collapse font-sans text-[11px]">
                      <thead className="sticky top-0 bg-[#F2F5F8]">
                        <tr className="text-left uppercase tracking-wider text-text-muted">
                          <th className="px-2.5 py-1.5">Baris</th>
                          {columns.map((c) => (
                            <th key={c.key} className={"px-2.5 py-1.5 " + (c.number ? "text-right" : "")}>{c.label}</th>
                          ))}
                          <th className="px-2.5 py-1.5">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.slice(0, 300).map((r) => (
                          <tr key={r.rowNum} className={"border-t border-[#F1F4F7] " + (r.issues.length > 0 ? "bg-danger-bg/40" : "")}>
                            <td className="px-2.5 py-1 font-mono text-text-muted">{r.rowNum}</td>
                            {columns.map((c) => (
                              <td key={c.key} className={"px-2.5 py-1 " + (c.number ? "text-right font-mono" : "")}>
                                {r.values[c.key] === "" ? "—" : typeof r.values[c.key] === "number" ? (r.values[c.key] as number).toLocaleString("id-ID") : r.values[c.key]}
                              </td>
                            ))}
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
