"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { NumberInput } from "@/components/mrp/number-input";
import { DataTable, type ColumnDef } from "@/components/mrp/data-table";
import { MasterDataFormModal, ModalField } from "@/components/mrp/master-data-form-modal";
import { formatRupiah, MATERIAL_KATEGORI_URUTAN } from "@/lib/mrp/derive";
import { useMrpStore } from "@/lib/mrp/store";
import type { HargaKainRow } from "@/lib/mrp/masterData";

type Draft = { namaSupplier: string; kategori: string; warna: string; hargaPerKg: number };
const EMPTY_DRAFT: Draft = { namaSupplier: "", kategori: "", warna: "", hargaPerKg: 0 };

/** Master Data — Harga Kain/Material flat per kg, per supplier + kategori + warna. Bisa 468+
 *  baris (dari sheet asli) — pakai filterDefs DataTable untuk menyaring. DIPAKAI LIVE oleh
 *  `hargaKainRateInfo` (lib/mrp/derive.ts) untuk estimasi harga PO Material di PO Approval,
 *  Finance PO Material, export PDF PO, dan modal PV Pengganti -- fallback "Standar" kalau tidak
 *  ada tingkatan tonase Harga Kain PKS yang cocok untuk warna/supplier/berat pesanan itu.
 *  Revisi 2026-09-17: "+ Tambah baris"/"Edit" inline diganti popup form, sama pola dengan
 *  HargaMaklonPanel (lihat MasterDataFormModal). */
export function HargaKainPanel() {
  const rows = useMrpStore((s) => s.hargaKain);
  const addRow = useMrpStore((s) => s.addHargaKainRow);
  const updateRow = useMrpStore((s) => s.updateHargaKainRow);
  const deleteRow = useMrpStore((s) => s.deleteHargaKainRow);
  // Migration 0042 (owner 2026-09-16: "supaya tidak ada typo penulisan") -- daftar pilihan
  // dropdown, BUKAN foreign key. Pilih supplier di sini mengisi kodeSupplier+namaSupplier
  // sekaligus dari Master Data "Vendor & Supplier"; baris lama yang sudah ada TETAP tampil apa
  // adanya walau nama supplier-nya kebetulan belum/tidak ada di daftar itu.
  const materialSuppliers = useMrpStore((s) => s.materialSuppliers);

  const [mode, setMode] = useState<"add" | "edit" | null>(null);
  const [editingRow, setEditingRow] = useState<HargaKainRow | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function openAdd() {
    setDraft(EMPTY_DRAFT);
    setEditingRow(null);
    setError("");
    setMode("add");
  }
  function openEdit(r: HargaKainRow) {
    setDraft({ namaSupplier: r.namaSupplier, kategori: r.kategori, warna: r.warna, hargaPerKg: r.hargaPerKg });
    setEditingRow(r);
    setError("");
    setMode("edit");
  }

  async function handleSave() {
    setError("");
    const supplier = materialSuppliers.find((s) => s.nama === draft.namaSupplier);
    if (!supplier) {
      setError("Pilih supplier dulu.");
      return;
    }
    if (!draft.kategori) {
      setError("Pilih kategori dulu.");
      return;
    }
    if (!draft.warna.trim()) {
      setError("Warna wajib diisi.");
      return;
    }
    // kodeSupplier di harga_kain TETAP kolom teks lama (bukan foreign key, lihat masterData.ts) --
    // diisi SAMA dengan nama supplier (kode tidak ada lagi konsepnya di Master Data Vendor &
    // Supplier sejak migration 0043).
    const payload = { kodeSupplier: supplier.nama, namaSupplier: supplier.nama, kategori: draft.kategori.trim(), warna: draft.warna.trim(), hargaPerKg: draft.hargaPerKg };
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

  const columns: ColumnDef<HargaKainRow>[] = [
    { key: "supplier", label: "Supplier", default: true, render: (r) => r.namaSupplier || r.kodeSupplier || "—" },
    { key: "kategori", label: "Kategori", default: true, render: (r) => r.kategori || "—" },
    { key: "warna", label: "Warna", default: true, render: (r) => r.warna || "—" },
    { key: "hargaPerKg", label: "Harga per kg", default: true, align: "right", render: (r) => formatRupiah(r.hargaPerKg) },
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
        title="Harga Kain / Material"
        subtitle={`Harga flat per kg — ${rows.length} baris. DIPAKAI LIVE untuk estimasi harga PO Material di PO Approval/export PDF PO -- kalah prioritas dari Harga Kain PKS kalau berat pesanan cocok salah satu tingkatan tonase di sana.`}
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
        search={{ placeholder: "Cari warna/supplier…", getText: (r) => `${r.warna} ${r.namaSupplier} ${r.kodeSupplier} ${r.kategori}` }}
        filterDefs={[
          { label: "Supplier", options: Array.from(new Set(rows.map((r) => r.namaSupplier).filter(Boolean))).sort((a, b) => a.localeCompare(b, "id-ID")), test: (r, v) => r.namaSupplier === v },
          { label: "Kategori", options: Array.from(new Set(rows.map((r) => r.kategori).filter(Boolean))).sort((a, b) => a.localeCompare(b, "id-ID")), test: (r, v) => r.kategori === v },
          { label: "Warna", options: Array.from(new Set(rows.map((r) => r.warna).filter(Boolean))).sort((a, b) => a.localeCompare(b, "id-ID")), test: (r, v) => r.warna === v },
        ]}
        emptyText='Belum ada data — klik "+ Tambah Data".'
        bodyMaxHeight="60vh"
      />
      {mode && (
        <MasterDataFormModal title={mode === "add" ? "Tambah Harga Kain" : "Edit Harga Kain"} onCancel={() => setMode(null)} onSave={handleSave} saving={saving} error={error}>
          <ModalField label="Supplier">
            <select value={draft.namaSupplier} onChange={(e) => setDraft({ ...draft, namaSupplier: e.target.value })} className="input w-full">
              <option value="">— pilih supplier —</option>
              {materialSuppliers.map((s) => (
                <option key={s.id} value={s.nama}>
                  {s.nama}
                </option>
              ))}
            </select>
          </ModalField>
          <ModalField label="Kategori">
            <select value={draft.kategori} onChange={(e) => setDraft({ ...draft, kategori: e.target.value })} className="input w-full">
              <option value="">— pilih kategori —</option>
              {MATERIAL_KATEGORI_URUTAN.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
          </ModalField>
          <ModalField label="Warna">
            <input value={draft.warna} onChange={(e) => setDraft({ ...draft, warna: e.target.value })} className="input w-full" />
          </ModalField>
          <ModalField label="Harga per kg">
            <NumberInput value={draft.hargaPerKg} onChange={(v) => setDraft({ ...draft, hargaPerKg: v })} currency className="input w-full" />
          </ModalField>
        </MasterDataFormModal>
      )}
    </>
  );
}
