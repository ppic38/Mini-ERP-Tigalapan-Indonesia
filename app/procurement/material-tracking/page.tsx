"use client";

import { useEffect, useState } from "react";
import { AppShell } from "@/components/shell/app-shell";
import { StatusPill } from "@/components/ui/status-pill";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { DataTable, type ColumnDef } from "@/components/mrp/data-table";
import { FilterBar } from "@/components/mrp/filter-bar";
import { TransferMaterialModal, type TransferCandidate } from "@/components/mrp/transfer-material-modal";
import { SetDeliveryModal } from "@/components/mrp/set-delivery-modal";
import { WithdrawVendorModal } from "@/components/mrp/withdraw-vendor-modal";
import { useMrpStore } from "@/lib/mrp/store";
import {
  formatPcs,
  formatRupiah,
  maklonPoBadgeWithApproval,
  materialPoFullStatus,
  materialPoFullStatusBadge,
  movableRollCountForInvoiceColor,
  mrpDetailFor,
  rollArrivalProgress,
  rollArrivalStatus,
  rollArrivalStatusBadge,
  type MaterialPoFullStatus,
} from "@/lib/mrp/derive";
import { VENDOR_PRODUKSI } from "@/lib/mrp/seed";
import type { MaklonPO, MaklonPoStatus, RawMaterialInvoice } from "@/lib/mrp/types";

// PO Produksi masih "aktif" (belum sampai tahap kirim/tagih) -- eligible untuk "Vendor Berhenti
// Produksi", SAMA PERSIS gate MAKLON_PO_ACTIVE_STATUSES di withdrawVendorProductionAction
// (lib/mrp/actions.ts) supaya baris yang ditampilkan di UI konsisten dengan yang diterima server.
const MAKLON_PO_ACTIVE_STATUSES: MaklonPoStatus[] = ["FULL_WAITING_MATERIAL", "PARTIAL_WAITING_MATERIAL", "PRODUCTION", "PARTIAL_PRODUCTION"];

type TrackingRow = {
  id: string;
  kind: "invoice" | "pending";
  mrpId: string;
  poId: string;
  supplier: string;
  vendorProduksi: string;
  roll: number;
  nilai: number | null;
  warna: string;
  entitas: string;
  kodeTransaksi?: string;
  tglMrp?: string;
  tglInvoice?: string;
  tglPayment?: string;
  tglDelivery?: string;
  tglReceiving?: string;
  tglProduksi?: string;
  status: MaterialPoFullStatus;
  invoice?: RawMaterialInvoice;
};

