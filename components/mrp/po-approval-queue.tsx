"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";
import { PoDownloadModal, type PoDownloadRequest } from "@/components/procurement/po-download-modal";
import { SysadminPanel } from "@/components/sysadmin/correction-dialog";
import { maklonPoCorrections, materialPoCorrections } from "@/components/sysadmin/procurement-corrections";
import { useMrpStore } from "@/lib/mrp/store";
import { formatRupiah, formatDate, mrpDetailFor } from "@/lib/mrp/derive";
import { VENDOR_PRODUKSI, ROLL_KG_ESTIMATE } from "@/lib/mrp/seed";
import { APPROVAL_LEVEL_TABLE, APPROVAL_ROLE_LABEL, APPROVAL_STEP_LABEL, poApprovalState, poApprovalSummary, type ApprovalRole, type PoApprovalState } from "@/lib/mrp/poApproval";
import type { MaklonPO, MaterialPO } from "@/lib/mrp/types";

type Item = { type: "MATERIAL" | "MAKLON"; id: string; mrpId: string; vendor: string; supplier?: string; amount: number; po: MaterialPO | MaklonPO; state: PoApprovalState };

function fmtTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("id-ID", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

/** Bagan langkah approval (Level 1..N) -- hijau = selesai, kuning = sedang menunggu, abu = belum. */
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
        </div>
      )}
    </div>
  );
}

