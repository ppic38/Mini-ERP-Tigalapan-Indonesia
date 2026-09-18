"use client";

import { useEffect, useState } from "react";
import { ChevronRight } from "lucide-react";
import { AppShell } from "@/components/shell/app-shell";
import { StatusPill } from "@/components/ui/status-pill";
import { DataTable, type ColumnDef } from "@/components/mrp/data-table";
import { useMrpStore } from "@/lib/mrp/store";
import { formatDate, formatPcs, targetDoneProduksiForGroup, vendorItemSizeProgress } from "@/lib/mrp/derive";
import { VENDOR_PRODUKSI } from "@/lib/mrp/seed";
import type { Lengan, MaklonPO, RawMaterialInvoice } from "@/lib/mrp/types";

/** Monitoring deadline produksi (owner 2026-09-18): deadline per warna = tanggal bahan diterima
 *  vendor (RawMaterialInvoice.receivedAt) + lead time vendor (VENDOR_PRODUKSI.productionLeadDays,
 *  default 7 hari/"1 minggu") -- pakai `targetDoneProduksiForGroup` yang SUDAH ADA (dipakai untuk
 *  label ontime/delay di panel hasil produksi), bukan konsep baru. Progres cutting & Finish Good
 *  ditampilkan TERPISAH (bukan digabung 1 angka) sesuai permintaan owner, dari `vendorItemSizeProgress`
 *  yang sama dipakai "Monitoring Produksi". Warna/lengan yang belum ada bahan diterima sama sekali
 *  (targetDoneAt undefined) ditandai "Menunggu bahan", TIDAK dihitung telat/tidaknya. */
type DeadlineRow = {
  warna: string;
  lengan: Lengan;
  target: number;
  cutting: number;
  finishGood: number;
  deadline: string | undefined;
  daysLeft: number | null;
};

function statusFor(row: DeadlineRow): { label: string; tone: "neutral" | "info" | "warning" | "success" | "danger" } {
  if (!row.deadline) return { label: "MENUNGGU BAHAN", tone: "neutral" };
  const done = row.target > 0 && row.finishGood >= row.target;
  if (done) return { label: "SELESAI", tone: "success" };
  if ((row.daysLeft ?? 0) < 0) return { label: "TERLAMBAT", tone: "danger" };
  if ((row.daysLeft ?? 99) <= 2) return { label: "MENDEKATI DEADLINE", tone: "warning" };
  return { label: "BERJALAN", tone: "info" };
}

function deadlineRowsForPo(po: MaklonPO, mrpDetails: ReturnType<typeof useMrpStore.getState>["mrpDetails"], batches: ReturnType<typeof useMrpStore.getState>["productionBatches"], results: ReturnType<typeof useMrpStore.getState>["productionResults"], invoices: RawMaterialInvoice[]): DeadlineRow[] {
  const items = vendorItemSizeProgress(po.mrpId, po.vendorProduksi, mrpDetails, batches, results);
  const groups = new Map<string, DeadlineRow>();
  for (const it of items) {
    const key = it.warna + "|" + it.lengan;
    const cur = groups.get(key);
    if (cur) {
      cur.target += it.target;
      cur.cutting += it.cutting;
      cur.finishGood += it.finishGood;
    } else {
      const deadline = targetDoneProduksiForGroup(po.mrpId, po.vendorProduksi, it.warna, invoices);
      const daysLeft = deadline ? Math.round((new Date(deadline + "T00:00:00").getTime() - new Date(new Date().toDateString()).getTime()) / 86400000) : null;
      groups.set(key, { warna: it.warna, lengan: it.lengan, target: it.target, cutting: it.cutting, finishGood: it.finishGood, deadline, daysLeft });
    }
  }
  return Array.from(groups.values()).sort((a, b) => (a.deadline ?? "9999").localeCompare(b.deadline ?? "9999"));
}

