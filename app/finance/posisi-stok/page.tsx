"use client";

import { useEffect, useMemo, useState } from "react";
import { Boxes, Factory, ShoppingCart, Truck } from "lucide-react";
import { AppShell } from "@/components/shell/app-shell";
import { KpiCard } from "@/components/ui/kpi-card";
import { DataTable, type ColumnDef } from "@/components/mrp/data-table";
import { MultiSelectFilter } from "@/components/mrp/multi-select-filter";
import { useMrpStore } from "@/lib/mrp/store";
import { formatRupiah } from "@/lib/mrp/derive";
import { VENDOR_PRODUKSI } from "@/lib/mrp/seed";
import { belumProduksi, buildStockPosition, prosesProduksi, sumStock, type StockBucket, type StockLine, type StockTotals } from "@/lib/mrp/stockPosition";

const vendorName = (id: string) => VENDOR_PRODUKSI[id]?.name ?? id;
const rp = (n: number) => formatRupiah(Math.round(n));
const fmtInt = (n: number) => Math.round(n).toLocaleString("id-ID");
const fmtKg = (n: number) => n.toLocaleString("id-ID", { maximumFractionDigits: 1 });
const bucketSub = (b: StockBucket) => `${fmtInt(b.roll)} roll · ${fmtKg(b.kg)} kg`;

type StockSummary = StockTotals & { key: string; mrpId: string; vendorProduksi: string; lines: StockLine[] };

const INFO = {
  belumProduksi: {
    title: "Belum produksi",
    body: <p>Bahan yang sudah dibeli tetapi rollnya belum masuk Resting. Terdiri dari bahan yang belum diterima vendor dan bahan yang sudah ada di vendor.</p>,
  },
  proses: {
    title: "Proses produksi",
    body: (
      <>
        <p>Bahan yang sudah masuk Resting tetapi hasilnya belum dikirim vendor.</p>
        <p className="mt-1.5">Roll yang dikirim sebagian hanya dihitung sebesar porsi yang belum terkirim: nilai roll × (1 − pcs terkirim ÷ pcs hasil).</p>
        <p className="mt-1.5 text-text-muted">Pcs hasil = Finish Good untuk roll yang sudah ditutup, hasil cutting untuk roll yang masih terbuka.</p>
      </>
    ),
  },
  terkirim: {
    title: "Sudah delivery",
    body: <p>Porsi bahan yang hasilnya sudah dikirim vendor (koli sudah punya ekspedisi dan resi). Reject yang dikirim tidak dihitung.</p>,
  },
} as const;

function summarize(lines: StockLine[]): StockSummary[] {
  const groups = new Map<string, StockLine[]>();
  for (const line of lines) {
    const key = `${line.mrpId}|${line.vendorProduksi}`;
    groups.set(key, [...(groups.get(key) ?? []), line]);
  }
  return Array.from(groups, ([key, rows]) => ({ ...sumStock(rows), key, mrpId: rows[0].mrpId, vendorProduksi: rows[0].vendorProduksi, lines: rows })).sort(
    (a, b) => b.mrpId.localeCompare(a.mrpId, undefined, { numeric: true }) || vendorName(a.vendorProduksi).localeCompare(vendorName(b.vendorProduksi))
  );
}

