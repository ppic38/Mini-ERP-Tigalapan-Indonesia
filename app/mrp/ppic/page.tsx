"use client";

import { useEffect, useMemo, useState } from "react";
import { alertDialog, confirmDialog } from "@/components/ui/confirm-dialog";
import Link from "next/link";
import { AppShell } from "@/components/shell/app-shell";
import { StatusPill } from "@/components/ui/status-pill";
import { ImportDropzone } from "@/components/mrp/import-dropzone";
import { MrpWarnaBreakdownTable } from "@/components/mrp/mrp-warna-breakdown-table";
import { SysadminActionsBar } from "@/components/sysadmin/correction-dialog";
import { DataTable, aggSame, aggSum, type ColumnDef, type FilterDef } from "@/components/mrp/data-table";
import { SidePanel } from "@/components/ui/side-panel";
import { KpiCard } from "@/components/ui/kpi-card";
import { mrpCorrections } from "@/components/sysadmin/ppic-corrections";
import { useSysadminMode } from "@/lib/shell/use-sysadmin-mode";
import { useMrpStore } from "@/lib/mrp/store";
import { mrpStatusBadges, mrpStatusBadgeTone, mrpWarnaBreakdown, effectiveMrpQty, formatPcs, formatDate, ppicApprovalBadge, vendorsForMrp } from "@/lib/mrp/derive";
import { FLOW_STAGES, batchShippingMap, returnedRollKeys, mrpFlowStage, type FlowStage, type FlowSideStatus } from "@/lib/mrp/flowStatus";
import { StageBadge } from "@/components/ui/stage-badge";
import type { ParsedMrpImport } from "@/lib/mrp/parseImport";
import { exportMaklonPoRasioExcel } from "@/lib/mrp/exportPoExcel";
import { VENDOR_PRODUKSI } from "@/lib/mrp/seed";
import type { MaklonPO } from "@/lib/mrp/types";
import { estimateMrpHpp, toMrpHppEstimate } from "@/lib/mrp/poHppEstimate";
import { useHppContext } from "@/components/mrp/use-hpp-context";

const badgeTone = mrpStatusBadgeTone;

/** Popup pilih vendor untuk Form Rasio satu MRP: ceklis (boleh lebih dari satu), hasilnya satu file Excel dengan satu sheet per vendor. */
function RasioVendorDialog({
  mrpId,
  options,
  picked,
  busy,
  onToggle,
  onToggleAll,
  onDownload,
  onClose,
}: {
  mrpId: string;
  options: { code: string; name: string; qty: number }[];
  picked: Set<string>;
  busy: boolean;
  onToggle: (code: string) => void;
  onToggleAll: (all: boolean) => void;
  onDownload: () => void;
  onClose: () => void;
}) {
  const allPicked = options.length > 0 && picked.size === options.length;
  return (
    <div className="fixed inset-0 z-[55] flex items-center justify-center bg-[#0B131B]/45 p-4" onClick={onClose}>
      <div className="w-full max-w-[420px] rounded-lg bg-white shadow-[0_8px_24px_rgba(11,19,27,.2)]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-border-subtle px-5 py-3.5">
          <span className="font-sans text-[13px] font-semibold text-text-primary">Form Rasio · {mrpId}</span>
          <button onClick={onClose} className="font-sans text-[13px] font-semibold text-text-muted hover:text-text-primary">
            ✕
          </button>
        </div>
        <div className="px-5 py-4">
          {options.length === 0 ? (
            <div className="font-sans text-xs text-text-muted">MRP ini belum punya vendor produksi.</div>
          ) : (
            <>
              <label className="flex items-center gap-2 border-b border-border-subtle pb-2 font-sans text-xs font-semibold text-text-primary">
                <input type="checkbox" checked={allPicked} onChange={(e) => onToggleAll(e.target.checked)} className="h-3.5 w-3.5 accent-accent-blue" />
                Pilih semua vendor
              </label>
              <div className="max-h-[280px] overflow-y-auto py-1">
                {options.map((o) => (
                  <label key={o.code} className="flex items-center gap-2 rounded px-1 py-1.5 font-sans text-xs text-[#31414F] hover:bg-[#F7F9FB]">
                    <input type="checkbox" checked={picked.has(o.code)} onChange={() => onToggle(o.code)} className="h-3.5 w-3.5 accent-accent-blue" />
                    <span className="flex-1">{o.name}</span>
                    <span className="font-mono text-text-muted">{formatPcs(o.qty)} pcs</span>
                  </label>
                ))}
              </div>
            </>
          )}
          <button
            onClick={onDownload}
            disabled={busy || picked.size === 0}
            className="mt-3 w-full rounded-[5px] bg-action-primary px-3 py-2 font-sans text-xs font-semibold text-white disabled:opacity-50"
          >
            {busy ? "Membuat file…" : picked.size === 0 ? "Pilih vendor dulu" : `Download Excel (${picked.size} vendor)`}
          </button>
        </div>
      </div>
    </div>
  );
}

