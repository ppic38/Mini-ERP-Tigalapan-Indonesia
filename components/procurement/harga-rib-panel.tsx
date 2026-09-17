"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { NumberInput } from "@/components/mrp/number-input";
import { DataTable, type ColumnDef } from "@/components/mrp/data-table";
import { MasterDataFormModal, ModalField } from "@/components/mrp/master-data-form-modal";
import { formatRupiah } from "@/lib/mrp/derive";
import { useMrpStore } from "@/lib/mrp/store";
import type { HargaRibRow } from "@/lib/mrp/masterData";

type Draft = { kodeSupplier: string; warna: string; hargaPerKg: number };
const EMPTY_DRAFT: Draft = { kodeSupplier: "", warna: "", hargaPerKg: 0 };

/** Master Data — Harga RIB per kg, per supplier + warna (migration 0037). Pola sama seperti
 *  HargaKainPanel (tanpa kolom kategori). DIPAKAI LIVE oleh `hargaRibRateInfo` (lib/mrp/derive.ts)
 *  untuk kolom "Est. Rib (Rp)" di PO Approval -- supplier yang belum punya baris sendiri di sini
 *  otomatis memakai harga KNITTO untuk warna yang sama.
 *  Revisi 2026-09-17 (owner: "hindari typo nama supplier, pakai dropdown dari Master Data Vendor &
 *  Supplier"): Kode/Nama Supplier dulu diketik bebas -- sekarang dropdown dari `materialSuppliers`
 *  (SATU daftar yang sama dipakai Harga Kain/Kain PKS), sama pola dengan HargaKainPanel. "+ Tambah
 *  baris"/"Edit" inline juga diganti popup form (lihat MasterDataFormModal). */
export function HargaRibPanel() {
  const rows = useMrpStore((s) => s.hargaRib);
  const addRow = useMrpStore((s) => s.addHargaRibRow);
  const updateRow = useMrpStore((s) => s.updateHargaRibRow);
  const deleteRow = useMrpStore((s) => s.deleteHargaRibRow);
  const materialSuppliers = useMrpStore((s) => s.materialSuppliers);

  const [mode, setMode] = useState<"add" | "edit" | null>(null);
  const [editingRow, setEditingRow] = useState<HargaRibRow | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function openAdd() {
    setDraft(EMPTY_DRAFT);
    setEditingRow(null);
    setError("");
    setMode("add");
  }
  function openEdit(r: HargaRibRow) {
    setDraft({ kodeSupplier: r.kodeSupplier, warna: r.warna, hargaPerKg: r.hargaPerKg });
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
    if (!draft.warna.trim()) {
      setError("Warna wajib diisi.");
      return;
    }
    // kodeSupplier di harga_rib TETAP kolom teks lama -- diisi SAMA dengan nama supplier (kode
    // tidak ada lagi konsepnya sejak migration 0043).
    const payload = { kodeSupplier: supplier.nama, namaSupplier: supplier.nama, warna: draft.warna.trim(), hargaPerKg: draft.hargaPerKg };
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

  const columns: ColumnDef<HargaRibRow>[] = [
    { key: "namaSupplier", label: "Supplier", default: true, render: (r) => r.namaSupplier || r.kodeSupplier || "—" },
    { key: "warna", label: "Warna", default: true, render: (r) => r.warna || "—" },
    { key: "hargaPerKg", label: "Harga RIB per kg", default: true, align: "right", render: (r) => formatRupiah(r.hargaPerKg) },
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
        title="Harga RIB"
        subtitle={`Harga RIB per kg — ${rows.length} baris. DIPAKAI LIVE untuk estimasi Rp RIB di PO Approval (Rib kg x harga/kg). Supplier yang belum punya baris sendiri memakai harga KNITTO untuk warna yang sama.`}
        headerActions={
          <Button onClick={openAdd} variant="dashed" size="sm">
            + Tambah Data
          </Button>
        }
        columns={columns}
        rows={rows}
        keyOf={(r) => r.id}
        firstColumnLabel="No."
        firstColumnRender={(r) => <span className="font-mono text-[11px] text-text-muted">{rows.indexOf(r) + 1}</span>}
        search={{ placeholder: "Cari warna/supplier…", getText: (r) => `${r.warna} ${r.namaSupplier} ${r.kodeSupplier}` }}
        filterDefs={[
          { label: "Supplier", options: Array.from(new Set(rows.map((r) => r.kodeSupplier).filter(Boolean))).sort((a, b) => a.localeCompare(b, "id-ID")), test: (r, v) => r.kodeSupplier === v },
          { label: "Warna", options: Array.from(new Set(rows.map((r) => r.warna).filter(Boolean))).sort((a, b) => a.localeCompare(b, "id-ID")), test: (r, v) => r.warna === v },
        ]}
        emptyText='Belum ada data — klik "+ Tambah Data".'
        bodyMaxHeight="60vh"
      />
      {mode && (
        <MasterDataFormModal title={mode === "add" ? "Tambah Harga RIB" : "Edit Harga RIB"} onCancel={() => setMode(null)} onSave={handleSave} saving={saving} error={error}>
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
          <ModalField label="Warna">
            <input value={draft.warna} onChange={(e) => setDraft({ ...draft, warna: e.target.value })} className="input w-full" />
          </ModalField>
          <ModalField label="Harga RIB per kg">
            <NumberInput value={draft.hargaPerKg} onChange={(v) => setDraft({ ...draft, hargaPerKg: v })} currency className="input w-full" />
          </ModalField>
        </MasterDataFormModal>
      )}
    </>
  );
}
