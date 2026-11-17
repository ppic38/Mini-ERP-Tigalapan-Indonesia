"use client";

import { useEffect, useState } from "react";
import { AppShell } from "@/components/shell/app-shell";
import { StatusPill } from "@/components/ui/status-pill";
import { DataTable, type ColumnDef } from "@/components/mrp/data-table";
import { useMrpStore, type MrpDetail } from "@/lib/mrp/store";
import { formatDateTime, mrpDetailFor, productionYieldAlertsList, type ProductionYieldAlertRow } from "@/lib/mrp/derive";
import { aduanKategoriLabel, poIdForAduan } from "@/lib/mrp/produksiInfo";
import { VENDOR_PRODUKSI } from "@/lib/mrp/seed";
import type { AduanPolaRow } from "@/lib/mrp/types";
import { SysadminActionsBar } from "@/components/sysadmin/correction-dialog";
import { yieldAlertCorrections } from "@/components/sysadmin/produksi-corrections";
import { useSysadminMode } from "@/lib/shell/use-sysadmin-mode";

const SIZE_RANK = ["XS", "S", "M", "L", "XL", "2XL", "3XL", "4XL", "5XL"];
function sortSizes(sizes: string[]): string[] {
  const rank = (s: string) => {
    const i = SIZE_RANK.indexOf(s.toUpperCase());
    return i < 0 ? 99 : i;
  };
  return [...sizes].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b, "id", { numeric: true }));
}

/** Rincian satu roll yang yield-nya di bawah baseline: baris Aduan Pola asalnya (kode, jumlah roll, rencana per size) dan perbandingan per size
 *  antara target roll ini (rencana aduan diprorata jumlah roll) dengan hasil cutting aktual. */
