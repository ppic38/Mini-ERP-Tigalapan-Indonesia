"use client";

import { useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { Button } from "@/components/ui/button";
import { DataTable, type ColumnDef } from "@/components/mrp/data-table";
import { MultiSelectFilter } from "@/components/mrp/multi-select-filter";
import { useMrpStore } from "@/lib/mrp/store";
import { formatPcs } from "@/lib/mrp/derive";
import { VENDOR_PRODUKSI } from "@/lib/mrp/seed";
import { buildItemTracking, itemWithBreakdown, lenganShort, type ItemTrackRow } from "@/lib/mrp/itemTracking";

const vendorLabel = (id: string) => (id ? VENDOR_PRODUKSI[id]?.name ?? id : "Belum dialokasikan");
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const selectCls = "rounded-md border border-border-subtle bg-white px-2.5 py-[6px] font-sans text-[11.5px] font-medium text-[#31414F]";
const num = "px-3 py-2 text-right font-mono";

type Tone = "blue" | "teal" | "orange" | "green";
const TONE: Record<Tone, string> = {
  blue: "border-[#9CB8E8] bg-[#EEF4FF] text-[#1E4FA3]",
  teal: "border-[#8FD3C8] bg-[#ECFAF7] text-[#13776A]",
  orange: "border-[#EBC08A] bg-[#FFF6E8] text-[#9A5B0C]",
  green: "border-[#9AD4AE] bg-[#EDFAF1] text-[#1B7A3C]",
};

function StageCard({ no, label, value, sub, tone }: { no: number; label: string; value: number; sub?: string; tone: Tone }) {
  return (
    <div className={"rounded-lg border-2 px-4 py-3 " + TONE[tone]}>
      <div className="font-sans text-[11.5px] font-semibold">{no}. {label}</div>
      <div className="mt-1.5 font-sans text-[26px] font-bold leading-none">{formatPcs(value)}</div>
      <div className="mt-1.5 font-sans text-[10.5px] opacity-75">{sub ?? "pcs"}</div>
    </div>
  );
}

/** Kartu tahapan satu set item: rencana, produksi, lalu pengiriman. */
function StageCards({ rows }: { rows: ItemTrackRow[] }) {
  const t = (k: "target" | "cutting" | "fg" | "reject" | "diKoli" | "dikirim" | "diterima") => sum(rows.map((r) => r[k]));
  const mrps = new Set(rows.flatMap((r) => r.mrpIds)).size;
  const items = rows.length;
  const pct = t("target") > 0 ? Math.round((t("fg") / t("target")) * 100) : 0;
  return (
    <div className="flex flex-col gap-3">
      <div>
        <div className="mb-1.5 font-sans text-[10.5px] font-bold uppercase tracking-wider text-[#1E4FA3]">Rencana dan produksi</div>
        <div className="grid grid-cols-4 gap-3 max-lg:grid-cols-2 max-sm:grid-cols-1">
          <StageCard no={1} label="Target MRP" value={t("target")} sub={`pcs · ${items} item · ${mrps} MRP`} tone="blue" />
          <StageCard no={2} label="Sudah dicutting" value={t("cutting")} sub={`pcs · ${t("target") > 0 ? Math.round((t("cutting") / t("target")) * 100) : 0}% dari target`} tone="blue" />
          <StageCard no={3} label="Finish Good" value={t("fg")} sub={`pcs · ${pct}% dari target`} tone="teal" />
          <StageCard no={4} label="Reject" value={t("reject")} sub="pcs" tone="orange" />
        </div>
      </div>
      <div>
        <div className="mb-1.5 font-sans text-[10.5px] font-bold uppercase tracking-wider text-[#9A5B0C]">Pengiriman</div>
        <div className="grid grid-cols-3 gap-3 max-lg:grid-cols-1">
          <StageCard no={5} label="Sudah masuk koli, belum dikirim" value={t("diKoli")} tone="orange" />
          <StageCard no={6} label="Dikirim vendor" value={t("dikirim")} sub={`pcs · belum dikirim dari FG: ${formatPcs(Math.max(0, t("fg") - t("dikirim") - t("diKoli")))}`} tone="orange" />
          <StageCard no={7} label="Diterima gudang" value={t("diterima")} sub={`pcs · dalam perjalanan: ${formatPcs(Math.max(0, t("dikirim") - t("diterima")))}`} tone="green" />
        </div>
      </div>
    </div>
  );
}

function ItemDetailModal({ item, onClose }: { item: ItemTrackRow; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0B131B]/45 p-4" onClick={onClose}>
      <div className="flex max-h-[88vh] w-full max-w-[1100px] flex-col overflow-hidden rounded-lg bg-white shadow-[0_8px_24px_rgba(11,19,27,.25)]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 border-b border-border-subtle px-5 py-3.5">
          <div>
            <div className="font-sans text-[16px] font-bold text-text-primary">{item.itemName}</div>
            <div className="mt-0.5 font-sans text-[11px] text-text-muted">
              {item.kategori.join(", ") || "-"} · {item.lengan === "PENDEK" ? "Pendek" : "Panjang"} · Ukuran {item.size} · {item.mrpIds.length} MRP
            </div>
          </div>
          <button onClick={onClose} className="rounded-md border border-[#CBD5DF] bg-white px-3 py-[6px] font-sans text-xs font-semibold text-action-primary">
            Tutup
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">
          <StageCards rows={[item]} />
          <div className="mt-4 font-sans text-[12px] font-semibold text-text-primary">Rincian per MRP dan vendor</div>
          <div className="mt-2 overflow-x-auto rounded-md border border-[#E4E9EE]">
            <table className="w-full border-collapse font-sans text-[11.5px]">
              <thead className="bg-info-bg text-[10.5px] font-medium uppercase tracking-wider text-info-fg">
                <tr>
                  <th className="px-3 py-2 text-left">No. MRP</th>
                  <th className="px-3 py-2 text-left">Vendor</th>
                  <th className="px-3 py-2 text-left">Kategori</th>
                  <th className="px-3 py-2 text-right">Target</th>
                  <th className="px-3 py-2 text-right">Cutting</th>
                  <th className="px-3 py-2 text-right">FG</th>
                  <th className="px-3 py-2 text-right">Reject</th>
                  <th className="px-3 py-2 text-right">Di koli</th>
                  <th className="px-3 py-2 text-right">Dikirim</th>
                  <th className="px-3 py-2 text-right">Diterima gudang</th>
                </tr>
              </thead>
              <tbody>
                {item.breakdown.map((b) => (
                  <tr key={b.key} className="border-t border-[#EEF1F4]">
                    <td className="px-3 py-2 font-mono">{b.mrpId}</td>
                    <td className={"px-3 py-2 " + (b.vendorProduksi ? "" : "text-text-muted")}>{vendorLabel(b.vendorProduksi)}</td>
                    <td className="px-3 py-2 text-text-muted">{b.kategori || "-"}</td>
                    <td className={num}>{formatPcs(b.alokasi)}</td>
                    <td className={num}>{formatPcs(b.cutting)}</td>
                    <td className={num}>{formatPcs(b.fg)}</td>
                    <td className={num}>{formatPcs(b.reject)}</td>
                    <td className={num}>{formatPcs(b.diKoli)}</td>
                    <td className={num}>{formatPcs(b.dikirim)}</td>
                    <td className={num}>{formatPcs(b.diterima)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t-2 border-border-subtle bg-[#F2F5F8] font-semibold">
                <tr>
                  <td className="px-3 py-2" colSpan={3}>Total</td>
                  <td className={num}>{formatPcs(item.target)}</td>
                  <td className={num}>{formatPcs(item.cutting)}</td>
                  <td className={num}>{formatPcs(item.fg)}</td>
                  <td className={num}>{formatPcs(item.reject)}</td>
                  <td className={num}>{formatPcs(item.diKoli)}</td>
                  <td className={num}>{formatPcs(item.dikirim)}</td>
                  <td className={num}>{formatPcs(item.diterima)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Isi halaman Tracking Item, dipakai PPIC dan SCM (data sama, hanya pembungkus halaman yang beda). */
export function ItemTrackingView() {
  const mrpDetails = useMrpStore((s) => s.mrpDetails);
  const productionBatches = useMrpStore((s) => s.productionBatches);
  const productionResults = useMrpStore((s) => s.productionResults);
  const deliveryKolis = useMrpStore((s) => s.deliveryKolis);
  const warehouseReceipts = useMrpStore((s) => s.warehouseReceipts);

  const [q, setQ] = useState("");
  const [warna, setWarna] = useState<string[]>([]);
  const [lengan, setLengan] = useState<string[]>([]);
  const [size, setSize] = useState<string[]>([]);
  const [kategori, setKategori] = useState<string[]>([]);
  const [mrp, setMrp] = useState<string[]>([]);
  const [vendor, setVendor] = useState<string[]>([]);
  const [detailKey, setDetailKey] = useState<string | null>(null);

  const all = useMemo(
    () => buildItemTracking(mrpDetails, productionBatches, productionResults, deliveryKolis, warehouseReceipts),
    [mrpDetails, productionBatches, productionResults, deliveryKolis, warehouseReceipts]
  );

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const out: ItemTrackRow[] = [];
    for (const it of all) {
      if (warna.length > 0 && !warna.includes(it.warna)) continue;
      if (lengan.length > 0 && !lengan.includes(it.lengan === "PENDEK" ? "Pendek" : "Panjang")) continue;
      if (size.length > 0 && !size.includes(it.size)) continue;
      if (needle && !it.itemName.toLowerCase().includes(needle) && !it.warna.toLowerCase().includes(needle)) continue;
      const bd = it.breakdown.filter(
        (b) => (mrp.length === 0 || mrp.includes(b.mrpId)) && (vendor.length === 0 || vendor.includes(vendorLabel(b.vendorProduksi))) && (kategori.length === 0 || kategori.includes(b.kategori))
      );
      if (bd.length === 0) continue;
      out.push(bd.length === it.breakdown.length ? it : itemWithBreakdown(it, bd));
    }
    return out;
  }, [all, q, warna, lengan, size, kategori, mrp, vendor]);

  const detail = detailKey ? rows.find((r) => r.key === detailKey) : undefined;
  const hasFilter = !!q.trim() || warna.length + lengan.length + size.length + kategori.length + mrp.length + vendor.length > 0;

  const opt = (xs: string[]) => Array.from(new Set(xs.filter(Boolean))).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const allBreakdown = all.flatMap((i) => i.breakdown);

  function exportExcel() {
    const wb = XLSX.utils.book_new();
    const summary = rows.map((r) => ({
      Item: r.itemName, Kategori: r.kategori.join(", "), Warna: r.warna, Lengan: r.lengan === "PENDEK" ? "Pendek" : "Panjang", Size: r.size,
      "Target MRP": r.target, Cutting: r.cutting, "Finish Good": r.fg, Reject: r.reject, "Di koli (belum dikirim)": r.diKoli, Dikirim: r.dikirim, "Diterima gudang": r.diterima, "Sisa produksi": r.sisaProduksi,
    }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summary), "Ringkasan per item");
    const detailRows = rows.flatMap((r) =>
      r.breakdown.map((b) => ({
        Item: r.itemName, "No. MRP": b.mrpId, Vendor: vendorLabel(b.vendorProduksi), Kategori: b.kategori, Target: b.alokasi, Cutting: b.cutting, "Finish Good": b.fg, Reject: b.reject,
        "Di koli (belum dikirim)": b.diKoli, Dikirim: b.dikirim, "Diterima gudang": b.diterima,
      }))
    );
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(detailRows), "Rincian per MRP dan vendor");
    XLSX.writeFile(wb, "Tracking-Item.xlsx");
  }

  const columns: ColumnDef<ItemTrackRow>[] = [
    { key: "kategori", label: "Kategori", default: true, render: (r) => r.kategori.join(", ") || "-" },
    { key: "mrp", label: "MRP", default: false, render: (r) => r.mrpIds.join(", ") },
    { key: "target", label: "Target MRP", default: true, align: "right", render: (r) => formatPcs(r.target) },
    { key: "cutting", label: "Cutting", default: true, align: "right", render: (r) => formatPcs(r.cutting) },
    { key: "fg", label: "Finish Good", default: true, align: "right", render: (r) => <span className="font-semibold">{formatPcs(r.fg)}</span> },
    { key: "pct", label: "% FG", default: true, align: "right", render: (r) => (r.target > 0 ? `${Math.round((r.fg / r.target) * 100)}%` : "-") },
    { key: "reject", label: "Reject", default: false, align: "right", render: (r) => formatPcs(r.reject) },
    { key: "diKoli", label: "Di koli", default: true, align: "right", render: (r) => formatPcs(r.diKoli) },
    { key: "dikirim", label: "Dikirim", default: true, align: "right", render: (r) => formatPcs(r.dikirim) },
    { key: "diterima", label: "Diterima gudang", default: true, align: "right", render: (r) => formatPcs(r.diterima) },
    { key: "sisa", label: "Sisa produksi", default: true, align: "right", render: (r) => formatPcs(r.sisaProduksi) },
  ];

  return (
    <>
      <div className="rounded-lg border border-border-subtle bg-surface-card">
        <div className="flex flex-wrap items-center gap-2 rounded-lg px-5 py-3">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari item, mis. HITAM 24S PDK L" className={selectCls + " min-w-[260px] flex-1 max-w-[380px] font-normal"} />
          <MultiSelectFilter label="Warna" options={opt(all.map((i) => i.warna))} value={warna} onChange={setWarna} />
          <MultiSelectFilter label="Lengan" options={["Pendek", "Panjang"]} value={lengan} onChange={setLengan} />
          <MultiSelectFilter label="Size" options={opt(all.map((i) => i.size))} value={size} onChange={setSize} />
          <MultiSelectFilter label="Kategori" options={opt(allBreakdown.map((b) => b.kategori))} value={kategori} onChange={setKategori} />
          <MultiSelectFilter label="No. MRP" options={opt(allBreakdown.map((b) => b.mrpId)).reverse()} value={mrp} onChange={setMrp} />
          <MultiSelectFilter label="Vendor" options={opt(allBreakdown.map((b) => vendorLabel(b.vendorProduksi)))} value={vendor} onChange={setVendor} />
          {hasFilter && (
            <button
              onClick={() => {
                setQ("");
                setWarna([]);
                setLengan([]);
                setSize([]);
                setKategori([]);
                setMrp([]);
                setVendor([]);
              }}
              className="font-sans text-[11.5px] font-semibold text-action-primary underline"
            >
              Hapus filter
            </button>
          )}
        </div>
      </div>

      <div className="mt-4">
        <StageCards rows={rows} />
      </div>

      <div className="mt-4">
        <DataTable
          title="Tracking per item"
          headerActions={
            <Button onClick={exportExcel} disabled={rows.length === 0} variant="muted" size="xs">
              Export Excel
            </Button>
          }
          columns={columns}
          rows={rows}
          keyOf={(r) => r.key}
          firstColumnLabel="Item"
          firstColumnRender={(r) => (
            <span className="font-semibold">
              {r.warna} <span className="text-text-muted">{lenganShort(r.lengan)}</span> {r.size}
            </span>
          )}
          onRowClick={(r) => setDetailKey(r.key)}
          emptyText="Belum ada item untuk filter ini."
          bodyMaxHeight="60vh"
        />
      </div>
      {detail && <ItemDetailModal item={detail} onClose={() => setDetailKey(null)} />}
    </>
  );
}
