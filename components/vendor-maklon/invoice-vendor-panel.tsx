"use client";

import { Fragment, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";
import { useMrpStore } from "@/lib/mrp/store";
import { viewEkspedisiPhoto } from "@/components/mrp/koli-ekspedisi-card";
import { ItemsDetailPanel, summarizeItems } from "@/components/mrp/koli-items-detail";
import {
  formatDate,
  formatDecimal,
  formatPcs,
  formatRupiah,
  hargaMaklonRateInfo,
  invoiceProductionStatus,
  invoiceYieldSummary,
  productionYieldByWarna,
  productionYieldBySize,
  resiGroupInvoiceLines,
  vendorCumulativeQtyByLengan,
  vendorInvoiceAdjustmentTotal,
  vendorInvoiceBadge,
  vendorInvoiceFinalAmount,
  vendorInvoicePaymentStatus,
} from "@/lib/mrp/derive";
import type { Lengan, Usia } from "@/lib/mrp/types";

function groupByResi<T extends { resiGroupId?: string; id: string }>(items: T[]): [string, T[]][] {
  const map = new Map<string, T[]>();
  for (const it of items) {
    const key = it.resiGroupId ?? it.id;
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(it);
  }
  return Array.from(map.entries());
}

function invoiceLineKeyLocal(mrpId: string, warna: string, lengan: Lengan, usia?: Usia): string {
  return mrpId + "|" + warna + "|" + lengan + "|" + (usia ?? "");
}

/** Panel "Invoice Vendor" — konten diekstrak dari halaman lama Invoice & Payment (sekarang
 *  jadi satu sub-tab di halaman yang sama, berdampingan dengan panel "Invoice Maklon"). Alur
 *  invoice PER-PCS delivered × rate (dibatasi kapasitas vendor), direview Procurement dulu
 *  sebelum dibayar Finance — beda dari "Invoice Maklon" yang per-PO base fee.
 *
 *  Item 2026-09-11 (migration 0026): section "Create Invoice" (checkbox/qty/rate manual)
 *  DIHAPUS TOTAL -- invoice diajukan per grup resi yang sudah delivered penuh (bukan lagi
 *  manual pilih baris).
 *
 *  Revisi 2026-09-23 (owner: "submit invoice itu pindahkan dari halaman Pengiriman ke halaman
 *  Invoice & Payment"): tombol "Submit Invoice" (dan dialog konfirmasinya) SEKARANG di sini,
 *  bukan lagi di app/vendor-maklon/pengiriman/page.tsx -- halaman Pengiriman sekarang cuma
 *  menampilkan status "Sudah diinvoice"/"Belum diinvoice" tanpa aksi. Logika & rumus rate
 *  (hargaMaklonRateInfo + vendorCumulativeQtyByLengan, dikunci server-side juga lewat
 *  submitResiGroupInvoiceAction) DIPINDAH APA ADANYA, tidak diubah. */
export function InvoiceVendorPanel({ vendorId }: { vendorId: string }) {
  const mrpDetails = useMrpStore((s) => s.mrpDetails);
  const productionBatches = useMrpStore((s) => s.productionBatches);
  const productionResults = useMrpStore((s) => s.productionResults);
  const productionGroupMeta = useMrpStore((s) => s.productionGroupMeta);
  const rawInvoices = useMrpStore((s) => s.invoices);
  const vendorInvoices = useMrpStore((s) => s.vendorInvoices);
  const deliveryKolis = useMrpStore((s) => s.deliveryKolis);
  const hargaMaklon = useMrpStore((s) => s.hargaMaklon);
  const submitResiGroupInvoice = useMrpStore((s) => s.submitResiGroupInvoice);

  const [expandedInvoiceId, setExpandedInvoiceId] = useState("");
  const [expandedMrpKey, setExpandedMrpKey] = useState("");
  const [expandedWarnaKey, setExpandedWarnaKey] = useState("");
  // Revisi 2026-09-24 (owner: "apa bisa detail seperti [Riwayat pengiriman]?"): expand/collapse
  // rincian isi koli per item di kartu "Siap diajukan invoice" -- pola & komponen SAMA PERSIS dengan
  // "Riwayat pengiriman" di app/vendor-maklon/pengiriman/page.tsx (ItemsDetailPanel, koli-items-detail.tsx).
  const [expandedKoli, setExpandedKoli] = useState<Set<string>>(new Set());
  function toggleKoliExpanded(koliId: string) {
    setExpandedKoli((prev) => {
      const next = new Set(prev);
      if (next.has(koliId)) next.delete(koliId);
      else next.add(koliId);
      return next;
    });
  }

  const myInvoices = vendorInvoices.filter((i) => i.vendorProduksi === vendorId);

  // Grup resi yang sudah delivered TAPI belum diinvoice -- siap diajukan. Rate per baris read-only,
  // dihitung dari kapasitas kumulatif TRUE vendor ini (semua PO Produksi historisnya) + tier
  // Standar/PKS Master Data Harga Maklon -- murni pratinjau, server menghitung ulang persis sama.
  const cumulativeByLengan = vendorCumulativeQtyByLengan(vendorId, mrpDetails);
  function rateForLine(l: { lengan: Lengan }): number {
    return hargaMaklonRateInfo(hargaMaklon, vendorId, l.lengan, cumulativeByLengan[l.lengan] ?? 0).rate;
  }
  const deliveredMine = deliveryKolis.filter((k) => k.vendorProduksi === vendorId && k.deliveredAt);
  const readyGroups = groupByResi(deliveredMine).filter(([, kolis]) => kolis.every((k) => !k.resiInvoicedAt));

  const [invoiceDialogKoliIds, setInvoiceDialogKoliIds] = useState<string[] | null>(null);
  const [invoiceSubmitting, setInvoiceSubmitting] = useState(false);
  const [invoiceError, setInvoiceError] = useState<string | null>(null);
  function openInvoiceDialog(koliIds: string[]) {
    setInvoiceDialogKoliIds(koliIds);
    setInvoiceError(null);
  }
  function closeInvoiceDialog() {
    setInvoiceDialogKoliIds(null);
    setInvoiceError(null);
  }
  const invoiceDialogLines = invoiceDialogKoliIds ? resiGroupInvoiceLines(invoiceDialogKoliIds, deliveryKolis) : [];
  const invoiceDialogTotal = invoiceDialogLines.reduce((s, l) => s + l.qty * rateForLine(l), 0);
  async function submitInvoiceConfirm() {
    if (!invoiceDialogKoliIds || invoiceSubmitting) return;
    setInvoiceSubmitting(true);
    setInvoiceError(null);
    try {
      await submitResiGroupInvoice(invoiceDialogKoliIds);
      closeInvoiceDialog();
    } catch (e) {
      setInvoiceError(e instanceof Error ? e.message : "Gagal submit invoice.");
    } finally {
      setInvoiceSubmitting(false);
    }
  }

  return (
    <>
      {readyGroups.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-border-subtle bg-surface-card">
          <div className="border-b border-border-subtle px-4 py-3 font-sans text-[13px] font-semibold text-text-primary">
            Siap diajukan invoice ({readyGroups.length} resi)
          </div>
          <div className="flex flex-col gap-3 px-4 py-3">
            {readyGroups.map(([groupKey, kolis]) => {
              const first = kolis[0];
              const totalWeight = kolis.reduce((s, k) => s + (k.beratKoli ?? 0), 0);
              const koliIds = kolis.map((k) => k.id);
              return (
                <div key={groupKey} className="overflow-hidden rounded-md border border-border-subtle bg-white">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-[#F1F4F7] bg-[#F7F9FB] px-3 py-2 font-sans text-[11.5px] text-[#31414F]">
                    <span className="font-mono font-semibold">{first.noResi || "—"}</span>
                    <span>
                      Ekspedisi: <span className="font-medium">{first.ekspedisi}</span>
                    </span>
                    <span>
                      Total berat: <span className="font-mono">{formatDecimal(totalWeight)} kg</span>
                    </span>
                    <span className="font-mono text-[11px] text-text-muted">{formatDate(first.deliveredAt)}</span>
                    {first.ekspedisiNoteAt && (
                      <button onClick={() => viewEkspedisiPhoto(first.id)} className="font-semibold text-action-primary underline">
                        Lihat / Download foto
                      </button>
                    )}
                    <Button onClick={() => openInvoiceDialog(koliIds)} variant="primary" size="xs" className="ml-auto">
                      Submit Invoice →
                    </Button>
                  </div>
                  {first.ekspedisiNote && <div className="border-b border-[#F1F4F7] px-3 py-1.5 font-sans text-[10.5px] text-text-muted">Catatan: {first.ekspedisiNote}</div>}
                  <div className="grid grid-cols-4 gap-x-2 border-b border-[#F1F4F7] bg-[#FAFBFC] px-3 py-1.5 font-sans text-[10px] font-medium uppercase tracking-wider text-text-muted">
                    <span>No MRP</span>
                    <span>No Koli</span>
                    <span>Isi</span>
                    <span className="text-right">Berat (kg)</span>
                  </div>
                  {kolis.map((k) => {
                    const isExpanded = expandedKoli.has(k.id);
                    return (
                      <Fragment key={k.id}>
                        <div className="grid grid-cols-4 items-center gap-x-2 border-b border-[#F1F4F7] px-3 py-1.5 font-sans text-xs text-[#31414F] last:border-b-0">
                          <span className="font-mono">{k.mrpId}</span>
                          <span className="font-mono font-medium">{k.noKoli}</span>
                          <button
                            onClick={() => toggleKoliExpanded(k.id)}
                            className="flex items-center gap-1 text-left font-sans text-xs text-[#31414F] hover:text-action-primary"
                            title="Klik untuk lihat rincian isi koli per item"
                          >
                            {isExpanded ? <ChevronDown className="h-3.5 w-3.5 flex-none text-text-muted" /> : <ChevronRight className="h-3.5 w-3.5 flex-none text-text-muted" />}
                            {summarizeItems(k.items)}
                          </button>
                          <span className="text-right font-mono">{formatDecimal(k.beratKoli ?? 0)}</span>
                        </div>
                        {isExpanded && (
                          <div className="border-b border-[#F1F4F7] bg-[#FAFBFC] px-3 py-3 last:border-b-0">
                            <ItemsDetailPanel items={k.items} />
                          </div>
                        )}
                      </Fragment>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="overflow-hidden rounded-lg border border-border-subtle bg-surface-card">
        <div className="border-b border-border-subtle px-4 py-3 font-sans text-[13px] font-semibold text-text-primary">Invoice yang telah dibuat</div>
        <div className="overflow-x-auto">
          <div className="min-w-[1020px]">
            <div
              className="grid items-center gap-x-3 border-b border-border-subtle bg-[#F7F9FB] px-4 py-[9px] font-sans text-[10.5px] font-medium uppercase tracking-wider text-text-muted"
              style={{ gridTemplateColumns: "110px 1fr 90px 110px 90px 120px 160px" }}
            >
              <span>No Invoice</span>
              <span>MRP</span>
              <span className="text-right">Total qty</span>
              <span>Status</span>
              <span>Tanggal</span>
              <span className="text-right">Total</span>
              <span>Status Payment</span>
            </div>
            {myInvoices.length === 0 && <div className="px-4 py-6 text-center font-sans text-xs text-text-muted">Belum ada invoice.</div>}
            {myInvoices.map((inv) => {
              const invExpanded = expandedInvoiceId === inv.id;
              const totalQtyInv = inv.lines.reduce((s, l) => s + l.qty, 0);
              const payment = vendorInvoicePaymentStatus(inv);
              const finalAmount = vendorInvoiceFinalAmount(inv);
              const denda = vendorInvoiceAdjustmentTotal(inv, "DENDA");
              const reward = vendorInvoiceAdjustmentTotal(inv, "REWARD");
              const yieldSummary = invoiceYieldSummary(inv, mrpDetails, productionBatches, productionResults);
              const prodStatus = invoiceProductionStatus(inv, productionGroupMeta, rawInvoices);
              return (
                <div key={inv.id}>
                  <button
                    onClick={() => setExpandedInvoiceId(invExpanded ? "" : inv.id)}
                    className="grid w-full items-center gap-x-3 border-b border-[#F1F4F7] px-4 py-[11px] text-left font-sans text-xs text-[#31414F] hover:bg-[#F7F9FB]"
                    style={{ gridTemplateColumns: "110px 1fr 90px 110px 90px 120px 160px" }}
                  >
                    <span className="font-mono font-medium">{inv.id}</span>
                    <span>{inv.lines.map((l) => l.mrpId).join(", ")}</span>
                    <span className="text-right font-mono">{formatPcs(totalQtyInv)}</span>
                    <span>
                      <StatusPill tone={vendorInvoiceBadge(inv.status).tone}>{vendorInvoiceBadge(inv.status).label}</StatusPill>
                    </span>
                    <span className="font-mono text-[11px] text-text-muted">{inv.submittedAt}</span>
                    <span className="text-right font-mono font-semibold text-[#31414F]">{formatRupiah(inv.totalTagihan)}</span>
                    <span>
                      <StatusPill tone={payment.tone}>{payment.label}</StatusPill>
                    </span>
                  </button>
                  {invExpanded && (
                    <div className="border-b border-[#F1F4F7] bg-[#FAFBFC] px-6 py-3">
                      <div className="mb-3 grid grid-cols-4 gap-3 rounded-md border border-[#E4E9EE] bg-white p-3">
                        <div>
                          <div className="font-sans text-[10px] font-medium uppercase tracking-wider text-text-muted">Total tagihan</div>
                          <div className="mt-0.5 font-mono text-[12.5px] font-semibold text-[#31414F]">{formatRupiah(inv.totalTagihan)}</div>
                        </div>
                        <div>
                          <div className="font-sans text-[10px] font-medium uppercase tracking-wider text-text-muted">Yield</div>
                          <div className="mt-0.5 font-mono text-[12.5px] font-semibold text-[#31414F]">{yieldSummary.yieldPct.toFixed(1)}%</div>
                        </div>
                        <div>
                          <div className="font-sans text-[10px] font-medium uppercase tracking-wider text-text-muted">Status produksi</div>
                          <div className="mt-1">
                            {prodStatus ? (
                              <StatusPill tone={prodStatus.label === "DELAY" ? "danger" : prodStatus.label === "ONTIME" ? "success" : "info"}>
                                {prodStatus.label}
                                {prodStatus.days > 0 ? ` ${prodStatus.days}H` : ""}
                              </StatusPill>
                            ) : (
                              <span className="font-sans text-[11.5px] text-text-muted">—</span>
                            )}
                          </div>
                        </div>
                        <div>
                          <div className="font-sans text-[10px] font-medium uppercase tracking-wider text-text-muted">Due date</div>
                          <div className="mt-0.5 font-mono text-[12.5px] font-semibold text-[#31414F]">{inv.dueDate ? formatDate(inv.dueDate) : "—"}</div>
                        </div>
                      </div>
                      {(inv.adjustments?.length ?? 0) > 0 && (
                    <div className="mb-3 rounded-md border border-[#E4E9EE] bg-white p-3">
                      <div className="font-sans text-[11px] font-medium uppercase tracking-wider text-text-muted">Penyesuaian dari Procurement</div>
                      {inv.adjustments.map((a) => (
                        <div key={a.id} className="mt-1.5 flex items-center justify-between font-sans text-[11.5px] text-[#31414F]">
                          <span>
                            <span className={a.kind === "DENDA" ? "text-danger-fg" : "text-success-fg"}>{a.kind === "DENDA" ? "Denda" : "Reward"}</span>
                            {" — "}
                            {a.label}
                            {a.note && <span className="text-text-muted"> ({a.note})</span>}
                          </span>
                          <span className="font-mono">
                            {a.kind === "DENDA" ? "−" : "+"}
                            {formatRupiah(a.amount)}
                          </span>
                        </div>
                      ))}
                      <div className="mt-2 flex items-center justify-between border-t border-[#F1F4F7] pt-2 font-sans text-[11.5px] font-semibold text-[#31414F]">
                        <span>Total tagihan akhir</span>
                        <span className="font-mono">{formatRupiah(finalAmount)}</span>
                      </div>
                      <div className="mt-0.5 font-sans text-[10px] text-text-muted">
                        Net tagihan {formatRupiah(inv.netTagihan)} {denda > 0 && `− denda ${formatRupiah(denda)} `}
                        {reward > 0 && `+ reward ${formatRupiah(reward)}`}
                      </div>
                    </div>
                  )}
                  <div className="font-sans text-[11px] font-medium uppercase tracking-wider text-text-muted">Lampiran — detail per MRP</div>
                  <div className="mt-2 grid grid-cols-3 gap-2 font-sans text-[10.5px] font-medium uppercase tracking-wider text-text-muted">
                    <span>MRP</span>
                    <span className="text-right">Qty diinvoice</span>
                    <span className="text-right">Nilai</span>
                  </div>
                  {inv.lines.map((line) => {
                    const mrpKey = inv.id + "|" + line.mrpId + "|" + line.warna + "|" + line.lengan + "|" + (line.usia ?? "");
                    const mrpExpanded = expandedMrpKey === mrpKey;
                    return (
                      <div key={mrpKey}>
                        <button
                          onClick={() => {
                            setExpandedMrpKey(mrpExpanded ? "" : mrpKey);
                            setExpandedWarnaKey("");
                          }}
                          className="grid w-full grid-cols-3 items-center gap-2 border-t border-[#F1F4F7] py-1.5 text-left font-mono text-[11.5px] text-action-primary"
                        >
                          <span>
                            {line.mrpId} <span className="text-[#94A3B0]">({line.warna} · {line.lengan}{line.usia ? " · " + line.usia : ""})</span>
                          </span>
                          <span className="text-right">{formatPcs(line.qty)}</span>
                          <span className="text-right">{formatRupiah(line.amount)}</span>
                        </button>
                        {mrpExpanded && (
                          <div className="ml-3 border-l border-[#DDE4EB] py-1.5 pl-3">
                            {/* Item 18.5: "Qty PO/cutting" dipecah jadi 2 kolom terpisah -- "Qty PO"
                                (rencana MRP, targetSizesForGroup) vs "Hasil Cutting" (aktual,
                                cuttingSizesForGroup) -- dulu disamakan/di-label seolah 1 angka yang
                                sama, padahal keduanya legitim beda begitu hasil cutting sudah diisi. */}
                            <div className="grid grid-cols-8 gap-2 font-sans text-[10px] font-medium uppercase tracking-wider text-text-muted">
                              <span>Warna / lengan</span>
                              <span className="text-right">Qty PO</span>
                              <span className="text-right">Hasil Cutting</span>
                              <span className="text-right">Finish good</span>
                              <span className="text-right">Reject</span>
                              <span className="text-right">Rework</span>
                              <span className="text-right">Yield</span>
                              <span />
                            </div>
                            {/* BUG FIX (2026-09-10, owner-reported): productionYieldByWarna cuma difilter
                                mrpId+vendorProduksi -- mengembalikan SEMUA warna/lengan yang punya batch
                                produksi di MRP ini, bukan cuma warna/lengan baris invoice ini (`line`). Tanpa
                                filter ini, warna LAIN yang kebetulan juga sedang cutting di MRP yang sama (mis.
                                belum FG-confirmed sama sekali, belum pernah dikirim/diinvoice) ikut "bocor"
                                muncul di breakdown baris invoice yang sebenarnya cuma untuk 1 warna/lengan. */}
                            {productionYieldByWarna(line.mrpId, vendorId, mrpDetails, productionBatches, productionResults)
                              .filter((r) => r.warna === line.warna && r.lengan === line.lengan)
                              .map((r) => {
                              const warnaKey = mrpKey + "|" + r.warna + "|" + r.lengan;
                              const warnaExpanded = expandedWarnaKey === warnaKey;
                              return (
                                <div key={warnaKey}>
                                  <button
                                    onClick={() => setExpandedWarnaKey(warnaExpanded ? "" : warnaKey)}
                                    className="grid w-full grid-cols-8 items-center gap-2 border-t border-[#F1F4F7] py-1.5 text-left font-sans text-[11px] text-[#31414F]"
                                  >
                                    <span>
                                      {r.warna} · {r.lengan}
                                    </span>
                                    <span className="text-right font-mono">{r.target}</span>
                                    <span className="text-right font-mono">{r.cutting}</span>
                                    <span className="text-right font-mono">{r.finishGood}</span>
                                    <span className="text-right font-mono text-danger-fg">{r.reject}</span>
                                    <span className="text-right font-mono text-rework-fg">{r.rework}</span>
                                    <span className="text-right font-mono">{r.yieldPct.toFixed(1)}%</span>
                                    <span className="text-right font-semibold text-action-primary">{warnaExpanded ? "Sembunyikan" : "By size →"}</span>
                                  </button>
                                  {warnaExpanded && (
                                    <div className="ml-3 border-l border-[#DDE4EB] pl-3">
                                      <div className="grid grid-cols-7 gap-2 font-sans text-[10px] font-medium uppercase tracking-wider text-text-muted">
                                        <span>Size</span>
                                        <span className="text-right">Qty PO</span>
                                        <span className="text-right">Hasil Cutting</span>
                                        <span className="text-right">Finish good</span>
                                        <span className="text-right">Reject</span>
                                        <span className="text-right">Rework</span>
                                        <span className="text-right">Yield</span>
                                      </div>
                                      {productionYieldBySize(line.mrpId, r.warna, r.lengan as Lengan, mrpDetails, productionBatches, productionResults).map((s) => (
                                        <div key={s.size} className="grid grid-cols-7 items-center gap-2 border-t border-[#F1F4F7] py-1 font-mono text-[11px] text-[#31414F]">
                                          <span>{s.size}</span>
                                          <span className="text-right">{s.target}</span>
                                          <span className="text-right">{s.cutting}</span>
                                          <span className="text-right">{s.finishGood}</span>
                                          <span className="text-right text-danger-fg">{s.reject}</span>
                                          <span className="text-right text-rework-fg">{s.rework}</span>
                                          <span className="text-right">{s.yieldPct.toFixed(1)}%</span>
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
          </div>
        </div>
      </div>

      {/* Dialog "Submit Invoice" -- qty & rate read-only (dihitung ulang server-side juga, lihat
          submitResiGroupInvoiceAction), rate terkunci ke tier Standar/PKS Harga Maklon dari
          kapasitas kumulatif vendor. */}
      {invoiceDialogKoliIds && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-[#0B131B]/45 p-4">
          <div className="w-full max-w-[640px] rounded-lg bg-white shadow-[0_8px_24px_rgba(11,19,27,.2)]">
            <div className="border-b border-border-subtle px-5 py-3.5">
              <span className="font-sans text-[13px] font-semibold text-text-primary">Submit Invoice — {invoiceDialogKoliIds.length} koli</span>
            </div>
            <div className="px-5 py-4">
              <div className="overflow-hidden rounded-md border border-[#E4E9EE]">
                <div className="grid grid-cols-[1.1fr_1fr_0.9fr_70px_130px] gap-x-2 bg-[#F2F5F8] px-3 py-1.5 font-sans text-[10px] font-semibold uppercase tracking-wider text-text-muted">
                  <span>MRP</span>
                  <span>Warna</span>
                  <span>Lengan</span>
                  <span className="text-right">Qty</span>
                  <span className="text-right">Rate/pc</span>
                </div>
                {invoiceDialogLines.map((l) => {
                  const key = invoiceLineKeyLocal(l.mrpId, l.warna, l.lengan, l.usia);
                  return (
                    <div key={key} className="grid grid-cols-[1.1fr_1fr_0.9fr_70px_130px] items-center gap-x-2 border-t border-[#EEF1F4] px-3 py-1.5 font-sans text-[11.5px] text-[#31414F]">
                      <span className="font-mono">{l.mrpId}</span>
                      <span>
                        {l.warna}
                        {l.usia ? ` (${l.usia})` : ""}
                      </span>
                      <span>{l.lengan}</span>
                      <span className="text-right font-mono">{l.qty} pcs</span>
                      <span className="text-right font-mono">{formatRupiah(rateForLine(l))}</span>
                    </div>
                  );
                })}
                <div className="grid grid-cols-[1.1fr_1fr_0.9fr_70px_130px] gap-x-2 border-t border-[#EEF1F4] bg-[#F7F9FB] px-3 py-1.5 font-sans text-[11.5px] font-semibold text-[#31414F]">
                  <span className="col-span-3">Total invoice</span>
                  <span className="col-span-2 text-right font-mono">{formatRupiah(invoiceDialogTotal)}</span>
                </div>
              </div>
              {invoiceError && <div className="mt-2 font-sans text-[10.5px] text-danger-fg">{invoiceError}</div>}
            </div>
            <div className="flex justify-end gap-2 border-t border-border-subtle px-5 py-3.5">
              <button onClick={closeInvoiceDialog} className="rounded-md border border-[#CBD5DF] bg-white px-3.5 py-[7px] font-sans text-xs font-semibold text-action-primary">
                Batal
              </button>
              <Button onClick={submitInvoiceConfirm} disabled={invoiceSubmitting} variant="primary" size="sm">
                Submit Invoice
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