function StockDetailModal({ summary, onClose }: { summary: StockSummary; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const rows = [...summary.lines].sort((a, b) => a.warna.localeCompare(b.warna) || a.jenis.localeCompare(b.jenis) || a.noInvoice.localeCompare(b.noInvoice));
  const num = "whitespace-nowrap px-3 py-2 text-right font-mono";
  const money = (bucket: StockBucket, estimasi?: boolean) => (
    <>
      {estimasi && <span className="text-text-muted">≈ </span>}
      {rp(bucket.nilai)}
    </>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0B131B]/45 p-6 max-md:p-0" onClick={onClose}>
      <div className="flex max-h-[80vh] w-full max-w-[1180px] flex-col overflow-hidden rounded-lg bg-white shadow-[0_8px_24px_rgba(11,19,27,.25)] max-md:h-full max-md:max-h-none max-md:rounded-none" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-4 border-b border-border-subtle px-5 py-3">
          <div className="font-sans text-[15px] font-semibold text-text-primary">
            Rincian stok · <span className="font-mono">{summary.mrpId}</span> · {vendorName(summary.vendorProduksi)}
          </div>
          <button onClick={onClose} aria-label="Tutup" className="ml-auto rounded-md border border-[#CBD5DF] bg-white px-3 py-[6px] font-sans text-xs font-semibold text-action-primary">
            Tutup
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto">
          <table className="w-full min-w-[980px] border-collapse font-sans text-[12px] text-[#31414F]">
            <thead className="sticky top-0 z-10">
              <tr className="border-b-2 border-accent-blue bg-info-bg text-[10.5px] font-medium uppercase tracking-wider text-info-fg">
                <th className="px-3 py-2.5 text-left">Warna</th>
                <th className="px-3 py-2.5 text-left">Jenis bahan</th>
                <th className="px-3 py-2.5 text-left">No. invoice</th>
                <th className="px-3 py-2.5 text-right">Dibeli</th>
                <th className="px-3 py-2.5 text-right">Belum produksi</th>
                <th className="px-3 py-2.5 text-right">Proses produksi</th>
                <th className="px-3 py-2.5 text-right">Sudah delivery</th>
                <th className="px-3 py-2.5 text-right">Pcs belum kirim</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((line) => (
                <tr key={line.key} className="border-b border-[#EEF1F4]">
                  <td className="px-3 py-2">{line.warna}</td>
                  <td className="px-3 py-2">{line.jenis}</td>
                  <td className="px-3 py-2 font-mono">{line.noInvoice}</td>
                  <td className={num + " font-semibold"}>{rp(line.dibeli.nilai)}</td>
                  <td className={num}>{money(belumProduksi(line), line.estimasi)}</td>
                  <td className={num}>{money(prosesProduksi(line), line.estimasi)}</td>
                  <td className={num}>{money(line.terkirim, line.estimasi)}</td>
                  <td className={num}>{line.kind === "KAIN" ? fmtInt(line.pcsBelumKirim) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="border-t border-border-subtle px-5 py-2 font-sans text-[10.5px] text-text-muted">≈ = rib, kerah, atau manset. Pembagian tahapnya estimasi dari roll kain warna yang sama, karena bahan ini tidak dilacak per roll.</div>
      </div>
    </div>
  );
}

export default function PosisiStokPage() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const invoices = useMrpStore((s) => s.invoices);
  const productionBatches = useMrpStore((s) => s.productionBatches);
  const deliveryKolis = useMrpStore((s) => s.deliveryKolis);
  const materialClaimHistory = useMrpStore((s) => s.materialClaimHistory);
  const mrpDetails = useMrpStore((s) => s.mrpDetails);

  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [mrp, setMrp] = useState<string[]>([]);
  const [vendor, setVendor] = useState<string[]>([]);
  const [detailKey, setDetailKey] = useState<string | null>(null);

  const position = useMemo(() => buildStockPosition(invoices, productionBatches, deliveryKolis, materialClaimHistory, mrpDetails), [invoices, productionBatches, deliveryKolis, materialClaimHistory, mrpDetails]);
  const lines = useMemo(
    () =>
      position.lines.filter((line) => {
        const date = line.bookedAt.slice(0, 10);
        return (!from || date >= from) && (!to || date <= to) && (mrp.length === 0 || mrp.includes(line.mrpId)) && (vendor.length === 0 || vendor.includes(vendorName(line.vendorProduksi)));
      }),
    [position.lines, from, to, mrp, vendor]
  );
  const summaries = useMemo(() => summarize(lines), [lines]);
  const total = useMemo(() => sumStock(lines), [lines]);

  if (!mounted) return null;

  const belum = belumProduksi(total);
  const proses = prosesProduksi(total);
  const unmatched = position.unmatchedBatches.filter((b) => (mrp.length === 0 || mrp.includes(b.mrpId)) && (vendor.length === 0 || vendor.includes(vendorName(b.vendorProduksi))));
  const hasFilter = !!from || !!to || mrp.length > 0 || vendor.length > 0;
  const dateCls = "rounded-md border border-border-subtle bg-white px-2.5 py-[5px] font-sans text-[11.5px] text-[#31414F]";
  const detail = summaries.find((s) => s.key === detailKey);

  const columns: ColumnDef<StockSummary>[] = [
    { key: "vendor", label: "Vendor", default: true, render: (s) => vendorName(s.vendorProduksi) },
    { key: "dibeli", label: "Dibeli", default: true, align: "right", render: (s) => <span className="font-semibold">{rp(s.dibeli.nilai)}</span> },
    { key: "rollDibeli", label: "Roll dibeli", default: false, align: "right", render: (s) => fmtInt(s.dibeli.roll) },
    { key: "belumDiterima", label: "Belum diterima vendor", default: true, align: "right", render: (s) => rp(s.belumDiterima.nilai) },
    { key: "diVendor", label: "Di vendor, belum resting", default: true, align: "right", render: (s) => rp(s.diVendor.nilai) },
    { key: "belumProduksi", label: "Total belum produksi", default: true, align: "right", info: INFO.belumProduksi, render: (s) => <span className="font-semibold">{rp(belumProduksi(s).nilai)}</span> },
    { key: "resting", label: "Resting", default: false, align: "right", render: (s) => rp(s.resting.nilai) },
    { key: "cuttingFg", label: "Cutting & Finish Good", default: false, align: "right", render: (s) => rp(s.cuttingFg.nilai) },
    { key: "tutup", label: "Roll ditutup, belum dikirim", default: false, align: "right", render: (s) => rp(s.tutup.nilai) },
    { key: "proses", label: "Total proses produksi", default: true, align: "right", info: INFO.proses, render: (s) => <span className="font-semibold">{rp(prosesProduksi(s).nilai)}</span> },
    { key: "pcs", label: "Pcs belum kirim", default: true, align: "right", render: (s) => fmtInt(s.pcsBelumKirim) },
    { key: "terkirim", label: "Sudah delivery", default: true, align: "right", info: INFO.terkirim, render: (s) => rp(s.terkirim.nilai) },
    { key: "diretur", label: "Diretur", default: false, align: "right", render: (s) => rp(s.diretur.nilai) },
  ];

  return (
    <AppShell role="finance" activeHref="/finance/posisi-stok" breadcrumb={["Dashboard", "Posisi Stok"]} title="Posisi Stok" subtitle="Bahan yang sudah dibeli menurut tahap saat ini, sampai dikirim vendor">
      <div className="grid grid-cols-4 gap-3.5 max-lg:grid-cols-2 max-sm:grid-cols-1">
        <KpiCard label="Stok dibeli" value={rp(total.dibeli.nilai)} valueClassName="text-[20px]" sub={bucketSub(total.dibeli)} accent="blue" icon={ShoppingCart} />
        <KpiCard label="Belum produksi" value={rp(belum.nilai)} valueClassName="text-[20px]" sub={`${bucketSub(belum)} · belum masuk resting`} accent="orange" icon={Boxes} />
        <KpiCard label="Proses produksi" value={rp(proses.nilai)} valueClassName="text-[20px]" sub={`${bucketSub(proses)} · ${fmtInt(total.pcsBelumKirim)} pcs belum dikirim`} accent="purple" icon={Factory} />
        <KpiCard label="Sudah delivery" value={rp(total.terkirim.nilai)} valueClassName="text-[20px]" sub={`${fmtKg(total.terkirim.kg)} kg · menunggu feedback gudang`} accent="teal" icon={Truck} />
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2 rounded-lg border border-border-subtle bg-[#FAFBFC] px-5 py-2.5">
        <label className="flex items-center gap-1.5 font-sans text-[11.5px] text-text-muted">
          Tanggal invoice
          <input type="date" aria-label="Tanggal invoice dari" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} className={dateCls} />
        </label>
        <label className="flex items-center gap-1.5 font-sans text-[11.5px] text-text-muted">
          sampai
          <input type="date" aria-label="Tanggal invoice sampai" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} className={dateCls} />
        </label>
        <MultiSelectFilter label="No. MRP" options={Array.from(new Set(position.lines.map((l) => l.mrpId))).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))} value={mrp} onChange={setMrp} />
        <MultiSelectFilter label="Vendor" options={Array.from(new Set(position.lines.map((l) => vendorName(l.vendorProduksi)))).sort()} value={vendor} onChange={setVendor} />
        {hasFilter && (
          <button
            onClick={() => {
              setFrom("");
              setTo("");
              setMrp([]);
              setVendor([]);
            }}
            className="font-sans text-[11.5px] font-semibold text-action-primary underline"
          >
            Hapus filter
          </button>
        )}
        {(from || to) && <span className="w-full font-sans text-[10.5px] text-text-muted">Menampilkan invoice pada rentang ini, dengan posisi rollnya hari ini.</span>}
      </div>

      {(unmatched.length > 0 || total.tidakDilacak > 0 || total.diretur.nilai > 0) && (
        <ul className="mt-3 list-disc rounded-lg border border-border-subtle bg-white px-8 py-2.5 font-sans text-[11.5px] text-[#31414F]">
          {unmatched.length > 0 && <li>{fmtInt(unmatched.length)} roll di produksi tidak ketemu di invoice bahan, jadi nilainya belum masuk halaman ini.</li>}
          {total.tidakDilacak > 0 && <li>{rp(total.tidakDilacak)} item tambahan selain rib, kerah, dan manset ada di Stok dibeli, tetapi pemakaiannya tidak dilacak per tahap.</li>}
          {total.diretur.nilai > 0 && <li>{rp(total.diretur.nilai)} roll diretur lewat klaim ada di Stok dibeli, tetapi tidak lagi dihitung sebagai stok.</li>}
        </ul>
      )}

      <div className="mt-4">
        <DataTable
          title="Posisi stok per MRP dan vendor"
          subtitle={`${summaries.length} baris · klik baris untuk rincian per warna`}
          columns={columns}
          rows={summaries}
          keyOf={(s) => s.key}
          firstColumnLabel="No. MRP"
          firstColumnRender={(s) => <span className="font-mono">{s.mrpId}</span>}
          onRowClick={(s) => setDetailKey(s.key)}
          emptyText="Belum ada invoice bahan untuk filter ini."
        />
      </div>
      {detail && <StockDetailModal summary={detail} onClose={() => setDetailKey(null)} />}
    </AppShell>
  );
}
