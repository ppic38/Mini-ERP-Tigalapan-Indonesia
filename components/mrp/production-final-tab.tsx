"use client";

import { useState } from "react";
import type { Lengan } from "@/lib/mrp/types";
import { StatusPill } from "@/components/ui/status-pill";
import { DataTable, type ColumnDef } from "@/components/mrp/data-table";
import { CloseProductionPoModal } from "@/components/mrp/close-production-po-modal";
import { useMrpStore } from "@/lib/mrp/store";
import { usePendingActions } from "@/lib/mrp/usePendingActions";
import {
  cumulativeSizeQtyForGroup,
  cuttingSizesForGroup,
  fgMurniAndReworkForGroup,
  groupCloseSummary,
  groupCloseWarningLines,
  mrpPlannedGroupsForVendor,
  openMaterialClaimsForGroup,
  productionGroupMetaFor,
  reworkBySizeForGroup,
  reworkedAwayBySize,
  reworkQtyForGroup,
  warnaLenganGroupsWithFg,
} from "@/lib/mrp/derive";
import { countProductionFinalReadyForMrp, pendingMarker } from "@/lib/shell/badges";

/** Halaman rekap akhir (satu tempat) sebelum Pengiriman -- gabungan Finish Good + Reject +
 *  Rework per warna/lengan, dengan tombol "Selesai Produksi" TAHAP 2 (final) di sini -- butuh
 *  TAHAP 1 (tombol "Selesai Produksi" di tab Finish Good, yang menghitung reject) sudah dilakukan
 *  duluan. Dua tahap terpisah supaya reject yang baru dihitung di Finish Good masih sempat
 *  dirework sebelum benar-benar final di sini (lihat catatan lengkap di lib/mrp/actions.ts:
 *  confirmFgDoneAction vs markProductionGroupDoneAction). Item 22: TAHAP 2 di sini BUKAN LAGI gate
 *  Pengiriman -- FG sudah shippable sejak TAHAP 1 (lihat banner di bawah). Item 21: "Close PO"
 *  (header, per MRP/PO Produksi terpilih) mengunci SEMUA warna/lengan sekaligus & memblokir
 *  Pengiriman untuk sisa FG yang belum masuk koli. */
type FinalStatus = "Belum ada Finish Good" | "Berjalan" | "Menunggu Final" | "Final";

type FinalRow = {
  key: string;
  groupKey: string;
  warna: string;
  lengan: Lengan;
  plannedPcs: number;
  totalTarget: number;
  totalFg: number;
  selisih: number;
  progressPct: number;
  rework: number;
  reject: number;
  isFgConfirmed: boolean;
  isDone: boolean;
  openRollCount: number;
  status: FinalStatus;
  openClaims: ReturnType<typeof openMaterialClaimsForGroup>;
  closeSummary: ReturnType<typeof groupCloseSummary>;
  sizes: string[];
  target: Record<string, number>;
  fgRecorded: Record<string, number>;
  reworkPerSize: Record<string, number>;
  currentRejectPerSize: Record<string, number>;
  fgFromReworkPerSize: Record<string, number>;
};

const STATUS_TONE: Record<FinalStatus, "success" | "info" | "warning" | "neutral"> = {
  Final: "success",
  "Menunggu Final": "info",
  Berjalan: "warning",
  "Belum ada Finish Good": "neutral",
};

