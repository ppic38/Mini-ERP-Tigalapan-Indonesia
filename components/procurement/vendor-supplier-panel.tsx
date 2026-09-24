"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { NumberInput } from "@/components/mrp/number-input";
import { DataTable, type ColumnDef } from "@/components/mrp/data-table";
import { MasterDataFormModal, ModalField } from "@/components/mrp/master-data-form-modal";
import { Tabs } from "@/components/ui/tabs";
import { KeepAliveTab } from "@/components/ui/keep-alive-tab";
import { useMrpStore } from "@/lib/mrp/store";
import type { MaterialSupplierRow, VendorProduksiMasterRow } from "@/lib/mrp/masterData";

type SupplierDraft = { nama: string };
const EMPTY_SUPPLIER_DRAFT: SupplierDraft = { nama: "" };

type VendorDraft = { name: string; kategori: string; weeklyCapacity: number };

type SubTab = "vendorProduksi" | "supplierMaterial";

/** Master Data "Vendor & Supplier" (revisi 2026-09-17, owner: "hindari salah ketik nama vendor
 *  produksi/supplier material saat buat data baru di Harga Maklon/Kain/Kain PKS/RIB/Kerah-Manset
 *  -- satu tempat lihat daftarnya, di-highlight biar gampang ditemukan") -- gabungan 2 daftar:
 *  1. Vendor Produksi (`vendorProduksiList`, dari tabel `vendors_produksi` -- akun login vendor
 *     produksi yang SUDAH ADA di seluruh app). Dipakai sebagai dropdown "Vendor Produksi" di
 *     Harga Maklon supaya tidak salah ketik.
 *  2. Supplier Material (`materialSuppliers`, migration 0042) -- BISA tambah/hapus di sini
 *     (dipindah dari tab "Supplier Kain" lama yang sekarang dihapus, lihat catatan di
 *     app/procurement/master-data/page.tsx). Dipakai sebagai dropdown supplier di Harga Kain/Kain
 *     PKS/RIB/Kerah-Manset.
 *  Revisi 2026-09-24 (owner: "jadikan saja juga ini jadi satu tabel... buat jadi sub tab dan ada
 *  juga action edit atau hapus untuk yang di master data vendor produksi") -- 2 tabel di atas TADINYA
 *  ditumpuk vertikal di 1 halaman, sekarang jadi 2 SUB-TAB (Tabs, sama komponen dengan tab utama
 *  Master Data). Vendor Produksi TADINYA read-only (dikelola lewat akun vendor sendiri) -- sekarang
 *  bisa Edit (name/kategori/weeklyCapacity SAJA, lihat updateVendorProduksiMasterAction) & Hapus
 *  (ditolak otomatis oleh FK constraint kalau vendor masih punya data terkait) langsung dari sini.
 *  Password/kredensial login vendor TETAP TIDAK BISA diubah dari panel ini. */
