"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { confirmDialog } from "@/components/ui/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Tabs } from "@/components/ui/tabs";
import { KpiCard } from "@/components/ui/kpi-card";
import { DataTable, aggSame, aggSum, type ColumnDef } from "@/components/mrp/data-table";
import { countPoInProgress } from "@/lib/shell/badges";
import { SysadminPanel } from "@/components/sysadmin/correction-dialog";
import { maklonPoCorrections, materialPoCorrections } from "@/components/sysadmin/procurement-corrections";
import { useMrpStore } from "@/lib/mrp/store";
import { useInternalAuthStore } from "@/lib/internal-auth-store";
import { compareNewestFirst, formatPcs, formatRupiah, formatDate, materialPoColorPcs, materialPoPcs, mrpDetailFor, segmenProdukLookup } from "@/lib/mrp/derive";
import { VENDOR_PRODUKSI, ROLL_KG_ESTIMATE } from "@/lib/mrp/seed";
import {
  APPROVAL_LEVEL_TABLE,
  APPROVAL_ROLE_LABEL,
  APPROVAL_STEP_LABEL,
  poApprovalSignBoxes,
  poApprovalState,
  poApprovalSummary,
  SCM_POSITION_LABEL,
  scmMayActAtStep,
  scmPositionOf,
  type ApprovalRole,
  type PoApprovalSignBox,
  type PoApprovalState,
} from "@/lib/mrp/poApproval";
import type { MaklonPO, MaterialPO } from "@/lib/mrp/types";
import { aduanRowsOfPo } from "@/lib/mrp/exportPoExcel";

import {
  diskonRatioBySupplier,
  estimateMaklonPoHpp,
  estimateMaterialPosHpp,
  mergeHppEstimates,
  ongkirPerPcsBySegmen,
  type PoHppContext,
  type PoHppEstimate,
} from "@/lib/mrp/poHppEstimate";

const pctText = (p: number | null) => (p == null ? "—" : `${p.toLocaleString("id-ID", { maximumFractionDigits: 1 })}%`);
/** Warna rasio HPP: <= 70% hijau, <= 80% kuning, di atas itu merah. */
const pctTone = (p: number | null) => (p == null ? "text-text-muted" : p <= 70 ? "text-success-fg" : p <= 80 ? "text-warning-fg" : "text-danger-fg");