function DeadlineTable({ po }: { po: MaklonPO }) {
  const mrpDetails = useMrpStore((s) => s.mrpDetails);
  const productionBatches = useMrpStore((s) => s.productionBatches);
  const productionResults = useMrpStore((s) => s.productionResults);
  const invoices = useMrpStore((s) => s.invoices);

  const rows = deadlineRowsForPo(po, mrpDetails, productionBatches, productionResults, invoices);

  if (rows.length === 0) {
    return <div className="rounded-md border border-[#E4E9EE] bg-white px-3 py-2 font-sans text-[11.5px] text-text-muted">Belum ada rencana Aduan Pola untuk vendor ini di MRP tsb.</div>;
  }

  return (
    <div className="overflow-hidden rounded-md border border-[#E4E9EE] bg-white">
      <div className="bg-[#F2F4F7] px-3 py-1.5 font-sans text-[10px] font-medium uppercase tracking-wider text-text-muted">
        Deadline per warna/lengan — bahan diterima + {VENDOR_PRODUKSI[po.vendorProduksi]?.productionLeadDays ?? 7} hari. Bar Cutting/FG dibanding target rencana; angka paling kanan = efisiensi FG dari cutting AKTUAL.
      </div>
      <div className="divide-y divide-[#F1F4F7]">
        {rows.map((r) => {
          const cuttingPct = r.target > 0 ? Math.min(100, (r.cutting / r.target) * 100) : 0;
          const fgPct = r.target > 0 ? Math.min(100, (r.finishGood / r.target) * 100) : 0;
          const status = statusFor(r);
          return (
            <div key={r.warna + "|" + r.lengan} className="flex items-center gap-3 px-3 py-2">
              <span className="w-[160px] flex-none truncate font-sans text-[11.5px] font-medium text-[#31414F]">
                {r.warna} · {r.lengan}
              </span>
              <span className="w-[110px] flex-none font-mono text-[11px] text-text-muted">{r.deadline ? formatDate(r.deadline) : "—"}</span>
              <span className="w-[90px] flex-none font-mono text-[11px] text-text-muted">{r.daysLeft != null ? (r.daysLeft < 0 ? `${-r.daysLeft} hari lewat` : `${r.daysLeft} hari lagi`) : "—"}</span>
              <span className="flex-1">
                <span className="flex items-center gap-1.5">
                  <span className="w-[46px] flex-none font-sans text-[10px] text-text-muted">Cutting</span>
                  <span className="relative block h-1.5 w-full overflow-hidden rounded-full bg-[#EEF0F3]">
                    <span className="absolute inset-y-0 left-0 rounded-full bg-[#CFE0EF]" style={{ width: `${cuttingPct}%` }} />
                  </span>
                  <span className="w-[80px] flex-none text-right font-mono text-[10.5px] text-text-muted">{formatPcs(r.cutting)}/{formatPcs(r.target)}</span>
                </span>
                <span className="mt-1 flex items-center gap-1.5">
                  <span className="w-[46px] flex-none font-sans text-[10px] text-text-muted">FG</span>
                  <span className="relative block h-1.5 w-full overflow-hidden rounded-full bg-[#EEF0F3]">
                    <span className="absolute inset-y-0 left-0 rounded-full bg-success" style={{ width: `${fgPct}%` }} />
                  </span>
                  <span className="w-[80px] flex-none text-right font-mono text-[10.5px] text-text-muted">{formatPcs(r.finishGood)}/{formatPcs(r.target)}</span>
                </span>
              </span>
              <span
                title="Finish Good dibagi hasil cutting AKTUAL (bukan target rencana) -- kalau cutting sendiri belum capai target, angka ini tetap menunjukkan efisiensi konversi cutting->baju yang sebenarnya, terlepas dari cutting-nya kurang/lebih dari rencana."
                className="w-[70px] flex-none text-right font-mono text-[11px] font-semibold text-[#31414F]"
              >
                {r.cutting > 0 ? `${((r.finishGood / r.cutting) * 100).toFixed(0)}%` : "—"}
              </span>
              <StatusPill tone={status.tone} className="flex-none">
                {status.label}
              </StatusPill>
            </div>
          );
        })}
      </div>
    </div>
  );
}

type MrpGroup = { mrpId: string; vendorPOs: MaklonPO[] };

