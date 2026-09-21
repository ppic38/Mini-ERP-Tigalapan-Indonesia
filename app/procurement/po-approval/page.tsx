"use client";

import { Fragment, useEffect, useState } from "react";
import Link from "next/link";
import { AppShell } from "@/components/shell/app-shell";
import { StatusPill } from "@/components/ui/status-pill";
import { Button } from "@/components/ui/button";
import { Tabs } from "@/components/ui/tabs";
import { VendorSwitchModal } from "@/components/mrp/vendor-switch-modal";
import { MaklonPoWarnaLenganTable } from "@/components/mrp/maklon-po-warna-lengan-table";
import { DataTable, type ColumnDef } from "@/components/mrp/data-table";
import { useMrpStore } from "@/lib/mrp/store";
import {
  aduanRowsForVendor,
  formatDate,
  formatPcs,
  formatRupiah,
  hargaKainRate,
  hargaKerahMansetRateInfo,
  hargaRibRateInfo,
  hasRoundedRollPendingRevert,
  hasUnroundedFractionalRoll,
  inferMaterialKategori,
  MATERIAL_KATEGORI_URUTAN,
  maklonPoBadgeWithApproval,
  maklonPoDeliveryProgress,
  maklonPoInvoiceLockedBy,
  maklonRateExplanation,
  materialGroupsByWarna,
  materialPoFullStatus,
  materialPoFullStatusBadge,
  materialRateExplanation,
  materialSupplierNamesForWarna,
  mrpDetailFor,
  summarizeRateSources,
  vendorProduksiRows,
} from "@/lib/mrp/derive";
import { countMaterialRowsWithoutSupplierForMrp, pendingMarker } from "@/lib/shell/badges";
import { exportMaklonPoPdf, exportMaterialPoPdf, exportMaterialPoPdfBatch } from "@/lib/mrp/exportPoPdf";
import { ROLL_KG_ESTIMATE, VENDOR_PRODUKSI } from "@/lib/mrp/seed";
import type { MaklonPO, MaterialPO } from "@/lib/mrp/types";

/** Badge kecil "Standar"/"PKS"/"Estimasi" di sebelah nilai Rupiah — hover untuk lihat rincian
 *  per lengan/warna (kenapa dapat harga itu, tonase/kapasitas berapa). Dipakai di 3 tempat:
 *  preview "Est. biaya" vendor produksi, kolom "Nilai" tabel PO Material, kolom "Nilai" tabel
 *  PO Vendor Produksi — semua bersumber dari fungsi yang sama di lib/mrp/derive.ts supaya label
 *  selalu konsisten dengan angka yang benar-benar dipakai. */
function RateBadge({ explanation }: { explanation: { sources: ("PKS" | "Standar" | "Estimasi")[]; lines: string[] } }) {
  if (explanation.lines.length === 0) return null;
  const summary = summarizeRateSources(explanation.sources);
  return (
    <span title={explanation.lines.join("\n")}>
      <StatusPill tone={summary.tone}>{summary.label}</StatusPill>
    </span>
  );
}

// Tint latar per jenis bahan di tabel Material (owner 2026-09-18: "ada pemisah" antara kg/Rp Rib,
// Kerah, Manset) -- dipasangkan ke kolom kg-nya SENDIRI dan kolom Est.(Rp)-nya supaya kelihatan
// jelas 1 pasang, TIDAK dipakai untuk kolom Roll/Est. Kain (warna default, dianggap "kolom utama").
const MATERIAL_GROUP_BG = { rib: "bg-[#F5F8FF]", kerah: "bg-[#F5FBF7]", manset: "bg-[#FFF8F0]" };

