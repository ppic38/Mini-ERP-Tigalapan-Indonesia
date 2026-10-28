"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { alertDialog, confirmDialog } from "@/components/ui/confirm-dialog";
import Link from "next/link";
import { ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { AppShell } from "@/components/shell/app-shell";
import { StatusPill } from "@/components/ui/status-pill";
import { ImportDropzone } from "@/components/mrp/import-dropzone";
import { MrpWarnaBreakdownTable } from "@/components/mrp/mrp-warna-breakdown-table";
import { SysadminTd, SysadminTh } from "@/components/sysadmin/correction-dialog";
import { mrpCorrections } from "@/components/sysadmin/ppic-corrections";
import { useSysadminMode } from "@/lib/shell/use-sysadmin-mode";
import { useMrpStore } from "@/lib/mrp/store";
import { mrpStatusBadges, mrpStatusBadgeTone, mrpWarnaBreakdown, effectiveMrpQty, formatPcs, formatDate, ppicApprovalBadge, vendorsForMrp } from "@/lib/mrp/derive";
import type { ParsedMrpImport } from "@/lib/mrp/parseImport";
import { exportMaklonPoRasioExcel } from "@/lib/mrp/exportPoExcel";
import { VENDOR_PRODUKSI } from "@/lib/mrp/seed";
import type { MaklonPO } from "@/lib/mrp/types";

const badgeTone = mrpStatusBadgeTone;

type ColKey = "kategori" | "qty" | "vendor" | "tglMrp" | "tglPO" | "tglApproved" | "tglInvoice" | "tglPayment" | "statusScm" | "statusPO" | "statusRM" | "statusProduksi";

const COLUMNS: { key: ColKey; label: string; default: boolean }[] = [
  { key: "kategori", label: "Kategori / Warna", default: false },
  { key: "qty", label: "Qty", default: true },
  { key: "vendor", label: "Vendor", default: false },
  { key: "tglMrp", label: "Tanggal MRP", default: false },
  { key: "tglPO", label: "Tanggal PO", default: false },
  { key: "tglApproved", label: "Tanggal PO Disetujui", default: false },
  { key: "tglInvoice", label: "Tanggal Invoice", default: false },
  { key: "tglPayment", label: "Tanggal Payment", default: false },
  { key: "statusScm", label: "Status SCM", default: true },
  { key: "statusPO", label: "Status PO", default: true },
  { key: "statusRM", label: "Status Raw Material", default: true },
  { key: "statusProduksi", label: "Status Produksi", default: true },
];

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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0B131B]/45 p-4" onClick={onClose}>
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
      await exportMaklonPoRasioExcel(pos, mrpDetails, `Form-Rasio-${rasioMrpId}.xlsx`);
      setRasioMrpId(null);
    } catch (err) {
      void alertDialog({ title: "Gagal membuat file", message: err instanceof Error ? err.message : String(err), tone: "danger" });
    } finally {
      setRasioBusy(false);
    }
  }

  const [visibleCols, setVisibleCols] = useState<Set<ColKey>>(new Set(COLUMNS.filter((c) => c.default).map((c) => c.key)));
  const [colPickerOpen, setColPickerOpen] = useState(false);
  const [filterVendor, setFilterVendor] = useState("");
  const [filterStatusPO, setFilterStatusPO] = useState("");
  const [filterStatusRM, setFilterStatusRM] = useState("");
  const [filterStatusProd, setFilterStatusProd] = useState("");
  // Klik baris untuk expand/collapse rincian warna (qty/roll/rib panjang·pendek·total) — bisa
  // lebih dari satu baris terbuka sekaligus, makanya Set bukan satu id tunggal.
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  function toggleCol(key: ColKey) {
    setVisibleCols((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function toggleExpanded(mrpId: string) {
    // Hanya satu MRP yang terbuka: membuka satu menutup yang lain.
    setExpandedIds((prev) => (prev.has(mrpId) ? new Set() : new Set([mrpId])));
  }

  const rows = useMemo(() => {
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
    }));
  }, [mrpDetails, staticMrps, materialPOs, maklonPOs, invoices, vendorInvoices]);

  if (!mounted) return null;

  function handleConfirm(parsed: ParsedMrpImport, customId?: string) {
    importMrp(parsed, customId);
  }

  const allVendors = Array.from(new Set(rows.flatMap((r) => r.vendors))).sort();
  const allStatusPO = Array.from(new Set(rows.map((r) => r.badges.statusPO)));
  const allStatusRM = Array.from(new Set(rows.map((r) => r.badges.statusRawMaterial)));
  const allStatusProd = Array.from(new Set(rows.map((r) => r.badges.statusProduksi)));

  const filteredRows = rows.filter(
    (r) =>
      (!filterVendor || r.vendors.includes(filterVendor)) &&
      (!filterStatusPO || r.badges.statusPO === filterStatusPO) &&
      (!filterStatusRM || r.badges.statusRawMaterial === filterStatusRM) &&
      (!filterStatusProd || r.badges.statusProduksi === filterStatusProd)
  );

  // +1 untuk kolom No. MRP, +1 kolom chevron expand, +1 kolom aksi "Reset MRP" — semua selalu
  // tampil (tidak lewat toggle "Kolom") — dipakai sebagai colSpan baris rincian expand & baris
  // "tidak ada hasil" supaya selalu selebar tabel yang benar.
  const totalCols = 3 + COLUMNS.filter((c) => visibleCols.has(c.key)).length;

  return (
    <AppShell role="ppic" activeHref="/mrp/ppic" breadcrumb={["Dashboard", "Material Requirement Planning"]} title="Material Requirement Planning">
      <ImportDropzone onConfirm={handleConfirm} kerahMansetSettings={kerahMansetSettings} />

      <div className="overflow-hidden rounded-lg border border-border-subtle bg-surface-card">
        <div className="flex items-center gap-2 border-b border-border-subtle px-5 py-3.5">
          <span className="font-sans text-[13px] font-semibold text-text-primary">Material Requirement Planning</span>
          <div className="relative ml-auto">
            <button
              onClick={() => setColPickerOpen((v) => !v)}
              className="rounded-md border border-[#CBD5DF] px-2.5 py-[6px] font-sans text-[11.5px] font-semibold text-action-primary"
            >
              ⊞ Kolom
            </button>
            {colPickerOpen && (
              <div className="absolute right-0 top-[110%] z-20 w-56 rounded-md border border-border-subtle bg-surface-card p-2 shadow-[0_8px_20px_rgba(11,19,27,.15)]">
                {COLUMNS.map((c) => (
                  <label key={c.key} className="flex items-center gap-2 rounded px-2 py-1.5 font-sans text-xs text-[#31414F] hover:bg-[#F7F9FB]">
                    <input type="checkbox" checked={visibleCols.has(c.key)} onChange={() => toggleCol(c.key)} className="h-3.5 w-3.5 accent-accent-blue" />
                    {c.label}
                  </label>
                ))}
              </div>
            )}
          </div>
          <Link href="/mrp/ppic/new" className="rounded-[5px] bg-action-primary px-3 py-[7px] font-sans text-xs font-semibold text-white">
            Input manual
          </Link>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-b border-border-subtle bg-[#FAFBFC] px-5 py-2.5">
          <select value={filterVendor} onChange={(e) => setFilterVendor(e.target.value)} className="rounded-md border border-border-subtle bg-white px-2.5 py-[6px] font-sans text-[11.5px] font-medium text-[#31414F]">
            <option value="">Vendor: Semua</option>
            {allVendors.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
          <select value={filterStatusPO} onChange={(e) => setFilterStatusPO(e.target.value)} className="rounded-md border border-border-subtle bg-white px-2.5 py-[6px] font-sans text-[11.5px] font-medium text-[#31414F]">
            <option value="">Status PO: Semua</option>
            {allStatusPO.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
          <select value={filterStatusRM} onChange={(e) => setFilterStatusRM(e.target.value)} className="rounded-md border border-border-subtle bg-white px-2.5 py-[6px] font-sans text-[11.5px] font-medium text-[#31414F]">
            <option value="">Status Raw Material: Semua</option>
            {allStatusRM.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
          <select value={filterStatusProd} onChange={(e) => setFilterStatusProd(e.target.value)} className="rounded-md border border-border-subtle bg-white px-2.5 py-[6px] font-sans text-[11.5px] font-medium text-[#31414F]">
            <option value="">Status Produksi: Semua</option>
            {allStatusProd.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b-2 border-accent-blue bg-info-bg font-sans text-[10.5px] font-medium uppercase tracking-wider text-info-fg">
                <th className="px-5 py-[9px] text-left">No. MRP</th>
                {visibleCols.has("kategori") && <th className="px-3 py-[9px] text-left">Kategori / Warna</th>}
                {visibleCols.has("qty") && <th className="px-3 py-[9px] text-right">Qty</th>}
                {visibleCols.has("vendor") && <th className="px-3 py-[9px] text-left">Vendor</th>}
                {visibleCols.has("tglMrp") && <th className="px-3 py-[9px] text-left">Tanggal MRP</th>}
                {visibleCols.has("tglPO") && <th className="px-3 py-[9px] text-left">Tanggal PO</th>}
                {visibleCols.has("tglApproved") && <th className="px-3 py-[9px] text-left">Tanggal PO Disetujui</th>}
                {visibleCols.has("tglInvoice") && <th className="px-3 py-[9px] text-left">Tanggal Invoice</th>}
                {visibleCols.has("tglPayment") && <th className="px-3 py-[9px] text-left">Tanggal Payment</th>}
                {visibleCols.has("statusScm") && <th className="px-3 py-[9px] text-left">Status SCM</th>}
                {visibleCols.has("statusPO") && <th className="px-3 py-[9px] text-left">Status PO</th>}
                {visibleCols.has("statusRM") && <th className="px-3 py-[9px] text-left">Status Raw Material</th>}
                {visibleCols.has("statusProduksi") && <th className="px-5 py-[9px] text-left">Status Produksi</th>}
                {sysadmin ? <SysadminTh /> : <th className="px-3 py-[9px] text-left">Aksi</th>}
                <th className="w-8 px-3 py-[9px]" />
              </tr>
            </thead>
            <tbody>
              {filteredRows.map(({ mrp, detail, warnaLabel, badges, vendors }) => {
                const isExpanded = expandedIds.has(mrp.id);
                const breakdown = mrpWarnaBreakdown(detail);
                return (
                  <Fragment key={mrp.id}>
                    <tr
                      onClick={() => toggleExpanded(mrp.id)}
                      className="cursor-pointer border-b border-[#F1F4F7] font-sans text-xs text-[#31414F] last:border-b-0 hover:bg-[#FAFBFC]"
                      title="Klik untuk lihat rincian warna (qty/roll/rib panjang · pendek · total)"
                    >
                      <td className="px-5 py-[13px] font-mono font-medium">{mrp.id}</td>
                      {visibleCols.has("kategori") && (
                        <td className="px-3 py-[13px]">
                          {mrp.kategori} · {warnaLabel}
                        </td>
                      )}
                      {visibleCols.has("qty") && <td className="px-3 py-[13px] text-right font-mono">{formatPcs(effectiveMrpQty(mrp.id, mrp.qty, maklonPOs))}</td>}
                      {visibleCols.has("vendor") && <td className="px-3 py-[13px]">{vendors.length ? vendors.join(", ") : "—"}</td>}
                      {visibleCols.has("tglMrp") && <td className="px-3 py-[13px] font-mono">{formatDate(detail?.dates?.created)}</td>}
                      {visibleCols.has("tglPO") && <td className="px-3 py-[13px] font-mono">{formatDate(detail?.dates?.poSent)}</td>}
                      {visibleCols.has("tglApproved") && <td className="px-3 py-[13px] font-mono">{formatDate(detail?.dates?.poApproved)}</td>}
                      {visibleCols.has("tglInvoice") && <td className="px-3 py-[13px] font-mono">{formatDate(detail?.dates?.firstInvoice)}</td>}
                      {visibleCols.has("tglPayment") && <td className="px-3 py-[13px] font-mono">{formatDate(detail?.dates?.firstPayment)}</td>}
                      {visibleCols.has("statusScm") && (
                        <td className="px-3 py-[13px]">
                          {detail ? (
                            <StatusPill tone={ppicApprovalBadge(detail.ppicApproval).tone}>{ppicApprovalBadge(detail.ppicApproval).label}</StatusPill>
                          ) : (
                            "—"
                          )}
                        </td>
                      )}
                      {visibleCols.has("statusPO") && (
                        <td className="px-3 py-[13px]">
                          <StatusPill tone={badgeTone(badges.statusPO)}>{badges.statusPO}</StatusPill>
                        </td>
                      )}
                      {visibleCols.has("statusRM") && (
                        <td className="px-3 py-[13px]">
                          <StatusPill tone={badgeTone(badges.statusRawMaterial)}>{badges.statusRawMaterial}</StatusPill>
                        </td>
                      )}
                      {visibleCols.has("statusProduksi") && (
                        <td className="px-5 py-[13px]">
                          <StatusPill tone={badgeTone(badges.statusProduksi)}>{badges.statusProduksi}</StatusPill>
                        </td>
                      )}
                      {sysadmin ? (
                        // Mode Sysadmin: "Reset MRP" milik PPIC disembunyikan (server menolak Sysadmin) -- diganti kolom
                        // "Aksi Sysadmin" yang punya pengaman jejak uang/fisik.
                        <SysadminTd className="py-[13px]" actions={mrpCorrections(mrp.id, { detail, materialPOs, maklonPOs, invoices, vendorInvoices, maklonInvoices, productionBatches, deliveryKolis })} />
                      ) : (
                        <td className="whitespace-nowrap px-3 py-[13px]">
                          {detail && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                openRasio(mrp.id);
                              }}
                              title="Download Form Rasio (Excel) -- pilih vendor dulu"
                              className="mr-1.5 rounded-[5px] border border-[#CBD5DF] px-2.5 py-[5px] font-sans text-[11px] font-semibold text-action-primary hover:bg-info-bg"
                            >
                              Form Rasio
                            </button>
                          )}
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleResetMrp(mrp.id);
                            }}
                            disabled={resettingId === mrp.id}
                            title="Hapus semua data MRP ini saja (PO, invoice, produksi, pengiriman) -- tidak bisa dibatalkan"
                            className="rounded-[5px] border border-[#EFC9C4] px-2.5 py-[5px] font-sans text-[11px] font-semibold text-danger-fg hover:bg-danger-bg disabled:opacity-50"
                          >
                            {resettingId === mrp.id ? "Menghapus…" : "Reset MRP"}
                          </button>
                        </td>
                      )}
                      <td className="px-3 py-[13px]">
                        {isExpanded ? (
                          <ChevronDown className="h-3.5 w-3.5 flex-none text-text-muted" />
                        ) : (
                          <ChevronRight className="h-3.5 w-3.5 flex-none text-text-muted" />
                        )}
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr className="border-b border-[#F1F4F7] last:border-b-0">
                        <td colSpan={totalCols} className="bg-[#FAFBFC] px-5 py-4">
                          {detail?.ppicApproval === "REJECTED" && (
                            <div className="mb-3 rounded-md border border-[#EFC9C4] bg-danger-bg px-3.5 py-2.5 font-sans text-[11.5px] leading-[1.5] text-danger-fg">
                              <span className="font-semibold">Ditolak SCM</span>
                              {detail.ppicRejectionNote ? ` — ${detail.ppicRejectionNote}` : ""} — impor ulang dengan data yang sudah dibetulkan kalau perlu diajukan lagi.
                            </div>
                          )}
                          <MrpWarnaBreakdownTable breakdown={breakdown} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
              {filteredRows.length === 0 && (
                <tr>
                  <td colSpan={totalCols} className="px-5 py-6 text-center font-sans text-xs text-text-muted">
                    Tidak ada MRP yang cocok dengan filter.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
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
