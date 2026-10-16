"use client";

import { useMemo, useState } from "react";
import { confirmDialog } from "@/components/ui/confirm-dialog";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";
import { Tabs } from "@/components/ui/tabs";
import { PoDownloadModal, type PoDownloadRequest } from "@/components/procurement/po-download-modal";
import { SysadminPanel } from "@/components/sysadmin/correction-dialog";
import { maklonPoCorrections, materialPoCorrections } from "@/components/sysadmin/procurement-corrections";
import { useMrpStore } from "@/lib/mrp/store";
import { formatRupiah, formatDate, mrpDetailFor } from "@/lib/mrp/derive";
import { VENDOR_PRODUKSI, ROLL_KG_ESTIMATE } from "@/lib/mrp/seed";
import {
  APPROVAL_LEVEL_TABLE,
  APPROVAL_ROLE_LABEL,
  APPROVAL_STEP_LABEL,
  poApprovalSignBoxes,
  poApprovalState,
  poApprovalSummary,
  type ApprovalRole,
  type PoApprovalSignBox,
  type PoApprovalState,
} from "@/lib/mrp/poApproval";
import type { MaklonPO, MaterialPO } from "@/lib/mrp/types";

/** `members`: PO Material satu supplier dalam satu MRP digabung jadi SATU baris (approval PO Material berlaku per supplier,
 *  levelnya dari total supplier); `id` = PO pertama (target aksi -- server menerapkannya ke semua PO satu supplier). */
type Item = { type: "MATERIAL" | "MAKLON"; id: string; mrpId: string; vendor: string; supplier?: string; amount: number; po: MaterialPO | MaklonPO; state: PoApprovalState; members?: Item[] };

function itemTitle(item: Item): string {
  return item.type === "MATERIAL" ? `${item.mrpId} · ${item.supplier}` : `${item.mrpId} · ${item.vendor}`;
}

