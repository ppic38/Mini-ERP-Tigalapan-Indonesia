"use client";

import { useEffect, useMemo, useState } from "react";
import { buildHppReport, buildHppTableLines } from "@/lib/mrp/hppReport";
import { exportHppExcel } from "@/lib/mrp/exportHppExcel";
import { AppShell } from "@/components/shell/app-shell";
import { KpiCard } from "@/components/ui/kpi-card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { StatusPill } from "@/components/ui/status-pill";
import { useMrpStore } from "@/lib/mrp/store";
import { formatPcs, formatRupiah, hppRowsForInvoicePerRoll, type HppRow } from "@/lib/mrp/derive";
import { VENDOR_PRODUKSI } from "@/lib/mrp/seed";
import type { DeliveryKoli } from "@/lib/mrp/types";

/** Baris HPP per roll/koli dari mesin HPP, ditambah info koli asal (dihitung SEKALI saat membangun `rows` supaya tabel dan unduhan Excel memakai nilai yang sama persis). */
type HppTableRow = HppRow & { rowId: string; tanggalKirim?: string; noResi?: string; ekspedisi?: string; wmsReceivedAt?: string };

const vendorName = (key: string) => VENDOR_PRODUKSI[key]?.name ?? key;
const lenganLabel = (l: string) => (l === "PENDEK" ? "Pendek" : "Panjang");
const statusOf = (r: HppRow) => (r.sementara ? "On Going" : "Final");
const byText = (a: string, b: string) => a.localeCompare(b, "id-ID", { numeric: true });

