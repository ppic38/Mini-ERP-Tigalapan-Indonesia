"use client";

import { useEffect, useMemo, useState } from "react";
import { buildHppReport } from "@/lib/mrp/hppReport";
import { exportHppExcel } from "@/lib/mrp/exportHppExcel";
import { AppShell } from "@/components/shell/app-shell";
import { KpiCard } from "@/components/ui/kpi-card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DataTable, aggSame, aggSum, type ColumnDef, type FilterDef } from "@/components/mrp/data-table";
import { HppTambahanDialog } from "@/components/mrp/hpp-tambahan-dialog";
import { StatusPill } from "@/components/ui/status-pill";
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
type HppTableRow = HppRow & { rowId: string; tanggalKirim?: string; noResi?: string; ekspedisi?: string; wmsReceivedAt?: string };

const vendorName = (key: string) => VENDOR_PRODUKSI[key]?.name ?? key;
const lenganLabel = (l: string) => (l === "PENDEK" ? "Pendek" : "Panjang");
const statusOf = (r: HppRow) => (r.sementara ? "On Going" : "Final");
const byText = (a: string, b: string) => a.localeCompare(b, "id-ID", { numeric: true });

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

  const [downloadMrp, setDownloadMrp] = useState<string | null>(null);
  const [tambahanOpen, setTambahanOpen] = useState(false);
  // Kartu mengikuti baris yang lolos filter tabel (pola Odoo / PPIC, owner 2026-11-16: filter MRP terpisah dihapus).
  const [shownIds, setShownIds] = useState<Set<string> | null>(null);

  // Seluruh hitungan HPP (per roll, per invoice) berat: di-memo, hanya dihitung ulang saat data berubah.
  const rows = useMemo(() => {
    // Invoice REVISION belum final (masih diperbaiki vendor) jadi tidak diikutkan hitung HPP.
    const relevantInvoices = vendorInvoices.filter((i) => i.status !== "REVISION");
    const kolisById = new Map<string, DeliveryKoli>(deliveryKolis.map((k) => [k.id, k]));
    return relevantInvoices.flatMap((inv) =>
      hppRowsForInvoicePerRoll(inv, relevantInvoices, mrpDetails, staticMrps, productionBatches, productionResults, productionGroupMeta, rawInvoices, deliveryKolis, ekspedisiRates, itemSellingPrices).map((r, i) => {
        const koli = r.koliId ? kolisById.get(r.koliId) : undefined;
        return { ...r, rowId: inv.id + "-" + i, tanggalKirim: koli?.deliveredAt, noResi: koli?.noResi, ekspedisi: koli?.ekspedisi, wmsReceivedAt: koli?.wmsReceivedAt } as HppTableRow;
      })
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vendorInvoices, mrpDetails, staticMrps, productionBatches, productionResults, productionGroupMeta, rawInvoices, deliveryKolis, ekspedisiRates, itemSellingPrices, warnaAliases]);

  if (!mounted) return null;

  // Baris tabel = baris HPP yang punya Finish Good (sama dengan sheet Detail Roll unduhan): roll x size x koli.
  const tableRows = rows.filter((r) => r.fg > 0);
  const cardRows = shownIds ? tableRows.filter((r) => shownIds.has(r.rowId)) : tableRows;
  const totalBiayaProduksi = cardRows.reduce((s, r) => s + r.biayaProduksiTotal, 0);
  const totalCogsBahan = cardRows.reduce((s, r) => s + r.cogsBahan, 0);
  const totalOngkir = cardRows.reduce((s, r) => s + r.totalOngkirRow, 0);
  const nSementara = cardRows.filter((r) => r.sementara).length;
  const hppPercentAgg = hppPercentOf(cardRows);

  const uniq = (xs: string[]) => Array.from(new Set(xs.filter(Boolean))).sort(byText);
  const fgSum = (list: HppTableRow[]) => list.reduce((s, r) => s + r.fg, 0);
  // Rata-rata tertimbang Qty FG untuk kolom per pcs di baris kelompok (sama dengan sheet HPP unduhan).
  // eslint-disable-next-line react/display-name
  const wavg = (get: (r: HppTableRow) => number) => (list: HppTableRow[]) => {
    const fg = fgSum(list);
    return <span className="font-semibold">{formatRupiah(fg > 0 ? list.reduce((s, r) => s + get(r) * r.fg, 0) / fg : 0)}</span>;
  };
  const money = (n: number) => <span className="font-mono">{formatRupiah(n)}</span>;
  const filterDefs: FilterDef<HppTableRow>[] = [
    { label: "No. MRP", options: uniq(tableRows.map((r) => r.mrpId)).reverse(), test: (r, v) => r.mrpId === v },
    { label: "Vendor", options: uniq(tableRows.map((r) => vendorName(r.vendorProduksi))), test: (r, v) => vendorName(r.vendorProduksi) === v },
    { label: "Status", options: ["On Going", "Final"], test: (r, v) => statusOf(r) === v },
    { label: "Warna", options: uniq(tableRows.map((r) => r.warna)), test: (r, v) => r.warna === v },
    { label: "Lengan", options: ["Pendek", "Panjang"], test: (r, v) => lenganLabel(r.lengan) === v },
    { label: "Size", options: uniq(tableRows.map((r) => r.size ?? "")), test: (r, v) => (r.size ?? "") === v },
    { label: "Bulan kirim", options: uniq(tableRows.map((r) => r.tanggalKirim?.slice(0, 7) ?? "")).reverse(), test: (r, v) => r.tanggalKirim?.slice(0, 7) === v },
    { label: "No Resi", options: uniq(tableRows.map((r) => r.noResi ?? "")), test: (r, v) => r.noResi === v },
  ];
  const columns: ColumnDef<HppTableRow>[] = [
    { key: "mrp", label: "No. MRP", default: false, aggregate: aggSame((r) => r.mrpId), render: (r) => <span className="font-mono">{r.mrpId}</span> },
    { key: "vendor", label: "Vendor", default: false, aggregate: aggSame((r) => vendorName(r.vendorProduksi)), render: (r) => vendorName(r.vendorProduksi) },
    { key: "lengan", label: "Lengan", default: true, aggregate: aggSame((r) => lenganLabel(r.lengan)), render: (r) => lenganLabel(r.lengan) },
    { key: "size", label: "Size", default: true, aggregate: aggSame((r) => r.size ?? ""), render: (r) => r.size },
    { key: "roll", label: "Code Roll", default: false, render: (r) => <span className="font-mono">{r.rollCode || "—"}</span> },
    { key: "koli", label: "No Koli", default: false, render: (r) => <span className="font-mono">{r.noKoli || "—"}</span> },
    { key: "resi", label: "No Resi", default: true, aggregate: aggSame((r) => r.noResi ?? ""), render: (r) => <span className="font-mono">{r.noResi || "—"}</span> },
    { key: "tglKirim", label: "Tgl Kirim", default: true, aggregate: aggSame((r) => formatDate(r.tanggalKirim)), render: (r) => <span className="font-mono">{formatDate(r.tanggalKirim)}</span> },
    { key: "ekspedisi", label: "Ekspedisi", default: false, render: (r) => r.ekspedisi || "—" },
    { key: "fg", label: "Qty FG", default: true, align: "right", aggregate: aggSum((r) => r.fg, (n) => <span className="font-semibold">{formatPcs(n)}</span>), render: (r) => <span className="font-mono">{formatPcs(r.fg)}</span> },
    { key: "bahan", label: "Bahan/pcs", default: false, align: "right", aggregate: wavg((r) => r.bahanPerItem ?? 0), render: (r) => money(r.bahanPerItem ?? 0) },
    { key: "rib", label: "Rib/pcs", default: false, align: "right", aggregate: wavg((r) => r.ribPerItem ?? 0), render: (r) => money(r.ribPerItem ?? 0) },
    { key: "cogs", label: "COGS Bahan/pcs", default: true, align: "right", aggregate: wavg((r) => r.cogsBahanPerItem), render: (r) => money(r.cogsBahanPerItem) },
    { key: "maklon", label: "Maklon/pcs", default: true, align: "right", aggregate: wavg((r) => r.biayaProduksiPerItem), render: (r) => money(r.biayaProduksiPerItem) },
    { key: "ongkir", label: "Ongkir/pcs", default: true, align: "right", aggregate: wavg((r) => r.ongkirPerItem), render: (r) => money(r.ongkirPerItem) },
    { key: "hpp", label: "HPP/pcs", default: true, align: "right", aggregate: wavg((r) => r.hppPerItem), render: (r) => <span className="font-mono font-semibold">{formatRupiah(r.hppPerItem)}</span> },
    { key: "jual", label: "Harga Jual", default: true, align: "right", render: (r) => (r.sellingPricePerItem != null ? money(r.sellingPricePerItem) : <span className="text-text-muted">—</span>) },
    {
      key: "ratio",
      label: "% HPP",
      default: true,
      align: "right",
      aggregate: (list: HppTableRow[]) => <span className="font-semibold">{pctLabel(hppPercentOf(list))}</span>,
      render: (r) => <span className="font-mono">{pctLabel(hppPercentOf([r]))}</span>,
    },
    { key: "total", label: "Total HPP", default: true, align: "right", aggregate: aggSum((r) => r.hppPerItem * r.fg, (n) => <span className="font-semibold">{formatRupiah(n)}</span>), render: (r) => money(r.hppPerItem * r.fg) },
    {
      key: "status",
      label: "Status",
      default: true,
      aggregate: aggSame((r) => statusOf(r), (v) => <StatusPill tone={v === "On Going" ? "warning" : "success"}>{v}</StatusPill>),
      render: (r) => <StatusPill tone={r.sementara ? "warning" : "success"}>{statusOf(r)}</StatusPill>,
    },
  ];
  const firstShownMrp = cardRows[0]?.mrpId ?? tableRows[0]?.mrpId ?? "";

  return (
    <AppShell role={role} activeHref={activeHref} breadcrumb={["Dashboard", "Laporan HPP"]} title="Laporan HPP">
      <div className="grid grid-cols-4 gap-3.5 max-lg:grid-cols-2">
        <KpiCard label="Total biaya produksi" value={formatRupiah(totalBiayaProduksi)} sub="maklon + denda/reward" accent="orange" />
        <KpiCard label="Total COGS bahan" value={formatRupiah(totalCogsBahan)} accent="teal" />
        <KpiCard label="Total ongkir" value={formatRupiah(totalOngkir)} sub="otomatis" accent="blue" />
        <KpiCard label="HPP (%)" value={hppPercentAgg != null ? hppPercentAgg.toFixed(1) + "%" : "—"} sub={"Total HPP / Total Harga Jual" + (nSementara > 0 ? ` · ${nSementara} baris On Going` : "")} accent="success" />
      </div>

      <DataTable<HppTableRow>
        title="Laporan HPP"
        subtitle="Satu baris per roll x size x koli yang sudah dikirim; baris kelompok = rata-rata tertimbang Qty FG"
        headerActions={
          <>
            <Button onClick={() => setDownloadMrp(firstShownMrp)} variant="muted" size="xs" disabled={tableRows.length === 0}>
              Download
            </Button>
            <Button onClick={() => setTambahanOpen(true)} variant="muted" size="xs" disabled={rows.length === 0} title="Excel per PO: HPP sistem + kolom isian benang, label size, dll.">
              Template HPP + Biaya Tambahan
            </Button>
          </>
        }
        columns={columns}
        rows={tableRows}
        keyOf={(r) => r.rowId}
        firstColumnLabel="Warna"
        firstColumnRender={(r) => <span className="font-medium">{r.warna}</span>}
        filterDefs={filterDefs}
        defaultGroupBy={["No. MRP", "Vendor"]}
        search={{ placeholder: "Cari MRP, vendor, warna, resi, code roll…", getText: (r) => `${r.mrpId} ${vendorName(r.vendorProduksi)} ${r.warna} ${r.size} ${r.noResi ?? ""} ${r.rollCode ?? ""}` }}
        onFilteredRows={(list) => setShownIds(new Set(list.map((r) => r.rowId)))}
        emptyText="Belum ada data HPP. Buat invoice vendor dulu di halaman Invoice Vendor."
      />
      {tambahanOpen && <HppTambahanDialog rows={rows} onClose={() => setTambahanOpen(false)} />}
      {downloadMrp !== null && <DownloadHppDialog rows={rows} defaultMrp={downloadMrp} onClose={() => setDownloadMrp(null)} />}
    </AppShell>
  );
}
