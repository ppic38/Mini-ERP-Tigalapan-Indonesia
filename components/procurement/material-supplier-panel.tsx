"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { DataTable, type ColumnDef } from "@/components/mrp/data-table";
import { useMrpStore } from "@/lib/mrp/store";
import type { MaterialSupplierRow } from "@/lib/mrp/masterData";

/** Master Data "Supplier Kain" (migration 0042) -- daftar SATU-SATUNYA sumber dropdown supplier
 *  dipakai bareng Harga Kain & Harga Kain PKS (owner 2026-09-16: "supaya tidak ada typo
 *  penulisan"). Sengaja cuma tambah/hapus (tidak ada edit) -- kalau nama salah ketik, hapus lalu
 *  tambah baris baru; baris Harga Kain/Kain PKS lama TIDAK ikut berubah otomatis (kode_supplier/
 *  nama_supplier di sana tetap string bebas, bukan foreign key ke tabel ini). */
export function MaterialSupplierPanel() {
  const rows = useMrpStore((s) => s.materialSuppliers);
  const addSupplier = useMrpStore((s) => s.addMaterialSupplier);
  const deleteSupplier = useMrpStore((s) => s.deleteMaterialSupplier);
  const [kodeDraft, setKodeDraft] = useState("");
  const [namaDraft, setNamaDraft] = useState("");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState("");

  async function handleAdd() {
    setError("");
    if (!kodeDraft.trim() || !namaDraft.trim()) {
      setError("Kode dan nama supplier wajib diisi.");
      return;
    }
    setAdding(true);
    try {
      await addSupplier(kodeDraft, namaDraft);
      setKodeDraft("");
      setNamaDraft("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setAdding(false);
    }
  }

  const columns: ColumnDef<MaterialSupplierRow>[] = [
    { key: "kode", label: "Kode", default: true, render: (r) => r.kode },
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
    <div className="flex flex-col gap-2">
      <DataTable
        title="Supplier Kain"
        subtitle={`${rows.length} supplier — dipakai sebagai pilihan dropdown di Harga Kain & Harga Kain PKS (bukan Harga Maklon, itu memakai daftar Vendor Produksi). Tambah di sini dulu sebelum bisa dipilih di kedua tabel itu.`}
        headerActions={
          <div className="flex items-center gap-1.5">
            <input value={kodeDraft} onChange={(e) => setKodeDraft(e.target.value)} placeholder="Kode…" className="input w-[110px] !py-1.5 !text-[11.5px]" />
            <input value={namaDraft} onChange={(e) => setNamaDraft(e.target.value)} placeholder="Nama supplier…" className="input w-[160px] !py-1.5 !text-[11.5px]" />
            <Button onClick={handleAdd} variant="dashed" size="sm" disabled={adding}>
              {adding ? "Menambah…" : "+ Tambah supplier"}
            </Button>
          </div>
        }
        columns={columns}
        rows={rows}
        keyOf={(r) => r.id}
        firstColumnLabel="No."
        firstColumnRender={(r) => <span className="font-mono text-[11px] text-text-muted">{rows.indexOf(r) + 1}</span>}
        search={{ placeholder: "Cari supplier…", getText: (r) => `${r.kode} ${r.nama}` }}
        emptyText='Belum ada supplier — isi kode & nama di atas, klik "+ Tambah supplier".'
      />
      {error && <div className="font-sans text-[11px] font-medium text-danger-fg">{error}</div>}
    </div>
  );
}
