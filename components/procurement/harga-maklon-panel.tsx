"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { NumberInput } from "@/components/mrp/number-input";
import { DataTable, type ColumnDef } from "@/components/mrp/data-table";
import { MasterDataFormModal, ModalField } from "@/components/mrp/master-data-form-modal";
import { formatRupiah } from "@/lib/mrp/derive";
import { useMrpStore } from "@/lib/mrp/store";
import type { HargaMaklonRow } from "@/lib/mrp/masterData";

type Draft = {
  kodeVendor: string;
  tipeLengan: string;
  jenisHarga: "Standar" | "PKS";
  kapasitasMin: string;
  kapasitasMax: string;
  harga: number;
};

const EMPTY_DRAFT: Draft = { kodeVendor: "", tipeLengan: "", jenisHarga: "Standar", kapasitasMin: "", kapasitasMax: "", harga: 0 };

/** Master Data — Harga Maklon (ongkos jahit per vendor produksi, bertingkat berdasarkan
 *  kapasitas). DIPAKAI LIVE oleh `hargaMaklonRateInfo`/`maklonRateExplanation` (lib/mrp/derive.ts)
 *  untuk estimasi harga PO Produksi di PO Approval (badge sumber Standar/PKS).
 *  Revisi 2026-09-17 (owner: "tambah/edit lewat popup form, bukan baris kosong dulu baru diisi"):
 *  "+ Tambah baris" (bikin baris kosong langsung di tabel) diganti "+ Tambah Data" (buka modal form
 *  dulu, isi semua field, baru submit) -- "Edit" juga buka modal yang sama (bukan sel jadi
 *  interaktif inline lagi), lihat MasterDataFormModal. */
