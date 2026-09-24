"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { DataTable, type ColumnDef } from "@/components/mrp/data-table";
import { MasterDataFormModal, ModalField } from "@/components/mrp/master-data-form-modal";
import { ImportWarnaAliasModal } from "@/components/mrp/import-warna-alias-modal";
import { useMrpStore } from "@/lib/mrp/store";
import type { WarnaAliasRow } from "@/lib/mrp/masterData";

type Draft = { mrpWarna: string; skuWarna: string; catatan: string };
const EMPTY_DRAFT: Draft = { mrpWarna: "", skuWarna: "", catatan: "" };

/** Master Data "Mapping Warna" (nama tampilan; kode/tipe internal tetap "WarnaAlias", lihat
 *  migration 0051, owner 2026-09-24: "ganti jadi mapping warna dulu, jangan alias warna" --
 *  nama warna di MRP beda dari
 *  Master Data SKU -- BENHUR SPECIAL 24S vs BENHUR 24S, FUCHSIA vs FANTA, PUTIH BLUISH vs PUTIH").
 *  Pemetaan nama warna PPIC-di-MRP -> nama warna di Master Data SKU, dipakai server-side
 *  (wms_resi_snapshot) sebagai fallback KEDUA saat pencocokan SKU langsung (nama sama persis)
 *  gagal -- lihat catatan lengkap di WarnaAliasRow (lib/mrp/masterData.ts). Tidak mengubah data
 *  MRP/SKU yang sudah ada, murni tabel pemetaan tambahan yang bisa ditambah kapan saja tanpa
 *  perlu deploy kode baru. */
export function WarnaAliasPanel() {
  const rows = useMrpStore((s) => s.warnaAliases);
  const itemSellingPrices = useMrpStore((s) => s.itemSellingPrices);
  const addRow = useMrpStore((s) => s.addWarnaAlias);
  const updateRow = useMrpStore((s) => s.updateWarnaAlias);
  const deleteRow = useMrpStore((s) => s.deleteWarnaAlias);

  // Dropdown "Nama di SKU" HANYA dari warna yang sudah ada di Master Data SKU -- sengaja bukan
  // input teks bebas (beda dari "Nama di MRP") supaya sisi ini, yang HARUS persis cocok dengan
  // item_selling_prices.warna, tidak salah ketik.
  const skuWarnaOptions = Array.from(new Set(itemSellingPrices.map((r) => r.warna))).sort((a, b) => a.localeCompare(b, "id-ID"));

  const [mode, setMode] = useState<"add" | "edit" | null>(null);
  const [editingRow, setEditingRow] = useState<WarnaAliasRow | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  // Revisi 2026-09-24 (owner: "buat mapping warna juga bisa ada fitur import spreadsheet").
  const [importOpen, setImportOpen] = useState(false);

  function openAdd() {
    setDraft({ ...EMPTY_DRAFT, skuWarna: skuWarnaOptions[0] ?? "" });
    setEditingRow(null);
    setError("");
    setMode("add");
  }
  function openEdit(r: WarnaAliasRow) {
    setDraft({ mrpWarna: r.mrpWarna, skuWarna: r.skuWarna, catatan: r.catatan ?? "" });
    setEditingRow(r);
    setError("");
    setMode("edit");
  }

  async function handleSave() {
    setError("");
    if (!draft.mrpWarna.trim() || !draft.skuWarna.trim()) {
      setError("Nama di MRP dan Nama di SKU wajib diisi.");
      return;
    }
    const payload = { mrpWarna: draft.mrpWarna.trim(), skuWarna: draft.skuWarna.trim(), catatan: draft.catatan.trim() || undefined };
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

  const columns: ColumnDef<WarnaAliasRow>[] = [
    { key: "mrpWarna", label: "Nama di MRP", default: true, render: (r) => r.mrpWarna },
    { key: "skuWarna", label: "Nama di SKU", default: true, render: (r) => r.skuWarna },
    { key: "catatan", label: "Catatan", default: true, render: (r) => r.catatan || "—" },
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
        title="Mapping Warna"
        subtitle={`${rows.length} mapping. Pemetaan nama warna di MRP (PPIC) ke nama warna di Master Data SKU -- dipakai otomatis kalau nama warnanya beda tapi warnanya sama (mis. "BENHUR SPECIAL 24S" -> "BENHUR 24S"), supaya SKU di resi WMS tetap kecocok.`}
        headerActions={
          <div className="flex items-center gap-1.5">
            <Button onClick={() => setImportOpen(true)} variant="ghost" size="sm">
              Import Data
            </Button>
            <Button onClick={openAdd} variant="dashed" size="sm">
              + Tambah Mapping
            </Button>
          </div>
        }
        columns={columns}
        rows={rows}
        keyOf={(r) => r.id}
        firstColumnLabel="No."
        firstColumnRender={(r) => <span className="font-mono text-[11px] text-text-muted">{rows.indexOf(r) + 1}</span>}
        search={{ placeholder: "Cari nama warna…", getText: (r) => `${r.mrpWarna} ${r.skuWarna}` }}
        emptyText='Belum ada mapping warna — klik "+ Tambah Mapping".'
        bodyMaxHeight="60vh"
      />
      {mode && (
        <MasterDataFormModal title={mode === "add" ? "Tambah Mapping Warna" : "Edit Mapping Warna"} onCancel={() => setMode(null)} onSave={handleSave} saving={saving} error={error}>
          <ModalField label="Nama di MRP">
            <input
              value={draft.mrpWarna}
              onChange={(e) => setDraft({ ...draft, mrpWarna: e.target.value })}
              className="input w-full"
              placeholder="Persis seperti di data MRP/Aduan Pola, mis. BENHUR SPECIAL 24S"
            />
          </ModalField>
          <ModalField label="Nama di SKU">
            {skuWarnaOptions.length === 0 ? (
              <div className="font-sans text-[11.5px] text-text-muted">Belum ada warna di Master Data SKU -- tambah SKU dulu.</div>
            ) : (
              <select value={draft.skuWarna} onChange={(e) => setDraft({ ...draft, skuWarna: e.target.value })} className="input w-full">
                {skuWarnaOptions.map((w) => (
                  <option key={w} value={w}>
                    {w}
                  </option>
                ))}
              </select>
            )}
          </ModalField>
          <ModalField label="Catatan (opsional)">
            <input value={draft.catatan} onChange={(e) => setDraft({ ...draft, catatan: e.target.value })} className="input w-full" placeholder="mis. alasan pemetaan ini" />
          </ModalField>
        </MasterDataFormModal>
      )}
      {importOpen && <ImportWarnaAliasModal onClose={() => setImportOpen(false)} />}
    </>
  );
}
