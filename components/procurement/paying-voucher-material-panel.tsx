"use client";

import { useState } from "react";
import { DataTable, aggSame, aggSum, type ColumnDef, type FilterDef } from "@/components/mrp/data-table";
import { SidePanel } from "@/components/ui/side-panel";
import { KpiCard } from "@/components/ui/kpi-card";
import { ClosePoReasonModal } from "@/components/mrp/close-po-reason-modal";
import { PayingVoucherWizard } from "@/components/mrp/paying-voucher-wizard";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";
import { formatDateTime, formatRupiah, invoiceAwaitingPayment, materialSupplierNamesForWarna, poDisplayNo } from "@/lib/mrp/derive";
import { pvStatusMaterial, pvTone } from "@/lib/mrp/flowStatus";
import { useMrpStore } from "@/lib/mrp/store";
import { VENDOR_PRODUKSI } from "@/lib/mrp/seed";
import type { MaterialPO, RawMaterialInvoice } from "@/lib/mrp/types";
// Item 2.8: getInvoicePaymentProofAction dipanggil langsung (bukan lewat store), sama pola dengan
// "Lampiran Invoice" di atas -- Procurement cuma BACA bukti ini untuk diserahkan ke vendor
// material, tidak ada kontrol upload di sisi Procurement.
import { viewAttachments } from "@/lib/mrp/attachments";
// Revisi 2026-09-06: preview+download konsisten di semua modul -- lihat komentar di file ini.
// Revisi 2026-09-08 (bug fix popup blocked): openPreviewWindow/fillPreviewWindow -- lihat
// catatan panjang di lib/mrp/clientFiles.ts.
import { viewInvoiceBuktiPv } from "@/lib/mrp/viewInvoicePv";
import { SysadminActionsBar } from "@/components/sysadmin/correction-dialog";
import { materialInvoiceVoidCorrections } from "@/components/sysadmin/procurement-corrections";

function viewPaymentProof(invoiceId: string) {
  return viewAttachments("INVOICE_PAYMENT_PROOF", invoiceId, "Bukti pembayaran belum dilampirkan.");
}

