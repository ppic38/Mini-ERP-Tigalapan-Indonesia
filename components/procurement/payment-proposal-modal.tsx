"use client";

import { useMemo, useState } from "react";
import { confirmDialog } from "@/components/ui/confirm-dialog";
import { NumberInput } from "@/components/mrp/number-input";
import { useMrpStore } from "@/lib/mrp/store";
import { formatRupiah, localDateString, vendorInvoiceFinalAmount } from "@/lib/mrp/derive";
import { VENDOR_PRODUKSI } from "@/lib/mrp/seed";
import { existingProposalNos, invoicesOfProposal, nextProposalNo, PROPOSAL_DEFAULT_DP_PERCENT, PROPOSAL_DEFAULT_LOCATION, proposalAmounts } from "@/lib/mrp/proposal";
import type { VendorInvoice } from "@/lib/mrp/types";

const LABEL = "font-sans text-[10.5px] font-medium uppercase tracking-wider text-text-muted";
const FIELD = "mt-1 w-full rounded-md border border-[#DDE4EB] px-[11px] py-[8px] font-sans text-[12.5px] text-text-primary";

function mrpIdsOf(inv: VendorInvoice): string[] {
  return Array.from(new Set(inv.lines.map((l) => l.mrpId)));
}

/** Form Proposal Pembayaran (migration 0082) untuk invoice vendor produksi: dibuka dari detail invoice di Procurement > Invoice Vendor.
 *  Proposal bisa menaungi beberapa invoice vendor yang sama; Finance melihat nomor, nama kegiatan, dan PDF-nya di halaman Payment. */
