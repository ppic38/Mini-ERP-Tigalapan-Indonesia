"use client";

import { useState } from "react";
import { ClosePoReasonModal } from "@/components/mrp/close-po-reason-modal";
import { PayingVoucherWizard } from "@/components/mrp/paying-voucher-wizard";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";
import { DataTable, type ColumnDef } from "@/components/mrp/data-table";
import { FilterBar } from "@/components/mrp/filter-bar";
import { useMrpStore } from "@/lib/mrp/store";
import { formatDate, formatRupiah, invoiceBadge, materialSupplierNamesForWarna } from "@/lib/mrp/derive";
import { VENDOR_PRODUKSI } from "@/lib/mrp/seed";
import type { MaterialPO, RawMaterialInvoice } from "@/lib/mrp/types";
// Item 2.8: getInvoicePaymentProofAction dipanggil langsung (bukan lewat store), sama pola dengan
// "Lampiran Invoice" di atas -- Procurement cuma BACA bukti ini untuk diserahkan ke vendor
// material, tidak ada kontrol upload di sisi Procurement.
import { getInvoicePaymentProofAction } from "@/lib/mrp/actions";
// Revisi 2026-09-06: preview+download konsisten di semua modul -- lihat komentar di file ini.
// Revisi 2026-09-08 (bug fix popup blocked): openPreviewWindow/fillPreviewWindow -- lihat
// catatan panjang di lib/mrp/clientFiles.ts.
import { viewAndDownloadFile, openPreviewWindow, fillPreviewWindow } from "@/lib/mrp/clientFiles";

async function viewPaymentProof(invoiceId: string) {
  const win = openPreviewWindow();
  try {
    const proof = await getInvoicePaymentProofAction(invoiceId);
    if (!proof) {
      win?.close();
      return;
    }
    fillPreviewWindow(win, proof.dataUrl);
  } catch (err) {
    win?.close();
    throw err;
  }
}

/** Panel "Invoice Material" — konten diekstrak dari halaman lama Paying Voucher (Invoice)
 *  (yang sekarang jadi satu sub-tab, berdampingan dengan panel monitoring Invoice Maklon). */