const formatRp = (n: number) => "Rp " + Math.round(n).toLocaleString("id-ID");
const rollTooltip = (by: Partial<Record<FlowStage, number>>) =>
  FLOW_STAGES.filter((st) => (by[st] ?? 0) > 0)
    .map((st) => `${st}: ${by[st]} roll`)
    .join("\n") || undefined;

export default function MrpListPage() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const mrpDetails = useMrpStore((s) => s.mrpDetails);
  const staticMrps = useMrpStore((s) => s.staticMrps);
  const materialPOs = useMrpStore((s) => s.materialPOs);
  const maklonPOs = useMrpStore((s) => s.maklonPOs);
  const invoices = useMrpStore((s) => s.invoices);
  const vendorInvoices = useMrpStore((s) => s.vendorInvoices);
  const maklonInvoices = useMrpStore((s) => s.maklonInvoices);
  const productionBatches = useMrpStore((s) => s.productionBatches);
  const deliveryKolis = useMrpStore((s) => s.deliveryKolis);
  const warehouseReceipts = useMrpStore((s) => s.warehouseReceipts);
  const materialClaimHistory = useMrpStore((s) => s.materialClaimHistory);
  const sysadmin = useSysadminMode();
  const importMrp = useMrpStore((s) => s.importMrp);
  const resetMrp = useMrpStore((s) => s.resetMrp);
  const kerahMansetSettings = useMrpStore((s) => s.kerahMansetSettings);

  // Id MRP yang sedang diproses hapus -- dipakai untuk disable tombol supaya tidak bisa diklik
  // dobel selagi request jalan.
  const [resettingId, setResettingId] = useState<string | null>(null);

  async function handleResetMrp(mrpId: string) {
    const ok = await confirmDialog({
      title: `Hapus SEMUA data MRP ${mrpId}?`,
      message: 'Ini akan menghapus PO, invoice, produksi, dan pengiriman yang terkait MRP ini SAJA (MRP lain tidak terpengaruh). Aksi ini tidak bisa dibatalkan.',
      confirmLabel: "Hapus semua data",
      tone: "danger",
    });
    if (!ok) return;
    setResettingId(mrpId);
    try {
      await resetMrp(mrpId);
    } catch (err) {
      void alertDialog({ title: "Reset MRP gagal", message: err instanceof Error ? err.message : String(err), tone: "danger" });
    } finally {
      setResettingId(null);
    }
  }

  // Form Rasio per MRP: popup ceklis vendor (boleh lebih dari satu) lalu unduh Excel, satu sheet per vendor.
  const [rasioMrpId, setRasioMrpId] = useState<string | null>(null);
  const [rasioPicked, setRasioPicked] = useState<Set<string>>(new Set());
  const [rasioBusy, setRasioBusy] = useState(false);

  // Vendor (kode) yang mengerjakan MRP ini beserta qty-nya. Pakai PO produksi yang sudah ada kalau ada; kalau belum ada PO,
  // dibentuk PO sementara (hanya untuk isi file, tidak disimpan) dari Aduan Pola / vendor default grup.
  function rasioVendorOptions(mrpId: string) {
    const detail = mrpDetails.find((d) => d.mrp.id === mrpId);
    if (!detail) return [];
    const codes = Array.from(new Set([...detail.aduanRows.map((a) => a.vendor), ...detail.lenganGroups.map((g) => g.vendorDefault)])).filter(Boolean);
    return codes.map((code) => {
      const po = maklonPOs.find((p) => p.mrpId === mrpId && p.vendorProduksi === code && !p.isFob);
      const aduanQty = detail.aduanRows.filter((a) => a.vendor === code).reduce((s, a) => s + a.qty, 0);
      const qty = aduanQty > 0 ? aduanQty : detail.lenganGroups.filter((g) => g.vendorDefault === code).reduce((s, g) => s + g.totalQty, 0);
      const name = VENDOR_PRODUKSI[code]?.name ?? code;
      return { code, name, qty, po: po ?? ({ id: `MRP-${mrpId}`, mrpId, vendorProduksi: code, qty, amount: 0, entity: "", status: "FULL_WAITING_MATERIAL", approved: false, cancelledLines: [] } as MaklonPO) };
    });
  }

  function openRasio(mrpId: string) {
    setRasioMrpId(mrpId);
    setRasioPicked(new Set());
  }

  async function downloadRasio() {
    if (!rasioMrpId) return;
    const pos = rasioVendorOptions(rasioMrpId)
      .filter((o) => rasioPicked.has(o.code))
      .map((o) => o.po);
    if (pos.length === 0) return;
    setRasioBusy(true);
    try {
      await exportMaklonPoRasioExcel(pos, mrpDetails, `Form-Rasio-${rasioMrpId}.xlsx`, maklonPOs);
      setRasioMrpId(null);
    } catch (err) {
      void alertDialog({ title: "Gagal membuat file", message: err instanceof Error ? err.message : String(err), tone: "danger" });
    } finally {
      setRasioBusy(false);
    }
  }

  // Panel samping: rincian satu MRP (klik baris) dan impor dokumen MRP (tombol "Import MRP").
  const [openMrpId, setOpenMrpId] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  // Kartu angka yang diklik memasang filter di tabel (lihat `filterPreset` di DataTable).
  const [preset, setPreset] = useState<{ nonce: number; filters: Record<string, string[]>; card: string }>({ nonce: 0, filters: {}, card: "" });
  // Kartu angka mengikuti filter tabel (owner 2026-11-16): dihitung dari baris yang sedang lolos filter dan pencarian.
  const [shownIds, setShownIds] = useState<Set<string> | null>(null);
  // Estimasi HPP: satu rumus bersama dengan Approval PO dan Tracking Item (lib/mrp/poHppEstimate.ts, owner 2026-11-27).
  const hppCtx = useHppContext();

  const rows = useMemo(() => {
    // Status staging standar (lib/mrp/flowStatus.ts) dan estimasi HPP % per MRP.
    const batchByCode = new Map(productionBatches.filter((b) => b.codeRoll).map((b) => [b.codeRoll as string, b]));
    const shipping = batchShippingMap(deliveryKolis, warehouseReceipts);
    const returned = returnedRollKeys(materialClaimHistory);
    const all: { mrp: (typeof mrpDetails)[number]["mrp"]; detail?: (typeof mrpDetails)[number] }[] = [
      ...mrpDetails.map((d) => ({ mrp: d.mrp, detail: d })),
      ...staticMrps.map((m) => ({ mrp: m })),
    ];
    // Urutan: MRP terbaru (tanggal dibuat) paling atas; MRP tanpa tanggal (data statis lama) di paling bawah. Tanggal sama = yang masuk belakangan dulu.
    const ordered = all
      .map((row, idx) => ({ row, idx, created: row.detail?.dates?.created ?? "" }))
      .sort((x, y) => (x.created < y.created ? 1 : x.created > y.created ? -1 : y.idx - x.idx))
      .map((x) => x.row);
    return ordered.map(({ mrp, detail }) => ({
      mrp,
      detail,
      // MRP bisa punya lebih dari 1 warna sekaligus (tiap warna = 1 lenganGroup dari file
      // import) — mrp.warna cuma menyimpan warna pertama sebagai label ringkas, jadi di sini
      // kumpulkan semua warna unik dari lenganGroups supaya tidak "hilang" di tabel ringkasan.
      warnaLabel: detail && detail.lenganGroups.length > 0 ? Array.from(new Set(detail.lenganGroups.map((g) => g.warna))).join(", ") : mrp.warna,
      badges: mrpStatusBadges(mrp.id, detail, materialPOs, maklonPOs, invoices, vendorInvoices),
      vendors: vendorsForMrp(detail),
      scm: detail ? ppicApprovalBadge(detail.ppicApproval) : null,
      roll: mrpWarnaBreakdown(detail).reduce((sum, w) => sum + w.rollTotal, 0),
      flow: mrpFlowStage(detail, mrp.id, materialPOs, invoices, batchByCode, shipping, returned),
      hpp: toMrpHppEstimate(estimateMrpHpp(mrp.id, hppCtx)),
    })).map((r) => ({ ...r, stage: r.flow.stage as FlowStage | FlowSideStatus }));
  }, [mrpDetails, staticMrps, materialPOs, maklonPOs, invoices, vendorInvoices, productionBatches, deliveryKolis, warehouseReceipts, materialClaimHistory, hppCtx]);
  type Row = (typeof rows)[number];

  if (!mounted) return null;

  function handleConfirm(parsed: ParsedMrpImport, customId?: string) {
    importMrp(parsed, customId);
  }

  const uniq = (list: string[]) => Array.from(new Set(list));
  const stageOrder: string[] = ["Ditolak", ...FLOW_STAGES];
  const filterDefs: FilterDef<Row>[] = [
    { label: "Status", options: stageOrder.filter((st) => rows.some((r) => r.stage === st)), test: (r, v) => r.stage === v },
    { label: "Vendor", options: uniq(rows.flatMap((r) => r.vendors)).sort(), test: (r, v) => r.vendors.includes(v) },
    { label: "Kategori", options: uniq(rows.map((r) => r.mrp.kategori).filter(Boolean)).sort(), test: (r, v) => r.mrp.kategori === v },
  ];

  const pill = (label: string) => <StatusPill tone={badgeTone(label)}>{label}</StatusPill>;
  const columns: ColumnDef<Row>[] = [
    {
      key: "sysadmin",
      label: "Aksi Sysadmin",
      default: true,
      sysadmin: true,
      // Mode Sysadmin: koreksi dengan pengaman jejak uang/fisik. "Reset MRP" milik PPIC tidak tampil di mode ini (server menolak Sysadmin).
      render: (r) => (
        <SysadminActionsBar
          compact
          actions={mrpCorrections(r.mrp.id, { detail: r.detail, materialPOs, maklonPOs, invoices, vendorInvoices, maklonInvoices, productionBatches, deliveryKolis })}
        />
      ),
    },
    { key: "kategori", aggregate: aggSame<Row>((r) => r.mrp.kategori), label: "Kategori", default: false, render: (r) => `${r.mrp.kategori} · ${r.warnaLabel}` },
    { key: "qty", aggregate: aggSum<Row>((r) => effectiveMrpQty(r.mrp.id, r.mrp.qty, maklonPOs), (n) => <span className="font-semibold">{formatPcs(n)}</span>), label: "Qty", default: true, align: "right", render: (r) => <span className="font-mono">{formatPcs(effectiveMrpQty(r.mrp.id, r.mrp.qty, maklonPOs))}</span> },
    {
      key: "roll", aggregate: aggSum<Row>((r) => r.roll, (n) => <span className="font-semibold">{n.toLocaleString("id-ID", { maximumFractionDigits: 2 })}</span>),
      label: "Roll",
      default: true,
      align: "right",
      // Jumlah roll rencana MRP = total roll rincian warna (sama dengan angka di panel rincian).
      render: (r) => <span className="font-mono">{r.roll.toLocaleString("id-ID", { maximumFractionDigits: 2 })}</span>,
    },
    { key: "vendor", label: "Vendor", default: false, render: (r) => (r.vendors.length ? r.vendors.join(", ") : "—") },
    {
      key: "tahapan", aggregate: aggSame<Row>((r) => r.stage, (v) => <StageBadge stages={FLOW_STAGES} current={v} tone={v === "Ditolak" ? "danger" : undefined} />),
      label: "Status",
      default: true,
      info: { title: "Status MRP", body: <p>Tahap paling awal yang masih memegang barang MRP ini (status staging standar). Jumlah roll per tahap ada di tooltip.</p> },
      render: (r) => (
        <span title={rollTooltip(r.flow.rollsByStage)}>
          <StageBadge stages={FLOW_STAGES} current={r.stage} tone={r.stage === "Ditolak" ? "danger" : undefined} />
        </span>
      ),
    },
    {
      key: "estHpp",
      label: "Est. HPP %",
      default: true,
      align: "right",
      info: {
        title: "Estimasi HPP %",
        body: (
          <>
            <p>(Nilai PO Material + nilai PO Produksi + estimasi ongkir) ÷ nilai jual qty MRP.</p>
            <p className="mt-1.5 text-text-muted">Ongkir = qty × rata-rata ongkir per pcs vendor dari pengiriman yang sudah ada. Harga jual dari Master SKU (lewat Mapping Warna). Tersedia mulai Approval PO.</p>
          </>
        ),
      },
      render: (r) =>
        r.hpp.pct == null || r.hpp.material + r.hpp.maklon === 0 ? (
          <span className="text-text-muted">—</span>
        ) : (
          <span
            className={"font-mono font-semibold " + (r.hpp.pct > 100 ? "text-danger-fg" : r.hpp.pct > 80 ? "text-warning-fg" : "text-success-fg")}
            title={`Material ${formatRp(r.hpp.material)} + Maklon ${formatRp(r.hpp.maklon)} + Est. ongkir ${formatRp(r.hpp.delivery)} = ${formatRp(r.hpp.total)}\nNilai jual ${formatRp(r.hpp.hargaJual)}${r.hpp.pcsTanpaHarga > 0 ? `\n${formatPcs(r.hpp.pcsTanpaHarga)} pcs belum punya harga jual (memakai rata-rata harga size lain)` : ""}`}
          >
            {r.hpp.pct.toLocaleString("id-ID", { maximumFractionDigits: 1 })}%
          </span>
        ),
    },
    { key: "estMaterial", label: "Est. Material", default: false, align: "right", aggregate: aggSum<Row>((r) => r.hpp.material, (n) => <span className="font-semibold">{formatRp(n)}</span>), render: (r) => <span className="font-mono">{formatRp(r.hpp.material)}</span> },
    { key: "estMaklon", label: "Est. Maklon", default: false, align: "right", aggregate: aggSum<Row>((r) => r.hpp.maklon, (n) => <span className="font-semibold">{formatRp(n)}</span>), render: (r) => <span className="font-mono">{formatRp(r.hpp.maklon)}</span> },
    { key: "estOngkir", label: "Est. Delivery", default: false, align: "right", aggregate: aggSum<Row>((r) => r.hpp.delivery, (n) => <span className="font-semibold">{formatRp(n)}</span>), render: (r) => <span className="font-mono">{formatRp(r.hpp.delivery)}</span> },
    { key: "estJual", label: "Nilai Jual", default: false, align: "right", aggregate: aggSum<Row>((r) => r.hpp.hargaJual, (n) => <span className="font-semibold">{formatRp(n)}</span>), render: (r) => <span className="font-mono">{formatRp(r.hpp.hargaJual)}</span> },
    { key: "tglMrp", label: "Tgl MRP", default: true, render: (r) => <span className="font-mono">{formatDate(r.detail?.dates?.created)}</span> },
    { key: "tglPO", label: "Tgl PO", default: true, render: (r) => <span className="font-mono">{formatDate(r.detail?.dates?.poSent)}</span> },
    { key: "tglApproved", label: "Tgl Approve PO", default: true, render: (r) => <span className="font-mono">{formatDate(r.detail?.dates?.poApproved)}</span> },
    { key: "tglInvoice", label: "Tgl Invoice", default: true, render: (r) => <span className="font-mono">{formatDate(r.detail?.dates?.firstInvoice)}</span> },
    { key: "tglPayment", label: "Tgl Bayar", default: true, render: (r) => <span className="font-mono">{formatDate(r.detail?.dates?.firstPayment)}</span> },
    { key: "statusScm", label: "SCM", default: false, render: (r) => (r.scm ? <StatusPill tone={r.scm.tone}>{r.scm.label}</StatusPill> : "—") },
    { key: "statusPO", label: "PO", default: false, render: (r) => pill(r.badges.statusPO) },
    { key: "statusRM", label: "Material", default: false, render: (r) => pill(r.badges.statusRawMaterial) },
    { key: "statusProduksi", label: "Produksi", default: false, render: (r) => pill(r.badges.statusProduksi) },
  ];

  // Kartu angka: jumlah MRP per kelompok tahapan, dari baris yang SEDANG lolos filter/pencarian tabel (berubah mengikuti filter).
  // Klik kartu = filter Tahapan.
  const shown = shownIds ? rows.filter((r) => shownIds.has(r.mrp.id)) : rows;
  type St = FlowStage | FlowSideStatus;
  const inStages = (list: St[]) => shown.filter((r) => list.includes(r.stage)).length;
  const cards: { key: string; label: string; value: number; sub: string; accent: "blue" | "orange" | "purple" | "teal"; stages: St[] }[] = [
    { key: "awal", label: "Approval", value: inStages(["Approval MRP", "Ditolak", "Approval PO"]), sub: "Approval MRP dan Approval PO", accent: "orange", stages: ["Approval MRP", "Ditolak", "Approval PO"] },
    { key: "material", label: "Material", value: inStages(["PV Material", "Paid", "Delivery Material", "Receiving Material"]), sub: "PV Material s/d Receiving Material", accent: "purple", stages: ["PV Material", "Paid", "Delivery Material", "Receiving Material"] },
    { key: "produksi", label: "Produksi", value: inStages(["Resting", "Cutting", "Finish Good", "Done FG", "Packing"]), sub: "Resting s/d Packing", accent: "blue", stages: ["Resting", "Cutting", "Finish Good", "Done FG", "Packing"] },
    { key: "selesai", label: "Delivery FG & GR DC", value: inStages(["Delivery FG", "GR DC"]), sub: "dikirim vendor atau diterima gudang", accent: "teal", stages: ["Delivery FG", "GR DC"] },
  ];

  const openRow = openMrpId ? rows.find((r) => r.mrp.id === openMrpId) : undefined;

  return (
    <AppShell
      role="ppic"
      activeHref="/mrp/ppic"
      breadcrumb={["Dashboard", "Material Requirement Planning"]}
      title="Material Requirement Planning"
      actions={
        sysadmin ? undefined : (
          <>
            <Link href="/mrp/ppic/new" className="rounded-[5px] border border-[#CBD5DF] bg-white px-3 py-[7px] font-sans text-xs font-semibold text-action-primary hover:bg-info-bg">
              Input manual
            </Link>
            <button onClick={() => setImportOpen(true)} className="rounded-[5px] bg-action-primary px-3 py-[7px] font-sans text-xs font-semibold text-white">
              Import MRP
            </button>
          </>
        )
      }
    >
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {cards.map((c) => (
          <KpiCard
            key={c.key}
            label={c.label}
            value={c.value}
            sub={c.sub}
            accent={c.accent}
            active={preset.card === c.key}
            onClick={() =>
              setPreset((p) =>
                p.card === c.key ? { nonce: p.nonce + 1, filters: {} as Record<string, string[]>, card: "" } : { nonce: p.nonce + 1, filters: { Status: c.stages.filter((st) => rows.some((r) => r.stage === st)) as string[] }, card: c.key }
              )
            }
          />
        ))}
      </div>

      <DataTable<Row>
        title="Daftar MRP"
        columns={columns}
        rows={rows}
        keyOf={(r) => r.mrp.id}
        firstColumnLabel="No. MRP"
        firstColumnRender={(r) => <span className="font-mono font-medium">{r.mrp.id}</span>}
        filterDefs={filterDefs}
        filterPreset={preset}
        onFilteredRows={(list) => setShownIds(new Set(list.map((r) => r.mrp.id)))}
        search={{ placeholder: "Cari no. MRP, warna, vendor, tahapan…", getText: (r) => `${r.mrp.id} ${r.mrp.kategori} ${r.warnaLabel} ${r.vendors.join(" ")} ${r.stage}` }}
        onRowClick={(r) => setOpenMrpId(r.mrp.id)}
        emptyText="Tidak ada MRP yang cocok dengan filter."
      />

      <SidePanel open={importOpen} onClose={() => setImportOpen(false)} title="Import dokumen MRP" subtitle="Unggah file Excel MRP, periksa pratinjaunya, lalu simpan." width={980}>
        <ImportDropzone onConfirm={handleConfirm} kerahMansetSettings={kerahMansetSettings} />
      </SidePanel>

      <SidePanel
        open={!!openRow}
        onClose={() => setOpenMrpId(null)}
        width={1040}
        title={openRow ? `MRP ${openRow.mrp.id}` : ""}
        subtitle={openRow ? `${openRow.mrp.kategori} · ${formatPcs(effectiveMrpQty(openRow.mrp.id, openRow.mrp.qty, maklonPOs))} pcs` : undefined}
        headerExtra={
          openRow && (
            <StageBadge stages={FLOW_STAGES} current={openRow.stage} tone={openRow.stage === "Ditolak" ? "danger" : undefined} />
          )
        }
        footer={
          openRow && !sysadmin ? (
            <>
              {openRow.detail && (
                <button
                  onClick={() => openRasio(openRow.mrp.id)}
                  title="Download Form Rasio (Excel) -- pilih vendor dulu"
                  className="rounded-[5px] border border-[#CBD5DF] bg-white px-3 py-[7px] font-sans text-xs font-semibold text-action-primary hover:bg-info-bg"
                >
                  Form Rasio
                </button>
              )}
              <button
                onClick={async () => {
                  const id = openRow.mrp.id;
                  await handleResetMrp(id);
                  if (!useMrpStore.getState().mrpDetails.some((d) => d.mrp.id === id)) setOpenMrpId(null);
                }}
                disabled={resettingId === openRow.mrp.id}
                title="Hapus semua data MRP ini saja (PO, invoice, produksi, pengiriman) -- tidak bisa dibatalkan"
                className="ml-auto rounded-[5px] border border-[#EFC9C4] bg-white px-3 py-[7px] font-sans text-xs font-semibold text-danger-fg hover:bg-danger-bg disabled:opacity-50"
              >
                {resettingId === openRow.mrp.id ? "Menghapus…" : "Reset MRP"}
              </button>
            </>
          ) : undefined
        }
      >
        {openRow && (
          <div className="flex flex-col gap-4">
            {openRow.detail?.ppicApproval === "REJECTED" && (
              <div className="rounded-md border border-[#EFC9C4] bg-danger-bg px-3.5 py-2.5 font-sans text-[11.5px] leading-[1.5] text-danger-fg">
                <span className="font-semibold">Ditolak SCM</span>
                {openRow.detail.ppicRejectionNote ? ` — ${openRow.detail.ppicRejectionNote}` : ""} — impor ulang dengan data yang sudah dibetulkan kalau perlu diajukan lagi.
              </div>
            )}
            <div>
              <div className="mb-2 font-sans text-[13px] font-semibold text-text-primary">Rincian warna</div>
              <MrpWarnaBreakdownTable breakdown={mrpWarnaBreakdown(openRow.detail)} vendorQty={false} />
            </div>
          </div>
        )}
      </SidePanel>

      {rasioMrpId && (
        <RasioVendorDialog
          mrpId={rasioMrpId}
          options={rasioVendorOptions(rasioMrpId)}
          picked={rasioPicked}
          busy={rasioBusy}
          onToggle={(code) =>
            setRasioPicked((prev) => {
              const next = new Set(prev);
              if (next.has(code)) next.delete(code);
              else next.add(code);
              return next;
            })
          }
          onToggleAll={(all) => setRasioPicked(all ? new Set(rasioVendorOptions(rasioMrpId).map((o) => o.code)) : new Set())}
          onDownload={downloadRasio}
          onClose={() => setRasioMrpId(null)}
        />
      )}
    </AppShell>
  );
}
