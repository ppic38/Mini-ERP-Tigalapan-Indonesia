"use client";

import { Fragment, useState } from "react";
import { StatusPill } from "@/components/ui/status-pill";
import { Button } from "@/components/ui/button";
import { NumberInput } from "@/components/mrp/number-input";
import { viewEkspedisiPhoto } from "@/components/mrp/koli-ekspedisi-card";
import { useMrpStore } from "@/lib/mrp/store";
import {
  formatPcs,
  formatRupiah,
  invoiceCategoryLabel,
  invoiceKoliBreakdown,
  mrpMetaFor,
  productionYieldBySize,
  vendorInvoiceAdjustmentTotal,
  vendorInvoiceBadge,
  vendorInvoiceFinalAmount,
} from "@/lib/mrp/derive";
import { VENDOR_PRODUKSI } from "@/lib/mrp/seed";
import type { VendorInvoice, VendorInvoiceAdjustmentKind } from "@/lib/mrp/types";

/** Panel "Invoice Vendor" — konten dipindah dari halaman standalone /procurement/invoice-vendor
 *  (sekarang jadi tab di Paying Voucher (Invoice), bareng "Invoice Material") supaya sidebar
 *  Procurement tidak punya item terpisah untuk ini lagi. Route lama sudah jadi redirect (lihat
 *  app/procurement/invoice-vendor/page.tsx). Logic & UI TIDAK berubah dari versi standalone.
 *
 *  Revisi 2026-09-12 (user-reported, tes user): fitur "Download Lampiran Invoice" (checkbox pilih
 *  baris + export Excel) DIHAPUS TOTAL -- exportInvoiceLampiranExcel/downloadInvoiceLampiran & state
 *  `selected` yang dulu ada di sini sekarang tidak dipakai lagi, sengaja tidak disisakan sebagai
 *  dead code. */