export function PayingVoucherMaterialPanel() {
  const materialPOs = useMrpStore((s) => s.materialPOs);
  const invoices = useMrpStore((s) => s.invoices);
  const mrpDetails = useMrpStore((s) => s.mrpDetails);
  const bookInvoice = useMrpStore((s) => s.bookInvoice);
  const closePoWithReason = useMrpStore((s) => s.closePoWithReason);
  const reassignMaterialToSupplier = useMrpStore((s) => s.reassignMaterialToSupplier);
  const hargaKain = useMrpStore((s) => s.hargaKain);

  const [selectedPoId, setSelectedPoId] = useState<string | null>(null);
  const [afterSubmitPoId, setAfterSubmitPoId] = useState<string | null>(null);
  const [closingPoId, setClosingPoId] = useState<string | null>(null);
  // Item 6: filter No. PO / No. MRP untuk "PO material belum memiliki invoice" -- dulu satu-
  // satunya list di halaman ini tanpa filter apa pun (beda dari "Riwayat Paying Voucher" di bawah
  // yang sudah punya FilterBar lewat DataTable).
  const [poFilter, setPoFilter] = useState("");
  const [mrpFilter, setMrpFilter] = useState("");
  // Revisi 2026-09-17 (owner: "Paying Voucher & histori-nya hierarkis -- pilih supplier, baru
  // vendor produksi", lalu "pakai konsep row-tree seperti PO Material, bukan card") -- 2 tingkat
  // baris expand dalam SATU container (bukan kartu + breadcrumb terpisah lagi): Supplier -> Vendor
  // Produksi, klik baris vendor untuk membuka panel PO belum-invoice + riwayat PV persis di bawah
  // baris itu (leaf-nya panel, bukan baris lagi -- sama konsep dengan breakdown warna di PO
  // Material).
  const [expandedPvSupplier, setExpandedPvSupplier] = useState<string | null>(null);
  const [expandedPvVendor, setExpandedPvVendor] = useState<string | null>(null);

  const pvHistoryColumns: ColumnDef<RawMaterialInvoice>[] = [
    // BUG FIX: kolom ini dulu menampilkan i.id (kode PV internal sistem, mis. "INV-206311") --
    // padahal labelnya "No Invoice" bikin user mengira ini nomor invoice yang MEREKA ketik sendiri
    // di form (field "No invoice vendor material" -> i.noInvoiceVendor, mis. "OH123456789"). Nomor
    // yang diketik user itu SUDAH tersimpan benar ke database dari awal -- cuma tidak pernah
    // ditampilkan di tabel riwayat ini. Kode PV internal sistem dipindah ke kolom terpisah
    // "No PV (Sistem)" di bawah (toggle "Kolom") supaya tetap bisa ditelusuri kalau perlu.
    { key: "noInvoice", label: "No Invoice", default: true, render: (i) => <span className="font-mono font-medium">{i.noInvoiceVendor || "—"}</span> },
    { key: "noPvSistem", label: "No PV (Sistem)", default: false, render: (i) => <span className="font-mono text-text-muted">{i.id}</span> },
    { key: "noPo", label: "No PO", default: true, render: (i) => <span className="font-mono">{i.poId}</span> },
    { key: "supplierVendor", label: "Supplier → Vendor", default: true, render: (i) => `${i.supplier} → ${VENDOR_PRODUKSI[i.destinationVendor]?.name ?? i.destinationVendor}` },
    { key: "kodeTransaksi", label: "Kode Transaksi", default: true, render: (i) => <span className="font-mono">{i.kodeTransaksi}</span> },
    { key: "total", label: "Total PV", default: true, align: "right", render: (i) => formatRupiah(i.totalBiaya) },
    { key: "tglPv", label: "Tanggal PV", default: true, render: (i) => formatDate(i.bookedAt) },
    { key: "status", label: "Status", default: true, render: (i) => <StatusPill tone={invoiceBadge(i.status).tone}>{invoiceBadge(i.status).label}</StatusPill> },
    {
      key: "bukti",
      label: "Lampiran Invoice",
      default: true,
      render: (i) =>
        i.buktiPvDataUrl ? (
          <button onClick={() => viewAndDownloadFile(i.buktiPvDataUrl!)} className="font-sans text-[11px] font-semibold text-action-primary underline">
            Lihat / Download
          </button>
        ) : (
          <span className="font-sans text-[11px] text-text-muted">—</span>
        ),
    },
    {
      key: "buktiBayar",
      label: "Bukti Pembayaran",
      default: true,
      render: (i) =>
        i.buktiBayarAt ? (
          <button onClick={() => viewPaymentProof(i.id)} className="font-sans text-[11px] font-semibold text-action-primary underline">
            Lihat / Download
          </button>
        ) : (
          <span className="font-sans text-[11px] text-text-muted">—</span>
        ),
    },
  ];

  const openPOs = materialPOs.filter((po) => po.status !== "CANCELLED" && po.approved && po.invoicedRolls < po.rollCount);

  // Kelompokkan PO belum-invoice & histori PV jadi 2 tingkat: supplier -> vendor produksi ->
  // { openPOs, invoices }. Dipakai untuk kartu navigasi di bawah DAN untuk membatasi
  // list/tabel yang ditampilkan supaya konsisten dengan kartu yang diklik user.
  const pvHierarchy = (() => {
    const bySupplier = new Map<string, Map<string, { openPOs: MaterialPO[]; invoices: RawMaterialInvoice[] }>>();
    const touch = (supplier: string, vendor: string) => {
      if (!bySupplier.has(supplier)) bySupplier.set(supplier, new Map());
      const vendorMap = bySupplier.get(supplier)!;
      if (!vendorMap.has(vendor)) vendorMap.set(vendor, { openPOs: [], invoices: [] });
      return vendorMap.get(vendor)!;
    };
    for (const po of openPOs) touch(po.supplier || "— Belum ada supplier —", po.vendorProduksi).openPOs.push(po);
    for (const inv of invoices) touch(inv.supplier || "— Belum ada supplier —", inv.destinationVendor).invoices.push(inv);
    return bySupplier;
  })();

  const pvSupplierSummaries = Array.from(pvHierarchy.entries())
    .map(([supplier, vendorMap]) => {
      let openCount = 0;
      let historyCount = 0;
      let historyTotal = 0;
      for (const v of vendorMap.values()) {
        openCount += v.openPOs.length;
        historyCount += v.invoices.length;
        historyTotal += v.invoices.reduce((sum, i) => sum + i.totalBiaya, 0);
      }
      return { supplier, vendorCount: vendorMap.size, openCount, historyCount, historyTotal };
    })
    .sort((a, b) => a.supplier.localeCompare(b.supplier, "id-ID"));

  function vendorSummariesForSupplier(supplier: string) {
    return Array.from(pvHierarchy.get(supplier)?.entries() ?? [])
      .map(([vendor, data]) => ({
        vendor,
        vendorName: VENDOR_PRODUKSI[vendor]?.name ?? vendor,
        openCount: data.openPOs.length,
        historyCount: data.invoices.length,
        historyTotal: data.invoices.reduce((sum, i) => sum + i.totalBiaya, 0),
      }))
      .sort((a, b) => a.vendorName.localeCompare(b.vendorName, "id-ID"));
  }

  const scopedOpenPOs = expandedPvSupplier && expandedPvVendor ? pvHierarchy.get(expandedPvSupplier)?.get(expandedPvVendor)?.openPOs ?? [] : [];
  const scopedInvoices = expandedPvSupplier && expandedPvVendor ? pvHierarchy.get(expandedPvSupplier)?.get(expandedPvVendor)?.invoices ?? [] : [];
  // Kolom "Supplier -> Vendor" jadi berlebihan begitu sudah dipilih lewat baris yang diklik di atas.
  const pvHistoryColumnsScoped = pvHistoryColumns.filter((c) => c.key !== "supplierVendor");

  const PV_TREE_COLS = "22px minmax(240px, 1fr) 90px 150px 130px 160px";

  const filteredOpenPOs = scopedOpenPOs.filter((po) => (!poFilter || po.id === poFilter) && (!mrpFilter || po.mrpId === mrpFilter));
  const selectedPo = scopedOpenPOs.find((p) => p.id === selectedPoId) ?? null;
  const afterSubmitPo = afterSubmitPoId ? materialPOs.find((p) => p.id === afterSubmitPoId) : null;
  const closingPo = closingPoId ? materialPOs.find((p) => p.id === closingPoId) : null;
  const remainingAfter = afterSubmitPo ? afterSubmitPo.rollCount - afterSubmitPo.invoicedRolls : 0;

  return (
    <>
      <div className="overflow-hidden rounded-lg border border-border-subtle bg-surface-card">
        <div className="border-b border-border-subtle px-4 py-3">
          <div className="font-sans text-[13px] font-semibold text-text-primary">Invoice Material</div>
          <div className="font-sans text-[11.5px] text-text-muted">
            {pvSupplierSummaries.length > 0 ? `${pvSupplierSummaries.length} supplier` : "Belum ada PO material atau PV."}
          </div>
        </div>
        {pvSupplierSummaries.length === 0 && (
          <div className="px-5 py-8 text-center font-sans text-xs text-text-muted">Belum ada PO material atau PV.</div>
        )}
        {pvSupplierSummaries.length > 0 && (
        <div className="overflow-x-auto">
        <div className="min-w-[820px]">
          <div
            className="grid gap-x-2 border-b border-border-subtle bg-[#F7F9FB] px-4 py-[9px] font-sans text-[10.5px] font-medium uppercase tracking-wider text-text-muted"
            style={{ gridTemplateColumns: PV_TREE_COLS }}
          >
            <span />
            <span>Supplier / Vendor Produksi</span>
            <span className="text-right">Vendor</span>
            <span>Belum Invoice</span>
            <span>Riwayat PV</span>
            <span className="text-right">Total Nilai</span>
          </div>
          {pvSupplierSummaries.map((s) => {
            const supplierActive = expandedPvSupplier === s.supplier;
            return (
              <div key={s.supplier}>
                <button
                  type="button"
                  onClick={() => {
                    const next = supplierActive ? null : s.supplier;
                    setExpandedPvSupplier(next);
                    setExpandedPvVendor(null);
                  }}
                  className={
                    "grid w-full items-center gap-x-2 border-b border-[#F1F4F7] px-4 py-[11px] text-left font-sans text-xs hover:bg-[#F7F9FB] " +
                    (supplierActive ? "bg-info-bg" : "")
                  }
                  style={{ gridTemplateColumns: PV_TREE_COLS }}
                >
                  <span className="text-text-muted">{supplierActive ? "▾" : "▸"}</span>
                  <span className="font-semibold text-text-primary">{s.supplier}</span>
                  <span className="text-right font-mono tabular-nums text-text-muted">{s.vendorCount}</span>
                  <span>{s.openCount > 0 ? <StatusPill tone="warning">{s.openCount} belum invoice</StatusPill> : <span className="text-text-muted">—</span>}</span>
                  <span>
                    <StatusPill tone="neutral">{s.historyCount} PV</StatusPill>
                  </span>
                  <span className="text-right font-mono tabular-nums font-medium">{formatRupiah(s.historyTotal)}</span>
                </button>
                {supplierActive &&
                  vendorSummariesForSupplier(s.supplier).map((v) => {
                    const vendorActive = expandedPvSupplier === s.supplier && expandedPvVendor === v.vendor;
                    return (
                      <div key={v.vendor}>
                        <button
                          type="button"
                          onClick={() => setExpandedPvVendor(vendorActive ? null : v.vendor)}
                          className={
                            "grid w-full items-center gap-x-2 border-b border-[#F1F4F7] bg-[#FBFCFD] py-[10px] pl-8 pr-4 text-left font-sans text-[11.5px] hover:bg-[#F2F5F8] " +
                            (vendorActive ? "bg-info-bg" : "")
                          }
                          style={{ gridTemplateColumns: PV_TREE_COLS }}
                        >
                          <span className="text-text-muted">{vendorActive ? "▾" : "▸"}</span>
                          <span className="font-medium text-text-primary">{v.vendorName}</span>
                          <span />
                          <span>{v.openCount > 0 ? <StatusPill tone="warning">{v.openCount} belum invoice</StatusPill> : <span className="text-text-muted">—</span>}</span>
                          <span>
                            <StatusPill tone="neutral">{v.historyCount} PV</StatusPill>
                          </span>
                          <span className="text-right font-mono tabular-nums font-medium">{formatRupiah(v.historyTotal)}</span>
                        </button>
                        {vendorActive && (
                          <div className="border-b border-[#F1F4F7] bg-white px-4 py-4 pl-8">
                            <div className="overflow-hidden rounded-lg border border-border-subtle bg-surface-card">
                              <div className="border-b border-border-subtle px-5 py-3 font-sans text-[13px] font-semibold text-text-primary">
                                PO material belum memiliki invoice ({filteredOpenPOs.length})
                              </div>
                              <FilterBar
                                filters={[
                                  {
                                    label: "No. PO",
                                    value: poFilter,
                                    options: Array.from(new Set(scopedOpenPOs.map((po) => po.id))),
                                    onChange: setPoFilter,
                                  },
                                  {
                                    label: "No. MRP",
                                    value: mrpFilter,
                                    options: Array.from(new Set(scopedOpenPOs.map((po) => po.mrpId))),
                                    onChange: setMrpFilter,
                                  },
                                ]}
                              />
                              <div
                                className="grid border-b border-border-subtle bg-[#F7F9FB] px-5 py-[9px] font-sans text-[10.5px] font-medium uppercase tracking-wider text-text-muted"
                                style={{ gridTemplateColumns: "100px 110px 1fr 90px 90px 130px 70px" }}
                              >
                                <span>No. MRP</span>
                                <span>No. PO</span>
                                <span>Warna</span>
                                <span className="text-right">Roll sisa</span>
                                <span className="text-right">Roll total</span>
                                <span />
                                <span />
                              </div>
                              {filteredOpenPOs.length === 0 && (
                                <div className="px-5 py-6 text-center font-sans text-xs text-text-muted">Tidak ada PO material yang perlu diinvoice.</div>
                              )}
                              {filteredOpenPOs.map((po) => {
                                const remaining = po.rollCount - po.invoicedRolls;
                                return (
                                  <div
                                    key={po.id}
                                    className="grid items-center border-b border-[#F1F4F7] px-5 py-[11px] font-sans text-xs text-[#31414F] last:border-b-0"
                                    style={{ gridTemplateColumns: "100px 110px 1fr 90px 90px 130px 70px" }}
                                  >
                                    <span className="font-mono">{po.mrpId}</span>
                                    <span className="font-mono font-medium">{po.id}</span>
                                    <span>{po.colorBreakdown.map((c) => c.warna).join(", ")}</span>
                                    <span className="text-right font-mono">{remaining}</span>
                                    <span className="text-right font-mono">{po.rollCount}</span>
                                    <Button
                                      onClick={() => {
                                        setSelectedPoId(po.id);
                                        setAfterSubmitPoId(null);
                                      }}
                                      variant="primary"
                                      size="xs"
                                      className="ml-auto"
                                    >
                                      Buat PV
                                    </Button>
                                    <Button onClick={() => setClosingPoId(po.id)} variant="danger" size="xs" className="ml-auto">
                                      Close
                                    </Button>
                                  </div>
                                );
                              })}

                              {selectedPo && (
                                <PayingVoucherWizard
                                  // key=po.id -- WAJIB supaya React benar-benar me-remount wizard tiap kali PO
                                  // yang dipilih berganti (bukan cuma re-render instance yang sama dengan prop
                                  // baru). Tanpa ini, semua useState di dalam wizard (activeKey/warna terpilih,
                                  // entries, dst.) yang di-inisialisasi dari `po` HANYA jalan sekali saat mount
                                  // pertama -- begitu user pindah dari PO A ke PO B lewat "Buat PV", activeKey
                                  // nyangkut di warna PO A yang tidak ada di PO B, jadi form pilih warna/harga per
                                  // roll tidak muncul sama sekali (harus mulai dari PO paling atas dulu baru
                                  // "kepancing" state segar).
                                  key={selectedPo.id}
                                  po={selectedPo}
                                  mrpDetails={mrpDetails}
                                  onCancel={() => setSelectedPoId(null)}
                                  onSubmit={async (input) => {
                                    // WAJIB di-await -- lihat catatan panjang di paying-voucher-wizard.tsx. Kalau
                                    // bookInvoice gagal (throw), biarkan error itu naik ke try/catch wizard (JANGAN
                                    // ditangkap di sini) supaya wizard TIDAK ikut-ikutan pindah ke state "sukses"
                                    // kalau sebenarnya gagal.
                                    await bookInvoice(selectedPo.id, input);
                                    setAfterSubmitPoId(selectedPo.id);
                                    setSelectedPoId(null);
                                  }}
                                />
                              )}

                              {afterSubmitPo && remainingAfter > 0 && (
                                <div className="border-t border-[#F0DFC2] bg-warning-bg px-5 py-4">
                                  <div className="font-sans text-xs font-semibold text-warning-fg">Sisa {remainingAfter} roll belum tercover invoice ini.</div>
                                  <div className="mt-2 flex gap-2">
                                    <button
                                      onClick={() => {
                                        setSelectedPoId(afterSubmitPo.id);
                                        setAfterSubmitPoId(null);
                                      }}
                                      className="rounded-md bg-action-primary px-3.5 py-[7px] font-sans text-xs font-semibold text-white"
                                    >
                                      Buat invoice sisa
                                    </button>
                                    <button
                                      onClick={() => setAfterSubmitPoId(null)}
                                      className="rounded-md border border-[#CBD5DF] px-3.5 py-[7px] font-sans text-xs font-semibold text-action-primary"
                                    >
                                      Nanti saja
                                    </button>
                                  </div>
                                </div>
                              )}
                            </div>

                            {/* Arsip/histori — dulu begitu PV diajukan, invoice-nya "hilang" dari layar (cuma
                               nongol lagi kalau masih ada sisa roll belum tercover), jadi tidak ada bukti/arsip
                               PV yang sudah pernah dibuat. Sekarang SEMUA invoice yang pernah dibuat tetap
                               tercatat & terlihat di sini, apa pun status lanjutannya -- dibatasi ke
                               supplier+vendor yang dipilih lewat baris yang diklik di atas (lihat pvHierarchy). */}
                            <div className="mt-3">
                              <DataTable
                                title="Riwayat Paying Voucher"
                                subtitle={`${scopedInvoices.length} PV tercatat — arsip PV ${s.supplier} → ${v.vendorName}`}
                                columns={pvHistoryColumnsScoped}
                                rows={scopedInvoices}
                                keyOf={(i) => i.id}
                                firstColumnLabel="No. MRP"
                                firstColumnRender={(i) => <span className="font-mono">{i.mrpId}</span>}
                                filterDefs={[
                                  { label: "No MRP", options: Array.from(new Set(scopedInvoices.map((i) => i.mrpId))), test: (i, v2) => i.mrpId === v2 },
                                  { label: "No PO", options: Array.from(new Set(scopedInvoices.map((i) => i.poId))), test: (i, v2) => i.poId === v2 },
                                  {
                                    label: "Status",
                                    options: Array.from(new Set(scopedInvoices.map((i) => invoiceBadge(i.status).label))),
                                    test: (i, v2) => invoiceBadge(i.status).label === v2,
                                  },
                                ]}
                                emptyText="Belum ada PV yang pernah diajukan untuk kombinasi ini."
                              />
                            </div>

                            <div className="mt-3 rounded-lg border border-border-subtle bg-surface-card px-5 py-4 text-center font-sans text-xs text-text-muted">
                              Status lengkap tiap PO material (invoice, delivery, receiving, dst) dipindahkan ke halaman{" "}
                              <a href="/procurement/material-tracking" className="font-semibold text-action-primary">
                                Material Tracking
                              </a>
                              .
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
        </div>
        )}
      </div>

      {closingPo && (
        <ClosePoReasonModal
          po={closingPo}
          supplierOptionsForWarna={(warna) => materialSupplierNamesForWarna(hargaKain, warna)}
          onNo={() => setClosingPoId(null)}
          onYes={(reason, warna, lengan, closeQty, newSupplier) => {
            if (newSupplier) {
              reassignMaterialToSupplier(closingPo.id, warna, lengan, closeQty, newSupplier, reason);
            } else {
              closePoWithReason(closingPo.id, reason, warna, lengan, closeQty);
            }
            setClosingPoId(null);
            setAfterSubmitPoId(null);
          }}
        />
      )}
    </>
  );
}
