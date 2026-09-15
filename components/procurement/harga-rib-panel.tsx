"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { NumberInput } from "@/components/mrp/number-input";
import { DataTable, type ColumnDef } from "@/components/mrp/data-table";
import { EditableCell } from "@/components/mrp/editable-cell";
import { formatRupiah } from "@/lib/mrp/derive";
import { useMrpStore } from "@/lib/mrp/store";
import type { HargaRibRow } from "@/lib/mrp/masterData";

/** Master Data — Harga RIB per kg, per supplier + warna (migration 0037). Pola sama seperti
 *  HargaKainPanel (tanpa kolom kategori). DIPAKAI LIVE oleh `hargaRibRateInfo` (lib/mrp/derive.ts)
 *  untuk kolom "Est. Rib (Rp)" di PO Approval -- supplier yang belum punya baris sendiri di sini
 *  otomatis memakai harga KNITTO untuk warna yang sama. */
export function HargaRibPanel() {
  const rows = useMrpStore((s) => s.hargaRib);
  const addRow = useMrpStore((s) => s.addHargaRibRow);
  const updateRow = useMrpStore((s) => s.updateHargaRibRow);
  const deleteRow = useMrpStore((s) => s.deleteHargaRibRow);
  // Sama seperti panel Master Data lain -- baris harus diklik "Edit" dulu sebelum bisa diketik.
  const [editingId, setEditingId] = useState<string | null>(null);

  const columns: ColumnDef<HargaRibRow>[] = [
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
      key: "warna",
      label: "Warna",
      default: true,
      render: (r) => (
        <EditableCell editing={editingId === r.id} display={r.warna || "—"}>
          <input value={r.warna} onChange={(e) => updateRow(r.id, { warna: e.target.value })} className="input w-[160px]" />
        </EditableCell>
      ),
    },
    {
      key: "hargaPerKg",
      label: "Harga RIB per kg",
      default: true,
      align: "right",
      render: (r) => (
        <EditableCell editing={editingId === r.id} display={formatRupiah(r.hargaPerKg)}>
          <NumberInput value={r.hargaPerKg} onChange={(v) => updateRow(r.id, { hargaPerKg: v })} currency commitOnBlurOnly className="input w-[110px] text-right" />
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
      title="Harga RIB"
      subtitle={`Harga RIB per kg — ${rows.length} baris. DIPAKAI LIVE untuk estimasi Rp RIB di PO Approval (Rib kg x harga/kg). Supplier yang belum punya baris sendiri memakai harga KNITTO untuk warna yang sama.`}
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
      search={{ placeholder: "Cari warna/supplier…", getText: (r) => `${r.warna} ${r.namaSupplier} ${r.kodeSupplier}` }}
      filterDefs={[
        { label: "Kode Supplier", options: Array.from(new Set(rows.map((r) => r.kodeSupplier).filter(Boolean))).sort((a, b) => a.localeCompare(b, "id-ID")), test: (r, v) => r.kodeSupplier === v },
        { label: "Warna", options: Array.from(new Set(rows.map((r) => r.warna).filter(Boolean))).sort((a, b) => a.localeCompare(b, "id-ID")), test: (r, v) => r.warna === v },
      ]}
      emptyText='Belum ada data — klik "+ Tambah baris".'
      bodyMaxHeight="60vh"
    />
  );
}
