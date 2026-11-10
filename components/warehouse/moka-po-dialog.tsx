"use client";

import { useState } from "react";
import { ResiDownloadDialog } from "@/components/warehouse/resi-download-dialog";
import { MOKA_SUPPLIER_EMAILS } from "@/lib/mrp/exportMokaPo";
import type { WarehouseReceivableGroup } from "@/lib/mrp/derive";

const TEMPLATE_KEY = "moka-po-template-v1";
const SUPPLIER_KEY = "moka-po-supplier-v1";

type Stored = { name: string; text: string };

// Penyimpanan browser hanya kemudahan (template tidak perlu diunggah ulang); semua akses dibungkus try/catch.
function loadStored(): Stored | null {
  try {
    const raw = window.localStorage.getItem(TEMPLATE_KEY);
    return raw ? (JSON.parse(raw) as Stored) : null;
  } catch {
    return null;
  }
}

/** Popup "Download PO" Penerimaan Warehouse (owner 2026-11-10): pilih resi (sama seperti Download Excel), pilih supplier Moka, dan unggah template
 *  "Import - Items Purchase Order" dari Moka; hasilnya file template yang sama dengan kolom Supplier Email, Order (qty), dan Unit Cost (HPP) terisi. */
export function MokaPoDialog({
  groups,
  vendorName,
  onDownload,
  onClose,
}: {
  groups: WarehouseReceivableGroup[];
  vendorName: (g: WarehouseReceivableGroup) => string;
  onDownload: (selected: WarehouseReceivableGroup[], supplierEmail: string, templateText: string) => Promise<void>;
  onClose: () => void;
}) {
  const [supplier, setSupplier] = useState(() => {
    try {
      return window.localStorage.getItem(SUPPLIER_KEY) ?? "";
    } catch {
      return "";
    }
  });
  const [template, setTemplate] = useState<Stored | null>(loadStored);
  const [fileError, setFileError] = useState("");

  async function pickFile(file: File | undefined) {
    if (!file) return;
    setFileError("");
    try {
      const text = await file.text();
      const firstLine = text.replace(/^﻿/, "").split(/\r?\n/, 1)[0] ?? "";
      if (!/Supplier Email/i.test(firstLine) || !/Items Name/i.test(firstLine) || !/Unit Cost/i.test(firstLine)) {
        setFileError("Bukan template Moka \"Import - Items Purchase Order\" (kolom Supplier Email, Items Name, Order, Unit Cost tidak ada).");
        return;
      }
      const stored = { name: file.name, text };
      setTemplate(stored);
      try {
        window.localStorage.setItem(TEMPLATE_KEY, JSON.stringify(stored));
      } catch {
        /* penyimpanan penuh atau diblokir: template tetap dipakai untuk unduhan ini */
      }
    } catch {
      setFileError("File tidak bisa dibaca.");
    }
  }

  const label = "block font-sans text-[11px] font-medium uppercase tracking-wider text-text-muted";
  const sel = "mt-1 w-full rounded-md border border-[#DDE4EB] px-[11px] py-[9px] font-sans text-[12.5px] font-medium text-text-primary";
  return (
    <ResiDownloadDialog
      groups={groups}
      vendorName={vendorName}
      onClose={onClose}
      title="Download PO (Import Moka)"
      showSheetCount={false}
      extraReady={!!supplier && !!template}
      onDownload={async (selected) => {
        try {
          window.localStorage.setItem(SUPPLIER_KEY, supplier);
        } catch {
          /* abaikan */
        }
        await onDownload(selected, supplier, template!.text);
      }}
      extraFields={
        <>
          <div>
            <label className={label}>Supplier</label>
            <select value={supplier} onChange={(e) => setSupplier(e.target.value)} className={sel}>
              <option value="">Pilih supplier…</option>
              {MOKA_SUPPLIER_EMAILS.map((email) => (
                <option key={email} value={email}>
                  {email}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={label}>Template Moka (CSV)</label>
            <div className="mt-1 flex items-center gap-2">
              <label className="cursor-pointer rounded-md border border-[#DDE4EB] bg-white px-3 py-[7px] font-sans text-[11.5px] font-semibold text-accent-blue hover:bg-[#F7F9FB]">
                {template ? "Ganti file" : "Pilih file"}
                <input
                  type="file"
                  accept=".csv,text/csv"
                  className="hidden"
                  onChange={(e) => {
                    void pickFile(e.target.files?.[0]);
                    e.target.value = "";
                  }}
                />
              </label>
              <span className="min-w-0 flex-1 truncate font-sans text-[11.5px] text-text-muted">{template ? template.name : "Belum ada — unggah file Import - Items Purchase Order dari Moka"}</span>
            </div>
            {fileError && <div className="mt-1 font-sans text-[10.5px] font-medium text-danger-fg">{fileError}</div>}
          </div>
        </>
      }
      note="Satu file CSV = template Moka yang sama, hanya baris item dari resi terpilih yang diisi: Supplier Email (supplier di atas), Order (qty, item yang sama digabung), dan Unit Cost (HPP per item, dibulatkan ke rupiah). Reject tidak ikut."
    />
  );
}
