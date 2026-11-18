"use client";

import { useState } from "react";
import { DataTable, aggSame, aggSum, type ColumnDef, type FilterDef } from "@/components/mrp/data-table";
import { KpiCard } from "@/components/ui/kpi-card";
import { alertDialog } from "@/components/ui/confirm-dialog";
import { StatusPill } from "@/components/ui/status-pill";
import { Button } from "@/components/ui/button";
import { NumberInput } from "@/components/mrp/number-input";
import { viewEkspedisiPhoto } from "@/components/mrp/koli-ekspedisi-card";
import { InvoiceKoliTabs } from "@/components/mrp/invoice-koli-tabs";
import { useMrpStore } from "@/lib/mrp/store";
import { pvStatusVendor, pvTone } from "@/lib/mrp/flowStatus";
import { exportVendorInvoiceExcel } from "@/lib/mrp/exportVendorInvoiceExcel";
import {
  formatPcs,
  formatRupiah,
  invoiceCategoryLabel,
  hargaMaklonLineRate,
  invoiceKoliBreakdown,
  maklonTipeForWarna,
  mrpMetaFor,
  vendorCumulativeQtyByTipe,
  productionYieldBySize,
  vendorInvoiceAdjustmentTotal,
  vendorInvoiceFinalAmount,
} from "@/lib/mrp/derive";
import { VENDOR_PRODUKSI } from "@/lib/mrp/seed";
import { SysadminActionsBar } from "@/components/sysadmin/correction-dialog";
import { invoiceAdjustmentCorrections, vendorInvoiceStatusCorrections, vendorInvoiceVoidCorrections } from "@/components/sysadmin/vendor-corrections";
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
  const hargaMaklon = useMrpStore((s) => s.hargaMaklon);
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

  const [shownIds, setShownIds] = useState<Set<string> | null>(null);
  const [preset, setPreset] = useState<{ nonce: number; filters: Record<string, string[]>; card: string }>({ nonce: 0, filters: {}, card: "" });
  const [adjKind, setAdjKind] = useState<VendorInvoiceAdjustmentKind>("TIDAK_ADA");
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
  const sorted = [...vendorInvoices].sort((a, b) => (a.submittedAt < b.submittedAt ? 1 : -1));

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
      void alertDialog({ title: "Gagal menyimpan denda/reward", message: "Coba lagi. " + (err instanceof Error ? err.message : String(err)), tone: "danger" });
    } finally {
      setSubmittingAdj(false);
    }
  }

  // Pola PPIC (owner 2026-11-16): pohon No MRP -> Vendor -> Invoice diganti tabel bersama (kelompok bawaan No. MRP > Vendor),
  // rincian invoice (denda/reward, Setujui invoice, lampiran ekspedisi, isi koli, detail per MRP) di panel samping, kartu mengikuti filter.
  const vendorName = (id: string) => VENDOR_PRODUKSI[id]?.name ?? id;
  const mrpsOf = (inv: VendorInvoice) => Array.from(new Set(inv.lines.map((l) => l.mrpId)));
  // Status Paying Voucher standar (lib/mrp/flowStatus.ts): Submitted (diajukan vendor), Approve (disetujui Procurement), Paid.
  const statusOf = (inv: VendorInvoice) => ({ label: pvStatusVendor(inv), tone: pvTone(pvStatusVendor(inv)) });
  const uniqSorted = (xs: string[]) => Array.from(new Set(xs.filter(Boolean))).sort((a, b) => a.localeCompare(b, "id-ID", { numeric: true }));
  const shown = shownIds ? sorted.filter((i) => shownIds.has(i.id)) : sorted;
  const bold = (x: React.ReactNode) => <span className="font-semibold">{x}</span>;
  const filterDefs: FilterDef<VendorInvoice>[] = [
    { label: "No. MRP", options: uniqSorted(sorted.flatMap(mrpsOf)).reverse(), test: (i, v) => mrpsOf(i).includes(v) },
    { label: "Vendor", options: uniqSorted(sorted.map((i) => vendorName(i.vendorProduksi))), test: (i, v) => vendorName(i.vendorProduksi) === v },
    { label: "Status", options: uniqSorted(sorted.map((i) => statusOf(i).label)), test: (i, v) => statusOf(i).label === v },
  ];
  const columns: ColumnDef<VendorInvoice>[] = [
    { key: "sysadmin", label: "Aksi Sysadmin", default: true, sysadmin: true, render: (inv) => <SysadminActionsBar compact actions={[...vendorInvoiceStatusCorrections(inv), ...vendorInvoiceVoidCorrections(inv)]} /> },
    { key: "mrp", label: "No. MRP", default: true, aggregate: aggSame((i) => mrpsOf(i).join(", ")), render: (i) => <span className="font-mono">{mrpsOf(i).join(", ")}</span> },
    { key: "vendor", label: "Vendor", default: true, aggregate: aggSame((i) => vendorName(i.vendorProduksi)), render: (i) => vendorName(i.vendorProduksi) },
    { key: "qty", label: "Qty", default: false, align: "right", aggregate: aggSum((i) => i.lines.reduce((s, l) => s + l.qty, 0), (n) => bold(formatPcs(n))), render: (i) => <span className="font-mono">{formatPcs(i.lines.reduce((s, l) => s + l.qty, 0))}</span> },
    { key: "total", label: "Total Tagihan", default: true, align: "right", aggregate: aggSum((i) => vendorInvoiceFinalAmount(i), (n) => bold(formatRupiah(n))), render: (i) => <span className="font-mono">{formatRupiah(vendorInvoiceFinalAmount(i))}</span> },
    {
      key: "status",
      label: "Status",
      default: true,
      aggregate: aggSame((i) => statusOf(i).label, (v) => <StatusPill tone={sorted.map(statusOf).find((b) => b.label === v)?.tone ?? "neutral"}>{v}</StatusPill>),
      render: (i) => <StatusPill tone={statusOf(i).tone}>{statusOf(i).label}</StatusPill>,
    },
    { key: "tgl", label: "Tgl Ajukan", default: true, render: (i) => <span className="font-mono text-[11px] text-text-muted">{i.submittedAt}</span> },
  ];
  const waiting = shown.filter((i) => i.status === "SUBMITTED");

  function invoiceDetail(inv: VendorInvoice) {
    const finalAmount = vendorInvoiceFinalAmount(inv);
    const denda = vendorInvoiceAdjustmentTotal(inv, "DENDA");
    const reward = vendorInvoiceAdjustmentTotal(inv, "REWARD");
    // Hanya dihitung untuk invoice yang dibuka (alokasi FIFO per roll cukup berat).
    const koliBreakdown = invoiceKoliBreakdown(inv, vendorInvoices, mrpDetails, staticMrps, productionBatches, productionResults, productionGroupMeta, rawInvoices, deliveryKolis, ekspedisiRates, itemSellingPrices);
    return (
      <div>
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
                            <span className="flex items-center gap-2 font-mono">
                              <SysadminActionsBar actions={invoiceAdjustmentCorrections(inv, a)} />
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
                  {/* Owner 2026-11-12: cek isi koli invoice ini (item dan qty) dalam dua tab, Per Warna (total semua koli) dan Per Koli. */}
                  <InvoiceKoliTabs inv={inv} />

                  <div className="mt-3 font-sans text-[11px] font-medium uppercase tracking-wider text-text-muted">Lampiran — detail per MRP</div>
                  {inv.lines.map((line) => {
                    const lineKey = inv.id + "|" + line.mrpId + "|" + line.warna + "|" + line.lengan + "|" + (line.usia ?? "");
                    const mrp = mrpMetaFor(line.mrpId, mrpDetails, staticMrps);
                    const sizes = productionYieldBySize(line.mrpId, line.warna, line.lengan, mrpDetails, productionBatches, productionResults);
                    // Validasi harga untuk Procurement: tipe harga Master Data item ini (kategori + lengan) dan harga master-nya sekarang.
                    const lineTipe = maklonTipeForWarna(line.mrpId, line.warna, line.lengan, mrpDetails, line.usia);
                    const lineMaster = hargaMaklonLineRate(hargaMaklon, inv.vendorProduksi, lineTipe, line.lengan, vendorCumulativeQtyByTipe(inv.vendorProduksi, mrpDetails));
                    const rateSelisih = inv.status !== "PAID" && lineMaster.rate !== line.ratePerPc;
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
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-[#F1F4F7] px-3 py-1.5 font-sans text-[11px] text-text-muted">
                          <span>Harga maklon item ini:</span>
                          <span className="rounded bg-info-bg px-1.5 py-0.5 font-mono text-[10.5px] font-semibold text-info-fg">{lineTipe}</span>
                          <span className="font-mono text-[12px] font-semibold text-text-primary">{formatRupiah(line.ratePerPc)}/pc</span>
                          <span className="text-[10px]">{lineMaster.fallbackBase ? "(tipe belum ada di Master Data, pakai harga PDK/PJG biasa)" : lineMaster.source}</span>
                          {rateSelisih && <span className="text-warning-fg">Master Data sekarang {formatRupiah(lineMaster.rate)}/pc</span>}
                        </div>
                        <div className="grid grid-cols-4 gap-2 border-t border-[#F1F4F7] px-3 py-1.5 font-sans text-[10px] font-medium uppercase tracking-wider text-text-muted">
                          <span>Size</span>
                          <span className="text-right">Qty</span>
                          <span className="text-right">Harga/pc</span>
                          <span className="text-right">Nilai</span>
                        </div>
                        {sizes.length === 0 && <div className="border-t border-[#F1F4F7] px-3 py-2 font-sans text-[11.5px] text-text-muted">Belum ada rincian per size.</div>}
                        {sizes.map((s) => (
                          <div key={s.size} className="grid grid-cols-4 items-center gap-2 border-t border-[#F1F4F7] px-3 py-1.5 font-mono text-[11.5px] text-[#31414F]">
                            <span>{s.size}</span>
                            <span className="text-right">{s.target}</span>
                            <span className="text-right text-text-muted">{formatRupiah(line.ratePerPc)}</span>
                            <span className="text-right">{formatRupiah(s.target * line.ratePerPc)}</span>
                          </div>
                        ))}
                      </div>
                    );
                  })}
      </div>
    );
  }

  return (
    <>
      <div className="grid grid-cols-4 gap-3 max-lg:grid-cols-2">
        <KpiCard
          label="Menunggu review"
          value={waiting.length}
          sub="klik untuk menyaring"
          accent="orange"
          active={preset.card === "review"}
          onClick={() =>
            setPreset((p) =>
              p.card === "review"
                ? { nonce: p.nonce + 1, filters: {} as Record<string, string[]>, card: "" }
                : { nonce: p.nonce + 1, filters: { Status: ["Submitted"] }, card: "review" }
            )
          }
        />
        <KpiCard label="Nilai menunggu review" value={formatRupiah(waiting.reduce((s, i) => s + vendorInvoiceFinalAmount(i), 0))} valueClassName="text-[20px]" sub="invoice yang tampil" accent="purple" />
        <KpiCard label="Jumlah invoice" value={shown.length} sub="invoice yang tampil" accent="blue" />
        <KpiCard label="Total tagihan" value={formatRupiah(shown.reduce((s, i) => s + vendorInvoiceFinalAmount(i), 0))} valueClassName="text-[20px]" sub="invoice yang tampil" accent="teal" />
      </div>

      <DataTable<VendorInvoice>
        title="Semua invoice vendor"
        headerActions={
          <Button
            variant="ghost"
            size="xs"
            disabled={vendorInvoices.length === 0}
            title="Unduh laporan Excel semua invoice vendor: header berwarna, ada filter, lengkap dengan kategori item."
            onClick={() => exportVendorInvoiceExcel(vendorInvoices, mrpDetails, "Laporan-Invoice-Vendor-" + new Date().toISOString().slice(0, 10) + ".xlsx")}
          >
            Download laporan (Excel)
          </Button>
        }
        columns={columns}
        rows={sorted}
        keyOf={(i) => i.id}
        firstColumnLabel="No Invoice"
        firstColumnRender={(i) => <span className="font-mono font-medium">{i.id}</span>}
        filterDefs={filterDefs}
        filterPreset={preset}
        defaultGroupBy={["No. MRP", "Vendor"]}
        search={{ placeholder: "Cari no invoice, MRP, vendor…", getText: (i) => `${i.id} ${mrpsOf(i).join(" ")} ${vendorName(i.vendorProduksi)} ${statusOf(i).label}` }}
        rowClassName={(i) => (i.status === "SUBMITTED" ? "bg-warning-bg/40" : undefined)}
        renderExpanded={(inv) => invoiceDetail(inv)}
        onFilteredRows={(list) => setShownIds(new Set(list.map((i) => i.id)))}
        emptyText="Belum ada invoice vendor."
        nowrap
      />
    </>
  );
}
