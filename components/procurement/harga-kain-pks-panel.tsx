"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { NumberInput } from "@/components/mrp/number-input";
import { DataTable, type ColumnDef } from "@/components/mrp/data-table";
import { MasterImportModal, normKey, upsertRows, type ImportValues } from "@/components/mrp/master-import-modal";
import { MasterDataFormModal, ModalField } from "@/components/mrp/master-data-form-modal";
import { formatRupiah, formatDateTime } from "@/lib/mrp/derive";
import { useMrpStore } from "@/lib/mrp/store";
import type { HargaKainPksRow } from "@/lib/mrp/masterData";

type Draft = { kodeSupplier: string; kategori: string; warna: string; satuan: string; tonaseMin: string; tonaseMax: string; hargaPerKg: number };
const EMPTY_DRAFT: Draft = { kodeSupplier: "", kategori: "", warna: "", satuan: "TON", tonaseMin: "", tonaseMax: "", hargaPerKg: 0 };

/** Master Data — Harga Kain PKS: sama seperti Harga Kain tapi bertingkat berdasarkan tonase
 *  (per SATUAN, biasanya "TON"). Aturan bisnis dari user: kalau order tidak mencapai tonaseMin
 *  manapun, pakai harga flat di tab Harga Kain -- DIIMPLEMENTASIKAN di `hargaKainRateInfo`
 *  (lib/mrp/derive.ts): tingkatan tonase di sini dicek LEBIH DULU (match tonaseMin/tonaseMax
 *  terhadap berat pesanan), baru fallback ke Harga Kain flat kalau tidak ada yang cocok --
 *  dipakai LIVE oleh PO Approval, Finance PO Material, export PDF PO, dan modal PV Pengganti.
 *  Revisi 2026-09-17: "+ Tambah baris"/"Edit" inline diganti popup form, sama pola dengan
 *  HargaKainPanel (lihat MasterDataFormModal). */