/** Panel "Invoice Material" — konten diekstrak dari halaman lama Paying Voucher (Invoice)
 *  (yang sekarang jadi satu sub-tab, berdampingan dengan panel monitoring Invoice Maklon).
 *
 *  Revisi 2026-09-17 (owner: "dibuat tampilannya seperti yang ada di Purchase Order" + "pisahkan
 *  antara PV yang sudah dibuat dan yang belum dibuat, saat ini kayaknya masih gabung"): tabel
 *  pohon (No MRP -> Supplier -> Vendor Produksi/PO) yang dulu digabung 1 kontainer per
 *  supplier->vendor (item revisi 2026-09-17 sebelumnya) sekarang dipecah 2 SUB-TAB terpisah, PERSIS
 *  pola PO Material/PO Produksi di app/procurement/po-approval/page.tsx: "Belum Invoice" (PO
 *  material yang masih perlu di-PV-kan, leaf row = 1 PO, aksi Buat PV/Close) dan "Riwayat PV"
 *  (PV yang sudah pernah diajukan, leaf row = 1 invoice, expand = rincian warna/lengan + lampiran).
 *  Keduanya dikelompokkan No MRP -> Supplier -> baris leaf, kolom Jumlah/Nilai/Status/Aksi -- sama
 *  gaya visual (border, StatusPill, chevron ▸/▾) dengan tabel PO Material supaya kedua halaman
 *  terasa satu keluarga desain. */
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
  // Upload banyak invoice (2026-10-18): antrean PDF untuk SATU PO. Invoice diproses satu per satu -- begitu PV tersimpan,
  // wizard dibuka lagi untuk PO yang sama dengan file berikutnya (sisa roll PO sudah diperbarui). `current` = file yang
  // sedang dikerjakan; `seq` memaksa wizard di-remount (key) supaya state-nya segar tiap invoice.
  const [queue, setQueue] = useState<{ poId: string; files: File[]; total: number; done: number; current: File | null; seq: number } | null>(null);
  // Antrean dibuang saat wizard dibatalkan atau "Buat PV" dibuka lagi (lihat onCancel & tombol Buat PV).
  function advanceQueue(poId: string): boolean {
    if (!queue || queue.poId !== poId || queue.files.length === 0) return false;
    const [next, ...rest] = queue.files;
    setQueue({ ...queue, files: rest, done: queue.done + 1, current: next, seq: queue.seq + 1 });
    return true;
  }

  // Pola PPIC (owner 2026-11-16): dua pohon tabel lama (No MRP -> Supplier -> PO / PV) diganti tabel bersama dengan kelompok
  // bawaan No. MRP > Supplier, rincian di panel samping, kartu mengikuti filter. Wizard Buat PV dibuka di panel samping.
  const [shownOpenIds, setShownOpenIds] = useState<Set<string> | null>(null);
  const [shownInvIds, setShownInvIds] = useState<Set<string> | null>(null);

  const openPOs = materialPOs.filter((po) => po.status !== "CANCELLED" && (po.approved || po.earlyRelease) && po.invoicedRolls < po.rollCount);
  const vendorName = (id: string) => VENDOR_PRODUKSI[id]?.name ?? id;
  const supplierOf = (s: string) => s || "Belum ada supplier";
  const uniqSorted = (xs: string[]) => Array.from(new Set(xs.filter(Boolean))).sort((a, b) => a.localeCompare(b, "id-ID", { numeric: true }));
  const sortedInvoices = [...invoices].sort((a, b) => b.mrpId.localeCompare(a.mrpId, "id-ID", { numeric: true }));

  function invoiceColorBreakdown(inv: RawMaterialInvoice) {
    return (
      <div className="overflow-hidden rounded-md border border-[#E4E8EE] bg-white">
        <div className="grid grid-cols-4 gap-x-2 bg-[#F2F4F7] px-3 py-1.5 font-sans text-[10px] font-medium uppercase tracking-wider text-text-muted">
          <span>Warna / Lengan</span>
          <span className="text-right">Roll</span>
          <span className="text-right">Harga/Kg</span>
          <span className="text-right">Subtotal</span>
        </div>
        {inv.colorEntries.map((c, i) => {
          const totalKg = c.rolls.reduce((s, w) => s + w, 0);
          return (
            <div key={i} className="grid grid-cols-4 gap-x-2 border-t border-[#F1F4F7] px-3 py-1.5 font-sans text-[11.5px] text-[#31414F]">
              <span className="font-medium">
                {c.warna} · {c.lengan}
              </span>
              <span className="text-right font-mono">{c.rolls.length}</span>
              <span className="text-right font-mono">{formatRupiah(c.hargaPerRoll)}</span>
              <span className="text-right font-mono">{formatRupiah(c.hargaPerRoll * totalKg)}</span>
            </div>
          );
        })}
        <div className="grid grid-cols-4 gap-x-2 border-t-2 border-accent-blue bg-info-bg px-3 py-1.5 font-sans text-[11.5px] font-semibold text-info-fg">
          <span className="col-span-3">Total PV</span>
          <span className="text-right font-mono">{formatRupiah(inv.totalBiaya)}</span>
        </div>
      </div>
    );
  }

  /** Rincian warna PO yang belum di-PV-kan: total roll, yang sudah di-PV-kan, sisa, dan entitasnya (owner 2026-10-18). */
  function poColorBreakdown(p: MaterialPO) {
    const remaining = p.rollCount - p.invoicedRolls;
    return (
      <div className="overflow-hidden rounded-md border border-[#E4E8EE] bg-white">
        <table className="w-full border-collapse font-sans text-[11.5px] text-[#31414F]">
          <thead>
            <tr className="bg-[#F2F4F7] text-[10px] font-medium uppercase tracking-wider text-text-muted">
              <th className="px-3 py-1.5 text-left">Warna · lengan</th>
              <th className="px-3 py-1.5 text-right">Roll total</th>
              <th className="px-3 py-1.5 text-right">Sudah di-PV</th>
              <th className="px-3 py-1.5 text-right">Sisa</th>
              <th className="px-3 py-1.5 text-left">Entitas</th>
            </tr>
          </thead>
          <tbody>
            {p.colorBreakdown.map((c) => {
              const done = p.invoicedByColor[`${c.warna}|${c.lengan}`] ?? 0;
              const sisa = Math.max(0, c.rollCount - done);
              return (
                <tr key={c.warna + c.lengan} className="border-t border-[#F1F4F7]">
                  <td className="px-3 py-1.5 font-medium text-text-primary">
                    {c.warna} · {c.lengan}
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono tabular-nums">{c.rollCount}</td>
                  <td className="px-3 py-1.5 text-right font-mono tabular-nums text-text-muted">{done}</td>
                  <td className={"px-3 py-1.5 text-right font-mono tabular-nums " + (sisa === 0 ? "text-success-fg" : "font-semibold text-text-primary")}>{sisa}</td>
                  <td className="px-3 py-1.5 text-text-muted">{c.entitas ?? "—"}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-accent-blue bg-info-bg font-semibold text-info-fg">
              <td className="px-3 py-1.5">{p.colorBreakdown.length} baris warna</td>
              <td className="px-3 py-1.5 text-right font-mono tabular-nums">{p.rollCount}</td>
              <td className="px-3 py-1.5 text-right font-mono tabular-nums">{p.invoicedRolls}</td>
              <td className="px-3 py-1.5 text-right font-mono tabular-nums">{remaining}</td>
              <td className="px-3 py-1.5" />
            </tr>
          </tfoot>
        </table>
      </div>
    );
  }

  const selectedPo = openPOs.find((p) => p.id === selectedPoId) ?? null;
  const afterSubmitPo = afterSubmitPoId ? materialPOs.find((p) => p.id === afterSubmitPoId) : null;
  const closingPo = closingPoId ? materialPOs.find((p) => p.id === closingPoId) : null;
  const remainingAfter = afterSubmitPo ? afterSubmitPo.rollCount - afterSubmitPo.invoicedRolls : 0;

  const shownOpen = shownOpenIds ? openPOs.filter((p) => shownOpenIds.has(p.id)) : openPOs;
  const shownInv = shownInvIds ? sortedInvoices.filter((i) => shownInvIds.has(i.id)) : sortedInvoices;
  const fmtRoll = (n: number) => n.toLocaleString("id-ID", { maximumFractionDigits: 2 });
  const bold = (x: React.ReactNode) => <span className="font-semibold">{x}</span>;

  const openFilters: FilterDef<MaterialPO>[] = [
    { label: "No. MRP", options: uniqSorted(openPOs.map((p) => p.mrpId)).reverse(), test: (p, v) => p.mrpId === v },
    { label: "Supplier", options: uniqSorted(openPOs.map((p) => supplierOf(p.supplier))), test: (p, v) => supplierOf(p.supplier) === v },
    { label: "Vendor", options: uniqSorted(openPOs.map((p) => vendorName(p.vendorProduksi))), test: (p, v) => vendorName(p.vendorProduksi) === v },
  ];
  const openColumns: ColumnDef<MaterialPO>[] = [
    { key: "mrp", label: "No. MRP", default: true, aggregate: aggSame((p) => p.mrpId), render: (p) => <span className="font-mono">{p.mrpId}</span> },
    { key: "supplier", label: "Supplier", default: true, aggregate: aggSame((p) => supplierOf(p.supplier)), render: (p) => supplierOf(p.supplier) },
    { key: "vendor", label: "Vendor", default: true, aggregate: aggSame((p) => vendorName(p.vendorProduksi)), render: (p) => vendorName(p.vendorProduksi) },
    { key: "sisa", label: "Roll sisa", default: true, align: "right", aggregate: aggSum((p) => p.rollCount - p.invoicedRolls, (n) => bold(fmtRoll(n))), render: (p) => <span className="font-mono">{fmtRoll(p.rollCount - p.invoicedRolls)}</span> },
    { key: "roll", label: "Roll total", default: true, align: "right", aggregate: aggSum((p) => p.rollCount, (n) => bold(fmtRoll(n))), render: (p) => <span className="font-mono text-text-muted">{fmtRoll(p.rollCount)}</span> },
    { key: "nilai", label: "Nilai", default: true, align: "right", aggregate: aggSum((p) => p.amount, (n) => bold(formatRupiah(n))), render: (p) => <span className="font-mono">{formatRupiah(p.amount)}</span> },
    {
      key: "aksi",
      label: "Aksi",
      default: true,
      render: (p) => (
        <span className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
          <Button
            onClick={() => {
              setQueue(null);
              setSelectedPoId(p.id);
              setAfterSubmitPoId(null);
            }}
            variant="primary"
            size="xs"
          >
            Buat PV
          </Button>
          <Button onClick={() => setClosingPoId(p.id)} variant="danger" size="xs">
            Close
          </Button>
        </span>
      ),
    },
  ];

  // Status Paying Voucher standar (lib/mrp/flowStatus.ts): Not Paid, Paid, Delivery Material, Receiving Material.
  const invStatus = (inv: RawMaterialInvoice) => ({ label: pvStatusMaterial(inv), tone: pvTone(pvStatusMaterial(inv)) });
  const invFilters: FilterDef<RawMaterialInvoice>[] = [
    { label: "No. MRP", options: uniqSorted(invoices.map((i) => i.mrpId)).reverse(), test: (i, v) => i.mrpId === v },
    { label: "Supplier", options: uniqSorted(invoices.map((i) => supplierOf(i.supplier))), test: (i, v) => supplierOf(i.supplier) === v },
    { label: "Vendor", options: uniqSorted(invoices.map((i) => vendorName(i.destinationVendor))), test: (i, v) => vendorName(i.destinationVendor) === v },
    { label: "Status", options: uniqSorted(invoices.map((i) => invStatus(i).label)), test: (i, v) => invStatus(i).label === v },
    { label: "Bukti bayar", options: ["Ada", "Belum"], test: (i, v) => (i.buktiBayarAt ? "Ada" : "Belum") === v },
  ];
  const invColumns: ColumnDef<RawMaterialInvoice>[] = [
    { key: "sysadmin", label: "Aksi Sysadmin", default: true, sysadmin: true, render: (inv) => <SysadminActionsBar compact actions={materialInvoiceVoidCorrections(inv)} /> },
    { key: "mrp", label: "No. MRP", default: true, aggregate: aggSame((i) => i.mrpId), render: (i) => <span className="font-mono">{i.mrpId}</span> },
    { key: "supplier", label: "Supplier", default: true, aggregate: aggSame((i) => supplierOf(i.supplier)), render: (i) => supplierOf(i.supplier) },
    { key: "vendor", label: "Vendor", default: true, aggregate: aggSame((i) => vendorName(i.destinationVendor)), render: (i) => vendorName(i.destinationVendor) },
    { key: "nilai", label: "Nilai", default: true, align: "right", aggregate: aggSum((i) => i.totalBiaya, (n) => bold(formatRupiah(n))), render: (i) => <span className="font-mono">{formatRupiah(i.totalBiaya)}</span> },
    {
      key: "status",
      label: "Status",
      default: true,
      aggregate: aggSame((i) => invStatus(i).label, (v) => <StatusPill tone={invoices.map(invStatus).find((b) => b.label === v)?.tone ?? "neutral"}>{v}</StatusPill>),
      render: (inv) => (
        <span className="flex flex-col items-start gap-1">
          <StatusPill tone={invStatus(inv).tone}>{invStatus(inv).label}</StatusPill>
          {inv.status !== "INVOICED" && invoiceAwaitingPayment(inv) && (
            <span title="Material sudah diterima vendor lebih awal (dispensasi Sysadmin), tagihan belum dibayar Finance">
              <StatusPill tone="warning">Terima awal</StatusPill>
            </span>
          )}
        </span>
      ),
    },
    {
      key: "lampiran",
      label: "Lampiran Invoice",
      default: true,
      render: (inv) =>
        inv.buktiPvAvailable ? (
          <button
            onClick={(e) => {
              e.stopPropagation();
              void viewInvoiceBuktiPv(inv.id);
            }}
            className="font-sans text-[11px] font-semibold text-action-primary underline"
          >
            Lihat / Download
          </button>
        ) : (
          <span className="font-sans text-[11px] text-text-muted">—</span>
        ),
    },
    {
      key: "bukti",
      label: "Bukti Bayar",
      default: true,
      render: (inv) =>
        inv.buktiBayarAt ? (
          <button
            onClick={(e) => {
              e.stopPropagation();
              viewPaymentProof(inv.id);
            }}
            className="font-sans text-[11px] font-semibold text-action-primary underline"
          >
            Lihat / Download
          </button>
        ) : (
          <span className="font-sans text-[11px] text-text-muted">—</span>
        ),
    },
    { key: "tglBukti", label: "Tgl Upload Bukti", default: true, render: (inv) => <span className="font-sans text-[11px]">{inv.buktiBayarAt ? formatDateTime(inv.buktiBayarAt) : "—"}</span> },
  ];

  return (
    <>
      <div className="grid grid-cols-4 gap-3 max-lg:grid-cols-2">
        <KpiCard label="PO belum invoice" value={shownOpen.length} sub="PO Material yang tampil" accent="orange" />
        <KpiCard label="Roll belum di-PV" value={fmtRoll(shownOpen.reduce((s, p) => s + p.rollCount - p.invoicedRolls, 0))} sub="roll" accent="purple" />
        <KpiCard label="PV tercatat" value={shownInv.length} sub="riwayat yang tampil" accent="blue" />
        <KpiCard label="Nilai PV" value={formatRupiah(shownInv.reduce((s, i) => s + i.totalBiaya, 0))} valueClassName="text-[20px]" sub="riwayat yang tampil" accent="teal" />
      </div>

      <DataTable<MaterialPO>
        title="PO Material belum invoice"
        columns={openColumns}
        rows={openPOs}
        keyOf={(p) => p.id}
        firstColumnLabel="No PO"
        firstColumnRender={(p) => <span className="font-mono font-medium" title={p.id}>{poDisplayNo(p.id, p.entity)}</span>}
        filterDefs={openFilters}
        defaultGroupBy={["No. MRP", "Supplier"]}
        search={{ placeholder: "Cari no PO, MRP, supplier, vendor…", getText: (p) => `${p.id} ${p.mrpId} ${p.supplier} ${vendorName(p.vendorProduksi)}` }}
        renderExpanded={(p) => poColorBreakdown(p)}
        onFilteredRows={(list) => setShownOpenIds(new Set(list.map((p) => p.id)))}
        emptyText="Tidak ada PO material yang perlu diinvoice."
        nowrap
      />

      {afterSubmitPo && remainingAfter > 0 && (
        <div className="rounded-lg border border-[#F0DFC2] bg-warning-bg px-5 py-4">
          <div className="font-sans text-xs font-semibold text-warning-fg">
            {afterSubmitPo.id}: sisa {remainingAfter} roll belum tercover invoice ini.
          </div>
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
            <button onClick={() => setAfterSubmitPoId(null)} className="rounded-md border border-[#CBD5DF] px-3.5 py-[7px] font-sans text-xs font-semibold text-action-primary">
              Nanti saja
            </button>
          </div>
        </div>
      )}

      <DataTable<RawMaterialInvoice>
        title="Riwayat Paying Voucher"
        columns={invColumns}
        rows={sortedInvoices}
        keyOf={(i) => i.id}
        firstColumnLabel="No Invoice"
        firstColumnRender={(i) => <span className="font-mono font-medium">{i.noInvoiceVendor || i.id}</span>}
        filterDefs={invFilters}
        defaultGroupBy={["No. MRP", "Supplier"]}
        search={{ placeholder: "Cari no invoice, MRP, supplier, vendor…", getText: (i) => `${i.noInvoiceVendor} ${i.id} ${i.mrpId} ${i.supplier} ${vendorName(i.destinationVendor)} ${invStatus(i).label}` }}
        renderExpanded={(inv) => invoiceColorBreakdown(inv)}
        onFilteredRows={(list) => setShownInvIds(new Set(list.map((i) => i.id)))}
        emptyText="Belum ada PV yang pernah diajukan."
        nowrap
      />

      <div className="rounded-lg border border-border-subtle bg-surface-card px-5 py-4 text-center font-sans text-xs text-text-muted">
        Status lengkap tiap PO material (invoice, delivery, receiving, dst) ada di halaman{" "}
        <a href="/procurement/material-tracking" className="font-semibold text-action-primary">
          Material Tracking
        </a>
        .
      </div>

      {/* Wizard Buat PV di panel samping (pola PPIC: form besar di panel). Isi wizard dan alurnya tidak berubah. */}
      <SidePanel
        open={!!selectedPo}
        onClose={() => {
          setQueue(null);
          setSelectedPoId(null);
        }}
        title={selectedPo ? `Buat PV · ${selectedPo.id}` : ""}
        subtitle={selectedPo ? `${selectedPo.mrpId} · ${supplierOf(selectedPo.supplier)} · ${vendorName(selectedPo.vendorProduksi)}` : undefined}
        width={1180}
      >
        {selectedPo && (
          <PayingVoucherWizard
            // key=po.id -- WAJIB supaya wizard di-remount tiap kali PO yang dipilih berganti (state di dalam wizard
            // diinisialisasi dari `po` hanya saat mount).
            key={`${selectedPo.id}:${queue?.poId === selectedPo.id ? queue.seq : 0}`}
            po={selectedPo}
            mrpDetails={mrpDetails}
            onCancel={() => {
              setQueue(null);
              setSelectedPoId(null);
            }}
            autoFile={queue?.poId === selectedPo.id ? queue.current : null}
            onQueue={(rest) => setQueue({ poId: selectedPo.id, files: rest, total: rest.length + 1, done: 0, current: null, seq: 0 })}
            queueInfo={queue?.poId === selectedPo.id ? { position: queue.done + 1, total: queue.total, remaining: queue.files.length } : null}
            onSkipQueued={() => {
              advanceQueue(selectedPo.id);
            }}
            onCancelQueue={() => setQueue(null)}
            onBookDirect={(input) => bookInvoice(selectedPo.id, input)}
            onBatchDone={(leftover) => {
              // Ringkasan banyak invoice selesai: sisa yang belum tersimpan dikerjakan satu per satu; kalau tidak ada, tutup wizard.
              if (leftover.length > 0) {
                const [first, ...rest] = leftover;
                setQueue({ poId: selectedPo.id, files: rest, total: leftover.length, done: 0, current: first, seq: 1 });
              } else {
                setAfterSubmitPoId(selectedPo.id);
                setSelectedPoId(null);
              }
            }}
            onSubmit={async (input) => {
              // WAJIB di-await (lihat paying-voucher-wizard.tsx): kalau bookInvoice gagal, error naik ke wizard.
              await bookInvoice(selectedPo.id, input);
              // Masih ada invoice di antrean untuk PO ini -> buka wizard lagi dengan file berikutnya (tanpa menutup).
              if (advanceQueue(selectedPo.id)) return;
              setAfterSubmitPoId(selectedPo.id);
              setSelectedPoId(null);
            }}
          />
        )}
      </SidePanel>

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
