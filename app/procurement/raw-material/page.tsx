"use client";

import { useEffect, useMemo, useState } from "react";
import { Banknote, Boxes, Factory, Percent } from "lucide-react";
import { AppShell } from "@/components/shell/app-shell";
import { Button } from "@/components/ui/button";
import { KpiCard } from "@/components/ui/kpi-card";
import { DataTable, type ColumnDef } from "@/components/mrp/data-table";
import { FilterBar } from "@/components/mrp/filter-bar";
import { useMrpStore } from "@/lib/mrp/store";
import { formatDate, formatRupiah } from "@/lib/mrp/derive";
import { VENDOR_PRODUKSI } from "@/lib/mrp/seed";
import { rawMaterialLines, summarizeRawMaterial, type RawMaterialSummary } from "@/lib/mrp/rawMaterialReport";
import { exportRawMaterialExcel } from "@/lib/mrp/exportRawMaterialExcel";

const vendorName = (id: string) => VENDOR_PRODUKSI[id]?.name ?? id;
const rp = (n: number) => formatRupiah(Math.round(n));
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const BULAN = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
const bulanLabel = (ym: string) => {
  const [y, m] = ym.split("-");
  return `${BULAN[Number(m) - 1] ?? m} ${y}`;
};

const selectCls = "rounded-md border border-border-subtle bg-white px-2.5 py-[6px] font-sans text-[11.5px] font-medium text-[#31414F]";

