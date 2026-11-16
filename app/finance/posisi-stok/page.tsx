"use client";

import { useEffect, useMemo, useState } from "react";
import { Boxes, Factory, ShoppingCart, Truck } from "lucide-react";
import { AppShell } from "@/components/shell/app-shell";
import { KpiCard } from "@/components/ui/kpi-card";
import { Tabs } from "@/components/ui/tabs";
import { DataTable, aggSum, type ColumnDef, type FilterDef } from "@/components/mrp/data-table";
import { RawMaterialRollTab } from "@/components/procurement/raw-material-roll-tab";
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

/** Rincian per warna dan jenis bahan (dibuka di panel samping tabel). */
function StockDetail({ summary }: { summary: StockSummary }) {
  const rows = [...summary.lines].sort((a, b) => a.warna.localeCompare(b.warna) || a.jenis.localeCompare(b.jenis) || a.noInvoice.localeCompare(b.noInvoice));
  const num = "whitespace-nowrap px-3 py-2 text-right font-mono";
  const money = (bucket: StockBucket, estimasi?: boolean) => (
    <>
      {estimasi && <span className="text-text-muted">≈ </span>}
      {rp(bucket.nilai)}
    </>
  );
  return (
    <div>
      <div className="overflow-x-auto rounded-md border border-[#E4E8EE]">
        <table className="w-full min-w-[860px] border-collapse font-sans text-[12px] text-[#31414F]">
          <thead>
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
                <td className="whitespace-nowrap px-3 py-2">{line.warna}</td>
                <td className="whitespace-nowrap px-3 py-2">{line.jenis}</td>
                <td className="whitespace-nowrap px-3 py-2 font-mono">{line.noInvoice}</td>
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
      <div className="mt-2 font-sans text-[10.5px] text-text-muted">≈ = rib, kerah, atau manset. Pembagian tahapnya estimasi dari roll kain warna yang sama, karena bahan ini tidak dilacak per roll.</div>
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

  const [tab, setTab] = useState<"roll" | "mrp">("roll");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [shownKeys, setShownKeys] = useState<Set<string> | null>(null);

  const position = useMemo(() => buildStockPosition(invoices, productionBatches, deliveryKolis, materialClaimHistory, mrpDetails), [invoices, productionBatches, deliveryKolis, materialClaimHistory, mrpDetails]);
  const lines = useMemo(
    () =>
      position.lines.filter((line) => {
        const date = line.bookedAt.slice(0, 10);
        return (!from || date >= from) && (!to || date <= to);
      }),
    [position.lines, from, to]
  );
  const summaries = useMemo(() => summarize(lines), [lines]);

  if (!mounted) return null;

  // Kartu mengikuti baris yang lolos filter tabel (pola PPIC).
  const shown = shownKeys ? summaries.filter((s) => shownKeys.has(s.key)) : summaries;
  const total = sumStock(shown);
  const belum = belumProduksi(total);
  const proses = prosesProduksi(total);
  const shownMrp = new Set(shown.map((s) => `${s.mrpId}|${s.vendorProduksi}`));
  const unmatched = position.unmatchedBatches.filter((b) => shownMrp.has(`${b.mrpId}|${b.vendorProduksi}`) || !shownKeys);
  const dateCls = "rounded-md border border-border-subtle bg-white px-2 py-[4px] font-sans text-[11.5px] text-[#31414F]";

  const filterDefs: FilterDef<StockSummary>[] = [
    { label: "No. MRP", options: Array.from(new Set(summaries.map((s) => s.mrpId))).sort((a, b) => b.localeCompare(a, undefined, { numeric: true })), test: (s, v) => s.mrpId === v },
    { label: "Vendor", options: Array.from(new Set(summaries.map((s) => vendorName(s.vendorProduksi)))).sort(), test: (s, v) => vendorName(s.vendorProduksi) === v },
  ];

  const sumCol = (get: (s: StockSummary) => number, fmt = rp) => aggSum(get, (n) => <span className="font-semibold">{fmt(n)}</span>);
  const columns: ColumnDef<StockSummary>[] = [
    { key: "mrp", label: "No. MRP", default: false, render: (s) => <span className="font-mono">{s.mrpId}</span> },
    { key: "dibeli", aggregate: sumCol((s) => s.dibeli.nilai), label: "Dibeli", default: true, align: "right", render: (s) => <span className="font-semibold">{rp(s.dibeli.nilai)}</span> },
    { key: "rollDibeli", aggregate: sumCol((s) => s.dibeli.roll, fmtInt), label: "Roll dibeli", default: false, align: "right", render: (s) => fmtInt(s.dibeli.roll) },
    { key: "belumDiterima", aggregate: sumCol((s) => s.belumDiterima.nilai), label: "Belum diterima", default: true, align: "right", render: (s) => rp(s.belumDiterima.nilai) },
    { key: "diVendor", aggregate: sumCol((s) => s.diVendor.nilai), label: "Di vendor", default: true, align: "right", render: (s) => rp(s.diVendor.nilai) },
    { key: "belumProduksi", aggregate: sumCol((s) => belumProduksi(s).nilai), label: "Belum produksi", default: true, align: "right", info: INFO.belumProduksi, render: (s) => <span className="font-semibold">{rp(belumProduksi(s).nilai)}</span> },
    { key: "resting", aggregate: sumCol((s) => s.resting.nilai), label: "Resting", default: false, align: "right", render: (s) => rp(s.resting.nilai) },
    { key: "cuttingFg", aggregate: sumCol((s) => s.cuttingFg.nilai), label: "Cutting & FG", default: false, align: "right", render: (s) => rp(s.cuttingFg.nilai) },
    { key: "tutup", aggregate: sumCol((s) => s.tutup.nilai), label: "Roll ditutup", default: false, align: "right", render: (s) => rp(s.tutup.nilai) },
    { key: "proses", aggregate: sumCol((s) => prosesProduksi(s).nilai), label: "Proses produksi", default: true, align: "right", info: INFO.proses, render: (s) => <span className="font-semibold">{rp(prosesProduksi(s).nilai)}</span> },
    { key: "pcs", aggregate: sumCol((s) => s.pcsBelumKirim, fmtInt), label: "Pcs belum kirim", default: true, align: "right", render: (s) => fmtInt(s.pcsBelumKirim) },
    { key: "terkirim", aggregate: sumCol((s) => s.terkirim.nilai), label: "Sudah delivery", default: true, align: "right", info: INFO.terkirim, render: (s) => rp(s.terkirim.nilai) },
    { key: "diretur", aggregate: sumCol((s) => s.diretur.nilai), label: "Diretur", default: false, align: "right", render: (s) => rp(s.diretur.nilai) },
  ];

  return (
    <AppShell role="finance" activeHref="/finance/posisi-stok" breadcrumb={["Dashboard", "Posisi Stok"]} title="Posisi Stok" subtitle="Bahan yang sudah dibeli menurut tahap saat ini, sampai dikirim vendor">
      <Tabs
        items={[
          { key: "roll", label: "Per Roll" },
          { key: "mrp", label: "Per MRP dan vendor" },
        ]}
        active={tab}
        onChange={(k) => setTab(k as "roll" | "mrp")}
      />
      {tab === "roll" && <RawMaterialRollTab focus="nilai" />}
      {tab === "mrp" && (
        <>
          <div className="grid grid-cols-4 gap-3.5 max-lg:grid-cols-2 max-sm:grid-cols-1">
            <KpiCard label="Stok dibeli" value={rp(total.dibeli.nilai)} valueClassName="text-[20px]" sub={bucketSub(total.dibeli)} accent="blue" icon={ShoppingCart} />
            <KpiCard label="Belum produksi" value={rp(belum.nilai)} valueClassName="text-[20px]" sub={`${bucketSub(belum)} · belum masuk resting`} accent="orange" icon={Boxes} />
            <KpiCard label="Proses produksi" value={rp(proses.nilai)} valueClassName="text-[20px]" sub={`${bucketSub(proses)} · ${fmtInt(total.pcsBelumKirim)} pcs belum dikirim`} accent="purple" icon={Factory} />
            <KpiCard label="Sudah delivery" value={rp(total.terkirim.nilai)} valueClassName="text-[20px]" sub={`${fmtKg(total.terkirim.kg)} kg · menunggu feedback gudang`} accent="teal" icon={Truck} />
          </div>

          {(unmatched.length > 0 || total.tidakDilacak > 0 || total.diretur.nilai > 0) && (
            <ul className="list-disc rounded-lg border border-border-subtle bg-white px-8 py-2.5 font-sans text-[11.5px] text-[#31414F]">
              {unmatched.length > 0 && <li>{fmtInt(unmatched.length)} roll di produksi tidak ketemu di invoice bahan, jadi nilainya belum masuk halaman ini.</li>}
              {total.tidakDilacak > 0 && <li>{rp(total.tidakDilacak)} item tambahan selain rib, kerah, dan manset ada di Stok dibeli, tetapi pemakaiannya tidak dilacak per tahap.</li>}
              {total.diretur.nilai > 0 && <li>{rp(total.diretur.nilai)} roll diretur lewat klaim ada di Stok dibeli, tetapi tidak lagi dihitung sebagai stok.</li>}
            </ul>
          )}

          <DataTable<StockSummary>
            title="Posisi stok per MRP dan vendor"
            subtitle={from || to ? "Invoice pada rentang tanggal ini, dengan posisi rollnya hari ini" : undefined}
            headerActions={
              <span className="flex items-center gap-1.5 font-sans text-[11.5px] text-text-muted">
                Tgl invoice
                <input type="date" aria-label="Tanggal invoice dari" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} className={dateCls} />
                s/d
                <input type="date" aria-label="Tanggal invoice sampai" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} className={dateCls} />
              </span>
            }
            columns={columns}
            rows={summaries}
            keyOf={(s) => s.key}
            firstColumnLabel="Vendor"
            firstColumnRender={(s) => <span className="font-medium">{vendorName(s.vendorProduksi)}</span>}
            filterDefs={filterDefs}
            defaultGroupBy={["No. MRP"]}
            onFilteredRows={(list) => setShownKeys(new Set(list.map((s) => s.key)))}
            renderExpanded={(s) => <StockDetail summary={s} />}
            emptyText="Belum ada invoice bahan untuk filter ini."
          />
        </>
      )}
    </AppShell>
  );
}
