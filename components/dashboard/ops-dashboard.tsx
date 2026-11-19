"use client";

import { useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { KpiCard } from "@/components/ui/kpi-card";
import { useMrpProgressRows } from "@/components/mrp/mrp-progress";
import { PoProgress } from "@/components/dashboard/po-progress";
import { useMrpStore } from "@/lib/mrp/store";
import { formatPcs, formatRupiah, hppRowsForInvoicePerRoll, invoiceAwaitingPayment } from "@/lib/mrp/derive";
import { VENDOR_PRODUKSI } from "@/lib/mrp/seed";
import { flowRank, type FlowStage } from "@/lib/mrp/flowStatus";
import { buildOpsIssues, buildRollYields, yieldPct } from "@/lib/mrp/opsMonitor";
import { YIELD_ALERT_THRESHOLD_PCT } from "@/lib/mrp/derive";

/** Dashboard operasional bersama (owner 2026-11-16: "fokus ke progres produksi dan pembelian material, SLA yang lewat, KPI (Yield, HPP %)").
 *  Dipakai di menu Dashboard PPIC, Procurement, Finance, dan GM. Hanya membaca data yang sudah dimuat store (nol query baru); semua angka dari
 *  fungsi yang sama dengan halaman sumbernya:
 *   - status / roll per tahap : `useMrpProgressRows` (sama dengan tabel MRP PPIC dan SCM Monitoring)
 *   - SLA lewat               : `buildOpsIssues` (sama dengan SCM Monitoring tab Kendala SLA)
 *   - Yield                   : `buildRollYields` (sama dengan tab Yield; < 99% sama dengan Yield Alert)
 *   - HPP aktual %            : `hppRowsForInvoicePerRoll` (sama dengan Laporan HPP)
 *  Dirancang untuk HP sejak awal: kartu dua kolom, bar progres alih-alih tabel lebar. */

const vendorName = (id: string) => VENDOR_PRODUKSI[id]?.name ?? id;
const pct = (p: number | null, digits = 1) => (p == null ? "—" : p.toLocaleString("id-ID", { maximumFractionDigits: digits }) + "%");

function Section({ title, sub, children, right }: { title: string; sub?: string; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <section className="min-w-0 rounded-lg border border-border-subtle bg-surface-card">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-border-subtle px-4 py-3">
        <h2 className="font-sans text-[13.5px] font-semibold text-text-primary">{title}</h2>
        {sub && <span className="font-sans text-[11.5px] text-text-muted">{sub}</span>}
        {right && <span className="ml-auto">{right}</span>}
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}

/** Roll yang sudah melewati tahap `from` (termasuk yang sudah lebih jauh). */
const rollsAtLeast = (by: Partial<Record<FlowStage, number>>, from: FlowStage) =>
  (Object.entries(by) as [FlowStage, number][]).filter(([st]) => flowRank(st) >= flowRank(from)).reduce((s, [, n]) => s + n, 0);

export function OpsDashboard() {
  const rows = useMrpProgressRows();
  // Sel matriks gate membuka Tracking Item modul ini; hanya PPIC dan SCM yang punya halaman Tracking Item (modul lain: sel tidak bisa diklik).
  const pathname = usePathname();
  const trackingHref = pathname.startsWith("/dashboard/ppic") ? "/mrp/ppic/item-tracking" : pathname.startsWith("/scm") ? "/scm/item-tracking" : undefined;
  const materialPOs = useMrpStore((s) => s.materialPOs);
  const invoices = useMrpStore((s) => s.invoices);
  const batches = useMrpStore((s) => s.productionBatches);
  const kolis = useMrpStore((s) => s.deliveryKolis);
  const receipts = useMrpStore((s) => s.warehouseReceipts);
  const mrpDetails = useMrpStore((s) => s.mrpDetails);
  const vendorInvoices = useMrpStore((s) => s.vendorInvoices);
  const staticMrps = useMrpStore((s) => s.staticMrps);
  const results = useMrpStore((s) => s.productionResults);
  const meta = useMrpStore((s) => s.productionGroupMeta);
  const rates = useMrpStore((s) => s.ekspedisiRates);
  const prices = useMrpStore((s) => s.itemSellingPrices);
  const warnaAliases = useMrpStore((s) => s.warnaAliases);
  const [showAll, setShowAll] = useState(false);

  const issues = useMemo(() => buildOpsIssues({ materialPOs, invoices, batches, kolis, receipts, mrpDetails }), [materialPOs, invoices, batches, kolis, receipts, mrpDetails]);
  const yields = useMemo(() => buildRollYields(batches, mrpDetails), [batches, mrpDetails]);
  // HPP aktual per MRP dan per vendor (Laporan HPP): hanya baris yang punya FG dan harga jual masuk % HPP.
  const hpp = useMemo(() => {
    const relevant = vendorInvoices.filter((i) => i.status !== "REVISION");
    const byMrp = new Map<string, { hpp: number; jual: number }>();
    const byVendor = new Map<string, { hpp: number; jual: number }>();
    let tot = { hpp: 0, jual: 0 };
    for (const inv of relevant)
      for (const r of hppRowsForInvoicePerRoll(inv, relevant, mrpDetails, staticMrps, batches, results, meta, invoices, kolis, rates, prices)) {
        if (r.fg <= 0 || !r.sellingPricePerItem || r.sellingPricePerItem <= 0) continue;
        const h = r.hppPerItem * r.fg;
        const j = r.sellingPricePerItem * r.fg;
        for (const [m, k] of [[byMrp, r.mrpId], [byVendor, r.vendorProduksi]] as const) {
          const a = m.get(k) ?? { hpp: 0, jual: 0 };
          a.hpp += h;
          a.jual += j;
          m.set(k, a);
        }
        tot = { hpp: tot.hpp + h, jual: tot.jual + j };
      }
    return { byMrp, byVendor, tot };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vendorInvoices, mrpDetails, staticMrps, batches, results, meta, invoices, kolis, rates, prices, warnaAliases]);

  // MRP aktif = belum semua rollnya GR DC dan tidak ditolak. Terbaru di atas (urutan `useMrpProgressRows`).
  const active = rows.filter((r) => r.stage !== "GR DC" && r.stage !== "Ditolak" && r.detail);
  const shownMrps = showAll ? active : active.slice(0, 6);

  const sum = <T,>(list: T[], f: (x: T) => number) => list.reduce((s, x) => s + f(x), 0);
  const yc = yieldPct(sum(yields, (r) => r.cutting), sum(yields, (r) => r.target));
  const closed = yields.filter((r) => r.closed);
  const yf = yieldPct(sum(closed, (r) => r.fg), sum(closed, (r) => r.cutting));
  const below = yields.filter((r) => r.target > 0 && (r.cutting / r.target) * 100 < YIELD_ALERT_THRESHOLD_PCT).length;
  const hppPct = hpp.tot.jual > 0 ? (hpp.tot.hpp / hpp.tot.jual) * 100 : null;
  const estRows = active.filter((r) => r.hpp.pct != null && r.hpp.material + r.hpp.maklon > 0);
  const estPct = sum(estRows, (r) => r.hpp.hargaJual) > 0 ? (sum(estRows, (r) => r.hpp.total) / sum(estRows, (r) => r.hpp.hargaJual)) * 100 : null;

  // SLA lewat per jenis kendala.
  const byKind = new Map<string, { n: number; roll: number; pcs: number; maxLewat: number }>();
  for (const i of issues) {
    const a = byKind.get(i.kendala) ?? { n: 0, roll: 0, pcs: 0, maxLewat: 0 };
    a.n++;
    a.roll += i.roll;
    a.pcs += i.pcs;
    a.maxLewat = Math.max(a.maxLewat, i.lewat);
    byKind.set(i.kendala, a);
  }
  const kinds = [...byKind.entries()].sort((a, b) => b[1].n - a[1].n);
  const worst = issues.slice(0, 6);

  // KPI per vendor.
  const vendors = Array.from(new Set(yields.map((r) => r.vendorProduksi)))
    .map((v) => {
      const list = yields.filter((r) => r.vendorProduksi === v);
      const cl = list.filter((r) => r.closed);
      const h = hpp.byVendor.get(v);
      return {
        v,
        roll: list.length,
        yc: yieldPct(sum(list, (r) => r.cutting), sum(list, (r) => r.target)),
        yf: yieldPct(sum(cl, (r) => r.fg), sum(cl, (r) => r.cutting)),
        hpp: h && h.jual > 0 ? (h.hpp / h.jual) * 100 : null,
        sla: issues.filter((i) => i.vendorProduksi === v && i.area !== "Material").length,
      };
    })
    .sort((a, b) => b.roll - a.roll);

  // Pembelian material per MRP aktif.
  const paidValue = new Map<string, number>();
  for (const inv of invoices) if (!invoiceAwaitingPayment(inv) && inv.status !== "WAITING_INVOICE") paidValue.set(inv.mrpId, (paidValue.get(inv.mrpId) ?? 0) + inv.totalBiaya);

  const yTone = (p: number | null) => (p == null ? "" : p < YIELD_ALERT_THRESHOLD_PCT ? "text-danger-fg" : "text-success-fg");
  const hTone = (p: number | null) => (p == null ? "" : p > 100 ? "text-danger-fg" : p > 80 ? "text-warning-fg" : "text-success-fg");

  return (
    <div className="flex flex-col gap-4">
      {/* KPI */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <KpiCard label="Yield cutting" value={pct(yc)} sub={`${formatPcs(sum(yields, (r) => r.cutting))} dari target ${formatPcs(sum(yields, (r) => r.target))} pcs`} accent="blue" />
        <KpiCard label="Yield FG" value={pct(yf)} sub={`${formatPcs(closed.length)} roll Done FG · ${below} roll < ${YIELD_ALERT_THRESHOLD_PCT}%`} accent="teal" />
        <KpiCard label="HPP aktual" value={pct(hppPct)} sub="HPP / harga jual, FG terkirim" accent="purple" />
        <KpiCard label="Est. HPP MRP aktif" value={pct(estPct)} sub={`${estRows.length} MRP, dari nilai PO`} accent="orange" />
        <KpiCard label="SLA lewat" value={formatPcs(issues.length)} sub={kinds[0] ? `terbanyak: ${kinds[0][0]}` : "tidak ada"} accent="danger" />
      </div>

      {/* Progres PO hingga delivery (owner 2026-11-17): matriks 11 gate dengan filter gaya Odoo. */}
      <PoProgress rows={active} hppActual={hpp.byMrp} yields={yields} trackingHref={trackingHref} />

      <div className="grid gap-4 xl:grid-cols-2">
        {/* Pembelian material */}
        <Section
          title="Pembelian material"
          sub="roll MRP aktif per gate pembelian"
          right={
            active.length > 6 ? (
              <button className="font-sans text-[11.5px] font-semibold text-action-primary" onClick={() => setShowAll((v) => !v)}>
                {showAll ? "Tampilkan 6" : `Semua (${active.length})`}
              </button>
            ) : undefined
          }
        >
          <div className="overflow-x-auto">
            <table className="w-full min-w-[460px] border-collapse font-sans text-[12px] text-[#31414F]">
              <thead>
                <tr className="border-b border-border-subtle text-left text-[10.5px] uppercase tracking-wider text-text-muted">
                  <th className="py-2 pr-2">MRP</th>
                  <th className="py-2 pr-2 text-right">Roll</th>
                  <th className="py-2 pr-2 text-right">PV</th>
                  <th className="py-2 pr-2 text-right">Paid</th>
                  <th className="py-2 pr-2 text-right">Diterima</th>
                  <th className="py-2 text-right">Dibayar</th>
                </tr>
              </thead>
              <tbody>
                {shownMrps.map((r) => {
                  const total = sum(Object.values(r.rollsByStage), (n) => n ?? 0);
                  const cell = (n: number) => (
                    <td className="py-1.5 pr-2 text-right tabular-nums">
                      {formatPcs(n)}
                      <span className="ml-1 text-[10px] text-text-muted">{total ? Math.round((n / total) * 100) : 0}%</span>
                    </td>
                  );
                  return (
                    <tr key={r.mrp.id} className="border-b border-[#F1F4F7] last:border-b-0">
                      <td className="py-1.5 pr-2 font-mono">{r.mrp.id}</td>
                      <td className="py-1.5 pr-2 text-right tabular-nums">{formatPcs(total)}</td>
                      {cell(rollsAtLeast(r.rollsByStage, "PV Material"))}
                      {cell(rollsAtLeast(r.rollsByStage, "Paid"))}
                      {cell(rollsAtLeast(r.rollsByStage, "Receiving Material"))}
                      <td className="py-1.5 text-right tabular-nums" title={`Nilai PO material ${formatRupiah(r.hpp.material)}`}>
                        {formatRupiah(paidValue.get(r.mrp.id) ?? 0)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Section>

        {/* SLA lewat */}
        <Section title="SLA yang lewat" sub="lengkapnya di SCM Monitoring / Produksi SLA">
          <div className="flex flex-col gap-2">
            {kinds.map(([k, a]) => (
              <div key={k} className="flex items-center gap-2 font-sans text-[12px]">
                <span className="min-w-0 flex-1 truncate text-text-primary">{k}</span>
                <span className="tabular-nums text-text-muted">{a.roll ? `${formatPcs(a.roll)} roll` : `${formatPcs(a.pcs)} pcs`}</span>
                <span className="w-[54px] text-right font-semibold tabular-nums text-danger-fg">{a.n}</span>
              </div>
            ))}
            {kinds.length === 0 && <div className="font-sans text-xs text-text-muted">Tidak ada yang lewat SLA.</div>}
          </div>
          {worst.length > 0 && (
            <>
              <div className="mb-1.5 mt-4 font-sans text-[10.5px] font-medium uppercase tracking-wider text-text-muted">Paling lama</div>
              <div className="flex flex-col divide-y divide-[#F1F4F7]">
                {worst.map((i) => (
                  <div key={i.key} className="flex flex-wrap items-center gap-x-2 py-1.5 font-sans text-[11.5px]">
                    <span className="font-mono text-text-primary">{i.mrpId}</span>
                    <span className="text-text-muted">{vendorName(i.vendorProduksi)}</span>
                    <span className="min-w-0 flex-1 truncate">{i.kendala}</span>
                    <span className="font-semibold tabular-nums text-danger-fg">+{i.lewat} hari</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </Section>
      </div>

      {/* KPI per vendor */}
      <Section title="KPI vendor produksi" sub="yield dari roll yang sudah dicutting; HPP aktual dari FG terkirim">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] border-collapse font-sans text-[12px] text-[#31414F]">
            <thead>
              <tr className="border-b border-border-subtle text-left text-[10.5px] uppercase tracking-wider text-text-muted">
                <th className="py-2 pr-2">Vendor</th>
                <th className="py-2 pr-2 text-right">Roll</th>
                <th className="py-2 pr-2 text-right">Yield cutting</th>
                <th className="py-2 pr-2 text-right">Yield FG</th>
                <th className="py-2 pr-2 text-right">HPP aktual</th>
                <th className="py-2 text-right">SLA lewat</th>
              </tr>
            </thead>
            <tbody>
              {vendors.map((v) => (
                <tr key={v.v} className="border-b border-[#F1F4F7] last:border-b-0">
                  <td className="py-1.5 pr-2 font-medium">{vendorName(v.v)}</td>
                  <td className="py-1.5 pr-2 text-right tabular-nums">{formatPcs(v.roll)}</td>
                  <td className={"py-1.5 pr-2 text-right tabular-nums " + yTone(v.yc)}>{pct(v.yc)}</td>
                  <td className="py-1.5 pr-2 text-right tabular-nums">{pct(v.yf)}</td>
                  <td className={"py-1.5 pr-2 text-right tabular-nums " + hTone(v.hpp)}>{pct(v.hpp)}</td>
                  <td className="py-1.5 text-right tabular-nums">{v.sla || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
    </div>
  );
}