export function InvoiceVendorReviewPanel() {
  const vendorInvoices = useMrpStore((s) => s.vendorInvoices);
  const mrpDetails = useMrpStore((s) => s.mrpDetails);
  const staticMrps = useMrpStore((s) => s.staticMrps);
  const productionBatches = useMrpStore((s) => s.productionBatches);
  const productionResults = useMrpStore((s) => s.productionResults);
  const productionGroupMeta = useMrpStore((s) => s.productionGroupMeta);
  const rawInvoices = useMrpStore((s) => s.invoices);
  const deliveryKolis = useMrpStore((s) => s.deliveryKolis);
  const ekspedisiRates = useMrpStore((s) => s.ekspedisiRates);
  const itemSellingPrices = useMrpStore((s) => s.itemSellingPrices);
  const addVendorInvoiceAdjustment = useMrpStore((s) => s.addVendorInvoiceAdjustment);
  const setVendorInvoiceStatus = useMrpStore((s) => s.setVendorInvoiceStatus);

  const [expandedInvoiceId, setExpandedInvoiceId] = useState("");
  const [adjKind, setAdjKind] = useState<VendorInvoiceAdjustmentKind>("DENDA");
  const [adjLabel, setAdjLabel] = useState("");
  const [adjAmount, setAdjAmount] = useState(0);

  // Item revisi 2026-09-17 (owner: "Invoice Vendor buat konsep dan tampilannya seperti di Invoice
  // Material") -- tabel pohon No MRP -> Vendor Produksi (leaf = 1 invoice vendor), gaya visual
  // PERSIS tabel PO Material/Riwayat PV (border-collapse <table>, StatusPill, chevron ▸/▾, sama
  // pola dengan components/procurement/paying-voucher-material-panel.tsx). Beda dari Invoice
  // Material: tidak ada level "Supplier" (vendor produksi di Maklon tidak punya supplier terpisah,
  // sama alasan dengan PO Maklon/Payment Maklon). Satu invoice BISA menyentuh >1 MRP sekaligus
  // (inv.lines multi-MRP) -- dalam kasus itu invoice yang sama muncul di >1 kartu MRP, SENGAJA
  // (supaya tetap kelihatan dari MRP mana pun yang dibuka), bukan bug duplikasi data -- pola sama
  // dengan payment-maklon-panel.tsx.
  const [expandedMrpTree, setExpandedMrpTree] = useState<string | null>(null);
  const [expandedVendorTree, setExpandedVendorTree] = useState<string | null>(null);

  const pending = vendorInvoices.filter((i) => i.status === "SUBMITTED");
  const sorted = [...vendorInvoices].sort((a, b) => (a.submittedAt < b.submittedAt ? 1 : -1));

  const vendorTreeHierarchy = (() => {
    const map = new Map<string, Map<string, VendorInvoice[]>>();
    for (const inv of sorted) {
      const mrpIds = Array.from(new Set(inv.lines.map((l) => l.mrpId)));
      for (const mrpId of mrpIds) {
        if (!map.has(mrpId)) map.set(mrpId, new Map());
        const vendorMap = map.get(mrpId)!;
        if (!vendorMap.has(inv.vendorProduksi)) vendorMap.set(inv.vendorProduksi, []);
        vendorMap.get(inv.vendorProduksi)!.push(inv);
      }
    }
    return map;
  })();

  const vendorMrpSummaries = Array.from(vendorTreeHierarchy.entries())
    .map(([mrpId, vendorMap]) => {
      let invoiceCount = 0;
      let totalTagihan = 0;
      for (const list of vendorMap.values()) {
        invoiceCount += list.length;
        totalTagihan += list.reduce((s, i) => s + vendorInvoiceFinalAmount(i), 0);
      }
      return { mrpId, vendorCount: vendorMap.size, invoiceCount, totalTagihan };
    })
    .sort((a, b) => b.mrpId.localeCompare(a.mrpId, "id-ID"));

  function vendorSummariesForMrp(mrpId: string) {
    return Array.from(vendorTreeHierarchy.get(mrpId)?.entries() ?? [])
      .map(([vendor, invs]) => ({
        vendor,
        vendorName: VENDOR_PRODUKSI[vendor]?.name ?? vendor,
        invs,
        totalTagihan: invs.reduce((s, i) => s + vendorInvoiceFinalAmount(i), 0),
      }))
      .sort((a, b) => a.vendorName.localeCompare(b.vendorName, "id-ID"));
  }

  function resetAdjForm() {
    setAdjLabel("");
    setAdjAmount(0);
  }

  const [submittingAdj, setSubmittingAdj] = useState(false);

  // BUG FIX 2026-09-12 (user-reported: pilih Denda/Reward tapi nilai invoice tidak berubah) --
  // sebelumnya ini memanggil addVendorInvoiceAdjustment TANPA await lalu langsung reset form,
  // jadi kalaupun penyimpanannya gagal di server (lihat fix di addVendorInvoiceAdjustmentAction),
  // errornya tidak pernah terlihat -- form sudah kadung ke-reset seolah berhasil. Sekarang
  // ditunggu, form baru direset kalau benar-benar sukses, dan kegagalan ditampilkan jelas.
  async function submitAdjustment(invoiceId: string) {
    if (!adjLabel.trim()) return;
    // TIDAK_ADA murni catatan audit ("tepat waktu, tanpa sanksi") — amount-nya dipaksa 0 dan
    // tidak disyaratkan diisi user, beda dari DENDA/REWARD yang butuh nominal > 0.
    if (adjKind !== "TIDAK_ADA" && (!adjAmount || adjAmount <= 0)) return;
    setSubmittingAdj(true);
    try {
      await addVendorInvoiceAdjustment(invoiceId, { kind: adjKind, label: adjLabel.trim(), amount: adjKind === "TIDAK_ADA" ? 0 : adjAmount });
      resetAdjForm();
    } catch (err) {
      window.alert("Gagal menyimpan denda/reward -- coba lagi. " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setSubmittingAdj(false);
    }
  }

  return (
    <>
      {pending.length > 0 && (
        <div className="rounded-lg border border-[#F0DFC2] bg-warning-bg px-5 py-2.5 font-sans text-[11.5px] font-medium text-warning-fg">
          {pending.length} invoice vendor menunggu review — klik baris untuk buka detail &amp; Setujui.
        </div>
      )}

      <div className="overflow-hidden border border-border-subtle bg-surface-card">
        <div className="border-b border-border-subtle px-4 py-3 font-sans text-[13px] font-semibold text-text-primary">Semua invoice vendor</div>
        {vendorMrpSummaries.length === 0 && <div className="px-5 py-8 text-center font-sans text-xs text-text-muted">Belum ada invoice vendor.</div>}
        {vendorMrpSummaries.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b-2 border-accent-blue bg-info-bg font-sans text-[10.5px] font-medium uppercase tracking-wider text-info-fg">
                  <th className="px-5 py-[9px] text-left">No MRP / Vendor Produksi / No Invoice</th>
                  <th className="px-3 py-[9px] text-right">Total Tagihan</th>
                  <th className="px-3 py-[9px] text-left">Status</th>
                  <th className="px-3 py-[9px] text-left">Tanggal</th>
                </tr>
              </thead>
              <tbody>
                {vendorMrpSummaries.map((m) => {
                  const mrpActive = expandedMrpTree === m.mrpId;
                  return (
                    <Fragment key={m.mrpId}>
                      <tr
                        onClick={() => {
                          const next = mrpActive ? null : m.mrpId;
                          setExpandedMrpTree(next);
                          setExpandedVendorTree(null);
                          setExpandedInvoiceId("");
                        }}
                        className={"cursor-pointer border-b border-[#F1F4F7] font-sans text-xs text-[#31414F] hover:bg-[#FAFBFC] " + (mrpActive ? "bg-info-bg" : "")}
                      >
                        <td className="px-5 py-[11px]">
                          <span className="mr-1.5 text-text-muted">{mrpActive ? "▾" : "▸"}</span>
                          <span className="font-mono font-semibold text-text-primary">{m.mrpId}</span>
                          <span className="ml-1.5 font-sans text-[10.5px] text-text-muted">{m.vendorCount} vendor</span>
                        </td>
                        <td className="px-3 py-[11px] text-right font-mono tabular-nums font-medium">{formatRupiah(m.totalTagihan)}</td>
                        <td className="px-3 py-[11px]">
                          <StatusPill tone="neutral">{m.invoiceCount} invoice</StatusPill>
                        </td>
                        <td className="px-3 py-[11px]" />
                      </tr>
                      {mrpActive &&
                        vendorSummariesForMrp(m.mrpId).map((v) => {
                          const vendorKey = `${m.mrpId}::${v.vendor}`;
                          const vendorActive = expandedVendorTree === vendorKey;
                          return (
                            <Fragment key={vendorKey}>
                              <tr
                                onClick={() => {
                                  const next = vendorActive ? null : vendorKey;
                                  setExpandedVendorTree(next);
                                  setExpandedInvoiceId("");
                                }}
                                className={"cursor-pointer border-b border-[#F1F4F7] bg-[#FBFCFD] font-sans text-[11.5px] text-[#31414F] hover:bg-[#F2F5F8] " + (vendorActive ? "bg-info-bg" : "")}
                              >
                                <td className="py-[10px] pl-10 pr-3">
                                  <span className="mr-1.5 text-text-muted">{vendorActive ? "▾" : "▸"}</span>
                                  <span className="font-medium text-text-primary">{v.vendorName}</span>
                                </td>
                                <td className="px-3 py-[10px] text-right font-mono tabular-nums font-medium">{formatRupiah(v.totalTagihan)}</td>
                                <td className="px-3 py-[10px]">
                                  <StatusPill tone="neutral">{v.invs.length} invoice</StatusPill>
                                </td>
                                <td className="px-3 py-[10px]" />
                              </tr>
                              {vendorActive &&
                                v.invs.map((inv) => {
                                  const invExpanded = expandedInvoiceId === inv.id;
                                  const finalAmount = vendorInvoiceFinalAmount(inv);
                                  const denda = vendorInvoiceAdjustmentTotal(inv, "DENDA");
                                  const reward = vendorInvoiceAdjustmentTotal(inv, "REWARD");
                                  // Item 2026-09-10 (feedback: info lampiran ekspedisi sebelum "Setujui
                                  // invoice") -- cuma dihitung begitu baris ini di-expand (bukan tiap
                                  // render semua invoice) supaya tidak ikut menjalankan
                                  // hppRowsForInvoicePerRoll (lumayan berat, alokasi FIFO) utk baris
                                  // yang collapsed.
                                  const koliBreakdown = invExpanded
                                    ? invoiceKoliBreakdown(inv, vendorInvoices, mrpDetails, staticMrps, productionBatches, productionResults, productionGroupMeta, rawInvoices, deliveryKolis, ekspedisiRates, itemSellingPrices)
                                    : undefined;
                                  return (
                                    <Fragment key={inv.id}>
                                      <tr
                                        onClick={() => setExpandedInvoiceId(invExpanded ? "" : inv.id)}
                                        title={inv.status === "SUBMITTED" ? "Klik untuk buka detail & Setujui invoice" : "Klik untuk buka detail"}
                                        className={
                                          "cursor-pointer border-b border-[#F1F4F7] font-sans text-[11.5px] text-[#31414F] hover:bg-[#FAFBFC] " +
                                          (invExpanded ? "bg-info-bg" : inv.status === "SUBMITTED" ? "bg-warning-bg/40" : "")
                                        }
                                      >
                                        <td className="py-[10px] pl-16 pr-3">
                                          <div className="flex items-center">
                                            <span className="mr-1.5 text-text-muted">{invExpanded ? "▾" : "▸"}</span>
                                            <span className="font-mono font-medium text-text-primary">{inv.id}</span>
                                          </div>
                                          {/* Item revisi 2026-09-17 (owner: "jangan satu kolom begitu
                                             dimuat semua" -- dulu inv.lines.map(mrpId).join(", ") tanpa
                                             dedupe, jadi MRP yang sama muncul berkali-kali (1x per
                                             baris warna/lengan) sekaligus numpuk di baris yang sama
                                             dengan No Invoice): sekarang di-dedupe, dipindah ke baris
                                             sendiri (bukan numpuk sebaris), dan MRP yang sedang dibuka
                                             di pohon ini (m.mrpId) tidak diulang -- cuma MRP LAIN yang
                                             invoice ini juga sentuh yang ditampilkan (kalau ada). */}
                                          {Array.from(new Set(inv.lines.map((l) => l.mrpId)))
                                            .filter((id) => id !== m.mrpId).length > 0 && (
                                            <div className="mt-0.5 font-mono text-[10.5px] text-text-muted">
                                              Juga di:{" "}
                                              {Array.from(new Set(inv.lines.map((l) => l.mrpId)))
                                                .filter((id) => id !== m.mrpId)
                                                .join(", ")}
                                            </div>
                                          )}
                                        </td>
                                        <td className="px-3 py-[10px] text-right font-mono tabular-nums font-medium">
                                          {/* Item revisi 2026-09-17 (owner: "saya tidak ingin ada
                                             tampilan net Rp... - denda Rp... di sini, berantakan" --
                                             detail net/denda dipindah SELURUHNYA ke highlight
                                             Denda/Reward di panel expand, kolom ini cuma nilai akhir). */}
                                          {formatRupiah(finalAmount)}
                                        </td>
                                        <td className="px-3 py-[10px]">
                                          <StatusPill tone={vendorInvoiceBadge(inv.status).tone}>{vendorInvoiceBadge(inv.status).label}</StatusPill>
                                        </td>
                                        <td className="px-3 py-[10px] font-mono text-[11px] text-text-muted">{inv.submittedAt}</td>
                                      </tr>
                                      {invExpanded && (
                                        <tr>
                                          <td colSpan={4} className="border-b border-[#F1F4F7] bg-[#FAFBFC] px-6 py-3">
                  <div className="rounded-md border border-[#E4E9EE] bg-white p-3">
                    <div className="font-sans text-[11px] font-medium uppercase tracking-wider text-text-muted">Denda / reward sesuai kontrak</div>
                    {(inv.adjustments?.length ?? 0) > 0 && (
                      <div className="mt-2">
                        {inv.adjustments.map((a) => (
                          <div key={a.id} className="mt-1 flex items-center justify-between font-sans text-[11.5px] text-[#31414F]">
                            <span>
                              <span className={a.kind === "DENDA" ? "text-danger-fg" : a.kind === "REWARD" ? "text-success-fg" : "text-text-muted"}>
                                {a.kind === "DENDA" ? "Denda" : a.kind === "REWARD" ? "Reward" : "Tidak ada sanksi"}
                              </span>
                              {" — "}
                              {a.label}
                              {a.note && <span className="text-text-muted"> ({a.note})</span>}
                            </span>
                            <span className="font-mono">
                              {a.kind === "TIDAK_ADA" ? "—" : (a.kind === "DENDA" ? "−" : "+") + formatRupiah(a.amount)}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                    <div className="mt-2 flex items-center justify-between border-t border-[#F1F4F7] pt-2 font-sans text-[11.5px] font-semibold text-[#31414F]">
                      <span>Total tagihan akhir</span>
                      <span className="font-mono">{formatRupiah(finalAmount)}</span>
                    </div>
                    {(denda > 0 || reward > 0) && (
                      <div className="mt-0.5 font-sans text-[10px] text-text-muted">
                        Net tagihan {formatRupiah(inv.netTagihan)} {denda > 0 && `− denda ${formatRupiah(denda)} `}
                        {reward > 0 && `+ reward ${formatRupiah(reward)}`}
                      </div>
                    )}

                    {inv.status === "SUBMITTED" && (
                      <div className="mt-3 grid grid-cols-4 gap-2 border-t border-[#F1F4F7] pt-3">
                        <div>
                          <div className="font-sans text-[10px] text-text-muted">Jenis</div>
                          <select
                            value={adjKind}
                            onChange={(e) => setAdjKind(e.target.value as VendorInvoiceAdjustmentKind)}
                            className="input mt-0.5"
                          >
                            <option value="DENDA">Denda</option>
                            <option value="REWARD">Reward</option>
                            <option value="TIDAK_ADA">Tidak ada (tepat waktu)</option>
                          </select>
                        </div>
                        <div>
                          <div className="font-sans text-[10px] text-text-muted">Label</div>
                          <input value={adjLabel} onChange={(e) => setAdjLabel(e.target.value)} placeholder="Contoh: Keterlambatan 3 hari" className="input mt-0.5" />
                        </div>
                        <div>
                          <div className="font-sans text-[10px] text-text-muted">Nominal (Rp)</div>
                          {adjKind === "TIDAK_ADA" ? (
                            <div className="input mt-0.5 flex items-center text-text-muted">— (tidak ada nominal)</div>
                          ) : (
                            <NumberInput value={adjAmount} onChange={setAdjAmount} currency startEmptyIfZero className="input mt-0.5" />
                          )}
                        </div>
                        <div className="flex items-end">
                          <button
                            onClick={() => submitAdjustment(inv.id)}
                            disabled={submittingAdj}
                            className="rounded-md border border-dashed border-[#CBD5DF] px-2.5 py-[7px] font-sans text-[11px] font-semibold text-text-muted disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {submittingAdj ? "Menyimpan…" : "+ Tambah item"}
                          </button>
                        </div>
                      </div>
                    )}

                    {inv.status === "SUBMITTED" && (
                      <div className="mt-3 border-t border-[#F1F4F7] pt-3">
                        <button
                          onClick={() => setVendorInvoiceStatus(inv.id, "APPROVED")}
                          className="rounded-md bg-action-primary px-3.5 py-2 font-sans text-xs font-semibold text-white"
                        >
                          Setujui invoice
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Item 2026-09-10 (feedback: "Tambahkan informasi mengenai lampiran ekspedisi
                     dari vendor produksi sebelum mengajukan invoice maklon ke finance") -- ditaruh
                     SEBELUM "Setujui invoice" sudah kelihatan di atas supaya Procurement sempat
                     cek lampiran ekspedisinya dulu sebelum approve. Revisi 2026-09-17 (owner:
                     "lebih simpel, buat dalam bentuk button ... tulis saja Lampiran Resi") -- dulu
                     1 kartu penuh per koli (KoliEkspedisiCard, semua field ekspedisi/resi/tanggal/
                     catatan ditulis lengkap), sekarang 1 baris ringkas + 1 tombol per koli --
                     komponen kartu itu SENGAJA tidak disentuh (masih dipakai apa adanya di
                     payment-maklon-panel.tsx), di sini cukup panggil viewEkspedisiPhoto langsung. */}
                  {koliBreakdown && (
                    <div className="mt-3 rounded-md border border-[#E4E9EE] bg-white p-3">
                      <div className="font-sans text-[11px] font-medium uppercase tracking-wider text-text-muted">Lampiran ekspedisi</div>
                      {koliBreakdown.groups.length === 0 && koliBreakdown.legacyRows.length === 0 && (
                        <div className="mt-1.5 font-sans text-[11.5px] text-text-muted">Belum ada data pengiriman untuk invoice ini.</div>
                      )}
                      <div className="mt-1.5 flex flex-col gap-1">
                        {koliBreakdown.groups.map((g) => (
                          <div key={g.koliId} className="flex items-center justify-between gap-2 font-sans text-[11.5px] text-[#31414F]">
                            <span>
                              <span className="font-mono font-semibold">{g.noKoli}</span> · {g.ekspedisi || "—"} · {g.noResi || "—"}
                            </span>
                            {g.ekspedisiNoteAt ? (
                              <Button onClick={() => viewEkspedisiPhoto(g.koliId)} variant="ghost" size="xs">
                                Lampiran Resi
                              </Button>
                            ) : (
                              <span className="font-sans text-[11px] text-text-muted">—</span>
                            )}
                          </div>
                        ))}
                      </div>
                      {koliBreakdown.legacyRows.length > 0 && (
                        <div className="mt-1.5 font-sans text-[10.5px] text-text-muted">
                          {formatPcs(koliBreakdown.legacyRows.reduce((s, r) => s + r.qty, 0))} pcs dari data lama (belum tertaut koli, sebelum migrasi pelacakan pengiriman).
                        </div>
                      )}
                    </div>
                  )}

                  {/* Item revisi 2026-09-17 (owner: "langsung saja tampilkan tabel warna serta
                     size, qty, nilainya, tidak usah yield"): dulu 2 klik berjenjang (klik MRP ->
                     breakdown per warna dengan cutting/reject/rework/yield -> klik "By size" lagi
                     -> breakdown per size) -- disederhanakan jadi 1 tabel Size/Qty/Nilai yang
                     LANGSUNG tampil di bawah tiap baris MRP, tanpa klik apa pun. Nilai per size =
                     qty (target/rencana MRP) x line.ratePerPc (rate per pc invoice ini) --
                     line.amount sendiri (subtotal semua size) dipertahankan di baris header
                     sebagai kontrol silang, seharusnya selalu sama dengan jumlah baris size. */}
                  <div className="mt-3 font-sans text-[11px] font-medium uppercase tracking-wider text-text-muted">Lampiran — detail per MRP</div>
                  {inv.lines.map((line) => {
                    const lineKey = inv.id + "|" + line.mrpId + "|" + line.warna + "|" + line.lengan + "|" + (line.usia ?? "");
                    const mrp = mrpMetaFor(line.mrpId, mrpDetails, staticMrps);
                    const sizes = productionYieldBySize(line.mrpId, line.warna, line.lengan, mrpDetails, productionBatches, productionResults);
                    return (
                      <div key={lineKey} className="mt-2 overflow-hidden rounded-md border border-[#E4E8EE] bg-white">
                        <div className="flex items-center justify-between gap-2 bg-[#F2F4F7] px-3 py-1.5 font-mono text-[11px] text-text-primary">
                          <span>
                            {line.mrpId}{" "}
                            <span className="text-[#94A3B0]">
                              ({invoiceCategoryLabel(mrp, line.usia)} · {line.warna} · {line.lengan})
                            </span>
                          </span>
                          <span>
                            {formatPcs(line.qty)} pcs · {formatRupiah(line.amount)}
                          </span>
                        </div>
                        <div className="grid grid-cols-3 gap-2 border-t border-[#F1F4F7] px-3 py-1.5 font-sans text-[10px] font-medium uppercase tracking-wider text-text-muted">
                          <span>Size</span>
                          <span className="text-right">Qty</span>
                          <span className="text-right">Nilai</span>
                        </div>
                        {sizes.length === 0 && <div className="border-t border-[#F1F4F7] px-3 py-2 font-sans text-[11.5px] text-text-muted">Belum ada rincian per size.</div>}
                        {sizes.map((s) => (
                          <div key={s.size} className="grid grid-cols-3 items-center gap-2 border-t border-[#F1F4F7] px-3 py-1.5 font-mono text-[11.5px] text-[#31414F]">
                            <span>{s.size}</span>
                            <span className="text-right">{s.target}</span>
                            <span className="text-right">{formatRupiah(s.target * line.ratePerPc)}</span>
                          </div>
                        ))}
                      </div>
                    );
                  })}
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
    </>
  );
}
