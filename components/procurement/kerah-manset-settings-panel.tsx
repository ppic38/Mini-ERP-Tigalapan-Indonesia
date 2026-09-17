"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { NumberInput } from "@/components/mrp/number-input";
import { DataTable, type ColumnDef } from "@/components/mrp/data-table";
import { MasterDataFormModal, ModalField } from "@/components/mrp/master-data-form-modal";
import { formatRupiah } from "@/lib/mrp/derive";
import { useMrpStore } from "@/lib/mrp/store";
import type { KerahMansetSettingRow } from "@/lib/mrp/masterData";

type Draft = { kgPerPcs: number; hargaPerKg: number };

/** Master Data — Kerah/Manset (konversi qty PCS -> kg + harga/kg, GLOBAL untuk semua warna
 *  kategori WANGKI MYNO, migration 0036). BEDA dari kolom kerah_kg/manset_kg di lengan_groups/
 *  material_rows (migration 0033, itu KG HASIL KONVERSI per warna) — tabel ini PARAMETER
 *  konversinya, DIPAKAI LIVE oleh `parseMrpImportFile` (lib/mrp/parseImport.ts) saat import MRP
 *  baru kategori WANGKI MYNO & untuk estimasi nominal Kerah/Manset di PO Approval
 *  (app/procurement/po-approval/page.tsx) — TIDAK mengubah nilai PO Bahan otomatis (Kerah/Manset
 *  tetap masuk manual lewat Add Buy di Paying Voucher seperti sekarang). SELALU PERSIS 2 baris
 *  (KERAH & MANSET) — tidak ada tombol tambah/hapus baris, cuma update 2 field per baris.
 *  Revisi 2026-09-17: "Edit" inline diganti popup form, sama pola dengan panel Master Data lain
 *  (lihat MasterDataFormModal) -- tidak ada "+ Tambah Data" di sini (selalu persis 2 baris). */
export function KerahMansetSettingsPanel() {
  const rowsRaw = useMrpStore((s) => s.kerahMansetSettings);
  const updateRow = useMrpStore((s) => s.updateKerahMansetSetting);

  // Urutan tampil KERAH lalu MANSET — tidak terjamin dari server (order by kind di migration
  // seharusnya sudah alfabetis KERAH < MANSET, tapi tetap di-sort eksplisit di sini untuk aman).
  const rows = [...rowsRaw].sort((a, b) => (a.kind === "KERAH" ? 0 : 1) - (b.kind === "KERAH" ? 0 : 1));

  const [editingRow, setEditingRow] = useState<KerahMansetSettingRow | null>(null);
  const [draft, setDraft] = useState<Draft>({ kgPerPcs: 0, hargaPerKg: 0 });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function openEdit(r: KerahMansetSettingRow) {
    setDraft({ kgPerPcs: r.kgPerPcs, hargaPerKg: r.hargaPerKg });
    setEditingRow(r);
    setError("");
  }

  async function handleSave() {
    if (!editingRow) return;
    setError("");
    setSaving(true);
    try {
      await updateRow(editingRow.kind, draft);
      setEditingRow(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  const columns: ColumnDef<KerahMansetSettingRow>[] = [
    { key: "item", label: "Item", default: true, render: (r) => <span className="font-sans text-[12.5px] font-medium text-text-primary">{r.kind === "KERAH" ? "Kerah" : "Manset"}</span> },
    { key: "kgPerPcs", label: "Kg per Pcs", default: true, align: "right", render: (r) => r.kgPerPcs.toLocaleString("id-ID", { minimumFractionDigits: 3, maximumFractionDigits: 3 }) },
    { key: "hargaPerKg", label: "Harga per Kg", default: true, align: "right", render: (r) => formatRupiah(r.hargaPerKg) },
    {
      key: "aksi",
      label: "Aksi",
      default: true,
      render: (r) => (
        <Button onClick={() => openEdit(r)} variant="ghost" size="xs">
          Edit
        </Button>
      ),
    },
  ];

  return (
    <>
      <DataTable
        title="Kerah/Manset"
        subtitle="Parameter konversi qty pcs -> kg untuk kebutuhan Kerah & Manset kategori WANGKI MYNO — dipakai untuk mengonversi angka di kolom Excel KERAH/MANSET saat import MRP baru. Harga per kg di sini hanya CADANGAN untuk estimasi Rp di PO Approval kalau tabel Harga Kerah/Manset per Supplier di bawah tidak punya baris supplier itu maupun KNITTO. TIDAK mengubah nilai PO Bahan otomatis (tetap masuk manual lewat Add Buy di Paying Voucher)."
        columns={columns}
        rows={rows}
        keyOf={(r) => r.kind}
        search={{ placeholder: "Cari item…", getText: (r) => (r.kind === "KERAH" ? "Kerah" : "Manset") }}
        firstColumnLabel="No."
        firstColumnRender={(r) => <span className="font-mono text-[11px] text-text-muted">{rows.indexOf(r) + 1}</span>}
        emptyText="Data belum tersedia."
        bodyMaxHeight="60vh"
      />
      {editingRow && (
        <MasterDataFormModal title={`Edit ${editingRow.kind === "KERAH" ? "Kerah" : "Manset"}`} onCancel={() => setEditingRow(null)} onSave={handleSave} saving={saving} error={error}>
          <ModalField label="Kg per Pcs">
            <NumberInput value={draft.kgPerPcs} onChange={(v) => setDraft({ ...draft, kgPerPcs: v })} decimals={3} className="input w-full" />
          </ModalField>
          <ModalField label="Harga per Kg">
            <NumberInput value={draft.hargaPerKg} onChange={(v) => setDraft({ ...draft, hargaPerKg: v })} currency className="input w-full" />
          </ModalField>
        </MasterDataFormModal>
      )}
    </>
  );
}