export default function MaterialTrackingPage() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const invoices = useMrpStore((s) => s.invoices);
  const materialPOs = useMrpStore((s) => s.materialPOs);
  const maklonPOs = useMrpStore((s) => s.maklonPOs);
  const mrpDetails = useMrpStore((s) => s.mrpDetails);
  const productionBatches = useMrpStore((s) => s.productionBatches);
  const productionResults = useMrpStore((s) => s.productionResults);
  const deliveryKolis = useMrpStore((s) => s.deliveryKolis);
  const vendorInvoices = useMrpStore((s) => s.vendorInvoices);
  const setInvoicesDelivery = useMrpStore((s) => s.setInvoicesDelivery);
  const transferMaterial = useMrpStore((s) => s.transferMaterial);
  const withdrawVendorProduction = useMrpStore((s) => s.withdrawVendorProduction);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [transferOpen, setTransferOpen] = useState(false);
  const [deliveryOpen, setDeliveryOpen] = useState(false);
  // "Vendor Berhenti Produksi" -- PO Produksi yang lagi dipilih untuk dipindahkan sisa
  // pekerjaannya, lihat WithdrawVendorModal & withdrawVendorProductionAction.
  const [withdrawTarget, setWithdrawTarget] = useState<MaklonPO | null>(null);
  // Item 4 (feedback batch 2026-09-07): "Material per line" & "PO Produksi aktif" dulu ditumpuk
  // vertikal di 1 halaman -- owner khawatir makin lama makin banyak baris di keduanya jadi
  // menumpuk & membingungkan. Dipisah jadi 2 tab, murni pembungkus navigasi (isi/logic tiap
  // section tidak berubah).
  const [tab, setTab] = useState<"material" | "produksi-aktif">("material");
  // Revisi 2026-09-17 (owner: "Material Tracking: card-select, lalu breakdown warna/roll", lalu
  // "pakai konsep row-tree seperti PO Material") -- "Material per line" dikelompokkan Supplier ->
  // Vendor Produksi (baris memanjang dalam SATU container, bukan kartu grid), klik baris invoice
  // (leaf) untuk membuka rincian warna/roll (dari colorEntries). Checkbox tetap dipakai untuk
  // bulk-select (Set Delivery / Pindahkan ke vendor lain) tanpa ikut membuka rincian. Level "No
  // MRP" sengaja dilewati -- FilterBar di bawah sudah punya filter No. MRP sendiri (konsisten
  // dengan alasan yang sama di PO Material: /procurement/po-approval).
  const [expandedTrackingSupplier, setExpandedTrackingSupplier] = useState<string | null>(null);
  const [expandedTrackingVendor, setExpandedTrackingVendor] = useState<string | null>(null);
  const [expandedTrackingId, setExpandedTrackingId] = useState<string | null>(null);
  const [mrpFilterTracking, setMrpFilterTracking] = useState("");
  const [poFilterTracking, setPoFilterTracking] = useState("");
  const [entitasFilterTracking, setEntitasFilterTracking] = useState("");
  const [statusFilterTracking, setStatusFilterTracking] = useState("");
  const [rollFilterTracking, setRollFilterTracking] = useState("");

  if (!mounted) return null;

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // Item revisi 2026-09-07 (owner: "kenapa sudah status production untuk roll... yang dibuat baru
  // (berdasarkan claim) padahal belum di set delivery"): materialPoFullStatus dihitung PER MaterialPO
  // (`po.id`), bukan per invoice -- SEMUA invoice yang berbagi po.id yang sama (termasuk PV
  // pengganti klaim yang baru dibuat belakangan, lihat createClaimReplacementInvoiceAction) ikut
  // "mewarisi" status PALING MAJU di antara SEMUA invoice PO itu (lihat `rank`/`bestIdx` di
  // materialPoFullStatus) PLUS progres produksi keseluruhan PO. Ini benar untuk 1 invoice bulk per
  // PO (asumsi lama), tapi SALAH untuk PV pengganti klaim -- roll penggantinya baru diterbitkan
  // belakangan & belum tentu sudah dikirim/diterima vendor sama sekali, padahal PO induknya sendiri
  // sudah lama masuk PRODUCTION dari roll-roll LAIN yang tidak terkait. Untuk baris PV pengganti
  // (i.sourceClaimId terisi), status yang ditampilkan sekarang murni dari status invoice ITU
  // SENDIRI (WAITING_INVOICE/INVOICED/PAID/DELIVERY/RECEIVING -- field ini sendiri TIDAK PERNAH
  // maju melewati RECEIVING, lihat actions.ts, jadi aman dipetakan langsung tanpa perlu logic
  // produksi PO sama sekali), bukan status agregat PO induknya.
  const claimInvoiceOwnStatus: Record<RawMaterialInvoice["status"], MaterialPoFullStatus> = {
    WAITING_INVOICE: "WAITING_INVOICE",
    INVOICED: "INVOICE",
    PAID: "PAID",
    DELIVERY: "DELIVERY",
    RECEIVING: "RECEIVING",
    WAITING_PRODUCTION: "RECEIVING",
    PRODUCTION_DONE: "RECEIVING",
  };
  const invoiceRows: TrackingRow[] = invoices.map((i) => {
    const po = materialPOs.find((p) => p.id === i.poId);
    return {
      id: i.id,
      kind: "invoice",
      mrpId: i.mrpId,
      poId: i.poId,
      supplier: i.supplier || "— Belum ada supplier —",
      vendorProduksi: i.destinationVendor,
      roll: i.qtyReady,
      nilai: i.totalBiaya,
      warna: i.colorEntries.map((c) => c.warna).join(", ") || "—",
      entitas: i.entity,
      kodeTransaksi: i.kodeTransaksi,
      tglMrp: mrpDetailFor(i.mrpId, mrpDetails)?.dates.created,
      tglInvoice: i.bookedAt,
      tglPayment: i.paidAt,
      tglDelivery: i.deliveredAt,
      tglReceiving: i.receivedAt,
      tglProduksi: i.productionStart,
      status: i.sourceClaimId
        ? claimInvoiceOwnStatus[i.status]
        : po
          ? materialPoFullStatus(po, invoices, productionBatches, productionResults, mrpDetails, deliveryKolis, vendorInvoices, maklonPOs)
          : "INVOICE",
      invoice: i,
    };
  });

  // Material Tracking sekarang KHUSUS material yang sudah dibayar (Finance) ke atas —
  // "belum dibayar" (materialPO yang belum diinvoice sama sekali, ATAU invoice yang sudah
  // dibuat tapi statusnya masih INVOICED/belum PAID) sengaja tidak ditampilkan di sini, supaya
  // halaman ini fokus ke tracking fisik material yang sudah pasti jadi (dibayar), bukan yang
  // masih dalam proses invoice/approval. Baris "pending" (materialPO belum diinvoice) yang
  // sebelumnya ikut ditampilkan sudah dihapus dari sini.
  const rows: TrackingRow[] = invoiceRows.filter((r) => r.invoice && r.invoice.status !== "INVOICED");

  const selectedRows = rows.filter((r) => selected.has(r.id));
  const selectedInvoiceOnly = selectedRows.filter((r) => r.kind === "invoice" && r.invoice).map((r) => r.invoice!);
  const selectedPaidList = selectedInvoiceOnly.filter((i) => i.status === "PAID");
  // Item 1 (feedback batch 2026-09-04): pindah ke vendor lain sekarang dibolehkan SAMPAI tahap
  // PRODUCTION (roll individual yang sudah dipotong tetap dilindungi lewat cap "roll belum
  // dipotong" di TransferMaterialModal, lihat movableRollCountForInvoice) -- begitu status sudah
  // FINISH_GOOD ke atas (barang jadi, bukan roll lagi, lihat materialPoFullStatus), material itu
  // baru benar-benar tidak bisa dipindahkan lagi.
  const TRANSFER_BLOCKED_STATUSES = new Set<MaterialPoFullStatus>(["FINISH_GOOD", "DELIVERED_FROM_VENDOR", "SELESAI"]);
  const transferEligibleRows = selectedRows.filter((r) => r.kind === "invoice" && r.invoice && !TRANSFER_BLOCKED_STATUSES.has(r.status));
  const transferEligibleInvoices = transferEligibleRows.map((r) => r.invoice!);
  const transferBlockedCount = selectedInvoiceOnly.length - transferEligibleInvoices.length;

  const filteredRows = rows.filter(
    (r) =>
      (!mrpFilterTracking || r.mrpId === mrpFilterTracking) &&
      (!poFilterTracking || r.poId === poFilterTracking) &&
      (!entitasFilterTracking || r.entitas === entitasFilterTracking) &&
      (!statusFilterTracking || materialPoFullStatusBadge(r.status).label === statusFilterTracking) &&
      (!rollFilterTracking ||
        (r.invoice &&
          ((rollFilterTracking === "Belum" && rollArrivalStatus(r.invoice) === "BELUM") ||
            (rollFilterTracking === "Parsial" && rollArrivalStatus(r.invoice) === "PARSIAL") ||
            (rollFilterTracking === "Lengkap" && rollArrivalStatus(r.invoice) === "LENGKAP"))))
  );

  // Pohon 2 tingkat (lihat catatan di deklarasi expandedTrackingSupplier): Supplier -> Vendor
  // Produksi, leaf = baris invoice individual. Sama konsep dengan PO Material di
  // /procurement/po-approval, MRP dilewati karena sudah ada FilterBar No. MRP di bawah.
  const trackingSupplierSummaries = (() => {
    const map = new Map<string, TrackingRow[]>();
    for (const r of filteredRows) {
      if (!map.has(r.supplier)) map.set(r.supplier, []);
      map.get(r.supplier)!.push(r);
    }
    return Array.from(map.entries())
      .map(([supplier, rs]) => ({
        supplier,
        rows: rs,
        vendorCount: new Set(rs.map((r) => r.vendorProduksi)).size,
        totalRoll: rs.reduce((sum, r) => sum + r.roll, 0),
        totalNilai: rs.reduce((sum, r) => sum + (r.nilai ?? 0), 0),
      }))
      .sort((a, b) => a.supplier.localeCompare(b.supplier, "id-ID"));
  })();

  function trackingVendorSummariesForSupplier(rs: TrackingRow[]) {
    const map = new Map<string, TrackingRow[]>();
    for (const r of rs) {
      if (!map.has(r.vendorProduksi)) map.set(r.vendorProduksi, []);
      map.get(r.vendorProduksi)!.push(r);
    }
    return Array.from(map.entries())
      .map(([vendor, vrs]) => ({
        vendor,
        vendorName: VENDOR_PRODUKSI[vendor]?.name ?? vendor,
        rows: vrs,
        totalRoll: vrs.reduce((sum, r) => sum + r.roll, 0),
        totalNilai: vrs.reduce((sum, r) => sum + (r.nilai ?? 0), 0),
      }))
      .sort((a, b) => a.vendorName.localeCompare(b.vendorName, "id-ID"));
  }

  const TRACKING_TREE_COLS = "26px 22px minmax(220px, 1fr) 90px 90px 140px 160px 150px";

  // "PO Produksi aktif" -- kasus jarang tapi nyata: vendor tiba-tiba minta berhenti mid-produksi.
  // Cuma PO yang masih dalam tahap produksi aktif yang eligible (sama gate dengan
  // withdrawVendorProductionAction) -- PO yang sudah masuk Delivery/Invoice/Payment tidak ada lagi
  // yang bisa dipindahkan (Finish Good sudah selesai/dikirim, bukan WIP lagi).
  const activePOs = maklonPOs.filter((p) => p.approved && !p.closedAt && p.qty > 0 && MAKLON_PO_ACTIVE_STATUSES.includes(p.status));
  const activePoColumns: ColumnDef<MaklonPO>[] = [
    { key: "noPo", label: "No PO", default: true, render: (p) => <span className="font-mono font-medium">{p.id}</span> },
    { key: "vendor", label: "Vendor", default: true, render: (p) => VENDOR_PRODUKSI[p.vendorProduksi]?.name ?? p.vendorProduksi },
    { key: "qty", label: "Qty", default: true, align: "right", render: (p) => formatPcs(p.qty) + " pcs" },
    { key: "nilai", label: "Nilai", default: true, align: "right", render: (p) => formatRupiah(p.amount) },
    {
      key: "status",
      label: "Status",
      default: true,
      render: (p) => {
        const badge = maklonPoBadgeWithApproval(p, vendorInvoices);
        return <StatusPill tone={badge.tone}>{badge.label}</StatusPill>;
      },
    },
    {
      key: "aksi",
      label: "Aksi",
      default: true,
      render: (p) => (
        <Button onClick={() => setWithdrawTarget(p)} variant="danger" size="xs">
          Vendor Berhenti Produksi →
        </Button>
      ),
    },
  ];

  return (
    <AppShell
      role="procurement"
      activeHref="/procurement/material-tracking"
      breadcrumb={["Dashboard", "Material Tracking"]}
      title="Material tracking"
      subtitle={`${rows.length} baris material — invoice yang sudah dibayar Finance ke atas`}
    >
      <div className="flex gap-2 rounded-lg border border-border-subtle bg-surface-card p-1.5">
        {(
          [
            // Item revisi 2026-09-07: badge tab dulu cuma jumlah baris total (rows.length) --
            // owner minta badge cuma nyala kalau MASIH ADA yang perlu di-set delivery (hilang
            // begitu semua baris yang tampil sudah di-set delivery), bukan sekadar "ada baris".
            // Sama definisi dengan countMaterialInvoicesReadyForDelivery (badge sidebar).
            { key: "material" as const, label: "Material", badge: rows.filter((r) => r.invoice?.status === "PAID" && !r.invoice.deliveredAt).length },
            // "PO Produksi aktif" SENGAJA tidak pakai badge sama sekali -- ini bukan antrean kerja
            // yang perlu ditindak (beda dari "Material" di atas), murni daftar monitoring PO yang
            // sedang berjalan, jadi badge angka di sini cuma bikin bingung.
            { key: "produksi-aktif" as const, label: "PO Produksi aktif", badge: 0 },
          ]
        ).map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={
              "flex items-center gap-1.5 rounded-md px-3.5 py-[7px] font-sans text-[12.5px] font-semibold " +
              (tab === t.key ? "bg-action-primary text-white" : "text-text-muted hover:bg-[#F7F9FB]")
            }
          >
            {t.label}
            {t.badge > 0 && (
              <span className="flex-shrink-0 rounded-full bg-danger px-[5px] py-px font-mono text-[9px] font-semibold text-white">{t.badge}</span>
            )}
          </button>
        ))}
      </div>

      {tab === "produksi-aktif" && (
        <DataTable
          title="PO Produksi aktif"
          subtitle="Vendor tiba-tiba berhenti mid-produksi? Pindahkan sisa pekerjaannya (bahan mentah + WIP belum Finish Good) ke vendor lain sekaligus."
          columns={activePoColumns}
          rows={activePOs}
          keyOf={(p) => p.id}
          firstColumnLabel="No. MRP"
          firstColumnRender={(p) => <span className="font-mono">{p.mrpId}</span>}
          emptyText="Tidak ada PO Produksi aktif."
        />
      )}

      {withdrawTarget && (
        <WithdrawVendorModal
          mrpId={withdrawTarget.mrpId}
          fromVendorName={VENDOR_PRODUKSI[withdrawTarget.vendorProduksi]?.name ?? withdrawTarget.vendorProduksi}
          qty={withdrawTarget.qty}
          amount={withdrawTarget.amount}
          otherVendors={Object.entries(VENDOR_PRODUKSI)
            .filter(([id]) => id !== withdrawTarget.vendorProduksi)
            .map(([id, v]) => ({ id, name: v.name }))}
          onConfirm={(toVendor) => withdrawVendorProduction(withdrawTarget.mrpId, withdrawTarget.vendorProduksi, toVendor)}
          onClose={() => setWithdrawTarget(null)}
        />
      )}

      {tab === "material" && selected.size > 0 && (
        <div className="flex items-center gap-3 rounded-lg border border-[#CFE0EF] bg-info-bg px-5 py-[10px]">
          <span className="font-sans text-xs font-medium text-info-fg">{selected.size} dipilih</span>
          <div className="ml-1 flex gap-2">
            {selectedPaidList.length > 0 && (
              <button onClick={() => setDeliveryOpen(true)} className="rounded-md border border-[#A8C5DF] bg-white px-2.5 py-[5px] font-sans text-[11.5px] font-semibold text-action-primary">
                Set Delivery ({selectedPaidList.length})
              </button>
            )}
            {transferEligibleInvoices.length > 0 && (
              <button onClick={() => setTransferOpen(true)} className="rounded-md border border-[#A8C5DF] bg-white px-2.5 py-[5px] font-sans text-[11.5px] font-semibold text-action-primary">
                Pindahkan {transferEligibleInvoices.length} ke vendor lain
              </button>
            )}
          </div>
          {transferBlockedCount > 0 && (
            <span className="font-sans text-[11px] text-danger-fg">
              {transferBlockedCount} baris tidak bisa dipindahkan — sudah masuk Finish Good (barang jadi, bukan roll lagi).
            </span>
          )}
        </div>
      )}

      {tab === "material" && (
      <div className="overflow-hidden rounded-lg border border-border-subtle bg-surface-card">
        <div className="border-b border-border-subtle px-5 py-3 font-sans text-[13px] font-semibold text-text-primary">
          Material per line ({filteredRows.length})
        </div>
        <FilterBar
          filters={[
            { label: "No. MRP", value: mrpFilterTracking, options: Array.from(new Set(rows.map((r) => r.mrpId))), onChange: setMrpFilterTracking },
            { label: "No. PO", value: poFilterTracking, options: Array.from(new Set(rows.map((r) => r.poId))), onChange: setPoFilterTracking },
            { label: "Entitas", value: entitasFilterTracking, options: Array.from(new Set(rows.map((r) => r.entitas))), onChange: setEntitasFilterTracking },
            {
              label: "Status",
              value: statusFilterTracking,
              options: Array.from(new Set(rows.map((r) => materialPoFullStatusBadge(r.status).label))),
              onChange: setStatusFilterTracking,
            },
            { label: "Roll diterima", value: rollFilterTracking, options: ["Belum", "Parsial", "Lengkap"], onChange: setRollFilterTracking },
          ]}
        />
        {filteredRows.length === 0 && (
          <div className="px-5 py-6 text-center font-sans text-xs text-text-muted">Belum ada invoice material yang sudah dibayar Finance.</div>
        )}
        {filteredRows.length > 0 && (
        <div className="overflow-x-auto">
        <div className="min-w-[1000px]">
          <div
            className="grid gap-x-2 border-b border-border-subtle bg-[#F7F9FB] px-4 py-[9px] font-sans text-[10.5px] font-medium uppercase tracking-wider text-text-muted"
            style={{ gridTemplateColumns: TRACKING_TREE_COLS }}
          >
            <span />
            <span />
            <span>Supplier / Vendor Produksi / No PO</span>
            <span className="text-right">Vendor</span>
            <span className="text-right">Roll</span>
            <span>Progress</span>
            <span className="text-right">Nilai</span>
            <span>Status</span>
          </div>
          {trackingSupplierSummaries.map((s) => {
            const supplierActive = expandedTrackingSupplier === s.supplier;
            return (
              <div key={s.supplier}>
                <button
                  type="button"
                  onClick={() => {
                    const next = supplierActive ? null : s.supplier;
                    setExpandedTrackingSupplier(next);
                    setExpandedTrackingVendor(null);
                    setExpandedTrackingId(null);
                  }}
                  className={
                    "grid w-full items-center gap-x-2 border-b border-[#F1F4F7] px-4 py-[11px] text-left font-sans text-xs hover:bg-[#F7F9FB] " +
                    (supplierActive ? "bg-info-bg" : "")
                  }
                  style={{ gridTemplateColumns: TRACKING_TREE_COLS }}
                >
                  <span />
                  <span className="text-text-muted">{supplierActive ? "▾" : "▸"}</span>
                  <span className="font-semibold text-text-primary">{s.supplier}</span>
                  <span className="text-right font-mono tabular-nums text-text-muted">{s.vendorCount}</span>
                  <span className="text-right font-mono tabular-nums">{s.totalRoll}</span>
                  <span />
                  <span className="text-right font-mono tabular-nums font-medium">{formatRupiah(s.totalNilai)}</span>
                  <span>
                    <StatusPill tone="neutral">{s.rows.length} baris</StatusPill>
                  </span>
                </button>
                {supplierActive &&
                  trackingVendorSummariesForSupplier(s.rows).map((v) => {
                    const vendorActive = expandedTrackingSupplier === s.supplier && expandedTrackingVendor === v.vendor;
                    return (
                      <div key={v.vendor}>
                        <button
                          type="button"
                          onClick={() => {
                            const next = vendorActive ? null : v.vendor;
                            setExpandedTrackingVendor(next);
                            setExpandedTrackingId(null);
                          }}
                          className={
                            "grid w-full items-center gap-x-2 border-b border-[#F1F4F7] bg-[#FBFCFD] py-[10px] pl-8 pr-4 text-left font-sans text-[11.5px] hover:bg-[#F2F5F8] " +
                            (vendorActive ? "bg-info-bg" : "")
                          }
                          style={{ gridTemplateColumns: TRACKING_TREE_COLS }}
                        >
                          <span />
                          <span className="text-text-muted">{vendorActive ? "▾" : "▸"}</span>
                          <span className="font-medium text-text-primary">{v.vendorName}</span>
                          <span />
                          <span className="text-right font-mono tabular-nums">{v.totalRoll}</span>
                          <span />
                          <span className="text-right font-mono tabular-nums font-medium">{formatRupiah(v.totalNilai)}</span>
                          <span>
                            <StatusPill tone="neutral">{v.rows.length} baris</StatusPill>
                          </span>
                        </button>
                        {vendorActive &&
                          v.rows.map((r) => {
                            const expanded = expandedTrackingId === r.id;
                            const progress = r.invoice ? rollArrivalProgress(r.invoice) : null;
                            const arrivalBadge = r.invoice ? rollArrivalStatusBadge(rollArrivalStatus(r.invoice)) : null;
                            const statusBadge = materialPoFullStatusBadge(r.status);
                            return (
                              <div key={r.id}>
                                <div
                                  className={
                                    "grid w-full cursor-pointer items-center gap-x-2 border-b border-[#F1F4F7] py-[10px] pl-14 pr-4 text-left font-sans text-[11.5px] hover:bg-[#F7F9FB] " +
                                    (expanded ? "bg-info-bg" : "")
                                  }
                                  style={{ gridTemplateColumns: TRACKING_TREE_COLS }}
                                >
                                  <span onClick={(e) => e.stopPropagation()}>
                                    <Checkbox checked={selected.has(r.id)} onChange={() => toggle(r.id)} />
                                  </span>
                                  <span className="cursor-pointer text-text-muted" onClick={() => setExpandedTrackingId(expanded ? null : r.id)}>
                                    {expanded ? "▾" : "▸"}
                                  </span>
                                  <span className="flex cursor-pointer flex-col" onClick={() => setExpandedTrackingId(expanded ? null : r.id)}>
                                    <span className="font-medium text-text-primary">{r.poId}</span>
                                    <span className="font-mono text-[10.5px] text-text-muted">{r.mrpId}</span>
                                  </span>
                                  <span />
                                  <span className="text-right font-mono tabular-nums">{r.roll}</span>
                                  <span>
                                    {progress && progress.total > 0 && arrivalBadge ? (
                                      <span className="flex items-center gap-1">
                                        <span className="font-mono tabular-nums">
                                          {progress.arrived}/{progress.total}
                                        </span>
                                        <StatusPill tone={arrivalBadge.tone}>{arrivalBadge.label}</StatusPill>
                                      </span>
                                    ) : (
                                      <span className="text-text-muted">—</span>
                                    )}
                                  </span>
                                  <span className="text-right font-mono tabular-nums font-medium">{r.nilai != null ? formatRupiah(r.nilai) : "—"}</span>
                                  <span>
                                    <StatusPill tone={statusBadge.tone}>{statusBadge.label}</StatusPill>
                                  </span>
                                </div>
                                {expanded && r.invoice && (
                                  <div className="border-b border-[#F1F4F7] bg-white py-3 pl-14 pr-4">
                                    <div className="overflow-hidden rounded-md border border-[#E4E8EE] bg-white">
                                      <div className="grid grid-cols-3 gap-x-2 bg-[#F2F4F7] px-3 py-1.5 font-sans text-[10px] font-medium uppercase tracking-wider text-text-muted">
                                        <span>Warna / Lengan</span>
                                        <span className="text-right">Roll</span>
                                        <span className="text-right">Harga/Roll</span>
                                      </div>
                                      {r.invoice.colorEntries.map((c, i) => (
                                        <div key={i} className="grid grid-cols-3 gap-x-2 border-t border-[#F1F4F7] px-3 py-1.5 font-sans text-[11.5px] text-[#31414F]">
                                          <span>
                                            {c.warna} · {c.lengan}
                                          </span>
                                          <span className="text-right font-mono">{c.rolls.length}</span>
                                          <span className="text-right font-mono">{formatRupiah(c.hargaPerRoll)}</span>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                      </div>
                    );
                  })}
              </div>
            );
          })}
        </div>
        </div>
        )}
      </div>
      )}

      {deliveryOpen && (
        <SetDeliveryModal
          count={selectedPaidList.length}
          onCancel={() => setDeliveryOpen(false)}
          onConfirm={(deliveryDate) => {
            setInvoicesDelivery(selectedPaidList.map((i) => i.id), deliveryDate);
            setSelected(new Set());
            setDeliveryOpen(false);
          }}
        />
      )}

      {transferOpen && (
        <TransferMaterialModal
          // Item 2 (feedback batch 2026-09-10): 1 baris per (invoice, warna, lengan) -- bukan lagi
          // 1 baris per invoice dengan warna digabung jadi 1 string -- supaya user bisa pilih
          // pindahkan 1 warna saja dari invoice multi-warna, dengan cap "roll belum dipotong"
          // sendiri per warna (movableRollCountForInvoiceColor).
          items={transferEligibleInvoices.flatMap((i) =>
            i.colorEntries.map(
              (c): TransferCandidate => ({
                id: `${i.id}|${c.warna}|${c.lengan}`,
                invoiceId: i.id,
                mrpId: i.mrpId,
                poId: i.poId,
                warna: c.warna,
                lengan: c.lengan,
                qtyReady: movableRollCountForInvoiceColor(i, productionBatches, c.warna, c.lengan),
              })
            ).filter((c) => c.qtyReady > 0)
          )}
          vendors={Object.keys(VENDOR_PRODUKSI).map((v) => ({ id: v, name: VENDOR_PRODUKSI[v].name }))}
          onCancel={() => setTransferOpen(false)}
          onConfirm={(toVendor, items, deliveryDate) => {
            transferMaterial(items, toVendor, deliveryDate);
            setSelected(new Set());
            setTransferOpen(false);
          }}
        />
      )}
    </AppShell>
  );
}
