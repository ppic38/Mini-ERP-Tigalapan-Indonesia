"use client";

import { Fragment, useEffect, useState } from "react";
import * as XLSX from "xlsx";
import { AppShell } from "@/components/shell/app-shell";
import { KpiCard } from "@/components/ui/kpi-card";
import { Button } from "@/components/ui/button";
import { useMrpStore } from "@/lib/mrp/store";
import { formatDate, formatPcs, formatRupiah, hppRowsForInvoicePerRoll, type HppRow } from "@/lib/mrp/derive";
import { VENDOR_PRODUKSI } from "@/lib/mrp/seed";
import type { DeliveryKoli } from "@/lib/mrp/types";

/** Item 2026-09-11 (user-reported: "Batch koli" cuma label bebas yang diketik vendor, TIDAK
 *  dijamin unik -- kalau 2 koli FISIK berbeda kebetulan/sengaja dinamai sama, mis. "1", 2 baris
 *  breakdown ini kelihatan seperti duplikat padahal itu 2 pengiriman beda tanggal/resi). Tambah
 *  `tanggalKirim`/`noResi` (lookup `koliId` -> DeliveryKoli, dihitung SEKALI saat membangun `rows`
 *  supaya tabel & export Excel pakai nilai yang sama persis) supaya 2 baris begitu tetap bisa
 *  dibedakan tanpa pindah ke halaman Payment Maklon > Lampiran ekspedisi. */
type HppTableRow = HppRow & { rowId: string; tanggalKirim?: string; noResi?: string };

/** Struktur agregat per vendor untuk 1 MRP -- persis rumus yang tadinya melekat langsung pada
 *  baris utama tabel (grouping key `mrpId|vendorProduksi`), sekarang jadi 1 entry di dalam
 *  `MrpHppSummary.vendors` (lihat requirement D, spec restrukturisasi Laporan HPP). */
type VendorHppSummary = {
  vendorProduksi: string;
  vendorLabel: string;
  totalFg: number;
  avgHpp: number;
  totalBiayaProduksi: number;
  totalCogsBahan: number;
  totalOngkir: number;
  itemRows: HppTableRow[];
};

/** Baris utama tabel sekarang 1 MRP = 1 baris (bukan lagi 1 MRP+vendor) -- `vendors` menampung
 *  breakdown per vendor produksi untuk drill-down langkah-1, sementara `itemRows`/`totalFg`/dst di
 *  level ini adalah agregat gabungan SEMUA vendor MRP tsb (dihitung ulang dari gabungan itemRows,
 *  BUKAN rata-rata dari rata-rata vendor -- lihat requirement D butir 14 di spec). */
type MrpHppSummary = {
  mrpId: string;
  mrpLabel: string;
  vendors: VendorHppSummary[];
  totalFg: number;
  avgHpp: number;
  totalBiayaProduksi: number;
  totalCogsBahan: number;
  totalOngkir: number;
  itemRows: HppTableRow[];
};

/** Sorting requirement D butir 20 -- batch/resi vendor tsb bisa lebih dari satu (vendor kirim
 *  beberapa resi/koli terpisah untuk 1 MRP), urutkan supaya baris yang sama noResi-nya
 *  mengelompok: noResi (baris tanpa resi paling bawah), lalu tanggalKirim, noKoli, warna, lengan,
 *  item. Tidak ada header grup/subtotal per resi (non-goal, lihat spec). */
function sortHppRowsForDetail(rows: HppTableRow[]): HppTableRow[] {
  return [...rows].sort((a, b) => {
    const noResiA = a.noResi ?? "";
    const noResiB = b.noResi ?? "";
    if (!noResiA && noResiB) return 1;
    if (noResiA && !noResiB) return -1;
    if (noResiA !== noResiB) return noResiA < noResiB ? -1 : 1;
    const tglA = a.tanggalKirim ?? "";
    const tglB = b.tanggalKirim ?? "";
    if (tglA !== tglB) return tglA < tglB ? -1 : 1;
    const koliA = a.noKoli ?? "";
    const koliB = b.noKoli ?? "";
    if (koliA !== koliB) return koliA < koliB ? -1 : 1;
    if (a.warna !== b.warna) return a.warna < b.warna ? -1 : 1;
    if (a.lengan !== b.lengan) return a.lengan < b.lengan ? -1 : 1;
    if (a.item !== b.item) return a.item < b.item ? -1 : 1;
    return 0;
  });
}

