"use client";

import { useEffect, useState } from "react";
import { AppShell } from "@/components/shell/app-shell";
import { KpiCard } from "@/components/ui/kpi-card";
import { Button } from "@/components/ui/button";
import { DataTable, type ColumnDef } from "@/components/mrp/data-table";
import { useMrpStore } from "@/lib/mrp/store";
import { formatDate, formatPcs, formatRupiah, warehouseReceivableGroups, type WarehouseReceivableGroup } from "@/lib/mrp/derive";
import { VENDOR_PRODUKSI } from "@/lib/mrp/seed";

/** Panel item read-only + form "Bongkar Koli" -- TIDAK ADA input qty manual (Q5 final, konsisten
 *  R10 di spec): Warehouse cuma mengonfirmasi (boleh isi catatan bebas) lalu submit, qty & HPP
 *  seluruhnya dibaca dari data yang sudah dihitung server-side (`warehouseReceivableGroups`). */
function ReceivableGroupPanel({ group }: { group: WarehouseReceivableGroup }) {
  const receiveWarehouseResiGroup = useMrpStore((s) => s.receiveWarehouseResiGroup);
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [koliFilter, setKoliFilter] = useState("");
  const [hppFilter, setHppFilter] = useState("");

  // HPP baru ditampilkan kalau parameternya lengkap: invoice vendor sudah dibayar (tidak ada gateReason) dan roll sudah final.
  // Selama belum, nilainya disembunyikan supaya tidak terbaca sebagai HPP final.
  const hppReady = !group.gateReason;
  const koliOptions = Array.from(new Set(group.items.map((it) => it.noKoli ?? it.deliveryKoliId))).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const hppQuery = hppFilter.replace(/D/g, "");
  const visibleItems = group.items.filter((it) => {
    if (koliFilter && (it.noKoli ?? it.deliveryKoliId) !== koliFilter) return false;
    if (hppQuery && !(hppReady && !it.sementara && String(Math.round(it.hppPerItem)).includes(hppQuery))) return false;
    return true;
  });

  async function handleBongkar() {
    setSubmitting(true);
    setError("");
    try {
      await receiveWarehouseResiGroup(group.resiGroupId, note.trim() || undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <select value={koliFilter} onChange={(e) => setKoliFilter(e.target.value)} className="input !w-auto !py-1.5 !text-[11.5px]">
          <option value="">Semua nomor koli</option>
          {koliOptions.map((k) => (
            <option key={k} value={k}>
              Koli {k}
            </option>
          ))}
        </select>
        <input
          value={hppFilter}
          onChange={(e) => setHppFilter(e.target.value)}
          inputMode="numeric"
          disabled={!hppReady}
          title={!hppReady ? "HPP belum tersedia" : undefined}
          placeholder="Filter HPP/item (angka)…"
          className="input !w-[190px] !py-1.5 !text-[11.5px] disabled:opacity-50"
        />
        {(koliFilter || hppFilter) && (
          <button onClick={() => { setKoliFilter(""); setHppFilter(""); }} className="font-sans text-[11px] font-semibold text-accent-blue">
            Reset
          </button>
        )}
        <span className="font-sans text-[10.5px] text-text-muted">
          {visibleItems.length} dari {group.items.length} baris
        </span>
      </div>
      <div className="overflow-x-auto rounded-md border border-[#E4E9EE] bg-white">
        <table className="w-full min-w-[760px] border-collapse">
          <thead>
            <tr className="border-b border-[#E4E9EE] bg-[#F2F5F8] font-sans text-[10px] font-semibold uppercase tracking-wider text-text-muted">
              <th className="px-3 py-2 text-left">Koli</th>
              <th className="px-3 py-2 text-left">Warna / lengan</th>
              <th className="px-3 py-2 text-left">Size</th>
              <th className="px-3 py-2 text-left">Jenis</th>
              <th className="px-3 py-2 text-right">Qty</th>
              <th className="px-3 py-2 text-right">HPP/item</th>
              <th className="px-3 py-2 text-right">Nilai</th>
            </tr>
          </thead>
          <tbody>
            {visibleItems.map((it, i) => (
              <tr key={i} className="border-b border-[#EEF1F4] font-sans text-[11.5px] text-[#31414F] last:border-b-0">
                <td className="px-3 py-1.5 font-mono text-text-muted">{it.noKoli ?? it.deliveryKoliId}</td>
                <td className="px-3 py-1.5">
                  {it.warna} · {it.lengan}
                </td>
                <td className="px-3 py-1.5">{it.size}</td>
                <td className="px-3 py-1.5">{it.kind === "FG" ? "FG" : it.kind === "REWORK" ? "Rework" : "Reject"}</td>
                <td className="px-3 py-1.5 text-right font-mono">{formatPcs(it.qty)}</td>
                <td className="px-3 py-1.5 text-right font-mono">{hppReady && !it.sementara ? formatRupiah(it.hppPerItem) : "—"}</td>
                <td className="px-3 py-1.5 text-right font-mono font-semibold text-text-primary">{hppReady && !it.sementara ? formatRupiah(it.qty * it.hppPerItem) : "—"}</td>
              </tr>
            ))}
            {visibleItems.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-4 text-center font-sans text-[11.5px] text-text-muted">
                  {group.items.length === 0 ? "Koli dalam resi ini belum punya item." : "Tidak ada baris yang cocok dengan filter."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {group.gateReason ? (
        <div className="rounded-md border border-[#EFC9C4] bg-[#FCF3F1] px-3 py-2 font-sans text-[11.5px] font-medium text-danger-fg">{group.gateReason}</div>
      ) : (
        <div className="flex items-end gap-2.5">
          <div className="flex-1">
            <div className="font-sans text-[9.5px] font-medium uppercase tracking-wider text-text-muted">Catatan (opsional)</div>
            <input value={note} onChange={(e) => setNote(e.target.value)} className="input mt-1 !py-1.5 !text-[11.5px]" placeholder="Catatan penerimaan…" />
          </div>
          <Button variant="primary" size="sm" disabled={submitting} onClick={handleBongkar}>
            {submitting ? "Memproses…" : "Bongkar Koli"}
          </Button>
        </div>
      )}
      {error && <div className="font-sans text-[10.5px] font-medium text-danger-fg">{error}</div>}
    </div>
  );
}

export default function WarehousePenerimaanPage() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const deliveryKolis = useMrpStore((s) => s.deliveryKolis);
  const vendorInvoices = useMrpStore((s) => s.vendorInvoices);
  const mrpDetails = useMrpStore((s) => s.mrpDetails);
  const staticMrps = useMrpStore((s) => s.staticMrps);
  const productionBatches = useMrpStore((s) => s.productionBatches);
  const productionResults = useMrpStore((s) => s.productionResults);
  const productionGroupMeta = useMrpStore((s) => s.productionGroupMeta);
  const rawInvoices = useMrpStore((s) => s.invoices);
  const warehouseReceipts = useMrpStore((s) => s.warehouseReceipts);
  const ekspedisiRates = useMrpStore((s) => s.ekspedisiRates);
  const itemSellingPrices = useMrpStore((s) => s.itemSellingPrices);

  if (!mounted) return null;

  const groups = warehouseReceivableGroups(
    deliveryKolis,
    vendorInvoices,
    mrpDetails,
    staticMrps,
    productionBatches,
    productionResults,
    productionGroupMeta,
    rawInvoices,
    warehouseReceipts,
    ekspedisiRates,
    itemSellingPrices
  );

  const readyCount = groups.filter((g) => !g.gateReason).length;
  const waitingCount = groups.length - readyCount;
  const totalNilaiReady = groups.filter((g) => !g.gateReason).reduce((s, g) => s + g.totalNilai, 0);

  const columns: ColumnDef<WarehouseReceivableGroup>[] = [
    { key: "noKoli", label: "No Koli", default: true, render: (g) => g.noKoli },
    { key: "ekspedisi", label: "Ekspedisi", default: true, render: (g) => g.ekspedisi || "—" },
    { key: "tanggalKirim", label: "Tanggal Kirim", default: true, render: (g) => formatDate(g.deliveredAt) },
    { key: "mrp", label: "No MRP", default: true, render: (g) => <span className="font-mono">{g.mrpLabel || g.mrpId}</span> },
    { key: "vendor", label: "Vendor Produksi", default: true, render: (g) => VENDOR_PRODUKSI[g.vendorProduksi]?.name ?? g.vendorProduksi },
    { key: "invoice", label: "No Invoice Vendor", default: false, render: (g) => (g.invoiceIds.length > 0 ? g.invoiceIds.join(", ") : "—") },
    { key: "qty", label: "Total Qty", default: true, align: "right", render: (g) => formatPcs(g.totalQty) },
    {
      // Item 2026-09-16 (integrasi WMS, migration 0041) -- status TERPISAH dari kolom "Status" di
      // bawah (yang soal gate invoice/HPP): ini murni menandai barang sudah dicek fisik masuk di
      // WMS atau belum, tidak memengaruhi boleh/tidaknya "Bongkar Koli".
      key: "statusWms",
      label: "Status WMS",
      default: false,
      render: (g) =>
        g.wmsReceivedAt ? (
          <span className="font-sans text-[10.5px] font-semibold text-success-fg">✓ Diterima WMS · {formatDate(g.wmsReceivedAt)}</span>
        ) : (
          <span className="font-sans text-[10.5px] text-text-muted">Belum dikonfirmasi WMS</span>
        ),
    },
    {
      key: "status",
      label: "Status",
      default: true,
      render: (g) =>
        g.gateReason ? (
          <span className="font-sans text-[10.5px] font-semibold text-danger-fg">{g.gateReason}</span>
        ) : (
          <span className="font-sans text-[10.5px] font-semibold text-success-fg">Siap dibongkar</span>
        ),
    },
  ];

  return (
    <AppShell
      role="warehouse"
      activeHref="/warehouse/penerimaan"
      breadcrumb={["Warehouse", "Penerimaan"]}
      title="Penerimaan"
    >
      <div className="grid grid-cols-3 gap-3.5">
        <KpiCard label="Siap dibongkar" value={formatPcs(readyCount)} sub="resi dengan invoice sudah dibayar" accent="success" />
        <KpiCard label="Menunggu invoice" value={formatPcs(waitingCount)} sub="resi belum lolos syarat" accent="orange" />
        <KpiCard label="Nilai siap dibongkar" value={formatRupiah(totalNilaiReady)} accent="blue" />
      </div>

      <DataTable
        title="Batch Pengiriman (Resi)"
        subtitle="Klik baris untuk lihat rincian item & tombol Bongkar"
        columns={columns}
        rows={groups}
        keyOf={(g) => g.resiGroupId}
        firstColumnLabel="No Resi"
        firstColumnRender={(g) => <span className="font-mono">{g.noResi ?? g.resiGroupId}</span>}
        renderExpanded={(g) => <ReceivableGroupPanel group={g} />}
        emptyText="Belum ada koli yang siap/menunggu diterima."
      />
    </AppShell>
  );
}
