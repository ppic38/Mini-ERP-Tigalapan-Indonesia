"use client";

import { Fragment, useState } from "react";
import { ClosePoReasonModal } from "@/components/mrp/close-po-reason-modal";
import { PayingVoucherWizard } from "@/components/mrp/paying-voucher-wizard";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";
import { formatRupiah, invoiceBadge, materialSupplierNamesForWarna } from "@/lib/mrp/derive";
import { useMrpStore } from "@/lib/mrp/store";
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

  // Pohon "Belum Invoice": No MRP -> Supplier -> leaf = 1 PO material (sama pola grouping dengan
  // materialMrpSummaries/supplierSummariesForMrp di po-approval/page.tsx).
  const [expandedMrpBelum, setExpandedMrpBelum] = useState<string | null>(null);
  const [expandedSupplierBelum, setExpandedSupplierBelum] = useState<string | null>(null);
  const [expandedPoBelum, setExpandedPoBelum] = useState<string | null>(null);

  // Pohon "Riwayat PV": No MRP -> Supplier -> leaf = 1 invoice/PV.
  const [expandedMrpRiwayat, setExpandedMrpRiwayat] = useState<string | null>(null);
  const [expandedSupplierRiwayat, setExpandedSupplierRiwayat] = useState<string | null>(null);
  const [expandedInvoiceRiwayat, setExpandedInvoiceRiwayat] = useState<string | null>(null);

  const openPOs = materialPOs.filter((po) => po.status !== "CANCELLED" && po.approved && po.invoicedRolls < po.rollCount);

  const belumMrpSummaries = (() => {
    const map = new Map<string, MaterialPO[]>();
    for (const po of openPOs) {
      if (!map.has(po.mrpId)) map.set(po.mrpId, []);
      map.get(po.mrpId)!.push(po);
    }
    return Array.from(map.entries())
      .map(([mrpId, pos]) => ({
        mrpId,
        pos,
        supplierCount: new Set(pos.map((p) => p.supplier || "— Belum ada supplier —")).size,
        totalRollSisa: pos.reduce((sum, p) => sum + (p.rollCount - p.invoicedRolls), 0),
        totalRoll: pos.reduce((sum, p) => sum + p.rollCount, 0),
        totalNilai: pos.reduce((sum, p) => sum + p.amount, 0),
      }))
      .sort((a, b) => b.mrpId.localeCompare(a.mrpId, "id-ID"));
  })();

  function belumSupplierSummariesForMrp(pos: MaterialPO[]) {
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
        totalRollSisa: ps.reduce((sum, p) => sum + (p.rollCount - p.invoicedRolls), 0),
        totalRoll: ps.reduce((sum, p) => sum + p.rollCount, 0),
        totalNilai: ps.reduce((sum, p) => sum + p.amount, 0),
      }))
      .sort((a, b) => a.supplier.localeCompare(b.supplier, "id-ID"));
  }

  const riwayatMrpSummaries = (() => {
    const map = new Map<string, RawMaterialInvoice[]>();
    for (const inv of invoices) {
      if (!map.has(inv.mrpId)) map.set(inv.mrpId, []);
      map.get(inv.mrpId)!.push(inv);
    }
    return Array.from(map.entries())
      .map(([mrpId, invs]) => ({
        mrpId,
        invs,
        supplierCount: new Set(invs.map((i) => i.supplier || "— Belum ada supplier —")).size,
        totalNilai: invs.reduce((sum, i) => sum + i.totalBiaya, 0),
      }))
      .sort((a, b) => b.mrpId.localeCompare(a.mrpId, "id-ID"));
  })();

  function riwayatSupplierSummariesForMrp(invs: RawMaterialInvoice[]) {
    const map = new Map<string, RawMaterialInvoice[]>();
    for (const i of invs) {
      const key = i.supplier || "— Belum ada supplier —";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(i);
    }
    return Array.from(map.entries())
      .map(([supplier, is_]) => ({
        supplier,
        invs: is_,
        vendorCount: new Set(is_.map((i) => i.destinationVendor)).size,
        totalNilai: is_.reduce((sum, i) => sum + i.totalBiaya, 0),
      }))
      .sort((a, b) => a.supplier.localeCompare(b.supplier, "id-ID"));
  }

  // Rincian per warna/lengan 1 invoice (leaf tingkat 3, tab "Riwayat PV") -- rate di ColorEntry
  // adalah harga PER KG (lihat catatan sama di components/finance/payment-panel.tsx), subtotal =
  // hargaPerRoll * total kg semua roll warna itu.
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

  const selectedPo = openPOs.find((p) => p.id === selectedPoId) ?? null;
  const afterSubmitPo = afterSubmitPoId ? materialPOs.find((p) => p.id === afterSubmitPoId) : null;
  const closingPo = closingPoId ? materialPOs.find((p) => p.id === closingPoId) : null;
  const remainingAfter = afterSubmitPo ? afterSubmitPo.rollCount - afterSubmitPo.invoicedRolls : 0;

  return (
    <>
      {/* Item revisi 2026-09-17 (owner: "bukan tab -- buat tabel yang berbeda saja tapi masih satu
         halaman"): dulu sempat dicoba sebagai sub-tab "Belum Invoice"/"Riwayat PV" (perlu diklik
         buat pindah) -- owner menegaskan maunya 2 tabel terpisah TAMPIL SEKALIGUS di halaman yang
         sama, bukan disembunyikan di balik tab. Kedua tabel di bawah SELALU dirender bersamaan. */}
      <div className="overflow-hidden border border-border-subtle bg-surface-card">
          <div className="border-b border-border-subtle px-4 py-3 font-sans text-[13px] font-semibold text-text-primary">PO Material — belum invoice</div>
          {belumMrpSummaries.length === 0 && (
            <div className="px-5 py-8 text-center font-sans text-xs text-text-muted">Tidak ada PO material yang perlu diinvoice.</div>
          )}
          {belumMrpSummaries.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="border-b-2 border-accent-blue bg-info-bg font-sans text-[10.5px] font-medium uppercase tracking-wider text-info-fg">
                    <th className="px-5 py-[9px] text-left">No MRP / Supplier / Vendor Produksi</th>
                    <th className="px-3 py-[9px] text-right">Roll Sisa</th>
                    <th className="px-3 py-[9px] text-right">Roll Total</th>
                    <th className="px-3 py-[9px] text-right">Nilai</th>
                    <th className="px-3 py-[9px] text-left">Status</th>
                    <th className="px-3 py-[9px] text-left">Aksi</th>
                  </tr>
                </thead>
                <tbody>
                  {belumMrpSummaries.map((m) => {
                    const mrpActive = expandedMrpBelum === m.mrpId;
                    return (
                      <Fragment key={m.mrpId}>
                        <tr
                          onClick={() => {
                            const next = mrpActive ? null : m.mrpId;
                            setExpandedMrpBelum(next);
                            setExpandedSupplierBelum(null);
                            setExpandedPoBelum(null);
                            // Item revisi 2026-09-17 (bug report owner: "klik card MRP/supplier lain
                            // tapi container Buat PV masih stuck terbuka") -- wizard (selectedPoId)
                            // & banner "sisa roll" (afterSubmitPoId) SENGAJA tidak terikat ke baris
                            // pohon mana pun (dirender sekali di bawah tabel, lihat JSX di bawah),
                            // jadi navigasi pindah MRP/supplier/PO TIDAK PERNAH otomatis menutupnya
                            // kalau tidak di-reset manual di sini -- ditutup eksplisit di SETIAP titik
                            // navigasi (klik baris MRP/Supplier/PO mana pun), bukan cuma tombol Batal.
                            setSelectedPoId(null);
                            setAfterSubmitPoId(null);
                          }}
                          className={"cursor-pointer border-b border-[#F1F4F7] font-sans text-xs text-[#31414F] hover:bg-[#FAFBFC] " + (mrpActive ? "bg-info-bg" : "")}
                        >
                          <td className="px-5 py-[11px]">
                            <span className="mr-1.5 text-text-muted">{mrpActive ? "▾" : "▸"}</span>
                            <span className="font-mono font-semibold text-text-primary">{m.mrpId}</span>
                            <span className="ml-1.5 font-sans text-[10.5px] text-text-muted">{m.supplierCount} supplier</span>
                          </td>
                          <td className="px-3 py-[11px] text-right font-mono tabular-nums">{m.totalRollSisa}</td>
                          <td className="px-3 py-[11px] text-right font-mono tabular-nums text-text-muted">{m.totalRoll}</td>
                          <td className="px-3 py-[11px] text-right font-mono tabular-nums font-medium">{formatRupiah(m.totalNilai)}</td>
                          <td className="px-3 py-[11px]">
                            <StatusPill tone="warning">{m.pos.length} PO</StatusPill>
                          </td>
                          <td className="px-3 py-[11px]" />
                        </tr>
                        {mrpActive &&
                          belumSupplierSummariesForMrp(m.pos).map((s) => {
                            const supplierKey = `${m.mrpId}::${s.supplier}`;
                            const supplierActive = expandedSupplierBelum === supplierKey;
                            return (
                              <Fragment key={supplierKey}>
                                <tr
                                  onClick={() => {
                                    const next = supplierActive ? null : supplierKey;
                                    setExpandedSupplierBelum(next);
                                    setExpandedPoBelum(null);
                                    setSelectedPoId(null);
                                    setAfterSubmitPoId(null);
                                  }}
                                  className={"cursor-pointer border-b border-[#F1F4F7] bg-[#FBFCFD] font-sans text-[11.5px] text-[#31414F] hover:bg-[#F2F5F8] " + (supplierActive ? "bg-info-bg" : "")}
                                >
                                  <td className="py-[10px] pl-10 pr-3">
                                    <span className="mr-1.5 text-text-muted">{supplierActive ? "▾" : "▸"}</span>
                                    <span className="font-medium text-text-primary">{s.supplier}</span>
                                    <span className="ml-1.5 font-mono text-[10.5px] text-text-muted">{s.vendorCount} vendor</span>
                                  </td>
                                  <td className="px-3 py-[10px] text-right font-mono tabular-nums">{s.totalRollSisa}</td>
                                  <td className="px-3 py-[10px] text-right font-mono tabular-nums text-text-muted">{s.totalRoll}</td>
                                  <td className="px-3 py-[10px] text-right font-mono tabular-nums font-medium">{formatRupiah(s.totalNilai)}</td>
                                  <td className="px-3 py-[10px]">
                                    <StatusPill tone="warning">{s.pos.length} PO</StatusPill>
                                  </td>
                                  <td className="px-3 py-[10px]" />
                                </tr>
                                {supplierActive &&
                                  s.pos.map((p) => {
                                    const poActive = expandedPoBelum === p.id;
                                    const remaining = p.rollCount - p.invoicedRolls;
                                    return (
                                      <tr
                                        key={p.id}
                                        onClick={() => {
                                          setExpandedPoBelum(poActive ? null : p.id);
                                          // Kalau wizard sedang terbuka untuk PO LAIN, klik baris PO
                                          // ini (bukan tombol Buat PV, itu sudah stopPropagation)
                                          // menutupnya juga -- lihat catatan di baris MRP di atas.
                                          setSelectedPoId(null);
                                          setAfterSubmitPoId(null);
                                        }}
                                        className={"cursor-pointer border-b border-[#F1F4F7] font-sans text-[11.5px] text-[#31414F] hover:bg-[#FAFBFC] " + (poActive ? "bg-info-bg" : "")}
                                      >
                                        <td className="py-[10px] pl-16 pr-3">
                                          <span className="mr-1.5 text-text-muted">{poActive ? "▾" : "▸"}</span>
                                          <span className="font-medium text-text-primary">{VENDOR_PRODUKSI[p.vendorProduksi]?.name ?? p.vendorProduksi}</span>
                                          <span className="ml-1.5 font-mono text-[10.5px] text-text-muted">{p.id}</span>
                                        </td>
                                        <td className="px-3 py-[10px] text-right font-mono tabular-nums">{remaining}</td>
                                        <td className="px-3 py-[10px] text-right font-mono tabular-nums text-text-muted">{p.rollCount}</td>
                                        <td className="px-3 py-[10px] text-right font-mono tabular-nums font-medium">{formatRupiah(p.amount)}</td>
                                        <td className="px-3 py-[10px]">
                                          <StatusPill tone="warning">Belum Invoice</StatusPill>
                                        </td>
                                        <td className="px-3 py-[10px]">
                                          <div className="flex items-center gap-1.5">
                                            <Button
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                setSelectedPoId(p.id);
                                                setAfterSubmitPoId(null);
                                              }}
                                              variant="primary"
                                              size="xs"
                                            >
                                              Buat PV
                                            </Button>
                                            <Button
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                setClosingPoId(p.id);
                                              }}
                                              variant="danger"
                                              size="xs"
                                            >
                                              Close
                                            </Button>
                                          </div>
                                        </td>
                                      </tr>
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

          {selectedPo && (
            <div className="border-t border-border-subtle p-4">
              <PayingVoucherWizard
                // key=po.id -- WAJIB supaya React benar-benar me-remount wizard tiap kali PO yang
                // dipilih berganti (bukan cuma re-render instance yang sama dengan prop baru).
                // Tanpa ini, semua useState di dalam wizard (activeKey/warna terpilih, entries,
                // dst.) yang di-inisialisasi dari `po` HANYA jalan sekali saat mount pertama --
                // begitu user pindah dari PO A ke PO B lewat "Buat PV", activeKey nyangkut di
                // warna PO A yang tidak ada di PO B, jadi form pilih warna/harga per roll tidak
                // muncul sama sekali (harus mulai dari PO paling atas dulu baru "kepancing" state
                // segar).
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
            </div>
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
                <button onClick={() => setAfterSubmitPoId(null)} className="rounded-md border border-[#CBD5DF] px-3.5 py-[7px] font-sans text-xs font-semibold text-action-primary">
                  Nanti saja
                </button>
              </div>
            </div>
          )}
        </div>

      <div className="overflow-hidden border border-border-subtle bg-surface-card">
          <div className="border-b border-border-subtle px-4 py-3 font-sans text-[13px] font-semibold text-text-primary">Riwayat Paying Voucher</div>
          {riwayatMrpSummaries.length === 0 && (
            <div className="px-5 py-8 text-center font-sans text-xs text-text-muted">Belum ada PV yang pernah diajukan.</div>
          )}
          {riwayatMrpSummaries.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="border-b-2 border-accent-blue bg-info-bg font-sans text-[10.5px] font-medium uppercase tracking-wider text-info-fg">
                    <th className="px-5 py-[9px] text-left">No MRP / Supplier / Vendor Produksi</th>
                    <th className="px-3 py-[9px] text-right">Nilai</th>
                    <th className="px-3 py-[9px] text-left">Status</th>
                    <th className="px-3 py-[9px] text-left">Lampiran Invoice</th>
                    <th className="px-3 py-[9px] text-left">Bukti Pembayaran</th>
                  </tr>
                </thead>
                <tbody>
                  {riwayatMrpSummaries.map((m) => {
                    const mrpActive = expandedMrpRiwayat === m.mrpId;
                    return (
                      <Fragment key={m.mrpId}>
                        <tr
                          onClick={() => {
                            const next = mrpActive ? null : m.mrpId;
                            setExpandedMrpRiwayat(next);
                            setExpandedSupplierRiwayat(null);
                            setExpandedInvoiceRiwayat(null);
                          }}
                          className={"cursor-pointer border-b border-[#F1F4F7] font-sans text-xs text-[#31414F] hover:bg-[#FAFBFC] " + (mrpActive ? "bg-info-bg" : "")}
                        >
                          <td className="px-5 py-[11px]">
                            <span className="mr-1.5 text-text-muted">{mrpActive ? "▾" : "▸"}</span>
                            <span className="font-mono font-semibold text-text-primary">{m.mrpId}</span>
                            <span className="ml-1.5 font-sans text-[10.5px] text-text-muted">{m.supplierCount} supplier</span>
                          </td>
                          <td className="px-3 py-[11px] text-right font-mono tabular-nums font-medium">{formatRupiah(m.totalNilai)}</td>
                          <td className="px-3 py-[11px]">
                            <StatusPill tone="neutral">{m.invs.length} PV</StatusPill>
                          </td>
                          <td className="px-3 py-[11px]" />
                          <td className="px-3 py-[11px]" />
                        </tr>
                        {mrpActive &&
                          riwayatSupplierSummariesForMrp(m.invs).map((s) => {
                            const supplierKey = `${m.mrpId}::${s.supplier}`;
                            const supplierActive = expandedSupplierRiwayat === supplierKey;
                            return (
                              <Fragment key={supplierKey}>
                                <tr
                                  onClick={() => {
                                    const next = supplierActive ? null : supplierKey;
                                    setExpandedSupplierRiwayat(next);
                                    setExpandedInvoiceRiwayat(null);
                                  }}
                                  className={"cursor-pointer border-b border-[#F1F4F7] bg-[#FBFCFD] font-sans text-[11.5px] text-[#31414F] hover:bg-[#F2F5F8] " + (supplierActive ? "bg-info-bg" : "")}
                                >
                                  <td className="py-[10px] pl-10 pr-3">
                                    <span className="mr-1.5 text-text-muted">{supplierActive ? "▾" : "▸"}</span>
                                    <span className="font-medium text-text-primary">{s.supplier}</span>
                                    <span className="ml-1.5 font-mono text-[10.5px] text-text-muted">{s.vendorCount} vendor</span>
                                  </td>
                                  <td className="px-3 py-[10px] text-right font-mono tabular-nums font-medium">{formatRupiah(s.totalNilai)}</td>
                                  <td className="px-3 py-[10px]">
                                    <StatusPill tone="neutral">{s.invs.length} PV</StatusPill>
                                  </td>
                                  <td className="px-3 py-[10px]" />
                                  <td className="px-3 py-[10px]" />
                                </tr>
                                {supplierActive &&
                                  s.invs.map((inv) => {
                                    const invActive = expandedInvoiceRiwayat === inv.id;
                                    const badge = invoiceBadge(inv.status);
                                    return (
                                      <Fragment key={inv.id}>
                                        <tr
                                          onClick={() => setExpandedInvoiceRiwayat(invActive ? null : inv.id)}
                                          className={"cursor-pointer border-b border-[#F1F4F7] font-sans text-[11.5px] text-[#31414F] hover:bg-[#FAFBFC] " + (invActive ? "bg-info-bg" : "")}
                                        >
                                          <td className="py-[10px] pl-16 pr-3">
                                            <span className="mr-1.5 text-text-muted">{invActive ? "▾" : "▸"}</span>
                                            <span className="font-medium text-text-primary">{VENDOR_PRODUKSI[inv.destinationVendor]?.name ?? inv.destinationVendor}</span>
                                            <span className="ml-1.5 font-mono text-[10.5px] text-text-muted">{inv.noInvoiceVendor || inv.id}</span>
                                          </td>
                                          <td className="px-3 py-[10px] text-right font-mono tabular-nums font-medium">{formatRupiah(inv.totalBiaya)}</td>
                                          <td className="px-3 py-[10px]">
                                            <StatusPill tone={badge.tone}>{badge.label}</StatusPill>
                                          </td>
                                          <td className="px-3 py-[10px]">
                                            {inv.buktiPvDataUrl ? (
                                              <button
                                                onClick={(e) => {
                                                  e.stopPropagation();
                                                  viewAndDownloadFile(inv.buktiPvDataUrl!);
                                                }}
                                                className="font-sans text-[11px] font-semibold text-action-primary underline"
                                              >
                                                Lihat / Download
                                              </button>
                                            ) : (
                                              <span className="font-sans text-[11px] text-text-muted">—</span>
                                            )}
                                          </td>
                                          <td className="px-3 py-[10px]">
                                            {inv.buktiBayarAt ? (
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
                                            )}
                                          </td>
                                        </tr>
                                        {invActive && (
                                          <tr>
                                            <td colSpan={5} className="border-b border-[#F1F4F7] bg-white px-4 py-3 pl-16">
                                              {invoiceColorBreakdown(inv)}
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

      <div className="rounded-lg border border-border-subtle bg-surface-card px-5 py-4 text-center font-sans text-xs text-text-muted">
        Status lengkap tiap PO material (invoice, delivery, receiving, dst) dipindahkan ke halaman{" "}
        <a href="/procurement/material-tracking" className="font-semibold text-action-primary">
          Material Tracking
        </a>
        .
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