/** Item 2026-09-11 (feedback: "Tambahkan fitur download lampiran HPP (Per no MRP)") -- export
 *  Excel dari `itemRows` (HppRow[], SUDAH dihitung lewat hppRowsForInvoicePerRoll -- granularitas
 *  per roll/koli, lebih detail dari lampiran invoice lama di Procurement) untuk 1 MRP (gabungan
 *  SEMUA vendor MRP itu, requirement D butir 21), TANPA menghitung ulang apa pun -- pola export
 *  SAMA PERSIS `exportInvoiceLampiranExcel`/`downloadInvoiceLampiran` di
 *  components/procurement/invoice-vendor-review-panel.tsx (SheetJS json_to_sheet + writeFile),
 *  cuma sumber datanya beda (baris HPP per MRP di halaman ini, bukan per invoice). Kolom pertama
 *  `VENDOR` ditambahkan (sebelum `MRP`) supaya baris antar-vendor tetap bisa dibedakan di sheet
 *  gabungan; urutan baris = vendor alfabetis lalu sorting per-resi (sortHppRowsForDetail). */
function exportMrpHppExcel(m: MrpHppSummary): XLSX.WorkSheet {
  const vendorsSorted = [...m.vendors].sort((a, b) => (a.vendorLabel < b.vendorLabel ? -1 : a.vendorLabel > b.vendorLabel ? 1 : 0));
  const orderedRows = vendorsSorted.flatMap((v) => sortHppRowsForDetail(v.itemRows));
  const rows = orderedRows.map((d) => ({
    VENDOR: VENDOR_PRODUKSI[d.vendorProduksi]?.name ?? d.vendorProduksi,
    MRP: d.mrpLabel,
    "WARNA / LENGAN": `${d.warna} · ${d.lengan}`,
    ITEM: d.item,
    "BATCH KOLI": d.noKoli ?? "—",
    "TANGGAL KIRIM": d.tanggalKirim ? formatDate(d.tanggalKirim) : "—",
    "NO RESI": d.noResi ?? "—",
    FG: d.fg,
    REJECT: d.reject,
    REWORK: d.rework,
    "YIELD (%)": Number(d.yieldPct.toFixed(1)),
    "BIAYA PRODUKSI/ITEM": Math.round(d.biayaProduksiPerItem),
    "COGS BAHAN/ITEM": Math.round(d.cogsBahanPerItem),
    "ONGKIR/ITEM": Math.round(d.ongkirPerItem),
    "HPP/ITEM": Math.round(d.hppPerItem),
  }));
  return XLSX.utils.json_to_sheet(rows);
}

function downloadMrpHpp(m: MrpHppSummary) {
  const wb = XLSX.utils.book_new();
  const ws = exportMrpHppExcel(m);
  XLSX.utils.book_append_sheet(wb, ws, "HPP");
  XLSX.writeFile(wb, `HPP-${m.mrpId}.xlsx`);
}

/** Tabel detail per item untuk 1 MRP+vendor — dipakai sebagai isi langkah-2 drill-down (pola sama
 *  seperti dropdown MRP di PPIC/SCM). "Item yang dihitung" mencakup FG maupun Rework — kolom
 *  Rework ditampilkan eksplisit di samping FG (pcs hasil rework yang MENDARAT di lengan/size yang
 *  sama seperti baris invoice aslinya sudah otomatis ikut kehitung sebagai bagian dari FG).
 *  Kolom "Batch Koli" (feedback 2026-09-09: "saya ingin ada ... batch pengiriman") menunjukkan
 *  koli pengiriman spesifik asal baris ini — kosong untuk baris pool lama (MRP tanpa roll
 *  tracking sama sekali) yang menggabungkan >1 koli sekaligus, lihat HppRow.noKoli. Rows di-sort
 *  (requirement D butir 20) sebelum dirender supaya batch/resi berbeda mengelompok rapi. */
/** Item revisi 2026-09-18 (owner: "filternya di setiap header, klik header untuk filter", lalu
 *  "terapkan multifilter") -- header kolom kategorikal (Warna/Lengan, Batch Koli, No Resi) jadi
 *  tombol: klik buka popover checklist nilai unik kolom itu, BISA PILIH LEBIH DARI SATU
 *  (kosong = tidak difilter/semua, sama seperti filterDefs multi-select di komponen lain).
 *  Cuma 1 popover per header instance (state lokal ke komponen ini sendiri) -- overlay transparan
 *  di belakang popover menutupnya begitu diklik di luar; popover TIDAK auto-close begitu 1 opsi
 *  dicentang (beda dari versi single-select sebelumnya) supaya bisa centang beberapa sekaligus. */
