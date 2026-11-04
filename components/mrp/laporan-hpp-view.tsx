"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { buildHppReport, buildHppTableLines } from "@/lib/mrp/hppReport";
import { exportHppExcel } from "@/lib/mrp/exportHppExcel";
import { AppShell } from "@/components/shell/app-shell";
import { KpiCard } from "@/components/ui/kpi-card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { MultiSelectFilter } from "@/components/mrp/multi-select-filter";
import { StatusPill } from "@/components/ui/status-pill";
import { useMrpStore } from "@/lib/mrp/store";
import { formatPcs, formatRupiah, hppRowsForInvoicePerRoll, type HppRow } from "@/lib/mrp/derive";
import { VENDOR_PRODUKSI } from "@/lib/mrp/seed";
import type { DeliveryKoli } from "@/lib/mrp/types";

/** Item 2026-09-11 (user-reported: "Batch koli" cuma label bebas yang diketik vendor, TIDAK
 *  dijamin unik -- kalau 2 koli FISIK berbeda kebetulan/sengaja dinamai sama, mis. "1", 2 baris
 *  breakdown ini kelihatan seperti duplikat padahal itu 2 pengiriman beda tanggal/resi). Tambah
 *  `tanggalKirim`/`noResi` (lookup `koliId` -> DeliveryKoli, dihitung SEKALI saat membangun `rows`
 *  supaya tabel & export Excel pakai nilai yang sama persis) supaya 2 baris begitu tetap bisa
 *  dibedakan tanpa pindah ke halaman Payment Maklon > Lampiran ekspedisi. */
type HppTableRow = HppRow & { rowId: string; tanggalKirim?: string; noResi?: string; ekspedisi?: string; wmsReceivedAt?: string };

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

const vendorName = (key: string) => VENDOR_PRODUKSI[key]?.name ?? key;
const lenganLabel = (l: string) => (l === "PENDEK" ? "Pendek" : "Panjang");
const statusOf = (r: HppRow) => (r.sementara ? "On Going" : "Final");
const byText = (a: string, b: string) => a.localeCompare(b, "id-ID", { numeric: true });

/** Tabel setelah memilih vendor = sheet "HPP" di unduhan untuk vendor itu: satu baris per warna · lengan · size, rata-rata tertimbang (bobot Qty FG)
 *  dari semua roll, koli, dan resi. Judul kolom Status/Warna/Lengan/Size bisa difilter; rata-rata dan baris Total dihitung ulang dari baris yang lolos filter. */
