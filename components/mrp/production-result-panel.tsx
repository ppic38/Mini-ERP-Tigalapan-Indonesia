"use client";

import { useState } from "react";
import { NumberInput } from "@/components/mrp/number-input";
import { StatusPill } from "@/components/ui/status-pill";
import { ProgressBar } from "@/components/ui/progress-bar";
import { Button } from "@/components/ui/button";
import { SizeQtyControl } from "@/components/mrp/size-qty-control";
import { useMrpStore } from "@/lib/mrp/store";
import { usePendingActions } from "@/lib/mrp/usePendingActions";
import {
  cumulativeSizeQtyForGroup,
  expectedRejectGrossForGroup,
  fgMurniAndReworkForGroup,
  groupCloseSummary,
  groupCloseWarningLines,
  formatDate,
  formatDateTimeShort,
  productionGroupMetaFor,
  rejectGrossForGroup,
  reworkBySizeForGroup,
  reworkedAwayBySize,
  reworkQtyForGroup,
  targetDoneProduksiForGroup,
  cuttingSizesForGroup,
  warnaLenganGroupsWithFg,
} from "@/lib/mrp/derive";
import { countFgShortfallGroupsForMrp, countRejectActionableGroupsForMrp, pendingMarker } from "@/lib/shell/badges";
import type { Lengan, ProductionResult } from "@/lib/mrp/types";

// FG: Warna/lengan | Progres (target+terinput+bar digabung jadi satu kolom, bukan 3 kolom
// sempit terpisah — jauh lebih mudah dipindai sekilas) | Target done produksi | Aksi.
// Tombol "Selesai Produksi" DI SINI (tab Finish Good) = TAHAP 1 dari 2 -- hitung reject &
// kunci input FG, tapi BELUM mengunci Rework/Waste (itu tahap 2, tab Final Produksi, lihat
// production-final-tab.tsx). Dua tahap terpisah supaya reject yang baru dihitung masih sempat
// dirework sebelum benar-benar final.
const FG_COLUMNS = "minmax(170px,1.2fr) minmax(300px,2.2fr) minmax(130px,0.9fr) minmax(170px,1fr)";
// REJECT: tiap angka (target/awal/sisa) tetap bermakna terpisah, jadi tetap kolom angka
// masing-masing. Kolom "Sisa/Waste" DIHAPUS (item 19 -- "Buang ke Sisa" dihapus dari flow).
const REJECT_COLUMNS = "minmax(170px,1.3fr) minmax(130px,0.9fr) minmax(110px,0.7fr) minmax(110px,0.7fr) minmax(130px,0.9fr)";

/** Riwayat tiap submission Finish Good untuk 1 grup warna/lengan — diminta supaya progres
 *  pengerjaan bisa dilihat per-hari/jam (co: "Senin 60, Selasa 60"), bukan cuma total kumulatif.
 *  `recordedAt` (tanggal + jam) SELALU dari jam sistem saat submit (lihat nowIso() di
 *  lib/mrp/store.ts) — tidak ada field tanggal/jam yang bisa diisi manual di form manapun, jadi
 *  tidak mungkin backdate. Diurutkan kronologis (lama → baru) supaya kebaca sebagai timeline. */
