"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { DataTable, type ColumnDef } from "@/components/mrp/data-table";
import { MasterDataFormModal, ModalField } from "@/components/mrp/master-data-form-modal";
import { useMrpStore } from "@/lib/mrp/store";
import type { MaterialSupplierRow, VendorProduksiMasterRow } from "@/lib/mrp/masterData";

type Draft = { nama: string };
const EMPTY_DRAFT: Draft = { nama: "" };

/** Master Data "Vendor & Supplier" (revisi 2026-09-17, owner: "hindari salah ketik nama vendor
 *  produksi/supplier material saat buat data baru di Harga Maklon/Kain/Kain PKS/RIB/Kerah-Manset
 *  -- satu tempat lihat daftarnya, di-highlight biar gampang ditemukan") -- gabungan 2 daftar:
 *  1. Vendor Produksi (`vendorProduksiList`, dari tabel `vendors_produksi` -- akun login vendor
 *     produksi yang SUDAH ADA di seluruh app). READ-ONLY di sini -- dikelola lewat akun vendor
 *     sendiri (bukan tabel yang di-CRUD dari Master Data Procurement), jadi panel ini murni
 *     referensi supaya Procurement bisa cek ejaan nama sebelum pilih di dropdown Harga Maklon.
 *  2. Supplier Material (`materialSuppliers`, migration 0042) -- BISA tambah/hapus di sini
 *     (dipindah dari tab "Supplier Kain" lama yang sekarang dihapus, lihat catatan di
 *     app/procurement/master-data/page.tsx). Dipakai sebagai dropdown supplier di Harga Kain/Kain
 *     PKS/RIB/Kerah-Manset. */
export function VendorSupplierPanel() {
  const vendorProduksiList = useMrpStore((s) => s.vendorProduksiList);
  const materialSuppliers = useMrpStore((s) => s.materialSuppliers);
  const addSupplier = useMrpStore((s) => s.addMaterialSupplier);
  const deleteSupplier = useMrpStore((s) => s.deleteMaterialSupplier);

  const [mode, setMode] = useState<"add" | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function openAdd() {
    setDraft(EMPTY_DRAFT);
    setError("");
    setMode("add");
  }

  async function handleSave() {
    setError("");
    if (!draft.nama.trim()) {
      setError("Nama supplier wajib diisi.");
      return;
    }
    setSaving(true);
    try {
      await addSupplier(draft.nama.trim());
      setMode(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  const vendorColumns: ColumnDef<VendorProduksiMasterRow>[] = [
    { key: "name", label: "Nama Vendor Produksi", default: true, render: (v) => v.name },
    { key: "kategori", label: "Kategori", default: true, render: (v) => v.kategori || "—" },
    { key: "weeklyCapacity", label: "Kapasitas/Minggu", default: true, align: "right", render: (v) => v.weeklyCapacity.toLocaleString("id-ID") },
  ];

  const supplierColumns: ColumnDef<MaterialSupplierRow>[] = [
    { key: "nama", label: "Nama Supplier", default: true, render: (r) => r.nama },
    {
      key: "aksi",
      label: "Aksi",
      default: true,
      render: (r) => (
        <Button onClick={() => deleteSupplier(r.id)} variant="danger" size="xs">
          Hapus
        </Button>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <DataTable
        title="Vendor Produksi"
        subtitle={`${vendorProduksiList.length} vendor — akun login vendor produksi yang sudah ada di app (dikelola lewat akun vendor sendiri, BUKAN dari sini). Dipakai sebagai dropdown "Vendor Produksi" di Harga Maklon supaya tidak salah ketik.`}
        columns={vendorColumns}
        rows={vendorProduksiList}
        keyOf={(v) => v.id}
        firstColumnLabel="No."
        firstColumnRender={(v) => <span className="font-mono text-[11px] text-text-muted">{vendorProduksiList.indexOf(v) + 1}</span>}
        search={{ placeholder: "Cari nama vendor…", getText: (v) => `${v.name} ${v.kategori ?? ""}` }}
        emptyText="Belum ada vendor produksi."
      />
      <DataTable
        title="Supplier Material"
        subtitle={`${materialSuppliers.length} supplier — dipakai sebagai dropdown supplier di Harga Kain, Harga Kain PKS, Harga RIB & Harga Kerah/Manset. Tambah di sini dulu sebelum bisa dipilih di tabel-tabel itu.`}
        headerActions={
          <Button onClick={openAdd} variant="dashed" size="sm">
            + Tambah Data
          </Button>
        }
        columns={supplierColumns}
        rows={materialSuppliers}
        keyOf={(r) => r.id}
        firstColumnLabel="No."
        firstColumnRender={(r) => <span className="font-mono text-[11px] text-text-muted">{materialSuppliers.indexOf(r) + 1}</span>}
        search={{ placeholder: "Cari supplier…", getText: (r) => r.nama }}
        emptyText='Belum ada supplier — klik "+ Tambah Data".'
      />
      {mode && (
        <MasterDataFormModal title="Tambah Supplier Material" onCancel={() => setMode(null)} onSave={handleSave} saving={saving} error={error}>
          <ModalField label="Nama Supplier">
            <input value={draft.nama} onChange={(e) => setDraft({ ...draft, nama: e.target.value })} className="input w-full" />
          </ModalField>
        </MasterDataFormModal>
      )}
    </div>
  );
}
