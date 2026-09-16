"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { NumberInput } from "@/components/mrp/number-input";
import { DataTable, type ColumnDef } from "@/components/mrp/data-table";
import { EditableCell } from "@/components/mrp/editable-cell";
import { formatRupiah } from "@/lib/mrp/derive";
import { useMrpStore } from "@/lib/mrp/store";
import type { HargaKainRow } from "@/lib/mrp/masterData";

/** Master Data — Harga Kain/Material flat per kg, per supplier + kategori + warna. Bisa 468+
 *  baris (dari sheet asli) — pakai filterDefs DataTable untuk menyaring. DIPAKAI LIVE oleh
 *  `hargaKainRateInfo` (lib/mrp/derive.ts) untuk estimasi harga PO Material di PO Approval,
 *  Finance PO Material, export PDF PO, dan modal PV Pengganti -- fallback "Standar" kalau tidak
 *  ada tingkatan tonase Harga Kain PKS yang cocok untuk warna/supplier/berat pesanan itu. */
export function HargaKainPanel() {
  const rows = useMrpStore((s) => s.hargaKain);
  const addRow = useMrpStore((s) => s.addHargaKainRow);
  const updateRow = useMrpStore((s) => s.updateHargaKainRow);
  const deleteRow = useMrpStore((s) => s.deleteHargaKainRow);
  // Migration 0042 (owner 2026-09-16: "supaya tidak ada typo penulisan") -- daftar pilihan
  // dropdown, BUKAN foreign key. Pilih supplier di sini mengisi kodeSupplier+namaSupplier
  // sekaligus dari Master Data "Supplier Kain"; baris lama yang sudah ada TETAP tampil apa
  // adanya walau nama supplier-nya kebetulan belum/tidak ada di daftar itu.
  const materialSuppliers = useMrpStore((s) => s.materialSuppliers);
  // Item revisi 2026-09-15 -- baris harus diklik "Edit" dulu sebelum bisa diketik (cegah salah ketik).
  const [editingId, setEditingId] = useState<string | null>(null);

  const columns: ColumnDef<HargaKainRow>[] = [
    {
      key: "supplier",
      label: "Supplier",
      default: true,
      render: (r) => (
        <EditableCell editing={editingId === r.id} display={r.namaSupplier || r.kodeSupplier || "—"}>
          <select
            value={r.kodeSupplier}
            onChange={(e) => {
              const sup = materialSuppliers.find((s) => s.kode === e.target.value);
              updateRow(r.id, { kodeSupplier: sup?.kode ?? e.target.value, namaSupplier: sup?.nama ?? e.target.value });
            }}
            className="input w-[150px]"
          >
            <option value="">— pilih supplier —</option>
            {materialSuppliers.map((s) => (
              <option key={s.id} value={s.kode}>
                {s.nama}
              </option>
            ))}
            {/* Baris lama yang kode supplier-nya belum ada di Master Data Supplier Kain -- tetap
                muncul sebagai opsi supaya nilainya tidak diam-diam berubah kosong saat diedit. */}
            {r.kodeSupplier && !materialSuppliers.some((s) => s.kode === r.kodeSupplier) && <option value={r.kodeSupplier}>{r.namaSupplier || r.kodeSupplier} (belum di Master Data)</option>}
          </select>
        </EditableCell>
      ),
    },
    {
      key: "kategori",
      label: "Kategori",
      default: true,
      render: (r) => (
        <EditableCell editing={editingId === r.id} display={r.kategori || "—"}>
          <input value={r.kategori} onChange={(e) => updateRow(r.id, { kategori: e.target.value })} className="input w-[110px]" />
        </EditableCell>
      ),
    },
    {
      key: "warna",
      label: "Warna",
      default: true,
      render: (r) => (
        <EditableCell editing={editingId === r.id} display={r.warna || "—"}>
          <input value={r.warna} onChange={(e) => updateRow(r.id, { warna: e.target.value })} className="input w-[140px]" />
        </EditableCell>
      ),
    },
    {
      key: "hargaPerKg",
      label: "Harga per kg",
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
      title="Harga Kain / Material"
      subtitle={`Harga flat per kg — ${rows.length} baris. DIPAKAI LIVE untuk estimasi harga PO Material di PO Approval/export PDF PO -- kalah prioritas dari Harga Kain PKS kalau berat pesanan cocok salah satu tingkatan tonase di sana.`}
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
      search={{ placeholder: "Cari warna/supplier…", getText: (r) => `${r.warna} ${r.namaSupplier} ${r.kodeSupplier} ${r.kategori}` }}
      filterDefs={[
        { label: "Kode Supplier", options: Array.from(new Set(rows.map((r) => r.kodeSupplier).filter(Boolean))).sort((a, b) => a.localeCompare(b, "id-ID")), test: (r, v) => r.kodeSupplier === v },
        { label: "Kategori", options: Array.from(new Set(rows.map((r) => r.kategori).filter(Boolean))).sort((a, b) => a.localeCompare(b, "id-ID")), test: (r, v) => r.kategori === v },
        { label: "Warna", options: Array.from(new Set(rows.map((r) => r.warna).filter(Boolean))).sort((a, b) => a.localeCompare(b, "id-ID")), test: (r, v) => r.warna === v },
      ]}
      emptyText='Belum ada data — klik "+ Tambah baris".'
      bodyMaxHeight="60vh"
    />
  );
}