export function VendorSupplierPanel() {
  const vendorProduksiList = useMrpStore((s) => s.vendorProduksiList);
  const materialSuppliers = useMrpStore((s) => s.materialSuppliers);
  const addSupplier = useMrpStore((s) => s.addMaterialSupplier);
  const deleteSupplier = useMrpStore((s) => s.deleteMaterialSupplier);
  const updateVendorProduksi = useMrpStore((s) => s.updateVendorProduksiMaster);
  const deleteVendorProduksi = useMrpStore((s) => s.deleteVendorProduksiMaster);

  const [subTab, setSubTab] = useState<SubTab>("vendorProduksi");

  const [supplierMode, setSupplierMode] = useState<"add" | null>(null);
  const [supplierDraft, setSupplierDraft] = useState<SupplierDraft>(EMPTY_SUPPLIER_DRAFT);
  const [supplierSaving, setSupplierSaving] = useState(false);
  const [supplierError, setSupplierError] = useState("");

  function openAddSupplier() {
    setSupplierDraft(EMPTY_SUPPLIER_DRAFT);
    setSupplierError("");
    setSupplierMode("add");
  }

  async function handleSaveSupplier() {
    setSupplierError("");
    if (!supplierDraft.nama.trim()) {
      setSupplierError("Nama supplier wajib diisi.");
      return;
    }
    setSupplierSaving(true);
    try {
      await addSupplier(supplierDraft.nama.trim());
      setSupplierMode(null);
    } catch (err) {
      setSupplierError(err instanceof Error ? err.message : String(err));
    } finally {
      setSupplierSaving(false);
    }
  }

  const [editingVendor, setEditingVendor] = useState<VendorProduksiMasterRow | null>(null);
  const [vendorDraft, setVendorDraft] = useState<VendorDraft>({ name: "", kategori: "", weeklyCapacity: 0 });
  const [vendorSaving, setVendorSaving] = useState(false);
  const [vendorError, setVendorError] = useState("");

  function openEditVendor(v: VendorProduksiMasterRow) {
    setVendorDraft({ name: v.name, kategori: v.kategori ?? "", weeklyCapacity: v.weeklyCapacity });
    setEditingVendor(v);
    setVendorError("");
  }

  async function handleSaveVendor() {
    if (!editingVendor) return;
    setVendorError("");
    if (!vendorDraft.name.trim()) {
      setVendorError("Nama vendor produksi wajib diisi.");
      return;
    }
    setVendorSaving(true);
    try {
      await updateVendorProduksi(editingVendor.id, { name: vendorDraft.name.trim(), kategori: vendorDraft.kategori.trim(), weeklyCapacity: vendorDraft.weeklyCapacity });
      setEditingVendor(null);
    } catch (err) {
      setVendorError(err instanceof Error ? err.message : String(err));
    } finally {
      setVendorSaving(false);
    }
  }

  const vendorColumns: ColumnDef<VendorProduksiMasterRow>[] = [
    { key: "name", label: "Nama Vendor Produksi", default: true, render: (v) => v.name },
    { key: "kategori", label: "Kategori", default: true, render: (v) => v.kategori || "—" },
    { key: "weeklyCapacity", label: "Kapasitas/Minggu", default: true, align: "right", render: (v) => v.weeklyCapacity.toLocaleString("id-ID") },
    {
      key: "aksi",
      label: "Aksi",
      default: true,
      render: (v) => (
        <div className="flex items-center gap-1.5">
          <Button onClick={() => openEditVendor(v)} variant="ghost" size="xs">
            Edit
          </Button>
          <Button onClick={() => deleteVendorProduksi(v.id)} variant="danger" size="xs">
            Hapus
          </Button>
        </div>
      ),
    },
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
    <div className="flex flex-col gap-3">
      <Tabs
        items={[
          { key: "vendorProduksi", label: "Vendor Produksi" },
          { key: "supplierMaterial", label: "Supplier Material" },
        ]}
        active={subTab}
        onChange={(k) => setSubTab(k as SubTab)}
      />
      <KeepAliveTab active={subTab === "vendorProduksi"}>
        <DataTable
          title="Vendor Produksi"
          subtitle={`${vendorProduksiList.length} vendor — akun login vendor produksi yang sudah ada di app. Dipakai sebagai dropdown "Vendor Produksi" di Harga Maklon supaya tidak salah ketik. Edit/Hapus di sini TIDAK mengubah password login vendor.`}
          columns={vendorColumns}
          rows={vendorProduksiList}
          keyOf={(v) => v.id}
          firstColumnLabel="No."
          firstColumnRender={(v) => <span className="font-mono text-[11px] text-text-muted">{vendorProduksiList.indexOf(v) + 1}</span>}
          search={{ placeholder: "Cari nama vendor…", getText: (v) => `${v.name} ${v.kategori ?? ""}` }}
          emptyText="Belum ada vendor produksi."
        />
      </KeepAliveTab>
      <KeepAliveTab active={subTab === "supplierMaterial"}>
        <DataTable
          title="Supplier Material"
          subtitle={`${materialSuppliers.length} supplier — dipakai sebagai dropdown supplier di Harga Kain, Harga Kain PKS, Harga RIB & Harga Kerah/Manset. Tambah di sini dulu sebelum bisa dipilih di tabel-tabel itu.`}
          headerActions={
            <Button onClick={openAddSupplier} variant="dashed" size="sm">
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
      </KeepAliveTab>
      {supplierMode && (
        <MasterDataFormModal title="Tambah Supplier Material" onCancel={() => setSupplierMode(null)} onSave={handleSaveSupplier} saving={supplierSaving} error={supplierError}>
          <ModalField label="Nama Supplier">
            <input value={supplierDraft.nama} onChange={(e) => setSupplierDraft({ ...supplierDraft, nama: e.target.value })} className="input w-full" />
          </ModalField>
        </MasterDataFormModal>
      )}
      {editingVendor && (
        <MasterDataFormModal title="Edit Vendor Produksi" onCancel={() => setEditingVendor(null)} onSave={handleSaveVendor} saving={vendorSaving} error={vendorError}>
          <ModalField label="Nama Vendor Produksi">
            <input value={vendorDraft.name} onChange={(e) => setVendorDraft({ ...vendorDraft, name: e.target.value })} className="input w-full" />
          </ModalField>
          <ModalField label="Kategori">
            <input value={vendorDraft.kategori} onChange={(e) => setVendorDraft({ ...vendorDraft, kategori: e.target.value })} className="input w-full" placeholder="mis. WANGKI MYNO" />
          </ModalField>
          <ModalField label="Kapasitas/Minggu">
            <NumberInput value={vendorDraft.weeklyCapacity} onChange={(v) => setVendorDraft({ ...vendorDraft, weeklyCapacity: v })} className="input w-full" />
          </ModalField>
        </MasterDataFormModal>
      )}
    </div>
  );
}