/** Header kolom yang bisa difilter (klik judul kolom -> daftar nilai, boleh pilih lebih dari satu; kosong = semua). */
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
          <div className="absolute left-0 top-full z-30 mt-1 flex max-h-72 w-60 flex-col overflow-hidden rounded-md border border-border-subtle bg-white text-left shadow-[0_8px_20px_rgba(11,19,27,.15)]">
            <div className="flex items-center justify-between border-b border-[#F1F4F7] px-2 py-1.5">
              <button type="button" onClick={() => onChange(new Set(options))} className="font-sans text-[10.5px] font-semibold normal-case tracking-normal text-action-primary">
                Pilih semua
              </button>
              <button type="button" onClick={() => onChange(new Set())} className="font-sans text-[10.5px] font-semibold normal-case tracking-normal text-action-primary">
                Kosongkan
              </button>
            </div>
            <div className="overflow-y-auto p-1">
              {options.map((o) => (
                <label key={o} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-left normal-case tracking-normal hover:bg-[#F7F9FB]">
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

  // Filter tabel (klik judul kolom). Kosong = semua. Kartu di atas dan tabel selalu memakai filter yang sama.
  const [mrpFilter, setMrpFilter] = useState<Set<string>>(new Set());
  const [vendorFilter, setVendorFilter] = useState<Set<string>>(new Set());
  const [statusFilter, setStatusFilter] = useState<Set<string>>(new Set());
  const [warnaFilter, setWarnaFilter] = useState<Set<string>>(new Set());
  const [lenganFilter, setLenganFilter] = useState<Set<string>>(new Set());
  const [sizeFilter, setSizeFilter] = useState<Set<string>>(new Set());
  const [downloadOpen, setDownloadOpen] = useState(false);

  // Seluruh hitungan HPP (per roll, per invoice) berat: di-memo supaya tidak diulang tiap render (ganti filter dst.), hanya saat data berubah.
  const rows = useMemo(() => {
    // Invoice REVISION belum final (masih diperbaiki vendor) jadi tidak diikutkan hitung HPP.
    const relevantInvoices = vendorInvoices.filter((i) => i.status !== "REVISION");
    const kolisById = new Map<string, DeliveryKoli>(deliveryKolis.map((k) => [k.id, k]));
    const out: HppTableRow[] = relevantInvoices.flatMap((inv) =>
      hppRowsForInvoicePerRoll(inv, relevantInvoices, mrpDetails, staticMrps, productionBatches, productionResults, productionGroupMeta, rawInvoices, deliveryKolis, ekspedisiRates, itemSellingPrices).map((r, i) => {
        const koli = r.koliId ? kolisById.get(r.koliId) : undefined;
        return { ...r, rowId: inv.id + "-" + i, tanggalKirim: koli?.deliveredAt, noResi: koli?.noResi, ekspedisi: koli?.ekspedisi, wmsReceivedAt: koli?.wmsReceivedAt };
      })
    );
    return out.filter((r) => r.fg > 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vendorInvoices, mrpDetails, staticMrps, productionBatches, productionResults, productionGroupMeta, rawInvoices, deliveryKolis, ekspedisiRates, itemSellingPrices, warnaAliases]);

  const options = useMemo(() => {
    const uniq = (xs: string[]) => Array.from(new Set(xs));
    return {
      mrp: uniq(rows.map((r) => r.mrpId)).sort((a, b) => byText(b, a)),
      vendor: uniq(rows.map((r) => vendorName(r.vendorProduksi))).sort(byText),
      status: ["On Going", "Final"],
      warna: uniq(rows.map((r) => r.warna)).sort(byText),
      lengan: uniq(rows.map((r) => lenganLabel(r.lengan))).sort(byText),
      size: uniq(rows.map((r) => r.size ?? "")).filter(Boolean).sort(byText),
    };
  }, [rows]);

  const filteredRows = useMemo(
    () =>
      rows.filter(
        (r) =>
          (mrpFilter.size === 0 || mrpFilter.has(r.mrpId)) &&
          (vendorFilter.size === 0 || vendorFilter.has(vendorName(r.vendorProduksi))) &&
          (statusFilter.size === 0 || statusFilter.has(statusOf(r))) &&
          (warnaFilter.size === 0 || warnaFilter.has(r.warna)) &&
          (lenganFilter.size === 0 || lenganFilter.has(lenganLabel(r.lengan))) &&
          (sizeFilter.size === 0 || sizeFilter.has(r.size ?? ""))
      ),
    [rows, mrpFilter, vendorFilter, statusFilter, warnaFilter, lenganFilter, sizeFilter]
  );

  // Tabel = sheet "HPP" di unduhan: satu baris per warna · lengan · size, rata-rata tertimbang (bobot Qty FG) dari semua roll, koli, resi, dan vendor.
  const lines = useMemo(() => {
    const rank = (s: string) => (s === "On Going" ? 0 : 1);
    return buildHppTableLines(filteredRows).sort(
      (a, b) =>
        byText(b.mrpId, a.mrpId) ||
        rank(a.status) - rank(b.status) ||
        byText(a.warna, b.warna) ||
        (a.lengan === b.lengan ? 0 : a.lengan === "PENDEK" ? -1 : 1) ||
        byText(a.size, b.size)
    );
  }, [filteredRows]);

  if (!mounted) return null;

  const hasFilter = [mrpFilter, vendorFilter, statusFilter, warnaFilter, lenganFilter, sizeFilter].some((f) => f.size > 0);
  function clearFilters() {
    setMrpFilter(new Set());
    setVendorFilter(new Set());
    setStatusFilter(new Set());
    setWarnaFilter(new Set());
    setLenganFilter(new Set());
    setSizeFilter(new Set());
  }

  // Kartu mengikuti filter tabel. %HPP = Total HPP / Total Harga Jual gabungan (bukan rata-rata persentase per item); item tanpa harga jual
  // dikeluarkan dari dua sisi supaya %HPP tidak bias.
  const totalBiayaProduksi = filteredRows.reduce((s, r) => s + r.biayaProduksiTotal, 0);
  const totalCogsBahan = filteredRows.reduce((s, r) => s + r.cogsBahan, 0);
  const totalOngkir = filteredRows.reduce((s, r) => s + r.totalOngkirRow, 0);
  const nSementara = filteredRows.filter((r) => r.sementara).length;
  const hppPercentAgg = hppPercentOf(filteredRows);

  const totalFg = lines.reduce((s, l) => s + l.fg, 0);
  const totalHpp = lines.reduce((s, l) => s + l.totalHpp, 0);
  const avgHpp = totalFg > 0 ? totalHpp / totalFg : 0;
  const downloadDefaultMrp = mrpFilter.size === 1 ? Array.from(mrpFilter)[0] : "";

  return (
    <AppShell role={role} activeHref={activeHref} breadcrumb={["Dashboard", "Laporan HPP"]} title="Laporan HPP">
      <div className="grid grid-cols-4 gap-3.5">
        <KpiCard label="Total biaya produksi" value={formatRupiah(totalBiayaProduksi)} sub="maklon + denda/reward" accent="orange" />
        <KpiCard label="Total COGS bahan" value={formatRupiah(totalCogsBahan)} accent="teal" />
        <KpiCard label="Total ongkir" value={formatRupiah(totalOngkir)} sub="otomatis" accent="blue" />
        <KpiCard label="HPP (%)" value={hppPercentAgg != null ? hppPercentAgg.toFixed(1) + "%" : "—"} sub={"Total HPP / Total Harga Jual" + (nSementara > 0 ? ` · ${nSementara} baris sementara` : "")} accent="success" />
      </div>

      <div className="overflow-hidden border border-border-subtle bg-surface-card">
        <div className="flex items-start justify-between gap-3 border-b border-border-subtle px-4 py-3">
          <div>
            <div className="font-sans text-[13px] font-semibold text-text-primary">Laporan HPP</div>
            <div className="font-sans text-[11.5px] text-text-muted">
              Satu baris per warna · lengan · size, sama seperti sheet HPP di unduhan. Klik judul kolom untuk memfilter; kartu di atas mengikuti filter.
            </div>
          </div>
          <Button onClick={() => setDownloadOpen(true)} variant="primary" size="md" disabled={rows.length === 0}>
            Download
          </Button>
        </div>
        {hasFilter && (
          <div className="flex items-center gap-2 border-b border-[#E4E9EE] bg-[#FAFBFC] px-4 py-1.5 font-sans text-[10.5px] text-text-muted">
            <span>
              {lines.length} baris · {formatPcs(totalFg)} pcs FG
            </span>
            <button type="button" onClick={clearFilters} className="font-semibold text-action-primary underline">
              ✕ Hapus semua filter
            </button>
          </div>
        )}
        {rows.length === 0 && <div className="px-5 py-8 text-center font-sans text-xs text-text-muted">Belum ada data HPP — buat invoice vendor dulu di halaman Invoice Vendor.</div>}
        {rows.length > 0 && (
          <div className="max-h-[70vh] min-h-[340px] overflow-auto">
            <table className="w-full min-w-[1750px] border-collapse">
              <thead className="sticky top-0 z-10">
                <tr className="border-b-2 border-accent-blue bg-info-bg font-sans text-[10px] font-semibold uppercase tracking-wider text-info-fg">
                  <FilterableTh label="Status" options={options.status} value={statusFilter} onChange={setStatusFilter} />
                  <FilterableTh label="No MRP" options={options.mrp} value={mrpFilter} onChange={setMrpFilter} />
                  <FilterableTh label="Warna" options={options.warna} value={warnaFilter} onChange={setWarnaFilter} />
                  <FilterableTh label="Lengan" options={options.lengan} value={lenganFilter} onChange={setLenganFilter} />
                  <FilterableTh label="Size" options={options.size} value={sizeFilter} onChange={setSizeFilter} />
                  <FilterableTh label="Vendor" options={options.vendor} value={vendorFilter} onChange={setVendorFilter} />
                  <th className="px-3 py-2 text-right">Qty FG</th>
                  <th className="px-3 py-2 text-right">Bahan/pcs</th>
                  <th className="px-3 py-2 text-right">Rib/pcs</th>
                  <th className="px-3 py-2 text-right">COGS Bahan/pcs</th>
                  <th className="px-3 py-2 text-right">Maklon/pcs</th>
                  <th className="px-3 py-2 text-right">Ongkir/pcs</th>
                  <th className="px-3 py-2 text-right">HPP/pcs</th>
                  <th className="px-3 py-2 text-right">HPP Min</th>
                  <th className="px-3 py-2 text-right">HPP Maks</th>
                  <th className="px-3 py-2 text-right">Harga Jual</th>
                  <th className="px-3 py-2 text-right">Ratio HPP</th>
                  <th className="px-3 py-2 text-right">Total HPP</th>
                  <th className="px-3 py-2 text-right">Roll</th>
                  <th className="px-3 py-2 text-right">Resi</th>
                </tr>
              </thead>
              <tbody>
                {lines.length === 0 && (
                  <tr>
                    <td colSpan={20} className="px-3 py-8 text-center font-sans text-[11.5px] text-text-muted">
                      Tidak ada baris yang cocok dengan filter.
                    </td>
                  </tr>
                )}
                {lines.map((l) => (
                  <tr key={l.mrpId + "|" + l.status + "|" + l.warna + "|" + l.lengan + "|" + l.size} className="border-b border-[#EEF1F4] font-sans text-[11.5px] text-[#31414F] hover:bg-[#FAFBFC]">
                    <td className="px-3 py-1.5">
                      <StatusPill tone={l.status === "On Going" ? "warning" : "success"}>{l.status === "On Going" ? "ON GOING" : "FINAL"}</StatusPill>
                    </td>
                    <td className="px-3 py-1.5 font-mono text-text-muted">{l.mrpId}</td>
                    <td className="px-3 py-1.5">{l.warna}</td>
                    <td className="px-3 py-1.5">{lenganLabel(l.lengan)}</td>
                    <td className="px-3 py-1.5">{l.size}</td>
                    <td className="px-3 py-1.5">{l.vendors.map(vendorName).join(", ")}</td>
                    <td className="px-3 py-1.5 text-right font-mono tabular-nums">{formatPcs(l.fg)}</td>
                    <td className="px-3 py-1.5 text-right font-mono tabular-nums">{formatRupiah(l.bahanPcs)}</td>
                    <td className="px-3 py-1.5 text-right font-mono tabular-nums">{formatRupiah(l.ribPcs)}</td>
                    <td className="px-3 py-1.5 text-right font-mono tabular-nums">{formatRupiah(l.cogsBahanPcs)}</td>
                    <td className="px-3 py-1.5 text-right font-mono tabular-nums">{formatRupiah(l.maklonPcs)}</td>
                    <td className="px-3 py-1.5 text-right font-mono tabular-nums">{formatRupiah(l.ongkirPcs)}</td>
                    <td className="px-3 py-1.5 text-right font-mono font-semibold tabular-nums text-text-primary">{formatRupiah(l.hppPcs)}</td>
                    <td className="px-3 py-1.5 text-right font-mono tabular-nums text-text-muted">{formatRupiah(l.hppMin)}</td>
                    <td className="px-3 py-1.5 text-right font-mono tabular-nums text-text-muted">{formatRupiah(l.hppMax)}</td>
                    <td className="px-3 py-1.5 text-right font-mono tabular-nums">{l.hargaJual != null ? formatRupiah(l.hargaJual) : "—"}</td>
                    <td className="px-3 py-1.5 text-right font-mono tabular-nums">{l.ratio != null ? (l.ratio * 100).toFixed(1) + "%" : "—"}</td>
                    <td className="px-3 py-1.5 text-right font-mono tabular-nums">{formatRupiah(l.totalHpp)}</td>
                    <td className="px-3 py-1.5 text-right font-mono tabular-nums">{l.jumlahRoll}</td>
                    <td className="px-3 py-1.5 text-right font-mono tabular-nums">{l.jumlahResi}</td>
                  </tr>
                ))}
              </tbody>
              {lines.length > 0 && (
                <tfoot className="sticky bottom-0">
                  <tr className="border-t-2 border-accent-blue bg-info-bg font-sans text-[11.5px] font-semibold text-text-primary">
                    <td colSpan={6} className="px-3 py-2 text-right">
                      Total ({lines.length} baris)
                    </td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">{formatPcs(totalFg)}</td>
                    <td colSpan={5} />
                    <td className="px-3 py-2 text-right font-mono tabular-nums">{formatRupiah(avgHpp)}</td>
                    <td colSpan={3} />
                    <td className="px-3 py-2 text-right font-mono tabular-nums">{pctLabel(hppPercentAgg)}</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">{formatRupiah(totalHpp)}</td>
                    <td colSpan={2} />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        )}
      </div>

      {downloadOpen && <DownloadHppDialog rows={rows} defaultMrp={downloadDefaultMrp} onClose={() => setDownloadOpen(false)} />}
    </AppShell>
  );
}
