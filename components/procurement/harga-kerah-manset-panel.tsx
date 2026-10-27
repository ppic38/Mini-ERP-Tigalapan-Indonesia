"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { NumberInput } from "@/components/mrp/number-input";
import { DataTable, type ColumnDef } from "@/components/mrp/data-table";
import { MasterImportModal, normKey, upsertRows, type ImportValues } from "@/components/mrp/master-import-modal";
import { MasterDataFormModal, ModalField } from "@/components/mrp/master-data-form-modal";
import { formatRupiah, formatDateTime } from "@/lib/mrp/derive";
import { useMrpStore } from "@/lib/mrp/store";
import type { HargaKerahMansetRow } from "@/lib/mrp/masterData";

type Draft = { kodeSupplier: string; hargaKerahPerKg: number; hargaMansetPerKg: number };
const EMPTY_DRAFT: Draft = { kodeSupplier: "", hargaKerahPerKg: 0, hargaMansetPerKg: 0 };

/** Master Data — Harga Kerah & Manset per kg, per supplier (migration 0038). Tampil di tab
 *  Kerah/Manset di bawah pengaturan konversi global. DIPAKAI LIVE oleh `hargaKerahMansetRateInfo`
 *  (lib/mrp/derive.ts) untuk kolom "Est. Kerah (Rp)"/"Est. Manset (Rp)" di PO Approval.
 *  Revisi 2026-09-17 (owner: "hindari typo nama supplier"): Kode/Nama Supplier dulu diketik bebas
 *  -- sekarang dropdown dari `materialSuppliers` (Master Data Vendor & Supplier), sama pola dengan
 *  HargaKainPanel/HargaRibPanel. "+ Tambah baris"/"Edit" inline juga diganti popup form. */