export default function PoApprovalPage() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const mrpDetails = useMrpStore((s) => s.mrpDetails);
  const materialPOs = useMrpStore((s) => s.materialPOs);
  const maklonPOs = useMrpStore((s) => s.maklonPOs);
  const invoices = useMrpStore((s) => s.invoices);
  const productionBatches = useMrpStore((s) => s.productionBatches);
  const productionResults = useMrpStore((s) => s.productionResults);
  const deliveryKolis = useMrpStore((s) => s.deliveryKolis);
  const vendorInvoices = useMrpStore((s) => s.vendorInvoices);
  const maklonInvoices = useMrpStore((s) => s.maklonInvoices);
  const switchAduanVendorByRoll = useMrpStore((s) => s.switchAduanVendorByRoll);
  const assignMaterialSupplier = useMrpStore((s) => s.assignMaterialSupplier);
  const sendPoToFinance = useMrpStore((s) => s.sendPoToFinance);
  const roundMaterialPoRollCounts = useMrpStore((s) => s.roundMaterialPoRollCounts);
  const revertMaterialPoRollRounding = useMrpStore((s) => s.revertMaterialPoRollRounding);
  const hargaKain = useMrpStore((s) => s.hargaKain);
  const hargaKainPks = useMrpStore((s) => s.hargaKainPks);
  const hargaMaklon = useMrpStore((s) => s.hargaMaklon);
  const vendorProduksiList = useMrpStore((s) => s.vendorProduksiList);
  const hargaRib = useMrpStore((s) => s.hargaRib);
  const hargaKerahManset = useMrpStore((s) => s.hargaKerahManset);
  const kerahMansetSettings = useMrpStore((s) => s.kerahMansetSettings);

  const [selectedId, setSelectedId] = useState<string>("");
  const [drillVendor, setDrillVendor] = useState<string | null>(null);
  // Revisi 2026-09-17 (owner: "buatkan tab halaman terpisah seperti di Paying Voucher") -- Material
  // (assign supplier kain + histori PO Material) dan Produksi (assign vendor produksi maklon +
  // histori PO Vendor Produksi) dipisah jadi sub-tab, pola sama seperti Tabs di /raw-material.
  // Selector "— pilih MRP —" & tombol "Kirim PO ke Finance" tetap di luar tab (dipakai bareng oleh
  // keduanya -- 1x kirim PO mencakup material & vendor produksi sekaligus, bukan 2 aksi terpisah).
  type PoApprovalTab = "material" | "produksi";
  const [tab, setTab] = useState<PoApprovalTab>("material");
  // Revisi 2026-09-17 (owner: "jangan card grouping, mau row tabel memanjang, dikelompokkan per
  // No MRP dulu, baru klik untuk lihat supplier, baru klik supplier untuk lihat vendor produksi")
  // -- pohon 3 tingkat dalam SATU container: MRP -> Supplier -> Vendor Produksi (leaf = 1 PO
  // material). expandedSupplierMaterial dikunci ke `${mrpId}::${supplier}` supaya supplier dengan
  // nama sama di MRP lain tidak ikut kebuka.
  const [expandedMrpMaterial, setExpandedMrpMaterial] = useState<string | null>(null);
  const [expandedSupplierMaterial, setExpandedSupplierMaterial] = useState<string | null>(null);
  const [expandedVendorMaterial, setExpandedVendorMaterial] = useState<string | null>(null);
  // Item revisi 2026-09-17 (owner: "kolom Sumber di-hide-kan saja, jadikan fitur kolom yang bisa
  // ditampilkan/di-hide seperti fitur kolom di ERP ini") -- tabel pohon PO Material ini custom
  // HTML table (bukan DataTable/ColumnDef), jadi TIDAK otomatis dapat toggle "⊞ Kolom" bawaan
  // DataTable (lihat components/mrp/data-table.tsx) -- ditiru manual di sini, cuma untuk kolom
  // yang isinya baru muncul di leaf (level PO), bukan kolom "No MRP/Supplier/Vendor Produksi"
  // (selalu tampil, sama seperti firstColumn di DataTable yang tidak bisa dimatikan).
  const materialTreeColumns: { key: string; label: string; default: boolean }[] = [
    { key: "jumlah", label: "Jumlah", default: true },
    { key: "roll", label: "Roll", default: true },
    { key: "nilai", label: "Nilai", default: true },
    { key: "sumber", label: "Sumber", default: false },
    { key: "status", label: "Status", default: true },
    { key: "aksi", label: "Aksi", default: true },
  ];
  const [visibleMaterialCols, setVisibleMaterialCols] = useState<Set<string>>(new Set(materialTreeColumns.filter((c) => c.default).map((c) => c.key)));
  const [materialColOpen, setMaterialColOpen] = useState(false);
  function toggleMaterialCol(key: string) {
    setVisibleMaterialCols((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }
  // Revisi 2026-09-17 (owner: "PO Produksi juga digrouping, dari pilih No MRP dulu baru masuk ke
  // list vendor produksi") -- pilih No MRP dulu lewat tabel ringkas, baru tabel PO Vendor Produksi
  // (DataTable lama, lengkap dengan toggle Kolom/filter/expand rincian warna-lengan) muncul
  // TERBATAS ke MRP itu saja -- bukan pohon expand custom lagi karena DataTable-nya sendiri sudah
  // representasi "list vendor produksi" yang lengkap, tinggal di-scope.
  const [expandedMaklonMrp, setExpandedMaklonMrp] = useState<string | null>(null);
  // Owner 2026-09-16: tabel Material dikelompokkan per kategori kain + checkbox bulk-assign
  // supplier untuk banyak warna sekaligus. State ini di-reset di onChange dropdown MRP di bawah
  // (bukan useEffect, supaya tidak melanggar react-hooks/set-state-in-effect) supaya centangan/
  // filter MRP sebelumnya tidak "nempel" ke MRP lain yang baru dipilih.
  const [materialKategoriFilter, setMaterialKategoriFilter] = useState<string>("");
  const [selectedWarna, setSelectedWarna] = useState<Set<string>>(new Set());
  const [bulkSupplier, setBulkSupplier] = useState<string>("");

  // MRP baru bisa dibuatkan PO setelah disetujui SCM (lihat approvePpicMrp di lib/mrp/store.ts) —
  // ini gerbang yang sengaja ditambahkan supaya PPIC tidak langsung "tembus" ke Procurement tanpa
  // direview atasan dulu.
  const selectable = mrpDetails.filter((d) => !d.poSent && d.ppicApproval === "PPIC_APPROVED");
  const awaitingScm = mrpDetails.filter((d) => !d.poSent && d.ppicApproval === "WAITING_PPIC_APPROVAL").length;

  useEffect(() => {
    if (!selectedId && selectable.length > 0) setSelectedId(selectable[0].mrp.id);
  }, [selectable, selectedId]);

  if (!mounted) return null;

  const detail = mrpDetails.find((d) => d.mrp.id === selectedId && !d.poSent);
  const vendorRows = detail ? vendorProduksiRows(detail, hargaMaklon, vendorProduksiList) : [];
  // Baris qtyRoll 0 = kombinasi warna+lengan placeholder (tidak ada yang dipesan) -- jangan ikut
  // dihitung "outstanding" gara-gara belum ada vendor untuk warna yang memang kosong.
  // Revisi 2026-09-18 (owner: "tetap bisa ajukan PO meskipun ada beberapa warna yang belum
  // dipilih suppliernya"): dulu "Kirim PO ke Finance" diblokir TOTAL sampai SEMUA warna assigned
  // (allMaterialAssigned, all-or-nothing) -- sekarang tombol aktif begitu ADA MINIMAL 1 warna
  // yang siap (sudah pilih vendor material & belum pernah dikirim), sisanya yang belum siap tetap
  // outstanding dan bisa dikirim menyusul kapan saja tanpa perlu MRP ini dipilih ulang dari awal
  // (lihat sentToPoAt, sendPoToFinanceAction — MRP TIDAK hilang dari "MRP tanpa PO" sampai semua
  // warna tuntas terkirim).
  const outstandingMaterialRows = detail ? detail.materialRows.filter((m) => m.qtyRoll > 0 && !m.sentToPoAt) : [];
  const hasSendableMaterial = outstandingMaterialRows.some((m) => m.supplier);

  // Dulu cuma menampilkan status WAITING_APPROVAL — begitu Finance approve, row (dan tombol
  // Download PO-nya) hilang dari tabel, padahal Procurement justru BUTUH download PDF-nya
  // SETELAH disetujui (untuk dikirim ke pihak luar/vendor via WA, dsb). Sekarang tampilkan
  // semua PO material (kecuali yang dibatalkan), konsisten dengan tabel PO Vendor Produksi di
  // bawah yang memang sudah begini dari awal — filter Status tersedia kalau cuma mau lihat
  // yang masih pending.
  const allMaterialPOs = materialPOs.filter((p) => p.status !== "CANCELLED");

  // Pohon 3 tingkat (lihat catatan di deklarasi expandedMrpMaterial): tingkat 1 kelompokkan PO
  // material per No MRP -- ini yang dibuka duluan. Tingkat 2 (per supplier) dihitung on-demand
  // lewat supplierSummariesForMrp() begitu satu baris MRP diklik, supaya tidak menghitung ulang
  // grouping untuk MRP yang belum dibuka.
  const materialMrpSummaries = (() => {
    const map = new Map<string, MaterialPO[]>();
    for (const p of allMaterialPOs) {
      if (!map.has(p.mrpId)) map.set(p.mrpId, []);
      map.get(p.mrpId)!.push(p);
    }
    return Array.from(map.entries())
      .map(([mrpId, pos]) => ({
        mrpId,
        pos,
        supplierCount: new Set(pos.map((p) => p.supplier || "— Belum ada supplier —")).size,
        totalRoll: pos.reduce((sum, p) => sum + p.rollCount, 0),
        totalNilai: pos.reduce((sum, p) => sum + p.amount, 0),
      }))
      .sort((a, b) => b.mrpId.localeCompare(a.mrpId, "id-ID"));
  })();

  function supplierSummariesForMrp(pos: MaterialPO[]) {
    const map = new Map<string, MaterialPO[]>();
    for (const p of pos) {
      const key = p.supplier || "— Belum ada supplier —";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(p);
    }
    return Array.from(map.entries())
      .map(([supplier, ps]) => ({
        supplier,
        pos: ps,
        vendorCount: new Set(ps.map((p) => p.vendorProduksi)).size,
        totalRoll: ps.reduce((sum, p) => sum + p.rollCount, 0),
        totalNilai: ps.reduce((sum, p) => sum + p.amount, 0),
      }))
      .sort((a, b) => a.supplier.localeCompare(b.supplier, "id-ID"));
  }

  // Rincian per-warna (leaf tingkat 4, dibuka dari baris vendor produksi) -- dulu ini
  // renderExpanded milik DataTable kartu-per-supplier, sekarang jadi fungsi biasa karena
  // pohonnya custom (bukan DataTable lagi). Formula rate PERSIS sama dengan materialAmountForPo
  // (dipakai hitung p.amount sendiri) supaya baris "Total" selalu cocok dengan kolom Nilai.
  function materialPoColorBreakdown(p: MaterialPO) {
    const kgByWarna = new Map<string, number>();
    for (const c of p.colorBreakdown) kgByWarna.set(c.warna, (kgByWarna.get(c.warna) ?? 0) + c.rollCount * ROLL_KG_ESTIMATE);
    const rateByWarna = new Map<string, number>();
    for (const [warna, kg] of kgByWarna) rateByWarna.set(warna, hargaKainRate(hargaKain, hargaKainPks, p.supplier, warna, kg));
    return (
      <div className="overflow-hidden rounded-md border border-[#E4E8EE] bg-white">
        <div className="grid grid-cols-6 gap-x-2 bg-[#F2F4F7] px-3 py-1.5 font-sans text-[10px] font-medium uppercase tracking-wider text-text-muted">
          <span>Warna</span>
          <span>Lengan</span>
          <span className="text-right">Roll</span>
          <span className="text-right">Harga/Kg</span>
          <span className="text-right">Subtotal</span>
          <span>Entitas</span>
        </div>
        {p.colorBreakdown.map((c, i) => {
          const rate = rateByWarna.get(c.warna) ?? 0;
          const subtotal = c.rollCount * ROLL_KG_ESTIMATE * rate;
          return (
            <div key={i} className="grid grid-cols-6 gap-x-2 border-t border-[#F1F4F7] px-3 py-1.5 font-sans text-[11.5px] text-[#31414F]">
              <span className="font-medium">{c.warna}</span>
              <span>{c.lengan}</span>
              <span className="text-right font-mono">{c.rollCount}</span>
              <span className="text-right font-mono">{formatRupiah(rate)}</span>
              <span className="text-right font-mono">{formatRupiah(subtotal)}</span>
              {/* Fix 2026-09-05: dulu langsung render `c.entitas` -- karena colorBreakdown[].entitas
                 sudah diisi DEFAULT sejak PO dibuat (lihat sendPoToFinanceAction), Procurement
                 kelihatan seolah entitas per-warna sudah final padahal Finance belum input/approve
                 apa-apa. Gating-nya disamakan persis dengan kolom "Entitas" level-PO (p.approved ?
                 ... : "-") supaya konsisten. */}
              <span className={p.approved ? undefined : "text-text-muted"} title={p.approved ? undefined : "Menunggu input dari Finance"}>
                {p.approved ? (c.entitas ?? "—") : "-"}
              </span>
            </div>
          );
        })}
        <div className="grid grid-cols-6 gap-x-2 border-t-2 border-accent-blue bg-info-bg px-3 py-1.5 font-sans text-[11.5px] font-semibold text-info-fg">
          <span className="col-span-4">Total</span>
          <span className="text-right font-mono">{formatRupiah(p.amount)}</span>
          <span />
        </div>
      </div>
    );
  }

  // Pohon 1 tingkat untuk PO Vendor Produksi (lihat catatan di deklarasi expandedMaklonMrp):
  // kelompokkan maklonPOs per No MRP dulu -- tabel DataTable di bawahnya baru muncul begitu satu
  // MRP dipilih, terbatas ke PO vendor produksi milik MRP itu saja.
  const maklonMrpSummaries = (() => {
    const map = new Map<string, MaklonPO[]>();
    for (const p of maklonPOs) {
      if (!map.has(p.mrpId)) map.set(p.mrpId, []);
      map.get(p.mrpId)!.push(p);
    }
    return Array.from(map.entries())
      .map(([mrpId, pos]) => ({
        mrpId,
        pos,
        totalQty: pos.reduce((sum, p) => sum + p.qty, 0),
        totalNilai: pos.reduce((sum, p) => sum + p.amount, 0),
      }))
      .sort((a, b) => b.mrpId.localeCompare(a.mrpId, "id-ID"));
  })();

  const maklonColumns: ColumnDef<MaklonPO>[] = [
    { key: "noPo", label: "No PO", default: true, render: (p) => <span className="font-mono font-medium">{p.id}</span> },
    { key: "vendor", label: "Vendor", default: true, render: (p) => VENDOR_PRODUKSI[p.vendorProduksi]?.name ?? p.vendorProduksi },
    { key: "qty", label: "Qty", default: true, align: "right", render: (p) => formatPcs(p.qty) + " pcs" },
    { key: "nilai", label: "Nilai", default: true, align: "right", render: (p) => formatRupiah(p.amount) },
    {
      key: "sumber",
      label: "Sumber",
      // Item revisi 2026-09-17 (owner): disembunyikan default, bisa ditampilkan lewat toggle
      // "⊞ Kolom" bawaan DataTable (lihat components/mrp/data-table.tsx) -- konsisten dengan
      // kolom "Sumber" di tabel pohon PO Material di atas yang juga default:false.
      default: false,
      render: (p) => {
        // Rincian dihitung ulang dari aduanRows saat ini (via mrpDetails) — akurat untuk PO yang
        // belum pernah disesuaikan (kasus paling umum). Kalau PO ini sempat kena
        // closePoWithReason/transferMaterial, angka p.amount sendiri sudah benar (pola "rate
        // efektif dipertahankan", lihat lib/mrp/store.ts) tapi rincian di sini bisa sedikit
        // meleset dari histori aslinya — tetap berguna sebagai gambaran umum.
        const aduanRows = mrpDetailFor(p.mrpId, mrpDetails)?.aduanRows.filter((a) => a.vendor === p.vendorProduksi) ?? [];
        return <RateBadge explanation={maklonRateExplanation(hargaMaklon, p.vendorProduksi, aduanRows)} />;
      },
    },
    { key: "tglMrp", label: "Tanggal MRP", default: false, render: (p) => formatDate(mrpDetailFor(p.mrpId, mrpDetails)?.dates.created) },
    { key: "tglPO", label: "Tanggal PO", default: false, render: (p) => formatDate(mrpDetailFor(p.mrpId, mrpDetails)?.dates.poSent) },
    {
      // default:false — sudah terwakili "Status" (begitu status maju dari FULL_WAITING_MATERIAL
      // dst, PO itu pasti approved), jadi kolom ini murni berguna SEBELUM approve saja.
      key: "approved",
      label: "Approved",
      default: false,
      render: (p) => <StatusPill tone={p.approved ? "success" : "warning"}>{p.approved ? "Ya" : "Menunggu"}</StatusPill>,
    },
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
      key: "progress",
      label: "Progress kirim/tagih",
      // default:false — visual 2-bar ini bagus untuk deep-dive tapi berat (multi-baris per
      // sel), jadi dijadikan opsional lewat toggle "Kolom" supaya tabel tetap ringkas &
      // presisi sebagai default (lihat pembatasan 7 kolom total termasuk kolom identitas).
      default: false,
      render: (p) => {
        // Kalau PO ini terlanjur ditagih lewat jalur Invoice Maklon lama (lump sum), progress
        // qty-per-pcs di bawah tidak relevan — invoicedQty akan selalu 0 walau sudah lunas,
        // jadi tampilkan label lain daripada menyesatkan (lihat catatan di maklonPoDeliveryProgress).
        const lockedBy = maklonPoInvoiceLockedBy(p.mrpId, p.vendorProduksi, maklonInvoices, vendorInvoices);
        if (lockedBy === "maklon") {
          return <span className="font-sans text-[11px] font-medium text-text-muted">Ditagih via Invoice Maklon (lump sum)</span>;
        }
        const prog = maklonPoDeliveryProgress(p, deliveryKolis, vendorInvoices);
        return (
          <div className="flex flex-col gap-1.5 min-w-[150px]">
            <div className="flex items-baseline gap-1 font-mono text-[11px]">
              <span className="text-text-muted">Kirim</span>
              <span className="font-semibold text-[#31414F]">{formatPcs(prog.deliveredQty)}</span>
              <span className="text-text-muted">/ {formatPcs(prog.targetQty)} pcs</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="h-1.5 w-full max-w-[110px] flex-1 overflow-hidden rounded-full bg-[#EEF0F3]">
                <span className="block h-full rounded-full bg-success" style={{ width: `${prog.deliveredPct}%` }} />
              </span>
              <span className="font-mono text-[10.5px] text-text-muted">{prog.deliveredPct}%</span>
            </div>
            <div className="flex items-baseline gap-1 font-mono text-[11px]">
              <span className="text-text-muted">Tagih</span>
              <span className="font-semibold text-[#31414F]">{formatPcs(prog.invoicedQty)}</span>
              <span className="text-text-muted">/ {formatPcs(prog.targetQty)} pcs</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="h-1.5 w-full max-w-[110px] flex-1 overflow-hidden rounded-full bg-[#EEF0F3]">
                <span className="block h-full rounded-full bg-accent-blue" style={{ width: `${prog.invoicedPct}%` }} />
              </span>
              <span className="font-mono text-[10.5px] text-text-muted">{prog.invoicedPct}%</span>
            </div>
          </div>
        );
      },
    },
    {
      // default:false — hampir selalu "—" (cuma terisi kalau ada line yang dibatalkan), jadi
      // dijadikan opsional lewat toggle "Kolom" biar tidak jadi kolom dash kosong terus-menerus.
      key: "cancelLines",
      label: "Cancel line",
      default: false,
      render: (p) =>
        p.cancelledLines.length
          ? p.cancelledLines.map((c, i) => (
              <div key={i} className="text-danger-fg">
                {c.warna ? `${c.warna} · ${c.lengan} — ` : ""}
                {c.rolls} roll{c.pcs ? ` (${c.pcs} pcs)` : ""}: {c.note}
              </div>
            ))
          : "—",
    },
    {
      key: "aksi",
      label: "Aksi",
      default: true,
      render: (p) => (
        <Button onClick={() => exportMaklonPoPdf(p, mrpDetails)} variant="ghost" size="xs">
          Download PO
        </Button>
      ),
    },
  ];

  return (
    <AppShell role="procurement" activeHref="/procurement/po-approval" breadcrumb={["Dashboard", "Purchase Order"]} title="Purchase Order">
      <div className="flex items-center gap-3 rounded-lg border border-border-subtle bg-surface-card px-4 py-3.5">
        <div>
          <div className="flex items-center gap-2">
            <div className="font-sans text-[11px] font-medium uppercase tracking-wider text-text-muted">MRP tanpa PO</div>
            {selectable.length > 0 && (
              <StatusPill tone="warning">{selectable.length} MRP belum dibuatkan PO</StatusPill>
            )}
            {awaitingScm > 0 && (
              <span title="MRP dari PPIC yang belum disetujui SCM — belum bisa diproses di sini">
                <StatusPill tone="neutral">{awaitingScm} MRP menunggu approval SCM</StatusPill>
              </span>
            )}
          </div>
          <select
            value={selectedId}
            onChange={(e) => {
              setSelectedId(e.target.value);
              setDrillVendor(null);
              setMaterialKategoriFilter("");
              setSelectedWarna(new Set());
              setBulkSupplier("");
            }}
            className="mt-1 rounded-md border border-[#DDE4EB] px-[11px] py-[9px] font-sans text-[12.5px] font-medium text-text-primary"
          >
            <option value="">— pilih MRP —</option>
            {selectable.map((d) => (
              <option key={d.mrp.id} value={d.mrp.id}>
                {d.mrp.id} · {formatPcs(d.mrp.qty)} pcs{pendingMarker(countMaterialRowsWithoutSupplierForMrp(d), "material belum ada vendor")}
              </option>
            ))}
          </select>
        </div>
        {detail && (
          <div className="ml-auto flex items-center gap-2">
            {outstandingMaterialRows.length > 0 && (
              <span title="Warna yang belum dipilih vendor material ATAU belum pernah dikirim ke PO">
                <StatusPill tone="warning">{outstandingMaterialRows.length} warna outstanding</StatusPill>
              </span>
            )}
            <button
              onClick={() => hasSendableMaterial && sendPoToFinance(detail.mrp.id)}
              disabled={!hasSendableMaterial}
              title={!hasSendableMaterial ? "Pilih vendor material untuk minimal 1 warna dulu" : undefined}
              className="rounded-md bg-action-primary px-3.5 py-[9px] font-sans text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              {outstandingMaterialRows.length > 0 && outstandingMaterialRows.some((m) => !m.supplier) ? "Kirim PO ke Finance (parsial)" : "Kirim PO ke Finance"}
            </button>
          </div>
        )}
      </div>

      {!detail && selectable.length === 0 && (
        <div className="rounded-lg border border-border-subtle bg-surface-card px-5 py-8 text-center font-sans text-xs text-text-muted">
          {awaitingScm > 0 ? (
            <>
              {awaitingScm} MRP dari PPIC sedang menunggu approval SCM — belum bisa dibuatkan PO sampai disetujui.
            </>
          ) : (
            <>
              Belum ada MRP yang perlu dibuatkan PO.{" "}
              <Link href="/mrp/ppic" className="font-semibold text-action-primary">
                Import MRP baru dari halaman MRP Saya.
              </Link>
            </>
          )}
        </div>
      )}

      {!detail && selectable.length > 0 && (
        <div className="rounded-lg border border-border-subtle bg-surface-card px-5 py-8 text-center font-sans text-xs text-text-muted">
          Pilih salah satu MRP di atas untuk mulai membuat PO.
        </div>
      )}

      <Tabs
        items={[
          { key: "material", label: "PO Material" },
          { key: "produksi", label: "PO Produksi" },
        ]}
        active={tab}
        onChange={(k) => setTab(k as PoApprovalTab)}
      />

      {tab === "produksi" && detail && (
          <div className="overflow-hidden rounded-lg border border-border-subtle bg-surface-card">
            <div className="border-b border-border-subtle px-4 py-3 font-sans text-[13px] font-semibold text-text-primary">Vendor produksi</div>
            {/* Item 2026-09-13 (user-reported): kolom "%" (persentase kapasitas terpakai) dihapus
               -- tidak relevan buat keputusan di halaman ini, cuma bikin tabel penuh.
               Revisi 2026-09-18 (owner: "buat tampilannya seperti PO Material, kolomnya terlalu
               jauh"): header disamakan (biru, border-accent-blue) dengan tabel Material, dan
               "Nama vendor" TIDAK LAGI minmax(0,1fr) (dulu memaksa nama merentang penuh lebar
               tabel, mendorong 3 kolom angka terisolasi jauh ke kanan) -- sekarang lebar tetap
               wajar, sisa ruang kosong di ujung kanan (bukan disebar ke celah antar kolom). */}
            <div
              className="grid gap-x-3 border-b-2 border-accent-blue bg-info-bg px-4 py-[9px] font-sans text-[10.5px] font-medium uppercase tracking-wider text-info-fg"
              style={{ gridTemplateColumns: "260px 90px 100px 140px" }}
            >
              <span className="whitespace-nowrap">Nama vendor</span>
              <span className="whitespace-nowrap text-right">Qty plan</span>
              <span className="whitespace-nowrap text-right">Kapasitas</span>
              <span className="whitespace-nowrap text-right">Est. biaya</span>
            </div>
            {vendorRows.map((v) => {
              const aduanRows = detail?.aduanRows.filter((a) => a.vendor === v.vendor) ?? [];
              return (
                <button
                  key={v.vendor}
                  onClick={() => setDrillVendor(v.vendor)}
                  className="grid items-center gap-x-3 border-b border-[#F1F4F7] px-4 py-[11px] text-left font-sans text-xs text-[#31414F] last:border-b-0 hover:bg-[#F7F9FB]"
                  style={{ gridTemplateColumns: "260px 90px 100px 140px" }}
                >
                  <span className="font-medium">{v.name}</span>
                  <span className="text-right font-mono">{formatPcs(v.qty)}</span>
                  <span className="text-right font-mono">{formatPcs(v.baseCapacity)}</span>
                  <span className="flex flex-col items-end gap-0.5 font-mono">
                    <span>{formatRupiah(v.fee)}</span>
                    <RateBadge explanation={maklonRateExplanation(hargaMaklon, v.vendor, aduanRows)} />
                  </span>
                </button>
              );
            })}
          </div>
      )}

      {tab === "material" && detail && (
          <div className="overflow-hidden rounded-lg border border-border-subtle bg-surface-card">
            <div className="border-b border-border-subtle px-4 py-3 font-sans text-[13px] font-semibold text-text-primary">Material</div>
            {(() => {
              // Item 2026-09-18 ("Kirim PO ke Finance" parsial): baris yang SUDAH ikut PO
              // (sentToPoAt terisi) dikeluarkan dari tabel ini -- tidak ada lagi yang perlu
              // dilakukan Procurement untuk warna itu. Sisa yang tampil di sini otomatis JADI
              // daftar "outstanding" (belum dipilih vendor material / belum dikirim).
              const materialGroups = materialGroupsByWarna(detail.materialRows.filter((m) => !m.sentToPoAt));
              // Item BAGIAN 2 (Req 20) — kolom Kerah/Manset kg cuma ditampilkan kalau ADA material
              // row MRP ini yang benar-benar punya nilai (kategori "WANGKI MYNO").
              const showKerahManset = materialGroups.some((g) => g.totalKerahKg > 0 || g.totalMansetKg > 0);
              // + 2 kolom "Est. Kerah (Rp)"/"Est. Manset (Rp)" (PURELY DISPLAY, tidak mengubah nilai
              // PO Bahan aktual) -- gated kondisi SAMA seperti kolom kg (showKerahManset).
              // Kolom "Est. Rib (Rp)" (Master Data Harga RIB, migration 0037) SELALU tampil -- rib
              // ada di semua kategori, bukan cuma WANGKI MYNO.
              // Kolom Warna diberi lebar minimum supaya nama warna tidak patah per kata (revisi
              // 2026-09-15, owner: tabel Material terlalu sempit).
              // Lebar kolom Kerah/Manset kg & Est. (Rp) dilebarkan (revisi 2026-09-18, owner:
              // "header-nya jangan 2 baris") supaya label header ("MANSET KG", "EST. MANSET (RP)")
              // muat 1 baris tanpa patah kata -- lihat whitespace-nowrap di header di bawah.
              // Revisi 2026-09-18 (owner: "tambah kolom estimasi harga roll" + "pisahkan kg dan
              // harga per jenis bahan biar kelihatan pasangannya") -- kolom kg & Est.(Rp) SEKARANG
              // BERPASANGAN bersebelahan per jenis bahan (Roll+EstKain, RibKg+EstRib, dst, bukan
              // lagi semua kg dulu baru semua Est. di akhir) + 1 kolom baru "Est. Kain (Rp)" untuk
              // harga kain utamanya sendiri (sebelumnya cuma RIB/Kerah/Manset yang ada estimasinya,
              // padahal harga kain-nya sendiri yang paling besar porsinya). Pemisah visual antar
              // jenis bahan pakai warna latar (lihat MATERIAL_GROUP_BG di bawah), bukan cuma grid gap.
              const cols = showKerahManset
                ? "20px minmax(120px, 1.3fr) 44px 104px 64px 104px 70px 104px 76px 104px minmax(150px, 1fr)"
                : "20px minmax(140px, 1.5fr) 44px 104px 64px 104px minmax(160px, 1fr)";
              // Owner 2026-09-16: kelompokkan per kategori kain (WANGKI MYNO/30S/KID/dsb sering
              // campur dalam 1 MRP, lihat inferMaterialKategori) + filter kategori + checkbox
              // bulk-assign supplier untuk banyak warna sekaligus (bukan 1-per-1 seperti dulu).
              const kategoriHadir = MATERIAL_KATEGORI_URUTAN.filter((k) => materialGroups.some((g) => inferMaterialKategori(g.warna) === k));
              const visibleGroups = materialKategoriFilter ? materialGroups.filter((g) => inferMaterialKategori(g.warna) === materialKategoriFilter) : materialGroups;
              const groupsByKategori = MATERIAL_KATEGORI_URUTAN.map((k) => ({ kategori: k, groups: visibleGroups.filter((g) => inferMaterialKategori(g.warna) === k) })).filter(
                (k) => k.groups.length > 0
              );
              function toggleWarna(warna: string) {
                setSelectedWarna((prev) => {
                  const next = new Set(prev);
                  if (next.has(warna)) next.delete(warna);
                  else next.add(warna);
                  return next;
                });
              }
              function applyBulkSupplier() {
                if (!bulkSupplier || selectedWarna.size === 0 || !detail) return;
                const rowIds = materialGroups.filter((g) => selectedWarna.has(g.warna)).flatMap((g) => g.rowIds);
                assignMaterialSupplier(detail.mrp.id, rowIds, bulkSupplier);
                setSelectedWarna(new Set());
                setBulkSupplier("");
              }
              return (
                <>
                  {kategoriHadir.length > 1 && (
                    <div className="flex items-center gap-1.5 border-b border-border-subtle px-4 py-2">
                      <span className="font-sans text-[10.5px] font-medium uppercase tracking-wider text-text-muted">Filter kategori:</span>
                      <select value={materialKategoriFilter} onChange={(e) => setMaterialKategoriFilter(e.target.value)} className="input w-auto !py-1 !text-[11px]">
                        <option value="">Semua kategori ({materialGroups.length} warna)</option>
                        {kategoriHadir.map((k) => (
                          <option key={k} value={k}>
                            {k} ({materialGroups.filter((g) => inferMaterialKategori(g.warna) === k).length})
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                  {selectedWarna.size > 0 && (
                    <div className="flex flex-wrap items-center gap-2 border-b border-border-subtle bg-info-bg px-4 py-2">
                      <span className="font-sans text-[11px] font-semibold text-info-fg">{selectedWarna.size} warna dipilih —</span>
                      <select value={bulkSupplier} onChange={(e) => setBulkSupplier(e.target.value)} className="input w-auto !py-1 !text-[11px]">
                        <option value="">— samakan ke supplier —</option>
                        {Array.from(new Set(Array.from(selectedWarna).flatMap((w) => materialSupplierNamesForWarna(hargaKain, w)))).map((s) => (
                          <option key={s} value={s}>
                            {s}
                          </option>
                        ))}
                      </select>
                      <Button onClick={applyBulkSupplier} variant="primary" size="xs" disabled={!bulkSupplier}>
                        Terapkan
                      </Button>
                      <Button onClick={() => setSelectedWarna(new Set())} variant="ghost" size="xs">
                        Batal pilih
                      </Button>
                    </div>
                  )}
                  <div
                    className="grid gap-x-3 border-b-2 border-accent-blue bg-info-bg px-4 py-[9px] font-sans text-[10.5px] font-medium uppercase tracking-wider text-info-fg"
                    style={{ gridTemplateColumns: cols }}
                  >
                    <input
                      type="checkbox"
                      checked={visibleGroups.length > 0 && visibleGroups.every((g) => selectedWarna.has(g.warna))}
                      onChange={(e) => {
                        const checked = e.target.checked;
                        setSelectedWarna((prev) => {
                          const next = new Set(prev);
                          for (const g of visibleGroups) {
                            if (checked) next.add(g.warna);
                            else next.delete(g.warna);
                          }
                          return next;
                        });
                      }}
                      className="h-3.5 w-3.5"
                      aria-label={materialKategoriFilter ? `Pilih semua warna kategori ${materialKategoriFilter}` : "Pilih semua warna"}
                    />
                    <span className="whitespace-nowrap">Warna</span>
                    <span className="whitespace-nowrap text-right">Roll</span>
                    <span className="whitespace-nowrap text-right">Est. Kain (Rp)</span>
                    <span className={MATERIAL_GROUP_BG.rib + " whitespace-nowrap border-l border-[#E4E9EE] pl-2 text-right"}>Rib kg</span>
                    <span className={MATERIAL_GROUP_BG.rib + " whitespace-nowrap text-right"}>Est. Rib (Rp)</span>
                    {showKerahManset && <span className={MATERIAL_GROUP_BG.kerah + " whitespace-nowrap border-l border-[#E4E9EE] pl-2 text-right"}>Kerah kg</span>}
                    {showKerahManset && <span className={MATERIAL_GROUP_BG.kerah + " whitespace-nowrap text-right"}>Est. Kerah (Rp)</span>}
                    {showKerahManset && <span className={MATERIAL_GROUP_BG.manset + " whitespace-nowrap border-l border-[#E4E9EE] pl-2 text-right"}>Manset kg</span>}
                    {showKerahManset && <span className={MATERIAL_GROUP_BG.manset + " whitespace-nowrap text-right"}>Est. Manset (Rp)</span>}
                    <span className="whitespace-nowrap">Vendor material</span>
                  </div>
                  {groupsByKategori.map(({ kategori, groups }) => (
                    <div key={kategori}>
                      {kategoriHadir.length > 1 && !materialKategoriFilter && (
                        <div className="border-b border-border-subtle bg-[#FBFCFD] px-4 py-1.5 font-sans text-[10.5px] font-semibold text-text-muted">{kategori}</div>
                      )}
                      {groups.map((g) => {
                    // Dipersempit ke supplier yang benar-benar punya harga untuk warna ini di Harga
                    // Kain — supaya tidak bisa pilih kombinasi supplier+warna yang harganya tidak ada
                    // sama sekali (yang berujung PO jatuh ke fallback "Estimasi" pakai angka flat jauh
                    // di bawah harga pasar). Daftar dummy tab Supplier sudah TIDAK ikut (2026-09-15).
                    const optionsForWarna = materialSupplierNamesForWarna(hargaKain, g.warna);
                    // Fix (review 2026-09-14): MRP WANGKI MYNO yang di-import SEBELUM fitur konversi
                    // pcs->kg ini (lihat parseImport.ts) masih punya kerah_kg/manset_kg berisi ANGKA
                    // PCS MENTAH (bukan kg -- data lama SENGAJA tidak dimigrasi, lihat spec Non-goals).
                    // Tanpa penanda apa pun, itu kelihatan "sama sahnya" dengan kg yang sudah benar --
                    // heuristik murah di sini: kg per roll yang MASUK AKAL untuk Kerah/Manset ada di
                    // kisaran ~117 pcs/roll x 0.02-0.03 kg/pcs = 2-4 kg/roll (lihat rollEstimate di
                    // parseImport.ts) -- kalau lebih dari 10x lipat itu, kemungkinan besar angkanya
                    // masih pcs mentah (bukan bug perhitungan baru, cuma data historis yang belum
                    // pernah lewat konversi ini). Estimasi Rp di kolom sebelah jadi ikut TIDAK MASUK
                    // AKAL kalau ini terjadi -- badge ini murni sinyal visual, TIDAK mengubah angka
                    // apa pun, TIDAK memblokir apa pun.
                    const kerahLooksUnconverted = g.totalRoll > 0 && g.totalKerahKg / g.totalRoll > 10;
                    const mansetLooksUnconverted = g.totalRoll > 0 && g.totalMansetKg / g.totalRoll > 10;
                    // Harga RIB/kg dari Master Data Harga RIB -- supplier terpilih dulu, lalu acuan
                    // KNITTO (lihat hargaRibRateInfo). Belum pilih supplier pun tetap dapat estimasi.
                    const ribRate = hargaRibRateInfo(hargaRib, g.supplier, g.warna);
                    // Harga Kerah/Manset per kg -- Master Data per Supplier (migration 0038), fallback
                    // KNITTO lalu harga global lama (lihat hargaKerahMansetRateInfo).
                    const kerahRate = hargaKerahMansetRateInfo(hargaKerahManset, kerahMansetSettings, g.supplier, "KERAH");
                    const mansetRate = hargaKerahMansetRateInfo(hargaKerahManset, kerahMansetSettings, g.supplier, "MANSET");
                    // Estimasi Harga Kain (Rp) -- owner 2026-09-18: "tambah kolom estimasi harga
                    // roll" -- sebelumnya cuma RIB/Kerah/Manset yang ada estimasinya, padahal kain
                    // utamanya sendiri yang paling besar porsi biayanya. Rumus SAMA dengan
                    // materialAmountForPo (dipakai p.amount PO Material sungguhan) supaya angka di
                    // sini tidak menyesatkan -- kg dari roll x ROLL_KG_ESTIMATE, rate dari
                    // hargaKainRate (Harga Kain PKS by tonase, fallback Harga Kain flat). Perlu
                    // supplier dulu (tidak ada fallback tanpa supplier, beda dari RIB/Kerah/Manset
                    // yang punya acuan KNITTO) -- tampilkan "—" kalau belum dipilih.
                    const kainKg = g.totalRoll * ROLL_KG_ESTIMATE;
                    const kainRate = g.supplier ? hargaKainRate(hargaKain, hargaKainPks, g.supplier, g.warna, kainKg) : null;
                    return (
                      <div key={g.warna} className="grid gap-x-3 items-center border-b border-[#F1F4F7] px-4 py-[11px] font-sans text-xs text-[#31414F] last:border-b-0" style={{ gridTemplateColumns: cols }}>
                        <input type="checkbox" checked={selectedWarna.has(g.warna)} onChange={() => toggleWarna(g.warna)} className="h-3.5 w-3.5" aria-label={`Pilih warna ${g.warna}`} />
                        <span>{g.warna}</span>
                        <span className="text-right font-mono">{g.totalRoll}</span>
                        <span className="text-right font-mono" title={kainRate != null ? `${kainKg.toLocaleString("id-ID", { maximumFractionDigits: 2 })} kg x ${formatRupiah(kainRate)}/kg` : "Pilih vendor material dulu untuk lihat estimasi."}>
                          {kainRate != null ? formatRupiah(kainKg * kainRate) : "—"}
                        </span>
                        <span className={MATERIAL_GROUP_BG.rib + " border-l border-[#F1F4F7] pl-2 text-right font-mono"}>{g.totalRibKg.toLocaleString("id-ID", { maximumFractionDigits: 2 })}</span>
                        {/* Estimasi Rp (kg terkonversi x harga/kg dari Master Data RIB/Kerah/Manset) --
                            PURELY DISPLAY, tidak mengubah total_biaya/nilai PO Bahan aktual manapun. */}
                        <span
                          className={MATERIAL_GROUP_BG.rib + " text-right font-mono"}
                          title={
                            ribRate
                              ? `Rib ${g.totalRibKg.toLocaleString("id-ID", { maximumFractionDigits: 2 })} kg x ${formatRupiah(ribRate.rate)}/kg (Master Data Harga RIB, ${ribRate.sourceSupplier}${ribRate.viaReference ? " — acuan, supplier ini belum punya harga RIB sendiri" : ""})`
                              : `Belum ada harga RIB untuk warna ${g.warna} di Master Data Harga RIB.`
                          }
                        >
                          {ribRate ? formatRupiah(g.totalRibKg * ribRate.rate) : "—"}
                        </span>
                        {showKerahManset && (
                          <span
                            className={MATERIAL_GROUP_BG.kerah + " border-l border-[#F1F4F7] pl-2 text-right font-mono"}
                            title={kerahLooksUnconverted ? "Angka ini tampak jauh di luar wajar (kg per roll terlalu besar) -- kemungkinan MRP lama yang di-import sebelum Master Data Kerah/Manset ada, belum pernah terkonversi ke kg sungguhan." : undefined}
                          >
                            {kerahLooksUnconverted && <span className="text-warning-fg">⚠ </span>}
                            {g.totalKerahKg.toLocaleString("id-ID", { maximumFractionDigits: 2 })}
                          </span>
                        )}
                        {showKerahManset && (
                          <span
                            className={MATERIAL_GROUP_BG.kerah + " text-right font-mono"}
                            title={`Kerah ${g.totalKerahKg.toLocaleString("id-ID", { maximumFractionDigits: 2 })} kg x ${formatRupiah(kerahRate.rate)}/kg (${kerahRate.sourceLabel}${kerahRate.viaFallback ? " — acuan, supplier ini belum punya harga Kerah sendiri" : ""})`}
                          >
                            {formatRupiah(g.totalKerahKg * kerahRate.rate)}
                          </span>
                        )}
                        {showKerahManset && (
                          <span
                            className={MATERIAL_GROUP_BG.manset + " border-l border-[#F1F4F7] pl-2 text-right font-mono"}
                            title={mansetLooksUnconverted ? "Angka ini tampak jauh di luar wajar (kg per roll terlalu besar) -- kemungkinan MRP lama yang di-import sebelum Master Data Kerah/Manset ada, belum pernah terkonversi ke kg sungguhan." : undefined}
                          >
                            {mansetLooksUnconverted && <span className="text-warning-fg">⚠ </span>}
                            {g.totalMansetKg.toLocaleString("id-ID", { maximumFractionDigits: 2 })}
                          </span>
                        )}
                        {showKerahManset && (
                          <span
                            className={MATERIAL_GROUP_BG.manset + " text-right font-mono"}
                            title={`Manset ${g.totalMansetKg.toLocaleString("id-ID", { maximumFractionDigits: 2 })} kg x ${formatRupiah(mansetRate.rate)}/kg (${mansetRate.sourceLabel}${mansetRate.viaFallback ? " — acuan, supplier ini belum punya harga Manset sendiri" : ""})`}
                          >
                            {formatRupiah(g.totalMansetKg * mansetRate.rate)}
                          </span>
                        )}
                        <select
                          value={g.supplier ?? ""}
                          onChange={(e) => {
                            // Satu pilihan supplier berlaku untuk SEMUA lengan warna ini (pendek +
                            // panjang digabung jadi satu keputusan bahan) — bukan per lengan lagi.
                            // Dikirim sebagai SATU panggilan (bukan .forEach per rowId) supaya cuma 1
                            // update + 1 refresh, bukan N yang saling susul-menyusul.
                            assignMaterialSupplier(detail.mrp.id, g.rowIds, e.target.value);
                          }}
                          className="rounded-md border border-[#DDE4EB] px-2 py-[5px] font-sans text-[11.5px] font-medium text-text-primary"
                        >
                          <option value="">— pilih vendor —</option>
                          {optionsForWarna.map((s) => (
                            <option key={s} value={s}>
                              {s}
                            </option>
                          ))}
                        </select>
                        {optionsForWarna.length === 0 && (
                          <div className={(showKerahManset ? "col-span-11" : "col-span-7") + " -mt-1.5 pb-0.5 font-sans text-[10.5px] font-medium text-warning-fg"}>
                            ⚠ Belum ada supplier dengan harga untuk warna {g.warna} di Master Data Harga Kain.
                          </div>
                        )}
                      </div>
                    );
                  })}
                    </div>
                  ))}
                </>
              );
            })()}
          </div>
      )}

      {tab === "material" && (
      <div className="overflow-hidden border border-border-subtle bg-surface-card">
        <div className="flex items-center gap-2 border-b border-border-subtle px-4 py-3">
          <span className="font-sans text-[13px] font-semibold text-text-primary">PO Material</span>
          <div className="ml-auto flex items-center gap-2">
            {/* Item 2026-09-18 (owner: "roll_count di sini kadang pecahan, apa adanya dari sheet
               Aduan Pola Excel -- mau bisa dibulatkan, tapi tetap bisa dikembalikan selama Finance
               belum approve PO-nya"): 2 tombol terpisah (bukan 1 toggle) karena PO yang sudah
               dibulatkan & yang belum bisa hidup berdampingan (mis. baru sebagian PO dibulatkan) --
               masing-masing cuma muncul kalau memang ada PO yang relevan (belum approved). */}
            {hasUnroundedFractionalRoll(allMaterialPOs) && (
              <Button onClick={() => roundMaterialPoRollCounts()} variant="muted" size="xs" title="Bulatkan roll_count yang masih pecahan pada PO Material yang belum di-approve Finance">
                Bulatkan Roll
              </Button>
            )}
            {hasRoundedRollPendingRevert(allMaterialPOs) && (
              <Button onClick={() => revertMaterialPoRollRounding()} variant="ghost" size="xs" title="Kembalikan roll_count yang sudah dibulatkan ke pecahan semula">
                Kembalikan ke Pecahan
              </Button>
            )}
            <div className="relative">
              <button
                onClick={() => setMaterialColOpen((v) => !v)}
                className="rounded-md border border-[#CBD5DF] px-2.5 py-[6px] font-sans text-[11.5px] font-semibold text-action-primary"
              >
                ⊞ Kolom
              </button>
            {materialColOpen && (
              <div className="absolute right-0 top-[110%] z-20 max-h-72 w-56 overflow-y-auto rounded-md border border-border-subtle bg-surface-card p-2 shadow-[0_8px_20px_rgba(11,19,27,.15)]">
                {materialTreeColumns.map((c) => (
                  <label key={c.key} className="flex items-center gap-2 rounded px-2 py-1.5 font-sans text-xs text-[#31414F] hover:bg-[#F7F9FB]">
                    <input type="checkbox" checked={visibleMaterialCols.has(c.key)} onChange={() => toggleMaterialCol(c.key)} className="h-3.5 w-3.5 accent-accent-blue" />
                    {c.label}
                  </label>
                ))}
              </div>
            )}
          </div>
          </div>
        </div>
        {materialMrpSummaries.length === 0 && (
          <div className="px-5 py-8 text-center font-sans text-xs text-text-muted">Belum ada PO material yang dibuat.</div>
        )}
        {materialMrpSummaries.length > 0 && (
        <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b-2 border-accent-blue bg-info-bg font-sans text-[10.5px] font-medium uppercase tracking-wider text-info-fg">
              <th className="px-5 py-[9px] text-left">No MRP / Supplier / Vendor Produksi</th>
              {visibleMaterialCols.has("jumlah") && <th className="px-3 py-[9px] text-right">Jumlah</th>}
              {visibleMaterialCols.has("roll") && <th className="px-3 py-[9px] text-right">Roll</th>}
              {visibleMaterialCols.has("nilai") && <th className="px-3 py-[9px] text-right">Nilai</th>}
              {visibleMaterialCols.has("sumber") && <th className="px-3 py-[9px] text-left">Sumber</th>}
              {visibleMaterialCols.has("status") && <th className="px-3 py-[9px] text-left">Status</th>}
              {visibleMaterialCols.has("aksi") && <th className="px-3 py-[9px] text-left">Aksi</th>}
            </tr>
          </thead>
          <tbody>
        {materialMrpSummaries.map((m) => {
          const mrpActive = expandedMrpMaterial === m.mrpId;
          return (
            <Fragment key={m.mrpId}>
              <tr
                onClick={() => {
                  const next = mrpActive ? null : m.mrpId;
                  setExpandedMrpMaterial(next);
                  setExpandedSupplierMaterial(null);
                  setExpandedVendorMaterial(null);
                }}
                className={"cursor-pointer border-b border-[#F1F4F7] font-sans text-xs text-[#31414F] hover:bg-[#FAFBFC] " + (mrpActive ? "bg-info-bg" : "")}
              >
                <td className="px-5 py-[11px]">
                  <span className="mr-1.5 text-text-muted">{mrpActive ? "▾" : "▸"}</span>
                  <span className="font-mono font-semibold text-text-primary">{m.mrpId}</span>
                </td>
                {visibleMaterialCols.has("jumlah") && <td className="px-3 py-[11px] text-right font-mono tabular-nums text-text-muted">{m.supplierCount} supplier</td>}
                {visibleMaterialCols.has("roll") && <td className="px-3 py-[11px] text-right font-mono tabular-nums">{m.totalRoll}</td>}
                {visibleMaterialCols.has("nilai") && <td className="px-3 py-[11px] text-right font-mono tabular-nums font-medium">{formatRupiah(m.totalNilai)}</td>}
                {visibleMaterialCols.has("sumber") && <td className="px-3 py-[11px]" />}
                {visibleMaterialCols.has("status") && (
                  <td className="px-3 py-[11px]">
                    <StatusPill tone="neutral">{m.pos.length} PO</StatusPill>
                  </td>
                )}
                {visibleMaterialCols.has("aksi") && (
                  <td className="px-3 py-[11px]">
                    <Button
                      onClick={(e) => {
                        e.stopPropagation();
                        exportMaterialPoPdfBatch(m.pos, mrpDetails, `PO-Material-${m.mrpId}.pdf`);
                      }}
                      disabled={m.pos.every((p) => !p.supplier)}
                      title={m.pos.every((p) => !p.supplier) ? "Belum ada PO di MRP ini yang punya vendor material" : `Download semua ${m.pos.length} PO material MRP ini jadi 1 file`}
                      variant="ghost"
                      size="xs"
                    >
                      Download PO
                    </Button>
                  </td>
                )}
              </tr>
              {mrpActive &&
                supplierSummariesForMrp(m.pos).map((s) => {
                  const supplierKey = `${m.mrpId}::${s.supplier}`;
                  const supplierActive = expandedSupplierMaterial === supplierKey;
                  return (
                    <Fragment key={supplierKey}>
                      <tr
                        onClick={() => {
                          const next = supplierActive ? null : supplierKey;
                          setExpandedSupplierMaterial(next);
                          setExpandedVendorMaterial(null);
                        }}
                        className={"cursor-pointer border-b border-[#F1F4F7] bg-[#FBFCFD] font-sans text-[11.5px] text-[#31414F] hover:bg-[#F2F5F8] " + (supplierActive ? "bg-info-bg" : "")}
                      >
                        <td className="py-[10px] pl-10 pr-3">
                          <span className="mr-1.5 text-text-muted">{supplierActive ? "▾" : "▸"}</span>
                          <span className="font-medium text-text-primary">{s.supplier}</span>
                        </td>
                        {visibleMaterialCols.has("jumlah") && <td className="px-3 py-[10px] text-right font-mono tabular-nums text-text-muted">{s.vendorCount} vendor</td>}
                        {visibleMaterialCols.has("roll") && <td className="px-3 py-[10px] text-right font-mono tabular-nums">{s.totalRoll}</td>}
                        {visibleMaterialCols.has("nilai") && <td className="px-3 py-[10px] text-right font-mono tabular-nums font-medium">{formatRupiah(s.totalNilai)}</td>}
                        {visibleMaterialCols.has("sumber") && <td className="px-3 py-[10px]" />}
                        {visibleMaterialCols.has("status") && (
                          <td className="px-3 py-[10px]">
                            <StatusPill tone="neutral">{s.pos.length} PO</StatusPill>
                          </td>
                        )}
                        {visibleMaterialCols.has("aksi") && (
                          <td className="px-3 py-[10px]">
                            <Button
                              onClick={(e) => {
                                e.stopPropagation();
                                exportMaterialPoPdfBatch(s.pos, mrpDetails, `PO-Material-${m.mrpId}-${s.supplier}.pdf`);
                              }}
                              disabled={s.pos.every((p) => !p.supplier)}
                              title={s.pos.every((p) => !p.supplier) ? "Belum ada vendor material untuk grup ini" : `Download semua ${s.pos.length} PO material supplier ini jadi 1 file`}
                              variant="ghost"
                              size="xs"
                            >
                              Download PO
                            </Button>
                          </td>
                        )}
                      </tr>
                      {supplierActive &&
                        s.pos.map((p) => {
                          const vendorActive = expandedVendorMaterial === p.id;
                          const statusInfo = materialPoFullStatusBadge(
                            materialPoFullStatus(p, invoices, productionBatches, productionResults, mrpDetails, deliveryKolis, vendorInvoices, maklonPOs)
                          );
                          return (
                            <Fragment key={p.id}>
                              <tr
                                onClick={() => setExpandedVendorMaterial(vendorActive ? null : p.id)}
                                className={"cursor-pointer border-b border-[#F1F4F7] font-sans text-[11.5px] text-[#31414F] hover:bg-[#FAFBFC] " + (vendorActive ? "bg-info-bg" : "")}
                              >
                                <td className="py-[10px] pl-16 pr-3">
                                  <span className="mr-1.5 text-text-muted">{vendorActive ? "▾" : "▸"}</span>
                                  <span className="font-medium text-text-primary">{VENDOR_PRODUKSI[p.vendorProduksi]?.name ?? p.vendorProduksi}</span>
                                  <span className="ml-1.5 font-mono text-[10.5px] text-text-muted">{p.id}</span>
                                </td>
                                {visibleMaterialCols.has("jumlah") && <td className="px-3 py-[10px]" />}
                                {visibleMaterialCols.has("roll") && <td className="px-3 py-[10px] text-right font-mono tabular-nums">{p.rollCount}</td>}
                                {visibleMaterialCols.has("nilai") && <td className="px-3 py-[10px] text-right font-mono tabular-nums font-medium">{formatRupiah(p.amount)}</td>}
                                {visibleMaterialCols.has("sumber") && (
                                  <td className="px-3 py-[10px]">
                                    <RateBadge explanation={materialRateExplanation(hargaKain, hargaKainPks, p.supplier, p.colorBreakdown)} />
                                  </td>
                                )}
                                {visibleMaterialCols.has("status") && (
                                  <td className="px-3 py-[10px]">
                                    <StatusPill tone={statusInfo.tone}>{statusInfo.label}</StatusPill>
                                  </td>
                                )}
                                {visibleMaterialCols.has("aksi") && (
                                  <td className="px-3 py-[10px]">
                                    <Button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        exportMaterialPoPdf(p, mrpDetails);
                                      }}
                                      disabled={!p.supplier}
                                      title={!p.supplier ? "Tetapkan vendor material dulu" : undefined}
                                      variant="ghost"
                                      size="xs"
                                    >
                                      Download PO
                                    </Button>
                                  </td>
                                )}
                              </tr>
                              {vendorActive && (
                                <tr>
                                  <td colSpan={1 + visibleMaterialCols.size} className="border-b border-[#F1F4F7] bg-white px-4 py-3 pl-16">
                                    {materialPoColorBreakdown(p)}
                                  </td>
                                </tr>
                              )}
                            </Fragment>
                          );
                        })}
                    </Fragment>
                  );
                })}
            </Fragment>
          );
        })}
          </tbody>
        </table>
        </div>
        )}
      </div>
      )}

      {tab === "produksi" && (
      <>
      <div className="overflow-hidden border border-border-subtle bg-surface-card">
        <div className="border-b border-border-subtle px-4 py-3 font-sans text-[13px] font-semibold text-text-primary">PO Vendor Produksi — pilih No MRP</div>
        {maklonMrpSummaries.length === 0 && (
          <div className="px-5 py-8 text-center font-sans text-xs text-text-muted">Belum ada PO vendor produksi.</div>
        )}
        {maklonMrpSummaries.length > 0 && (
        <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b-2 border-accent-blue bg-info-bg font-sans text-[10.5px] font-medium uppercase tracking-wider text-info-fg">
              <th className="px-5 py-[9px] text-left">No MRP</th>
              <th className="px-3 py-[9px] text-right">Vendor Produksi</th>
              <th className="px-3 py-[9px] text-right">Qty</th>
              <th className="px-3 py-[9px] text-right">Nilai</th>
              <th className="px-3 py-[9px] text-left">PO</th>
            </tr>
          </thead>
          <tbody>
            {maklonMrpSummaries.map((m) => {
              const active = expandedMaklonMrp === m.mrpId;
              return (
                <tr
                  key={m.mrpId}
                  onClick={() => setExpandedMaklonMrp(active ? null : m.mrpId)}
                  className={"cursor-pointer border-b border-[#F1F4F7] font-sans text-xs text-[#31414F] hover:bg-[#FAFBFC] " + (active ? "bg-info-bg" : "")}
                >
                  <td className="px-5 py-[11px]">
                    <span className="mr-1.5 text-text-muted">{active ? "▾" : "▸"}</span>
                    <span className="font-mono font-semibold text-text-primary">{m.mrpId}</span>
                  </td>
                  <td className="px-3 py-[11px] text-right font-mono tabular-nums text-text-muted">{m.pos.length} vendor</td>
                  <td className="px-3 py-[11px] text-right font-mono tabular-nums">{formatPcs(m.totalQty)} pcs</td>
                  <td className="px-3 py-[11px] text-right font-mono tabular-nums font-medium">{formatRupiah(m.totalNilai)}</td>
                  <td className="px-3 py-[11px]">
                    <StatusPill tone="neutral">{m.pos.length} PO</StatusPill>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        </div>
        )}
      </div>

      {expandedMaklonMrp && (() => {
        const scopedMaklonPOs = maklonPOs.filter((p) => p.mrpId === expandedMaklonMrp);
        return (
          <DataTable
            title={`PO Vendor Produksi — ${expandedMaklonMrp}`}
            columns={maklonColumns}
            rows={scopedMaklonPOs}
            keyOf={(p) => p.id}
            firstColumnLabel="No. MRP"
            firstColumnRender={(p) => <span className="font-mono">{p.mrpId}</span>}
            filterDefs={[
              { label: "No PO", options: Array.from(new Set(scopedMaklonPOs.map((p) => p.id))), test: (p, v) => p.id === v },
              {
                label: "Status",
                options: Array.from(new Set(scopedMaklonPOs.map((p) => maklonPoBadgeWithApproval(p, vendorInvoices).label))),
                test: (p, v) => maklonPoBadgeWithApproval(p, vendorInvoices).label === v,
              },
            ]}
            emptyText="Belum ada PO vendor produksi untuk MRP ini."
            // Item revisi 2026-09-08 (owner: "satu warna itu berapa qty-nya untuk pendek atau panjang
            // dan juga berapa harga maklon per tipe itu serta totalannya") -- item 4 (feedback batch
            // 2026-09-10) mengekstrak tabel ini ke MaklonPoWarnaLenganTable (components/mrp/) supaya
            // dipakai bareng dengan Finance > PO Approval > PO Maklon.
            renderExpanded={(p) => (
              <MaklonPoWarnaLenganTable
                vendorProduksi={p.vendorProduksi}
                amount={p.amount}
                aduanRows={mrpDetailFor(p.mrpId, mrpDetails)?.aduanRows.filter((a) => a.vendor === p.vendorProduksi) ?? []}
                hargaMaklon={hargaMaklon}
              />
            )}
          />
        );
      })()}
      </>
      )}

      {detail && drillVendor && (
        <VendorSwitchModal
          vendorName={VENDOR_PRODUKSI[drillVendor]?.name ?? drillVendor}
          rows={aduanRowsForVendor(detail, drillVendor)}
          otherVendors={Object.keys(VENDOR_PRODUKSI)
            .filter((v) => v !== drillVendor)
            .map((v) => ({ id: v, name: VENDOR_PRODUKSI[v].name }))}
          onSwitch={(warna, lengan, toVendor, rollCount) => switchAduanVendorByRoll(detail.mrp.id, warna, lengan, drillVendor, toVendor, rollCount)}
          onClose={() => setDrillVendor(null)}
        />
      )}
    </AppShell>
  );
}
