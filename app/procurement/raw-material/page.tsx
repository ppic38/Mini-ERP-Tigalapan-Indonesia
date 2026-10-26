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
import { rawMaterialLines, summarizeRawMaterial, type RawMaterialLine, type RawMaterialSummary } from "@/lib/mrp/rawMaterialReport";
import { exportRawMaterialExcel } from "@/lib/mrp/exportRawMaterialExcel";

const vendorName = (id: string) => VENDOR_PRODUKSI[id]?.name ?? id;
const rp = (n: number) => formatRupiah(Math.round(n));
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const BULAN = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
const bulanLabel = (ym: string) => {
  const [y, m] = ym.split("-");
  return `${BULAN[Number(m) - 1] ?? m} ${y}`;
};

function DetailTable({ lines }: { lines: RawMaterialLine[] }) {
  const byDate = (a: RawMaterialLine, b: RawMaterialLine) =>
    (a.bookedAt < b.bookedAt ? 1 : a.bookedAt > b.bookedAt ? -1 : 0) || a.warna.localeCompare(b.warna) || a.jenis.localeCompare(b.jenis);
  const kain = lines.filter((l) => l.kind === "KAIN").sort(byDate);
  const tambahan = lines.filter((l) => l.kind === "TAMBAHAN").sort(byDate);
  const num = "px-2.5 py-1.5 text-right font-mono";
  const thBase = "px-2.5 py-2";
  const head = "border-b border-[#E4E9EE] bg-[#F2F5F8] text-[10px] font-semibold uppercase tracking-wider text-text-muted";
  const foot = "border-t border-[#E4E9EE] bg-[#F7F9FB] font-semibold";
  return (
    <div className="flex flex-col gap-3">
      {kain.length > 0 && (
        <div className="overflow-x-auto rounded-md border border-border-subtle bg-white">
          <div className="border-b border-[#E4E9EE] bg-white px-2.5 py-2 font-sans text-[11px] font-semibold text-[#31414F]">Kain (roll)</div>
          <table className="w-full min-w-[1100px] border-collapse font-sans text-[11.5px] text-[#31414F]">
            <thead>
              <tr className={head}>
                <th className={thBase + " text-left"}>Warna</th>
                <th className={thBase + " text-left"}>Jenis bahan</th>
                <th className={thBase + " text-left"} title="Nomor invoice dari supplier">No. invoice supplier</th>
                <th className={thBase + " text-left"}>Tanggal</th>
                <th className={thBase + " text-right"}>Roll dibeli</th>
                <th className={thBase + " text-right"}>WIP</th>
                <th className={thBase + " text-right"}>Selesai</th>
                <th className={thBase + " text-right"}>Sisa</th>
                <th className={thBase + " text-right"}>Setelah diskon</th>
                <th className={thBase + " text-right"}>WIP (Rp)</th>
                <th className={thBase + " text-right"}>Sisa (Rp)</th>
              </tr>
            </thead>
            <tbody>
              {kain.map((l) => (
                <tr key={l.key} className="border-b border-[#EEF1F4] last:border-b-0">
                  <td className="px-2.5 py-1.5">
                    {l.warna}
                    {l.lengan ? <span className="text-text-muted"> · {l.lengan}</span> : null}
                  </td>
                  <td className="px-2.5 py-1.5">
                    {l.jenis}
                    <span className="block text-[10px] text-text-muted">{l.kategori}</span>
                  </td>
                  <td className="px-2.5 py-1.5 font-mono" title={`ID invoice internal: ${l.invoiceId}`}>{l.noInvoice}</td>
                  <td className="px-2.5 py-1.5 font-mono text-text-muted">{formatDate(l.bookedAt)}</td>
                  <td className={num}>{l.rollBeli}</td>
                  <td className={num}>{l.rollWip}</td>
                  <td className={num}>{l.rollSelesai}</td>
                  <td className={num}>{l.rollSisa}</td>
                  <td className={num + " font-semibold"}>{rp(l.nilaiSetelahDiskon)}</td>
                  <td className={num}>{rp(l.nilaiWip)}</td>
                  <td className={num}>{rp(l.nilaiSisa)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className={foot}>
                <td className="px-2.5 py-1.5" colSpan={4}>Total kain</td>
                <td className={num}>{sum(kain.map((l) => l.rollBeli))}</td>
                <td className={num}>{sum(kain.map((l) => l.rollWip))}</td>
                <td className={num}>{sum(kain.map((l) => l.rollSelesai))}</td>
                <td className={num}>{sum(kain.map((l) => l.rollSisa))}</td>
                <td className={num}>{rp(sum(kain.map((l) => l.nilaiSetelahDiskon)))}</td>
                <td className={num}>{rp(sum(kain.map((l) => l.nilaiWip)))}</td>
                <td className={num}>{rp(sum(kain.map((l) => l.nilaiSisa)))}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
      {tambahan.length > 0 && (
        <div className="overflow-x-auto rounded-md border border-border-subtle bg-white">
          <div className="border-b border-[#E4E9EE] bg-white px-2.5 py-2 font-sans text-[11px] font-semibold text-[#31414F]">
            Rib dan item tambahan <span className="font-normal text-text-muted">· hanya pembelian, pemakaiannya tidak dilacak per roll</span>
          </div>
          <table className="w-full min-w-[760px] border-collapse font-sans text-[11.5px] text-[#31414F]">
            <thead>
              <tr className={head}>
                <th className={thBase + " text-left"}>Item</th>
                <th className={thBase + " text-left"}>Warna</th>
                <th className={thBase + " text-left"} title="Nomor invoice dari supplier">No. invoice supplier</th>
                <th className={thBase + " text-left"}>Tanggal</th>
                <th className={thBase + " text-right"}>Berat (kg)</th>
                <th className={thBase + " text-right"}>Sebelum diskon</th>
                <th className={thBase + " text-right"}>Setelah diskon</th>
              </tr>
            </thead>
            <tbody>
              {tambahan.map((l) => (
                <tr key={l.key} className="border-b border-[#EEF1F4] last:border-b-0">
                  <td className="px-2.5 py-1.5">
                    {l.jenis}
                    <span className="block text-[10px] text-text-muted">{l.kategori}</span>
                  </td>
                  <td className="px-2.5 py-1.5">{l.warna}</td>
                  <td className="px-2.5 py-1.5 font-mono" title={`ID invoice internal: ${l.invoiceId}`}>{l.noInvoice}</td>
                  <td className="px-2.5 py-1.5 font-mono text-text-muted">{formatDate(l.bookedAt)}</td>
                  <td className={num}>{l.beratKg}</td>
                  <td className={num}>{rp(l.nilaiSebelumDiskon)}</td>
                  <td className={num + " font-semibold"}>{rp(l.nilaiSetelahDiskon)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className={foot}>
                <td className="px-2.5 py-1.5" colSpan={4}>Total rib dan item tambahan</td>
                <td className={num}>{sum(tambahan.map((l) => l.beratKg))}</td>
                <td className={num}>{rp(sum(tambahan.map((l) => l.nilaiSebelumDiskon)))}</td>
                <td className={num}>{rp(sum(tambahan.map((l) => l.nilaiSetelahDiskon)))}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
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
  const summaries = useMemo(() => summarizeRawMaterial(lines), [lines]);

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
    { key: "kain", label: "Kain setelah diskon", default: true, align: "right", render: (s) => rp(s.nilaiKain) },
    { key: "tambahan", label: "Rib dan tambahan setelah diskon", default: true, align: "right", render: (s) => rp(s.nilaiTambahan) },
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
          subtitle={`${summaries.length} baris · klik baris untuk melihat rincian per warna dan jenis bahan`}
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
          renderExpanded={(s) => (
            <div className="flex flex-col gap-2">
              <DetailTable lines={s.lines} />
              <div className="font-sans text-[10.5px] text-text-muted">
                WIP = roll yang sudah masuk produksi tetapi belum ditutup · Selesai = roll ditutup · Sisa = dibeli dikurangi WIP dan selesai (termasuk yang belum diterima vendor). Nilai per roll = harga per kg x berat kotor, setelah
                diskon invoice dibagi sebanding nilai.
              </div>
            </div>
          )}
          emptyText="Belum ada invoice bahan untuk filter ini."
        />
      </div>
    </AppShell>
  );
}