export function HargaKerahMansetPanel() {
  const rows = useMrpStore((s) => s.hargaKerahManset);
  const addRow = useMrpStore((s) => s.addHargaKerahMansetRow);
  const updateRow = useMrpStore((s) => s.updateHargaKerahMansetRow);
  const deleteRow = useMrpStore((s) => s.deleteHargaKerahMansetRow);
  const materialSuppliers = useMrpStore((s) => s.materialSuppliers);

  const [mode, setMode] = useState<"add" | "edit" | null>(null);
  const [editingRow, setEditingRow] = useState<HargaKerahMansetRow | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [importOpen, setImportOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function openAdd() {
    setDraft(EMPTY_DRAFT);
    setEditingRow(null);
    setError("");
    setMode("add");
  }
  function openEdit(r: HargaKerahMansetRow) {
    setDraft({ kodeSupplier: r.kodeSupplier, hargaKerahPerKg: r.hargaKerahPerKg, hargaMansetPerKg: r.hargaMansetPerKg });
    setEditingRow(r);
    setError("");
    setMode("edit");
  }

  async function handleSave() {
    setError("");
    const supplier = materialSuppliers.find((s) => s.nama === draft.kodeSupplier);
    if (!supplier) {
      setError("Pilih supplier dulu.");
      return;
    }
    // kodeSupplier di harga_kerah_manset TETAP kolom teks lama -- diisi SAMA dengan nama supplier
    // (kode tidak ada lagi konsepnya sejak migration 0043).
    const payload = { kodeSupplier: supplier.nama, namaSupplier: supplier.nama, hargaKerahPerKg: draft.hargaKerahPerKg, hargaMansetPerKg: draft.hargaMansetPerKg };
    setSaving(true);
    try {
      if (mode === "edit" && editingRow) await updateRow(editingRow.id, payload);
      else await addRow(payload);
      setMode(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  const columns: ColumnDef<HargaKerahMansetRow>[] = [
    { key: "namaSupplier", label: "Supplier", default: true, render: (r) => r.namaSupplier || r.kodeSupplier || "—" },
    { key: "hargaKerahPerKg", label: "Harga Kerah per kg", default: true, align: "right", render: (r) => formatRupiah(r.hargaKerahPerKg) },
    { key: "hargaMansetPerKg", label: "Harga Manset per kg", default: true, align: "right", render: (r) => formatRupiah(r.hargaMansetPerKg) },
    { key: "updatedAt", label: "Terakhir diupdate", default: true, render: (r) => <span className="font-mono text-[11px] text-text-muted">{formatDateTime(r.updatedAt)}</span> },
    {
      key: "aksi",
      label: "Aksi",
      default: true,
      render: (r) => (
        <div className="flex items-center gap-1.5">
          <Button onClick={() => openEdit(r)} variant="ghost" size="xs">
            Edit
          </Button>
          <Button onClick={() => deleteRow(r.id)} variant="danger" size="xs">
            Hapus
          </Button>
        </div>
      ),
    },
  ];

  return (
    <>
      <DataTable
        title="Harga Kerah/Manset per Supplier"
        headerActions={
          <div className="flex items-center gap-1.5">
            <Button onClick={() => setImportOpen(true)} variant="ghost" size="sm">
              Import Data
            </Button>
            <Button onClick={openAdd} variant="dashed" size="sm">
              + Tambah Data
            </Button>
          </div>
        }
        columns={columns}
        rows={rows}
        keyOf={(r) => r.id}
        firstColumnLabel="No."
        firstColumnRender={(r) => <span className="font-mono text-[11px] text-text-muted">{rows.indexOf(r) + 1}</span>}
        search={{ placeholder: "Cari supplier…", getText: (r) => `${r.namaSupplier} ${r.kodeSupplier}` }}
        emptyText='Belum ada data — klik "+ Tambah Data".'
      />
      {mode && (
        <MasterDataFormModal title={mode === "add" ? "Tambah Harga Kerah/Manset" : "Edit Harga Kerah/Manset"} onCancel={() => setMode(null)} onSave={handleSave} saving={saving} error={error}>
          <ModalField label="Supplier">
            <select value={draft.kodeSupplier} onChange={(e) => setDraft({ ...draft, kodeSupplier: e.target.value })} className="input w-full">
              <option value="">— pilih supplier —</option>
              {materialSuppliers.map((s) => (
                <option key={s.id} value={s.nama}>
                  {s.nama}
                </option>
              ))}
            </select>
          </ModalField>
          <ModalField label="Harga Kerah per kg">
            <NumberInput value={draft.hargaKerahPerKg} onChange={(v) => setDraft({ ...draft, hargaKerahPerKg: v })} currency className="input w-full" />
          </ModalField>
          <ModalField label="Harga Manset per kg">
            <NumberInput value={draft.hargaMansetPerKg} onChange={(v) => setDraft({ ...draft, hargaMansetPerKg: v })} currency className="input w-full" />
          </ModalField>
        </MasterDataFormModal>
      )}
      {importOpen && (
        <MasterImportModal
          title="Harga Kerah/Manset"
          templateName="Template-Import-Harga-Kerah-Manset.xlsx"
          matchNote="Baris dengan Supplier yang SAMA dengan data yang sudah ada akan diperbarui, bukan digandakan."
          columns={[
            { key: "supplier", label: "Supplier", aliases: ["Kode Supplier", "Nama Supplier"], required: true, example: materialSuppliers[0]?.nama ?? "KNITTO" },
            { key: "hargaKerahPerKg", label: "Harga Kerah Per Kg", aliases: ["Harga Kerah"], number: true, example: 100000 },
            { key: "hargaMansetPerKg", label: "Harga Manset Per Kg", aliases: ["Harga Manset"], number: true, example: 100000 },
          ]}
          validate={(v) => (materialSuppliers.some((s) => s.nama.toLowerCase() === String(v.supplier).trim().toLowerCase()) ? [] : ["Supplier tidak ada di Master Data Supplier Material"])}
          save={(vals) => {
            const supplierOf = (v: ImportValues) => materialSuppliers.find((s) => s.nama.toLowerCase() === String(v.supplier).trim().toLowerCase())!.nama;
            const payload = (v: ImportValues) => ({
              kodeSupplier: supplierOf(v),
              namaSupplier: supplierOf(v),
              hargaKerahPerKg: Number(v.hargaKerahPerKg || 0),
              hargaMansetPerKg: Number(v.hargaMansetPerKg || 0),
            });
            const existing = new Map(rows.map((r) => [normKey(r.namaSupplier || r.kodeSupplier), r.id]));
            return upsertRows(vals, (v) => normKey(supplierOf(v)), existing, (v) => addRow(payload(v)), (id, v) => updateRow(id, payload(v)));
          }}
          onClose={() => setImportOpen(false)}
        />
      )}
    </>
  );
}
