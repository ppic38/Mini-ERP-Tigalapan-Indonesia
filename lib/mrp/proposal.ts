import type { PaymentProposal, VendorInvoice } from "./types";
import type { MrpDetail } from "./store";
import { mrpDetailFor, vendorInvoiceFinalAmount } from "./derive";
import { VENDOR_PRODUKSI } from "./seed";

// Proposal Pembayaran (migration 0082). Fungsi murni -- dipakai klien (form, saran nomor) dan server (validasi, hitung ulang DP).

export const PROPOSAL_NO_SUFFIX = "PSCM-PRODUKSI";
export const PROPOSAL_DEFAULT_LOCATION = "Bandung";
export const PROPOSAL_DEFAULT_DP_PERCENT = 60;

const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"];

/** Nomor proposal berikutnya: urutan 4 digit (satu deret per tahun, lintas bulan) / PSCM-PRODUKSI / bulan romawi / tahun.
 *  Contoh: 0082/PSCM-PRODUKSI/X/2026. `existingNos` = nomor yang sudah dipakai (semua invoice). */
export function nextProposalNo(existingNos: Iterable<string>, dateIso: string): string {
  const year = dateIso.slice(0, 4);
  const month = Math.min(12, Math.max(1, Number(dateIso.slice(5, 7)) || 1));
  let maxSeq = 0;
  for (const no of existingNos) {
    const m = /^(\d+)\/.*\/(\d{4})$/.exec(no.trim());
    if (m && m[2] === year) maxSeq = Math.max(maxSeq, Number(m[1]));
  }
  return `${String(maxSeq + 1).padStart(4, "0")}/${PROPOSAL_NO_SUFFIX}/${ROMAN[month - 1]}/${year}`;
}

/** DP dibulatkan ke rupiah; sisa = tagihan - DP (selalu dihitung ulang, tidak dipercaya dari klien). */
export function proposalAmounts(tagihan: number, dpPercent: number): { dpAmount: number; sisa: number } {
  const dpAmount = Math.round((tagihan * dpPercent) / 100);
  return { dpAmount, sisa: tagihan - dpAmount };
}

/** Semua nomor proposal yang sudah ada di daftar invoice vendor. */
export function existingProposalNos(invoices: VendorInvoice[]): Set<string> {
  const set = new Set<string>();
  for (const i of invoices) if (i.proposal?.no) set.add(i.proposal.no);
  return set;
}

/** Invoice yang tercakup satu proposal (nomor sama). */
export function invoicesOfProposal(invoices: VendorInvoice[], no: string): VendorInvoice[] {
  return invoices.filter((i) => i.proposal?.no === no);
}

export function normalizeProposal(input: Pick<PaymentProposal, "no" | "date" | "location" | "activity" | "rekTujuan" | "tagihan" | "dpPercent" | "startDate">): Omit<PaymentProposal, "createdBy" | "createdAt"> {
  const tagihan = Math.round(input.tagihan);
  const dpPercent = Math.round(input.dpPercent * 100) / 100;
  return {
    no: input.no.trim(),
    date: input.date,
    location: input.location.trim(),
    activity: input.activity.trim(),
    rekTujuan: input.rekTujuan.trim(),
    tagihan,
    dpPercent,
    ...proposalAmounts(tagihan, dpPercent),
    startDate: input.startDate,
  };
}

/** Pesan kesalahan isian proposal, atau null kalau valid. */
export function validateProposal(p: ReturnType<typeof normalizeProposal>): string | null {
  if (!p.no) return "Nomor proposal wajib diisi.";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(p.date)) return "Tanggal proposal tidak valid.";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(p.startDate)) return "Tanggal mulai kegiatan tidak valid.";
  if (!p.location) return "Location wajib diisi.";
  if (!p.activity) return "Nama kegiatan wajib diisi.";
  if (!p.rekTujuan) return "Rekening tujuan wajib diisi.";
  if (!(p.tagihan > 0)) return "Tagihan produksi harus lebih dari 0.";
  if (!(p.dpPercent >= 0 && p.dpPercent <= 100)) return "DP harus antara 0 dan 100 persen.";
  return null;
}

/** Urutan stabil invoice (tanggal diajukan, lalu nomor) -- dasar nomor proposal otomatis. */
function invoiceOrderKey(i: VendorInvoice): string {
  return i.submittedAt + "|" + String(Number(i.id.replace(/\D/g, ""))).padStart(8, "0");
}

/** Proposal Pembayaran yang DIBUAT OTOMATIS sistem untuk satu invoice vendor produksi (owner 2026-10-30: Finance mengunduh sendiri di
 *  Payment Maklon, Procurement tidak perlu membuat). Nomor = urutan invoice di tahun itu (stabil, unik per invoice); nama kegiatan =
 *  "Pembayaran Tagihan Produksi Vendor {vendor} PO {MRP} - Kategori {kategori}"; tagihan = total akhir invoice; DP default 60%.
 *  Rekening tujuan belum ada di sistem, jadi dikosongkan. */
export function buildAutoProposal(inv: VendorInvoice, allInvoices: VendorInvoice[], mrpDetails: MrpDetail[], todayIso: string): PaymentProposal {
  const year = inv.submittedAt.slice(0, 4);
  const sameYear = allInvoices.filter((i) => i.submittedAt.slice(0, 4) === year).sort((a, b) => invoiceOrderKey(a).localeCompare(invoiceOrderKey(b)));
  const seq = Math.max(1, sameYear.findIndex((i) => i.id === inv.id) + 1);
  const month = Math.min(12, Math.max(1, Number(inv.submittedAt.slice(5, 7)) || 1));
  const mrpIds = Array.from(new Set(inv.lines.map((l) => l.mrpId)));
  const kategori: string[] = [];
  for (const l of inv.lines) {
    const k = mrpDetailFor(l.mrpId, mrpDetails)?.lenganGroups.find((g) => g.warna === l.warna && g.lengan === l.lengan)?.kategori;
    if (k && !kategori.includes(k)) kategori.push(k);
  }
  const vendorName = VENDOR_PRODUKSI[inv.vendorProduksi]?.name ?? inv.vendorProduksi;
  const poDates = mrpIds.map((m) => mrpDetailFor(m, mrpDetails)?.dates.poSent).filter((d): d is string => !!d && /^\d{4}-\d{2}-\d{2}/.test(d)).map((d) => d.slice(0, 10));
  const startDate = poDates.length > 0 ? poDates.sort()[0] : inv.submittedAt.slice(0, 10);
  return normalizeProposal({
    no: `${String(seq).padStart(4, "0")}/${PROPOSAL_NO_SUFFIX}/${ROMAN[month - 1]}/${year}`,
    date: todayIso,
    location: PROPOSAL_DEFAULT_LOCATION,
    activity: `Pembayaran Tagihan Produksi Vendor ${vendorName} PO ${mrpIds.join(", ")}${kategori.length > 0 ? " - Kategori " + kategori.join(", ") : ""}`,
    rekTujuan: "",
    tagihan: vendorInvoiceFinalAmount(inv),
    dpPercent: PROPOSAL_DEFAULT_DP_PERCENT,
    startDate,
  });
}
