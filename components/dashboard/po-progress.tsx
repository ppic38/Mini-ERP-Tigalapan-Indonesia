"use client";

import { Fragment, useState } from "react";
import { Grid3x3, List } from "lucide-react";
import { DataTable, type FilterDef } from "@/components/mrp/data-table";
import type { MrpProgressRow } from "@/components/mrp/mrp-progress";
import { formatPcs } from "@/lib/mrp/derive";
import { FLOW_STAGES, flowRank, type FlowStage } from "@/lib/mrp/flowStatus";

/** "Progres PO hingga delivery" (owner 2026-11-17, sesuai gambar contoh): persentase roll tiap MRP yang sudah melewati 11 gate, dari PV sampai
 *  GR DC. Filter dan pencarian memakai kotak cari Odoo tabel bersama (`DataTable` dengan `body`), kartu dan matriks mengikuti filter.
 *  Angka dari `rollsByStage` (`useMrpProgressRows`), sama dengan Status MRP di PPIC dan SCM. */

type Gate = { label: string; from: FlowStage };
const GROUPS: { label: string; gates: Gate[] }[] = [
  { label: "PO & pembayaran", gates: [{ label: "PV", from: "PV Material" }, { label: "Paid", from: "Paid" }] },
  { label: "Material", gates: [{ label: "Kirim Mat.", from: "Delivery Material" }, { label: "Terima", from: "Receiving Material" }] },
  {
    label: "Produksi",
    gates: [
      { label: "Resting", from: "Resting" },
      { label: "Cutting", from: "Cutting" },
      { label: "FG", from: "Finish Good" },
      { label: "Done FG", from: "Done FG" },
    ],
  },
  { label: "Pengiriman", gates: [{ label: "Packing", from: "Packing" }, { label: "Delivery", from: "Delivery" }, { label: "GR DC", from: "GR DC" }] },
];
const GATES = GROUPS.flatMap((g) => g.gates);

const totalRolls = (r: MrpProgressRow) => Object.values(r.rollsByStage).reduce((s: number, n) => s + (n ?? 0), 0);
const rollsAtLeast = (by: Partial<Record<FlowStage, number>>, from: FlowStage) =>
  (Object.entries(by) as [FlowStage, number][]).filter(([st]) => flowRank(st) >= flowRank(from)).reduce((s, [, n]) => s + n, 0);
const pctOf = (list: MrpProgressRow[], from: FlowStage) => {
  const t = list.reduce((s, r) => s + totalRolls(r), 0);
  return t > 0 ? Math.round((list.reduce((s, r) => s + rollsAtLeast(r.rollsByStage, from), 0) / t) * 100) : 0;
};
/** Gate tempat roll paling banyak tertahan: penurunan persen terbesar dari gate sebelumnya. */
function bottleneck(r: MrpProgressRow): Gate | null {
  let best: Gate | null = null;
  let drop = 0;
  let prev = 100;
  for (const g of GATES) {
    const p = pctOf([r], g.from);
    if (prev - p > drop) {
      drop = prev - p;
      best = g;
    }
    prev = p;
  }
  return best;
}

/** Skala satu hue biru (terang -> gelap); 0% tanpa warna. */
function heat(p: number): { background: string; color: string } | null {
  if (p <= 0) return null;
  if (p >= 95) return { background: "#1E3F8A", color: "#FFFFFF" };
  if (p >= 80) return { background: "#2A5BC4", color: "#FFFFFF" };
  if (p >= 60) return { background: "#3D72D9", color: "#FFFFFF" };
  if (p >= 40) return { background: "#BFD5F7", color: "#0F2747" };
  return { background: "#DCE8FB", color: "#0F2747" };
}

function HeatCell({ p, title, bold }: { p: number; title: string; bold?: boolean }) {
  const st = heat(p);
  return (
    <td className="px-[3px] py-[5px]">
      <div
        title={title}
        className={"flex h-[30px] min-w-[54px] items-center justify-center rounded-[5px] font-mono text-[12px] tabular-nums " + (bold || (st && st.color === "#FFFFFF") ? "font-semibold" : "")}
        style={st ?? { color: "#6B7A8A" }}
      >
        {p}%
      </div>
    </td>
  );
}