export function PaymentProposalModal({ invoice, onClose }: { invoice: VendorInvoice; onClose: () => void }) {
  const vendorInvoices = useMrpStore((s) => s.vendorInvoices);
  const savePaymentProposal = useMrpStore((s) => s.savePaymentProposal);
  const deletePaymentProposal = useMrpStore((s) => s.deletePaymentProposal);

  const editing = invoice.proposal;
  const vendorName = VENDOR_PRODUKSI[invoice.vendorProduksi]?.name ?? invoice.vendorProduksi;
  const today = localDateString(new Date());

  // Invoice yang boleh ikut: vendor yang sama, belum lunas, dan belum punya proposal lain.
  const candidates = useMemo(
    () =>
      vendorInvoices
        .filter((i) => i.vendorProduksi === invoice.vendorProduksi && i.status !== "PAID" && (!i.proposal || i.proposal.no === editing?.no))
        .sort((a, b) => (a.submittedAt < b.submittedAt ? 1 : -1)),
    [vendorInvoices, invoice.vendorProduksi, editing?.no]
  );

  const [selected, setSelected] = useState<Set<string>>(() => new Set(editing ? invoicesOfProposal(vendorInvoices, editing.no).map((i) => i.id) : [invoice.id]));
  const [no, setNo] = useState(() => editing?.no ?? nextProposalNo(existingProposalNos(vendorInvoices), today));
  const [date, setDate] = useState(editing?.date ?? today);
  const [location, setLocation] = useState(editing?.location ?? PROPOSAL_DEFAULT_LOCATION);
  const [activity, setActivity] = useState(editing?.activity ?? `Pembayaran Tagihan Produksi Vendor ${vendorName} PO ${mrpIdsOf(invoice).join(", ")}`);
  const [rekTujuan, setRekTujuan] = useState(editing?.rekTujuan ?? "");
  const [dpPercent, setDpPercent] = useState(editing?.dpPercent ?? PROPOSAL_DEFAULT_DP_PERCENT);
  const [startDate, setStartDate] = useState(editing?.startDate ?? today);
  // Tagihan mengikuti total invoice terpilih kecuali Procurement mengisinya sendiri.
  const [tagihanManual, setTagihanManual] = useState<number | null>(editing ? editing.tagihan : null);
  const [saving, setSaving] = useState(false);

  const invoicesTotal = candidates.filter((i) => selected.has(i.id)).reduce((s, i) => s + vendorInvoiceFinalAmount(i), 0);
  const tagihan = tagihanManual ?? invoicesTotal;
  const { dpAmount, sisa } = proposalAmounts(tagihan, dpPercent);
  const canSave = selected.size > 0 && !!no.trim() && !!location.trim() && !!activity.trim() && !!rekTujuan.trim() && tagihan > 0 && !!date && !!startDate;

  function toggle(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  }

  async function save() {
    if (!canSave || saving) return;
    setSaving(true);
    try {
      await savePaymentProposal({ invoiceIds: Array.from(selected), previousNo: editing?.no, proposal: { no, date, location, activity, rekTujuan, tagihan, dpPercent, startDate } });
      onClose();
    } catch {
      // pesan gagal sudah ditampilkan store; formulir tetap terbuka supaya bisa diperbaiki
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!editing || saving) return;
    if (!(await confirmDialog({ title: "Hapus proposal?", message: `Proposal ${editing.no} dilepas dari invoice vendor yang belum lunas. Invoice tidak ikut terhapus.`, tone: "danger" }))) return;
    setSaving(true);
    try {
      await deletePaymentProposal(editing.no);
      onClose();
    } catch {
      // pesan gagal sudah ditampilkan store
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0B131B]/45 p-4">
      <div className="flex max-h-[92vh] w-full max-w-[640px] flex-col overflow-hidden rounded-[9px] bg-surface-card shadow-[0_12px_32px_rgba(11,19,27,.28)]">
        <div className="flex items-center gap-2.5 bg-info-bg px-5 py-3">
          <span className="h-2 w-2 rounded-full bg-accent-blue" />
          <span className="font-sans text-xs font-semibold text-info-fg">
            {editing ? "Ubah" : "Buat"} Proposal Pembayaran — {vendorName}
          </span>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className={LABEL}>No. Proposal</div>
              <input value={no} onChange={(e) => setNo(e.target.value)} className={FIELD + " font-mono"} />
            </div>
            <div>
              <div className={LABEL}>Tanggal</div>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={FIELD + " font-mono"} />
            </div>
            <div>
              <div className={LABEL}>Location</div>
              <input value={location} onChange={(e) => setLocation(e.target.value)} className={FIELD} />
            </div>
            <div>
              <div className={LABEL}>Tanggal mulai kegiatan</div>
              <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className={FIELD + " font-mono"} />
            </div>
          </div>

          <div className={LABEL + " mt-3"}>Nama kegiatan</div>
          <textarea value={activity} onChange={(e) => setActivity(e.target.value)} rows={2} className={FIELD} />

          <div className={LABEL + " mt-3"}>Rekening tujuan</div>
          <input value={rekTujuan} onChange={(e) => setRekTujuan(e.target.value)} placeholder="Contoh: Bank Central Asia (BCA) : 3791573970 Bayu Pamungkas" className={FIELD} />

          <div className={LABEL + " mt-4"}>Invoice vendor yang dibayar lewat proposal ini</div>
          <div className="mt-1 max-h-[150px] overflow-y-auto rounded-md border border-[#DDE4EB]">
            {candidates.map((i) => (
              <label key={i.id} className="flex cursor-pointer items-center gap-2.5 border-b border-[#F1F4F7] px-3 py-1.5 font-sans text-[11.5px] last:border-b-0">
                <input type="checkbox" checked={selected.has(i.id)} onChange={() => toggle(i.id)} />
                <span className="font-mono font-medium text-text-primary">{i.id}</span>
                <span className="font-mono text-text-muted">{mrpIdsOf(i).join(", ")}</span>
                <span className="ml-auto font-mono font-medium">{formatRupiah(vendorInvoiceFinalAmount(i))}</span>
              </label>
            ))}
          </div>

          <div className="mt-4 grid grid-cols-3 gap-3">
            <div>
              <div className={LABEL}>Tagihan produksi</div>
              <NumberInput value={tagihan} onChange={(n) => setTagihanManual(n)} currency className={FIELD + " font-mono"} />
              {tagihanManual !== null && tagihanManual !== invoicesTotal && (
                <button onClick={() => setTagihanManual(null)} className="mt-0.5 font-sans text-[10px] text-action-primary underline">
                  Samakan dengan invoice ({formatRupiah(invoicesTotal)})
                </button>
              )}
            </div>
            <div>
              <div className={LABEL}>DP (%)</div>
              <input type="number" min={0} max={100} step="any" value={dpPercent} onChange={(e) => setDpPercent(Math.max(0, Math.min(100, Number(e.target.value))))} className={FIELD + " font-mono"} />
            </div>
            <div>
              <div className={LABEL}>DP / Sisa tagihan</div>
              <div className="mt-1 rounded-md border border-[#DDE4EB] bg-[#F7F9FB] px-[11px] py-[8px] font-mono text-[11.5px] text-text-primary">
                <div>{formatRupiah(dpAmount)}</div>
                <div className="font-semibold text-danger-fg">{formatRupiah(sisa)}</div>
              </div>
            </div>
          </div>
          <div className="mt-1.5 font-sans text-[10.5px] leading-[1.5] text-text-muted">
            Finance melihat nomor proposal, nama kegiatan, dan PDF proposal di kolom Proposal halaman Payment Maklon. Pembayaran invoice tetap dilunasi penuh di Finance; DP dan sisa hanya tercantum di dokumen proposal.
          </div>
        </div>
        <div className="flex items-center justify-between gap-2 border-t border-[#F1F4F7] px-5 py-3">
          <div>
            {editing && (
              <button onClick={remove} disabled={saving} className="font-sans text-xs font-semibold text-danger-fg underline disabled:opacity-50">
                Hapus proposal
              </button>
            )}
          </div>
          <div className="flex gap-2">
            <button onClick={onClose} className="rounded-md border border-[#DDE4EB] px-3.5 py-2 font-sans text-xs font-semibold text-text-muted">
              Batal
            </button>
            <button onClick={save} disabled={!canSave || saving} className="rounded-md bg-action-primary px-3.5 py-2 font-sans text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">
              {saving ? "Menyimpan…" : "Simpan proposal"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