function FilterableTh({
  label,
  align = "left",
  options,
  value,
  onChange,
}: {
  label: string;
  align?: "left" | "right";
  options: string[];
  value: Set<string>;
  onChange: (v: Set<string>) => void;
}) {
  const [open, setOpen] = useState(false);
  function toggle(o: string) {
    const next = new Set(value);
    if (next.has(o)) next.delete(o);
    else next.add(o);
    onChange(next);
  }
  return (
    <th className={"relative px-3 py-2 " + (align === "right" ? "text-right" : "text-left")}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={"inline-flex items-center gap-1 font-sans text-[10px] font-semibold uppercase tracking-wider hover:text-action-primary " + (value.size > 0 ? "text-action-primary" : "text-text-muted")}
      >
        {label}
        {value.size > 0 ? <span className="rounded-full bg-action-primary px-1.5 py-px text-[9px] font-bold text-white">{value.size}</span> : <span className="text-[9px]">▾</span>}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-full z-30 mt-1 flex max-h-72 w-60 flex-col overflow-hidden rounded-md border border-border-subtle bg-white shadow-[0_8px_20px_rgba(11,19,27,.15)]">
            <div className="flex items-center justify-between border-b border-[#F1F4F7] px-2 py-1.5">
              <button type="button" onClick={() => onChange(new Set(options))} className="font-sans text-[10.5px] font-semibold text-action-primary">
                Pilih semua
              </button>
              <button type="button" onClick={() => onChange(new Set())} className="font-sans text-[10.5px] font-semibold text-action-primary">
                Kosongkan
              </button>
            </div>
            <div className="overflow-y-auto p-1">
              {options.map((o) => (
                <label key={o} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-left normal-case hover:bg-[#F7F9FB]">
                  <input type="checkbox" checked={value.has(o)} onChange={() => toggle(o)} className="h-3.5 w-3.5 flex-none accent-accent-blue" />
                  <span className="truncate font-sans text-[11px] font-medium text-[#31414F]" title={o}>
                    {o}
                  </span>
                </label>
              ))}
            </div>
          </div>
        </>
      )}
    </th>
  );
}

