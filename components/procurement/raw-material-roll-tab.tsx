"use client";

import { useMemo, useState } from "react";
import { KpiCard } from "@/components/ui/kpi-card";
import { StatusPill } from "@/components/ui/status-pill";
import { DataTable, aggSame, aggSum, type ColumnDef, type FilterDef } from "@/components/mrp/data-table";
import { useMrpStore } from "@/lib/mrp/store";
import { formatDate, formatRupiah, poDisplayNo } from "@/lib/mrp/derive";
import { VENDOR_PRODUKSI } from "@/lib/mrp/seed";
import { RM_ROLL_POSITIONS, RM_ROLL_STATUSES, buildRawMaterialRolls, type RmRollRow } from "@/lib/mrp/rawMaterialRolls";

const vendorName = (id: string) => VENDOR_PRODUKSI[id]?.name ?? id;
const rp = (n: number) => formatRupiah(Math.round(n));
const kgFmt = (n: number) => n.toLocaleString("id-ID", { maximumFractionDigits: 1 });
const uniq = (xs: string[]) => Array.from(new Set(xs.filter(Boolean))).sort((a, b) => a.localeCompare(b, "id-ID"));
const bold = (s: string) => <span className="font-semibold">{s}</span>;

const STATUS_TONE: Record<string, "neutral" | "warning" | "info" | "rework" | "success" | "danger"> = {
  "PO, belum invoice": "neutral",
  "Belum dibayar": "warning",
  "Belum diterima vendor": "info",
  "Di vendor": "info",
  Resting: "rework",
  "Cutting & FG": "rework",
  "Roll ditutup": "rework",
  "Sudah delivery": "success",
  Diretur: "danger",
};