function MrpVendorDrilldown({ group }: { group: MrpGroup }) {
  const [selectedId, setSelectedId] = useState<string | null>(group.vendorPOs.length === 1 ? group.vendorPOs[0].id : null);
  const selected = group.vendorPOs.find((p) => p.id === selectedId) ?? null;

  return (
    <div className="flex flex-col gap-2">
      {selected && group.vendorPOs.length > 1 && (
        <button onClick={() => setSelectedId(null)} className="self-start font-sans text-[11.5px] font-semibold text-action-primary underline">
          ← Ganti vendor ({group.vendorPOs.length} vendor mengerjakan MRP ini)
        </button>
      )}
      {!selected ? (
        <div className="flex flex-col gap-1.5">
          {group.vendorPOs.map((po) => (
            <button
              key={po.id}
              onClick={() => setSelectedId(po.id)}
              className="flex w-full items-center gap-3 rounded-md border border-[#E4E9EE] bg-white px-3 py-2 text-left hover:bg-[#FAFBFC]"
            >
              <span className="w-[160px] flex-none truncate font-sans text-[12px] font-semibold text-[#31414F]">{VENDOR_PRODUKSI[po.vendorProduksi]?.name ?? po.vendorProduksi}</span>
              <span className="flex-1 font-mono text-[11px] text-text-muted">{formatPcs(po.qty)} pcs</span>
              <span className="flex-none text-text-muted"><ChevronRight size={14} /></span>
            </button>
          ))}
        </div>
      ) : (
        <DeadlineTable po={selected} />
      )}
    </div>
  );
}

export default function ProduksiDeadlinePage() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const maklonPOs = useMrpStore((s) => s.maklonPOs);
  const mrpDetails = useMrpStore((s) => s.mrpDetails);
  const productionBatches = useMrpStore((s) => s.productionBatches);
  const productionResults = useMrpStore((s) => s.productionResults);
  const invoices = useMrpStore((s) => s.invoices);

  if (!mounted) return null;

  const approved = maklonPOs.filter((p) => p.approved);
  const mrpMap = new Map<string, MrpGroup>();
  for (const p of approved) {
    if (!mrpMap.has(p.mrpId)) mrpMap.set(p.mrpId, { mrpId: p.mrpId, vendorPOs: [] });
    mrpMap.get(p.mrpId)!.vendorPOs.push(p);
  }
  const rows = Array.from(mrpMap.values()).sort((a, b) => a.mrpId.localeCompare(b.mrpId));

  const columns: ColumnDef<MrpGroup>[] = [
    {
      key: "vendorCount",
      label: "Vendor",
      default: true,
      render: (g) => (g.vendorPOs.length === 1 ? (VENDOR_PRODUKSI[g.vendorPOs[0].vendorProduksi]?.name ?? g.vendorPOs[0].vendorProduksi) : `${g.vendorPOs.length} vendor`),
    },
    { key: "qty", label: "Total Qty", default: true, align: "right", render: (g) => formatPcs(g.vendorPOs.reduce((a, p) => a + p.qty, 0)) + " pcs" },
    {
      key: "status",
      label: "Status paling mendesak",
      default: true,
      render: (g) => {
        const worst = g.vendorPOs
          .flatMap((p) => deadlineRowsForPo(p, mrpDetails, productionBatches, productionResults, invoices))
          .filter((r) => r.deadline)
          .sort((a, b) => (a.daysLeft ?? 0) - (b.daysLeft ?? 0))[0];
        if (!worst) return <span className="font-sans text-[11px] text-text-muted">Menunggu bahan</span>;
        const status = statusFor(worst);
        return <StatusPill tone={status.tone}>{status.label}</StatusPill>;
      },
    },
  ];

  return (
    <AppShell
      role="produksi"
      activeHref="/produksi/deadline"
      breadcrumb={["Dashboard", "Deadline Produksi"]}
      title="Deadline Produksi"
      subtitle="Progres cutting & Finish Good per PO dibandingkan deadline (bahan diterima + lead time vendor)"
    >
      <DataTable
        title="MRP dengan PO vendor produksi"
        subtitle="Klik baris untuk pilih vendor, lalu lihat deadline & progres per warna/lengan"
        columns={columns}
        rows={rows}
        keyOf={(g) => g.mrpId}
        firstColumnLabel="No. MRP"
        firstColumnRender={(g) => <span className="font-mono">{g.mrpId}</span>}
        renderExpanded={(g) => <MrpVendorDrilldown group={g} />}
        filterDefs={[{ label: "No MRP", options: Array.from(new Set(rows.map((g) => g.mrpId))), test: (g, v) => g.mrpId === v }]}
        emptyText="Belum ada PO vendor produksi yang disetujui Finance."
      />
    </AppShell>
  );
}