function itemSubtitle(item: Item): string {
  if (item.type === "MAKLON") return item.id;
  const members = item.members ?? [item];
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
            {prev && (prev.step !== b.step ? <span className="text-[10px] text-text-muted">›</span> : <span className="text-[10px] text-text-muted">+</span>)}
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
function DetailModal({ item, onClose }: { item: Item; onClose: () => void }) {
  const mrpDetails = useMrpStore((s) => s.mrpDetails);
  const detail = mrpDetailFor(item.mrpId, mrpDetails);
  const st = item.state;
  const boxes = approvalBoxes(item.po, st);
  const members = item.members ?? [item];
  const totalRoll = item.type === "MATERIAL" ? members.reduce((sum, m) => sum + (m.po as MaterialPO).rollCount, 0) : 0;
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
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {[
              ["Nilai PO", formatRupiah(item.amount)],
              ["Level approval", st.legacy || st.level == null ? "Alur lama" : `Level ${st.level}`],
              ["Tanggal PO", detail?.dates.poSent ? formatDate(detail.dates.poSent) : "—"],
              [item.type === "MATERIAL" ? "Total roll" : "Total qty", item.type === "MATERIAL" ? `${totalRoll.toLocaleString("id-ID", { maximumFractionDigits: 1 })} roll` : `${(item.po as MaklonPO).qty.toLocaleString("id-ID")} pcs`],
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

  const [tab, setTab] = useState<"MATERIAL" | "MAKLON">("MATERIAL");
  const [detailItem, setDetailItem] = useState<Item | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<Item | null>(null);
  const [rejectNote, setRejectNote] = useState("");
  const [download, setDownload] = useState<PoDownloadRequest | null>(null);
  // Section "Sudah selesai" default TERTUTUP -- bisa berisi banyak PO seiring waktu.
  const [doneOpen, setDoneOpen] = useState(false);

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

  const isMine = (i: Item) => !i.po.approved && !i.state.legacy && !i.state.rejected && i.state.pendingRoles.includes(role);
  const mineCount = (type: Item["type"]) => items.filter((i) => i.type === type && isMine(i)).length;

  const tabItems = items.filter((i) => i.type === tab);
  const mine = tabItems.filter(isMine);
  const rejected = role === "procurement" ? tabItems.filter((i) => !i.po.approved && i.state.rejected) : [];
  const others = tabItems.filter((i) => !i.po.approved && !i.state.legacy && !i.state.rejected && !i.state.pendingRoles.includes(role));
  // Sudah tuntas SEMUA level (approved=true). Legacy (PO sebelum matriks ini ada) TIDAK ikut -- tidak ada chain-nya.
  const done = tabItems.filter((i) => i.po.approved && !i.state.legacy);
  const totalMine = mine.reduce((s, i) => s + i.amount, 0);

  async function run(item: Item, fn: () => Promise<void>) {
    setBusyId(item.id);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Aksi gagal.");
    } finally {
      setBusyId(null);
    }
  }

  async function approveAll() {
    if (mine.length === 0) return;
    const ok = await confirmDialog({
      title: `Setujui ${mine.length} PO sekaligus?`,
      message: `Total ${formatRupiah(totalMine)}, disetujui sebagai ${APPROVAL_ROLE_LABEL[role]}.`,
      confirmLabel: "Setujui semua",
    });
    if (!ok) return;
    setError(null);
    for (const it of mine) {
      setBusyId(it.id);
      try {
        await approvePoStep(it.type, it.id, role);
      } catch (e) {
        setError(`${it.id}: ${e instanceof Error ? e.message : "gagal"}`);
        break;
      }
    }
    setBusyId(null);
  }

  function openDownload(item: Item) {
    if (item.type === "MATERIAL") setDownload({ kind: "material", pos: (item.members ?? [item]).map((m) => m.po as MaterialPO), baseName: `PO-${itemTitle(item).replace(/[^A-Za-z0-9]+/g, "-")}` });
    else setDownload({ kind: "maklon", pos: [item.po as MaklonPO], baseName: `PO-${item.id}` });
  }

  function renderRow(item: Item, actions: React.ReactNode) {
    const st = item.state;
    return (
      <div key={item.id} className="border-b border-[#F1F4F7] last:border-b-0">
        <div className="grid items-center gap-x-4 gap-y-2 px-4 py-3 font-sans text-xs text-[#31414F]" style={{ gridTemplateColumns: "minmax(200px,1.3fr) minmax(230px,1.5fr) 130px auto" }}>
          <div className="min-w-0">
            <div className="truncate text-[12.5px] font-semibold text-text-primary">{itemTitle(item)}</div>
            <div className="truncate text-[11px] text-text-muted" title={itemSubtitle(item)}>
              {itemSubtitle(item)}
            </div>
          </div>
          <div>
            <ApprovalProgress po={item.po} state={st} />
            {st.slaDueAt && (
              <div className={"mt-1 text-[10px] " + (st.overdue ? "font-semibold text-danger-fg" : "text-text-muted")}>
                {st.overdue ? "⚠ Lewat SLA · " : "Batas SLA · "}
                {fmtTime(st.slaDueAt)}
              </div>
            )}
          </div>
          <div className="text-right font-mono text-[12.5px] font-semibold text-text-primary">{formatRupiah(item.amount)}</div>
          <div className="flex items-center justify-end gap-1.5">
            <Button onClick={() => setDetailItem(item)} variant="ghost" size="xs">
              Lihat detail
            </Button>
            <Button onClick={() => openDownload(item)} variant="ghost" size="xs">
              PO
            </Button>
            {actions}
          </div>
        </div>
        {st.rejected && st.rejectNote && (
          <div className="mx-4 mb-2 rounded-md border border-[#EFC9C4] bg-danger-bg px-3 py-1.5 font-sans text-[11px] text-danger-fg">
            Ditolak {st.rejectedBy ? APPROVAL_ROLE_LABEL[st.rejectedBy] : ""}: {st.rejectNote}
          </div>
        )}
        {/* Koreksi Sysadmin (owner 2026-09-30): antrean ini dipakai bersama Procurement/SCM/GM, jadi 1
           tempat ini menutup ketiganya. `empty:hidden` -- wadah tidak makan ruang kalau bukan Sysadmin
           (SysadminActionsBar tidak merender apa pun). */}
        <div className="px-4 pb-2 empty:hidden">
          {item.type === "MATERIAL" ? (item.members ?? [item]).map((m) => <SysadminPanel key={m.id} actions={materialPoCorrections(m.po as MaterialPO)} />) : <SysadminPanel actions={maklonPoCorrections(item.po as MaklonPO)} />}
        </div>
      </div>
    );
  }

  const renderSection = (title: string, count: number, hint: string | undefined, children: React.ReactNode) => (
    <div className="overflow-hidden rounded-lg border border-border-subtle bg-surface-card">
      <div className="flex items-center gap-2 border-b border-border-subtle px-4 py-3">
        <span className="font-sans text-[13px] font-semibold text-text-primary">{title}</span>
        <span className="rounded-full bg-[#EEF1F4] px-2 py-0.5 font-mono text-[10px] font-semibold text-text-muted">{count}</span>
        {hint && <span className="ml-auto font-sans text-[11px] text-text-muted">{hint}</span>}
      </div>
      {children}
    </div>
  );

  const noun = tab === "MATERIAL" ? "PO Material" : "PO Produksi";

  return (
    <div className="flex flex-col gap-4">
      <MatrixReference />
      <Tabs
        items={[
          { key: "MATERIAL", label: "PO Material", badge: mineCount("MATERIAL") },
          { key: "MAKLON", label: "PO Produksi", badge: mineCount("MAKLON") },
        ]}
        active={tab}
        onChange={(key) => setTab(key as "MATERIAL" | "MAKLON")}
      />
      {error && <div className="rounded-md border border-danger bg-danger-bg px-4 py-2.5 font-sans text-[12px] text-danger-fg">{error}</div>}

      {renderSection(
        `Menunggu persetujuan ${APPROVAL_ROLE_LABEL[role]}`,
        mine.length,
        mine.length > 0 ? `Total ${formatRupiah(totalMine)}` : undefined,
        mine.length === 0 ? (
          <div className="px-4 py-6 text-center font-sans text-xs text-text-muted">Tidak ada {noun} yang menunggu persetujuan Anda.</div>
        ) : (
          <>
            {mine.map((it) =>
              renderRow(
                it,
                <>
                  <Button
                    onClick={() =>
                      run(it, async () => {
                        await approvePoStep(it.type, it.id, role);
                      })
                    }
                    disabled={busyId != null}
                    variant="primary"
                    size="xs"
                  >
                    {busyId === it.id ? "…" : "Setujui"}
                  </Button>
                  <Button
                    onClick={() => {
                      setRejecting(it);
                      setRejectNote("");
                    }}
                    disabled={busyId != null}
                    variant="danger"
                    size="xs"
                  >
                    Tolak
                  </Button>
                </>
              )
            )}
            {mine.length > 1 && (
              <div className="flex justify-end border-t border-[#F1F4F7] px-4 py-2.5">
                <Button onClick={approveAll} disabled={busyId != null} variant="primary" size="sm">
                  Setujui semua ({mine.length})
                </Button>
              </div>
            )}
          </>
        )
      )}

      {role === "procurement" &&
        renderSection(
          "Ditolak — perlu diperbaiki & diajukan ulang",
          rejected.length,
          undefined,
          rejected.length === 0 ? (
            <div className="px-4 py-5 text-center font-sans text-xs text-text-muted">Tidak ada {noun} yang ditolak.</div>
          ) : (
            rejected.map((it) =>
              renderRow(
                it,
                <Button
                  onClick={() =>
                    run(it, async () => {
                      await resubmitPo(it.type, it.id);
                    })
                  }
                  disabled={busyId != null}
                  variant="primary"
                  size="xs"
                >
                  {busyId === it.id ? "…" : "Ajukan ulang"}
                </Button>
              )
            )
          )
        )}

      {renderSection(
        "Sedang berjalan di langkah lain",
        others.length,
        "hanya informasi",
        others.length === 0 ? <div className="px-4 py-5 text-center font-sans text-xs text-text-muted">Tidak ada.</div> : others.map((it) => renderRow(it, null))
      )}

      {/* PO yang sudah TUNTAS semua level tetap kelihatan di sini, lengkap dengan siapa yang menyetujui -- bukan cuma
         menghilang begitu approved=true. Default tertutup supaya halaman tidak penuh begitu datanya banyak. */}
      <div className="overflow-hidden rounded-lg border border-border-subtle bg-surface-card">
        <button onClick={() => setDoneOpen((v) => !v)} className="flex w-full items-center gap-2 px-4 py-3 text-left">
          <span className="font-sans text-[13px] font-semibold text-text-primary">Sudah selesai (semua level)</span>
          <span className="rounded-full bg-[#EEF1F4] px-2 py-0.5 font-mono text-[10px] font-semibold text-text-muted">{done.length}</span>
          <span className="ml-auto text-text-muted">{doneOpen ? "▾" : "▸"}</span>
        </button>
        {doneOpen && (
          <div className="border-t border-border-subtle">
            {done.length === 0 ? (
              <div className="px-4 py-5 text-center font-sans text-xs text-text-muted">Belum ada {noun} yang selesai lewat matriks approval ini.</div>
            ) : (
              done.map((it) => renderRow(it, null))
            )}
          </div>
        )}
      </div>

      {detailItem && <DetailModal item={detailItem} onClose={() => setDetailItem(null)} />}

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

      {download && <PoDownloadModal request={download} mrpDetails={mrpDetails} onClose={() => setDownload(null)} />}
    </div>
  );
}