function ItemDetail({ item }: { item: Item }) {
  const mrpDetails = useMrpStore((s) => s.mrpDetails);
  const detail = mrpDetailFor(item.mrpId, mrpDetails);
  return (
    <div className="grid gap-4 border-t border-[#F1F4F7] bg-[#FBFCFD] px-4 py-3 md:grid-cols-2">
      <div>
        <div className="mb-1.5 font-sans text-[10.5px] font-medium uppercase tracking-wider text-text-muted">Rincian PO</div>
        {item.type === "MATERIAL" ? (
          <table className="w-full border-collapse font-sans text-[11.5px]">
            <thead>
              <tr className="text-left text-text-muted">
                <th className="py-1">Warna · lengan</th>
                <th className="py-1 text-right">Roll</th>
                <th className="py-1 text-right">Kg (est.)</th>
              </tr>
            </thead>
            <tbody>
              {(item.po as MaterialPO).colorBreakdown.map((c) => (
                <tr key={c.warna + c.lengan} className="border-t border-[#F1F4F7]">
                  <td className="py-1">
                    {c.warna} · {c.lengan}
                  </td>
                  <td className="py-1 text-right font-mono">{c.rollCount.toLocaleString("id-ID", { maximumFractionDigits: 1 })}</td>
                  <td className="py-1 text-right font-mono">{(c.rollCount * ROLL_KG_ESTIMATE).toLocaleString("id-ID", { maximumFractionDigits: 0 })}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="font-sans text-[11.5px] text-[#31414F]">
            <div>Total qty: <span className="font-mono font-semibold">{(item.po as MaklonPO).qty.toLocaleString("id-ID")} pcs</span></div>
            <div>Kategori: {detail?.mrp.kategori ?? "—"}</div>
          </div>
        )}
        <div className="mt-2 font-sans text-[11px] text-text-muted">Tanggal PO: {detail?.dates.poSent ? formatDate(detail.dates.poSent) : "—"}</div>
      </div>
      <div>
        <div className="mb-1.5 font-sans text-[10.5px] font-medium uppercase tracking-wider text-text-muted">Riwayat approval</div>
        {item.state.cycle.length === 0 ? (
          <div className="font-sans text-[11.5px] text-text-muted">Belum ada riwayat.</div>
        ) : (
          <ul className="flex flex-col gap-1 font-sans text-[11.5px] text-[#31414F]">
            {item.state.cycle.map((e, i) => (
              <li key={i}>
                <span className={e.action === "APPROVED" ? "text-success-fg" : "font-semibold text-danger-fg"}>{e.action === "APPROVED" ? "✓" : "✕"}</span> {APPROVAL_STEP_LABEL[e.step] ?? `Langkah ${e.step}`} — {APPROVAL_ROLE_LABEL[e.role]}
                {/* Item revisi 2026-09-29 (migration 0060, owner: "biar tau siapa PIC-nya") --
                   nama orang yang klik, kalau ada (entri lama sebelum revisi ini tidak punya field
                   ini sama sekali, jadi cukup disembunyikan, bukan tampil "undefined"). */}
                {e.actorName && <span className="font-medium text-text-primary"> ({e.actorName})</span>}
                <span className="text-text-muted"> · {fmtTime(e.at)}</span>
                {e.note && <span className="text-text-muted"> · “{e.note}”</span>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/** Antrean approval PO untuk satu portal (Procurement Level 2 / SCM & Finance Level 3 / GM Level 4).
 *  Menampilkan: (1) menunggu persetujuan portal ini, (2) khusus Procurement -- PO ditolak yang perlu
 *  diajukan ulang, (3) PO yang sedang berjalan di langkah lain (info). Aksi lewat approvePoStep /
 *  rejectPoStep / resubmitPo (Matriks Approval PO, migration 0055). */
export function PoApprovalQueue({ role }: { role: ApprovalRole }) {
  const materialPOs = useMrpStore((s) => s.materialPOs);
  const maklonPOs = useMrpStore((s) => s.maklonPOs);
  const mrpDetails = useMrpStore((s) => s.mrpDetails);
  const approvePoStep = useMrpStore((s) => s.approvePoStep);
  const rejectPoStep = useMrpStore((s) => s.rejectPoStep);
  const resubmitPo = useMrpStore((s) => s.resubmitPo);

  const [expanded, setExpanded] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<Item | null>(null);
  const [rejectNote, setRejectNote] = useState("");
  const [download, setDownload] = useState<PoDownloadRequest | null>(null);
  // Section "Sudah selesai" (revisi 2026-09-28) default TERTUTUP -- bisa berisi banyak PO seiring
  // waktu, tidak perlu selalu terbuka penuh seperti 3 section lain yang memang perlu aksi/perhatian.
  const [doneOpen, setDoneOpen] = useState(false);

  // Revisi 2026-09-28 (owner: "kita bisa tau juga siapa2 sudah approve, karena berlapis") -- DULU
  // PO yang sudah `approved` (semua level tuntas) SAMA SEKALI tidak masuk `items` (dianggap sudah
  // "keluar" dari antrean). Sekarang tetap diikutkan supaya bisa ditampilkan di section "Sudah
  // selesai" di bawah (siapa approve di level mana, lewat ApprovalChain) -- TIDAK mengubah `mine`/
  // `rejected`/`others` sama sekali (ketiganya masih tetap exclude PO yang sudah approved, lihat
  // filter `!po.approved` yang ditambah di `others`).
  const items = useMemo<Item[]>(() => {
    const out: Item[] = [];
    for (const p of materialPOs) {
      if (p.status === "CANCELLED") continue;
      out.push({ type: "MATERIAL", id: p.id, mrpId: p.mrpId, vendor: VENDOR_PRODUKSI[p.vendorProduksi]?.name ?? p.vendorProduksi, supplier: p.supplier, amount: p.amount, po: p, state: poApprovalState(p) });
    }
    for (const p of maklonPOs) {
      out.push({ type: "MAKLON", id: p.id, mrpId: p.mrpId, vendor: VENDOR_PRODUKSI[p.vendorProduksi]?.name ?? p.vendorProduksi, amount: p.amount, po: p, state: poApprovalState(p) });
    }
    return out;
  }, [materialPOs, maklonPOs]);

  const mine = items.filter((i) => !i.po.approved && !i.state.legacy && !i.state.rejected && i.state.pendingRoles.includes(role));
  const rejected = role === "procurement" ? items.filter((i) => !i.po.approved && i.state.rejected) : [];
  const others = items.filter((i) => !i.po.approved && !i.state.legacy && !i.state.rejected && !i.state.pendingRoles.includes(role));
  // Sudah tuntas SEMUA level (approved=true) -- terlepas level berapa yang menyudahinya (1/2/3/4),
  // supaya kelihatan juga PO Level 1-2 yang selesai di Procurement TANPA pernah mampir ke FAT/SCM/GM.
  // Legacy (PO sebelum matriks ini ada) TIDAK ikut -- tidak ada chain-nya untuk ditampilkan.
  const done = items.filter((i) => i.po.approved && !i.state.legacy);
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
    if (!window.confirm(`Setujui ${mine.length} PO (total ${formatRupiah(totalMine)}) sebagai ${APPROVAL_ROLE_LABEL[role]}?`)) return;
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
    if (item.type === "MATERIAL") setDownload({ kind: "material", pos: [item.po as MaterialPO], baseName: `PO-${item.id}` });
    else setDownload({ kind: "maklon", pos: [item.po as MaklonPO], baseName: `PO-${item.id}` });
  }

  function renderRow(item: Item, actions: React.ReactNode) {
    const open = expanded === item.id;
    const st = item.state;
    return (
      <div key={item.id} className="border-b border-[#F1F4F7] last:border-b-0">
        <div className="grid items-center gap-x-3 px-4 py-3 font-sans text-xs text-[#31414F]" style={{ gridTemplateColumns: "88px minmax(190px,1.2fr) 1fr 120px 1fr auto" }}>
          <span>
            <StatusPill tone={item.type === "MATERIAL" ? "info" : "neutral"}>{item.type === "MATERIAL" ? "MATERIAL" : "PRODUKSI"}</StatusPill>
          </span>
          <button onClick={() => setExpanded(open ? null : item.id)} className="text-left">
            <div className="font-mono text-[11.5px] font-semibold text-text-primary">{item.id}</div>
            <div className="text-[10.5px] text-text-muted">
              {item.mrpId} · {item.vendor}
              {item.supplier ? ` · ${item.supplier}` : ""}
            </div>
          </button>
          <span>
            <ApprovalChain state={st} />
            {st.slaDueAt && (
              <div className={"mt-0.5 text-[10px] " + (st.overdue ? "font-semibold text-danger-fg" : "text-text-muted")}>
                {st.overdue ? "⚠ Lewat SLA · " : "Batas SLA · "}
                {fmtTime(st.slaDueAt)}
              </div>
            )}
          </span>
          <span className="text-right font-mono font-semibold text-text-primary">{formatRupiah(item.amount)}</span>
          <span className="text-[10.5px] text-text-muted">{poApprovalSummary(st)}</span>
          <span className="flex items-center justify-end gap-1.5">
            <Button onClick={() => openDownload(item)} variant="ghost" size="xs">
              PO
            </Button>
            {actions}
          </span>
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
          <SysadminPanel actions={item.type === "MATERIAL" ? materialPoCorrections(item.po as MaterialPO) : maklonPoCorrections(item.po as MaklonPO)} />
        </div>
        {open && <ItemDetail item={item} />}
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

  return (
    <div className="flex flex-col gap-4">
      <MatrixReference />
      {error && <div className="rounded-md border border-danger bg-danger-bg px-4 py-2.5 font-sans text-[12px] text-danger-fg">{error}</div>}

      {renderSection(
        `Menunggu persetujuan ${APPROVAL_ROLE_LABEL[role]}`,
        mine.length,
        mine.length > 0 ? `Total ${formatRupiah(totalMine)}` : undefined,
        mine.length === 0 ? (
          <div className="px-4 py-6 text-center font-sans text-xs text-text-muted">Tidak ada PO yang menunggu persetujuan Anda.</div>
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
            <div className="px-4 py-5 text-center font-sans text-xs text-text-muted">Tidak ada PO yang ditolak.</div>
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

      {/* Revisi 2026-09-28 (owner: "kita bisa tau juga siapa2 sudah approve, karena berlapis") --
         PO yang sudah TUNTAS semua level (termasuk Level 1-2 yang selesai di Procurement tanpa
         pernah mampir ke FAT/SCM/GM) tetap kelihatan di sini, lengkap dengan ApprovalChain-nya --
         bukan cuma menghilang begitu approved=true. Default tertutup (collapsible, pola sama
         seperti MatrixReference) supaya tidak bikin halaman penuh begitu datanya sudah banyak. */}
      <div className="overflow-hidden rounded-lg border border-border-subtle bg-surface-card">
        <button onClick={() => setDoneOpen((v) => !v)} className="flex w-full items-center gap-2 px-4 py-3 text-left">
          <span className="font-sans text-[13px] font-semibold text-text-primary">Sudah selesai (semua level)</span>
          <span className="rounded-full bg-[#EEF1F4] px-2 py-0.5 font-mono text-[10px] font-semibold text-text-muted">{done.length}</span>
          <span className="ml-auto text-text-muted">{doneOpen ? "▾" : "▸"}</span>
        </button>
        {doneOpen && (
          <div className="border-t border-border-subtle">
            {done.length === 0 ? (
              <div className="px-4 py-5 text-center font-sans text-xs text-text-muted">Belum ada PO yang selesai lewat matriks approval ini.</div>
            ) : (
              done.map((it) => renderRow(it, null))
            )}
          </div>
        )}
      </div>

      {rejecting && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0B131B]/45 p-4" onClick={() => setRejecting(null)}>
          <div className="w-full max-w-[440px] rounded-lg bg-white shadow-[0_8px_24px_rgba(11,19,27,.2)]" onClick={(e) => e.stopPropagation()}>
            <div className="border-b border-border-subtle px-5 py-3.5 font-sans text-[13px] font-semibold text-text-primary">Tolak PO {rejecting.id}</div>
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