/** Tab "Per Roll" halaman Raw Material: gabungan Raw Material (nilai, diskon, kategori, benang) dan Posisi Stok (tahap fisik, porsi terkirim). */
export function RawMaterialRollTab() {
  const materialPOs = useMrpStore((s) => s.materialPOs);
  const invoices = useMrpStore((s) => s.invoices);
  const productionBatches = useMrpStore((s) => s.productionBatches);
  const deliveryKolis = useMrpStore((s) => s.deliveryKolis);
  const claims = useMrpStore((s) => s.materialClaimHistory);
  const mrpDetails = useMrpStore((s) => s.mrpDetails);

  const rows = useMemo(
    () => buildRawMaterialRolls(materialPOs, invoices, productionBatches, deliveryKolis, claims, mrpDetails),
    [materialPOs, invoices, productionBatches, deliveryKolis, claims, mrpDetails]
  );
  const [shownKeys, setShownKeys] = useState<Set<string> | null>(null);
  const [preset, setPreset] = useState<{ nonce: number; filters: Record<string, string[]>; card: string }>({ nonce: 0, filters: {}, card: "" });

  const shown = shownKeys ? rows.filter((r) => shownKeys.has(r.key)) : rows;
  const bucket = (pos: string) => {
    const list = shown.filter((r) => r.position === pos);
    return { roll: list.length, nilai: list.reduce((s, r) => s + r.nilaiStok, 0), kg: list.reduce((s, r) => s + r.beratKotor, 0) };
  };
  const belumBayar = bucket("Belum dibayar");
  const belumProd = bucket("Belum produksi");
  const proses = bucket("Proses produksi");
  const terkirimNilai = shown.reduce((s, r) => s + r.nilaiTerkirim, 0);
  const terkirimRoll = shown.filter((r) => r.position === "Sudah delivery").length;

  const cardClick = (pos: string) =>
    setPreset((p) => (p.card === pos ? { nonce: p.nonce + 1, filters: {} as Record<string, string[]>, card: "" } : { nonce: p.nonce + 1, filters: { Posisi: [pos] }, card: pos }));

  const filterDefs: FilterDef<RmRollRow>[] = [
    { label: "Posisi", options: RM_ROLL_POSITIONS.filter((p) => rows.some((r) => r.position === p)), test: (r, v) => r.position === v },
    { label: "Status", options: RM_ROLL_STATUSES.filter((s) => rows.some((r) => r.status === s)), test: (r, v) => r.status === v },
    { label: "No. MRP", options: uniq(rows.map((r) => r.mrpId)).reverse(), test: (r, v) => r.mrpId === v },
    { label: "Vendor", options: uniq(rows.map((r) => vendorName(r.vendorProduksi))), test: (r, v) => vendorName(r.vendorProduksi) === v },
    { label: "Supplier", options: uniq(rows.map((r) => r.supplier)), test: (r, v) => r.supplier === v },
    { label: "Kategori produk", options: uniq(rows.map((r) => r.kategori)), test: (r, v) => r.kategori === v },
    { label: "Benang", options: uniq(rows.map((r) => r.benang)), test: (r, v) => r.benang === v },
    { label: "Warna", options: uniq(rows.map((r) => r.warna)), test: (r, v) => r.warna === v },
    { label: "Lengan", options: ["PENDEK", "PANJANG"], test: (r, v) => r.lengan === v },
    { label: "Entitas", options: uniq(rows.map((r) => r.entitas)), test: (r, v) => r.entitas === v },
    { label: "Bulan invoice", options: uniq(rows.map((r) => r.invoiceAt?.slice(0, 7) ?? "")).reverse(), test: (r, v) => r.invoiceAt?.slice(0, 7) === v },
  ];

  const columns: ColumnDef<RmRollRow>[] = [
    { key: "mrp", label: "No. MRP", default: true, aggregate: aggSame((r) => r.mrpId), render: (r) => <span className="font-mono">{r.mrpId}</span> },
    { key: "vendor", label: "Vendor", default: true, aggregate: aggSame((r) => vendorName(r.vendorProduksi)), render: (r) => vendorName(r.vendorProduksi) },
    { key: "supplier", label: "Supplier", default: true, aggregate: aggSame((r) => r.supplier), render: (r) => r.supplier },
    { key: "po", label: "No PO", default: false, render: (r) => <span className="font-mono" title={r.poId}>{poDisplayNo(r.poId, r.entitas)}</span> },
    { key: "entitas", label: "Entitas", default: false, aggregate: aggSame((r) => r.entitas), render: (r) => r.entitas || "—" },
    { key: "invoice", label: "No Invoice", default: false, render: (r) => <span className="font-mono">{r.noInvoice || "—"}</span> },
    { key: "warna", label: "Warna", default: true, aggregate: aggSame((r) => r.warna), render: (r) => r.warna },
    { key: "lengan", label: "Lengan", default: true, aggregate: aggSame((r) => r.lengan), render: (r) => (r.lengan === "PENDEK" ? "PDK" : "PJG") },
    { key: "kategori", label: "Kategori produk", default: false, aggregate: aggSame((r) => r.kategori), render: (r) => r.kategori },
    { key: "benang", label: "Benang", default: false, aggregate: aggSame((r) => r.benang), render: (r) => r.benang },
    {
      key: "kotor",
      label: "Berat kotor (kg)",
      default: true,
      align: "right",
      aggregate: aggSum((r) => r.beratKotor, (n) => bold(kgFmt(n))),
      render: (r) => <span className="font-mono" title={r.estimasi ? "Estimasi dari PO (belum ada invoice)" : undefined}>{r.estimasi ? "≈" : ""}{kgFmt(r.beratKotor)}</span>,
    },
    { key: "bersih", label: "Berat bersih (kg)", default: false, align: "right", aggregate: aggSum((r) => r.beratBersih ?? 0, (n) => bold(kgFmt(n))), render: (r) => <span className="font-mono">{r.beratBersih != null ? kgFmt(r.beratBersih) : "—"}</span> },
    { key: "harga", label: "Harga/kg", default: false, align: "right", render: (r) => <span className="font-mono">{r.hargaPerKg ? rp(r.hargaPerKg) : "—"}</span> },
    { key: "sebelum", label: "Nilai sebelum diskon", default: false, align: "right", aggregate: aggSum((r) => r.nilaiSebelumDiskon, (n) => bold(rp(n))), render: (r) => <span className="font-mono">{rp(r.nilaiSebelumDiskon)}</span> },
    { key: "diskon", label: "Diskon", default: false, align: "right", aggregate: aggSum((r) => r.diskon, (n) => bold(rp(n))), render: (r) => <span className="font-mono">{rp(r.diskon)}</span> },
    {
      key: "nilai",
      label: "Nilai",
      default: true,
      align: "right",
      aggregate: aggSum((r) => r.nilai, (n) => bold(rp(n))),
      render: (r) => <span className="font-mono" title={r.estimasi ? "Estimasi: nilai PO dibagi jumlah roll PO" : "Harga/kg x berat kotor, setelah diskon invoice"}>{r.estimasi ? "≈" : ""}{rp(r.nilai)}</span>,
    },
    { key: "terkirim", label: "Nilai terkirim", default: true, align: "right", aggregate: aggSum((r) => r.nilaiTerkirim, (n) => bold(rp(n))), render: (r) => <span className="font-mono">{r.nilaiTerkirim > 0 ? rp(r.nilaiTerkirim) : "—"}</span> },
    { key: "stok", label: "Nilai stok", default: true, align: "right", aggregate: aggSum((r) => r.nilaiStok, (n) => bold(rp(n))), render: (r) => <span className="font-mono">{rp(r.nilaiStok)}</span> },
    { key: "pcs", label: "Pcs belum kirim", default: false, align: "right", aggregate: aggSum((r) => r.pcsBelumKirim, (n) => bold(n.toLocaleString("id-ID"))), render: (r) => <span className="font-mono">{r.pcsBelumKirim || "—"}</span> },
    {
      key: "status",
      label: "Status",
      default: true,
      aggregate: aggSame((r) => r.status, (v) => <StatusPill tone={STATUS_TONE[v] ?? "neutral"}>{v}</StatusPill>),
      render: (r) => <StatusPill tone={STATUS_TONE[r.status] ?? "neutral"}>{r.status}</StatusPill>,
    },
    { key: "tglPo", label: "Tgl PO", default: false, render: (r) => formatDate(r.poAt) },
    { key: "tglInvoice", label: "Tgl Invoice", default: false, render: (r) => formatDate(r.invoiceAt) },
    { key: "tglBayar", label: "Tgl Bayar", default: true, render: (r) => formatDate(r.paidAt) },
    { key: "tglDelivery", label: "Tgl Delivery", default: false, render: (r) => formatDate(r.deliveryAt) },
    { key: "tglGr", label: "Tgl GR", default: false, render: (r) => formatDate(r.grAt) },
    { key: "tglResting", label: "Tgl Resting", default: false, render: (r) => formatDate(r.restingAt) },
    { key: "tglCutting", label: "Tgl Cutting", default: false, render: (r) => formatDate(r.cuttingAt) },
    { key: "tglTutup", label: "Tgl Tutup Roll", default: false, render: (r) => formatDate(r.closedAt) },
  ];

  return (
    <>
      {/* Kartu angka sama pengelompokan Posisi Stok Finance; mengikuti filter tabel, diklik = filter Posisi. */}
      <div className="grid grid-cols-4 gap-3 max-lg:grid-cols-2">
        <KpiCard label="Belum dibayar" value={rp(belumBayar.nilai)} valueClassName="text-[20px]" sub={`${belumBayar.roll} roll · PO dan invoice belum lunas`} accent="orange" active={preset.card === "Belum dibayar"} onClick={() => cardClick("Belum dibayar")} />
        <KpiCard label="Belum produksi" value={rp(belumProd.nilai)} valueClassName="text-[20px]" sub={`${belumProd.roll} roll · ${kgFmt(belumProd.kg)} kg belum resting`} accent="blue" active={preset.card === "Belum produksi"} onClick={() => cardClick("Belum produksi")} />
        <KpiCard label="Proses produksi" value={rp(proses.nilai)} valueClassName="text-[20px]" sub={`${proses.roll} roll · porsi belum terkirim`} accent="purple" active={preset.card === "Proses produksi"} onClick={() => cardClick("Proses produksi")} />
        <KpiCard label="Sudah delivery" value={rp(terkirimNilai)} valueClassName="text-[20px]" sub={`${terkirimRoll} roll terkirim penuh`} accent="teal" active={preset.card === "Sudah delivery"} onClick={() => cardClick("Sudah delivery")} />
      </div>

      <DataTable<RmRollRow>
        title="Raw material per roll"
        subtitle="Dari PO sampai terkirim; roll yang belum diinvoice memakai estimasi dari PO (≈)"
        columns={columns}
        rows={rows}
        keyOf={(r) => r.key}
        firstColumnLabel="Code Roll"
        firstColumnRender={(r) => (r.codeRoll ? <span className="font-mono font-medium">{r.codeRoll}</span> : <span className="font-mono text-text-muted">roll {r.no}</span>)}
        filterDefs={filterDefs}
        filterPreset={preset}
        defaultGroupBy={["No. MRP", "Vendor"]}
        search={{ placeholder: "Cari code roll, MRP, PO, invoice, supplier, vendor, warna…", getText: (r) => `${r.codeRoll} ${r.mrpId} ${r.poId} ${r.noInvoice} ${r.supplier} ${vendorName(r.vendorProduksi)} ${r.warna} ${r.status}` }}
        onFilteredRows={(list) => setShownKeys(new Set(list.map((r) => r.key)))}
        emptyText="Belum ada roll untuk filter ini."
      />
    </>
  );
}
