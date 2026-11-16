"use client";

import { useEffect, useState } from "react";
import { AppShell } from "@/components/shell/app-shell";
import { StatusPill } from "@/components/ui/status-pill";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { DataTable, aggSame, aggSum, type ColumnDef, type FilterDef } from "@/components/mrp/data-table";
import { KpiCard } from "@/components/ui/kpi-card";
import { Tabs } from "@/components/ui/tabs";
import { MATERIAL_ROLL_STAGES, buildMaterialRolls, type MaterialRollRow } from "@/lib/mrp/materialRolls";
import { TransferMaterialModal, type TransferCandidate } from "@/components/mrp/transfer-material-modal";
import { SetDeliveryModal } from "@/components/mrp/set-delivery-modal";
import { WithdrawVendorModal } from "@/components/mrp/withdraw-vendor-modal";
import { SysadminActionsBar } from "@/components/sysadmin/correction-dialog";
import { invoiceDeliveryCorrections } from "@/components/sysadmin/procurement-corrections";
import { RollCodeEditor } from "@/components/sysadmin/roll-code-editor";
import { useMrpStore } from "@/lib/mrp/store";
import {
  formatDate,
  formatPcs,
  formatRupiah,
  maklonPoBadgeWithApproval,
  materialPoFullStatus,
  materialPoFullStatusBadge,
  movableRollCountForInvoiceColor,
  mrpDetailFor,
  poDisplayNo,
  rollArrivalProgress,
  rollArrivalStatus,
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

/** Status kiriman di halaman ini (revisi 2026-10-13, owner): GOOD RECEIPT (hijau) kalau SEMUA roll kiriman itu sudah diterima vendor;
 *  selama belum lengkap -- sudah dikirim tapi belum diterima atau baru diterima sebagian -- tampil DELIVERY (ungu). Tahap lain
 *  (PAID, PRODUCTION, dst.) memakai lencana bawaan. Hanya tampilan; nilai status di data tidak berubah. */
function trackingStatusBadge(r: { status: MaterialPoFullStatus; invoice?: RawMaterialInvoice }) {
  if ((r.status === "DELIVERY" || r.status === "RECEIVING") && r.invoice) {
    return rollArrivalStatus(r.invoice) === "LENGKAP" ? { label: "GOOD RECEIPT", tone: "success" as const } : { label: "DELIVERY", tone: "rework" as const };
  }
  return materialPoFullStatusBadge(r.status);
}

/** Tanggal satu kiriman (satu invoice): kapan dikirim (Set Delivery), kapan roll pertama diterima vendor, dan kapan roll TERAKHIR
 *  diterima (hanya kalau semua roll sudah masuk). Diturunkan dari data yang sudah ada (deliveredAt, receivedAt, rollArrivals) --
 *  revisi 2026-10-13, owner: Procurement perlu tahu kapan dikirim dan diterima di vendor; satu PO bisa dikirim parsial,
 *  jadi ditampilkan per baris kiriman saat dibuka. */
function shipmentDates(inv: RawMaterialInvoice) {
  const dates: string[] = [];
  for (const list of Object.values(inv.rollArrivals ?? {})) for (const a of list) if (a?.arrivedAt) dates.push(a.arrivedAt);
  dates.sort();
  const { arrived, total } = rollArrivalProgress(inv);
  return {
    sent: inv.deliveredAt,
    firstReceived: dates[0] ?? inv.receivedAt,
    lastReceived: total > 0 && arrived === total ? dates[dates.length - 1] : undefined,
    arrived,
    total,
  };
}

/** Penerimaan satu warna/lengan dalam satu kiriman: "5/5 roll · 12/10/2026" atau rentang tanggal kalau diterima bertahap. */
function colorArrivalText(inv: RawMaterialInvoice, warna: string, lengan: string, rollCount: number): string {
  const list = inv.rollArrivals?.[warna + "|" + lengan] ?? [];
  const dates = list.filter((a): a is NonNullable<typeof a> => !!a?.arrivedAt).map((a) => a.arrivedAt).sort();
  if (dates.length === 0) return "Belum diterima";
  const first = formatDate(dates[0]);
  const last = formatDate(dates[dates.length - 1]);
  return `${dates.length}/${rollCount} roll · ${first === last ? first : first + " – " + last}`;
}

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
  const [tab, setTab] = useState<"material" | "roll" | "produksi-aktif">("material");
  const [shownRollKeys, setShownRollKeys] = useState<Set<string> | null>(null);
  const [rollPreset, setRollPreset] = useState<{ nonce: number; filters: Record<string, string[]>; card: string }>({ nonce: 0, filters: {}, card: "" });
  // Revisi 2026-09-17 (owner: "Material Tracking: card-select, lalu breakdown warna/roll", lalu
  // "pakai konsep row-tree seperti PO Material") -- "Material per line" dikelompokkan Supplier ->
  // Vendor Produksi (baris memanjang dalam SATU container, bukan kartu grid), klik baris invoice
  // (leaf) untuk membuka rincian warna/roll (dari colorEntries). Checkbox tetap dipakai untuk
  // bulk-select (Set Delivery / Pindahkan ke vendor lain) tanpa ikut membuka rincian.
  // Revisi 2026-09-17 (owner: "belum ada grouping per MRP-nya") -- level "No MRP" TADINYA sengaja
  // dilewati (FilterBar sudah punya filter No. MRP sendiri), tapi owner tetap mau tree 3 tingkat
  // PERSIS PO Material: No MRP -> Supplier -> Vendor Produksi (leaf). FilterBar No. MRP
  // dipertahankan (tetap berguna untuk lompat langsung ke 1 MRP tanpa scroll cari di tree).
  const [shownIds, setShownIds] = useState<Set<string> | null>(null);
  const [preset, setPreset] = useState<{ nonce: number; filters: Record<string, string[]>; card: string }>({ nonce: 0, filters: {}, card: "" });

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
  // (`po.id`), bukan per invoice -- SEMUA invoice yang berbagi po.id yang sama ikut "mewarisi" status
  // PALING MAJU di antara SEMUA invoice PO itu (lihat `rank`/`bestIdx` di materialPoFullStatus) PLUS
  // progres produksi keseluruhan PO.
  //
  // Revisi 2026-09-28 (owner-reported, screenshot: 3 baris PV/batch beda dari PO+supplier+vendor
  // yang SAMA, set delivery 1 baris malah bikin 2 baris LAIN ikut kelihatan DELIVERY juga) --
  // fix 2026-09-07 di atas TERNYATA cuma digeser (bukan diselesaikan): hanya digate ke PV pengganti
  // klaim (`i.sourceClaimId`), padahal bug PERSIS SAMA juga kejadian untuk PV BIASA -- 1 PO Material
  // wajar diinvoice bertahap jadi BEBERAPA batch PV (lihat WAITING_INVOICE_PARTIAL), dan tiap batch
  // itu barang fisiknya BENAR-BENAR bisa dikirim/diterima terpisah-pisah (owner: "case pengiriman
  // berbeda dari masing2 batch"). `materialPoFullStatus` yang mengambil status PALING MAJU dari
  // SEMUA invoice ber-po.id sama itulah yang bikin ke-3 baris "ikut" status batch paling maju.
  //
  // Sekarang digeneralisasi: SEMUA baris invoice (bukan cuma yang sourceClaimId) memakai status
  // BATCH ITU SENDIRI selama batch itu belum genuinely masuk produksi (WAITING_INVOICE/INVOICED/
  // PAID/DELIVERY/RECEIVING -- field `RawMaterialInvoice.status` untuk tahap ini murni fisik roll
  // batch itu, tidak pernah "ketularan" batch lain). Begitu batch itu SENDIRI sudah masuk tahap
  // produksi (WAITING_PRODUCTION/PRODUCTION_DONE -- rollnya sudah ikut dipotong), BARU dialihkan ke
  // materialPoFullStatus (status produksi/FG/pengiriman vendor memang genuinely level PO/MRP+warna+
  // lengan, bukan per-batch lagi -- cutting mencampur roll dari batch manapun yang sudah diterima).
  const invoiceOwnStatus: Record<RawMaterialInvoice["status"], MaterialPoFullStatus> = {
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
    const batchStartedProduction = i.status === "WAITING_PRODUCTION" || i.status === "PRODUCTION_DONE";
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
      status:
        batchStartedProduction && po
          ? materialPoFullStatus(po, invoices, productionBatches, productionResults, mrpDetails, deliveryKolis, vendorInvoices, maklonPOs)
          : invoiceOwnStatus[i.status],
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

  // Pola PPIC (owner 2026-11-16): pohon No MRP -> Supplier -> Vendor -> PO diganti tabel bersama (kelompok bawaan No. MRP >
  // Supplier), rincian invoice di panel samping, kartu mengikuti filter. Centang baris tetap dipakai untuk Set Delivery dan
  // Pindahkan ke vendor lain.
  const vendorName = (id: string) => VENDOR_PRODUKSI[id]?.name ?? id;
  const uniqSorted = (xs: string[]) => Array.from(new Set(xs.filter(Boolean))).sort((a, b) => a.localeCompare(b, "id-ID", { numeric: true }));
  const bold = (x: React.ReactNode) => <span className="font-semibold">{x}</span>;
  const deliveryLabel = (r: TrackingRow) => (r.invoice && r.invoice.status === "PAID" && !r.invoice.deliveredAt ? "Belum delivery" : "Sudah delivery");
  const arrivalLabel = (r: TrackingRow) => {
    if (!r.invoice) return "—";
    const st = rollArrivalStatus(r.invoice);
    return st === "BELUM" ? "Belum" : st === "PARSIAL" ? "Parsial" : "Lengkap";
  };
  const sortedRows = [...rows].sort((a, b) => b.mrpId.localeCompare(a.mrpId, "id-ID", { numeric: true }));
  const shownRows = shownIds ? sortedRows.filter((r) => shownIds.has(r.id)) : sortedRows;

  const trackingFilters: FilterDef<TrackingRow>[] = [
    { label: "No. MRP", options: uniqSorted(rows.map((r) => r.mrpId)).reverse(), test: (r, v) => r.mrpId === v },
    { label: "Supplier", options: uniqSorted(rows.map((r) => r.supplier)), test: (r, v) => r.supplier === v },
    { label: "Vendor", options: uniqSorted(rows.map((r) => vendorName(r.vendorProduksi))), test: (r, v) => vendorName(r.vendorProduksi) === v },
    { label: "No. PO", options: uniqSorted(rows.map((r) => r.poId)), test: (r, v) => r.poId === v },
    { label: "Entitas", options: uniqSorted(rows.map((r) => r.entitas)), test: (r, v) => r.entitas === v },
    { label: "Status", options: uniqSorted(rows.map((r) => trackingStatusBadge(r).label)), test: (r, v) => trackingStatusBadge(r).label === v },
    { label: "Delivery", options: ["Belum delivery", "Sudah delivery"], test: (r, v) => deliveryLabel(r) === v },
    { label: "Roll diterima", options: ["Belum", "Parsial", "Lengkap"], test: (r, v) => arrivalLabel(r) === v },
  ];
  const trackingColumns: ColumnDef<TrackingRow>[] = [
    { key: "sysadmin", label: "Aksi Sysadmin", default: true, sysadmin: true, render: (r) => (r.invoice ? <SysadminActionsBar compact actions={invoiceDeliveryCorrections(r.invoice)} /> : null) },
    { key: "mrp", label: "No. MRP", default: true, aggregate: aggSame((r) => r.mrpId), render: (r) => <span className="font-mono">{r.mrpId}</span> },
    { key: "supplier", label: "Supplier", default: true, aggregate: aggSame((r) => r.supplier), render: (r) => r.supplier },
    { key: "vendor", label: "Vendor", default: true, aggregate: aggSame((r) => vendorName(r.vendorProduksi)), render: (r) => vendorName(r.vendorProduksi) },
    { key: "invoice", label: "No Invoice", default: false, render: (r) => <span className="font-mono">{r.invoice?.noInvoiceVendor || "—"}</span> },
    { key: "roll", label: "Roll", default: true, align: "right", aggregate: aggSum((r) => r.roll, (n) => bold(n.toLocaleString("id-ID", { maximumFractionDigits: 2 }))), render: (r) => <span className="font-mono">{r.roll}</span> },
    {
      key: "diterima",
      label: "Diterima",
      default: true,
      align: "right",
      aggregate: (list) => {
        const p = list.reduce((acc, r) => {
          const x = r.invoice ? rollArrivalProgress(r.invoice) : { arrived: 0, total: 0 };
          return { arrived: acc.arrived + x.arrived, total: acc.total + x.total };
        }, { arrived: 0, total: 0 });
        return bold(`${p.arrived}/${p.total}`);
      },
      render: (r) => {
        const progress = r.invoice ? rollArrivalProgress(r.invoice) : null;
        return progress && progress.total > 0 ? <span className="font-mono">{progress.arrived}/{progress.total}</span> : <span className="text-text-muted">—</span>;
      },
    },
    { key: "nilai", label: "Nilai", default: true, align: "right", aggregate: aggSum((r) => r.nilai ?? 0, (n) => bold(formatRupiah(n))), render: (r) => <span className="font-mono">{r.nilai != null ? formatRupiah(r.nilai) : "—"}</span> },
    {
      key: "status",
      label: "Status",
      default: true,
      aggregate: aggSame((r) => trackingStatusBadge(r).label, (v) => <StatusPill tone={rows.map(trackingStatusBadge).find((b) => b.label === v)?.tone ?? "neutral"}>{v}</StatusPill>),
      render: (r) => <StatusPill tone={trackingStatusBadge(r).tone}>{trackingStatusBadge(r).label}</StatusPill>,
    },
    { key: "tglInvoice", label: "Tgl Invoice", default: false, render: (r) => formatDate(r.tglInvoice) },
    { key: "tglBayar", label: "Tgl Bayar", default: false, render: (r) => formatDate(r.tglPayment) },
    { key: "tglDelivery", label: "Tgl Delivery", default: true, render: (r) => formatDate(r.tglDelivery) },
    { key: "tglTerima", label: "Tgl Terima", default: false, render: (r) => formatDate(r.tglReceiving) },
    { key: "entitas", label: "Entitas", default: false, aggregate: aggSame((r) => r.entitas), render: (r) => r.entitas || "—" },
  ];

  function trackingDetail(r: TrackingRow) {
    if (!r.invoice) return null;
    const inv = r.invoice;
    const d = shipmentDates(inv);
    const box = (label: string, value: string, hint?: string) => (
      <div className="rounded-md border border-[#E4E8EE] bg-[#FAFBFC] px-3 py-2">
        <div className="font-sans text-[10px] font-medium uppercase tracking-wider text-text-muted">{label}</div>
        <div className="mt-0.5 font-mono text-[12px] font-semibold text-text-primary">{value}</div>
        {hint && <div className="font-sans text-[10.5px] text-text-muted">{hint}</div>}
      </div>
    );
    return (
      <div>
        <div className="mb-2 grid grid-cols-4 gap-2 max-md:grid-cols-1">
          {box("No. invoice supplier", inv.noInvoiceVendor || "—", inv.supplier)}
          {box("Tgl dikirim", d.sent ? formatDate(d.sent) : "Belum di-set delivery")}
          {box("Mulai diterima vendor", d.firstReceived ? formatDate(d.firstReceived) : "Belum ada roll diterima", d.total > 0 ? `${d.arrived}/${d.total} roll sudah diterima` : undefined)}
          {box("Lengkap diterima", d.lastReceived ? formatDate(d.lastReceived) : "Belum lengkap", d.lastReceived ? undefined : d.total > 0 ? `Sisa ${d.total - d.arrived} roll` : undefined)}
        </div>
        <div className="overflow-hidden rounded-md border border-[#E4E8EE] bg-white">
          <div className="grid grid-cols-4 gap-x-2 bg-[#F2F4F7] px-3 py-1.5 font-sans text-[10px] font-medium uppercase tracking-wider text-text-muted">
            <span>Warna / Lengan</span>
            <span className="text-right">Roll</span>
            <span className="text-right">Diterima vendor</span>
            <span className="text-right">Harga/Roll</span>
          </div>
          {inv.colorEntries.map((c, i) => (
            <div key={i} className="grid grid-cols-4 gap-x-2 border-t border-[#F1F4F7] px-3 py-1.5 font-sans text-[11.5px] text-[#31414F]">
              <span>
                {c.warna} · {c.lengan}
              </span>
              <span className="text-right font-mono">{c.rolls.length}</span>
              <span className="text-right font-mono text-[11px]">{colorArrivalText(inv, c.warna, c.lengan, c.rolls.length)}</span>
              <span className="text-right font-mono">{formatRupiah(c.hargaPerRoll)}</span>
            </div>
          ))}
        </div>
        <RollCodeEditor invoice={inv} />
      </div>
    );
  }

  const activePOs = maklonPOs.filter((p) => p.approved && !p.closedAt && p.qty > 0 && MAKLON_PO_ACTIVE_STATUSES.includes(p.status));
  const activeStatus = (p: MaklonPO) => maklonPoBadgeWithApproval(p, vendorInvoices);
  const activeFilters: FilterDef<MaklonPO>[] = [
    { label: "No. MRP", options: uniqSorted(activePOs.map((p) => p.mrpId)).reverse(), test: (p, v) => p.mrpId === v },
    { label: "Vendor", options: uniqSorted(activePOs.map((p) => vendorName(p.vendorProduksi))), test: (p, v) => vendorName(p.vendorProduksi) === v },
    { label: "Status", options: uniqSorted(activePOs.map((p) => activeStatus(p).label)), test: (p, v) => activeStatus(p).label === v },
  ];
  const activeColumns: ColumnDef<MaklonPO>[] = [
    { key: "mrp", label: "No. MRP", default: true, aggregate: aggSame((p) => p.mrpId), render: (p) => <span className="font-mono">{p.mrpId}</span> },
    { key: "vendor", label: "Vendor", default: true, aggregate: aggSame((p) => vendorName(p.vendorProduksi)), render: (p) => vendorName(p.vendorProduksi) },
    { key: "qty", label: "Qty", default: true, align: "right", aggregate: aggSum((p) => p.qty, (n) => bold(formatPcs(n))), render: (p) => <span className="font-mono">{formatPcs(p.qty)}</span> },
    { key: "nilai", label: "Nilai", default: true, align: "right", aggregate: aggSum((p) => p.amount, (n) => bold(formatRupiah(n))), render: (p) => <span className="font-mono">{formatRupiah(p.amount)}</span> },
    { key: "status", label: "Status", default: true, render: (p) => <StatusPill tone={activeStatus(p).tone}>{activeStatus(p).label}</StatusPill> },
    {
      key: "aksi",
      label: "Aksi",
      default: true,
      render: (p) => (
        <span onClick={(e) => e.stopPropagation()}>
          <Button onClick={() => setWithdrawTarget(p)} variant="danger" size="xs">
            Vendor Berhenti Produksi →
          </Button>
        </span>
      ),
    },
  ];

  // ---- Tab Per Roll (owner 2026-11-16): satu baris per roll kain, status sampai roll dipakai produksi ----
  const allRolls = buildMaterialRolls(
    rows.filter((r) => r.invoice).map((r) => r.invoice!),
    productionBatches
  );
  const shownRolls = shownRollKeys ? allRolls.filter((r) => shownRollKeys.has(r.key)) : allRolls;
  const kgFmt = (n: number) => n.toLocaleString("id-ID", { maximumFractionDigits: 1 });
  const rollStageTone: Record<string, "warning" | "info" | "rework" | "success"> = { Dibayar: "warning", Delivery: "info", "Diterima vendor": "rework", "Di produksi": "success" };
  const rollFilters: FilterDef<MaterialRollRow>[] = [
    { label: "Status", options: [...MATERIAL_ROLL_STAGES].filter((st) => allRolls.some((r) => r.status === st)), test: (r, v) => r.status === v },
    { label: "No. MRP", options: uniqSorted(allRolls.map((r) => r.mrpId)).reverse(), test: (r, v) => r.mrpId === v },
    { label: "Supplier", options: uniqSorted(allRolls.map((r) => r.supplier)), test: (r, v) => r.supplier === v },
    { label: "Vendor", options: uniqSorted(allRolls.map((r) => vendorName(r.vendorProduksi))), test: (r, v) => vendorName(r.vendorProduksi) === v },
    { label: "Warna", options: uniqSorted(allRolls.map((r) => r.warna)), test: (r, v) => r.warna === v },
    { label: "Lengan", options: ["PENDEK", "PANJANG"], test: (r, v) => r.lengan === v },
    { label: "Invoice", options: uniqSorted(allRolls.map((r) => r.noInvoice)), test: (r, v) => r.noInvoice === v },
  ];
  const rollColumns: ColumnDef<MaterialRollRow>[] = [
    { key: "mrp", label: "No. MRP", default: true, aggregate: aggSame((r) => r.mrpId), render: (r) => <span className="font-mono">{r.mrpId}</span> },
    { key: "supplier", label: "Supplier", default: true, aggregate: aggSame((r) => r.supplier), render: (r) => r.supplier },
    { key: "vendor", label: "Vendor", default: true, aggregate: aggSame((r) => vendorName(r.vendorProduksi)), render: (r) => vendorName(r.vendorProduksi) },
    { key: "warna", label: "Warna", default: true, aggregate: aggSame((r) => r.warna), render: (r) => r.warna },
    { key: "lengan", label: "Lengan", default: true, aggregate: aggSame((r) => r.lengan), render: (r) => (r.lengan === "PENDEK" ? "PDK" : "PJG") },
    { key: "invoice", label: "Invoice", default: false, aggregate: aggSame((r) => r.noInvoice), render: (r) => <span className="font-mono">{r.noInvoice || "—"}</span> },
    { key: "po", label: "No PO", default: false, render: (r) => <span className="font-mono" title={r.poId}>{poDisplayNo(r.poId, r.entitas)}</span> },
    { key: "lot", label: "Code Lot", default: false, render: (r) => <span className="font-mono">{r.codeLot || "—"}</span> },
    { key: "kotor", label: "Berat kotor (kg)", default: true, align: "right", aggregate: aggSum((r) => r.beratKotor, (n) => bold(kgFmt(n))), render: (r) => <span className="font-mono">{kgFmt(r.beratKotor)}</span> },
    { key: "bersih", label: "Berat bersih (kg)", default: true, align: "right", aggregate: aggSum((r) => r.beratBersih ?? 0, (n) => bold(kgFmt(n))), render: (r) => <span className="font-mono">{r.beratBersih != null ? kgFmt(r.beratBersih) : <span className="text-text-muted">—</span>}</span> },
    {
      key: "status",
      label: "Status",
      default: true,
      aggregate: aggSame((r) => r.status, (v) => <StatusPill tone={rollStageTone[v] ?? "neutral"}>{v}</StatusPill>),
      render: (r) => (
        <span title={r.tahapProduksi ? `Tahap produksi: ${r.tahapProduksi}` : undefined}>
          <StatusPill tone={rollStageTone[r.status] ?? "neutral"}>{r.status}</StatusPill>
        </span>
      ),
    },
    { key: "tahap", label: "Tahap produksi", default: false, aggregate: aggSame((r) => r.tahapProduksi ?? ""), render: (r) => r.tahapProduksi ?? <span className="text-text-muted">—</span> },
    { key: "tglBayar", label: "Tgl Bayar", default: false, render: (r) => formatDate(r.paidAt) },
    { key: "tglDelivery", label: "Tgl Delivery", default: true, render: (r) => formatDate(r.deliveryAt) },
    { key: "tglGr", label: "Tgl GR", default: true, render: (r) => formatDate(r.grAt) },
    { key: "tglResting", label: "Tgl Resting", default: true, render: (r) => formatDate(r.restingAt) },
    { key: "tglCutting", label: "Tgl Cutting", default: false, render: (r) => formatDate(r.cuttingAt) },
  ];

  const belumDelivery = shownRows.filter((r) => deliveryLabel(r) === "Belum delivery");
  const arrivedTotals = shownRows.reduce(
    (acc, r) => {
      const x = r.invoice ? rollArrivalProgress(r.invoice) : { arrived: 0, total: 0 };
      return { arrived: acc.arrived + x.arrived, total: acc.total + x.total };
    },
    { arrived: 0, total: 0 }
  );

  return (
    <AppShell
      role="procurement"
      activeHref="/procurement/material-tracking"
      breadcrumb={["Dashboard", "Material Tracking"]}
      title="Material tracking"
      subtitle={`${rows.length} baris material — invoice yang sudah dibayar Finance ke atas`}
    >
      <Tabs
        items={[
          { key: "material", label: "Material", badge: rows.filter((r) => r.invoice?.status === "PAID" && !r.invoice.deliveredAt).length },
          { key: "roll", label: "Per Roll" },
          { key: "produksi-aktif", label: "PO Produksi aktif" },
        ]}
        active={tab}
        onChange={(k) => setTab(k as "material" | "roll" | "produksi-aktif")}
      />

      {tab === "material" && (
        <div className="grid grid-cols-4 gap-3 max-lg:grid-cols-2">
          <KpiCard
            label="Belum delivery"
            value={belumDelivery.length}
            sub="sudah dibayar, klik untuk menyaring"
            accent="orange"
            active={preset.card === "delivery"}
            onClick={() =>
              setPreset((p) =>
                p.card === "delivery" ? { nonce: p.nonce + 1, filters: {} as Record<string, string[]>, card: "" } : { nonce: p.nonce + 1, filters: { Delivery: ["Belum delivery"] }, card: "delivery" }
              )
            }
          />
          <KpiCard label="Roll diterima vendor" value={`${arrivedTotals.arrived}/${arrivedTotals.total}`} sub="baris yang tampil" accent="purple" />
          <KpiCard label="Total roll" value={shownRows.reduce((s, r) => s + r.roll, 0).toLocaleString("id-ID", { maximumFractionDigits: 2 })} sub="baris yang tampil" accent="blue" />
          <KpiCard label="Total nilai" value={formatRupiah(shownRows.reduce((s, r) => s + (r.nilai ?? 0), 0))} valueClassName="text-[20px]" sub="baris yang tampil" accent="teal" />
        </div>
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
            <button onClick={() => setSelected(new Set())} className="rounded-md px-2.5 py-[5px] font-sans text-[11.5px] font-semibold text-action-primary hover:bg-white">
              Batal pilih
            </button>
          </div>
          {transferBlockedCount > 0 && (
            <span className="font-sans text-[11px] text-danger-fg">
              {transferBlockedCount} baris tidak bisa dipindahkan — sudah masuk Finish Good (barang jadi, bukan roll lagi).
            </span>
          )}
        </div>
      )}

      {tab === "material" && (
        <DataTable<TrackingRow>
          title="Material per invoice"
          columns={trackingColumns}
          rows={sortedRows}
          keyOf={(r) => r.id}
          firstColumnLabel="No PO"
          firstColumnRender={(r) => (
            <span className="flex items-center gap-2">
              <span onClick={(e) => e.stopPropagation()}>
                <Checkbox checked={selected.has(r.id)} onChange={() => toggle(r.id)} />
              </span>
              <span className="font-mono font-medium" title={r.poId}>{poDisplayNo(r.poId, r.entitas)}</span>
            </span>
          )}
          filterDefs={trackingFilters}
          filterPreset={preset}
          defaultGroupBy={["No. MRP", "Supplier"]}
          search={{ placeholder: "Cari no PO, invoice, MRP, supplier, vendor…", getText: (r) => `${r.poId} ${r.invoice?.noInvoiceVendor ?? ""} ${r.mrpId} ${r.supplier} ${vendorName(r.vendorProduksi)} ${r.warna} ${trackingStatusBadge(r).label}` }}
          renderExpanded={(r) => trackingDetail(r)}
          onFilteredRows={(list) => setShownIds(new Set(list.map((r) => r.id)))}
          emptyText="Belum ada invoice material yang sudah dibayar Finance."
          nowrap
        />
      )}

      {tab === "roll" && (
        <div className="grid grid-cols-4 gap-3 max-lg:grid-cols-2">
          {MATERIAL_ROLL_STAGES.map((st) => {
            const list = shownRolls.filter((r) => r.status === st);
            const sub = { Dibayar: "belum di-set delivery", Delivery: "belum ditandai diterima", "Diterima vendor": "belum masuk produksi", "Di produksi": "resting atau lebih" }[st];
            return (
              <KpiCard
                key={st}
                label={st}
                value={list.length}
                sub={`${sub} · ${kgFmt(list.reduce((s, r) => s + r.beratKotor, 0))} kg`}
                accent={st === "Dibayar" ? "orange" : st === "Delivery" ? "blue" : st === "Diterima vendor" ? "purple" : "teal"}
                active={rollPreset.card === st}
                onClick={() =>
                  setRollPreset((p) => (p.card === st ? { nonce: p.nonce + 1, filters: {} as Record<string, string[]>, card: "" } : { nonce: p.nonce + 1, filters: { Status: [st] }, card: st }))
                }
              />
            );
          })}
        </div>
      )}

      {tab === "roll" && (
        <DataTable<MaterialRollRow>
          title="Material per roll"
          subtitle="Satu baris per roll kain, dari dibayar sampai dipakai produksi"
          columns={rollColumns}
          rows={allRolls}
          keyOf={(r) => r.key}
          firstColumnLabel="Code Roll"
          firstColumnRender={(r) => (r.codeRoll ? <span className="font-mono font-medium">{r.codeRoll}</span> : <span className="font-mono text-text-muted">roll {r.no}</span>)}
          filterDefs={rollFilters}
          filterPreset={rollPreset}
          defaultGroupBy={["No. MRP", "Supplier"]}
          search={{ placeholder: "Cari code roll, invoice, MRP, supplier, vendor, warna…", getText: (r) => `${r.codeRoll} ${r.codeLot} ${r.noInvoice} ${r.poId} ${r.mrpId} ${r.supplier} ${vendorName(r.vendorProduksi)} ${r.warna} ${r.status}` }}
          onFilteredRows={(list) => setShownRollKeys(new Set(list.map((r) => r.key)))}
          emptyText="Belum ada roll untuk filter ini."
        />
      )}

      {tab === "produksi-aktif" && (
        <DataTable<MaklonPO>
          title="PO Produksi aktif"
          subtitle="Vendor tiba-tiba berhenti mid-produksi? Pindahkan sisa pekerjaannya (bahan mentah + WIP belum Finish Good) ke vendor lain sekaligus."
          columns={activeColumns}
          rows={activePOs}
          keyOf={(p) => p.id}
          firstColumnLabel="No PO"
          firstColumnRender={(p) => <span className="font-mono font-medium">{p.id}</span>}
          filterDefs={activeFilters}
          defaultGroupBy={["No. MRP"]}
          search={{ placeholder: "Cari no PO, MRP, vendor…", getText: (p) => `${p.id} ${p.mrpId} ${vendorName(p.vendorProduksi)}` }}
          emptyText="Tidak ada PO Produksi aktif."
          nowrap
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