/** Rincian estimasi HPP di jendela "Lihat detail" (owner 2026-11-27). */
function HppEstimateSection({ est }: { est: PoHppEstimate }) {
  const rp = (n: number) => formatRupiah(Math.round(n));
  const rows: [string, number, string?][] = [
    ["Bahan (roll x 25 kg x harga kain)", est.bahan],
    ["Rib, kerah, manset", est.rib],
    ["Diskon supplier (historis)", -est.diskon, "pengurang bahan"],
    ["Maklon (matriks harga maklon)", est.maklon],
    ["Ongkir (rata-rata per kategori)", est.ongkir],
  ];
  return (
    <div className="mt-5">
      <SectionLabel>Estimasi HPP</SectionLabel>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          ["Est. HPP", rp(est.hpp), ""],
          ["HPP / pcs", rp(est.hppPerPcs), ""],
          ["Nilai jual", rp(est.hargaJual), ""],
          ["Rasio HPP", pctText(est.pct), pctTone(est.pct)],
        ].map(([k, v, tone]) => (
          <div key={k} className="rounded-md border border-[#E4E8EE] bg-[#FBFCFD] px-3 py-2">
            <div className="font-sans text-[10px] font-medium uppercase tracking-wider text-text-muted">{k}</div>
            <div className={"mt-0.5 font-mono text-[12.5px] font-semibold " + (tone || "text-text-primary")}>{v}</div>
          </div>
        ))}
      </div>
      <table className="mt-3 w-full border-collapse font-sans text-[11.5px]">
        <tbody>
          {rows.map(([k, v, note]) => (
            <tr key={k} className="border-t border-[#F1F4F7]">
              <td className="px-3 py-1 text-[#31414F]">
                {k}
                {note && <span className="ml-1 text-[10.5px] text-text-muted">({note})</span>}
              </td>
              <td className="px-3 py-1 text-right font-mono">{rp(v)}</td>
            </tr>
          ))}
          <tr className="border-t border-[#E4E8EE] font-semibold">
            <td className="px-3 py-1">Total HPP · {formatPcs(est.pcs)} pcs</td>
            <td className="px-3 py-1 text-right font-mono">{rp(est.hpp)}</td>
          </tr>
        </tbody>
      </table>
      <div className="mt-3 overflow-x-auto rounded-md border border-[#E4E8EE]">
        <table className="w-full border-collapse font-sans text-[11.5px]">
          <thead className="bg-[#F2F5F8]">
            <tr className="text-left text-text-muted">
              <th className="px-3 py-1 font-medium">Vendor · warna · lengan</th>
              <th className="px-3 py-1 font-medium">Kategori</th>
              <th className="px-3 py-1 text-right font-medium">Pcs</th>
              <th className="px-3 py-1 text-right font-medium">Maklon/pcs</th>
              <th className="px-3 py-1 text-right font-medium">HPP/pcs</th>
              <th className="px-3 py-1 text-right font-medium">Rasio</th>
            </tr>
          </thead>
          <tbody>
            {est.lines.map((l) => {
              const pct = l.hargaJual > 0 ? (l.hpp / l.hargaJual) * 100 : null;
              return (
                <tr key={l.mrpId + l.vendor + l.warna + l.lengan} className="border-t border-[#F1F4F7]">
                  <td className="px-3 py-1">
                    {VENDOR_PRODUKSI[l.vendor]?.name ?? l.vendor} · {l.warna} · {l.lengan}
                    {l.kainTanpaHarga && <span className="ml-1 text-[10px] font-semibold text-danger-fg">harga kain tidak ada</span>}
                  </td>
                  <td className="px-3 py-1">{l.segmen}</td>
                  <td className="px-3 py-1 text-right font-mono">{formatPcs(l.pcs)}</td>
                  <td className="px-3 py-1 text-right font-mono">{rp(l.maklonRate)}</td>
                  <td className="px-3 py-1 text-right font-mono">{rp(l.pcs > 0 ? l.hpp / l.pcs : 0)}</td>
                  <td className={"px-3 py-1 text-right font-mono font-semibold " + pctTone(pct)}>{pctText(pct)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="mt-2 font-sans text-[10.5px] leading-[1.5] text-text-muted">
        Estimasi, bukan HPP aktual. Bahan dan rib dari Master Data harga, diskon = rata-rata diskon invoice supplier yang sama sebelumnya, maklon dari
        matriks Master Data Harga Maklon per kategori, ongkir = rata-rata ongkir per pcs kategori (Dewasa/Combed, Kids, Tunik) dari pengiriman sebelumnya.
        Rasio = HPP / nilai jual Master SKU.
        {est.pcsTanpaHarga > 0 &&
          ` ${formatPcs(est.pcsTanpaHarga)} pcs belum punya harga jual di Master SKU: size yang kosong memakai rata-rata size lain warna yang sama, warna yang sama sekali tidak punya harga jual tidak dihitung di rasio.`}
      </div>
    </div>
  );
}

/** `members`: PO Material satu supplier dalam satu MRP digabung jadi SATU baris (approval PO Material berlaku per supplier,
 *  levelnya dari total supplier); `id` = PO pertama (target aksi -- server menerapkannya ke semua PO satu supplier). */
type Item = { type: "MATERIAL" | "MAKLON"; id: string; mrpId: string; vendor: string; supplier?: string; amount: number; po: MaterialPO | MaklonPO; state: PoApprovalState; members?: Item[] };

/** Tombol aksi massal: putih, teks dan garis biru (Setujui MRP ini / Setujui semua). */
const OUTLINE_BTN =
  "inline-flex h-[30px] w-[124px] items-center justify-center rounded-[5px] border border-action-primary bg-white font-sans text-[11.5px] font-semibold text-action-primary hover:bg-info-bg disabled:cursor-not-allowed disabled:opacity-50";

/** Tombol sekunder (Lihat detail / Tolak): tinggi sama dengan Setujui, lebar mengikuti teks. */
const BTN_BASE = "inline-flex h-[30px] items-center justify-center rounded-[5px] border bg-white px-3 font-sans text-[11.5px] font-semibold disabled:cursor-not-allowed disabled:opacity-50";
const DETAIL_BTN = BTN_BASE + " border-action-primary text-action-primary hover:bg-info-bg";
const REJECT_BTN = BTN_BASE + " border-[#EFC9C4] text-danger-fg hover:bg-danger-bg";

/** Indikator "sedang memproses" kecil untuk tombol (berputar), supaya jelas aksi sedang berjalan dan bukan macet. */
function Spinner({ label }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden />
      {label}
    </span>
  );
}

function itemTitle(item: Item): string {
  return item.type === "MATERIAL" ? `${item.mrpId} · ${item.supplier}` : `${item.mrpId} · ${item.vendor}`;
}

/** Vendor dalam satu PO Material gabungan: roll terbanyak di atas (owner 2026-11-21); roll sama = urut nama. */
function membersByRoll(item: Item): Item[] {
  const members = item.members ?? [item];
  if (item.type !== "MATERIAL") return members;
  return [...members].sort((x, y) => (y.po as MaterialPO).rollCount - (x.po as MaterialPO).rollCount || x.vendor.localeCompare(y.vendor, "id"));
}

function itemSubtitle(item: Item): string {
  if (item.type === "MAKLON") return item.id;
  const members = membersByRoll(item);
  return members.length > 1 ? `${members.length} vendor: ${members.map((m) => m.vendor).join(", ")}` : `${item.vendor} · ${item.id}`;
}

function fmtTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("id-ID", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

/** Bagan langkah approval (Level 1..N) -- hijau = selesai, kuning = sedang menunggu, abu = belum.
 *  Dipakai halaman Finance (po-material-panel, po-maklon-panel); antrean approval memakai ApprovalProgress di bawah. */
export function ApprovalChain({ state }: { state: PoApprovalState }) {
  if (state.legacy || state.level == null) return <span className="font-sans text-[10.5px] text-text-muted">{poApprovalSummary(state)}</span>;
  const steps = Array.from({ length: state.level }, (_, i) => i + 1);
  return (
    <div className="flex flex-wrap items-center gap-1">
      {steps.map((s) => {
        const done = state.approved || s === 1 || (state.currentStep != null && s < state.currentStep);
        const current = !state.approved && !state.rejected && s === state.currentStep;
        const rejectedHere = state.rejected && state.cycle.some((e) => e.step === s && e.action === "REJECTED");
        const cls = rejectedHere ? "bg-danger-bg text-danger-fg" : done ? "bg-success-bg text-success-fg" : current ? "bg-warning-bg text-warning-fg" : "bg-[#EEF1F4] text-text-muted";
        const partial = current && s === 3 ? ` (${state.doneRolesInStep.map((r) => (r === "finance" ? "Fin" : "SCM")).join("+") || "0/2"})` : "";
        return (
          <span key={s} title={APPROVAL_STEP_LABEL[s]} className={"rounded px-1.5 py-[2px] font-mono text-[10px] font-semibold " + cls}>
            L{s} {rejectedHere ? "✕" : done ? "✓" : current ? "…" : ""}
            {partial}
          </span>
        );
      })}
    </div>
  );
}

function boxTone(b: PoApprovalSignBox, state: PoApprovalState): "done" | "current" | "todo" | "rejected" {
  if (b.state === "REJECTED") return "rejected";
  if (b.state === "SUBMITTED" || b.state === "APPROVED") return "done";
  return !state.rejected && b.step === state.currentStep ? "current" : "todo";
}

const TONE_CLASS = {
  done: "bg-success-bg text-success-fg",
  current: "bg-warning-bg text-warning-fg",
  todo: "bg-[#EEF1F4] text-text-muted",
  rejected: "bg-danger-bg text-danger-fg",
} as const;

const TONE_ICON = { done: "✓", current: "…", todo: "○", rejected: "✕" } as const;

function approvalBoxes(po: MaterialPO | MaklonPO, state: PoApprovalState): PoApprovalSignBox[] {
  const boxes = poApprovalSignBoxes(po);
  // Level 1 selesai begitu diajukan -- tidak ada penyetuju lain untuk ditampilkan.
  return !state.legacy && state.level != null && state.level <= 1 ? boxes.slice(0, 1) : boxes;
}

/** Bagan ringkas siapa saja yang harus menyetujui: "Procurement ✓ › SCM ✓ › SCM … FAT … › GM ○" (nama + tanggal di tooltip). */
function ApprovalProgress({ po, state }: { po: MaterialPO | MaklonPO; state: PoApprovalState }) {
  const boxes = approvalBoxes(po, state);
  return (
    <div className="flex flex-wrap items-center gap-x-1 gap-y-1">
      {boxes.map((b, i) => {
        const tone = boxTone(b, state);
        const prev = boxes[i - 1];
        return (
          <span key={i} className="flex items-center gap-1">
            {prev && <span className="text-[10px] text-text-muted">›</span>}
            <span
              title={`${b.role} — ${b.name}${b.date ? ` · ${formatDate(b.date)}` : ""}`}
              className={"rounded px-1.5 py-[2px] font-sans text-[10.5px] font-semibold " + TONE_CLASS[tone]}
            >
              {TONE_ICON[tone]} {b.short}
            </span>
          </span>
        );
      })}
    </div>
  );
}

/** Tabel matriks (referensi) -- ditampilkan collapsible di atas antrean. */
function MatrixReference() {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-lg border border-border-subtle bg-surface-card">
      <button onClick={() => setOpen((v) => !v)} className="flex w-full items-center justify-between px-4 py-2.5 text-left font-sans text-[12px] font-semibold text-text-primary">
        <span>Matriks Approval PO (berlapis berurutan)</span>
        <span className="text-text-muted">{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <div className="overflow-x-auto border-t border-border-subtle">
          <table className="w-full border-collapse font-sans text-[11.5px]">
            <thead className="bg-[#F2F5F8]">
              <tr className="text-left uppercase tracking-wider text-text-muted">
                <th className="px-3 py-1.5">Jenjang</th>
                <th className="px-3 py-1.5">Nilai PO</th>
                <th className="px-3 py-1.5">Approver</th>
                <th className="px-3 py-1.5">SLA</th>
                <th className="px-3 py-1.5">Keterangan</th>
              </tr>
            </thead>
            <tbody>
              {APPROVAL_LEVEL_TABLE.map((l, i) => {
                const min = i === 0 ? 0 : APPROVAL_LEVEL_TABLE[i - 1].max + 1;
                return (
                  <tr key={l.level} className="border-t border-[#F1F4F7]">
                    <td className="px-3 py-1.5 font-semibold">{l.label}</td>
                    <td className="px-3 py-1.5 font-mono">{l.max === Infinity ? `> ${formatRupiah(min - 1)}` : `${formatRupiah(min)} – ${formatRupiah(l.max)}`}</td>
                    <td className="px-3 py-1.5">{l.approver}</td>
                    <td className="px-3 py-1.5">{l.slaDays} hari</td>
                    <td className="px-3 py-1.5 text-text-muted">{l.keterangan}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="border-t border-[#F1F4F7] bg-[#FBFCFD] px-3 py-2 font-sans text-[11px] text-text-muted">
            Level PO Produksi dihitung dari nilai PO tiap vendor produksi. Level PO Material dihitung dari TOTAL semua PO satu supplier dalam MRP yang sama, dan approval-nya berlaku sekaligus untuk semua PO supplier itu.
          </div>
        </div>
      )}
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <div className="mb-2 font-sans text-[10.5px] font-semibold uppercase tracking-wider text-text-muted">{children}</div>;
}

/** Jendela "Lihat detail": ringkasan, alur approval (siapa/kapan), dan rincian PO. */
function DetailModal({ item, est, onClose }: { item: Item; est?: PoHppEstimate; onClose: () => void }) {
  const mrpDetails = useMrpStore((s) => s.mrpDetails);
  const detail = mrpDetailFor(item.mrpId, mrpDetails);
  const st = item.state;
  const boxes = approvalBoxes(item.po, st);
  const members = membersByRoll(item);
  const totalRoll = item.type === "MATERIAL" ? members.reduce((sum, m) => sum + (m.po as MaterialPO).rollCount, 0) : 0;
  const totalPcs = item.type === "MATERIAL" ? members.reduce((sum, m) => sum + materialPoPcs(m.po as MaterialPO, detail?.aduanRows ?? []), 0) : 0;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0B131B]/45 p-4" onClick={onClose}>
      <div className="flex max-h-[88vh] w-full max-w-[760px] flex-col rounded-lg bg-white shadow-[0_8px_24px_rgba(11,19,27,.2)]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 border-b border-border-subtle px-5 py-3.5">
          <div>
            <div className="font-sans text-[14px] font-semibold text-text-primary">{itemTitle(item)}</div>
            <div className="mt-0.5 font-sans text-[11.5px] text-text-muted">{item.type === "MATERIAL" ? "PO Material" : "PO Produksi"} · {itemSubtitle(item)}</div>
          </div>
          <button onClick={onClose} className="rounded-md border border-[#CBD5DF] bg-white px-2.5 py-1 font-sans text-[11px] font-semibold text-action-primary">
            Tutup
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          <div className={"grid grid-cols-2 gap-3 " + (item.type === "MATERIAL" ? "md:grid-cols-5" : "md:grid-cols-4")}>
            {[
              ["Nilai PO", formatRupiah(item.amount)],
              ["Level approval", st.legacy || st.level == null ? "Alur lama" : `Level ${st.level}`],
              ["Tanggal PO", detail?.dates.poSent ? formatDate(detail.dates.poSent) : "—"],
              [item.type === "MATERIAL" ? "Total roll" : "Total qty", item.type === "MATERIAL" ? `${totalRoll.toLocaleString("id-ID", { maximumFractionDigits: 1 })} roll` : `${(item.po as MaklonPO).qty.toLocaleString("id-ID")} pcs`],
              ...(item.type === "MATERIAL" ? [["Qty produksi (est.)", `${totalPcs.toLocaleString("id-ID")} pcs`]] : []),
            ].map(([k, v]) => (
              <div key={k} className="rounded-md border border-[#E4E8EE] bg-[#FBFCFD] px-3 py-2">
                <div className="font-sans text-[10px] font-medium uppercase tracking-wider text-text-muted">{k}</div>
                <div className="mt-0.5 font-mono text-[12.5px] font-semibold text-text-primary">{v}</div>
              </div>
            ))}
          </div>
          <div className="mt-2 font-sans text-[11.5px] text-text-muted">
            Status: <span className="font-semibold text-text-primary">{poApprovalSummary(st)}</span>
            {st.slaDueAt && (
              <span className={st.overdue ? " font-semibold text-danger-fg" : ""}>
                {" "}
                · {st.overdue ? "Lewat SLA" : "Batas SLA"} {fmtTime(st.slaDueAt)}
              </span>
            )}
          </div>
          {st.rejected && st.rejectNote && (
            <div className="mt-2 rounded-md border border-[#EFC9C4] bg-danger-bg px-3 py-1.5 font-sans text-[11.5px] text-danger-fg">
              Ditolak {st.rejectedBy ? APPROVAL_ROLE_LABEL[st.rejectedBy] : ""}: {st.rejectNote}
            </div>
          )}

          {est && est.pcs > 0 && <HppEstimateSection est={est} />}

          <div className="mt-5">
            <SectionLabel>Alur approval</SectionLabel>
            <ol className="flex flex-col">
              {boxes.map((b, i) => {
                const tone = boxTone(b, st);
                return (
                  <li key={i} className="flex items-start gap-3 border-t border-[#F1F4F7] py-2 first:border-t-0">
                    <span className={"mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full font-sans text-[11px] font-bold " + TONE_CLASS[tone]}>{TONE_ICON[tone]}</span>
                    <div className="min-w-0 flex-1">
                      <div className="font-sans text-[12px] font-semibold text-text-primary">{b.step === 1 && b.state === "SUBMITTED" ? "Diajukan · Procurement" : b.role}</div>
                      <div className="font-sans text-[11.5px] text-[#31414F]">
                        {b.state === "PENDING" ? <span className="text-text-muted">Belum disetujui — menunggu {b.name}</span> : b.name}
                      </div>
                    </div>
                    <div className="shrink-0 font-sans text-[11px] text-text-muted">{b.date ? formatDate(b.date) : ""}</div>
                  </li>
                );
              })}
            </ol>
          </div>

          <div className="mt-5">
            <SectionLabel>Rincian PO</SectionLabel>
            {item.type === "MATERIAL" ? (
              <div className="flex flex-col gap-4">
                {members.map((m) => (
                  <div key={m.id} className="overflow-hidden rounded-md border border-[#E4E8EE]">
                    <div className="flex items-baseline justify-between bg-[#F2F5F8] px-3 py-1.5 font-sans text-[11.5px]">
                      <span className="font-semibold text-text-primary">
                        {m.vendor} <span className="ml-1 font-mono text-[10px] font-normal text-text-muted">{m.id}</span>
                      </span>
                      <span className="font-mono text-[11px] text-text-muted">{formatRupiah(m.amount)}</span>
                    </div>
                    <table className="w-full border-collapse font-sans text-[11.5px]">
                      <thead>
                        <tr className="text-left text-text-muted">
                          <th className="px-3 py-1 font-medium">Warna · lengan</th>
                          <th className="px-3 py-1 text-right font-medium">Roll</th>
                          <th className="px-3 py-1 text-right font-medium">Kg (est.)</th>
                          <th className="px-3 py-1 text-right font-medium">Pcs (est.)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(m.po as MaterialPO).colorBreakdown.map((c) => (
                          <tr key={c.warna + c.lengan} className="border-t border-[#F1F4F7]">
                            <td className="px-3 py-1">
                              {c.warna} · {c.lengan}
                            </td>
                            <td className="px-3 py-1 text-right font-mono">{c.rollCount.toLocaleString("id-ID", { maximumFractionDigits: 1 })}</td>
                            <td className="px-3 py-1 text-right font-mono">{(c.rollCount * ROLL_KG_ESTIMATE).toLocaleString("id-ID", { maximumFractionDigits: 0 })}</td>
                            <td className="px-3 py-1 text-right font-mono">
                              {(materialPoColorPcs(m.po as MaterialPO, detail?.aduanRows ?? []).find((x) => x.warna === c.warna && x.lengan === c.lengan)?.pcs ?? 0).toLocaleString("id-ID")}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-md border border-[#E4E8EE] px-3 py-2 font-sans text-[11.5px] text-[#31414F]">
                <div>
                  Vendor produksi: <span className="font-semibold">{item.vendor}</span>
                </div>
                <div>
                  Total qty: <span className="font-mono font-semibold">{(item.po as MaklonPO).qty.toLocaleString("id-ID")} pcs</span>
                </div>
                <div>Kategori: {detail?.mrp.kategori ?? "—"}</div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Antrean approval PO untuk satu portal (Procurement Level 2 / SCM & Finance Level 3 / GM Level 4).
 *  Dua sub-tab (PO Material / PO Produksi); tiap tab: (1) menunggu persetujuan portal ini, (2) khusus Procurement --
 *  PO ditolak yang perlu diajukan ulang, (3) sedang berjalan di langkah lain (info), (4) sudah selesai. Aksi lewat
 *  approvePoStep / rejectPoStep / resubmitPo (Matriks Approval PO, migration 0055). */
export function PoApprovalQueue({ role }: { role: ApprovalRole }) {
  const materialPOs = useMrpStore((s) => s.materialPOs);
  const maklonPOs = useMrpStore((s) => s.maklonPOs);
  const mrpDetails = useMrpStore((s) => s.mrpDetails);
  const approvePoStep = useMrpStore((s) => s.approvePoStep);
  const rejectPoStep = useMrpStore((s) => s.rejectPoStep);
  const resubmitPo = useMrpStore((s) => s.resubmitPo);
  const hargaKain = useMrpStore((s) => s.hargaKain);
  const hargaKainPks = useMrpStore((s) => s.hargaKainPks);
  const hargaRib = useMrpStore((s) => s.hargaRib);
  const hargaKerahManset = useMrpStore((s) => s.hargaKerahManset);
  const kerahMansetSettings = useMrpStore((s) => s.kerahMansetSettings);
  const hargaMaklon = useMrpStore((s) => s.hargaMaklon);
  const itemSellingPrices = useMrpStore((s) => s.itemSellingPrices);
  const deliveryKolis = useMrpStore((s) => s.deliveryKolis);
  const ekspedisiRates = useMrpStore((s) => s.ekspedisiRates);
  const rawInvoices = useMrpStore((s) => s.invoices);
  // Penanda perubahan saja: Mapping Warna dibaca sellingPriceFor lewat variabel modul yang diisi store.
  const warnaAliases = useMrpStore((s) => s.warnaAliases);

  const [tab, setTab] = useState<"MATERIAL" | "MAKLON">("MATERIAL");
  const [detailItem, setDetailItem] = useState<Item | null>(null);
  // Baris yang SEDANG diproses (per baris, bukan satu id global): tombol baris lain tetap normal; `bulk` = kemajuan "Setujui MRP ini / semua".
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const [bulk, setBulk] = useState<{ done: number; total: number } | null>(null);
  const search = "";
  const [error, setError] = useState<string | null>(null);
  const markBusy = (ids: string[], on: boolean) =>
    setBusyIds((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  const [rejecting, setRejecting] = useState<Item | null>(null);
  const [rejectNote, setRejectNote] = useState("");

  const items = useMemo<Item[]>(() => {
    const out: Item[] = [];
    const groups = new Map<string, Item>();
    for (const p of materialPOs) {
      if (p.status === "CANCELLED") continue;
      const state = poApprovalState(p);
      const it: Item = { type: "MATERIAL", id: p.id, mrpId: p.mrpId, vendor: VENDOR_PRODUKSI[p.vendorProduksi]?.name ?? p.vendorProduksi, supplier: p.supplier, amount: p.amount, po: p, state };
      if (state.legacy) {
        out.push({ ...it, members: [it] });
        continue;
      }
      // Satu baris per MRP + supplier + posisi approval yang sama.
      const key = [p.mrpId, p.supplier, p.approved, state.rejected, state.currentStep, state.pendingRoles.join("+"), state.level].join("|");
      const g = groups.get(key);
      if (!g) {
        const grouped: Item = { ...it, members: [it] };
        groups.set(key, grouped);
        out.push(grouped);
      } else {
        g.members!.push(it);
        g.amount += it.amount;
      }
    }
    for (const p of maklonPOs) {
      out.push({ type: "MAKLON", id: p.id, mrpId: p.mrpId, vendor: VENDOR_PRODUKSI[p.vendorProduksi]?.name ?? p.vendorProduksi, amount: p.amount, po: p, state: poApprovalState(p) });
    }
    return out;
  }, [materialPOs, maklonPOs]);

  // Estimasi HPP & rasio per baris (owner 2026-11-27), dihitung sekali per perubahan data (lib/mrp/poHppEstimate.ts).
  const hppCtx = useMemo<PoHppContext>(() => {
    const seg = segmenProdukLookup(mrpDetails);
    return {
      mrpDetails,
      materialPOs,
      hargaKain,
      hargaKainPks,
      hargaRib,
      hargaKerahManset,
      kerahMansetSettings,
      hargaMaklon,
      sellingPrices: itemSellingPrices,
      ongkir: ongkirPerPcsBySegmen(deliveryKolis, ekspedisiRates, mrpDetails),
      diskonRatio: diskonRatioBySupplier(rawInvoices),
      segmenOf: (m, w, l) => seg(m, w, l),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mrpDetails, materialPOs, hargaKain, hargaKainPks, hargaRib, hargaKerahManset, kerahMansetSettings, hargaMaklon, itemSellingPrices, deliveryKolis, ekspedisiRates, rawInvoices, warnaAliases]);
  const hppById = useMemo(() => {
    const m = new Map<string, PoHppEstimate>();
    for (const it of items) {
      if (it.type === "MATERIAL") m.set(it.id, estimateMaterialPosHpp((it.members ?? [it]).map((x) => x.po as MaterialPO), hppCtx));
      else {
        const po = it.po as MaklonPO;
        if (po.isFob) continue;
        m.set(it.id, estimateMaklonPoHpp(po.mrpId, po.vendorProduksi, aduanRowsOfPo(mrpDetailFor(po.mrpId, mrpDetails), po, maklonPOs), hppCtx));
      }
    }
    return m;
  }, [items, hppCtx, mrpDetails, maklonPOs]);
  const hppOf = (i: Item) => hppById.get(i.id);
  const hppGroup = (list: Item[]) => mergeHppEstimates(list.map(hppOf).filter((e): e is PoHppEstimate => !!e));

  // Portal SCM dibedakan per username (scm02 = Asisten Manager L2, scm01 = SCM Manager L3); akun utama SCM tidak bisa menyetujui.
  const scmUsername = useInternalAuthStore((s) => s.actors.scm?.username);
  const scmPosition = scmPositionOf(scmUsername);
  const isMine = (i: Item) =>
    !i.po.approved && !i.state.legacy && !i.state.rejected && i.state.pendingRoles.includes(role) && (role !== "scm" || scmMayActAtStep(scmUsername, i.state.currentStep));

  // Label jabatan penyetuju di judul/konfirmasi: portal SCM memakai jabatan akun yang login (Asisten Manager / SCM Manager).
  const roleLabel = role === "scm" ? (scmPosition ? SCM_POSITION_LABEL[scmPosition] : "SCM") : APPROVAL_ROLE_LABEL[role];

  const needle = search.trim().toLowerCase();
  const matchesSearch = (i: Item) =>
    !needle || [i.mrpId, i.vendor, i.supplier ?? "", i.id, ...(i.members ?? []).flatMap((m) => [m.vendor, m.id])].some((t) => t.toLowerCase().includes(needle));
  const tabItems = items.filter((i) => i.type === tab && matchesSearch(i));
  const mine = tabItems.filter(isMine);
  const rejected = role === "procurement" ? tabItems.filter((i) => !i.po.approved && i.state.rejected) : [];
  // `state.approved` (bukan hanya flag po.approved): persetujuan terakhir yang baru dicatat secara optimistic langsung terhitung selesai.
  const others = tabItems.filter((i) => !i.state.approved && !i.state.legacy && !i.state.rejected && !isMine(i));
  // Sudah tuntas SEMUA level (approved=true). Legacy (PO sebelum matriks ini ada) TIDAK ikut -- tidak ada chain-nya.
  const done = tabItems.filter((i) => i.state.approved && !i.state.legacy);
  const totalMine = mine.reduce((s, i) => s + i.amount, 0);
  const overdueMine = mine.filter((i) => i.state.overdue).length;

  async function run(item: Item, fn: () => Promise<void>) {
    markBusy([item.id], true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Aksi gagal.");
    } finally {
      markBusy([item.id], false);
    }
  }

  // Setujui sekaligus satu daftar PO (semua yang menunggu / semua PO satu MRP). `scope` hanya untuk teks konfirmasi.
  async function approveItems(list: Item[], scope?: string) {
    if (list.length === 0) return;
    const ok = await confirmDialog({
      title: scope ? `Setujui ${list.length} PO di MRP ${scope}?` : `Setujui ${list.length} PO sekaligus?`,
      message: `Total ${formatRupiah(list.reduce((s, i) => s + i.amount, 0))}, disetujui sebagai ${roleLabel}.`,
      confirmLabel: scope ? "Setujui MRP ini" : "Setujui semua",
    });
    if (!ok) return;
    setError(null);
    markBusy(list.map((i) => i.id), true);
    setBulk({ done: 0, total: list.length });
    let finished = 0;
    for (const it of list) {
      try {
        await approvePoStep(it.type, it.id, role);
      } catch (e) {
        setError(`${it.id}: ${e instanceof Error ? e.message : "gagal"}`);
        break;
      } finally {
        markBusy([it.id], false);
      }
      finished++;
      setBulk({ done: finished, total: list.length });
    }
    // Sisa yang tidak sempat diproses (berhenti karena error) dilepas lagi.
    markBusy(list.map((i) => i.id), false);
    setBulk(null);
  }

  // Redesign 2026-11-16 (pola PPIC, owner: "SCM hanya approval dan monitoring, tampilan sama dengan modul lain"): empat bagian terpisah
  // (menunggu Anda, ditolak, langkah lain, selesai) jadi SATU tabel bersama per tab. Posisi tiap baris jadi filter "Posisi"; kartu di atas diklik
  // = filter Posisi; bawaan = "Menunggu Anda". Aksi (Lihat detail, Setujui, Tolak, Ajukan ulang) tetap per baris, logika tidak berubah.
  const qtyOfItem = (it: Item): number => (it.type === "MAKLON" ? (it.po as MaklonPO).qty : (it.members ?? [it]).reduce((s, m) => s + (m.po as MaterialPO).rollCount, 0));
  const showPcs = tab === "MATERIAL";
  const pcsOfItem = (it: Item): number =>
    it.type === "MAKLON" ? (it.po as MaklonPO).qty : (it.members ?? [it]).reduce((s, m) => s + materialPoPcs(m.po as MaterialPO, mrpDetailFor(m.mrpId, mrpDetails)?.aduanRows ?? []), 0);
  const POS_MINE = "Menunggu Anda";
  const POS_REJECTED = "Ditolak";
  const POS_OTHER = "Di langkah lain";
  const POS_DONE = "Selesai";
  const positionOf = (i: Item): string => (isMine(i) ? POS_MINE : i.state.rejected && !i.po.approved ? POS_REJECTED : i.state.approved ? POS_DONE : POS_OTHER);
  const createdOf = (id: string) => mrpDetails.find((d) => d.mrp.id === id)?.dates?.created;
  const tableItems = tabItems
    .filter((i) => !i.state.legacy)
    .sort((a, b) => compareNewestFirst(createdOf(a.mrpId), a.mrpId, createdOf(b.mrpId), b.mrpId));
  const [preset, setPreset] = useState<{ nonce: number; filters: Record<string, string[]>; card: string }>({ nonce: 0, filters: {}, card: "" });
  // Bawaan: kalau ada PO yang menunggu akun ini, tabel langsung menyaring "Menunggu Anda" (sekali saat data pertama tersedia).
  const autoPreset = useRef(false);
  const mineCount = mine.length;
  useEffect(() => {
    if (autoPreset.current || mineCount === 0) return;
    autoPreset.current = true;
    const t = setTimeout(() => setPreset((p) => ({ nonce: p.nonce + 1, filters: { Posisi: [POS_MINE] }, card: "mine" })), 0);
    return () => clearTimeout(t);
  }, [mineCount]);
  const [shownKeys, setShownKeys] = useState<Set<string> | null>(null);
  const shownMine = mine.filter((i) => !shownKeys || shownKeys.has(i.id));
  const cardClick = (card: string, pos: string) =>
    setPreset((p) => (p.card === card ? { nonce: p.nonce + 1, filters: {} as Record<string, string[]>, card: "" } : { nonce: p.nonce + 1, filters: { Posisi: [pos] }, card }));

  const columns: ColumnDef<Item>[] = [
    {
      key: "sysadmin",
      label: "Aksi Sysadmin",
      default: true,
      sysadmin: true,
      render: (it) => (it.type === "MATERIAL" ? (it.members ?? [it]).map((m) => <SysadminPanel key={m.id} actions={materialPoCorrections(m.po as MaterialPO)} />) : <SysadminPanel actions={maklonPoCorrections(it.po as MaklonPO)} />),
    },
    { key: "mrp", label: "No. MRP", default: false, aggregate: aggSame((i) => i.mrpId), render: (i) => <span className="font-mono">{i.mrpId}</span> },
    { key: "po", label: "No PO / Vendor", default: true, render: (i) => <span className="block max-w-[360px] truncate font-mono text-[11px] text-text-muted" title={itemSubtitle(i)}>{itemSubtitle(i)}</span> },
    {
      key: "qty",
      label: showPcs ? "Roll" : "Qty (pcs)",
      default: true,
      align: "right",
      aggregate: aggSum((i) => qtyOfItem(i), (n) => <span className="font-semibold">{formatPcs(n)}</span>),
      render: (i) => <span className="font-mono">{formatPcs(qtyOfItem(i))}</span>,
    },
    ...(showPcs
      ? [
          {
            key: "pcs",
            label: "Qty Produksi (pcs)",
            default: true,
            align: "right" as const,
            info: { title: "Qty Produksi", body: <p>Estimasi pcs dari roll PO ini: jumlah roll x pcs per roll di aduan pola vendor produksi yang sama (target rencana MRP).</p> },
            aggregate: aggSum<Item>((i) => pcsOfItem(i), (n) => <span className="font-semibold">{formatPcs(n)}</span>),
            render: (i: Item) => <span className="font-mono">{formatPcs(pcsOfItem(i))}</span>,
          },
        ]
      : []),
    { key: "nilai", label: "Nilai", default: true, align: "right", aggregate: aggSum((i) => i.amount, (n) => <span className="font-semibold">{formatRupiah(n)}</span>), render: (i) => <span className="font-mono font-medium">{formatRupiah(i.amount)}</span> },
    {
      key: "hpp",
      label: "Est. HPP",
      default: true,
      align: "right",
      info: {
        title: "Estimasi HPP",
        body: (
          <p>
            Bahan + rib - diskon supplier + maklon (matriks) + ongkir rata-rata per kategori, untuk pcs yang dicakup PO ini. Angka kecil = HPP per pcs. Rincian di
            Lihat detail.
          </p>
        ),
      },
      aggregate: (list: Item[]) => {
        const e = hppGroup(list);
        return <span className="font-semibold">{e.pcs > 0 ? formatRupiah(Math.round(e.hpp)) : "—"}</span>;
      },
      render: (i: Item) => {
        const e = hppOf(i);
        if (!e || e.pcs <= 0) return <span className="text-text-muted">—</span>;
        return (
          <span className="block text-right font-mono">
            {formatRupiah(Math.round(e.hpp))}
            <span className="block text-[10px] text-text-muted">{formatRupiah(Math.round(e.hppPerPcs))}/pcs</span>
          </span>
        );
      },
    },
    {
      key: "hppPct",
      label: "% HPP",
      default: true,
      align: "right",
      info: { title: "Rasio HPP", body: <p>Estimasi HPP / nilai jual (harga jual Master SKU x qty per size). Hijau sampai 70%, kuning sampai 80%, merah di atasnya.</p> },
      aggregate: (list: Item[]) => {
        const e = hppGroup(list);
        return <span className={"font-semibold " + pctTone(e.pct)}>{pctText(e.pct)}</span>;
      },
      render: (i: Item) => {
        const e = hppOf(i);
        return <span className={"font-mono font-semibold " + pctTone(e?.pct ?? null)}>{e && e.pcs > 0 ? pctText(e.pct) : "—"}</span>;
      },
    },
    {
      key: "status",
      label: "Status Approval",
      default: true,
      render: (it) => (
        <div>
          <ApprovalProgress po={it.po} state={it.state} />
          {it.state.slaDueAt && !it.state.approved && (
            <div className={"mt-1 text-[10px] " + (it.state.overdue ? "font-semibold text-danger-fg" : "text-text-muted")}>
              {it.state.overdue ? "⚠ Lewat SLA · " : "Batas SLA · "}
              {fmtTime(it.state.slaDueAt)}
            </div>
          )}
          {it.state.rejected && it.state.rejectNote && (
            <div className="mt-1 max-w-[320px] whitespace-normal rounded-md border border-[#EFC9C4] bg-danger-bg px-2 py-1 text-[10.5px] text-danger-fg">
              Ditolak {it.state.rejectedBy ? APPROVAL_ROLE_LABEL[it.state.rejectedBy] : ""}: {it.state.rejectNote}
            </div>
          )}
        </div>
      ),
    },
    {
      key: "aksi",
      label: "Aksi",
      default: true,
      render: (it) => {
        const busy = busyIds.has(it.id);
        const pos = positionOf(it);
        return (
          <div className="flex items-center justify-end gap-2 whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
            <button onClick={() => setDetailItem(it)} className={DETAIL_BTN}>
              Lihat detail
            </button>
            {pos === POS_MINE && (
              <>
                <button
                  onClick={() => {
                    setRejecting(it);
                    setRejectNote("");
                  }}
                  disabled={busy}
                  className={REJECT_BTN}
                >
                  Tolak
                </button>
                <button onClick={() => run(it, async () => await approvePoStep(it.type, it.id, role))} disabled={busy} className={OUTLINE_BTN}>
                  {busy ? <Spinner label="Memproses…" /> : "Setujui"}
                </button>
              </>
            )}
            {pos === POS_REJECTED && role === "procurement" && (
              <button onClick={() => run(it, async () => await resubmitPo(it.type, it.id))} disabled={busy} className={OUTLINE_BTN}>
                {busy ? <Spinner label="Memproses…" /> : "Ajukan ulang"}
              </button>
            )}
          </div>
        );
      },
    },
  ];

  const noun = tab === "MATERIAL" ? "PO Material" : "PO Produksi";

  return (
    <div className="flex flex-col gap-4">
      <MatrixReference />
      {role === "scm" && (
        <div className="rounded-md border border-[#CFE0EF] bg-info-bg px-4 py-2.5 font-sans text-[11.5px] leading-[1.5] text-info-fg">
          {scmPosition ? (
            <>
              Anda login sebagai <b>{scmUsername}</b> — <b>{SCM_POSITION_LABEL[scmPosition]}</b>: hanya PO di langkah {scmPosition === "asisten" ? "Level 2" : "Level 3 (SCM Manager)"} yang bisa Anda setujui atau tolak.
            </>
          ) : (
            <>Akun ini tidak bisa menyetujui PO. Login dengan akun bernama: <b>scm02</b> (Asisten Manager, Level 2) atau <b>scm01</b> (SCM Manager, Level 3).</>
          )}
        </div>
      )}
      <Tabs
        items={[
          // Badge tab = PO yang approval-nya masih berjalan di semua level (bukan hanya giliran role ini), tetap ada selama belum tuntas (owner 2026-11-02).
          { key: "MATERIAL", label: "PO Material", badge: countPoInProgress(materialPOs, maklonPOs, "MATERIAL") },
          { key: "MAKLON", label: "PO Produksi", badge: countPoInProgress(materialPOs, maklonPOs, "MAKLON") },
        ]}
        active={tab}
        onChange={(key) => setTab(key as "MATERIAL" | "MAKLON")}
      />
      {error && <div className="rounded-md border border-danger bg-danger-bg px-4 py-2.5 font-sans text-[12px] text-danger-fg">{error}</div>}
      {bulk && (
        <div className="rounded-md border border-[#CFE0EF] bg-info-bg px-4 py-2.5 font-sans text-[12px] text-info-fg">
          <div className="flex items-center justify-between">
            <Spinner label={`Memproses ${bulk.done} dari ${bulk.total} PO…`} />
            <span className="text-[11px]">Jangan tutup halaman</span>
          </div>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white">
            <div className="h-full rounded-full bg-accent-blue transition-all" style={{ width: `${(bulk.done / bulk.total) * 100}%` }} />
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard label="Menunggu Anda" value={mine.length} sub={`${formatRupiah(totalMine)}${overdueMine > 0 ? ` · ${overdueMine} lewat SLA` : ""}`} accent="orange" active={preset.card === "mine"} onClick={() => cardClick("mine", POS_MINE)} />
        {role === "procurement" ? (
          <KpiCard label="Ditolak" value={rejected.length} sub="perlu diperbaiki dan diajukan ulang" accent="purple" active={preset.card === "rejected"} onClick={() => cardClick("rejected", POS_REJECTED)} />
        ) : (
          <KpiCard label="Lewat SLA" value={overdueMine} sub="dari yang menunggu Anda" accent="purple" />
        )}
        <KpiCard label="Di langkah lain" value={others.length} sub="menunggu approver lain" accent="blue" active={preset.card === "other"} onClick={() => cardClick("other", POS_OTHER)} />
        <KpiCard label="Selesai" value={done.length} sub="semua level" accent="teal" active={preset.card === "done"} onClick={() => cardClick("done", POS_DONE)} />
      </div>

      <DataTable<Item>
        title={`${noun} — persetujuan ${roleLabel}`}
        headerActions={
          shownMine.length > 1 ? (
            <button onClick={() => approveItems(shownMine)} disabled={bulk != null} className={OUTLINE_BTN + " !w-auto px-3"}>
              {bulk ? <Spinner label="Memproses…" /> : `Setujui yang tampil (${shownMine.length})`}
            </button>
          ) : undefined
        }
        columns={columns}
        rows={tableItems}
        keyOf={(i) => i.id}
        firstColumnLabel={tab === "MATERIAL" ? "Supplier" : "Vendor Produksi"}
        firstColumnRender={(i) => <span className="font-semibold">{i.type === "MATERIAL" ? i.supplier ?? i.vendor : i.vendor}</span>}
        filterDefs={[
          { label: "Posisi", options: [POS_MINE, POS_REJECTED, POS_OTHER, POS_DONE].filter((p) => tableItems.some((i) => positionOf(i) === p)), test: (i, v) => positionOf(i) === v },
          { label: "No. MRP", options: Array.from(new Set(tableItems.map((i) => i.mrpId))), test: (i, v) => i.mrpId === v },
          { label: tab === "MATERIAL" ? "Supplier" : "Vendor", options: Array.from(new Set(tableItems.map((i) => (i.type === "MATERIAL" ? i.supplier ?? "" : i.vendor)))).filter(Boolean).sort(), test: (i, v) => (i.type === "MATERIAL" ? i.supplier ?? "" : i.vendor) === v },
          { label: "Status approval", options: Array.from(new Set(tableItems.map((i) => poApprovalSummary(i.state)))), test: (i, v) => poApprovalSummary(i.state) === v },
        ]}
        filterPreset={preset}
        defaultGroupBy={["No. MRP"]}
        search={{ placeholder: "Cari No. MRP, vendor, supplier, atau No. PO…", getText: (i) => [i.mrpId, i.vendor, i.supplier ?? "", i.id, ...(i.members ?? []).flatMap((m) => [m.vendor, m.id])].join(" ") }}
        onFilteredRows={(list) => setShownKeys(new Set(list.map((i) => i.id)))}
        emptyText={`Tidak ada ${noun} untuk filter ini.`}
      />

      {detailItem && <DetailModal item={detailItem} est={hppOf(detailItem)} onClose={() => setDetailItem(null)} />}

      {rejecting && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0B131B]/45 p-4" onClick={() => setRejecting(null)}>
          <div className="w-full max-w-[440px] rounded-lg bg-white shadow-[0_8px_24px_rgba(11,19,27,.2)]" onClick={(e) => e.stopPropagation()}>
            <div className="border-b border-border-subtle px-5 py-3.5 font-sans text-[13px] font-semibold text-text-primary">Tolak {noun} {itemTitle(rejecting)}</div>
            <div className="px-5 py-4">
              <div className="font-sans text-[11.5px] text-text-muted">PO kembali ke Procurement untuk diperbaiki; approval mulai lagi dari awal setelah diajukan ulang. Alasan wajib diisi.</div>
              <textarea value={rejectNote} onChange={(e) => setRejectNote(e.target.value)} rows={3} className="input mt-2 w-full" placeholder="Alasan penolakan…" autoFocus />
            </div>
            <div className="flex justify-end gap-2 border-t border-border-subtle px-5 py-3.5">
              <button onClick={() => setRejecting(null)} className="rounded-md border border-[#CBD5DF] bg-white px-3.5 py-[7px] font-sans text-xs font-semibold text-action-primary">
                Batal
              </button>
              <Button
                onClick={() => {
                  const it = rejecting;
                  const note = rejectNote.trim();
                  if (!note) return;
                  setRejecting(null);
                  void run(it, async () => {
                    await rejectPoStep(it.type, it.id, role, note);
                  });
                }}
                disabled={!rejectNote.trim()}
                variant="danger"
                size="sm"
              >
                Tolak PO
              </Button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