export function HargaMaklonPanel() {
  const rows = useMrpStore((s) => s.hargaMaklon);
  const addRow = useMrpStore((s) => s.addHargaMaklonRow);
  const updateRow = useMrpStore((s) => s.updateHargaMaklonRow);
  const deleteRow = useMrpStore((s) => s.deleteHargaMaklonRow);
  // Owner 2026-09-16: Kode/Nama Vendor tidak lagi diketik bebas -- pakai dropdown dari master
  // vendor produksi yang SUDAH ADA (vendors_produksi, tabel yang sama dipakai login vendor & di
  // seluruh app), bukan tabel baru. Pilih 1 vendor mengisi kodeVendor (id, mis. "BAYU"/"GI-01")
  // & namaVendor (name, mis. "Bayu"/"Yogi 01") sekaligus -- kedua kolom itu TETAP dipertahankan
  // (bukan cuma id) karena hargaMaklonRowMatchesVendor (lib/mrp/derive.ts) mencocokkan ke salah
  // satu dari keduanya, dan baris data lama campur (sebagian match by kode, sebagian by nama).
  const vendorProduksiList = useMrpStore((s) => s.vendorProduksiList);

  const [mode, setMode] = useState<"add" | "edit" | null>(null);
  const [editingRow, setEditingRow] = useState<HargaMaklonRow | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function openAdd() {
    setDraft(EMPTY_DRAFT);
    setEditingRow(null);
    setError("");
    setMode("add");
  }
  function openEdit(r: HargaMaklonRow) {
    const matched = vendorProduksiList.find((v) => v.id === r.kodeVendor || v.name === r.namaVendor);
    setDraft({
      kodeVendor: matched?.id ?? r.kodeVendor,
      tipeLengan: r.tipeLengan,
      jenisHarga: r.jenisHarga,
      kapasitasMin: r.kapasitasMin != null ? String(r.kapasitasMin) : "",
      kapasitasMax: r.kapasitasMax != null ? String(r.kapasitasMax) : "",
      harga: r.harga,
    });
    setEditingRow(r);
    setError("");
    setMode("edit");
  }

  async function handleSave() {
    setError("");
    const vendor = vendorProduksiList.find((v) => v.id === draft.kodeVendor);
    if (!vendor) {
      setError("Pilih vendor produksi dulu.");
      return;
    }
    if (!draft.tipeLengan.trim()) {
      setError("Tipe lengan wajib diisi.");
      return;
    }
    const payload = {
      kodeVendor: vendor.id,
      namaVendor: vendor.name,
      tipeLengan: draft.tipeLengan.trim(),
      jenisHarga: draft.jenisHarga,
      kapasitasMin: draft.kapasitasMin === "" ? undefined : Number(draft.kapasitasMin),
      kapasitasMax: draft.kapasitasMax === "" ? undefined : Number(draft.kapasitasMax),
      harga: draft.harga,
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

  const columns: ColumnDef<HargaMaklonRow>[] = [
    { key: "vendor", label: "Vendor Produksi", default: true, render: (r) => r.namaVendor || r.kodeVendor || "—" },
    { key: "tipeLengan", label: "Tipe Lengan", default: true, render: (r) => r.tipeLengan || "—" },
    { key: "jenisHarga", label: "Jenis Harga", default: true, render: (r) => r.jenisHarga },
    { key: "kapasitasMin", label: "Kapasitas Min", default: true, align: "right", render: (r) => (r.kapasitasMin != null ? r.kapasitasMin.toLocaleString("id-ID") : "—") },
    { key: "kapasitasMax", label: "Kapasitas Max", default: false, align: "right", render: (r) => (r.kapasitasMax != null ? r.kapasitasMax.toLocaleString("id-ID") : "—") },
    { key: "harga", label: "Harga", default: true, align: "right", render: (r) => formatRupiah(r.harga) },
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
        title="Harga Maklon"
        subtitle="Ongkos jahit per vendor produksi — bertingkat berdasarkan kapasitas kumulatif (Standar/PKS). DIPAKAI LIVE untuk estimasi harga PO Produksi di PO Approval (badge sumber Standar/PKS di sana)."
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
        search={{ placeholder: "Cari nama/kode vendor…", getText: (r) => `${r.namaVendor} ${r.kodeVendor}` }}
        filterDefs={[
          { label: "Kode Vendor", options: Array.from(new Set(rows.map((r) => r.kodeVendor).filter(Boolean))).sort((a, b) => a.localeCompare(b, "id-ID")), test: (r, v) => r.kodeVendor === v },
          { label: "Tipe Lengan", options: Array.from(new Set(rows.map((r) => r.tipeLengan).filter(Boolean))).sort((a, b) => a.localeCompare(b, "id-ID")), test: (r, v) => r.tipeLengan === v },
          { label: "Jenis Harga", options: ["Standar", "PKS"], test: (r, v) => r.jenisHarga === v },
        ]}
        emptyText='Belum ada data — klik "+ Tambah Data".'
        bodyMaxHeight="60vh"
      />
      {mode && (
        <MasterDataFormModal
          title={mode === "add" ? "Tambah Harga Maklon" : "Edit Harga Maklon"}
          onCancel={() => setMode(null)}
          onSave={handleSave}
          saving={saving}
          error={error}
        >
          <ModalField label="Vendor Produksi">
            <select value={draft.kodeVendor} onChange={(e) => setDraft({ ...draft, kodeVendor: e.target.value })} className="input w-full">
              <option value="">— pilih vendor —</option>
              {vendorProduksiList.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </select>
          </ModalField>
          <ModalField label="Tipe Lengan">
            <input value={draft.tipeLengan} onChange={(e) => setDraft({ ...draft, tipeLengan: e.target.value })} placeholder="PDK / PJG / Wangky PDK" className="input w-full" />
          </ModalField>
          <ModalField label="Jenis Harga">
            <select value={draft.jenisHarga} onChange={(e) => setDraft({ ...draft, jenisHarga: e.target.value === "PKS" ? "PKS" : "Standar" })} className="input w-full">
              <option value="Standar">Standar</option>
              <option value="PKS">PKS</option>
            </select>
          </ModalField>
          <div className="grid grid-cols-2 gap-3">
            <ModalField label="Kapasitas Min">
              <input type="number" value={draft.kapasitasMin} onChange={(e) => setDraft({ ...draft, kapasitasMin: e.target.value })} placeholder="—" className="input w-full" />
            </ModalField>
            <ModalField label="Kapasitas Max">
              <input type="number" value={draft.kapasitasMax} onChange={(e) => setDraft({ ...draft, kapasitasMax: e.target.value })} placeholder="—" className="input w-full" />
            </ModalField>
          </div>
          <ModalField label="Harga">
            <NumberInput value={draft.harga} onChange={(v) => setDraft({ ...draft, harga: v })} currency className="input w-full" />
          </ModalField>
        </MasterDataFormModal>
      )}
    </>
  );
}
