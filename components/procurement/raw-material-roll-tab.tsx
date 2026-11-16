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
const intFmt = (n: number) => Math.round(n).toLocaleString("id-ID");
const uniq = (xs: string[]) => Array.from(new Set(xs.filter(Boolean))).sort((a, b) => a.localeCompare(b, "id-ID"));
const bold = (s: string) => <span className="font-semibold">{s}</span>;

const STATUS_TONE: Record<string, "neutral" | "warning" | "info" | "rework" | "success" | "danger"> = {
  Dibayar: "warning",
  "Dikirim supplier": "info",
  "Diterima vendor": "info",
  Resting: "rework",
  "Cutting & FG": "rework",
  "Roll ditutup": "rework",
  "Sudah delivery": "success",
  Diretur: "danger",
};

/** Tabel material per roll yang SUDAH DIBAYAR. Dipakai Procurement > Raw Material (`focus="roll"`: kartu dan kolom bawaan dalam roll dan kg)
 *  dan Finance > Posisi Stok (`focus="nilai"`: kartu dan kolom bawaan dalam rupiah). Kolom, filter, dan isi tabel sama; hanya bawaannya beda. */
export function RawMaterialRollTab({ focus }: { focus: "roll" | "nilai" }) {
  const invoices = useMrpStore((s) => s.invoices);
  const productionBatches = useMrpStore((s) => s.productionBatches);
  const deliveryKolis = useMrpStore((s) => s.deliveryKolis);
  const claims = useMrpStore((s) => s.materialClaimHistory);
  const mrpDetails = useMrpStore((s) => s.mrpDetails);

  const rows = useMemo(
    () => buildRawMaterialRolls(invoices, productionBatches, deliveryKolis, claims, mrpDetails),
    [invoices, productionBatches, deliveryKolis, claims, mrpDetails]
  );
  const [shownKeys, setShownKeys] = useState<Set<string> | null>(null);
  const [preset, setPreset] = useState<{ nonce: number; filters: Record<string, string[]>; card: string }>({ nonce: 0, filters: {}, card: "" });

  const shown = shownKeys ? rows.filter((r) => shownKeys.has(r.key)) : rows;
  const of = (pos: string) => shown.filter((r) => r.position === pos);
  const kg = (list: RmRollRow[]) => list.reduce((s, r) => s + r.beratKotor, 0);
  const stok = (list: RmRollRow[]) => list.reduce((s, r) => s + r.nilaiStok, 0);
  const belum = of("Belum produksi");
  const proses = of("Proses produksi");
  const terkirimNilai = shown.reduce((s, r) => s + r.nilaiTerkirim, 0);
  const terkirimRoll = of("Sudah delivery");
  const nilaiTotal = shown.reduce((s, r) => s + r.nilai, 0);

  const cardClick = (pos: string) =>
    setPreset((p) => (p.card === pos ? { nonce: p.nonce + 1, filters: {} as Record<string, string[]>, card: "" } : { nonce: p.nonce + 1, filters: { Posisi: [pos] }, card: pos }));
  const card = (label: string, accent: "blue" | "orange" | "purple" | "teal", value: string, sub: string, pos?: string) => (
    <KpiCard label={label} value={value} valueClassName="text-[20px]" sub={sub} accent={accent} active={!!pos && preset.card === pos} onClick={pos ? () => cardClick(pos) : undefined} />
  );

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
    { label: "Bulan bayar", options: uniq(rows.map((r) => r.paidAt?.slice(0, 7) ?? "")).reverse(), test: (r, v) => r.paidAt?.slice(0, 7) === v },
  ];

  const isRoll = focus === "roll";
  const columns: ColumnDef<RmRollRow>[] = [
    { key: "mrp", label: "No. MRP", default: false, aggregate: aggSame((r) => r.mrpId), render: (r) => <span className="font-mono">{r.mrpId}</span> },
    { key: "vendor", label: "Vendor", default: false, aggregate: aggSame((r) => vendorName(r.vendorProduksi)), render: (r) => vendorName(r.vendorProduksi) },
    { key: "supplier", label: "Supplier", default: true, aggregate: aggSame((r) => r.supplier), render: (r) => r.supplier },
    { key: "codeRoll", label: "Code Roll", default: false, render: (r) => <span className="font-mono">{r.codeRoll || "—"}</span> },
    { key: "po", label: "No PO", default: false, render: (r) => <span className="font-mono" title={r.poId}>{poDisplayNo(r.poId, r.entitas)}</span> },
    { key: "entitas", label: "Entitas", default: false, aggregate: aggSame((r) => r.entitas), render: (r) => r.entitas || "—" },
    { key: "invoice", label: "No Invoice", default: false, aggregate: aggSame((r) => r.noInvoice), render: (r) => <span className="font-mono">{r.noInvoice || "—"}</span> },
    { key: "kategori", label: "Kategori produk", default: false, aggregate: aggSame((r) => r.kategori), render: (r) => r.kategori },
    { key: "benang", label: "Benang", default: false, aggregate: aggSame((r) => r.benang), render: (r) => r.benang },
    { key: "roll", label: "Roll", default: true, align: "right", aggregate: aggSum(() => 1, (n) => bold(intFmt(n))), render: () => <span className="font-mono">1</span> },
    { key: "kotor", label: "Berat kotor (kg)", default: true, align: "right", aggregate: aggSum((r) => r.beratKotor, (n) => bold(kgFmt(n))), render: (r) => <span className="font-mono">{kgFmt(r.beratKotor)}</span> },
    { key: "bersih", label: "Berat bersih (kg)", default: isRoll, align: "right", aggregate: aggSum((r) => r.beratBersih ?? 0, (n) => bold(kgFmt(n))), render: (r) => <span className="font-mono">{r.beratBersih != null ? kgFmt(r.beratBersih) : "—"}</span> },
    { key: "harga", label: "Harga/kg", default: false, align: "right", render: (r) => <span className="font-mono">{rp(r.hargaPerKg)}</span> },
    { key: "nilaiKain", label: "Harga roll", default: !isRoll, align: "right", aggregate: aggSum((r) => r.nilaiKain, (n) => bold(rp(n))), render: (r) => <span className="font-mono">{rp(r.nilaiKain)}</span> },
    { key: "rib", label: "Rib/roll", default: !isRoll, align: "right", aggregate: aggSum((r) => r.ribRoll, (n) => bold(rp(n))), render: (r) => <span className="font-mono">{r.ribRoll ? rp(r.ribRoll) : "—"}</span> },
    { key: "diskon", label: "Diskon", default: !isRoll, align: "right", aggregate: aggSum((r) => r.diskonRoll, (n) => bold(rp(n))), render: (r) => <span className="font-mono">{r.diskonRoll ? `−${rp(r.diskonRoll)}` : "—"}</span> },
    {
      key: "nilai",
      label: "Nilai material",
      default: !isRoll,
      align: "right",
      info: { title: "Nilai material roll", body: <p>Harga roll (harga/kg × berat kotor) + porsi rib warna itu − porsi diskon invoice. Sama dengan dasar biaya bahan di HPP.</p> },
      aggregate: aggSum((r) => r.nilai, (n) => bold(rp(n))),
      render: (r) => <span className="font-mono font-medium">{rp(r.nilai)}</span>,
    },
    { key: "terkirim", label: "Nilai terkirim", default: !isRoll, align: "right", aggregate: aggSum((r) => r.nilaiTerkirim, (n) => bold(rp(n))), render: (r) => <span className="font-mono">{r.nilaiTerkirim > 0 ? rp(r.nilaiTerkirim) : "—"}</span> },
    { key: "stok", label: "Nilai stok", default: !isRoll, align: "right", aggregate: aggSum((r) => r.nilaiStok, (n) => bold(rp(n))), render: (r) => <span className="font-mono">{rp(r.nilaiStok)}</span> },
    { key: "pcs", label: "Pcs belum kirim", default: isRoll, align: "right", aggregate: aggSum((r) => r.pcsBelumKirim, (n) => bold(intFmt(n))), render: (r) => <span className="font-mono">{r.pcsBelumKirim || "—"}</span> },
    {
      key: "status",
      label: "Status",
      default: true,
      aggregate: aggSame((r) => r.status, (v) => <StatusPill tone={STATUS_TONE[v] ?? "neutral"}>{v}</StatusPill>),
      render: (r) => <StatusPill tone={STATUS_TONE[r.status] ?? "neutral"}>{r.status}</StatusPill>,
    },
    { key: "tglBayar", label: "Tgl Bayar", default: !isRoll, render: (r) => formatDate(r.paidAt) },
    { key: "tglInvoice", label: "Tgl Invoice", default: false, render: (r) => formatDate(r.invoiceAt) },
    { key: "tglDelivery", label: "Tgl Kirim Supplier", default: isRoll, render: (r) => formatDate(r.deliveryAt) },
    { key: "tglGr", label: "Tgl GR", default: isRoll, render: (r) => formatDate(r.grAt) },
    { key: "tglResting", label: "Tgl Resting", default: false, render: (r) => formatDate(r.restingAt) },
    { key: "tglCutting", label: "Tgl Cutting", default: false, render: (r) => formatDate(r.cuttingAt) },
    { key: "tglTutup", label: "Tgl Tutup Roll", default: false, render: (r) => formatDate(r.closedAt) },
  ];

  return (
    <>
      {/* Kartu mengikuti filter tabel, diklik = filter Posisi. Raw Material dalam roll / kg, Posisi Stok dalam rupiah. */}
      <div className="grid grid-cols-4 gap-3 max-lg:grid-cols-2">
        {isRoll ? (
          <>
            {card("Roll dibayar", "blue", intFmt(shown.length), `${kgFmt(kg(shown))} kg`)}
            {card("Belum produksi", "orange", intFmt(belum.length), `${kgFmt(kg(belum))} kg · belum resting`, "Belum produksi")}
            {card("Proses produksi", "purple", intFmt(proses.length), `${kgFmt(kg(proses))} kg · resting s/d roll ditutup`, "Proses produksi")}
            {card("Sudah delivery", "teal", intFmt(terkirimRoll.length), `${kgFmt(kg(terkirimRoll))} kg · terkirim penuh`, "Sudah delivery")}
          </>
        ) : (
          <>
            {card("Nilai material dibayar", "blue", rp(nilaiTotal), `${intFmt(shown.length)} roll`)}
            {card("Belum produksi", "orange", rp(stok(belum)), `${intFmt(belum.length)} roll · belum resting`, "Belum produksi")}
            {card("Proses produksi", "purple", rp(stok(proses)), `${intFmt(proses.length)} roll · porsi belum terkirim`, "Proses produksi")}
            {card("Sudah delivery", "teal", rp(terkirimNilai), `${intFmt(terkirimRoll.length)} roll terkirim penuh`, "Sudah delivery")}
          </>
        )}
      </div>

      <DataTable<RmRollRow>
        title="Material per roll"
        subtitle="Roll yang sudah dibayar, sampai barang jadinya dikirim vendor"
        columns={columns}
        rows={rows}
        keyOf={(r) => r.key}
        firstColumnLabel="Warna"
        firstColumnRender={(r) => (
          <span className="font-medium">
            {r.warna} <span className="text-text-muted">{r.lengan === "PENDEK" ? "PDK" : "PJG"}</span>
          </span>
        )}
        filterDefs={filterDefs}
        filterPreset={preset}
        defaultGroupBy={["No. MRP", "Vendor"]}
        search={{ placeholder: "Cari MRP, PO, invoice, supplier, vendor, warna, code roll…", getText: (r) => `${r.codeRoll} ${r.mrpId} ${r.poId} ${r.noInvoice} ${r.supplier} ${vendorName(r.vendorProduksi)} ${r.warna} ${r.status}` }}
        onFilteredRows={(list) => setShownKeys(new Set(list.map((r) => r.key)))}
        emptyText="Belum ada roll untuk filter ini."
      />
    </>
  );
}
