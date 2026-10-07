"use client";

import { useState } from "react";
import { confirmDialog } from "@/components/ui/confirm-dialog";
import { Button } from "@/components/ui/button";
import { parseMigrationImportFile, type ParsedMigration } from "@/lib/mrp/parseMigrationImport";
import { importMigrationAction, type MigrationImportResult } from "@/lib/mrp/actions";
import { useMrpStore } from "@/lib/mrp/store";

/** Panel "Migrasi Data" (PPIC, owner 2026-09-25) -- unggah template Excel migrasi Konveksi Makassar:
 *  pekerjaan yang masih berjalan masuk langsung di tahap terakhirnya (A gudang / B dipotong / C jadi
 *  FG / D dikirim), tanpa mengulang siklus MRP -> PO -> invoice. Selalu tampilkan pratinjau +
 *  daftar masalah dulu; tombol Impor baru aktif kalau tidak ada error. Lihat importMigrationAction. */
export function MigrationImportPanel() {
  const refresh = useMrpStore((s) => s.refresh);
  const [fileName, setFileName] = useState<string | null>(null);
  const [parsed, setParsed] = useState<ParsedMigration | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [result, setResult] = useState<MigrationImportResult | null>(null);

  async function handleFile(file: File) {
    setLoading(true);
    setParseError(null);
    setParsed(null);
    setResult(null);
    setSaveError(null);
    setFileName(file.name);
    try {
      setParsed(await parseMigrationImportFile(file));
    } catch (e) {
      setParseError(e instanceof Error ? e.message : "Gagal membaca file.");
    } finally {
      setLoading(false);
    }
  }

  const errors = parsed?.issues.filter((i) => i.severity === "error") ?? [];
  const warnings = parsed?.issues.filter((i) => i.severity === "warning") ?? [];
  const mrps = parsed?.mrps ?? [];
  const totalRolls = mrps.reduce((s, m) => s + m.rolls.length, 0);
  const countTahap = (t: string) => mrps.reduce((s, m) => s + m.rolls.filter((r) => r.tahap === t).length, 0);

  async function handleImport() {
    if (!parsed || errors.length > 0 || mrps.length === 0 || saving) return;
    const ok = await confirmDialog({
      title: `Impor ${mrps.length} MRP (${totalRolls} roll) ke ERP?`,
      message: 'Data langsung masuk ke database dan terlihat di PPIC, SCM, Produksi, dan vendor Konveksi Makassar. Pastikan file sudah benar.',
      confirmLabel: "Impor sekarang",
    });
    if (!ok) return;
    setSaving(true);
    setSaveError(null);
    const res = await importMigrationAction(parsed.mrps);
    setSaving(false);
    if (!res.ok) {
      setSaveError(res.error);
      void refresh();
      return;
    }
    setResult(res.data);
    setParsed(null);
    setFileName(null);
    void refresh();
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-lg border border-border-subtle bg-surface-card px-4 py-3.5">
        <div className="font-sans text-[13px] font-semibold text-text-primary">Migrasi Data Awal — Konveksi Makassar</div>
        <div className="mt-1 font-sans text-[11.5px] leading-[1.55] text-text-muted">
          Masukkan pekerjaan yang <span className="font-semibold text-text-primary">masih berjalan</span> dari catatan manual langsung di tahap terakhirnya (di gudang, sudah dipotong, sudah jadi, atau sudah dikirim belum
          diinvoice), tanpa mengulang siklus dari Start MRP. MRP hasil migrasi tampil di PPIC, SCM, Produksi, dan vendor Konveksi Makassar; tidak ada tagihan yang masuk ke Finance.
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input
            type="file"
            accept=".xlsx,.xls"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleFile(file);
            }}
            className="input flex-1 file:mr-2.5 file:rounded file:border-0 file:bg-info-bg file:px-2.5 file:py-1 file:font-sans file:text-[11px] file:font-semibold file:text-info-fg"
          />
          <a href="/templates/Template-Migrasi-Data-Konveksi-Makassar.xlsx" download className="flex-none font-sans text-[11.5px] font-semibold text-action-primary underline">
            Download Template ↓
          </a>
        </div>
        {loading && <div className="mt-3 font-sans text-xs text-text-muted">Membaca {fileName}…</div>}
        {parseError && <div className="mt-3 rounded-md border border-danger bg-danger-bg px-3 py-2 font-sans text-[11.5px] text-danger-fg">{parseError}</div>}
      </div>

      {result && (
        <div className="rounded-md border border-success-fg/30 bg-success-bg px-4 py-3 font-sans text-[12.5px] text-success-fg">
          <div className="font-semibold">Berhasil diimpor.</div>
          <div className="mt-1">
            {result.summary.mrpCount} MRP, {result.summary.lineCount} baris warna, {result.summary.rollCount} roll, {result.summary.batchCount} batch cutting, {result.summary.koliCount} koli.
          </div>
          <ul className="mt-1.5 list-disc pl-5 text-[11.5px]">
            {result.created.map((c) => (
              <li key={c.mrpId}>
                <span className="font-mono">{c.mrpId}</span> — {c.rolls} roll, {c.batches} batch, {c.kolis} koli
              </li>
            ))}
          </ul>
        </div>
      )}

      {saveError && <div className="rounded-md border border-danger bg-danger-bg px-4 py-3 font-sans text-[12px] text-danger-fg">Impor gagal: {saveError}</div>}

      {parsed && (
        <>
          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border-subtle bg-surface-card px-4 py-3 font-sans text-[11.5px]">
            <span className="font-semibold text-text-primary">{fileName}</span>
            <span>{mrps.length} MRP</span>
            <span>{totalRolls} roll</span>
            <span className="text-text-muted">
              G {countTahap("G")} · A {countTahap("A")} · B {countTahap("B")} · C {countTahap("C")} · D {countTahap("D")}
            </span>
            {errors.length > 0 && <span className="font-semibold text-danger-fg">{errors.length} error (harus diperbaiki)</span>}
            {warnings.length > 0 && <span className="text-warning-fg">{warnings.length} peringatan</span>}
            {errors.length === 0 && mrps.length > 0 && <span className="font-semibold text-success-fg">Siap diimpor</span>}
            <span className="flex-1" />
            <Button onClick={handleImport} disabled={errors.length > 0 || mrps.length === 0 || saving} variant="primary" size="sm">
              {saving ? "Mengimpor…" : `Impor ${mrps.length} MRP →`}
            </Button>
          </div>

          {parsed.issues.length > 0 && (
            <div className="overflow-hidden rounded-lg border border-border-subtle bg-surface-card">
              <div className="border-b border-border-subtle px-4 py-2.5 font-sans text-[12.5px] font-semibold text-text-primary">Hasil pengecekan</div>
              <div className="max-h-[280px] overflow-y-auto">
                <table className="w-full border-collapse font-sans text-[11px]">
                  <thead className="sticky top-0 bg-[#F2F5F8]">
                    <tr className="text-left uppercase tracking-wider text-text-muted">
                      <th className="px-3 py-1.5">Jenis</th>
                      <th className="px-3 py-1.5">Sheet</th>
                      <th className="px-3 py-1.5">Baris</th>
                      <th className="px-3 py-1.5">Keterangan</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...errors, ...warnings].slice(0, 300).map((i, idx) => (
                      <tr key={idx} className={"border-t border-[#F1F4F7] " + (i.severity === "error" ? "bg-danger-bg/40" : "")}>
                        <td className={"px-3 py-1 font-semibold " + (i.severity === "error" ? "text-danger-fg" : "text-warning-fg")}>{i.severity === "error" ? "Error" : "Peringatan"}</td>
                        <td className="px-3 py-1 font-mono">{i.sheet}</td>
                        <td className="px-3 py-1 font-mono">{i.row ?? "—"}</td>
                        <td className="px-3 py-1">{i.message}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {mrps.length > 0 && (
            <div className="overflow-hidden rounded-lg border border-border-subtle bg-surface-card">
              <div className="border-b border-border-subtle px-4 py-2.5 font-sans text-[12.5px] font-semibold text-text-primary">Pratinjau MRP yang akan dibuat</div>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse font-sans text-[11.5px]">
                  <thead className="bg-[#F2F5F8]">
                    <tr className="text-left uppercase tracking-wider text-text-muted">
                      <th className="px-3 py-1.5">No MRP</th>
                      <th className="px-3 py-1.5">Ref. PO manual</th>
                      <th className="px-3 py-1.5">Warna · lengan</th>
                      <th className="px-3 py-1.5 text-right">Roll</th>
                      <th className="px-3 py-1.5 text-right" title="Menunggu Good Receive">G</th>
                      <th className="px-3 py-1.5 text-right">A</th>
                      <th className="px-3 py-1.5 text-right">B</th>
                      <th className="px-3 py-1.5 text-right">C</th>
                      <th className="px-3 py-1.5 text-right">D</th>
                      <th className="px-3 py-1.5 text-right">Rencana pcs</th>
                    </tr>
                  </thead>
                  <tbody>
                    {mrps.map((m) => (
                      <tr key={m.mrpId} className="border-t border-[#F1F4F7] align-top">
                        <td className="px-3 py-1.5 font-mono font-medium">{m.mrpId}</td>
                        <td className="px-3 py-1.5 text-text-muted">{m.poRef ?? "—"}</td>
                        <td className="px-3 py-1.5">
                          {m.lines.map((l) => (
                            <div key={l.warna + l.lengan}>
                              {l.warna} · {l.lengan}
                            </div>
                          ))}
                        </td>
                        <td className="px-3 py-1.5 text-right font-mono">{m.rolls.length}</td>
                        {(["G", "A", "B", "C", "D"] as const).map((t) => (
                          <td key={t} className="px-3 py-1.5 text-right font-mono">
                            {m.rolls.filter((r) => r.tahap === t).length}
                          </td>
                        ))}
                        <td className="px-3 py-1.5 text-right font-mono">{m.lines.reduce((s, l) => s + Object.values(l.sizes).reduce((a, b) => a + b, 0), 0)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
