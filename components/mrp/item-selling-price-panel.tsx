"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { NumberInput } from "@/components/mrp/number-input";
import { DataTable, type ColumnDef } from "@/components/mrp/data-table";
import { MasterDataFormModal, ModalField } from "@/components/mrp/master-data-form-modal";
import { formatRupiah, MATERIAL_KATEGORI_URUTAN } from "@/lib/mrp/derive";
import { useMrpStore } from "@/lib/mrp/store";
import type { ItemSellingPriceRow } from "@/lib/mrp/masterData";
import type { Lengan } from "@/lib/mrp/types";

type Draft = { kategori: string; sku: string; itemName: string; warna: string; lengan: Lengan; size: string; price: number };
const EMPTY_DRAFT: Draft = { kategori: MATERIAL_KATEGORI_URUTAN[0], sku: "", itemName: "", warna: "", lengan: "PENDEK", size: "", price: 0 };

/** Master Data "SKU (Harga Jual per Item)" milik PPIC (migration 0035 seed awal, 0043 dibikin
 *  live) -- sebelumnya cuma tabel database tanpa halaman apapun (lihat komentar 0035), sekarang
 *  bisa ditambah/diedit/dihapus dari sini. DIPAKAI LIVE oleh `sellingPriceFor` (lib/mrp/derive.ts,
 *  kolom "% HPP" di Laporan HPP Finance) DAN oleh integrasi WMS: RPC `wms_master_sku_snapshot`
 *  (migration 0043) membaca tabel ini supaya WMS bisa sinkron Master SKU-nya sendiri saat ada SKU
 *  baru/berubah di sini -- lihat integration/README.md di repo WMS-Tigalapan-Indonesia. */
export function ItemSellingPricePanel() {
  const rows = useMrpStore((s) => s.itemSellingPrices);
  const addRow = useMrpStore((s) => s.addItemSellingPriceRow);
  const updateRow = useMrpStore((s) => s.updateItemSellingPriceRow);
  const deleteRow = useMrpStore((s) => s.deleteItemSellingPriceRow);

  const [mode, setMode] = useState<"add" | "edit" | null>(null);
  const [editingRow, setEditingRow] = useState<ItemSellingPriceRow | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function openAdd() {
    setDraft(EMPTY_DRAFT);
    setEditingRow(null);
    setError("");
    setMode("add");
  }
  function openEdit(r: ItemSellingPriceRow) {
    setDraft({ kategori: r.kategori, sku: r.sku ?? "", itemName: r.itemName, warna: r.warna, lengan: r.lengan, size: r.size, price: r.price });
    setEditingRow(r);
    setError("");
    setMode("edit");
  }

  async function handleSave() {
    setError("");
    if (!draft.itemName.trim()) {
      setError("Nama item wajib diisi.");
      return;
    }
    if (!draft.warna.trim() || !draft.size.trim()) {
      setError("Warna dan size wajib diisi.");
      return;
    }
    const payload = {
      kategori: draft.kategori,
      sku: draft.sku.trim() || null,
      itemName: draft.itemName.trim(),
      warna: draft.warna.trim(),
      lengan: draft.lengan,
      size: draft.size.trim(),
      price: draft.price,
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

  const columns: ColumnDef<ItemSellingPriceRow>[] = [
    { key: "sku", label: "SKU", default: true, render: (r) => r.sku || "—" },
    { key: "itemName", label: "Nama Item", default: true, render: (r) => r.itemName },
    { key: "kategori", label: "Kategori", default: true, render: (r) => r.kategori },
    { key: "warna", label: "Warna", default: true, render: (r) => r.warna },
    { key: "lengan", label: "Lengan", default: true, render: (r) => r.lengan },
    { key: "size", label: "Size", default: true, render: (r) => r.size },
    { key: "price", label: "Harga Jual", default: true, align: "right", render: (r) => formatRupiah(r.price) },
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
        title="SKU (Harga Jual per Item)"
        subtitle={`${rows.length} SKU. Dipakai untuk kolom "% HPP" di Laporan HPP (Finance) & dicocokkan otomatis ke resi pengiriman WMS lewat SKU.`}
        headerActions={
          <Button onClick={openAdd} variant="dashed" size="sm">
            + Tambah SKU
          </Button>
        }
        columns={columns}
        rows={rows}
        keyOf={(r) => r.id}
        firstColumnLabel="No."
        firstColumnRender={(r) => <span className="font-mono text-[11px] text-text-muted">{rows.indexOf(r) + 1}</span>}
        search={{ placeholder: "Cari SKU, nama item, warna…", getText: (r) => `${r.sku ?? ""} ${r.itemName} ${r.warna} ${r.size}` }}
        filterDefs={[
          { label: "Kategori", options: Array.from(new Set(rows.map((r) => r.kategori))).sort((a, b) => a.localeCompare(b, "id-ID")), test: (r, v) => r.kategori === v },
          { label: "Lengan", options: ["PENDEK", "PANJANG"], test: (r, v) => r.lengan === v },
        ]}
        emptyText='Belum ada SKU — klik "+ Tambah SKU".'
        bodyMaxHeight="60vh"
      />
      {mode && (
        <MasterDataFormModal title={mode === "add" ? "Tambah SKU" : "Edit SKU"} onCancel={() => setMode(null)} onSave={handleSave} saving={saving} error={error}>
          <ModalField label="SKU (opsional)">
            <input value={draft.sku} onChange={(e) => setDraft({ ...draft, sku: e.target.value })} className="input w-full" placeholder="mis. A08-075B4" />
          </ModalField>
          <ModalField label="Nama Item">
            <input value={draft.itemName} onChange={(e) => setDraft({ ...draft, itemName: e.target.value })} className="input w-full" />
          </ModalField>
          <ModalField label="Kategori">
            <select value={draft.kategori} onChange={(e) => setDraft({ ...draft, kategori: e.target.value })} className="input w-full">
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
          <ModalField label="Lengan">
            <select value={draft.lengan} onChange={(e) => setDraft({ ...draft, lengan: e.target.value as Lengan })} className="input w-full">
              <option value="PENDEK">PENDEK</option>
              <option value="PANJANG">PANJANG</option>
            </select>
          </ModalField>
          <ModalField label="Size">
            <input value={draft.size} onChange={(e) => setDraft({ ...draft, size: e.target.value })} className="input w-full" />
          </ModalField>
          <ModalField label="Harga Jual">
            <NumberInput value={draft.price} onChange={(v) => setDraft({ ...draft, price: v })} currency className="input w-full" />
          </ModalField>
        </MasterDataFormModal>
      )}
    </>
  );
}