export function PoProgress({ rows }: { rows: MrpProgressRow[] }) {
  const [shownIds, setShownIds] = useState<Set<string> | null>(null);
  const [view, setView] = useState<"matriks" | "ringkasan">("matriks");
  const [selected, setSelected] = useState<string | null>(null);
  const shown = shownIds ? rows.filter((r) => shownIds.has(r.mrp.id)) : rows;
  const roll = shown.reduce((s, r) => s + totalRolls(r), 0);
  const sel = shown.find((r) => r.mrp.id === selected) ?? shown[0];

  const uniq = (xs: string[]) => Array.from(new Set(xs.filter(Boolean))).sort();
  const filterDefs: FilterDef<MrpProgressRow>[] = [
    { label: "Status", options: (FLOW_STAGES as readonly string[]).filter((st) => rows.some((r) => r.stage === st)), test: (r, v) => r.stage === v },
    { label: "Tertahan di", options: GATES.map((g) => g.label).filter((l) => rows.some((r) => bottleneck(r)?.label === l)), test: (r, v) => bottleneck(r)?.label === v },
    { label: "Vendor", options: uniq(rows.flatMap((r) => r.vendors)), test: (r, v) => r.vendors.includes(v) },
    { label: "Kategori", options: uniq(rows.map((r) => r.mrp.kategori)), test: (r, v) => r.mrp.kategori === v },
    { label: "No. MRP", options: rows.map((r) => r.mrp.id), test: (r, v) => r.mrp.id === v },
  ];

  const card = (label: string, from: FlowStage, active = false) => (
    <div className={"rounded-lg border px-4 py-3 " + (active ? "border-[#C9D9F5] bg-info-bg" : "border-border-subtle bg-surface-card")}>
      <div className="font-sans text-[12px] font-medium text-text-muted">{label}</div>
      <div className={"mt-0.5 font-heading text-[28px] font-bold leading-tight tabular-nums " + (active ? "text-action-primary" : "text-text-primary")}>
        {pctOf(shown, from)}%<span className="ml-1 font-sans text-[12px] font-normal text-text-muted">roll</span>
      </div>
    </div>
  );

  const toggle = (
    <div className="flex rounded-md border border-border-subtle bg-white p-0.5">
      {(
        [
          ["ringkasan", "Ringkasan MRP", List],
          ["matriks", "Matriks 11 gate", Grid3x3],
        ] as const
      ).map(([k, label, Icon]) => (
        <button
          key={k}
          type="button"
          onClick={() => setView(k)}
          className={"flex items-center gap-1.5 rounded px-2.5 py-1 font-sans text-[12px] font-semibold " + (view === k ? "bg-info-bg text-action-primary" : "text-text-muted hover:text-text-primary")}
        >
          <Icon size={14} />
          {label}
        </button>
      ))}
    </div>
  );

  const mrpCell = (r: MrpProgressRow, sticky = true) => (
    <td className={(sticky ? "sticky left-0 z-10 " : "") + "bg-inherit py-2 pl-4 pr-3"}>
      <div className="max-w-[200px] break-all font-mono text-[12.5px] font-semibold text-action-primary">{r.mrp.id}</div>
      <div className="font-sans text-[11.5px] text-text-muted">{r.stage}</div>
    </td>
  );
  const rowCls = (r: MrpProgressRow) =>
    "cursor-pointer border-t border-[#EEF1F4] " + (sel?.mrp.id === r.mrp.id ? "bg-info-bg shadow-[inset_3px_0_0_var(--action-primary,#2563EB)]" : "bg-surface-card hover:bg-[#FAFBFC]");

  const matrix = (
    <div className="overflow-x-auto">
      <table className="w-full border-separate border-spacing-0 font-sans text-[12px] text-text-primary">
        <thead>
          <tr className="bg-[#F5F8FC]">
            <th rowSpan={2} className="sticky left-0 z-20 border-b border-r border-border-subtle bg-[#F5F8FC] py-2 pl-4 pr-3 text-left text-[12px] font-semibold text-text-muted">
              MRP / status
            </th>
            <th rowSpan={2} className="border-b border-r border-border-subtle px-3 text-center text-[12px] font-semibold text-text-muted">
              Roll
            </th>
            {GROUPS.map((g, i) => (
              <th key={g.label} colSpan={g.gates.length} className={"border-b border-border-subtle py-2 text-center text-[12px] font-semibold text-action-primary " + (i < GROUPS.length - 1 ? "border-r" : "")}>
                {g.label}
              </th>
            ))}
          </tr>
          <tr className="bg-[#F5F8FC]">
            {GROUPS.map((g, gi) =>
              g.gates.map((gate, i) => (
                <th
                  key={gate.from}
                  className={"border-b border-border-subtle px-1 py-2 text-center text-[11.5px] font-semibold text-text-muted " + (i === g.gates.length - 1 && gi < GROUPS.length - 1 ? "border-r" : "")}
                >
                  {gate.label}
                </th>
              ))
            )}
          </tr>
        </thead>
        <tbody>
          {shown.map((r) => {
            const t = totalRolls(r);
            return (
              <tr key={r.mrp.id} className={rowCls(r)} onClick={() => setSelected(r.mrp.id)}>
                {mrpCell(r)}
                <td className="border-r border-[#EEF1F4] px-3 text-center font-mono tabular-nums">{formatPcs(t)}</td>
                {GATES.map((g) => {
                  const n = rollsAtLeast(r.rollsByStage, g.from);
                  return <HeatCell key={g.from} p={t ? Math.round((n / t) * 100) : 0} title={`${r.mrp.id} · ${g.label}: ${formatPcs(n)} dari ${formatPcs(t)} roll`} />;
                })}
              </tr>
            );
          })}
          {shown.length > 1 && (
            <tr className="border-t border-border-subtle bg-surface-card">
              <td className="sticky left-0 z-10 bg-surface-card py-2 pl-4 pr-3 font-sans text-[12.5px] font-semibold">Total cuplikan</td>
              <td className="border-r border-[#EEF1F4] px-3 text-center font-mono font-semibold tabular-nums">{formatPcs(roll)}</td>
              {GATES.map((g) => (
                <HeatCell key={g.from} p={pctOf(shown, g.from)} title={`Semua MRP tampil · ${g.label}`} bold />
              ))}
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );

  const summary = (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] border-collapse font-sans text-[12.5px] text-text-primary">
        <thead>
          <tr className="bg-[#F5F8FC] text-[11.5px] font-semibold text-text-muted">
            <th className="py-2 pl-4 pr-3 text-left">MRP / status</th>
            <th className="px-3 text-right">Roll</th>
            {GROUPS.map((g) => (
              <th key={g.label} className="px-3 text-right">
                {g.label}
              </th>
            ))}
            <th className="px-3 text-left">Tertahan di</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((r) => {
            const b = bottleneck(r);
            return (
              <tr key={r.mrp.id} className={rowCls(r)} onClick={() => setSelected(r.mrp.id)}>
                {mrpCell(r, false)}
                <td className="px-3 text-right font-mono tabular-nums">{formatPcs(totalRolls(r))}</td>
                {GROUPS.map((g) => (
                  <td key={g.label} className="px-3 text-right font-mono tabular-nums">
                    {pctOf([r], g.gates[g.gates.length - 1].from)}%
                  </td>
                ))}
                <td className="px-3">{b ? `${b.label} (${pctOf([r], b.from)}%)` : "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );

  const detail = sel && (
    <div className="border-t border-border-subtle bg-[#F5F8FC]">
      <div className="px-4 pb-3 pt-4">
        <div className="font-sans text-[12px] font-semibold text-text-muted">Detail MRP</div>
        <div className="mt-0.5 font-mono text-[18px] font-semibold text-action-primary">{sel.mrp.id}</div>
        <div className="font-sans text-[12px] text-text-muted">
          {formatPcs(totalRolls(sel))} roll · {sel.stage}
          {sel.vendors.length > 0 && ` · ${sel.vendors.join(", ")}`}
        </div>
      </div>
      <div className="grid gap-2.5 border-t border-border-subtle bg-surface-card p-3 sm:grid-cols-2 xl:grid-cols-[1fr_1fr_1.6fr_1.3fr]">
        {GROUPS.map((g) => {
          const b = bottleneck(sel);
          return (
            <div key={g.label} className="rounded-md border border-border-subtle p-2.5">
              <div className="mb-2 font-sans text-[12.5px] font-semibold text-text-primary">{g.label}</div>
              <div className="flex gap-1.5">
                {g.gates.map((gate) => {
                  const isB = b?.from === gate.from;
                  return (
                    <div key={gate.from} className={"min-w-0 flex-1 rounded-md px-1.5 py-1.5 text-center " + (isB ? "bg-info-bg" : "bg-[#F7F9FB]")} title={isB ? "Gate dengan penurunan terbesar (tertahan di sini)" : undefined}>
                      <div className="truncate font-sans text-[11.5px] text-text-muted">{gate.label}</div>
                      <div className={"font-mono text-[13px] font-semibold tabular-nums " + (isB ? "text-action-primary" : "text-text-primary")}>{pctOf([sel], gate.from)}%</div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-x-3 gap-y-1">
        <div>
          <div className="font-heading text-[20px] font-bold tracking-tight text-text-primary">Progres PO hingga delivery</div>
          <div className="font-sans text-[12px] text-text-muted">
            {shown.length} MRP dalam cuplikan · {formatPcs(roll)} roll
          </div>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {card("Material diterima", "Receiving Material")}
        {card("Delivery", "Delivery", true)}
        {card("GR DC", "GR DC")}
      </div>
      <DataTable<MrpProgressRow>
        title="Seluruh gate MRP"
        subtitle="Persentase roll yang sudah melewati gate"
        headerActions={toggle}
        columns={[]}
        rows={rows}
        keyOf={(r) => r.mrp.id}
        firstColumnLabel="MRP"
        firstColumnRender={(r) => r.mrp.id}
        filterDefs={filterDefs}
        search={{ placeholder: "Cari MRP, vendor, kategori…", getText: (r) => `${r.mrp.id} ${r.mrp.kategori} ${r.vendors.join(" ")} ${r.stage}` }}
        onFilteredRows={(list) => setShownIds(new Set(list.map((r) => r.mrp.id)))}
        body={
          shown.length === 0 ? (
            <div className="px-4 py-8 text-center font-sans text-xs text-text-muted">Tidak ada MRP untuk filter ini.</div>
          ) : (
            <Fragment>
              {view === "matriks" ? matrix : summary}
              {detail}
            </Fragment>
          )
        }
        emptyText="Tidak ada MRP aktif."
      />
    </div>
  );
}