function VendorHppTable({ rows }: { rows: HppTableRow[] }) {
  const [statusFilter, setStatusFilter] = useState<Set<string>>(new Set());
  const [warnaFilter, setWarnaFilter] = useState<Set<string>>(new Set());
  const [lenganFilter, setLenganFilter] = useState<Set<string>>(new Set());
  const [sizeFilter, setSizeFilter] = useState<Set<string>>(new Set());
  const uniq = (xs: string[]) => Array.from(new Set(xs));
  const warnaOptions = uniq(rows.map((r) => r.warna)).sort(byText);
  const lenganOptions = uniq(rows.map((r) => lenganLabel(r.lengan))).sort(byText);
  const sizeOptions = uniq(rows.map((r) => r.size ?? "")).filter(Boolean).sort(byText);
  const filteredRows = rows.filter(
    (r) =>
      r.fg > 0 &&
      (statusFilter.size === 0 || statusFilter.has(statusOf(r))) &&
      (warnaFilter.size === 0 || warnaFilter.has(r.warna)) &&
      (lenganFilter.size === 0 || lenganFilter.has(lenganLabel(r.lengan))) &&
      (sizeFilter.size === 0 || sizeFilter.has(r.size ?? ""))
  );
  const rank = (s: string) => (s === "On Going" ? 0 : 1);
  const lines = buildHppTableLines(filteredRows).sort(
    (a, b) => rank(a.status) - rank(b.status) || byText(a.warna, b.warna) || (a.lengan === b.lengan ? 0 : a.lengan === "PENDEK" ? -1 : 1) || byText(a.size, b.size)
  );
  const hasFilter = statusFilter.size > 0 || warnaFilter.size > 0 || lenganFilter.size > 0 || sizeFilter.size > 0;
  const totalFg = lines.reduce((s, l) => s + l.fg, 0);
  const totalHpp = lines.reduce((s, l) => s + l.totalHpp, 0);
  return (
    <div className="overflow-hidden rounded-md border border-[#E4E9EE] bg-white">
      <div className="flex flex-wrap items-center gap-2 border-b border-[#E4E9EE] bg-[#FAFBFC] px-4 py-2.5">
        <MultiSelectFilter label="Status" options={["On Going", "Final"]} value={Array.from(statusFilter)} onChange={(v) => setStatusFilter(new Set(v))} />
        <MultiSelectFilter label="Warna" options={warnaOptions} value={Array.from(warnaFilter)} onChange={(v) => setWarnaFilter(new Set(v))} />
        <MultiSelectFilter label="Lengan" options={lenganOptions} value={Array.from(lenganFilter)} onChange={(v) => setLenganFilter(new Set(v))} />
        <MultiSelectFilter label="Size" options={sizeOptions} value={Array.from(sizeFilter)} onChange={(v) => setSizeFilter(new Set(v))} />
        {hasFilter && (
          <>
            <span className="font-sans text-[10.5px] text-text-muted">
              {lines.length} baris · {formatPcs(totalFg)} pcs FG
            </span>
            <button
              type="button"
              onClick={() => {
                setStatusFilter(new Set());
                setWarnaFilter(new Set());
                setLenganFilter(new Set());
                setSizeFilter(new Set());
              }}
              className="font-sans text-[10.5px] font-semibold text-action-primary underline"
            >
              ✕ Hapus semua filter
            </button>
          </>
        )}
      </div>
      <div className="max-h-[60vh] overflow-auto">
        <table className="w-full min-w-[1100px] border-collapse">
          <thead className="sticky top-0 z-10">
            <tr className="border-b border-[#E4E9EE] bg-[#F2F5F8] font-sans text-[10px] font-semibold uppercase tracking-wider text-text-muted">
              <th className="px-3 py-2 text-left">Status</th>
              <th className="px-3 py-2 text-left">Warna</th>
              <th className="px-3 py-2 text-left">Lengan</th>
              <th className="px-3 py-2 text-left">Size</th>
              <th className="px-3 py-2 text-right">Qty FG</th>
              <th className="px-3 py-2 text-right">Bahan/pcs</th>
              <th className="px-3 py-2 text-right">Rib/pcs</th>
              <th className="px-3 py-2 text-right">COGS Bahan/pcs</th>
              <th className="px-3 py-2 text-right">Maklon/pcs</th>
              <th className="px-3 py-2 text-right">Ongkir/pcs</th>
              <th className="px-3 py-2 text-right">HPP/pcs</th>
              <th className="px-3 py-2 text-right">Harga Jual</th>
              <th className="px-3 py-2 text-right">Ratio HPP</th>
            </tr>
          </thead>
          <tbody>
            {lines.length === 0 && (
              <tr>
                <td colSpan={13} className="px-3 py-6 text-center font-sans text-[11.5px] text-text-muted">
                  Tidak ada baris yang cocok dengan filter.
                </td>
              </tr>
            )}
            {lines.map((l) => (
              <tr key={l.status + "|" + l.warna + "|" + l.lengan + "|" + l.size} className="border-b border-[#EEF1F4] font-sans text-[11.5px] text-[#31414F] last:border-b-0 hover:bg-[#FAFBFC]">
                <td className="px-3 py-1.5">
                  <StatusPill tone={l.status === "On Going" ? "warning" : "success"}>{l.status === "On Going" ? "ON GOING" : "FINAL"}</StatusPill>
                </td>
                <td className="px-3 py-1.5">{l.warna}</td>
                <td className="px-3 py-1.5">{lenganLabel(l.lengan)}</td>
                <td className="px-3 py-1.5">{l.size}</td>
                <td className="px-3 py-1.5 text-right font-mono tabular-nums">{formatPcs(l.fg)}</td>
                <td className="px-3 py-1.5 text-right font-mono tabular-nums">{formatRupiah(l.bahanPcs)}</td>
                <td className="px-3 py-1.5 text-right font-mono tabular-nums">{formatRupiah(l.ribPcs)}</td>
                <td className="px-3 py-1.5 text-right font-mono tabular-nums">{formatRupiah(l.cogsBahanPcs)}</td>
                <td className="px-3 py-1.5 text-right font-mono tabular-nums">{formatRupiah(l.maklonPcs)}</td>
                <td className="px-3 py-1.5 text-right font-mono tabular-nums">{formatRupiah(l.ongkirPcs)}</td>
                <td className="px-3 py-1.5 text-right font-mono font-semibold tabular-nums text-text-primary">{formatRupiah(l.hppPcs)}</td>
                <td className="px-3 py-1.5 text-right font-mono tabular-nums">{l.hargaJual != null ? formatRupiah(l.hargaJual) : "—"}</td>
                <td className="px-3 py-1.5 text-right font-mono tabular-nums">{l.ratio != null ? (l.ratio * 100).toFixed(1) + "%" : "—"}</td>
              </tr>
            ))}
          </tbody>
          {lines.length > 0 && (
            <tfoot className="sticky bottom-0">
              <tr className="border-t-2 border-accent-blue bg-info-bg font-sans text-[11.5px] font-semibold text-text-primary">
                <td colSpan={4} className="px-3 py-2 text-right">
                  Total ({lines.length} baris)
                </td>
                <td className="px-3 py-2 text-right font-mono tabular-nums">{formatPcs(totalFg)}</td>
                <td colSpan={5} />
                <td className="px-3 py-2 text-right font-mono tabular-nums">{formatRupiah(totalFg > 0 ? totalHpp / totalFg : 0)}</td>
                <td />
                <td className="px-3 py-2 text-right font-mono tabular-nums">{pctLabel(hppPercentOf(filteredRows))}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}

/** % HPP = Total HPP / Total Harga Jual (rumus sama dengan kartu HPP (%) di atas): baris tanpa harga jual dikeluarkan dari dua sisi. null kalau tidak ada harga jual. */
const pctLabel = (p: number | null) => (p == null ? "—" : p.toFixed(1) + "%");

function hppPercentOf(rows: HppRow[]): number | null {
  const priced = rows.filter((r) => r.sellingPricePerItem != null && r.sellingPricePerItem > 0);
  const jual = priced.reduce((s, r) => s + (r.sellingPricePerItem as number) * r.fg, 0);
  return jual > 0 ? (priced.reduce((s, r) => s + r.hppPerItem * r.fg, 0) / jual) * 100 : null;
}

/** Popup Download: pilih MRP, lalu semua vendor atau hanya vendor tertentu. File yang diunduh = unduhan HPP per MRP (3 sheet: HPP, Detail Roll, Validasi)
 *  yang hanya memuat vendor terpilih; rata-rata tertimbang dan validasi dihitung dari vendor terpilih saja. */
function DownloadHppDialog({ rows, defaultMrp, onClose }: { rows: HppTableRow[]; defaultMrp: string; onClose: () => void }) {
  const mrpIds = useMemo(() => Array.from(new Set(rows.map((r) => r.mrpId))).sort((a, b) => byText(b, a)), [rows]);
  const [mrpId, setMrpId] = useState(mrpIds.includes(defaultMrp) ? defaultMrp : (mrpIds[0] ?? ""));
  const vendors = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) if (r.mrpId === mrpId) m.set(r.vendorProduksi, (m.get(r.vendorProduksi) ?? 0) + r.fg);
    return Array.from(m.entries())
      .map(([key, fg]) => ({ key, label: vendorName(key), fg }))
      .sort((a, b) => byText(a.label, b.label));
  }, [rows, mrpId]);
  // Kosong = belum dipilih apa pun; pilihan awal setiap ganti MRP = semua vendor.
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  const [pickedFor, setPickedFor] = useState("");
  const selected = pickedFor === mrpId ? picked : new Set(vendors.map((v) => v.key));
  const allSelected = selected.size === vendors.length && vendors.length > 0;
  const [busy, setBusy] = useState(false);

  function setSelection(next: Set<string>) {
    setPicked(next);
    setPickedFor(mrpId);
  }
  function toggleVendor(key: string) {
    const next = new Set(selected);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setSelection(next);
  }
  async function download() {
    const chosen = vendors.filter((v) => selected.has(v.key));
    if (chosen.length === 0) return;
    setBusy(true);
    try {
      const scoped = rows.filter((r) => r.mrpId === mrpId && selected.has(r.vendorProduksi));
      const suffix = allSelected ? "" : "-" + chosen.map((v) => v.label.replace(/\s+/g, "")).join("+");
      await exportHppExcel(mrpId, buildHppReport(scoped), `HPP-${mrpId}${suffix}.xlsx`);
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0B131B]/45 p-4" onClick={onClose}>
      <div className="w-full max-w-[460px] overflow-hidden rounded-[9px] bg-surface-card shadow-[0_12px_32px_rgba(11,19,27,.28)]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2.5 bg-info-bg px-5 py-3">
          <span className="h-2 w-2 rounded-full bg-accent-blue" />
          <span className="font-sans text-xs font-semibold text-info-fg">Download Laporan HPP</span>
        </div>
        <div className="px-5 py-4">
          <label className="block font-sans text-[11px] font-medium uppercase tracking-wider text-text-muted">No. MRP</label>
          <select
            value={mrpId}
            onChange={(e) => setMrpId(e.target.value)}
            className="mt-1 w-full rounded-md border border-[#DDE4EB] px-[11px] py-[9px] font-sans text-[12.5px] font-medium text-text-primary"
          >
            {mrpIds.map((id) => (
              <option key={id} value={id}>
                {id}
              </option>
            ))}
          </select>

          <div className="mt-4 flex items-center justify-between">
            <span className="font-sans text-[11px] font-medium uppercase tracking-wider text-text-muted">Vendor produksi</span>
            <span className="font-sans text-[10.5px] text-text-muted">
              {selected.size} dari {vendors.length} dipilih
            </span>
          </div>
          <div className="mt-1.5 rounded-md border border-[#DDE4EB]">
            <label className="flex cursor-pointer items-center gap-2 border-b border-[#EEF1F4] bg-[#F7F9FB] px-3 py-2">
              <Checkbox checked={allSelected} onChange={() => setSelection(allSelected ? new Set() : new Set(vendors.map((v) => v.key)))} />
              <span className="font-sans text-[12px] font-semibold text-text-primary">Semua vendor</span>
            </label>
            <div className="max-h-56 overflow-y-auto">
              {vendors.map((v) => (
                <label key={v.key} className="flex cursor-pointer items-center gap-2 border-b border-[#EEF1F4] px-3 py-2 last:border-b-0 hover:bg-[#FAFBFC]">
                  <Checkbox checked={selected.has(v.key)} onChange={() => toggleVendor(v.key)} />
                  <span className="flex-1 font-sans text-[12px] font-medium text-[#31414F]">{v.label}</span>
                  <span className="font-mono text-[11px] text-text-muted">{formatPcs(v.fg)} pcs FG</span>
                </label>
              ))}
              {vendors.length === 0 && <div className="px-3 py-4 text-center font-sans text-[11.5px] text-text-muted">Belum ada data HPP untuk MRP ini.</div>}
            </div>
          </div>
          <p className="mt-2 font-sans text-[10.5px] text-text-muted">File berisi sheet HPP, Detail Roll, dan Validasi untuk vendor yang dipilih saja.</p>
        </div>
        <div className="flex justify-end gap-2 border-t border-[#EEF1F4] px-5 py-3">
          <Button onClick={onClose} variant="ghost" size="md">
            Batal
          </Button>
          <Button onClick={() => void download()} variant="primary" size="md" disabled={busy || selected.size === 0}>
            {busy ? "Menyiapkan…" : "Download"}
          </Button>
        </div>
      </div>
    </div>
  );
}

