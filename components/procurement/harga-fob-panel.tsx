"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { NumberInput } from "@/components/mrp/number-input";
import { DataTable, type ColumnDef } from "@/components/mrp/data-table";
import { MasterImportModal, normKey, upsertRows, type ImportValues } from "@/components/mrp/master-import-modal";
import { MasterDataFormModal, ModalField } from "@/components/mrp/master-data-form-modal";
import { formatRupiah, formatDateTime } from "@/lib/mrp/derive";
import { useMrpStore } from "@/lib/mrp/store";
import type { HargaFobRow } from "@/lib/mrp/masterData";

type Draft = { vendorProduksi: string; item: string; hargaPerPcs: number };
const EMPTY_DRAFT: Draft = { vendorProduksi: "", item: "", hargaPerPcs: 0 };

/** Master Data — Harga FOB (migration 0058, owner 2026-09-27: "dari master data, dummy dulu") --
 *  harga jadi per pcs (bahan+jahit, BUKAN ongkos jahit saja) untuk PO Produksi grup
 *  `LenganGroup.catProd === "FOB"` -- lihat catatan panjang di HargaFobRow (masterData.ts). Pola
 *  form/tabel SAMA seperti HargaRibPanel/HargaKerahMansetPanel, cuma dropdown-nya vendor PRODUKSI
 *  (vendorProduksiList) bukan supplier material -- vendor FOB sedia bahan sendiri, jadi tidak
 *  lewat daftar Supplier Material sama sekali. */
export function HargaFobPanel() {
  const rows = useMrpStore((s) => s.hargaFob);
  const addRow = useMrpStore((s) => s.addHargaFobRow);
  const updateRow = useMrpStore((s) => s.updateHargaFobRow);
  const deleteRow = useMrpStore((s) => s.deleteHargaFobRow);
  const vendorProduksiList = useMrpStore((s) => s.vendorProduksiList);

  const [mode, setMode] = useState<"add" | "edit" | null>(null);
  const [editingRow, setEditingRow] = useState<HargaFobRow | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [importOpen, setImportOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function vendorName(id: string): string {
    return vendorProduksiList.find((v) => v.id === id)?.name ?? id;
  }

  function openAdd() {
    setDraft(EMPTY_DRAFT);
    setEditingRow(null);
    setError("");
    setMode("add");
  }
  function openEdit(r: HargaFobRow) {
    setDraft({ vendorProduksi: r.vendorProduksi, item: r.item, hargaPerPcs: r.hargaPerPcs });
    setEditingRow(r);
    setError("");
    setMode("edit");
  }

  // Cocokkan nama/kode vendor dari file import ke Master Data Vendor Produksi (tidak peduli huruf besar/kecil).
  const findImportVendor = (name: string) => {
    const n = name.trim().toLowerCase();
    return n ? vendorProduksiList.find((v) => v.id.toLowerCase() === n || v.name.toLowerCase() === n) : undefined;
  };

  async function handleSave() {
    setError("");
    if (!draft.vendorProduksi) {
      setError("Pilih vendor produksi dulu.");
      return;
    }
    if (!draft.item.trim()) {
      setError("Isi nama item dulu.");
      return;
    }
    const payload = { vendorProduksi: draft.vendorProduksi, item: draft.item.trim(), hargaPerPcs: draft.hargaPerPcs };
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

  const columns: ColumnDef<HargaFobRow>[] = [
    { key: "vendorProduksi", label: "Vendor Produksi", default: true, render: (r) => vendorName(r.vendorProduksi) },
    { key: "item", label: "Item", default: true, render: (r) => r.item },
    { key: "hargaPerPcs", label: "Harga per pcs", default: true, align: "right", render: (r) => formatRupiah(r.hargaPerPcs) },
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
      <div className="mb-2 font-sans text-[10.5px] text-text-muted">
        Harga jadi per pcs untuk PO Produksi FOB (vendor sedia bahan sendiri + jahit, 1 harga per pcs — beda dari Harga Maklon yang cuma ongkos jahit).
      </div>
      <DataTable
        title="Harga FOB"
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
        search={{ placeholder: "Cari vendor/item…", getText: (r) => `${vendorName(r.vendorProduksi)} ${r.item}` }}
        emptyText='Belum ada data — klik "+ Tambah Data".'
      />
      {mode && (
        <MasterDataFormModal title={mode === "add" ? "Tambah Harga FOB" : "Edit Harga FOB"} onCancel={() => setMode(null)} onSave={handleSave} saving={saving} error={error}>
          <ModalField label="Vendor Produksi">
            <select value={draft.vendorProduksi} onChange={(e) => setDraft({ ...draft, vendorProduksi: e.target.value })} className="input w-full">
              <option value="">— pilih vendor —</option>
              {vendorProduksiList.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </select>
          </ModalField>
          <ModalField label="Item">
            <input value={draft.item} onChange={(e) => setDraft({ ...draft, item: e.target.value })} className="input w-full" placeholder="mis. CARGO MAMU" />
          </ModalField>
          <ModalField label="Harga per pcs">
            <NumberInput value={draft.hargaPerPcs} onChange={(v) => setDraft({ ...draft, hargaPerPcs: v })} currency className="input w-full" />
          </ModalField>
        </MasterDataFormModal>
      )}
      {importOpen && (
        <MasterImportModal
          title="Harga FOB"
          templateName="Template-Import-Harga-FOB.xlsx"
          matchNote="Baris dengan Vendor Produksi + Item yang SAMA dengan data yang sudah ada akan diperbarui, bukan digandakan."
          columns={[
            { key: "vendor", label: "Vendor Produksi", aliases: ["Vendor", "Nama Vendor", "Kode Vendor"], required: true, example: vendorProduksiList[0]?.name ?? "CE" },
            { key: "item", label: "Item", required: true, example: "CARGO PANJANG" },
            { key: "hargaPerPcs", label: "Harga Per Pcs", aliases: ["Harga/Pcs", "Harga"], required: true, number: true, example: 85000 },
          ]}
          validate={(v) => (findImportVendor(String(v.vendor)) ? [] : ["Vendor tidak ada di Master Data Vendor Produksi"])}
          save={(vals) => {
            const keyOf = (v: ImportValues) => normKey(findImportVendor(String(v.vendor))?.id, v.item);
            const payload = (v: ImportValues) => ({ vendorProduksi: findImportVendor(String(v.vendor))!.id, item: String(v.item).trim(), hargaPerPcs: Number(v.hargaPerPcs) });
            const existing = new Map(rows.map((r) => [normKey(r.vendorProduksi, r.item), r.id]));
            return upsertRows(vals, keyOf, existing, (v) => addRow(payload(v)), (id, v) => updateRow(id, payload(v)));
          }}
          onClose={() => setImportOpen(false)}
        />
      )}
    </>
  );
}