/** Popup penuh rincian satu MRP x vendor (owner 2026-10-26): tabel per warna dan jenis bahan dengan filter sendiri dan total yang mengikuti filter. */
function RawMaterialDetailModal({ summary, mrpCreated, onClose }: { summary: RawMaterialSummary; mrpCreated: Map<string, string>; onClose: () => void }) {
  const [warna, setWarna] = useState("");
  const [jenis, setJenis] = useState("");
  const [noInvoice, setNoInvoice] = useState("");
  const [q, setQ] = useState("");
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const all = summary.lines;
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return all
      .filter((l) => (!warna || l.warna === warna) && (!jenis || l.jenis === jenis) && (!noInvoice || l.noInvoice === noInvoice) && (!needle || `${l.warna} ${l.jenis} ${l.noInvoice} ${l.kategori}`.toLowerCase().includes(needle)))
      .sort((a, b) => (a.bookedAt < b.bookedAt ? 1 : a.bookedAt > b.bookedAt ? -1 : 0) || a.warna.localeCompare(b.warna) || a.jenis.localeCompare(b.jenis));
  }, [all, warna, jenis, noInvoice, q]);
  const kainRows = rows.filter((l) => l.kind === "KAIN");
  const num = "whitespace-nowrap px-3 py-2 text-right font-mono";
  const hasFilter = !!(warna || jenis || noInvoice || q.trim());

  async function doExport() {
    setExporting(true);
    try {
      await exportRawMaterialExcel(summarizeRawMaterial(rows, mrpCreated), rows, [`MRP ${summary.mrpId}`, `vendor ${vendorName(summary.vendorProduksi)}`, warna && `warna ${warna}`, jenis && `jenis ${jenis}`, noInvoice && `invoice ${noInvoice}`, q.trim() && `cari "${q.trim()}"`].filter(Boolean).join(", "));
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0B131B]/45 p-6 max-md:p-0" onClick={onClose}>
      <div
        className="flex max-h-[80vh] w-full max-w-[1320px] flex-col overflow-hidden rounded-lg bg-white shadow-[0_8px_24px_rgba(11,19,27,.25)] max-md:h-full max-md:max-h-none max-md:max-w-none max-md:rounded-none"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-border-subtle px-5 py-3">
          <div className="font-sans text-[15px] font-semibold text-text-primary">
            Rincian raw material · <span className="font-mono">{summary.mrpId}</span> · {vendorName(summary.vendorProduksi)}
          </div>
          <div className="font-sans text-[11.5px] text-text-muted">
            {summary.kategori} · {summary.invoiceCount} invoice
          </div>
          <div className="ml-auto flex items-center gap-2">
            <Button onClick={() => void doExport()} disabled={exporting || rows.length === 0} variant="muted" size="xs">
              {exporting ? "Menyiapkan…" : "Export Excel"}
            </Button>
            <button onClick={onClose} aria-label="Tutup" className="rounded-md border border-[#CBD5DF] bg-white px-3 py-[6px] font-sans text-xs font-semibold text-action-primary">
              Tutup
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-b border-border-subtle bg-[#FAFBFC] px-5 py-2.5">
          <select value={warna} onChange={(e) => setWarna(e.target.value)} className={selectCls}>
            <option value="">Warna: Semua</option>
            {Array.from(new Set(all.map((l) => l.warna))).sort().map((o) => (
              <option key={o} value={o}>{o}</option>
            ))}
          </select>
          <select value={jenis} onChange={(e) => setJenis(e.target.value)} className={selectCls}>
            <option value="">Jenis bahan: Semua</option>
            {Array.from(new Set(all.map((l) => l.jenis))).sort().map((o) => (
              <option key={o} value={o}>{o}</option>
            ))}
          </select>
          <select value={noInvoice} onChange={(e) => setNoInvoice(e.target.value)} className={selectCls}>
            <option value="">No. invoice supplier: Semua</option>
            {Array.from(new Set(all.map((l) => l.noInvoice))).sort().map((o) => (
              <option key={o} value={o}>{o}</option>
            ))}
          </select>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari warna, jenis, atau invoice…" className={selectCls + " min-w-[220px] flex-1 max-w-[320px] font-normal"} />
          {hasFilter && (
            <button
              onClick={() => {
                setWarna("");
                setJenis("");
                setNoInvoice("");
                setQ("");
              }}
              className="font-sans text-[11.5px] font-semibold text-action-primary underline"
            >
              Hapus filter
            </button>
          )}
          <span className="ml-auto font-sans text-[11px] text-text-muted">
            {rows.length} dari {all.length} baris
          </span>
        </div>

        <div className="min-h-0 flex-1 overflow-auto">
          <table className="w-full min-w-[1180px] border-collapse font-sans text-[12px] text-[#31414F]">
            <thead className="sticky top-0 z-10">
              <tr className="border-b-2 border-accent-blue bg-info-bg text-[10.5px] font-medium uppercase tracking-wider text-info-fg">
                <th className="px-3 py-2.5 text-left">Warna</th>
                <th className="px-3 py-2.5 text-left">Jenis bahan</th>
                <th className="px-3 py-2.5 text-left" title="Nomor invoice dari supplier">No. invoice supplier</th>
                <th className="px-3 py-2.5 text-left">Tanggal</th>
                <th className="px-3 py-2.5 text-right">Roll dibeli</th>
                <th className="px-3 py-2.5 text-right">WIP</th>
                <th className="px-3 py-2.5 text-right">Selesai</th>
                <th className="px-3 py-2.5 text-right">Sisa</th>
                <th className="px-3 py-2.5 text-right">Setelah diskon</th>
                <th className="px-3 py-2.5 text-right">WIP (Rp)</th>
                <th className="px-3 py-2.5 text-right">Sisa (Rp)</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((l) => (
                <tr key={l.key} className="border-b border-[#EEF1F4] hover:bg-[#FAFBFC]">
                  <td className="px-3 py-2">{l.warna}</td>
                  <td className="px-3 py-2">
                    {l.jenis}
                    <span className="block text-[10px] text-text-muted">{l.kategori}</span>
                  </td>
                  <td className="px-3 py-2 font-mono" title={`ID invoice internal: ${l.invoiceId}`}>{l.noInvoice}</td>
                  <td className="px-3 py-2 font-mono text-text-muted">{formatDate(l.bookedAt)}</td>
                  {l.kind === "KAIN" ? (
                    <>
                      <td className={num}>{l.rollBeli}</td>
                      <td className={num}>{l.rollWip}</td>
                      <td className={num}>{l.rollSelesai}</td>
                      <td className={num}>{l.rollSisa}</td>
                    </>
                  ) : (
                    <td colSpan={4} className="px-3 py-2 text-right font-mono text-text-muted" title="Pemakaian rib/kerah/manset tidak dilacak per roll">
                      {l.beratKg} kg · hanya pembelian
                    </td>
                  )}
                  <td className={num + " font-semibold"}>{rp(l.nilaiSetelahDiskon)}</td>
                  <td className={num}>{l.kind === "KAIN" ? rp(l.nilaiWip) : "—"}</td>
                  <td className={num}>{l.kind === "KAIN" ? rp(l.nilaiSisa) : "—"}</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={11} className="px-3 py-8 text-center text-text-muted">Tidak ada baris yang cocok dengan filter.</td>
                </tr>
              )}
            </tbody>
            {rows.length > 0 && (
              <tfoot className="sticky bottom-0">
                <tr className="border-t-2 border-[#CFE0EF] bg-info-bg font-semibold text-info-fg">
                  <td className="px-3 py-2.5" colSpan={4}>Total (sesuai filter)</td>
                  <td className={num}>{sum(kainRows.map((l) => l.rollBeli))}</td>
                  <td className={num}>{sum(kainRows.map((l) => l.rollWip))}</td>
                  <td className={num}>{sum(kainRows.map((l) => l.rollSelesai))}</td>
                  <td className={num}>{sum(kainRows.map((l) => l.rollSisa))}</td>
                  <td className={num}>{rp(sum(rows.map((l) => l.nilaiSetelahDiskon)))}</td>
                  <td className={num}>{rp(sum(rows.map((l) => l.nilaiWip)))}</td>
                  <td className={num}>{rp(sum(rows.map((l) => l.nilaiSisa)))}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
        <div className="border-t border-border-subtle px-5 py-2 font-sans text-[10.5px] text-text-muted">
          WIP = roll yang sudah masuk produksi tetapi belum ditutup · Selesai = roll ditutup · Sisa = dibeli dikurangi WIP dan selesai (termasuk yang belum diterima vendor). Nilai per roll = harga per kg x berat kotor, setelah diskon invoice dibagi
          sebanding nilai.
        </div>
      </div>
    </div>
  );
}

export default function RawMaterialPage() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const invoices = useMrpStore((s) => s.invoices);
  const productionBatches = useMrpStore((s) => s.productionBatches);
  const mrpDetails = useMrpStore((s) => s.mrpDetails);
  const staticMrps = useMrpStore((s) => s.staticMrps);

  const [bulan, setBulan] = useState("");
  const [mrp, setMrp] = useState("");
  const [vendor, setVendor] = useState("");
  const [kategori, setKategori] = useState("");
  const [jenis, setJenis] = useState("");
  const [exporting, setExporting] = useState(false);
  const [detailKey, setDetailKey] = useState<string | null>(null);

  const allLines = useMemo(() => rawMaterialLines(invoices, productionBatches, mrpDetails, staticMrps), [invoices, productionBatches, mrpDetails, staticMrps]);
  const lines = useMemo(
    () =>
      allLines.filter(
        (l) =>
          (!bulan || l.bookedAt.slice(0, 7) === bulan) &&
          (!mrp || l.mrpId === mrp) &&
          (!vendor || vendorName(l.vendorProduksi) === vendor) &&
          (!kategori || l.kategori === kategori) &&
          (!jenis || l.jenis === jenis)
      ),
    [allLines, bulan, mrp, vendor, kategori, jenis]
  );
  // Urutan MRP mengikuti tanggal MRP dibuat (terbaru di atas), sama seperti halaman MRP di PPIC.
  const mrpCreated = useMemo(() => new Map(mrpDetails.map((d) => [d.mrp.id, d.dates?.created ?? ""])), [mrpDetails]);
  const summaries = useMemo(() => summarizeRawMaterial(lines, mrpCreated), [lines, mrpCreated]);

  if (!mounted) return null;

  const bulanOptions = Array.from(new Set(allLines.map((l) => l.bookedAt.slice(0, 7)).filter(Boolean))).sort().reverse();
  const totalSetelah = sum(summaries.map((s) => s.nilaiSetelahDiskon));
  const totalSebelum = sum(summaries.map((s) => s.nilaiSebelumDiskon));
  const totalDiskon = sum(summaries.map((s) => s.diskon));
  const nilaiWip = sum(summaries.map((s) => s.nilaiWip));
  const nilaiSisa = sum(summaries.map((s) => s.nilaiSisa));
  const rollBeli = sum(summaries.map((s) => s.rollBeli));
  const rollWip = sum(summaries.map((s) => s.rollWip));
  const rollSelesai = sum(summaries.map((s) => s.rollSelesai));
  const rollSisa = sum(summaries.map((s) => s.rollSisa));

  const filterLabel = [bulan && `bulan ${bulanLabel(bulan)}`, mrp && `MRP ${mrp}`, vendor && `vendor ${vendor}`, kategori && `kategori ${kategori}`, jenis && `jenis ${jenis}`].filter(Boolean).join(", ");

  const columns: ColumnDef<RawMaterialSummary>[] = [
    { key: "vendor", label: "Vendor", default: true, render: (s) => vendorName(s.vendorProduksi) },
    { key: "kategori", label: "Kategori produk", default: true, render: (s) => s.kategori },
    { key: "jenis", label: "Jenis bahan", default: true, render: (s) => s.jenis },
    { key: "invoice", label: "Invoice", default: true, align: "right", render: (s) => s.invoiceCount },
    { key: "rollBeli", label: "Roll dibeli", default: true, align: "right", render: (s) => s.rollBeli },
    { key: "rollWip", label: "Roll WIP", default: true, align: "right", render: (s) => s.rollWip },
    { key: "rollSelesai", label: "Roll selesai", default: true, align: "right", render: (s) => s.rollSelesai },
    { key: "rollSisa", label: "Roll sisa", default: true, align: "right", render: (s) => s.rollSisa },
    { key: "sebelum", label: "Total sebelum diskon", default: false, align: "right", render: (s) => rp(s.nilaiSebelumDiskon) },
    { key: "diskon", label: "Diskon", default: true, align: "right", render: (s) => rp(s.diskon) },
    { key: "setelah", label: "Total invoice setelah diskon", default: true, align: "right", render: (s) => <span className="font-semibold">{rp(s.nilaiSetelahDiskon)}</span> },
    { key: "wip", label: "WIP (Rp)", default: true, align: "right", render: (s) => rp(s.nilaiWip) },
    { key: "selesai", label: "Selesai produksi (Rp)", default: false, align: "right", render: (s) => rp(s.nilaiSelesai) },
    { key: "sisa", label: "Sisa bahan baku (Rp)", default: true, align: "right", render: (s) => rp(s.nilaiSisa) },
  ];

  async function doExport() {
    setExporting(true);
    try {
      await exportRawMaterialExcel(summaries, lines, filterLabel);
    } finally {
      setExporting(false);
    }
  }

  return (
    <AppShell
      role="procurement"
      activeHref="/procurement/raw-material"
      breadcrumb={["Dashboard", "Raw Material"]}
      title="Raw Material"
      subtitle="Pembelian dan penggunaan bahan baku per MRP dan vendor produksi"
    >
      <div className="grid grid-cols-4 gap-3.5 max-lg:grid-cols-2 max-sm:grid-cols-1">
        <KpiCard label="Total invoice setelah diskon" value={rp(totalSetelah)} valueClassName="text-[20px]" sub={`Sebelum diskon ${rp(totalSebelum)}`} accent="blue" icon={Banknote} />
        <KpiCard label="Total diskon" value={rp(totalDiskon)} valueClassName="text-[20px]" sub={totalSebelum > 0 ? `${((totalDiskon / totalSebelum) * 100).toFixed(2).replace(".", ",")}% dari total sebelum diskon` : undefined} accent="teal" icon={Percent} />
        <KpiCard label="Nilai WIP" value={rp(nilaiWip)} valueClassName="text-[20px]" sub={`${rollWip} roll sedang diproduksi`} accent="orange" icon={Factory} />
        <KpiCard label="Sisa bahan baku" value={rp(nilaiSisa)} valueClassName="text-[20px]" sub={`${rollSisa} roll belum dipakai · ${rollSelesai} selesai dari ${rollBeli} dibeli`} accent="purple" icon={Boxes} />
      </div>

      <div className="mt-4 overflow-hidden rounded-lg border border-border-subtle bg-surface-card">
        <FilterBar
          filters={[
            { label: "Bulan invoice", value: bulan, options: bulanOptions, onChange: setBulan },
            { label: "No. MRP", value: mrp, options: Array.from(new Set(allLines.map((l) => l.mrpId))).sort((a, b) => b.localeCompare(a, undefined, { numeric: true })), onChange: setMrp },
            { label: "Vendor", value: vendor, options: Array.from(new Set(allLines.map((l) => vendorName(l.vendorProduksi)))).sort(), onChange: setVendor },
            { label: "Kategori produk", value: kategori, options: Array.from(new Set(allLines.map((l) => l.kategori))).sort(), onChange: setKategori },
            { label: "Jenis bahan", value: jenis, options: Array.from(new Set(allLines.map((l) => l.jenis))).sort(), onChange: setJenis },
          ]}
        />
        {bulan && (
          <div className="border-b border-border-subtle bg-[#FAFBFC] px-5 py-1.5 font-sans text-[10.5px] text-text-muted">
            Bulan {bulanLabel(bulan)}: invoice yang dibuat pada bulan itu. Angka WIP dan sisa adalah kondisi saat ini untuk roll dari invoice tersebut.
          </div>
        )}
      </div>

      <div className="mt-4">
        <DataTable
          title="Raw material per MRP dan vendor"
          subtitle={`${summaries.length} baris · klik baris untuk membuka rincian per warna dan jenis bahan`}
          headerActions={
            <Button onClick={() => void doExport()} disabled={exporting || summaries.length === 0} variant="muted" size="xs">
              {exporting ? "Menyiapkan…" : "Export Excel"}
            </Button>
          }
          columns={columns}
          rows={summaries}
          keyOf={(s) => s.key}
          firstColumnLabel="No. MRP"
          firstColumnRender={(s) => <span className="font-mono">{s.mrpId}</span>}
          onRowClick={(s) => setDetailKey(s.key)}
          emptyText="Belum ada invoice bahan untuk filter ini."
        />
      </div>
      {detailKey && summaries.find((x) => x.key === detailKey) && (
        <RawMaterialDetailModal summary={summaries.find((x) => x.key === detailKey) as RawMaterialSummary} mrpCreated={mrpCreated} onClose={() => setDetailKey(null)} />
      )}
    </AppShell>
  );
}