/** Isi halaman Laporan HPP, dipakai Finance (/finance/laporan-hpp) dan SCM (/scm/laporan-hpp): data dan perhitungan sama, hanya shell/menu yang beda. */
export function LaporanHppView({ role, activeHref }: { role: "finance" | "scm"; activeHref: string }) {
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
  // Hanya dipakai sebagai penanda perubahan: Mapping Warna dibaca `sellingPriceFor` lewat variabel modul yang diisi store sebelum state di-set.
  const warnaAliases = useMrpStore((s) => s.warnaAliases);

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
  const [downloadMrp, setDownloadMrp] = useState<string | null>(null);

  // Seluruh hitungan HPP (per roll, per invoice) berat: di-memo supaya tidak diulang tiap render (ganti filter, buka baris, dst.), hanya saat data berubah.
  const { rows, mrpRowsSorted } = useMemo(() => {
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
      return { ...r, rowId: inv.id + "-" + i, tanggalKirim: koli?.deliveredAt, noResi: koli?.noResi, ekspedisi: koli?.ekspedisi, wmsReceivedAt: koli?.wmsReceivedAt };
    })
  );


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
  return { rows, mrpRowsSorted };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vendorInvoices, mrpDetails, staticMrps, productionBatches, productionResults, productionGroupMeta, rawInvoices, deliveryKolis, ekspedisiRates, itemSellingPrices, warnaAliases]);

  if (!mounted) return null;

  // Item revisi 2026-09-18: KPI cards sekarang di-scope ke `cardRows` (bukan `rows` mentah lagi)
  // -- `cardRows` = seluruh baris kalau `hppMrpFilter` kosong (perilaku lama, semua MRP), atau
  // cuma baris MRP yang difilter.
  const cardRows = hppMrpFilter ? rows.filter((r) => r.mrpId === hppMrpFilter) : rows;
  const totalBiayaProduksi = cardRows.reduce((s, r) => s + r.biayaProduksiTotal, 0);
  const totalCogsBahan = cardRows.reduce((s, r) => s + r.cogsBahan, 0);
  const totalOngkir = cardRows.reduce((s, r) => s + r.totalOngkirRow, 0);
  const nSementara = cardRows.filter((r) => r.sementara).length;
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

  return (
    <AppShell
      role={role}
      activeHref={activeHref}
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
        <KpiCard label="HPP (%)" value={hppPercentAgg != null ? hppPercentAgg.toFixed(1) + "%" : "—"} sub={"Total HPP / Total Harga Jual" + (nSementara > 0 ? ` · ${nSementara} baris sementara` : "")} accent="success" />
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
                  <th className="px-3 py-[9px] text-right">% HPP</th>
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
                        <td className="px-3 py-[11px] text-right font-mono tabular-nums">{pctLabel(hppPercentOf(m.itemRows))}</td>
                        <td className="px-3 py-[11px]">
                          <span onClick={(e) => e.stopPropagation()}>
                            <Button onClick={() => setDownloadMrp(m.mrpId)} variant="ghost" size="xs">
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
                                <td className="px-3 py-[10px] text-right font-mono tabular-nums">{pctLabel(hppPercentOf(v.itemRows))}</td>
                                <td className="px-3 py-[10px]" />
                              </tr>
                              {vendorActive && (
                                <tr>
                                  <td colSpan={8} className="border-b border-[#F1F4F7] bg-white px-4 py-3 pl-10">
                                    <VendorHppTable rows={v.itemRows} />
                                  </td>
                                </tr>
                              )}
                            </Fragment>
                          );
                        })}
                      {mrpActive && vendorsSorted.length === 0 && (
                        <tr>
                          <td colSpan={8} className="border-b border-[#F1F4F7] bg-white px-5 py-4 pl-10 font-sans text-[11.5px] text-text-muted">
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
      {downloadMrp !== null && <DownloadHppDialog rows={rows} defaultMrp={downloadMrp} onClose={() => setDownloadMrp(null)} />}
    </AppShell>
  );
}
