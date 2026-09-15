"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { NumberInput } from "@/components/mrp/number-input";
import { DataTable, type ColumnDef } from "@/components/mrp/data-table";
import { EditableCell } from "@/components/mrp/editable-cell";
import { formatRupiah } from "@/lib/mrp/derive";
import { useMrpStore } from "@/lib/mrp/store";
import type { HargaKerahMansetRow } from "@/lib/mrp/masterData";

/** Master Data — Harga Kerah & Manset per kg, per supplier (migration 0038). Tampil di tab
 *  Kerah/Manset di bawah pengaturan konversi global. DIPAKAI LIVE oleh `hargaKerahMansetRateInfo`
 *  (lib/mrp/derive.ts) untuk kolom "Est. Kerah (Rp)"/"Est. Manset (Rp)" di PO Approval. */
export function HargaKerahMansetPanel() {
  const rows = useMrpStore((s) => s.hargaKerahManset);
  const addRow = useMrpStore((s) => s.addHargaKerahMansetRow);
  const updateRow = useMrpStore((s) => s.updateHargaKerahMansetRow);
  const deleteRow = useMrpStore((s) => s.deleteHargaKerahMansetRow);
  // Sama seperti panel Master Data lain -- baris harus diklik "Edit" dulu sebelum bisa diketik.
  const [editingId, setEditingId] = useState<string | null>(null);

  const columns: ColumnDef<HargaKerahMansetRow>[] = [
    {
      key: "kodeSupplier",
      label: "Kode Supplier",
      default: true,
      render: (r) => (
        <EditableCell editing={editingId === r.id} display={r.kodeSupplier || "—"}>
          <input value={r.kodeSupplier} onChange={(e) => updateRow(r.id, { kodeSupplier: e.target.value })} className="input w-[110px]" />
        </EditableCell>
      ),
    },
    {
      key: "namaSupplier",
      label: "Nama Supplier",
      default: true,
      render: (r) => (
        <EditableCell editing={editingId === r.id} display={r.namaSupplier || "—"}>
          <input value={r.namaSupplier} onChange={(e) => updateRow(r.id, { namaSupplier: e.target.value })} className="input w-[130px]" />
        </EditableCell>
      ),
    },
    {
      key: "hargaKerahPerKg",
      label: "Harga Kerah per kg",
      default: true,
      align: "right",
      render: (r) => (
        <EditableCell editing={editingId === r.id} display={formatRupiah(r.hargaKerahPerKg)}>
          <NumberInput value={r.hargaKerahPerKg} onChange={(v) => updateRow(r.id, { hargaKerahPerKg: v })} currency commitOnBlurOnly className="input w-[110px] text-right" />
        </EditableCell>
      ),
    },
    {
      key: "hargaMansetPerKg",
      label: "Harga Manset per kg",
      default: true,
      align: "right",
      render: (r) => (
        <EditableCell editing={editingId === r.id} display={formatRupiah(r.hargaMansetPerKg)}>
          <NumberInput value={r.hargaMansetPerKg} onChange={(v) => updateRow(r.id, { hargaMansetPerKg: v })} currency commitOnBlurOnly className="input w-[110px] text-right" />
        </EditableCell>
      ),
    },
    {
      key: "aksi",
      label: "Aksi",
      default: true,
      render: (r) => (
        <div className="flex items-center gap-1.5">
          <Button onClick={() => setEditingId(editingId === r.id ? null : r.id)} variant={editingId === r.id ? "success" : "ghost"} size="xs">
            {editingId === r.id ? "Simpan" : "Edit"}
          </Button>
          <Button onClick={() => deleteRow(r.id)} variant="danger" size="xs">
            Hapus
          </Button>
        </div>
      ),
    },
  ];

  return (
    <DataTable
      title="Harga Kerah/Manset per Supplier"
      subtitle={`Harga per kg — ${rows.length} supplier. DIPAKAI LIVE untuk estimasi Rp Kerah/Manset di PO Approval (kg x harga/kg). Supplier yang belum punya baris sendiri memakai harga KNITTO; kalau KNITTO pun tidak ada, memakai harga global di atas.`}
      headerActions={
        <Button onClick={addRow} variant="dashed" size="sm">
          + Tambah baris
        </Button>
      }
      columns={columns}
      rows={rows}
      keyOf={(r) => r.id}
      alwaysShowKey={editingId}
      firstColumnLabel="No."
      firstColumnRender={(r) => <span className="font-mono text-[11px] text-text-muted">{rows.indexOf(r) + 1}</span>}
      search={{ placeholder: "Cari supplier…", getText: (r) => `${r.namaSupplier} ${r.kodeSupplier}` }}
      emptyText='Belum ada data — klik "+ Tambah baris".'
    />
  );
}