export function ProductionFinalTab({ vendorId }: { vendorId: string }) {
  const mrpDetails = useMrpStore((s) => s.mrpDetails);
  const productionBatches = useMrpStore((s) => s.productionBatches);
  const productionResults = useMrpStore((s) => s.productionResults);
  const productionGroupMeta = useMrpStore((s) => s.productionGroupMeta);
  const maklonPOs = useMrpStore((s) => s.maklonPOs);
  const rawInvoices = useMrpStore((s) => s.invoices);
  const materialClaimResolutions = useMrpStore((s) => s.materialClaimResolutions);
  const materialClaimReturRequests = useMrpStore((s) => s.materialClaimReturRequests);
  const materialClaimReturDeliveries = useMrpStore((s) => s.materialClaimReturDeliveries);
  const materialClaimReturReceipts = useMrpStore((s) => s.materialClaimReturReceipts);
  const materialClaimReplacements = useMrpStore((s) => s.materialClaimReplacements);
  const materialClaimAcceptances = useMrpStore((s) => s.materialClaimAcceptances);
  const markProductionGroupDone = useMrpStore((s) => s.markProductionGroupDone);
  const undoProductionGroupDone = useMrpStore((s) => s.undoProductionGroupDone);
  const closeProductionPo = useMrpStore((s) => s.closeProductionPo);
  const reopenProductionPo = useMrpStore((s) => s.reopenProductionPo);

  const [selectedMrpId, setSelectedMrpId] = useState("");
  const [closePoOpen, setClosePoOpen] = useState(false);
  // Bug fix (2026-09-06): tombol2 di bawah dulu fire-and-forget tanpa .catch -- kalau server
  // menolak, error-nya cuma jadi unhandled rejection di console, tidak pernah terlihat user (lihat
  // catatan lebih lengkap di production-result-panel.tsx, gejala yang sama persis di tab ini).
  const [actionError, setActionError] = useState<string | null>(null);
  // Item revisi 2026-09-07: sama seperti production-result-panel.tsx -- runAction sekarang pakai
  // usePendingActions supaya tombol yang memicunya bisa di-disable + tampil "…" selama request
  // masih berjalan (per-key, bukan 1 flag global).
  const { isPending, run: runKeyed } = usePendingActions();
  function runAction(key: string, promise: Promise<unknown>) {
    setActionError(null);
    runKeyed(key, promise, setActionError);
  }

  const mrpIds = Array.from(new Set(productionBatches.filter((b) => b.vendorProduksi === vendorId && b.cuttingAt).map((b) => b.mrpId)));
  // warnaLenganGroupsWithFg (bukan cutWarnaLenganGroups) -- ikutkan grup TUJUAN rework lintas
  // lengan yang tidak pernah dicutting sendiri (lihat catatan di lib/mrp/derive.ts), supaya
  // grup itu tetap bisa di-"Selesai Produksi"-kan & masuk Pengiriman.
  // Revisi 2026-09-19 (owner: "list warna ini berdasarkan qty MRP, bukan berdasarkan Finish Good yang
  // diinput"): daftar baris SEKARANG diambil dari rencana MRP vendor ini (aduanRows) -- warna yang
  // bahannya belum diterima / belum sempat dicutting tetap tampil (FG 0) dan tidak "hilang" dari
  // rekap. Grup yang cuma ada dari cutting/FG (mis. tujuan rework lintas lengan, tidak ada di rencana
  // MRP) tetap ditambahkan di bawahnya.
  const plannedGroups = selectedMrpId ? mrpPlannedGroupsForVendor(selectedMrpId, vendorId, mrpDetails) : [];
  const groups = (() => {
    if (!selectedMrpId) return [];
    const out = plannedGroups.map((g) => ({ warna: g.warna, lengan: g.lengan }));
    for (const g of warnaLenganGroupsWithFg(selectedMrpId, vendorId, productionBatches, productionResults)) {
      if (!out.some((o) => o.warna === g.warna && o.lengan === g.lengan)) out.push(g);
    }
    return out;
  })();
  const selectedMaklonPo = selectedMrpId ? maklonPOs.find((p) => p.mrpId === selectedMrpId && p.vendorProduksi === vendorId) : undefined;
  const isPoClosed = !!selectedMaklonPo?.closedAt;

  return (
    <>
      <div className="rounded-lg border border-border-subtle bg-surface-card px-4 py-3.5">
        <div className="flex items-center gap-3">
          <div className="flex-1">
            <div className="font-sans text-[11px] font-medium uppercase tracking-wider text-text-muted">Pilih MRP (sudah tercutting)</div>
            <select
              value={selectedMrpId}
              onChange={(e) => setSelectedMrpId(e.target.value)}
              className="mt-1 w-full max-w-[420px] rounded-md border border-[#DDE4EB] px-[11px] py-[9px] font-sans text-[12.5px] font-medium text-text-primary"
            >
              <option value="">— pilih MRP —</option>
              {mrpIds.map((id) => (
                <option key={id} value={id}>
                  {id}
                  {pendingMarker(countProductionFinalReadyForMrp(id, vendorId, productionBatches, productionResults, productionGroupMeta, mrpDetails), "warna/lengan belum final")}
                </option>
              ))}
            </select>
          </div>
          {selectedMaklonPo &&
            (isPoClosed ? (
              <span className="flex flex-none items-center gap-2">
                <span title={selectedMaklonPo.closeReason}>
                  <StatusPill tone="locked">PO DITUTUP</StatusPill>
                </span>
                <button
                  // reopenProductionPo sudah optimistic penuh di store.ts -- tidak perlu lagi
                  // isPending/teks "Membuka…" (dulu redundant, tetap sempat kelihatan sesaat
                  // walau state lokal sudah berubah seketika).
                  onClick={() => runAction(selectedMaklonPo.id, reopenProductionPo(selectedMaklonPo.id))}
                  title="Buka kembali gerbang Pengiriman untuk PO ini -- grup warna/lengan yang sudah terlanjur dikunci Close PO tetap terkunci (buka satu-satu lewat 'Buka kunci ↺' kalau perlu diperbaiki)"
                  className="rounded-md border border-[#CBD5DF] bg-white px-3 py-[9px] font-sans text-[11.5px] font-semibold text-action-primary"
                >
                  Buka kembali PO
                </button>
              </span>
            ) : (
              <button
                onClick={() => setClosePoOpen(true)}
                disabled={isPending(selectedMaklonPo.id)}
                className="flex-none rounded-md border border-danger px-3 py-[9px] font-sans text-[11.5px] font-semibold text-danger-fg disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isPending(selectedMaklonPo.id) ? "Menutup…" : "Close PO"}
              </button>
            ))}
        </div>
        {mrpIds.length === 0 && <div className="mt-2 font-sans text-xs text-text-muted">Belum ada MRP yang sudah dicutting.</div>}
        {actionError && (
          <div className="mt-2.5 flex items-start justify-between gap-3 rounded-md border border-danger bg-danger-bg px-3 py-2 font-sans text-[11.5px] leading-[1.5] text-danger-fg">
            <span>{actionError}</span>
            <button onClick={() => setActionError(null)} className="flex-none font-semibold underline">
              Tutup
            </button>
          </div>
        )}
        <div className="mt-2.5 rounded-md border border-[#CFE0EF] bg-info-bg px-3 py-2 font-sans text-[11px] leading-[1.5] text-info-fg">
          Rekap Finish Good + Reject + Rework per warna/lengan. Roll yang sudah diselesaikan di tab <b>Finish Good</b> langsung bisa dikirim &amp; rejectnya
          bisa dirework, sambil roll lain tetap bisa dikerjakan. Halaman ini untuk konfirmasi TERAKHIR vendor ke ERP: semua bahan warna itu sudah
          diterima &amp; diproduksi, Finish Good, rework, dan reject sudah final (mengunci warna, dasar status tepat waktu/telat) — hanya bisa kalau tidak ada
          roll yang belum selesai. Pakai <b>Close PO</b> kalau PO Produksi ini mau ditutup lebih awal (sisa Finish Good yang belum masuk koli jadi tidak
          bisa dikirim lagi).
        </div>
      </div>

      {closePoOpen && selectedMaklonPo && (
        <CloseProductionPoModal
          maklonPoId={selectedMaklonPo.id}
          onNo={() => setClosePoOpen(false)}
          onYes={(reason) => {
            runAction(selectedMaklonPo.id, closeProductionPo(selectedMaklonPo.id, reason));
            setClosePoOpen(false);
          }}
        />
      )}

      {selectedMrpId &&
        (() => {
          // Revisi 2026-09-20 (owner: "berantakan, tidak presisi, tidak berurutan, tidak ada filter"): daftar warna/lengan
          // dijadikan tabel terstruktur (DataTable yang sama dengan halaman lain) -- kolom rata, urut Pendek dulu baru
          // Panjang lalu nama warna, dengan pencarian warna + filter Lengan & Status, dan rincian by size di baris yang dibuka.
          const rows: FinalRow[] = groups.map((g) => {
            const groupKey = selectedMrpId + "|" + g.warna + "|" + g.lengan;
            const target = cuttingSizesForGroup(selectedMrpId, g.warna, g.lengan, mrpDetails, productionBatches);
            const fgRecorded = cumulativeSizeQtyForGroup(groupKey, "FG", productionResults);
            const totalTarget = Object.values(target).reduce((x, y) => x + y, 0);
            const totalFg = Object.values(fgRecorded).reduce((x, y) => x + y, 0);
            const meta = productionGroupMetaFor(groupKey, productionGroupMeta);
            const isFgConfirmed = !!meta?.fgConfirmedAt;
            const isDone = !!meta?.doneAt;
            // Final = konfirmasi terakhir: tidak bisa kalau masih ada roll yang belum ditutup.
            const openRollCount = productionBatches.filter(
              (b2) => b2.mrpId === selectedMrpId && b2.vendorProduksi === vendorId && b2.warna === g.warna && b2.lengan === g.lengan && !b2.closedAt
            ).length;
            const status: FinalStatus = isDone ? "Final" : isFgConfirmed && openRollCount === 0 ? "Menunggu Final" : totalFg > 0 || isFgConfirmed ? "Berjalan" : "Belum ada Finish Good";
            return {
              key: groupKey,
              groupKey,
              warna: g.warna,
              lengan: g.lengan,
              plannedPcs: plannedGroups.find((x) => x.warna === g.warna && x.lengan === g.lengan)?.plannedPcs ?? 0,
              totalTarget,
              totalFg,
              selisih: totalFg - totalTarget,
              progressPct: totalTarget > 0 ? Math.min(100, Math.round((totalFg / totalTarget) * 100)) : 0,
              rework: reworkQtyForGroup(groupKey, productionResults),
              reject: Object.values(cumulativeSizeQtyForGroup(groupKey, "REJECT", productionResults)).reduce((x, y) => x + y, 0),
              isFgConfirmed,
              isDone,
              openRollCount,
              status,
              // BUG FIX (2026-09-12): jangan buru-buru mengunci Final selama klaim material warna ini belum selesai
              // (roll pengganti bisa masih dalam perjalanan) -- warning, bukan hard-block.
              openClaims: openMaterialClaimsForGroup(
                selectedMrpId,
                vendorId,
                g.warna,
                g.lengan,
                rawInvoices,
                materialClaimResolutions,
                materialClaimReturRequests,
                materialClaimReturDeliveries,
                materialClaimReturReceipts,
                materialClaimReplacements,
                materialClaimAcceptances
              ),
              closeSummary: groupCloseSummary(selectedMrpId, vendorId, g.warna, g.lengan, mrpDetails, rawInvoices, productionBatches, productionResults),
              sizes: Array.from(new Set([...Object.keys(target), ...Object.keys(fgRecorded)])),
              target,
              fgRecorded,
              reworkPerSize: reworkedAwayBySize(groupKey, productionResults),
              currentRejectPerSize: cumulativeSizeQtyForGroup(groupKey, "REJECT", productionResults),
              fgFromReworkPerSize: reworkBySizeForGroup(groupKey, productionResults),
            };
          });
          // Urut per warna (A-Z), di dalam tiap warna Pendek dulu baru Panjang -- sama dengan tab Finish Good/Reject/Rework.
          rows.sort((x, y) => x.warna.localeCompare(y.warna, "id-ID") || (x.lengan === y.lengan ? 0 : x.lengan === "PENDEK" ? -1 : 1));

          function finalize(r: FinalRow) {
            const warnings = groupCloseWarningLines(`${r.warna} · ${r.lengan}`, r.closeSummary);
            if (r.openClaims.length > 0) warnings.push(`• ${r.openClaims.length} klaim material belum selesai (roll pengganti bisa jadi masih dalam proses)`);
            if (
              warnings.length > 0 &&
              !window.confirm(
                "PERHATIAN sebelum menutup warna ini:\n\n" +
                  warnings.join("\n") +
                  '\n\nSetelah "Selesai Produksi", roll BARU untuk warna/lengan ini tidak bisa di-cutting lagi kecuali dibuka kunci dulu. Tetap lanjutkan?'
              )
            ) {
              return;
            }
            runAction(r.groupKey, markProductionGroupDone(r.groupKey, selectedMrpId, vendorId, r.warna, r.lengan));
          }

          const num = (n: number, cls = "") => <span className={"font-mono " + cls}>{n}</span>;
          const columns: ColumnDef<FinalRow>[] = [
            { key: "plan", label: "Rencana MRP (pcs)", default: true, align: "right", render: (r) => (r.plannedPcs > 0 ? num(r.plannedPcs) : <span className="text-text-muted">—</span>) },
            { key: "fg", label: "Finish Good / Hasil cutting", default: true, align: "right", render: (r) => (
              <span className="font-mono">
                <span className="font-semibold">{r.totalFg}</span> <span className="text-text-muted">/ {r.totalTarget}</span>
              </span>
            ) },
            {
              key: "progres",
              label: "Progres",
              default: true,
              render: (r) => (
                <span className="flex min-w-[130px] items-center gap-2">
                  <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-[#EEF0F3]">
                    <span className="block h-full rounded-full bg-success" style={{ width: `${r.progressPct}%` }} />
                  </span>
                  <span className="w-9 font-mono text-[10.5px] text-text-muted">{r.progressPct}%</span>
                </span>
              ),
            },
            { key: "selisih", label: "Selisih", default: true, align: "right", render: (r) => num(r.selisih, r.selisih < 0 ? "font-semibold text-danger-fg" : "text-text-muted") },
            { key: "rework", label: "Rework", default: true, align: "right", render: (r) => num(r.rework, r.rework > 0 ? "font-semibold text-success-fg" : "text-text-muted") },
            { key: "reject", label: "Reject", default: true, align: "right", render: (r) => num(r.reject, r.reject > 0 ? "font-semibold text-danger-fg" : "text-text-muted") },
            { key: "status", label: "Status", default: true, render: (r) => <StatusPill tone={STATUS_TONE[r.status]}>{r.status}</StatusPill> },
            {
              key: "aksi",
              label: "Aksi",
              default: true,
              align: "right",
              render: (r) => (
                // stopPropagation: klik tombol tidak ikut membuka/menutup rincian baris.
                <span className="flex flex-col items-end gap-1" onClick={(e) => e.stopPropagation()}>
                  {isPoClosed ? null : r.isDone ? (
                    <button
                      onClick={() => runAction(r.groupKey, undoProductionGroupDone(r.groupKey))}
                      title="Buka kunci grup ini supaya Finish Good/Reject/Rework bisa dibuka lagi (mulai dari tab Finish Good)"
                      className="rounded-md border border-[#CBD5DF] bg-white px-3 py-[6px] font-sans text-[11px] font-semibold text-action-primary"
                    >
                      Buka kunci ↺
                    </button>
                  ) : r.isFgConfirmed && r.openRollCount > 0 ? (
                    <span className="max-w-[210px] text-right font-sans text-[10.5px] leading-[1.4] text-text-muted">Masih {r.openRollCount} roll belum selesai — selesaikan di tab Finish Good</span>
                  ) : r.isFgConfirmed ? (
                    <button
                      onClick={() => finalize(r)}
                      title={r.openClaims.length > 0 || r.closeSummary.hasWarning ? "Ada hal yang belum tuntas untuk grup ini -- akan diminta konfirmasi dulu" : undefined}
                      className="rounded-md bg-action-primary px-3 py-[6px] font-sans text-[11px] font-semibold text-white"
                    >
                      {r.openClaims.length > 0 ? `Selesai Produksi ⚠ ${r.openClaims.length} klaim aktif` : "Selesai Produksi"}
                    </button>
                  ) : (
                    <span className="max-w-[210px] text-right font-sans text-[10.5px] leading-[1.4] text-text-muted">Selesaikan dulu Finish Good (tab Finish Good)</span>
                  )}
                </span>
              ),
            },
          ];

          return (
            <DataTable
              title={`Final Produksi — ${selectedMrpId}`}
              columns={columns}
              rows={rows}
              keyOf={(r) => r.key}
              firstColumnLabel="Warna / Lengan"
              firstColumnRender={(r) => (
                <span className="font-medium">
                  {r.warna} <span className="font-normal text-text-muted">· {r.lengan}</span>
                </span>
              )}
              search={{ placeholder: "Cari warna…", getText: (r) => r.warna }}
              filterDefs={[
                { label: "Lengan", options: ["PENDEK", "PANJANG"], test: (r, v) => r.lengan === v },
                { label: "Status", options: ["Belum ada Finish Good", "Berjalan", "Menunggu Final", "Final"], test: (r, v) => r.status === v },
              ]}
              emptyText={groups.length === 0 ? "Belum ada warna pada rencana MRP ini." : "Tidak ada warna yang cocok dengan filter."}
              renderExpanded={(r) => (
                <div className="overflow-x-auto">
                  <div className="min-w-[760px] overflow-hidden rounded-md border border-[#CFE0EF] bg-white">
                    <div className="grid grid-cols-7 gap-x-2 bg-[#F7F9FB] px-3 py-1.5 font-sans text-[10px] font-medium uppercase tracking-wider text-text-muted">
                      <span>Size</span>
                      <span className="text-right">FG Target</span>
                      <span className="text-right">FG Terinput</span>
                      <span className="text-right">FG dari Rework</span>
                      <span className="text-right">FG Selisih</span>
                      <span className="text-right">Rework</span>
                      <span className="text-right">Reject</span>
                    </div>
                    {r.sizes.length === 0 && <div className="px-3 py-3 text-center font-sans text-[11px] text-text-muted">Belum ada size tercatat.</div>}
                    {r.sizes.map((size) => {
                      const t = r.target[size] ?? 0;
                      const f = r.fgRecorded[size] ?? 0;
                      const sel = f - t;
                      return (
                        <div key={size} className="grid grid-cols-7 items-center gap-x-2 border-t border-[#F1F4F7] px-3 py-1.5 font-sans text-xs text-[#31414F]">
                          <span className="font-mono font-medium">{size}</span>
                          <span className="text-right font-mono">{t}</span>
                          <span className="text-right font-mono text-text-muted">{f}</span>
                          <span className="text-right font-mono text-success-fg">{r.fgFromReworkPerSize[size] ?? 0}</span>
                          <span className={"text-right font-mono font-semibold " + (sel < 0 ? "text-danger-fg" : "text-success-fg")}>
                            {sel >= 0 ? "+" : ""}
                            {sel}
                          </span>
                          <span className="text-right font-mono text-success-fg">{r.reworkPerSize[size] ?? 0}</span>
                          <span className="text-right font-mono text-danger-fg">{r.currentRejectPerSize[size] ?? 0}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            />
          );
        })()}
    </>
  );
}