function FgProgressHistory({ poId, results }: { poId: string; results: ProductionResult[] }) {
  // Di-scope per PO Produksi -- 1 PO bisa punya beberapa warna, jadi riwayat dikelompokkan per warna/lengan
  // (revisi 2026-09-22, owner): urut warna A-Z, di dalam warna Pendek dulu baru Panjang, tiap grup punya
  // judul + total qty, dan di dalam grup entri tetap kronologis. Tanggal & jam ada di paling kanan.
  // Revisi 2026-09-22: grup tertutup secara default (list warna saja); klik baris warna untuk membuka riwayatnya.
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());
  const entries = results.filter((r) => r.poId === poId && r.kind === "FG").sort((a, b) => (a.recordedAt < b.recordedAt ? -1 : 1));
  if (entries.length === 0) return null;
  const groups = new Map<string, { warna: string; lengan: string; items: ProductionResult[] }>();
  for (const r of entries) {
    const key = r.warna + "|" + r.lengan;
    if (!groups.has(key)) groups.set(key, { warna: r.warna, lengan: r.lengan, items: [] });
    groups.get(key)!.items.push(r);
  }
  const orderedGroups = Array.from(groups.values()).sort(
    (x, y) => x.warna.localeCompare(y.warna) || (x.lengan === y.lengan ? 0 : x.lengan === "PENDEK" ? -1 : 1)
  );
  return (
    <div className="flex flex-col gap-1.5">
      {orderedGroups.map((g) => {
        const groupKeyStr = g.warna + "|" + g.lengan;
        const isOpen = openGroups.has(groupKeyStr);
        const groupTotal = g.items.reduce((sum, r) => sum + Object.values(r.sizeQty).reduce((a, b) => a + b, 0), 0);
        return (
          <div key={g.warna + "|" + g.lengan} className="overflow-hidden rounded-md border border-[#E4E9EE] bg-white">
            <button
              type="button"
              onClick={() =>
                setOpenGroups((prev) => {
                  const next = new Set(prev);
                  if (next.has(groupKeyStr)) next.delete(groupKeyStr);
                  else next.add(groupKeyStr);
                  return next;
                })
              }
              className={"flex w-full items-center justify-between gap-2 bg-[#F2F5F8] px-3 py-2 text-left font-sans text-[11.5px] hover:bg-[#EAEFF4] " + (isOpen ? "border-b border-[#E4E9EE]" : "")}
            >
              <span className="font-semibold text-text-primary">
                <span className="mr-1.5 text-text-muted">{isOpen ? "▾" : "▸"}</span>
                {g.warna} · {g.lengan}
              </span>
              <span className="font-mono font-semibold text-[#31414F]">
                {groupTotal > 0 ? "+" : ""}
                {groupTotal} pcs
                <span className="ml-1.5 font-sans text-[10px] font-normal text-text-muted">({g.items.length} catatan)</span>
              </span>
            </button>
            {isOpen && g.items.map((r) => {
              const qty = Object.values(r.sizeQty).reduce((a, b) => a + b, 0);
              // Rincian size mana saja yang ke-input di submission ini -- 1 klik "Simpan hasil produksi" bisa sekaligus
              // isi beberapa size, jadi total qty saja tidak cukup untuk tahu size apa yang benar-benar dikerjakan.
              const sizeBreakdown = Object.entries(r.sizeQty)
                .filter(([, q]) => q !== 0)
                .map(([size, q]) => `${size} ${q > 0 ? "+" : ""}${q}`)
                .join(", ");
              return (
                <div key={r.id} className="flex items-center gap-3 border-b border-[#F1F4F7] px-3 py-1.5 font-sans text-[11.5px] text-[#31414F] last:border-b-0">
                  <span className="min-w-0 flex-1 text-[11px] text-text-muted">{r.note ?? "—"}</span>
                  <span className="flex flex-none flex-col items-end">
                    <span className={"font-mono font-semibold " + (qty < 0 ? "text-danger-fg" : "text-success-fg")}>
                      {qty > 0 ? "+" : ""}
                      {qty} pcs
                    </span>
                    <span className="font-mono text-[10px] text-text-muted">{sizeBreakdown}</span>
                  </span>
                  <span className="w-[150px] flex-none whitespace-nowrap text-right font-mono text-[11px] text-text-muted">{formatDateTimeShort(r.recordedAt)}</span>
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

export function ProductionResultPanel({ vendorId, kind, title }: { vendorId: string; kind: "FG" | "REJECT"; title: string }) {
  const mrpDetails = useMrpStore((s) => s.mrpDetails);
  const productionBatches = useMrpStore((s) => s.productionBatches);
  const productionResults = useMrpStore((s) => s.productionResults);
  const productionGroupMeta = useMrpStore((s) => s.productionGroupMeta);
  const rawInvoices = useMrpStore((s) => s.invoices);
  const rejectRemarks = useMrpStore((s) => s.rejectRemarks);
  const setRejectRemark = useMrpStore((s) => s.setRejectRemark);
  const confirmFgDone = useMrpStore((s) => s.confirmFgDone);
  const undoFgConfirm = useMrpStore((s) => s.undoFgConfirm);
  // Revisi 2026-09-07 (HPP per roll) -- "Tutup Roll" per ProductionBatch (roll), lihat
  // closeProductionBatchAction. Menggantikan input size bebas per grup untuk kind="FG".
  const closeProductionBatch = useMrpStore((s) => s.closeProductionBatch);
  const reopenProductionBatch = useMrpStore((s) => s.reopenProductionBatch);
  const editRollFg = useMrpStore((s) => s.editRollFg);
  // Modal "Edit FG" per roll (koreksi Finish Good aktual, naik/turun).
  const [editFgBatchId, setEditFgBatchId] = useState<string | null>(null);
  const [editFgDraft, setEditFgDraft] = useState<Record<string, number>>({});
  // Revisi 2026-09-08 -- "Simpan progres" (belum menutup roll), lihat saveFgProgressAction.
  const saveFgProgress = useMrpStore((s) => s.saveFgProgress);

  const [selectedMrpId, setSelectedMrpId] = useState("");
  const [expandedGroupKey, setExpandedGroupKey] = useState("");
  // Item 15 (feedback batch 2026-09-10): input total per size di level grup -- MURNI client-side
  // (draft angka yang mau diisi), disimpan ke roll otomatis (roll pertama dulu, penuh -> ditutup)
  // begitu "Simpan" diklik. Sejak input per-roll dihapus, ini satu-satunya draft input FG yang
  // tersisa di komponen ini -- roll TETAP sumber kebenaran untuk HPP, cuma tidak lagi punya UI
  // draft tersendiri (lihat saveSizeTotals di bawah).
  const [sizeTotalDraft, setSizeTotalDraft] = useState<Record<string, number>>({});
  const [expandedPoId, setExpandedPoId] = useState("");
  // Item 2026-09-12 (user-requested): tabel "Roll" (daftar roll + tombol Tutup Roll) di bawah
  // form "Isi qty per size" default TERSEMBUNYI -- dulu selalu tampil, bikin panel FG kepanjangan
  // & (user-reported) sempat disalahartikan sebagai satu-satunya cara "menyelesaikan" produksi.
  // Cuma 1 grup yang bisa expanded sekaligus (lihat expandedGroupKey), jadi 1 boolean komponen-level
  // sudah cukup -- direset ke false tiap toggleGroup pindah grup (lihat toggleGroup di bawah).
  // Bug fix (2026-09-06): confirmFgDone/undoFgConfirm dulu dipanggil fire-and-forget (tanpa
  // .catch) -- kalau server menolak (mis. baseline hasil cutting dikira kosong, lihat fix di
  // lib/mrp/actions.ts fetchProductionScopeForMrp), promise-nya cuma jadi unhandled rejection di
  // console browser, TIDAK PERNAH terlihat user -- tombol "Selesai Produksi" tampak seperti tidak
  // melakukan apa-apa sama sekali. Sekarang errornya ditangkap & ditampilkan di banner.
  const [actionError, setActionError] = useState<string | null>(null);
  // Item revisi 2026-09-07 (owner: "Tutup Roll" & aksi lain terasa lambat -- tidak ada tanda
  // loading sama sekali sebelum ini): runAction dulu MURNI penangkap error, sekarang pakai
  // usePendingActions supaya tombol yang memicunya bisa di-disable + tampil "…" selama request
  // masih berjalan (per-key, bukan 1 flag global -- banyak roll/grup independen di daftar yang
  // sama tidak saling mengunci). `key` = identitas unik aksi itu (mis. batch id / groupKey).
  const { isPending, run: runKeyed } = usePendingActions();
  function runAction(key: string, promise: Promise<unknown>) {
    setActionError(null);
    runKeyed(key, promise, setActionError);
  }

  const mrpIds = Array.from(new Set(productionBatches.filter((b) => b.vendorProduksi === vendorId && b.cuttingAt).map((b) => b.mrpId)));
  // warnaLenganGroupsWithFg (bukan cutWarnaLenganGroups) -- ikutkan grup TUJUAN rework lintas
  // lengan yang tidak pernah dicutting sendiri (lihat catatan di lib/mrp/derive.ts), supaya FG
  // hasil rework itu punya baris sendiri yang bisa di-"Selesai Produksi"-kan juga.
  const allGroups = selectedMrpId ? warnaLenganGroupsWithFg(selectedMrpId, vendorId, productionBatches, productionResults) : [];
  // Revisi 2026-09-20 (owner): tab Reject hanya menampilkan warna/lengan yang ADA rejectnya (reject kotor > 0, termasuk yang
  // sudah dirework); warna tanpa reject tidak perlu tampil. Tab Finish Good tetap menampilkan semua.
  const groups =
    kind === "REJECT"
      ? allGroups.filter((g) => Object.values(rejectGrossForGroup(selectedMrpId + "|" + g.warna + "|" + g.lengan, productionResults)).some((q) => q > 0))
      : allGroups;
  const gridColumns = kind === "FG" ? FG_COLUMNS : REJECT_COLUMNS;
  // Revisi 2026-09-19 (owner: "Selesai Produksi di paling kanan, level judul tabel"): tombol pindah
  // ke header tabel Finish Good -- menutup SEMUA grup warna/lengan MRP ini yang belum "FG Selesai"
  // sekaligus (action per grup-nya sama persis: confirmFgDone). Kalau ada >1 grup, per-baris masih
  // ada tombol "Selesai" kecil supaya 1 warna bisa diselesaikan lebih dulu.
  // Revisi 2026-09-20 (owner, alur "Selesai per gelombang"): "Selesai" menyelesaikan roll yang SUDAH punya Finish Good
  // (ditutup -> langsung bisa dikirim, rejectnya bisa dirework) TANPA mengunci warna -- roll baru tetap bisa diisi. Sebuah
  // warna/lengan "perlu diselesaikan" kalau: ada roll terbuka yang sudah ada FG-nya; ATAU belum pernah Selesai tapi sudah
  // punya roll tertutup / FG hasil rework; ATAU reject-nya belum sinkron dengan roll yang sudah ditutup.
  function groupNeedsFinish(g: { warna: string; lengan: string }): boolean {
    const gk = selectedMrpId + "|" + g.warna + "|" + g.lengan;
    const meta = productionGroupMetaFor(gk, productionGroupMeta);
    if (meta?.doneAt) return false;
    const gb = productionBatches.filter((b) => b.mrpId === selectedMrpId && b.warna === g.warna && b.lengan === g.lengan && b.cuttingAt);
    const openWithFg = gb.some((b) => !b.closedAt && Object.values(b.fgSizeQty ?? {}).some((q) => q > 0));
    if (openWithFg) return true;
    if (!meta?.fgConfirmedAt) {
      if (gb.some((b) => b.closedAt)) return true;
      if (gb.length === 0) return Object.values(cumulativeSizeQtyForGroup(gk, "FG", productionResults)).some((q) => q > 0);
      return false;
    }
    const expected = expectedRejectGrossForGroup(selectedMrpId, g.warna, g.lengan as Lengan, productionBatches, productionResults);
    const actual = rejectGrossForGroup(gk, productionResults);
    return Array.from(new Set([...Object.keys(expected), ...Object.keys(actual)])).some((sz) => (expected[sz] ?? 0) !== (actual[sz] ?? 0));
  }
  // Revisi 2026-09-19 (bug: "klik Simpan langsung tutup roll, tidak bisa input lagi"): "Selesai
  // Produksi" menutup SEMUA roll yang masih terbuka & selisih target-vs-FG langsung jadi reject --
  // tombolnya sebelumnya bisa terklik tanpa konfirmasi (dekat tombol Simpan). Sekarang selalu tanya dulu.
  // Revisi 2026-09-19 (owner): dialog juga merinci bahan yang belum diterima / belum diproduksi &
  // Finish Good yang masih di bawah qty rencana MRP, per warna/lengan yang akan ditutup.
  function confirmFinish(toClose: { warna: string; lengan: string }[]) {
    const scope = toClose.length > 1 ? `${toClose.length} warna/lengan sekaligus` : `${toClose[0]?.warna} · ${toClose[0]?.lengan}`;
    const detail = toClose.flatMap((g) =>
      groupCloseWarningLines(
        `${g.warna} · ${g.lengan}`,
        groupCloseSummary(selectedMrpId, vendorId, g.warna, g.lengan as Lengan, mrpDetails, rawInvoices, productionBatches, productionResults)
      )
    );
    return window.confirm(
      `Selesaikan Finish Good ${scope}?\n\n` +
        (detail.length > 0 ? `PERHATIAN -- masih ada yang belum tuntas:\n${detail.join("\n")}\n\n` : "") +
        'Roll yang SUDAH punya Finish Good akan DITUTUP dan langsung bisa dikirim; kekurangan qty-nya dihitung sebagai reject (bisa dirework). Roll yang belum diisi tetap terbuka, dan roll baru masih bisa ditambahkan nanti.\n\nKalau hanya ingin menyimpan progres, pilih Batal lalu klik "Simpan →".'
    );
  }

  function toggleGroup(warna: string, lengan: string) {
    const key = selectedMrpId + "|" + warna + "|" + lengan;
    if (expandedGroupKey === key) {
      setExpandedGroupKey("");
    } else {
      setExpandedGroupKey(key);
      setSizeTotalDraft({});
    }
  }

  const myResults = productionResults.filter((r) => r.vendorProduksi === vendorId && r.kind === kind);
  const poIds = Array.from(new Set(myResults.map((r) => r.poId).filter(Boolean)));

  return (
    <>
      <div className="rounded-lg border border-border-subtle bg-surface-card px-4 py-3.5">
        <div className="font-sans text-[11px] font-medium uppercase tracking-wider text-text-muted">Pilih MRP (sudah tercutting)</div>
        <select
          value={selectedMrpId}
          onChange={(e) => {
            setSelectedMrpId(e.target.value);
            setExpandedGroupKey("");
          }}
          className="mt-1 w-full max-w-[420px] rounded-md border border-[#DDE4EB] px-[11px] py-[9px] font-sans text-[12.5px] font-medium text-text-primary"
        >
          <option value="">— pilih MRP —</option>
          {mrpIds.map((id) => {
            // Item 3: unit/predikat beda per kind -- FG pakai countFgShortfallGroupsForMrp
            // ("warna/lengan belum lengkap"), REJECT pakai countRejectActionableGroupsForMrp
            // ("warna/lengan ada sisa reject") -- sama predikat dengan badge tab masing-masing.
            const n =
              kind === "FG"
                ? countFgShortfallGroupsForMrp(id, vendorId, productionBatches, productionResults, productionGroupMeta, mrpDetails)
                : countRejectActionableGroupsForMrp(id, vendorId, productionBatches, productionResults, productionGroupMeta, mrpDetails);
            return (
              <option key={id} value={id}>
                {id}
                {pendingMarker(n, kind === "FG" ? "warna/lengan belum lengkap" : "warna/lengan ada sisa reject")}
              </option>
            );
          })}
        </select>
        {mrpIds.length === 0 && <div className="mt-2 font-sans text-xs text-text-muted">Belum ada MRP yang sudah dicutting.</div>}
      </div>

      {actionError && (
        <div className="flex items-start justify-between gap-3 rounded-lg border border-danger bg-danger-bg px-5 py-3 font-sans text-[11.5px] leading-[1.5] text-danger-fg">
          <span>{actionError}</span>
          <button onClick={() => setActionError(null)} className="flex-none font-semibold underline">
            Tutup
          </button>
        </div>
      )}

      {/* Item 15 (feedback batch 2026-09-10, owner: "Hilangkan teks panjang..."): banner panduan
         2-tahap dihapus -- badge "FG Selesai"/"Final" di tiap baris & tombol aksi sendiri sudah
         cukup jelas menunjukkan tahap mana yang aktif. */}

      {selectedMrpId && (
        <div className="overflow-hidden rounded-lg border border-border-subtle bg-surface-card">
          <div className="flex items-center justify-between gap-3 border-b border-border-subtle px-4 py-3">
            <span className="font-sans text-[13px] font-semibold text-text-primary">
              {title} — {selectedMrpId}
            </span>
          </div>
          <div className="overflow-x-auto">
            <div className="min-w-[820px]">
              <div
                className="grid items-center gap-x-3 border-b-2 border-accent-blue bg-info-bg px-4 py-[9px] font-sans text-[10.5px] font-medium uppercase tracking-wider text-info-fg"
                style={{ gridTemplateColumns: gridColumns }}
              >
                <span>Warna / lengan</span>
                {kind === "REJECT" ? (
                  <>
                    <span className="text-right">Qty reject</span>
                    <span className="text-right">Qty rework</span>
                    <span className="text-right">Qty sisa reject</span>
                  </>
                ) : (
                  <>
                    <span>Progres</span>
                    <span>Target done produksi</span>
                  </>
                )}
                <span className="text-right">Aksi</span>
              </div>
              {groups.length === 0 && (
                <div className="px-4 py-6 text-center font-sans text-xs text-text-muted">
                  {kind === "REJECT" ? "Belum ada reject untuk MRP ini." : "Belum ada warna yang tercutting untuk MRP ini."}
                </div>
              )}
              {groups.map((g) => {
                const groupKey = selectedMrpId + "|" + g.warna + "|" + g.lengan;
                // Total Qty sekarang dari hasil aduan AKTUAL yang diinput vendor per roll di
                // Cutting (cuttingSizesForGroup), bukan lagi murni estimasi rasio dari target MRP —
                // fallback otomatis ke estimasi lama kalau grup ini belum ada batch yang diisi.
                const target = cuttingSizesForGroup(selectedMrpId, g.warna, g.lengan, mrpDetails, productionBatches);
                const recorded = cumulativeSizeQtyForGroup(groupKey, kind, productionResults);
                const totalCuttingTarget = Object.values(target).reduce((a, b) => a + b, 0);
                const totalRecorded = Object.values(recorded).reduce((a, b) => a + b, 0);
                const totalFgRecorded = Object.values(cumulativeSizeQtyForGroup(groupKey, "FG", productionResults)).reduce((a, b) => a + b, 0);
                // Target reject = sisa dari target finish good (target cutting dikurangi FG yang sudah diinput).
                const totalTarget = kind === "REJECT" ? Math.max(0, totalCuttingTarget - totalFgRecorded) : totalCuttingTarget;
                const grossReject = kind === "REJECT" ? Object.values(rejectGrossForGroup(groupKey, productionResults)).reduce((a, b) => a + b, 0) : 0;
                const sizes = Array.from(new Set([...Object.keys(target), ...Object.keys(recorded)]));
                const expanded = expandedGroupKey === groupKey;
                const meta = productionGroupMetaFor(groupKey, productionGroupMeta);
                // isFgConfirmed = TAHAP 1 (tab ini) sudah diklik -- reject sudah dihitung, input FG
                // dikunci, tapi Rework/Waste TETAP bisa jalan. isFinalDone = TAHAP 2 (Final Produksi)
                // sudah diklik -- semuanya benar-benar dikunci.
                const isFgConfirmed = !!meta?.fgConfirmedAt;
                const isFinalDone = !!meta?.doneAt;
                const targetDoneAt = kind === "FG" ? targetDoneProduksiForGroup(selectedMrpId, vendorId, g.warna, rawInvoices) : undefined;
                const progressPct = totalTarget > 0 ? Math.min(100, Math.round((totalRecorded / totalTarget) * 100)) : 0;
                // Finish Good murni (hasil cutting langsung) vs dari rework (reject dipotong ulang
                // jadi baju) -- contoh: murni 100, dirework 3, totalnya tampil 103 (100 murni + 3
                // rework), diminta supaya kelihatan jelas asalnya masing-masing.
                const fgSplit = kind === "FG" ? fgMurniAndReworkForGroup(groupKey, productionResults) : null;
                // Revisi 2026-09-07 (HPP per roll) -- roll (ProductionBatch) tercutting grup ini,
                // dipakai buat daftar "Tutup Roll" (opsional, boleh dikunci manual per roll kapan
                // saja). Sejak revisi 2026-09-12, tombol "Selesai Produksi" TIDAK lagi menunggu
                // semua roll ditutup manual -- server (confirmFgDoneAction) otomatis menutup roll
                // yang masih terbuka begitu tombol itu diklik.
                const groupBatches = kind === "FG" ? productionBatches.filter((b) => b.mrpId === selectedMrpId && b.warna === g.warna && b.lengan === g.lengan && b.cuttingAt) : [];
                return (
                  <div key={groupKey}>
                    <div
                      className="grid items-center gap-x-3 border-b border-[#F1F4F7] px-4 py-[11px] font-sans text-xs text-[#31414F]"
                      style={{ gridTemplateColumns: gridColumns }}
                    >
                      <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="font-medium">
                          {g.warna} · {g.lengan}
                        </span>
                        {isFgConfirmed &&
                          (groupBatches.length === 0 || groupBatches.every((b) => b.closedAt) ? (
                            <StatusPill tone="success">Finish Good Selesai</StatusPill>
                          ) : (
                            <StatusPill tone="info">Sebagian selesai</StatusPill>
                          ))}
                        {isFinalDone && <StatusPill tone="success">Final</StatusPill>}
                      </span>
                      {kind === "REJECT" ? (
                        <>
                          <span className="text-right font-mono">{grossReject}</span>
                          <span className="text-right font-mono text-success-fg">
                            {Object.values(reworkedAwayBySize(groupKey, productionResults)).reduce((a, b) => a + b, 0)}
                          </span>
                          <span className="text-right font-mono text-danger-fg">{totalRecorded}</span>
                        </>
                      ) : (
                        <>
                          <div className="flex flex-col gap-1">
                            {/* Revisi 2026-09-19: bar progres di SAMPING KANAN qty finish good (satu baris). */}
                            <div className="flex items-center gap-3">
                              <div className="flex shrink-0 items-baseline gap-1 font-mono text-[12px]">
                                <span className="font-semibold text-[#31414F]">{totalRecorded}</span>
                                <span className="text-text-muted">/ {totalTarget} pcs</span>
                              </div>
                              <span className="h-1.5 min-w-[80px] max-w-[160px] flex-1 overflow-hidden rounded-full bg-[#EEF0F3]">
                                <span className="block h-full rounded-full bg-success" style={{ width: `${progressPct}%` }} />
                              </span>
                              <span className="w-9 shrink-0 font-mono text-[10.5px] text-text-muted">{progressPct}%</span>
                            </div>
                            {!!fgSplit?.rework && (
                              <span className="font-mono text-[10px] text-text-muted">
                                ({fgSplit.murni} Finish Good Saja + {fgSplit.rework} dari rework)
                              </span>
                            )}
                          </div>
                          <span className="font-mono text-[11px] text-text-muted">{targetDoneAt ? formatDate(targetDoneAt) : "— (belum ada material diterima)"}</span>
                        </>
                      )}
                      <span className="flex items-center justify-end gap-2">
                        {kind === "FG" && isFgConfirmed && !isFinalDone && (
                          // undoFgConfirm sudah optimistic penuh di store.ts -- isPending/teks
                          // "Membuka…" dilepas (redundant, sempat kelihatan walau state lokal
                          // sudah berubah seketika).
                          <Button onClick={() => runAction(groupKey, undoFgConfirm(groupKey))} variant="muted" size="xs">
                            Buka kunci ↺
                          </Button>
                        )}
                        <Button onClick={() => toggleGroup(g.warna, g.lengan)} variant="accent" size="xs">
                          {expanded ? "Sembunyikan" : "Lihat by size →"}
                        </Button>
                      </span>
                    </div>
                    {expanded && !isFgConfirmed && kind === "REJECT" && (
                      <div className="border-b border-[#F0DFC2] bg-warning-bg px-4 py-3 font-sans text-[11.5px] leading-[1.5] text-warning-fg">
                        Reject grup ini belum dihitung — tidak ada input manual lagi. Tandai {g.warna} · {g.lengan} &quot;Selesai Produksi&quot; di tab Finish
                        Good supaya reject dihitung otomatis dari hasil cutting dikurangi finish good.
                      </div>
                    )}
                    {expanded && isFgConfirmed && kind === "REJECT" && (
                      <div className="border-b border-[#CFE0EF] bg-info-bg p-4">
                        <div className="overflow-hidden rounded-md border border-[#CFE0EF] bg-white">
                          <div className="grid grid-cols-4 gap-x-2 bg-[#F7F9FB] px-3 py-1.5 font-sans text-[10px] font-medium uppercase tracking-wider text-text-muted">
                            <span>Size</span>
                            <span className="text-right">Reject (otomatis)</span>
                            <span className="text-right">Rework</span>
                            <span className="text-right">Sisa reject</span>
                          </div>
                          {(() => {
                            const grossPerSize = rejectGrossForGroup(groupKey, productionResults);
                            const reworkPerSize = reworkedAwayBySize(groupKey, productionResults);
                            const rejectSizes = sizes.filter((size) => (grossPerSize[size] ?? 0) > 0 || (reworkPerSize[size] ?? 0) > 0);
                            if (rejectSizes.length === 0) {
                              return <div className="px-3 py-3 text-center font-sans text-[11px] text-text-muted">Tidak ada reject — finish good sudah mencapai target.</div>;
                            }
                            return rejectSizes.map((size) => (
                              <div key={size} className="grid grid-cols-4 items-center gap-x-2 border-t border-[#F1F4F7] px-3 py-1.5 font-sans text-xs text-[#31414F]">
                                <span className="font-mono font-medium">{size}</span>
                                <span className="text-right font-mono">{grossPerSize[size] ?? 0}</span>
                                <span className="text-right font-mono text-success-fg">{reworkPerSize[size] ?? 0}</span>
                                <span className="text-right font-mono text-danger-fg">{recorded[size] ?? 0}</span>
                              </div>
                            ));
                          })()}
                        </div>
                        {(() => {
                          // Remark sisa reject tersimpan per PO Produksi (rejectRemarks[poId]); tabel "Detail Reject -- by PO" yang
                          // dulu jadi tempat isiannya disembunyikan (revisi 2026-09-22), jadi isiannya pindah ke sini.
                          const remarkPoId = productionResults.find((r) => r.groupKey === groupKey && r.kind === "REJECT" && r.poId)?.poId;
                          if (!remarkPoId) return null;
                          return (
                            <div className="mt-3">
                              <div className="mb-1 font-sans text-[10px] font-medium uppercase tracking-wider text-text-muted">Remark sisa reject</div>
                              <input
                                value={rejectRemarks[remarkPoId] ?? ""}
                                onChange={(e) => setRejectRemark(remarkPoId, e.target.value)}
                                placeholder="Catatan sisa reject…"
                                className="input w-full text-[11.5px]"
                              />
                            </div>
                          );
                        })()}
                      </div>
                    )}
                    {expanded && kind === "FG" && (
                      <div className="border-b border-[#CFE0EF] bg-info-bg p-4">
                        {/* Revisi 2026-09-20 (owner): rekap Finish Good PER SIZE untuk monitoring -- selalu tampil begitu
                            baris dibuka (juga saat semua roll sudah tertutup tapi warna belum diklik Selesai). */}
                        {sizes.length > 0 && (
                          <div className="mb-3 overflow-hidden rounded-md border border-[#CFE0EF] bg-white">
                            <div className="border-b border-[#CFE0EF] bg-white px-4 py-2 font-sans text-[11.5px] font-semibold text-text-primary">Finish Good per size</div>
                            <div className="grid grid-cols-4 gap-x-2 bg-[#F7F9FB] px-4 py-1.5 font-sans text-[10px] font-medium uppercase tracking-wider text-text-muted">
                              <span>Size</span>
                              <span className="text-right">Target (hasil cutting)</span>
                              <span className="text-right">Finish Good</span>
                              <span className="text-right">Kurang</span>
                            </div>
                            {sizes.map((size) => {
                              const tgt = target[size] ?? 0;
                              const rec = recorded[size] ?? 0;
                              const kurang = tgt - rec;
                              return (
                                <div key={size} className="grid grid-cols-4 items-center gap-x-2 border-t border-[#F1F4F7] px-4 py-1.5 font-sans text-xs text-[#31414F]">
                                  <span className="font-mono font-medium">{size}</span>
                                  <span className="text-right font-mono">{tgt}</span>
                                  <span className="text-right font-mono font-semibold">{rec}</span>
                                  <span className={"text-right font-mono " + (kurang > 0 ? "font-semibold text-danger-fg" : "text-success-fg")}>{kurang > 0 ? kurang : kurang < 0 ? `+${-kurang}` : "—"}</span>
                                </div>
                              );
                            })}
                          </div>
                        )}
                        {groupBatches.length === 0 && (
                          <div className="rounded-md border border-[#CFE0EF] bg-white px-3 py-3 text-center font-sans text-[11.5px] text-text-muted">
                            Belum ada roll tercutting untuk grup ini.
                          </div>
                        )}
                        {(() => {
                          // Item 15 (feedback batch 2026-09-10, owner: "Apa bisa inputnya yang per
                          // roll itu dihilangkan? jadi nanti input per size saja langsung tapi qty
                          // targetnya itu totalan dari seluruh roll di size itu ... hasilnya nanti
                          // dipetakan ke per roll"): input per-roll (kartu + Simpan progres/Tutup
                          // Roll manual per kartu) DIHAPUS -- "Isi cepat by size" (dulu cuma alat
                          // bantu opsional) sekarang jadi SATU-SATUNYA cara input. Distribusinya
                          // TIDAK berubah (roll pertama dulu, isi sisa kapasitasnya) -- yang baru
                          // di sini cuma auto-close: roll yang SETELAH distribusi ini sudah
                          // mencapai penuh target di SEMUA size-nya otomatis "Tutup Roll" (bukan
                          // lagi menunggu klik manual), roll yang masih sisa tetap "Simpan progres"
                          // biasa. Roll tetap sumber kebenaran untuk HPP -- cuma sudah tidak ada
                          // lagi UI editnya di sini, murni dipetakan otomatis dari input by size.
                          const openBatches = groupBatches.filter((b) => !b.closedAt);
                          const sizesOpen = Array.from(new Set(openBatches.flatMap((b) => Object.keys(b.sizeQty ?? {}))));
                          const quickSaveKey = groupKey + "-quicksave";
                          // Kapasitas SISA (target dikurangi progres yang SUDAH tersimpan) per
                          // roll TERBUKA -- ini batas maksimal yang BISA diisi sekarang. Target
                          // KESELURUHAN grup (semua roll, termasuk yang sudah ditutup) & progres
                          // sejauh ini dari `target`/`recorded` di scope luar (sudah dihitung utk
                          // ringkasan baris grup) supaya angka yang tampil di sini konsisten.
                          const totalCapacity: Record<string, number> = {};
                          for (const size of sizesOpen) {
                            totalCapacity[size] = openBatches.reduce((a, b) => a + Math.max(0, (b.sizeQty?.[size] ?? 0) - (b.fgSizeQty?.[size] ?? 0)), 0);
                          }
                          const overflow = sizesOpen.filter((size) => (sizeTotalDraft[size] ?? 0) > totalCapacity[size]);
                          // Item 2026-09-12 (user-reported, gambar 2): size yang sizesOpen-nya
                          // "pairing" (1 roll dicutting untuk 2 size sekaligus, mis. M-XL) tapi
                          // salah satu size-nya sudah full (totalCapacity 0 karena FG size itu di
                          // semua roll terbuka sudah capai target) TIDAK PERLU ditampilkan lagi di
                          // form input -- tidak ada gunanya diisi (remaining selalu 0). Cuma
                          // memfilter TAMPILAN (sizesToShow) -- sizesOpen asli TETAP dipakai apa
                          // adanya di saveSizeTotals() supaya distribusi tidak berubah perilaku.
                          const sizesToShow = sizesOpen.filter((size) => totalCapacity[size] > 0);
                          // BUG FIX (ditemukan lewat verifikasi live, 2026-09-10): fungsi ini dulu
                          // (dari desain kartu-per-roll lama) fallback ke `b.sizeQty` (TARGET hasil
                          // cutting) kalau `fgSizeQty` masih kosong -- benar untuk desain lama (input
                          // per-roll pre-filled ke target penuh sebagai default), tapi SALAH di sini:
                          // dipakai sebagai baseline "berapa yang SUDAH tersimpan" untuk menghitung
                          // sisa kapasitas roll (`remaining` di bawah). Fallback ke target membuat
                          // `remaining` SELALU 0 untuk roll yang belum pernah disimpan sama sekali
                          // (target - target = 0) -- saveSizeTotals() diam-diam tidak pernah
                          // mendistribusikan apa pun ke roll manapun. Baseline yang benar: 0 (kosong)
                          // sampai benar-benar ada progres tersimpan -- sama seperti totalCapacity di
                          // atas, yang sudah pakai `b.fgSizeQty?.[size] ?? 0` (bukan fallback ke target).
                          function defaultSizeQtyFor(b: (typeof openBatches)[number]): Record<string, number> {
                            return b.fgSizeQty ?? {};
                          }
                          // Distribusi (roll pertama dulu, isi sisa kapasitasnya) LANGSUNG jadi sizeQty absolute
                          // baru per roll yang tersentuh -- dipakai "Simpan" dan "Sisa jadi reject".
                          function computeTouched(): Record<string, Record<string, number>> {
                            const touched: Record<string, Record<string, number>> = {};
                            for (const size of sizesOpen) {
                              let sisa = sizeTotalDraft[size] ?? 0;
                              if (sisa <= 0) continue;
                              for (const b of openBatches) {
                                if (sisa <= 0) break;
                                const already = touched[b.id] ?? defaultSizeQtyFor(b);
                                const remaining = Math.max(0, (b.sizeQty?.[size] ?? 0) - (already[size] ?? 0));
                                if (remaining <= 0) continue;
                                const isi = Math.min(sisa, remaining);
                                touched[b.id] = { ...already, [size]: (already[size] ?? 0) + isi };
                                sisa -= isi;
                              }
                            }
                            return touched;
                          }
                          async function saveSizeTotals() {
                            const touched = computeTouched();
                            const batchIds = Object.keys(touched);
                            if (batchIds.length === 0) return;
                            // Revisi 2026-09-20 (owner): kalau simpan ini membuat SEMUA roll terbuka grup ini
                            // penuh (maks) & otomatis tertutup, daftar/isian grup warna ini langsung disembunyikan
                            // (tidak perlu klik "Sembunyikan" lagi). Ditentukan dari angka yang akan disimpan --
                            // penutupan roll sendiri sudah optimistic di store, jadi tidak menunggu server.
                            const allWillClose = openBatches.every(
                              (b) => !!touched[b.id] && Object.entries(b.sizeQty ?? {}).every(([size, tQty]) => (touched[b.id][size] ?? 0) >= tQty)
                            );
                            if (allWillClose) setExpandedGroupKey("");
                            await Promise.all(
                              batchIds.map((id) => {
                                const b = openBatches.find((x) => x.id === id);
                                const finalQty = touched[id];
                                // Roll ini sekarang sudah lengkap (setiap size di target rollnya
                                // sudah tercapai) -- tutup otomatis, TIDAK menunggu klik manual.
                                const isFullyDone = !!b && Object.entries(b.sizeQty ?? {}).every(([size, tQty]) => (finalQty[size] ?? 0) >= tQty);
                                return isFullyDone ? closeProductionBatch(id, finalQty) : saveFgProgress(id, finalQty);
                              })
                            );
                            setSizeTotalDraft({});
                          }
                          // Revisi 2026-09-20 (owner: "sisa jadi reject" per size): roll yang punya SISA di size ini
                          // (setelah isian yang sedang diketik disimpan dulu) ditutup dengan Finish Good apa adanya --
                          // selisih target-vs-FG-nya (semua size roll itu) jadi reject saat "Selesai Produksi". Bisa
                          // dibatalkan lewat "Buka lagi" selama warna ini belum Selesai Produksi.
                          async function markSizeRemainderAsReject(size: string) {
                            const touched = computeTouched();
                            const finalFor = (bt: (typeof openBatches)[number]) => touched[bt.id] ?? defaultSizeQtyFor(bt);
                            const isFull = (bt: (typeof openBatches)[number]) => Object.entries(bt.sizeQty ?? {}).every(([sz, t]) => (finalFor(bt)[sz] ?? 0) >= t);
                            const toClose = openBatches.filter((bt) => (bt.sizeQty?.[size] ?? 0) - (finalFor(bt)[size] ?? 0) > 0 || (!!touched[bt.id] && isFull(bt)));
                            const rejectBySize: Record<string, number> = {};
                            for (const bt of toClose) {
                              for (const [sz, t] of Object.entries(bt.sizeQty ?? {})) {
                                const short = t - (finalFor(bt)[sz] ?? 0);
                                if (short > 0) rejectBySize[sz] = (rejectBySize[sz] ?? 0) + short;
                              }
                            }
                            const rejectText = Object.entries(rejectBySize).map(([sz, q]) => `${sz} ${q} pcs`).join(" · ") || "tidak ada";
                            if (
                              !window.confirm(
                                `Tandai sisa ${size} sebagai reject?\n\nRoll yang ditutup (${toClose.length}): ${toClose.map((bt) => bt.codeRoll || bt.id).join(", ")}\nReject yang tercatat: ${rejectText}\n\nBisa dibatalkan lewat "Buka lagi" selama warna ini belum Selesai Produksi.`
                              )
                            ) {
                              return;
                            }
                            const closeIds = new Set(toClose.map((bt) => bt.id));
                            if (openBatches.every((bt) => closeIds.has(bt.id))) setExpandedGroupKey("");
                            await Promise.all(
                              openBatches
                                .filter((bt) => closeIds.has(bt.id) || touched[bt.id])
                                .map((bt) => (closeIds.has(bt.id) ? closeProductionBatch(bt.id, finalFor(bt)) : saveFgProgress(bt.id, touched[bt.id]))
                              )
                            );
                            setSizeTotalDraft({});
                          }
                          // Reject SEMENTARA = selisih target-vs-FG dari roll yang sudah DITUTUP (final per roll); angka resmi
                          // tetap dihitung server saat "Selesai Produksi".
                          const closedWithShortfall = groupBatches
                            .filter((bt) => bt.closedAt)
                            .map((bt) => ({
                              bt,
                              short: Object.entries(bt.sizeQty ?? {})
                                .map(([sz, t]) => [sz, Math.max(0, t - (bt.fgSizeQty?.[sz] ?? 0))] as const)
                                .filter(([, v]) => v > 0),
                            }))
                            .filter((x) => x.short.length > 0);
                          const rejectSummary =
                            closedWithShortfall.length > 0 ? (
                              <div className="border-t border-[#F0DFC2] bg-warning-bg px-4 py-2.5 font-sans text-[11px] leading-[1.5] text-warning-fg">
                                <div className="font-semibold">Reject sementara (dari roll yang sudah ditutup) — final saat Selesai Produksi</div>
                                <div className="mt-1.5 flex flex-col gap-1">
                                  {closedWithShortfall.map(({ bt, short }) => (
                                    <div key={bt.id} className="flex flex-wrap items-center gap-2">
                                      <span className="font-mono">{bt.codeRoll || bt.id}</span>
                                      <span className="font-mono font-semibold">{short.map(([sz, v]) => `${sz} ${v} pcs`).join(" · ")}</span>
                                      <button onClick={() => runAction("reopen-" + bt.id, reopenProductionBatch(bt.id))} className="font-semibold text-action-primary underline">
                                        Buka lagi
                                      </button>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            ) : null;
                          if (sizesOpen.length === 0) {
                            return groupBatches.length > 0 ? (
                              <div className="overflow-hidden rounded-md border border-[#CFE0EF] bg-white">
                                <div className="px-3 py-3 text-center font-sans text-[11.5px] text-text-muted">Semua roll grup ini sudah tertutup.</div>
                                {rejectSummary}
                              </div>
                            ) : null;
                          }
                          return (
                            <div className="overflow-hidden rounded-md border border-[#A8C5DF] bg-white">
                              <div className="border-b border-[#CFE0EF] bg-info-bg px-4 py-2.5 font-sans text-[11.5px] font-semibold leading-[1.5] text-info-fg">
                                Input qty per size
                              </div>
                              {sizesToShow.length === 0 ? (
                                <div className="px-3 py-3 text-center font-sans text-[11.5px] text-text-muted">
                                  Semua size sudah mencapai target finish good — tinggal Tutup Roll (lihat di bawah) untuk menyelesaikan roll yang tersisa.
                                </div>
                              ) : (
                                // Revisi 2026-09-19 (owner: "perbaiki tampilan card biru"): label size dulu
                                // kotak 36x36 tetap -> size panjang seperti "S-2XL, S-XL" terpotong jadi 3
                                // baris. Sekarang tiap size = 1 kartu (grid auto-fill): pill label size
                                // selebar teksnya (nowrap) + "sisa maks" di baris atas, input di tengah
                                // (lebar penuh kartu), progres kecil di bawah.
                                <div className="grid grid-cols-[repeat(auto-fill,minmax(210px,1fr))] gap-3 px-4 py-3">
                                  {sizesToShow.map((size) => {
                                    const rec = recorded[size] ?? 0;
                                    const tgt = target[size] ?? 0;
                                    const pct = tgt > 0 ? Math.min(100, Math.round((rec / tgt) * 100)) : 0;
                                    return (
                                      <div key={size} className="flex flex-col gap-2 rounded-md border border-[#CFE0EF] bg-white px-3 py-2.5 shadow-[0_1px_2px_rgba(11,19,27,.05)]">
                                        <div className="flex items-center justify-between gap-2">
                                          <span className="whitespace-nowrap rounded-md bg-info-bg px-2.5 py-1 font-sans text-[12.5px] font-bold text-info-fg">{size}</span>
                                          <span className="whitespace-nowrap font-mono text-[10px] text-text-muted">
                                            sisa maks <span className="font-semibold text-[#31414F]">{totalCapacity[size]}</span>
                                          </span>
                                        </div>
                                        <NumberInput
                                          value={sizeTotalDraft[size] ?? 0}
                                          decimals={0}
                                          onChange={(v) => setSizeTotalDraft((prev) => ({ ...prev, [size]: v }))}
                                          className="input h-9 w-full text-right text-[13px] font-semibold"
                                        />
                                        <div className="flex items-center gap-2">
                                          <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-[#EEF0F3]">
                                            <span className="block h-full rounded-full bg-success" style={{ width: `${pct}%` }} />
                                          </span>
                                          <span className="whitespace-nowrap font-mono text-[10px] text-text-muted">
                                            {rec}/{tgt} pcs
                                          </span>
                                        </div>
                                        <button
                                          onClick={() => runAction(quickSaveKey + size, markSizeRemainderAsReject(size))}
                                          title={`Sisa ${size} tidak akan diproduksi lagi -- roll yang memuat size ini ditutup & selisihnya tercatat reject`}
                                          className="self-start font-sans text-[10.5px] font-semibold text-danger-fg underline"
                                        >
                                          Sisa jadi reject
                                        </button>
                                      </div>
                                    );
                                  })}
                                </div>
                              )}
                              <div className="flex items-center gap-2 border-t border-[#CFE0EF] bg-[#F8FBFF] px-4 py-3">
                                {/* saveFgProgress & closeProductionBatch (dipanggil saveSizeTotals)
                                   sudah optimistic penuh di store.ts -- isPending/teks "Menyimpan…"
                                   dilepas, disabled cukup dari sizesToShow saja. Revisi 2026-09-23
                                   (owner): tombol "Selesai Produksi" dipindah ke kartu roll per batch
                                   di bawah (lihat "Progres per batch") -- di sini cuma "Simpan". */}
                                <Button onClick={() => runAction(quickSaveKey, saveSizeTotals())} disabled={sizesToShow.length === 0} variant="accent" size="sm">
                                  Simpan →
                                </Button>
                              </div>
                              {rejectSummary}
                              {overflow.length > 0 && (
                                <div className="border-t border-[#F0DFC2] bg-warning-bg px-3 py-1.5 font-sans text-[10.5px] text-warning-fg">
                                  Size {overflow.join(", ")} melebihi SISA kapasitas roll terbuka — kelebihannya tidak ikut terisi ke roll mana pun.
                                </div>
                              )}
                            </div>
                          );
                        })()}
                        {/* Status roll read-only untuk transparansi soal isian by size di atas,
                           TAPI kolom Aksi tetap ada -- "Tutup Roll" manual (bug fix 2026-09-11,
                           user-reported: sejak item 15 menghapus tombol tutup-roll-manual, roll
                           HANYA bisa tertutup kalau FG mencapai 100% hasil cutting-nya, jadi
                           reject = cutting aktual - FG SELALU 0 begitu "Selesai Produksi" bisa
                           diklik -- lebih parah, grup dengan reject sungguhan tidak akan PERNAH
                           bisa "Selesai Produksi" sama sekali karena rollnya tidak akan pernah
                           capai 100%). Tombol ini menutup roll dengan FG APA ADANYA sekarang
                           (closeProductionBatchAction tidak pernah mensyaratkan FG=target, itu
                           murni gate sisi UI yang dihapus -- lihat komentar di atas) -- sisa
                           selisih cutting-vs-FG roll ini otomatis terhitung reject saat grup
                           di-"Selesai Produksi"-kan (recomputeAutoRejectForGroup, actions.ts). */}
                        {/* Revisi 2026-09-23 (owner: "buat per batch saja ... begitu suatu warna diklik akan
                           dropdown progres atau berkas per batch dari resting ke hasil jadi finish good"):
                           daftar roll (dulu "Lihat daftar roll", toggle tersembunyi) SEKARANG SELALU tampil
                           begitu grup warna/lengan ini dibuka -- ini jadi tampilan utama progres per batch
                           (bukan lagi bagian opsional). Tombol "Selesai Produksi" juga DIPINDAH ke sini
                           (footer kartu ini, gantikan posisi lamanya di bawah "Input qty per size") supaya
                           aksi penyelesaian selalu berdampingan dengan daftar roll/batch yang jadi dasarnya --
                           tetap 1 aksi per grup (confirmFgDone), TIDAK ada lagi versi "sekaligus banyak warna". */}
                        {groupBatches.length > 0 && (
                          <div className="mt-3 overflow-hidden rounded-md border border-[#EEF1F4] bg-white">
                            <div className="border-b border-[#F1F4F7] bg-[#F7F9FB] px-3 py-1.5 font-sans text-[11px] font-semibold text-text-primary">
                              Progres per batch ({groupBatches.length} roll — Resting → Finish Good)
                            </div>
                            <div className="grid grid-cols-4 gap-x-2 bg-[#F7F9FB] px-3 py-1.5 font-sans text-[10px] font-medium uppercase tracking-wider text-text-muted">
                              <span>Roll</span>
                              <span className="text-right">FG / hasil cutting</span>
                              <span className="text-right">Status</span>
                              <span className="text-right">Aksi</span>
                            </div>
                            {groupBatches.map((b) => {
                              const rollTarget = b.sizeQty ?? {};
                              const totalTarget = Object.values(rollTarget).reduce((a, c) => a + c, 0);
                              const totalFg = Object.values(b.fgSizeQty ?? {}).reduce((a, c) => a + c, 0);
                              const closeKey = "close-" + b.id;
                              return (
                                <div key={b.id} className="grid grid-cols-4 items-center gap-x-2 border-t border-[#F1F4F7] px-3 py-1.5 font-sans text-[11.5px] text-[#31414F]">
                                  <span className="font-mono">{b.codeRoll || b.id}</span>
                                  <span className="text-right font-mono">
                                    {totalFg} / {totalTarget}
                                  </span>
                                  <span className="text-right">
                                    {b.closedAt ? <StatusPill tone="success">Ditutup</StatusPill> : <StatusPill tone="neutral">Terbuka</StatusPill>}
                                  </span>
                                  <span className="flex items-center justify-end gap-3 text-right">
                                    <button
                                      onClick={() => {
                                        setEditFgBatchId(b.id);
                                        setEditFgDraft({ ...(b.fgSizeQty ?? {}) });
                                      }}
                                      title="Koreksi Finish Good roll ini per size (bisa menaikkan atau menurunkan)"
                                      className="font-sans text-[10.5px] font-semibold text-action-primary underline"
                                    >
                                      Edit FG
                                    </button>
                                    {/* closeProductionBatch sudah optimistic penuh -- isPending/teks
                                       "Menutup…" dilepas. */}
                                    {b.closedAt && (
                                      <button
                                        onClick={() => runAction("reopen-" + b.id, reopenProductionBatch(b.id))}
                                        className="font-sans text-[10.5px] font-semibold text-action-primary underline"
                                      >
                                        Buka lagi
                                      </button>
                                    )}
                                    {!b.closedAt && (
                                      <button
                                        onClick={() => runAction(closeKey, closeProductionBatch(b.id, b.fgSizeQty ?? {}))}
                                        title={
                                          totalFg < totalTarget
                                            ? `Sisa ${totalTarget - totalFg} pcs roll ini akan tercatat reject saat grup "Selesai Produksi".`
                                            : undefined
                                        }
                                        className="font-sans text-[10.5px] font-semibold text-action-primary underline"
                                      >
                                        Tutup Roll
                                      </button>
                                    )}
                                  </span>
                                </div>
                              );
                            })}
                            {!isFinalDone && groupNeedsFinish(g) && (
                              <div className="flex items-center justify-end border-t border-[#F1F4F7] bg-[#F8FBFF] px-3 py-2.5">
                                <Button
                                  onClick={() => confirmFinish([g]) && runAction(groupKey, confirmFgDone(groupKey, selectedMrpId, vendorId, g.warna, g.lengan))}
                                  disabled={isPending(groupKey)}
                                  title="Selesaikan Finish Good grup ini -- roll yang masih terbuka otomatis ditutup, selisih target vs FG jadi reject"
                                  variant="primary"
                                  size="sm"
                                >
                                  {isPending(groupKey) ? "Menyimpan…" : "Selesai Produksi →"}
                                </Button>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Tabel "by PO" hanya untuk Finish Good; di tab Reject disembunyikan (revisi 2026-09-22) -- kolom Qty reject/rework/sisa
          sudah ada di tabel per warna/lengan di atas. `as string` menjaga cabang REJECT di bawah tetap valid secara tipe. */}
      {(kind as string) === "FG" && (
      <div className="overflow-hidden rounded-lg border border-border-subtle bg-surface-card">
        <div className="border-b border-border-subtle px-4 py-3 font-sans text-[13px] font-semibold text-text-primary">
          {kind === "REJECT" ? "Detail Reject — by PO" : "Riwayat & Hasil Finish Good — by PO"}
        </div>
        <div className="overflow-x-auto">
          <div className={kind === "REJECT" ? "min-w-[900px]" : "min-w-[600px]"}>
            <div
              className="grid items-center gap-x-3 border-b-2 border-accent-blue bg-info-bg px-4 py-[9px] font-sans text-[10.5px] font-medium uppercase tracking-wider text-info-fg"
              style={{
                gridTemplateColumns:
                  kind === "REJECT"
                    ? "minmax(90px,0.7fr) minmax(120px,0.9fr) minmax(90px,0.7fr) minmax(90px,0.7fr) minmax(110px,0.8fr) minmax(160px,1.5fr) minmax(90px,0.7fr)"
                    : "minmax(100px,0.9fr) minmax(120px,1fr) minmax(220px,1.6fr) minmax(90px,0.7fr)",
              }}
            >
              <span>No MRP</span>
              <span>No PO Produksi</span>
              {kind === "REJECT" ? (
                <>
                  <span className="text-right">Qty reject</span>
                  <span className="text-right">Qty rework</span>
                  <span className="text-right">Qty sisa reject</span>
                  <span>Remark sisa reject</span>
                </>
              ) : (
                <span>Progres FG</span>
              )}
              <span className="text-right">Detail</span>
            </div>
            {poIds.length === 0 && <div className="px-4 py-6 text-center font-sans text-xs text-text-muted">Belum ada hasil produksi tercatat.</div>}
            {poIds.map((poId) => {
              const rows = myResults.filter((r) => r.poId === poId);
              const total = rows.reduce((sum, r) => sum + Object.values(r.sizeQty).reduce((a, b) => a + b, 0), 0);
              const expanded = expandedPoId === poId;
              const mrpId = rows[0]?.mrpId ?? "—";
              const byWarna = new Map<string, number>();
              for (const r of rows) {
                const key = r.warna + " · " + r.lengan;
                const qty = Object.values(r.sizeQty).reduce((a, b) => a + b, 0);
                byWarna.set(key, (byWarna.get(key) ?? 0) + qty);
              }
              // Qty reject (gross, sebelum rework): entri REJECT tanpa note (submission asli, bukan penyesuaian rework).
              const qtyRejectGross = kind === "REJECT" ? rows.filter((r) => !r.note).reduce((sum, r) => sum + Object.values(r.sizeQty).reduce((a, b) => a + b, 0), 0) : 0;
              // Qty rework: jumlah warna/lengan unik pada PO ini dijumlahkan via reworkQtyForGroup.
              const qtyRework =
                kind === "REJECT"
                  ? Array.from(new Set(rows.map((r) => r.groupKey))).reduce((sum, gk) => sum + reworkQtyForGroup(gk, productionResults), 0)
                  : 0;
              const qtySisaReject = total; // net (gross - rework) — sama dengan total sizeQty semua entri REJECT PO ini.
              // Item 17: denominator progres FG = total hasil cutting AKTUAL (cuttingSizesForGroup,
              // sudah termasuk grup tujuan rework lintas lengan lewat warnaLenganGroupsWithFg) dari
              // SEMUA warna/lengan mrpId row ini, bukan cuma yang tercatat di PO ini saja.
              const fgTargetPo =
                kind === "FG"
                  ? warnaLenganGroupsWithFg(mrpId, vendorId, productionBatches, productionResults).reduce(
                      (sum, g) => sum + Object.values(cuttingSizesForGroup(mrpId, g.warna, g.lengan, mrpDetails, productionBatches)).reduce((a, b) => a + b, 0),
                      0
                    )
                  : 0;
              const fgPct = fgTargetPo > 0 ? Math.min(100, Math.round((total / fgTargetPo) * 100)) : 0;
              const fgTone = fgTargetPo > 0 && total > fgTargetPo ? "over" : fgPct >= 100 ? "done" : "active";
              return (
                <div key={poId}>
                  <div
                    className="grid items-center gap-x-3 border-b border-[#F1F4F7] px-4 py-[11px] font-sans text-xs text-[#31414F]"
                    style={{
                      gridTemplateColumns:
                        kind === "REJECT"
                          ? "minmax(90px,0.7fr) minmax(120px,0.9fr) minmax(90px,0.7fr) minmax(90px,0.7fr) minmax(110px,0.8fr) minmax(160px,1.5fr) minmax(90px,0.7fr)"
                          : "minmax(100px,0.9fr) minmax(120px,1fr) minmax(220px,1.6fr) minmax(90px,0.7fr)",
                    }}
                  >
                    <span className="font-mono">{mrpId}</span>
                    <span className="font-mono font-medium">{poId}</span>
                    {kind === "REJECT" ? (
                      <>
                        <span className="text-right font-mono">{qtyRejectGross}</span>
                        <span className="text-right font-mono">{qtyRework}</span>
                        <span className="text-right font-mono text-danger-fg">{qtySisaReject}</span>
                        <input
                          value={rejectRemarks[poId] ?? ""}
                          onChange={(e) => setRejectRemark(poId, e.target.value)}
                          placeholder="Catatan sisa reject…"
                          className="input text-[11.5px]"
                        />
                      </>
                    ) : (
                      <span className="flex items-center gap-2">
                        <span className="font-mono">
                          {total} / {fgTargetPo} pcs
                        </span>
                        <ProgressBar pct={Math.min(100, fgPct)} tone={fgTone} className="w-[80px]" />
                        <span className="font-mono text-[10.5px] text-text-muted">{fgPct}%</span>
                      </span>
                    )}
                    <span className="text-right">
                      <button onClick={() => setExpandedPoId(expanded ? "" : poId)} className="font-sans text-[11px] font-semibold text-action-primary">
                        {expanded ? "Sembunyikan" : "Detail →"}
                      </button>
                    </span>
                  </div>
                  {expanded && kind === "REJECT" && (
                    <div className="border-b border-[#F1F4F7] bg-[#FAFBFC] px-6 py-2">
                      {Array.from(byWarna.entries()).map(([warna, qty]) => (
                        <div key={warna} className="flex justify-between py-1 font-sans text-[11.5px] text-[#31414F]">
                          <span>{warna}</span>
                          <span className="font-mono">{qty}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {expanded && kind === "FG" && (
                    <div className="border-b border-[#F1F4F7] bg-[#FAFBFC] px-6 py-2.5">
                      <div className="mb-1.5 font-sans text-[10px] font-medium uppercase tracking-wider text-text-muted">
                        Tanggal &amp; jam tercatat otomatis oleh sistem, tidak bisa diubah/backdate
                      </div>
                      <FgProgressHistory poId={poId} results={productionResults} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
      )}
      {/* Modal Edit FG per roll (revisi 2026-09-20): koreksi Finish Good aktual, naik maupun turun. */}
      {editFgBatchId &&
        (() => {
          const eb = productionBatches.find((x) => x.id === editFgBatchId);
          if (!eb) return null;
          const ebTarget = eb.sizeQty ?? {};
          const ebSizes = Object.keys(ebTarget);
          const ebTotal = ebSizes.reduce((sum, sz) => sum + (editFgDraft[sz] ?? 0), 0);
          const ebTargetTotal = ebSizes.reduce((sum, sz) => sum + (ebTarget[sz] ?? 0), 0);
          return (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0B131B]/45 p-4">
              <div className="flex max-h-[88vh] w-full max-w-[560px] flex-col rounded-lg bg-white shadow-[0_8px_24px_rgba(11,19,27,.2)]">
                <div className="border-b border-border-subtle px-5 py-3.5">
                  <div className="font-sans text-[13px] font-semibold text-text-primary">Edit Finish Good — {eb.codeRoll || eb.id}</div>
                  <div className="mt-0.5 font-sans text-[11px] text-text-muted">
                    {eb.warna} · {eb.lengan} · {eb.closedAt ? "roll sudah ditutup" : "roll masih terbuka"} — angka boleh dinaikkan atau diturunkan (maksimal sebesar hasil cutting).
                  </div>
                </div>
                <div className="flex-1 overflow-y-auto px-5 py-4">
                  <div className="grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-3">
                    {ebSizes.map((sz) => (
                      <SizeQtyControl key={sz} size={sz} max={ebTarget[sz] ?? 0} value={editFgDraft[sz] ?? 0} onChange={(v) => setEditFgDraft((prev) => ({ ...prev, [sz]: v }))} />
                    ))}
                  </div>
                  {eb.closedAt && ebTotal < ebTargetTotal && (
                    <div className="mt-3 rounded-md border border-[#F0DFC2] bg-warning-bg px-3 py-2 font-sans text-[11px] text-warning-fg">
                      Roll ini sudah ditutup: kekurangan {ebTargetTotal - ebTotal} pcs akan tercatat sebagai reject sementara.
                    </div>
                  )}
                </div>
                <div className="flex items-center justify-between gap-2 border-t border-border-subtle px-5 py-3.5">
                  <span className="font-mono text-[11.5px] text-text-muted">
                    Total {ebTotal} / {ebTargetTotal} pcs
                  </span>
                  <div className="flex gap-2">
                    <button onClick={() => setEditFgBatchId(null)} className="rounded-md border border-[#CBD5DF] bg-white px-3.5 py-[7px] font-sans text-xs font-semibold text-action-primary">
                      Batal
                    </button>
                    <Button
                      onClick={() => {
                        runAction("editfg-" + eb.id, editRollFg(eb.id, editFgDraft));
                        setEditFgBatchId(null);
                      }}
                      variant="success"
                      size="sm"
                    >
                      Simpan
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          );
        })()}
    </>
  );
}