function YieldDetail({ row, detail, poId, kategori }: { row: ProductionYieldAlertRow; detail: MrpDetail | undefined; poId: string; kategori: string }) {
  const aduan: AduanPolaRow | undefined = detail?.aduanRows.find((a) => a.id === row.aduanRowId);
  const target = row.targetBySize ?? {};
  const actual = row.actualBySize ?? {};
  const sizes = sortSizes(Array.from(new Set([...Object.keys(target), ...Object.keys(actual)])));
  const planTotal = aduan ? aduan.sizes.reduce((a, s) => a + s.qty, 0) : 0;
  const fmt = (n: number) => n.toLocaleString("id-ID");
  const sum = (o: Record<string, number>) => Object.values(o).reduce((a, c) => a + c, 0);
  return (
    <div className="flex flex-col gap-3 font-sans text-[11.5px] text-[#31414F]">
      <div className="rounded-md border border-[#E4E9EE] bg-white px-3 py-2.5">
        <div className="mb-1.5 text-[10px] font-medium uppercase tracking-wider text-text-muted">Aduan pola asal roll</div>
        <div className="grid grid-cols-2 gap-x-6 gap-y-1 md:grid-cols-4">
          <div>
            <span className="text-text-muted">No. Order (PO)</span>
            <div className="font-mono font-semibold">{poId}</div>
          </div>
          <div>
            <span className="text-text-muted">Kode aduan</span>
            <div className="font-mono font-semibold">{aduan?.kode ?? "—"}</div>
          </div>
          <div>
            <span className="text-text-muted">Kategori</span>
            <div className="font-semibold">{kategori}</div>
          </div>
          <div>
            <span className="text-text-muted">Warna · lengan</span>
            <div className="font-semibold">
              {row.warna} · {row.lengan}
            </div>
          </div>
          <div>
            <span className="text-text-muted">Rencana aduan</span>
            <div className="font-mono">
              {aduan ? `${fmt(aduan.qtyRoll)} roll · ${fmt(planTotal)} pcs` : "—"}
            </div>
          </div>
          <div>
            <span className="text-text-muted">Roll ini</span>
            <div className="font-mono">
              {row.codeRoll || "—"}
              {row.qtyRoll ? ` (${fmt(row.qtyRoll)} roll)` : ""}
              {row.gramasi > 0 ? ` · ${fmt(row.gramasi)} gsm` : ""}
            </div>
          </div>
          <div>
            <span className="text-text-muted">Tanggal cutting</span>
            <div className="font-mono">{formatDateTime(row.cuttingAt)}</div>
          </div>
          <div>
            <span className="text-text-muted">Vendor</span>
            <div className="font-semibold">{VENDOR_PRODUKSI[row.vendorProduksi]?.name ?? row.vendorProduksi}</div>
          </div>
        </div>
        {aduan && aduan.sizes.length > 0 && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <span className="text-text-muted">Rencana seluruh aduan per size:</span>
            {sortSizes(aduan.sizes.map((s) => s.size)).map((sz) => (
              <span key={sz} className="rounded border border-[#E4E9EE] bg-[#FAFBFC] px-2 py-0.5 font-mono text-[10.5px]">
                <span className="font-semibold">{sz}</span> {fmt(aduan.sizes.find((s) => s.size === sz)?.qty ?? 0)}
              </span>
            ))}
          </div>
        )}
      </div>
      <div className="overflow-hidden rounded-md border border-[#E4E9EE] bg-white">
        <table className="w-full border-collapse">
          <thead>
            <tr className="bg-[#F2F4F7] text-[10px] font-medium uppercase tracking-wider text-text-muted">
              <th className="px-3 py-1.5 text-left">Size</th>
              <th className="px-3 py-1.5 text-right" title="Rencana aduan diprorata jumlah roll batch ini">Target roll ini</th>
              <th className="px-3 py-1.5 text-right">Hasil cutting</th>
              <th className="px-3 py-1.5 text-right">Selisih</th>
              <th className="px-3 py-1.5 text-right">Yield</th>
            </tr>
          </thead>
          <tbody>
            {sizes.map((sz) => {
              const t = target[sz] ?? 0;
              const a = actual[sz] ?? 0;
              const d = a - t;
              const y = t > 0 ? (a / t) * 100 : null;
              return (
                <tr key={sz} className="border-t border-[#F1F4F7]">
                  <td className="px-3 py-1.5 font-mono font-semibold">{sz}</td>
                  <td className="px-3 py-1.5 text-right font-mono">{fmt(t)}</td>
                  <td className="px-3 py-1.5 text-right font-mono">{fmt(a)}</td>
                  <td className={"px-3 py-1.5 text-right font-mono font-semibold " + (d < 0 ? "text-danger-fg" : d > 0 ? "text-success-fg" : "text-text-muted")}>{d > 0 ? "+" + fmt(d) : fmt(d)}</td>
                  <td className="px-3 py-1.5 text-right font-mono">{y == null ? "—" : y.toFixed(1) + "%"}</td>
                </tr>
              );
            })}
            <tr className="border-t-2 border-[#CBD5DF] bg-[#FAFBFC] font-semibold">
              <td className="px-3 py-1.5">Total</td>
              <td className="px-3 py-1.5 text-right font-mono">{fmt(sum(target))}</td>
              <td className="px-3 py-1.5 text-right font-mono">{fmt(sum(actual))}</td>
              <td className="px-3 py-1.5 text-right font-mono">{fmt(sum(actual) - sum(target))}</td>
              <td className="px-3 py-1.5 text-right font-mono text-danger-fg">{row.yieldPct.toFixed(1)}%</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function ProduksiYieldAlertsPage() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const productionBatches = useMrpStore((s) => s.productionBatches);
  const mrpDetails = useMrpStore((s) => s.mrpDetails);
  const maklonPOs = useMrpStore((s) => s.maklonPOs);
  const productionYieldResolutions = useMrpStore((s) => s.productionYieldResolutions);
  const resolveProductionYield = useMrpStore((s) => s.resolveProductionYield);
  const unresolveProductionYield = useMrpStore((s) => s.unresolveProductionYield);
  const sysadmin = useSysadminMode();

  const [noteDraft, setNoteDraft] = useState<Record<string, string>>({});

  if (!mounted) return null;

  const rows = productionYieldAlertsList(productionBatches, mrpDetails, productionYieldResolutions);
  const unresolvedCount = rows.filter((r) => !r.resolved).length;

  const vendorName = (r: ProductionYieldAlertRow) => VENDOR_PRODUKSI[r.vendorProduksi]?.name ?? r.vendorProduksi;
  const poOf = (r: ProductionYieldAlertRow) => poIdForAduan(r.mrpId, r.vendorProduksi, r.aduanRowId, mrpDetails, maklonPOs);
  const kategoriOf = (r: ProductionYieldAlertRow) => aduanKategoriLabel(r.mrpId, r.aduanRowId, mrpDetails);
  const kodeOf = (r: ProductionYieldAlertRow) => mrpDetailFor(r.mrpId, mrpDetails)?.aduanRows.find((a) => a.id === r.aduanRowId)?.kode ?? "";

  function submitResolve(batchId: string) {
    const note = (noteDraft[batchId] ?? "").trim();
    if (!note) return;
    resolveProductionYield(batchId, note);
    setNoteDraft((prev) => ({ ...prev, [batchId]: "" }));
  }

  const columns: ColumnDef<ProductionYieldAlertRow>[] = [
    { key: "sysadmin", label: "Aksi Sysadmin", default: true, sysadmin: true, render: (r) => (r.resolved ? <SysadminActionsBar compact actions={yieldAlertCorrections({ batchId: r.batchId, mrpId: r.mrpId, codeRoll: r.codeRoll })} /> : null) },
    { key: "po", label: "No. Order", default: true, sortValue: poOf, render: (r) => <span className="font-mono">{poOf(r)}</span> },
    { key: "vendor", label: "Vendor produksi", default: true, sortValue: vendorName, render: vendorName },
    { key: "kategori", label: "Kategori", default: true, sortValue: kategoriOf, render: kategoriOf },
    { key: "warna", label: "Warna / lengan", default: true, sortValue: (r) => `${r.warna} ${r.lengan}`, render: (r) => `${r.warna} · ${r.lengan}` },
    { key: "aduan", label: "Kode aduan", default: true, sortValue: kodeOf, render: (r) => <span className="font-mono">{kodeOf(r) || "—"}</span> },
    { key: "roll", label: "Code roll", default: true, sortValue: (r) => r.codeRoll ?? "", render: (r) => <span className="font-mono">{r.codeRoll || "—"}</span> },
    {
      key: "hasil",
      label: "Hasil / target",
      default: true,
      align: "right",
      sortValue: (r) => r.actualQty,
      render: (r) => (
        <span className="font-mono">
          {r.actualQty} / {r.targetQty} pcs
        </span>
      ),
    },
    {
      key: "yield",
      label: "Yield",
      default: true,
      align: "right",
      sortValue: (r) => r.yieldPct,
      render: (r) => (
        <span className="font-mono font-semibold text-danger-fg">{r.yieldPct.toFixed(1)}%</span>
      ),
    },
    { key: "cuttingAt", label: "Tanggal cutting", default: false, sortValue: (r) => r.cuttingAt, render: (r) => formatDateTime(r.cuttingAt) },
    {
      key: "status",
      label: "Status",
      default: true,
      sortValue: (r) => (r.resolved ? 1 : 0),
      render: (r) => <StatusPill tone={r.resolved ? "success" : "warning"}>{r.resolved ? "Sudah ditindak" : "Belum ditindak"}</StatusPill>,
    },
    {
      key: "aksi",
      label: "Aksi",
      default: true,
      // Kolom ini berisi isian dan tombol: klik di dalamnya tidak boleh ikut membuka/menutup rincian baris.
      render: (r) => {
        if (r.resolved) {
          const resolution = productionYieldResolutions[r.batchId];
          return (
            <div className="flex min-w-[220px] items-start justify-between gap-2" onClick={(e) => e.stopPropagation()}>
              <span className="font-sans text-[11.5px] text-text-muted">
                {resolution?.note}
                {resolution?.resolvedAt && <span className="block font-mono text-[10px]">{formatDateTime(resolution.resolvedAt)}</span>}
              </span>
              {/* Mode Sysadmin: "Buka lagi" milik Produksi (server menolak Sysadmin) diganti kolom Aksi Sysadmin. */}
              {sysadmin ? null : (
                <button onClick={() => unresolveProductionYield(r.batchId)} className="flex-none font-sans text-[11px] font-semibold text-action-primary underline">
                  Buka lagi
                </button>
              )}
            </div>
          );
        }
        // Sysadmin hanya melihat & mengoreksi -- menindak alert baru adalah tugas Produksi.
        if (sysadmin) return <span className="font-sans text-[11.5px] text-text-muted">Menunggu tindak lanjut Produksi</span>;
        return (
          <div className="flex min-w-[260px] flex-col gap-1.5" onClick={(e) => e.stopPropagation()}>
            <input
              value={noteDraft[r.batchId] ?? ""}
              onChange={(e) => setNoteDraft((prev) => ({ ...prev, [r.batchId]: e.target.value }))}
              placeholder="Catatan (mis. alasan yield rendah / tindak lanjut)…"
              className="input text-[11.5px]"
            />
            <button
              onClick={() => submitResolve(r.batchId)}
              disabled={!(noteDraft[r.batchId] ?? "").trim()}
              className="flex-none rounded-md bg-action-primary px-2.5 py-[6px] font-sans text-[11px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              Tandai ditindak
            </button>
          </div>
        );
      },
    },
  ];

  return (
    <AppShell
      role="produksi"
      activeHref="/produksi/yield-alerts"
      breadcrumb={["Dashboard", "Yield Alert"]}
      title="Yield Alert"
      subtitle={`${rows.length} roll dengan yield di bawah baseline 99% — ${unresolvedCount} belum ditindak`}
    >
      <DataTable
        title="Yield alert per roll"
        subtitle="Klik baris untuk melihat aduan pola dan rincian size (target vs hasil cutting)"
        columns={columns}
        rows={rows}
        keyOf={(r) => r.batchId}
        firstColumnLabel="No. MRP"
        firstColumnRender={(r) => <span className="font-mono">{r.mrpId}</span>}
        firstColumnSortValue={(r) => r.mrpId}
        renderExpanded={(r) => <YieldDetail row={r} detail={mrpDetailFor(r.mrpId, mrpDetails)} poId={poOf(r)} kategori={kategoriOf(r)} />}
        fitExpanded
        search={{
          placeholder: "Cari no. order, MRP, vendor, kategori, warna, kode aduan, code roll…",
          getText: (r) => [poOf(r), r.mrpId, vendorName(r), kategoriOf(r), r.warna, r.lengan, kodeOf(r), r.codeRoll ?? ""].join(" "),
        }}
        filterDefs={[
          { label: "No MRP", options: Array.from(new Set(rows.map((r) => r.mrpId))), test: (r, v) => r.mrpId === v },
          {
            label: "Vendor produksi",
            options: Array.from(new Set(rows.map(vendorName))),
            test: (r, v) => vendorName(r) === v,
          },
          { label: "Kategori", options: Array.from(new Set(rows.map(kategoriOf))).sort(), test: (r, v) => kategoriOf(r) === v },
          {
            label: "Status",
            options: ["Belum ditindak", "Sudah ditindak"],
            test: (r, v) => (r.resolved ? "Sudah ditindak" : "Belum ditindak") === v,
          },
        ]}
        emptyText="Belum ada roll dengan yield di bawah baseline."
      />
    </AppShell>
  );
}
