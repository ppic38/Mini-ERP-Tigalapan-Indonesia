import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import type { PaymentProposal } from "./types";

// PDF Proposal Pembayaran (migration 0082) -- meniru format proposal PSCM-PRODUKSI: kotak isian bergaris hitam di kertas landscape,
// label tebal di kiri, rekening tujuan dan sisa tagihan berwarna merah. Di bawahnya daftar invoice vendor yang dibayar lewat proposal ini,
// supaya Finance bisa mencocokkan proposal dengan invoice di halaman Payment.

const PAGE_W = 841.89;
const MARGIN = 30;
const LABEL_X = MARGIN;
const BOX_X = 183;
const BOX_W = 214;
const WIDE_BOX_W = 629;
const BOX_H = 17;
const INK: [number, number, number] = [0, 0, 0];
const RED: [number, number, number] = [220, 0, 0];

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** 2026-10-29 -> "29-Oct-26" (format tanggal di formulir proposal). */
export function proposalDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  if (!y || !m || !d) return iso;
  return `${d}-${MONTHS[Number(m) - 1] ?? m}-${y.slice(2)}`;
}

export type ProposalInvoiceRow = { id: string; vendor: string; mrp: string; amount: number };

function rupiahPlain(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

function label(doc: jsPDF, text: string, x: number, y: number) {
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(...INK);
  doc.text(text, x, y + 12);
}

function box(doc: jsPDF, x: number, y: number, w: number, h: number, text: string, opts: { bold?: boolean; color?: [number, number, number]; align?: "center" | "left" } = {}) {
  doc.setDrawColor(...INK);
  doc.setLineWidth(1);
  doc.rect(x, y, w, h);
  doc.setFont("helvetica", opts.bold ? "bold" : "normal");
  doc.setFontSize(9);
  doc.setTextColor(...(opts.color ?? INK));
  if (opts.align === "left") doc.text(text, x + 6, y + h / 2 + 3.2);
  else doc.text(text, x + w / 2, y + h / 2 + 3.2, { align: "center" });
}

/** Kotak nominal: "Rp" rata kiri, angka rata kanan. */
function amountBox(doc: jsPDF, y: number, amount: number, color?: [number, number, number]) {
  doc.setDrawColor(...INK);
  doc.setLineWidth(1);
  doc.rect(BOX_X, y, BOX_W, 15);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(...(color ?? INK));
  doc.text("Rp", BOX_X + 6, y + 11);
  doc.text(rupiahPlain(amount), BOX_X + BOX_W - 6, y + 11, { align: "right" });
}

export function buildPaymentProposalPdf(p: PaymentProposal, invoices: ProposalInvoiceRow[]): jsPDF {
  const doc = new jsPDF({ unit: "pt", format: "a4", orientation: "landscape" });

  // Garis tebal atas dan kanan, seperti di formulir.
  doc.setDrawColor(...INK);
  doc.setLineWidth(3);
  doc.line(0, 6, PAGE_W, 6);
  doc.line(PAGE_W - 6, 6, PAGE_W - 6, 595);

  let y = 28;
  label(doc, "NO. PROPOSAL", LABEL_X, y);
  box(doc, BOX_X, y, BOX_W, BOX_H, p.no);
  label(doc, "TGL", 498, y);
  box(doc, 547, y, 263, BOX_H, proposalDate(p.date));

  y += 36;
  label(doc, "LOCATION :", LABEL_X, y);
  box(doc, BOX_X, y, BOX_W, BOX_H, p.location);

  y += 38;
  label(doc, "NAMA KEGIATAN:", LABEL_X, y + 9);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  const activityLines = doc.splitTextToSize(p.activity, WIDE_BOX_W - 12) as string[];
  const activityH = Math.max(34, activityLines.length * 12 + 14);
  doc.setDrawColor(...INK);
  doc.setLineWidth(1);
  doc.rect(BOX_X, y, WIDE_BOX_W, activityH);
  doc.setTextColor(...INK);
  activityLines.forEach((ln, i) => doc.text(ln, BOX_X + 6, y + 15 + i * 12));

  y += activityH;
  label(doc, "REK TUJUAN :", LABEL_X, y + 2);
  const rekLines = doc.splitTextToSize(p.rekTujuan, WIDE_BOX_W - 12) as string[];
  const rekH = Math.max(BOX_H + 2, rekLines.length * 12 + 8);
  doc.rect(BOX_X, y, WIDE_BOX_W, rekH);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...RED);
  rekLines.forEach((ln, i) => doc.text(ln, BOX_X + 6, y + 13 + i * 12));

  y += rekH + 22;
  label(doc, "TAGIHAN PRODUKSI", LABEL_X, y - 1);
  amountBox(doc, y, p.tagihan);
  label(doc, `DP ${p.dpPercent}%`, LABEL_X, y + 14);
  amountBox(doc, y + 15, p.dpAmount);
  label(doc, "SISA TAGIHAN", LABEL_X, y + 29);
  amountBox(doc, y + 30, p.sisa, RED);

  label(doc, "TANGGAL MULAI KEGIATAN", 475, y + 6);
  box(doc, 650, y + 3, 160, BOX_H, proposalDate(p.startDate));

  // Invoice vendor yang dinaungi proposal ini.
  y += 66;
  if (invoices.length > 0) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(...INK);
    doc.text("INVOICE VENDOR YANG DIBAYAR", LABEL_X, y);
    autoTable(doc, {
      startY: y + 6,
      margin: { left: MARGIN, right: MARGIN + 10 },
      head: [["No Invoice", "Vendor", "No PO", "Total tagihan"]],
      body: invoices.map((i) => [i.id, i.vendor, i.mrp, "Rp " + rupiahPlain(i.amount)]),
      theme: "grid",
      styles: { font: "helvetica", fontSize: 8.5, textColor: INK, lineColor: INK, lineWidth: 0.5 },
      headStyles: { fillColor: [235, 235, 235], textColor: INK, fontStyle: "bold" },
      columnStyles: { 3: { halign: "right" } },
    });
  }

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(110, 110, 110);
  const by = p.createdBy ? `Diajukan oleh ${p.createdBy}` : "Dibuat otomatis oleh sistem";
  doc.text(by + (p.createdAt ? ` · ${p.createdAt}` : ""), LABEL_X, 575);
  return doc;
}

export function downloadPaymentProposalPdf(p: PaymentProposal, invoices: ProposalInvoiceRow[]) {
  buildPaymentProposalPdf(p, invoices).save(`Proposal-${p.no.replace(/[\\/:*?"<>|\s]+/g, "-")}.pdf`);
}