export function HargaKainPksPanel() {
  const rows = useMrpStore((s) => s.hargaKainPks);
  const addRow = useMrpStore((s) => s.addHargaKainPksRow);
  const updateRow = useMrpStore((s) => s.updateHargaKainPksRow);
  const deleteRow = useMrpStore((s) => s.deleteHargaKainPksRow);
  // Migration 0042 -- daftar pilihan dropdown, sama seperti HargaKainPanel (lihat catatan lebih
  // lengkap di file itu). SATU daftar dipakai bersama Harga Kain & Harga Kain PKS.
  const materialSuppliers = useMrpStore((s) => s.materialSuppliers);

  const [mode, setMode] = useState<"add" | "edit" | null>(null);
  const [editingRow, setEditingRow] = useState<HargaKainPksRow | null>(null);
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
  function openEdit(r: HargaKainPksRow) {
    setDraft({
      kodeSupplier: r.kodeSupplier,
      kategori: r.kategori,
      warna: r.warna,
      satuan: r.satuan,
      tonaseMin: r.tonaseMin != null ? String(r.tonaseMin) : "",
      tonaseMax: r.tonaseMax != null ? String(r.tonaseMax) : "",
      hargaPerKg: r.hargaPerKg,
    });
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
    // kodeSupplier di harga_kain_pks TETAP kolom teks lama (bukan foreign key) -- diisi SAMA
    // dengan nama supplier (kode tidak ada lagi konsepnya sejak migration 0043).
    const payload = {
      kodeSupplier: supplier.nama,
      kategori: draft.kategori.trim(),
      warna: draft.warna.trim(),
      satuan: draft.satuan,
      tonaseMin: draft.tonaseMin === "" ? undefined : Number(draft.tonaseMin),
      tonaseMax: draft.tonaseMax === "" ? undefined : Number(draft.tonaseMax),
      hargaPerKg: draft.hargaPerKg,
    };
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

  const columns: ColumnDef<HargaKainPksRow>[] = [
    {
      key: "kodeSupplier",
      label: "Supplier",
      default: true,
      render: (r) => materialSuppliers.find((s) => s.nama === r.kodeSupplier)?.nama ?? r.kodeSupplier ?? "—",
    },
    { key: "kategori", label: "Kategori", default: true, render: (r) => r.kategori || "—" },
    { key: "warna", label: "Warna", default: true, render: (r) => r.warna || "—" },
    { key: "satuan", label: "Satuan", default: true, render: (r) => r.satuan },
    { key: "tonaseMin", label: "Tonase Min", default: true, align: "right", render: (r) => (r.tonaseMin != null ? r.tonaseMin.toLocaleString("id-ID") : "—") },
    { key: "tonaseMax", label: "Tonase Max", default: true, align: "right", render: (r) => (r.tonaseMax != null ? r.tonaseMax.toLocaleString("id-ID") : "—") },
    { key: "hargaPerKg", label: "Harga per kg", default: true, align: "right", render: (r) => formatRupiah(r.hargaPerKg) },
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
        title="Harga Kain PKS (bertingkat per tonase)"
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
        search={{ placeholder: "Cari warna/supplier…", getText: (r) => `${r.warna} ${r.kodeSupplier} ${r.kategori}` }}
        filterDefs={[
          { label: "Supplier", options: Array.from(new Set(rows.map((r) => r.kodeSupplier).filter(Boolean))).sort((a, b) => a.localeCompare(b, "id-ID")), test: (r, v) => r.kodeSupplier === v },
          { label: "Kategori", options: Array.from(new Set(rows.map((r) => r.kategori).filter(Boolean))).sort((a, b) => a.localeCompare(b, "id-ID")), test: (r, v) => r.kategori === v },
          { label: "Warna", options: Array.from(new Set(rows.map((r) => r.warna).filter(Boolean))).sort((a, b) => a.localeCompare(b, "id-ID")), test: (r, v) => r.warna === v },
        ]}
        emptyText='Belum ada data — klik "+ Tambah Data".'
        bodyMaxHeight="60vh"
      />
      {mode && (
        <MasterDataFormModal title={mode === "add" ? "Tambah Harga Kain PKS" : "Edit Harga Kain PKS"} onCancel={() => setMode(null)} onSave={handleSave} saving={saving} error={error}>
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
          <ModalField label="Kategori">
            <input value={draft.kategori} onChange={(e) => setDraft({ ...draft, kategori: e.target.value })} className="input w-full" />
          </ModalField>
          <ModalField label="Warna">
            <input value={draft.warna} onChange={(e) => setDraft({ ...draft, warna: e.target.value })} className="input w-full" />
          </ModalField>
          <ModalField label="Satuan">
            <select value={draft.satuan} onChange={(e) => setDraft({ ...draft, satuan: e.target.value })} className="input w-full">
              <option value="TON">TON</option>
              <option value="KG">KG</option>
            </select>
          </ModalField>
          <div className="grid grid-cols-2 gap-3">
            <ModalField label="Tonase Min">
              <input type="number" value={draft.tonaseMin} onChange={(e) => setDraft({ ...draft, tonaseMin: e.target.value })} placeholder="—" className="input w-full" />
            </ModalField>
            <ModalField label="Tonase Max">
              <input type="number" value={draft.tonaseMax} onChange={(e) => setDraft({ ...draft, tonaseMax: e.target.value })} placeholder="—" className="input w-full" />
            </ModalField>
          </div>
          <ModalField label="Harga per kg">
            <NumberInput value={draft.hargaPerKg} onChange={(v) => setDraft({ ...draft, hargaPerKg: v })} currency className="input w-full" />
          </ModalField>
        </MasterDataFormModal>
      )}
      {importOpen && (
        <MasterImportModal
          title="Harga Kain PKS"
          templateName="Template-Import-Harga-Kain-PKS.xlsx"
          matchNote="Baris dengan Supplier + Kategori + Warna + Tonase Min yang SAMA dengan data yang sudah ada akan diperbarui, bukan digandakan."
          columns={[
            { key: "supplier", label: "Supplier", aliases: ["Kode Supplier", "Nama Supplier"], required: true, example: materialSuppliers[0]?.nama ?? "KNITTO" },
            { key: "kategori", label: "Kategori", example: "COMBED 24S" },
            { key: "warna", label: "Warna", required: true, example: "BENHUR 24S" },
            { key: "satuan", label: "Satuan", example: "TON" },
            { key: "tonaseMin", label: "Tonase Min", number: true, example: 1 },
            { key: "tonaseMax", label: "Tonase Max", number: true, example: 5 },
            { key: "hargaPerKg", label: "Harga Per Kg", aliases: ["Harga/Kg", "Harga"], required: true, number: true, example: 65000 },
          ]}
          validate={(v) => (materialSuppliers.some((s) => s.nama.toLowerCase() === String(v.supplier).trim().toLowerCase()) ? [] : ["Supplier tidak ada di Master Data Supplier Material"])}
          save={(vals) => {
            const supplierOf = (v: ImportValues) => materialSuppliers.find((s) => s.nama.toLowerCase() === String(v.supplier).trim().toLowerCase())!.nama;
            const keyOf = (v: ImportValues) => normKey(supplierOf(v), v.kategori, v.warna, v.tonaseMin);
            const payload = (v: ImportValues) => ({
              kodeSupplier: supplierOf(v),
              kategori: String(v.kategori).trim(),
              warna: String(v.warna).trim(),
              satuan: String(v.satuan).trim() || "TON",
              tonaseMin: v.tonaseMin === "" ? undefined : Number(v.tonaseMin),
              tonaseMax: v.tonaseMax === "" ? undefined : Number(v.tonaseMax),
              hargaPerKg: Number(v.hargaPerKg),
            });
            const existing = new Map(rows.map((r) => [normKey(r.kodeSupplier, r.kategori, r.warna, r.tonaseMin), r.id]));
            return upsertRows(vals, keyOf, existing, (v) => addRow(payload(v)), (id, v) => updateRow(id, payload(v)));
          }}
          onClose={() => setImportOpen(false)}
        />
      )}
    </>
  );
}
