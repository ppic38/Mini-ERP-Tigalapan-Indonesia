"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { NumberInput } from "@/components/mrp/number-input";
import { DataTable, type ColumnDef } from "@/components/mrp/data-table";
import { MasterDataFormModal, ModalField } from "@/components/mrp/master-data-form-modal";
import { formatRupiah } from "@/lib/mrp/derive";
import { useMrpStore } from "@/lib/mrp/store";
import type { EkspedisiRateRow } from "@/lib/mrp/masterData";

type Draft = { nama: string; pricePerKg: number };
const EMPTY_DRAFT: Draft = { nama: "", pricePerKg: 0 };

/** Master Data — Ekspedisi (tarif ongkir FLAT per kg). BEDA dari Harga Maklon/Harga Kain/Harga
 *  Kain PKS (masih murni data referensi, lihat catatan di lib/mrp/masterData.ts): tabel ini
 *  DIPAKAI LIVE oleh ekspedisiPrice/koliOngkirShare (lib/mrp/derive.ts) untuk menghitung ongkir
 *  yang tampil di halaman Pengiriman, Invoice Vendor, Payment Maklon, Laporan HPP, dan Penerimaan
 *  Warehouse — mengubah harga di sini LANGSUNG mengubah angka ongkir di semua tempat itu. Tidak
 *  ada import Google Sheets untuk tabel ini (beda dari panel Master Data lain).
 *  Revisi 2026-09-17: "Nama Ekspedisi" di sini adalah nama KURIR (JNE/JNT/dst), BUKAN vendor
 *  produksi atau supplier material -- SENGAJA TETAP diketik bebas (bukan dropdown Master Data
 *  Vendor & Supplier, yang isinya daftar vendor produksi/supplier kain, beda kategori data sama
 *  sekali). "+ Tambah baris"/"Edit" inline tetap diganti popup form untuk konsistensi. */
export function EkspedisiRatePanel() {
  const rows = useMrpStore((s) => s.ekspedisiRates);
  const addRow = useMrpStore((s) => s.addEkspedisiRateRow);
  const updateRow = useMrpStore((s) => s.updateEkspedisiRateRow);
  const deleteRow = useMrpStore((s) => s.deleteEkspedisiRateRow);

  const [mode, setMode] = useState<"add" | "edit" | null>(null);
  const [editingRow, setEditingRow] = useState<EkspedisiRateRow | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function openAdd() {
    setDraft(EMPTY_DRAFT);
    setEditingRow(null);
    setError("");
    setMode("add");
  }
  function openEdit(r: EkspedisiRateRow) {
    setDraft({ nama: r.nama, pricePerKg: r.pricePerKg });
    setEditingRow(r);
    setError("");
    setMode("edit");
  }

  async function handleSave() {
    setError("");
    if (!draft.nama.trim()) {
      setError("Nama ekspedisi wajib diisi.");
      return;
    }
    const payload = { nama: draft.nama.trim(), pricePerKg: draft.pricePerKg };
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

  const columns: ColumnDef<EkspedisiRateRow>[] = [
    { key: "nama", label: "Nama Ekspedisi", default: true, render: (r) => r.nama || "—" },
    { key: "pricePerKg", label: "Harga/kg", default: true, align: "right", render: (r) => formatRupiah(r.pricePerKg) },
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
        title="Ekspedisi"
        subtitle="Tarif ongkir FLAT per kg (harga/kg x total berat kg 1 resi pengiriman) — tabel ini DIPAKAI LANGSUNG untuk menghitung ongkir koli/HPP di seluruh app."
        headerActions={
          <Button onClick={openAdd} variant="dashed" size="sm">
            + Tambah Data
          </Button>
        }
        columns={columns}
        rows={rows}
        keyOf={(r) => r.id}
        search={{ placeholder: "Cari nama ekspedisi…", getText: (r) => r.nama }}
        firstColumnLabel="No."
        firstColumnRender={(r) => <span className="font-mono text-[11px] text-text-muted">{rows.indexOf(r) + 1}</span>}
        emptyText='Belum ada data — klik "+ Tambah Data".'
        bodyMaxHeight="60vh"
      />
      {mode && (
        <MasterDataFormModal title={mode === "add" ? "Tambah Ekspedisi" : "Edit Ekspedisi"} onCancel={() => setMode(null)} onSave={handleSave} saving={saving} error={error}>
          <ModalField label="Nama Ekspedisi">
            <input value={draft.nama} onChange={(e) => setDraft({ ...draft, nama: e.target.value })} className="input w-full" placeholder="JNE / JNT / dst" />
          </ModalField>
          <ModalField label="Harga/kg">
            <NumberInput value={draft.pricePerKg} onChange={(v) => setDraft({ ...draft, pricePerKg: v })} currency className="input w-full" />
          </ModalField>
        </MasterDataFormModal>
      )}
    </>
  );
}