function MrpHppDetailTable({ rows }: { rows: HppTableRow[] }) {
  const [warnaLenganFilter, setWarnaLenganFilter] = useState<Set<string>>(new Set());
  const [batchKoliFilter, setBatchKoliFilter] = useState<Set<string>>(new Set());
  const [noResiFilter, setNoResiFilter] = useState<Set<string>>(new Set());
  const sortedRows = sortHppRowsForDetail(rows);
  const warnaLenganOf = (r: HppTableRow) => `${r.warna} · ${r.lengan}`;
  const warnaLenganOptions = Array.from(new Set(rows.map(warnaLenganOf))).sort((a, b) => a.localeCompare(b, "id-ID"));
  const batchKoliOptions = Array.from(new Set(rows.map((r) => r.noKoli).filter((v): v is string => !!v))).sort((a, b) => a.localeCompare(b, "id-ID"));
  const noResiOptions = Array.from(new Set(rows.map((r) => r.noResi).filter((v): v is string => !!v))).sort((a, b) => a.localeCompare(b, "id-ID"));
  const filteredRows = sortedRows.filter(
    (r) =>
      (warnaLenganFilter.size === 0 || warnaLenganFilter.has(warnaLenganOf(r))) &&
      (batchKoliFilter.size === 0 || (r.noKoli != null && batchKoliFilter.has(r.noKoli))) &&
      (noResiFilter.size === 0 || (r.noResi != null && noResiFilter.has(r.noResi)))
  );
  const hasActiveFilter = warnaLenganFilter.size > 0 || batchKoliFilter.size > 0 || noResiFilter.size > 0;
  return (
    <div className="overflow-hidden rounded-md border border-[#E4E9EE] bg-white">
      {hasActiveFilter && (
        <div className="flex items-center gap-2 border-b border-[#E4E9EE] bg-[#FAFBFC] px-3 py-1.5 font-sans text-[10.5px] text-text-muted">
          <span>
            {filteredRows.length} dari {sortedRows.length} baris
          </span>
          <button
            type="button"
            onClick={() => {
              setWarnaLenganFilter(new Set());
              setBatchKoliFilter(new Set());
              setNoResiFilter(new Set());
            }}
            className="font-semibold text-action-primary underline"
          >
            ✕ Hapus semua filter
          </button>
        </div>
      )}
      <div className="overflow-x-auto">
      <table className="w-full min-w-[1420px] border-collapse">
        <thead>
          <tr className="border-b border-[#E4E9EE] bg-[#F2F5F8] font-sans text-[10px] font-semibold uppercase tracking-wider text-text-muted">
            <FilterableTh label="Warna / lengan" options={warnaLenganOptions} value={warnaLenganFilter} onChange={setWarnaLenganFilter} />
            <th className="px-3 py-2 text-left">Item</th>
            <FilterableTh label="Batch koli" options={batchKoliOptions} value={batchKoliFilter} onChange={setBatchKoliFilter} />
            <th className="px-3 py-2 text-left">Tanggal kirim</th>
            <FilterableTh label="No resi" options={noResiOptions} value={noResiFilter} onChange={setNoResiFilter} />
            <th className="px-3 py-2 text-right">FG</th>
            <th className="px-3 py-2 text-right">Reject</th>
            <th className="px-3 py-2 text-right">Rework</th>
            <th className="px-3 py-2 text-right">Yield</th>
            <th className="px-3 py-2 text-right">Biaya Produksi/Item</th>
            <th className="px-3 py-2 text-right">COGS Bahan/Item</th>
            <th className="px-3 py-2 text-right">Ongkir/Item</th>
            <th className="px-3 py-2 text-right">HPP/Item</th>
            <th className="px-3 py-2 text-right">Harga Jual/Item</th>
            <th className="px-3 py-2 text-right">% HPP</th>
          </tr>
        </thead>
        <tbody>
          {filteredRows.length === 0 && (
            <tr>
              <td colSpan={15} className="px-3 py-6 text-center font-sans text-[11.5px] text-text-muted">
                Tidak ada baris yang cocok dengan filter.
              </td>
            </tr>
          )}
          {filteredRows.map((r) => (
            <tr key={r.rowId} className="border-b border-[#EEF1F4] font-sans text-[11.5px] text-[#31414F] last:border-b-0">
              <td className="px-3 py-1.5">
                {r.warna} · {r.lengan}
              </td>
              <td className="px-3 py-1.5">{r.item}</td>
              <td className="px-3 py-1.5 font-mono text-text-muted">{r.noKoli ?? "—"}</td>
              <td className="px-3 py-1.5 font-mono text-text-muted">{r.tanggalKirim ? formatDate(r.tanggalKirim) : "—"}</td>
              <td className="px-3 py-1.5 font-mono text-text-muted">{r.noResi ?? "—"}</td>
              <td className="px-3 py-1.5 text-right font-mono">{formatPcs(r.fg)}</td>
              <td className="px-3 py-1.5 text-right font-mono">{formatPcs(r.reject)}</td>
              <td className="px-3 py-1.5 text-right font-mono text-rework-fg">{formatPcs(r.rework)}</td>
              <td className="px-3 py-1.5 text-right font-mono">{r.yieldPct.toFixed(1)}%</td>
              <td className="px-3 py-1.5 text-right font-mono">{formatRupiah(r.biayaProduksiPerItem)}</td>
              <td className="px-3 py-1.5 text-right font-mono">{formatRupiah(r.cogsBahanPerItem)}</td>
              <td className="px-3 py-1.5 text-right font-mono">{formatRupiah(r.ongkirPerItem)}</td>
              <td className="px-3 py-1.5 text-right font-mono font-semibold text-text-primary">{formatRupiah(r.hppPerItem)}</td>
              <td className="px-3 py-1.5 text-right font-mono">{r.sellingPricePerItem != null ? formatRupiah(r.sellingPricePerItem) : "—"}</td>
              <td className="px-3 py-1.5 text-right font-mono">{r.hppPercentage != null ? r.hppPercentage.toFixed(1) + "%" : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </div>
  );
}

export default function FinanceLaporanHppPage() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const vendorInvoices = useMrpStore((s) => s.vendorInvoices);
  const mrpDetails = useMrpStore((s) => s.mrpDetails);
  const staticMrps = useMrpStore((s) => s.staticMrps);
  const productionBatches = useMrpStore((s) => s.productionBatches);
  const productionResults = useMrpStore((s) => s.productionResults);
  const productionGroupMeta = useMrpStore((s) => s.productionGroupMeta);
  const rawInvoices = useMrpStore((s) => s.invoices);
  const deliveryKolis = useMrpStore((s) => s.deliveryKolis);
  const ekspedisiRates = useMrpStore((s) => s.ekspedisiRates);
  const itemSellingPrices = useMrpStore((s) => s.itemSellingPrices);

  // Revisi 2026-09-17 (owner: "grouping per level MRP dulu, baru pilih vendor produksi, baru
  // tampil detailnya") -- dulu pakai DataTable + drill-down 2 langkah terpisah (MrpVendorDrilldown,
  // dengan tombol "Ganti vendor") di dalam 1 slot renderExpanded. Sekarang tabel pohon native
  // (<table>) 2 tingkat inline, gaya visual sama dengan tree PO Material/PO Maklon: MRP -> Vendor
  // Produksi (leaf), klik vendor untuk membuka MrpHppDetailTable persis di bawah baris itu.
  const [expandedMrpHpp, setExpandedMrpHpp] = useState<string | null>(null);
  const [expandedVendorHpp, setExpandedVendorHpp] = useState<string | null>(null);
  // Item revisi 2026-09-18 (owner: "card HPP ikuti perhitungan xlsx yang dilampirkan, dan bisa
  // difilter per No. MRP") -- filter dropdown yang men-scope KPI cards di atas tabel ke 1 No. MRP
  // saja (kosong = semua MRP, perilaku lama). Cuma men-scope cards -- tabel pohon di bawah TETAP
  // menampilkan semua MRP (sudah punya drill-down sendiri, tidak diubah).
  const [hppMrpFilter, setHppMrpFilter] = useState("");

  if (!mounted) return null;

  // Invoice REVISION belum final (masih diperbaiki vendor) jadi tidak diikutkan hitung HPP.
  const relevantInvoices = vendorInvoices.filter((i) => i.status !== "REVISION");

  // Revisi 2026-09-07 (HPP per roll) -- hppRowsForInvoicePerRoll menelusuri biaya sampai ke roll
  // fisik spesifik (harga bahan roll itu sendiri + ongkir per BATCH pengiriman dari portal Vendor
  // Produksi, lihat DeliveryKoli.ongkirBatch) untuk grup warna/lengan yang sudah pakai "Tutup
  // Roll" -- lalu fallback OTOMATIS ke perhitungan pool lama (dengan ongkir auto-hitung tarif
  // ekspedisi seperti sebelumnya) per baris invoice yang grupnya belum py roll ber-closedAt (MRP
  // lama, sebelum fitur ini ada), jadi histori tidak hilang/kosong.
  const kolisById = new Map<string, DeliveryKoli>(deliveryKolis.map((k) => [k.id, k]));
  const rows: HppTableRow[] = relevantInvoices.flatMap((inv) =>
    hppRowsForInvoicePerRoll(inv, relevantInvoices, mrpDetails, staticMrps, productionBatches, productionResults, productionGroupMeta, rawInvoices, deliveryKolis, ekspedisiRates, itemSellingPrices).map((r, i) => {
      const koli = r.koliId ? kolisById.get(r.koliId) : undefined;
      return { ...r, rowId: inv.id + "-" + i, tanggalKirim: koli?.deliveredAt, noResi: koli?.noResi };
    })
  );

  // Item revisi 2026-09-18: KPI cards sekarang di-scope ke `cardRows` (bukan `rows` mentah lagi)
  // -- `cardRows` = seluruh baris kalau `hppMrpFilter` kosong (perilaku lama, semua MRP), atau
  // cuma baris MRP yang difilter.
  const cardRows = hppMrpFilter ? rows.filter((r) => r.mrpId === hppMrpFilter) : rows;
  const totalBiayaProduksi = cardRows.reduce((s, r) => s + r.biayaProduksiTotal, 0);
  const totalCogsBahan = cardRows.reduce((s, r) => s + r.cogsBahan, 0);
  const totalOngkir = cardRows.reduce((s, r) => s + r.totalOngkirRow, 0);
  // Item revisi 2026-09-18 (owner, lampiran "HPP MRP.xlsx"): tiru rumus di file itu persis --
  // per item, "Total Hpp" = Qty * Hpp(/pc) dan "Total Harga" = Qty * Harga Jual(/pc), lalu utk
  // seluruh MRP (baris ringkasan xlsx): Total Hpp = SUM(Total Hpp semua item), Total Harga =
  // SUM(Total Harga semua item), %HPP = Total Hpp / Total Harga -- BUKAN rata-rata dari
  // persentase per item (beda dari kolom "Hpp" per-baris di xlsx yang cuma informatif per item).
  // Item TANPA harga jual (itemSellingPrices tidak punya datanya) dikeluarkan dari DUA sisi
  // (Total Hpp scoped & Total Harga) supaya %HPP tidak bias oleh item yang harganya tidak
  // diketahui -- sama seperti kolom "Hpp%" per-baris di tabel bawah yang tampil "—" utk kasus itu.
  // `> 0` (bukan cuma `!= null`) -- sama seperti guard di hppPercentage per-baris
  // (lib/mrp/derive.ts), supaya konsisten dengan baris yang tampil "—" di tabel bawah.
  const rowsWithSellingPrice = cardRows.filter((r) => r.sellingPricePerItem != null && r.sellingPricePerItem > 0);
  const totalHargaJual = rowsWithSellingPrice.reduce((s, r) => s + (r.sellingPricePerItem as number) * r.fg, 0);
  const totalHppForPercent = rowsWithSellingPrice.reduce((s, r) => s + r.hppPerItem * r.fg, 0);
  const hppPercentAgg = totalHargaJual > 0 ? (totalHppForPercent / totalHargaJual) * 100 : null;

  // Restrukturisasi (requirement D): sebelumnya 1 baris = 1 pasangan MRP+vendor. Sekarang grouping
  // per MRP+vendor DIPERTAHANKAN dulu (logika di bawah ini identik dengan sebelumnya, angka per
  // vendor tidak berubah) untuk membangun `VendorHppSummary`, lalu di-roll-up ke `MrpHppSummary`
  // (1 baris = 1 MRP, `vendors[]` untuk drill-down langkah-1).
  const vendorMap = new Map<string, VendorHppSummary & { mrpId: string; mrpLabel: string }>();
  for (const r of rows) {
    const key = r.mrpId + "|" + r.vendorProduksi;
    const cur = vendorMap.get(key) ?? {
      mrpId: r.mrpId,
      mrpLabel: r.mrpLabel,
      vendorProduksi: r.vendorProduksi,
      vendorLabel: VENDOR_PRODUKSI[r.vendorProduksi]?.name ?? r.vendorProduksi,
      totalFg: 0,
      avgHpp: 0,
      totalBiayaProduksi: 0,
      totalCogsBahan: 0,
      totalOngkir: 0,
      itemRows: [] as HppTableRow[],
    };
    cur.totalFg += r.fg;
    cur.totalBiayaProduksi += r.biayaProduksiTotal;
    cur.totalCogsBahan += r.cogsBahan;
    cur.totalOngkir += r.totalOngkirRow;
    cur.itemRows.push(r);
    vendorMap.set(key, cur);
  }
  const vendorRowsFromHpp = Array.from(vendorMap.values()).map((m) => {
    const weighted = m.itemRows.reduce((s, r) => s + r.hppPerItem * r.fg, 0);
    return { ...m, avgHpp: m.totalFg > 0 ? weighted / m.totalFg : 0 };
  });

  /** Fallback REVISION-only (dipertahankan dari versi sebelumnya, requirement D butir 15): kalau
   *  pasangan MRP+vendor HANYA punya invoice REVISION (tidak ada invoice lain sama sekali),
   *  pasangan itu tidak pernah masuk `rows` (karena `relevantInvoices` di atas memfilter REVISION)
   *  -- jadi vendor itu tidak pernah muncul di langkah-1 drill-down padahal Finance perlu tahu
   *  MRP tsb "ada" (lagi ditunggu vendor revisi). Di sini gabungkan pasangan dari
   *  `vendorRowsFromHpp` (TIDAK diubah) dengan pasangan dari SELURUH `vendorInvoices` (termasuk
   *  REVISION) -- 1 invoice bisa punya lines dari >1 mrpId, jadi invoice itu relevan untuk SETIAP
   *  pasangan mrpId+vendorProduksi yang muncul di lines-nya. Untuk pasangan yang belum ada,
   *  buat entry baru dengan agregat di-nol-kan (TIDAK ikut dijumlah ke KPI cards di atas -- KPI
   *  dihitung dari `rows`, bukan dari sini) supaya vendor itu tetap muncul di langkah-1 walau
   *  belum ada angka. */
  const vendorRowsMap = new Map<string, VendorHppSummary & { mrpId: string; mrpLabel: string }>(vendorRowsFromHpp.map((m) => [m.mrpId + "|" + m.vendorProduksi, m]));
  for (const inv of vendorInvoices) {
    const mrpIdsInInvoice = Array.from(new Set(inv.lines.map((l) => l.mrpId)));
    for (const mrpId of mrpIdsInInvoice) {
      const key = mrpId + "|" + inv.vendorProduksi;
      if (vendorRowsMap.has(key)) continue;
      // Item revisi 2026-09-18 (owner: "No. MRP jangan digabung kategori bahan") -- pure mrpId,
      // sama seperti mrpLabel di hppRowsForInvoice (lib/mrp/derive.ts).
      vendorRowsMap.set(key, {
        mrpId,
        mrpLabel: mrpId,
        vendorProduksi: inv.vendorProduksi,
        vendorLabel: VENDOR_PRODUKSI[inv.vendorProduksi]?.name ?? inv.vendorProduksi,
        totalFg: 0,
        avgHpp: 0,
        totalBiayaProduksi: 0,
        totalCogsBahan: 0,
        totalOngkir: 0,
        itemRows: [],
      });
    }
  }

  // Roll-up ke 1 baris per MRP -- agregat gabungan dihitung ULANG dari `itemRows` gabungan semua
  // vendor MRP itu (avgHpp weighted dari seluruh baris, BUKAN rata-rata dari rata-rata vendor,
  // lihat rumus di spec).
  const mrpMap = new Map<string, MrpHppSummary>();
  for (const v of vendorRowsMap.values()) {
    const cur = mrpMap.get(v.mrpId) ?? {
      mrpId: v.mrpId,
      mrpLabel: v.mrpLabel,
      vendors: [] as VendorHppSummary[],
      totalFg: 0,
      avgHpp: 0,
      totalBiayaProduksi: 0,
      totalCogsBahan: 0,
      totalOngkir: 0,
      itemRows: [] as HppTableRow[],
    };
    cur.vendors.push({
      vendorProduksi: v.vendorProduksi,
      vendorLabel: v.vendorLabel,
      totalFg: v.totalFg,
      avgHpp: v.avgHpp,
      totalBiayaProduksi: v.totalBiayaProduksi,
      totalCogsBahan: v.totalCogsBahan,
      totalOngkir: v.totalOngkir,
      itemRows: v.itemRows,
    });
    cur.itemRows = cur.itemRows.concat(v.itemRows);
    mrpMap.set(v.mrpId, cur);
  }
  const mrpRows: MrpHppSummary[] = Array.from(mrpMap.values()).map((m) => {
    const weighted = m.itemRows.reduce((s, r) => s + r.hppPerItem * r.fg, 0);
    const totalFg = m.itemRows.reduce((s, r) => s + r.fg, 0);
    return {
      ...m,
      totalFg,
      totalBiayaProduksi: m.itemRows.reduce((s, r) => s + r.biayaProduksiTotal, 0),
      totalCogsBahan: m.itemRows.reduce((s, r) => s + r.cogsBahan, 0),
      totalOngkir: m.itemRows.reduce((s, r) => s + r.totalOngkirRow, 0),
      avgHpp: totalFg > 0 ? weighted / totalFg : 0,
    };
  });

  const mrpRowsSorted = [...mrpRows].sort((a, b) => (a.mrpId < b.mrpId ? 1 : a.mrpId > b.mrpId ? -1 : 0));

  return (
    <AppShell
      role="finance"
      activeHref="/finance/laporan-hpp"
      breadcrumb={["Dashboard", "Laporan HPP"]}
      title="Laporan HPP"
    >
      {/* Item revisi 2026-09-18 (owner: "card HPP ikuti perhitungan xlsx, bisa difilter per MRP")
         -- filter di atas KPI cards, TIDAK memengaruhi tabel pohon di bawah (tetap semua MRP). */}
      <div className="flex items-center gap-3 rounded-lg border border-border-subtle bg-surface-card px-4 py-3.5">
        <div>
          <div className="font-sans text-[11px] font-medium uppercase tracking-wider text-text-muted">Filter No. MRP (untuk card di bawah)</div>
          <select
            value={hppMrpFilter}
            onChange={(e) => setHppMrpFilter(e.target.value)}
            className="mt-1 rounded-md border border-[#DDE4EB] px-[11px] py-[9px] font-sans text-[12.5px] font-medium text-text-primary"
          >
            <option value="">— Semua MRP —</option>
            {mrpRowsSorted.map((m) => (
              <option key={m.mrpId} value={m.mrpId}>
                {m.mrpLabel || m.mrpId}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Item revisi 2026-09-18 (owner: "tidak usah hapus filter -- pilih 'Semua' saja di select;
         card-nya cuma perlu Total COGS Bahan, Total Biaya Produksi, Total Ongkir, %HPP") -- tombol
         "Hapus filter" dilepas (dropdown sendiri sudah punya opsi "— Semua MRP —"), dan card
         Total FG/Total HPP/Total Harga Jual/Rata-rata HPP-pc dilepas juga (angka Total Harga Jual
         tetap dipakai internal untuk hitung %HPP di bawah, cuma tidak lagi ditampilkan sendiri). */}
      <div className="grid grid-cols-4 gap-3.5">
        <KpiCard label="Total biaya produksi" value={formatRupiah(totalBiayaProduksi)} sub="maklon + denda/reward" accent="orange" />
        <KpiCard label="Total COGS bahan" value={formatRupiah(totalCogsBahan)} accent="teal" />
        <KpiCard label="Total ongkir" value={formatRupiah(totalOngkir)} sub="otomatis" accent="blue" />
        {/* Item revisi 2026-09-18 (xlsx sel H2 = F2/G2) -- %HPP = Total Hpp / Total Harga, DIHITUNG
           GABUNGAN (bukan rata-rata persentase per item) -- lihat catatan hppPercentAgg di atas. */}
        <KpiCard label="HPP (%)" value={hppPercentAgg != null ? hppPercentAgg.toFixed(1) + "%" : "—"} sub="Total HPP / Total Harga Jual" accent="success" />
      </div>

      <div className="overflow-hidden border border-border-subtle bg-surface-card">
        <div className="border-b border-border-subtle px-4 py-3">
          <div className="font-sans text-[13px] font-semibold text-text-primary">Laporan HPP per MRP</div>
          <div className="font-sans text-[11.5px] text-text-muted">Klik baris No. MRP untuk pilih vendor produksi, lalu lihat rincian per item.</div>
        </div>
        {mrpRowsSorted.length === 0 && (
          <div className="px-5 py-8 text-center font-sans text-xs text-text-muted">Belum ada data HPP — buat invoice vendor dulu di halaman Invoice Vendor.</div>
        )}
        {mrpRowsSorted.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b-2 border-accent-blue bg-info-bg font-sans text-[10.5px] font-medium uppercase tracking-wider text-info-fg">
                  <th className="px-5 py-[9px] text-left">No MRP / Vendor Produksi</th>
                  <th className="px-3 py-[9px] text-right">Total FG</th>
                  <th className="px-3 py-[9px] text-right">Rata-rata HPP/pc</th>
                  <th className="px-3 py-[9px] text-right">Total Biaya Produksi</th>
                  <th className="px-3 py-[9px] text-right">Total COGS Bahan</th>
                  <th className="px-3 py-[9px] text-right">Total Ongkir</th>
                  <th className="px-3 py-[9px] text-left">Laporan</th>
                </tr>
              </thead>
              <tbody>
                {mrpRowsSorted.map((m) => {
                  const mrpActive = expandedMrpHpp === m.mrpId;
                  const vendorsSorted = [...m.vendors].sort((a, b) => (a.vendorLabel < b.vendorLabel ? -1 : a.vendorLabel > b.vendorLabel ? 1 : 0));
                  return (
                    <Fragment key={m.mrpId}>
                      <tr
                        onClick={() => {
                          const next = mrpActive ? null : m.mrpId;
                          setExpandedMrpHpp(next);
                          setExpandedVendorHpp(null);
                        }}
                        className={"cursor-pointer border-b border-[#F1F4F7] font-sans text-xs text-[#31414F] hover:bg-[#FAFBFC] " + (mrpActive ? "bg-info-bg" : "")}
                      >
                        <td className="px-5 py-[11px]">
                          <span className="mr-1.5 text-text-muted">{mrpActive ? "▾" : "▸"}</span>
                          <span className="font-mono font-semibold text-text-primary">{m.mrpLabel || m.mrpId}</span>
                          <span className="ml-1.5 font-sans text-[10.5px] text-text-muted">{m.vendors.length} vendor</span>
                        </td>
                        <td className="px-3 py-[11px] text-right font-mono tabular-nums">{formatPcs(m.totalFg)}</td>
                        <td className="px-3 py-[11px] text-right font-mono tabular-nums">{formatRupiah(m.avgHpp)}</td>
                        <td className="px-3 py-[11px] text-right font-mono tabular-nums">{formatRupiah(m.totalBiayaProduksi)}</td>
                        <td className="px-3 py-[11px] text-right font-mono tabular-nums">{formatRupiah(m.totalCogsBahan)}</td>
                        <td className="px-3 py-[11px] text-right font-mono tabular-nums">{formatRupiah(m.totalOngkir)}</td>
                        <td className="px-3 py-[11px]">
                          <span onClick={(e) => e.stopPropagation()}>
                            <Button onClick={() => downloadMrpHpp(m)} variant="ghost" size="xs">
                              Download
                            </Button>
                          </span>
                        </td>
                      </tr>
                      {mrpActive &&
                        vendorsSorted.map((v) => {
                          const vendorKey = `${m.mrpId}::${v.vendorProduksi}`;
                          const vendorActive = expandedVendorHpp === vendorKey;
                          return (
                            <Fragment key={vendorKey}>
                              <tr
                                onClick={() => setExpandedVendorHpp(vendorActive ? null : vendorKey)}
                                className={"cursor-pointer border-b border-[#F1F4F7] bg-[#FBFCFD] font-sans text-[11.5px] text-[#31414F] hover:bg-[#F2F5F8] " + (vendorActive ? "bg-info-bg" : "")}
                              >
                                <td className="py-[10px] pl-10 pr-3">
                                  <span className="mr-1.5 text-text-muted">{vendorActive ? "▾" : "▸"}</span>
                                  <span className="font-medium text-text-primary">{v.vendorLabel}</span>
                                </td>
                                <td className="px-3 py-[10px] text-right font-mono tabular-nums">{formatPcs(v.totalFg)}</td>
                                <td className="px-3 py-[10px] text-right font-mono tabular-nums">{formatRupiah(v.avgHpp)}</td>
                                <td className="px-3 py-[10px] text-right font-mono tabular-nums">{formatRupiah(v.totalBiayaProduksi)}</td>
                                <td className="px-3 py-[10px] text-right font-mono tabular-nums">{formatRupiah(v.totalCogsBahan)}</td>
                                <td className="px-3 py-[10px] text-right font-mono tabular-nums">{formatRupiah(v.totalOngkir)}</td>
                                <td className="px-3 py-[10px]" />
                              </tr>
                              {vendorActive && (
                                <tr>
                                  <td colSpan={7} className="border-b border-[#F1F4F7] bg-white px-4 py-3 pl-10">
                                    <MrpHppDetailTable rows={v.itemRows} />
                                  </td>
                                </tr>
                              )}
                            </Fragment>
                          );
                        })}
                      {mrpActive && vendorsSorted.length === 0 && (
                        <tr>
                          <td colSpan={7} className="border-b border-[#F1F4F7] bg-white px-5 py-4 pl-10 font-sans text-[11.5px] text-text-muted">
                            Belum ada vendor untuk MRP ini.
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </AppShell>
  );
}
