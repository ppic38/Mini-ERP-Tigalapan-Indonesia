import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { formatDate, formatDecimal, formatPcs, localDateString, materialKgPerRollForGroup, mrpDetailFor, type AduanMaterialKind } from "./derive";
import { ROLL_KG_ESTIMATE, VENDOR_PRODUKSI } from "./seed";
import type { MrpDetail } from "./store";
import type { MaklonPO, MaterialPO } from "./types";

// Format PDF ini meniru tata letak PO dari ERP lama user (logo + nama perusahaan di kiri atas,
// judul dokumen di tengah, info wajib dalam kotak 2 kolom, tabel rincian ber-header hijau dengan
// garis tabel, lalu blok "Diajukan oleh / Disetujui oleh" di bagian bawah).
//
// Revisi 2026-09-21 (owner): (1) kop = logo + "TIGALAPAN INDONESIA" (subjudul lama dihapus), judul dokumen
// jadi "PROPOSAL PURCHASE ORDER ..."; (2) nilai di kotak info yang panjang tidak lagi terpotong (teks
// dibungkus, tinggi baris menyesuaikan); (3) semua tabel diberi garis; (4) SEMUA nominal harga (Harga/Kg,
// Biaya, Subtotal, Total Biaya) dihapus dari PO -- harga master tidak untuk ditunjukkan ke supplier/vendor,
// sebagai gantinya ada baris total Roll/Kg (material) atau Qty (maklon); (5) blok tanda tangan didesain ulang.
const PAGE_W = 595.28;
const MARGIN = 40;
const CONTENT_W = PAGE_W - MARGIN * 2;
const CENTER_X = PAGE_W / 2;
const TEAL: [number, number, number] = [13, 148, 136];
const GRAY_LABEL: [number, number, number] = [130, 130, 140];
const GRAY_BORDER: [number, number, number] = [225, 225, 230];
const TABLE_LINE: [number, number, number] = [160, 165, 175];
const INK: [number, number, number] = [26, 26, 31];
const GREEN: [number, number, number] = [22, 128, 61];
const AMBER: [number, number, number] = [180, 110, 0];

// Logo kop: file gambar di `public/tigalapan-logo-kop.png`. Kalau ada, dipakai di kiri nama perusahaan;
// kalau tidak ada / gagal dimuat, kop cukup teks (tidak pernah bikin download PO gagal). Dimuat sekali di
// browser saat modul ini pertama diimpor supaya export PDF tetap sinkron (tidak perlu menunggu fetch).
const LOGO_URL = "/tigalapan-logo-kop.png";
const LOGO_H = 40;
const LOGO_MAX_W = 64;
let logoCache: { dataUrl: string; w: number; h: number } | null = null;
let logoRequested = false;

function preloadLogo() {
  if (typeof window === "undefined" || logoRequested) return;
  logoRequested = true;
  const img = new Image();
  img.onload = () => {
    try {
      // Perkecil dulu kalau gambarnya sangat besar supaya file PDF tidak membengkak.
      const scale = Math.min(1, 500 / Math.max(img.naturalWidth, img.naturalHeight));
      const cw = Math.max(1, Math.round(img.naturalWidth * scale));
      const ch = Math.max(1, Math.round(img.naturalHeight * scale));
      const canvas = document.createElement("canvas");
      canvas.width = cw;
      canvas.height = ch;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(img, 0, 0, cw, ch);
      // Pangkas margin kosong (transparan / putih) di sekeliling logo supaya ukurannya di kop pas.
      const { data } = ctx.getImageData(0, 0, cw, ch);
      let minX = cw, minY = ch, maxX = -1, maxY = -1;
      for (let py = 0; py < ch; py++) {
        for (let px = 0; px < cw; px++) {
          const i = (py * cw + px) * 4;
          const isContent = data[i + 3] > 20 && !(data[i] > 245 && data[i + 1] > 245 && data[i + 2] > 245);
          if (!isContent) continue;
          if (px < minX) minX = px;
          if (px > maxX) maxX = px;
          if (py < minY) minY = py;
          if (py > maxY) maxY = py;
        }
      }
      if (maxX < minX || maxY < minY) {
        logoCache = { dataUrl: canvas.toDataURL("image/png"), w: cw, h: ch };
        return;
      }
      const pad = 2;
      const sx = Math.max(0, minX - pad);
      const sy = Math.max(0, minY - pad);
      const sw = Math.min(cw - sx, maxX - minX + 1 + pad * 2);
      const sh = Math.min(ch - sy, maxY - minY + 1 + pad * 2);
      const out = document.createElement("canvas");
      out.width = sw;
      out.height = sh;
      out.getContext("2d")?.drawImage(canvas, sx, sy, sw, sh, 0, 0, sw, sh);
      logoCache = { dataUrl: out.toDataURL("image/png"), w: sw, h: sh };
    } catch {
      logoCache = null;
    }
  };
  img.src = LOGO_URL;
}
preloadLogo();

function drawHeader(doc: jsPDF, title: string): number {
  const top = 24;
  let textX = MARGIN;
  if (logoCache) {
    const ratio = Math.min(LOGO_H / logoCache.h, LOGO_MAX_W / logoCache.w);
    const w = logoCache.w * ratio;
    const h = logoCache.h * ratio;
    doc.addImage(logoCache.dataUrl, "PNG", MARGIN, top + (LOGO_H - h) / 2, w, h);
    textX = MARGIN + w + 12;
  }
  doc.setFont("helvetica", "bold");
  doc.setFontSize(19);
  doc.setTextColor(...INK);
  doc.text("TIGALAPAN INDONESIA", textX, top + LOGO_H / 2 + 6.5);

  doc.setDrawColor(...GRAY_BORDER);
  doc.line(MARGIN, 76, PAGE_W - MARGIN, 76);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.setTextColor(...INK);
  doc.text(title, CENTER_X, 104, { align: "center" });

  return 126;
}

// Tabel info 2-kolom (label tebal | value normal) bersambung dengan garis internal. Teks label & value
// DIBUNGKUS ke lebar kolomnya dan tinggi tiap baris menyesuaikan jumlah barisnya (dulu teks panjang
// seperti "PO-SUP-MRP-W36-AWL-KNITTO" / "Vendor Material (Supplier)" meluber melewati garis kolom).
const INFO_FONT = 9;
const INFO_LINE_H = 11;
const INFO_MIN_ROW_H = 30;
const INFO_PAD_X = 8;

/** Bungkus teks ke `width`. Teks tanpa spasi yang kepanjangan (mis. nomor PO) TIDAK dipotong di tengah kata --
 *  ukuran font-nya dikecilkan (min 7pt) supaya muat satu baris; baru kalau tetap tidak muat dibungkus per karakter. */
function wrapLines(doc: jsPDF, text: string, width: number, bold: boolean): { lines: string[]; fontSize: number } {
  const t = text || "—";
  doc.setFont("helvetica", bold ? "bold" : "normal");
  let fontSize = INFO_FONT;
  doc.setFontSize(fontSize);
  if (!t.includes(" ")) {
    while (doc.getTextWidth(t) > width && fontSize > 7) {
      fontSize -= 0.5;
      doc.setFontSize(fontSize);
    }
    if (doc.getTextWidth(t) <= width) return { lines: [t], fontSize };
    fontSize = INFO_FONT;
    doc.setFontSize(fontSize);
  }
  return { lines: doc.splitTextToSize(t, width) as string[], fontSize };
}

function drawInfoGrid(doc: jsPDF, startY: number, left: [string, string][], right: [string, string][]): number {
  const gap = 16;
  const blockW = (CONTENT_W - gap) / 2;
  const labelW = blockW * 0.36;
  const valueW = blockW - labelW;
  const textW = (col: number) => col - INFO_PAD_X * 2;
  const rows = Math.max(left.length, right.length);

  // Tinggi baris = yang tertinggi dari kiri/kanan pada indeks yang sama, supaya garis kedua blok sejajar.
  const heights: number[] = [];
  for (let i = 0; i < rows; i++) {
    let lines = 1;
    for (const block of [left, right]) {
      const f = block[i];
      if (!f) continue;
      lines = Math.max(lines, wrapLines(doc, f[0], textW(labelW), true).lines.length, wrapLines(doc, f[1], textW(valueW), false).lines.length);
    }
    heights.push(Math.max(INFO_MIN_ROW_H, lines * INFO_LINE_H + 12));
  }

  drawInfoBlock(doc, MARGIN, startY, blockW, labelW, heights, left);
  drawInfoBlock(doc, MARGIN + blockW + gap, startY, blockW, labelW, heights, right);
  return startY + heights.reduce((s, h) => s + h, 0) + 20;
}

function drawInfoBlock(doc: jsPDF, x: number, y: number, w: number, labelW: number, heights: number[], fields: [string, string][]) {
  const total = heights.slice(0, fields.length).reduce((s, h) => s + h, 0);
  doc.setDrawColor(...TABLE_LINE);
  doc.setLineWidth(0.5);
  doc.rect(x, y, w, total);
  doc.line(x + labelW, y, x + labelW, y + total);

  let rowY = y;
  fields.forEach(([label, value], i) => {
    const rowH = heights[i];
    if (i > 0) doc.line(x, rowY, x + w, rowY);
    const labelLines = wrapLines(doc, label, labelW - INFO_PAD_X * 2, true);
    const valueLines = wrapLines(doc, value, w - labelW - INFO_PAD_X * 2, false);
    const drawLines = ({ lines, fontSize }: { lines: string[]; fontSize: number }, tx: number, bold: boolean) => {
      doc.setFont("helvetica", bold ? "bold" : "normal");
      doc.setFontSize(fontSize);
      doc.setTextColor(...INK);
      const startTextY = rowY + (rowH - lines.length * INFO_LINE_H) / 2 + INFO_LINE_H - 2.5;
      lines.forEach((ln, li) => doc.text(ln, tx, startTextY + li * INFO_LINE_H));
    };
    drawLines(labelLines, x + INFO_PAD_X, true);
    drawLines(valueLines, x + labelW + INFO_PAD_X, false);
    rowY += rowH;
  });
  doc.setLineWidth(0.2);
}

function drawSectionHeading(doc: jsPDF, y: number, text: string): number {
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10.5);
  doc.setTextColor(...INK);
  doc.text(text, MARGIN, y);
  return y + 12;
}

function lastAutoTableY(doc: jsPDF): number {
  return (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;
}

// Opsi umum semua tabel rincian: bergaris (grid), header hijau, baris total abu-abu tebal.
const TABLE_BASE = {
  theme: "grid" as const,
  margin: { left: MARGIN, right: MARGIN },
  styles: { fontSize: 8.5, textColor: INK, lineColor: TABLE_LINE, lineWidth: 0.5 },
  headStyles: { fillColor: TEAL, textColor: [255, 255, 255] as [number, number, number], fontStyle: "bold" as const },
  footStyles: { fillColor: [240, 243, 246] as [number, number, number], textColor: INK, fontStyle: "bold" as const },
};

// ---- Blok "Diajukan oleh / Disetujui oleh" ----
const APPROVAL_H = 96;

function drawApprovalBox(
  doc: jsPDF,
  x: number,
  y: number,
  w: number,
  o: { heading: string; role: string; status: string; statusColor: [number, number, number]; name: string; meta: string }
) {
  doc.setDrawColor(...TABLE_LINE);
  doc.setLineWidth(0.5);
  doc.rect(x, y, w, APPROVAL_H);
  // Pita judul
  doc.setFillColor(240, 243, 246);
  doc.rect(x, y, w, 20, "FD");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(...INK);
  doc.text(o.heading, x + 10, y + 13);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(...GRAY_LABEL);
  doc.text(o.role, x + w - 10, y + 13, { align: "right" });
  // Status (area tanda tangan)
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(...o.statusColor);
  doc.text(o.status, x + w / 2, y + 38, { align: "center" });
  // Garis tanda tangan + nama + keterangan
  doc.setDrawColor(...INK);
  doc.setLineWidth(0.6);
  doc.line(x + 24, y + APPROVAL_H - 30, x + w - 24, y + APPROVAL_H - 30);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9.5);
  doc.setTextColor(...INK);
  doc.text(o.name, x + w / 2, y + APPROVAL_H - 18, { align: "center" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.setTextColor(...GRAY_LABEL);
  doc.text(o.meta, x + w / 2, y + APPROVAL_H - 7, { align: "center" });
  doc.setLineWidth(0.2);
}

function drawApprovalBoxes(doc: jsPDF, y: number, o: { submittedDate?: string; approved: boolean; approvedDate?: string }) {
  const gap = 16;
  const w = (CONTENT_W - gap) / 2;
  drawApprovalBox(doc, MARGIN, y, w, {
    heading: "DIAJUKAN OLEH",
    role: "Procurement",
    status: "DIAJUKAN",
    statusColor: TEAL,
    name: "Tim Procurement",
    meta: o.submittedDate ? `Tanggal pengajuan: ${formatDate(o.submittedDate)}` : "Tanggal pengajuan: —",
  });
  drawApprovalBox(doc, MARGIN + w + gap, y, w, {
    heading: "DISETUJUI OLEH",
    role: "Finance",
    status: o.approved ? "DISETUJUI" : "MENUNGGU PERSETUJUAN",
    statusColor: o.approved ? GREEN : AMBER,
    name: "Finance",
    meta: o.approved ? (o.approvedDate ? `Tanggal persetujuan: ${formatDate(o.approvedDate)}` : "Sudah disetujui") : "Belum disetujui Finance",
  });
}

function footerY(doc: jsPDF): number {
  const pageH = doc.internal.pageSize.getHeight();
  return pageH - 40 - APPROVAL_H; // ruang tanda tangan selalu di bagian bawah halaman
}

/** Item 8(d): kalau `y` (posisi setelah tabel) sudah lewat footerY halaman saat ini (tabel spill ke
 *  halaman 2+), mulai halaman BARU dan gambar blok tanda tangan di footerY halaman baru itu supaya
 *  tidak pernah menimpa baris tabel terakhir. */
function drawApprovalBoxesSafe(doc: jsPDF, y: number, o: Parameters<typeof drawApprovalBoxes>[2]) {
  let targetY = y;
  if (y > footerY(doc)) {
    doc.addPage();
    targetY = footerY(doc);
  }
  drawApprovalBoxes(doc, targetY, o);
}

/** Badan 1 halaman PO Material (header, info, rincian, RIB/Kerah/Manset, tanda tangan). TIDAK
 *  memanggil `new jsPDF()`/`doc.save()` -- itu tanggung jawab pemanggil (1 PO = exportMaterialPoPdf,
 *  banyak PO sekaligus = exportMaterialPoPdfBatch). Tidak ada nominal harga di dokumen ini. */
function renderMaterialPoPage(doc: jsPDF, po: MaterialPO, mrpDetails: MrpDetail[]) {
  const vendorName = VENDOR_PRODUKSI[po.vendorProduksi]?.name ?? po.vendorProduksi;
  const mrpDetail = mrpDetailFor(po.mrpId, mrpDetails);
  const kategori = mrpDetail?.mrp.kategori ?? "—";
  const totalRoll = po.colorBreakdown.reduce((s, c) => s + c.rollCount, 0);
  const totalKg = totalRoll * ROLL_KG_ESTIMATE;

  let y = drawHeader(doc, "PROPOSAL PURCHASE ORDER MATERIAL BAHAN");

  y = drawInfoGrid(
    doc,
    y,
    [
      ["No. PO", po.id],
      ["No. MRP", po.mrpId],
      ["Tanggal PO", mrpDetail?.dates.poSent ? formatDate(mrpDetail.dates.poSent) : "—"],
      ["Tanggal Cetak", formatDate(localDateString(new Date()))],
      ["Status", po.approved ? "Disetujui" : "Menunggu Persetujuan"],
    ],
    [
      ["Vendor Produksi", vendorName],
      ["Vendor Material (Supplier)", po.supplier],
      ["Entitas", po.approved ? po.entity : "Menunggu input Finance"],
      ["Total Roll", formatDecimal(totalRoll, 1)],
      ["Total Kg (estimasi)", formatDecimal(totalKg, 1)],
    ]
  );

  y = drawSectionHeading(doc, y, `1. Rincian Bahan — ${po.supplier}`);

  const rows = po.colorBreakdown.map((c, i) => [String(i + 1), kategori, c.lengan ? `${c.warna} · ${c.lengan}` : c.warna, formatDecimal(c.rollCount, 1), formatDecimal(c.rollCount * ROLL_KG_ESTIMATE, 1)]);

  autoTable(doc, {
    ...TABLE_BASE,
    startY: y,
    head: [["No", "Kategori", "Warna", "Roll", "Kg"]],
    body: rows,
    foot: [["", "", "TOTAL", formatDecimal(totalRoll, 1), formatDecimal(totalKg, 1)]],
    showFoot: "lastPage",
    columnStyles: {
      0: { cellWidth: 28, halign: "center" },
      3: { halign: "right", cellWidth: 70 },
      4: { halign: "right", cellWidth: 80 },
    },
  });
  y = lastAutoTableY(doc) + 22;

  // Section tambahan RIB / Kerah / Manset: penomoran DINAMIS (hanya naik untuk section yang dirender)
  // dan section di-skip total kalau kebutuhannya 0 (mis. kategori tanpa rib sama sekali).
  let sectionCounter = 1;

  function materialRowsForKind(kind: AduanMaterialKind) {
    const list = po.colorBreakdown.map((c) => {
      const group = mrpDetail?.lenganGroups.find((g) => g.warna === c.warna && g.lengan === c.lengan);
      const kgPerRoll = group ? materialKgPerRollForGroup(group, kind) : 0;
      return { warna: c.warna, lengan: c.lengan, rollCount: c.rollCount, kgPerRoll, kgForLine: kgPerRoll * c.rollCount };
    });
    return { rows: list, totalKg: list.reduce((s, r) => s + r.kgForLine, 0) };
  }

  function drawMaterialSection(label: string, list: ReturnType<typeof materialRowsForKind>["rows"], totalKgForKind: number) {
    sectionCounter += 1;
    y = drawSectionHeading(doc, y, `${sectionCounter}. Permintaan ${label}`);
    autoTable(doc, {
      ...TABLE_BASE,
      startY: y,
      head: [["No", "Warna", "Lengan", "Roll", `${label}/roll (kg)`, `Total ${label} (kg)`]],
      body: list.map((r, i) => [String(i + 1), r.warna, r.lengan, formatDecimal(r.rollCount, 1), formatDecimal(r.kgPerRoll, 2), formatDecimal(r.kgForLine, 2)]),
      foot: [["", "", "TOTAL", formatDecimal(list.reduce((s, r) => s + r.rollCount, 0), 1), "", formatDecimal(totalKgForKind, 2)]],
      showFoot: "lastPage",
      columnStyles: {
        0: { cellWidth: 28, halign: "center" },
        3: { halign: "right", cellWidth: 50 },
        4: { halign: "right", cellWidth: 85 },
        5: { halign: "right", cellWidth: 90 },
      },
    });
    y = lastAutoTableY(doc) + 22;
  }

  const rib = materialRowsForKind("rib");
  if (rib.totalKg > 0) drawMaterialSection("RIB", rib.rows, rib.totalKg);

  const kerah = materialRowsForKind("kerah");
  if (kerah.totalKg > 0) drawMaterialSection("KERAH", kerah.rows, kerah.totalKg);

  const manset = materialRowsForKind("manset");
  if (manset.totalKg > 0) drawMaterialSection("MANSET", manset.rows, manset.totalKg);

  drawApprovalBoxesSafe(doc, y, { submittedDate: mrpDetail?.dates.poSent, approved: po.approved, approvedDate: mrpDetail?.dates.poApproved });
}

/** Generate & download PDF Proposal Purchase Order Material Bahan untuk SATU PO. */
export function exportMaterialPoPdf(po: MaterialPO, mrpDetails: MrpDetail[]) {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  renderMaterialPoPage(doc, po, mrpDetails);
  doc.save(`PO-${po.id}.pdf`);
}

/** Semua `pos` digambar ke SATU dokumen jsPDF, 1 halaman per PO -- dipakai tombol "Download PO" di
 *  baris MRP (semua supplier) & baris Supplier (semua PO supplier itu). No-op kalau `pos` kosong. */
export function exportMaterialPoPdfBatch(pos: MaterialPO[], mrpDetails: MrpDetail[], fileName: string) {
  if (pos.length === 0) return;
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  pos.forEach((po, i) => {
    if (i > 0) doc.addPage();
    renderMaterialPoPage(doc, po, mrpDetails);
  });
  doc.save(fileName);
}

/** Generate & download PDF Proposal Purchase Order Produksi (maklon vendor), rincian per warna
 *  menampilkan Qty PDK/PJG -- dihitung dari aduanRows MRP terkait untuk vendor ini, bukan langsung dari
 *  MaklonPO. Tidak ada nominal harga/biaya maklon di dokumen ini. */
function renderMaklonPoPage(doc: jsPDF, po: MaklonPO, mrpDetails: MrpDetail[]) {
  const vendorName = VENDOR_PRODUKSI[po.vendorProduksi]?.name ?? po.vendorProduksi;
  const detail = mrpDetailFor(po.mrpId, mrpDetails);
  const kategori = detail?.mrp.kategori ?? "—";
  const aduanRows = detail?.aduanRows.filter((a) => a.vendor === po.vendorProduksi) ?? [];

  const byWarna = new Map<string, { warna: string; pdk: number; pjg: number }>();
  for (const a of aduanRows) {
    const cur = byWarna.get(a.warna) ?? { warna: a.warna, pdk: 0, pjg: 0 };
    if (a.lengan === "PENDEK") cur.pdk += a.qty;
    else cur.pjg += a.qty;
    byWarna.set(a.warna, cur);
  }
  const warnaRows = Array.from(byWarna.values());
  const totalPdk = warnaRows.reduce((s, r) => s + r.pdk, 0);
  const totalPjg = warnaRows.reduce((s, r) => s + r.pjg, 0);

  let y = drawHeader(doc, "PROPOSAL PURCHASE ORDER PRODUKSI");

  y = drawInfoGrid(
    doc,
    y,
    [
      ["No. PO", po.id],
      ["No. MRP", po.mrpId],
      ["Tanggal PO", detail?.dates.poSent ? formatDate(detail.dates.poSent) : "—"],
      ["Tanggal Cetak", formatDate(localDateString(new Date()))],
      ["Status", po.approved ? "Disetujui" : "Menunggu Persetujuan"],
    ],
    [
      ["Vendor Produksi", vendorName],
      ["Kategori", kategori],
      ["Jumlah Warna", String(warnaRows.length)],
      ["Total Qty", `${formatPcs(po.qty)} pcs`],
    ]
  );

  y = drawSectionHeading(doc, y, `1. ${vendorName}`);

  if (warnaRows.length > 0) {
    autoTable(doc, {
      ...TABLE_BASE,
      startY: y,
      head: [["No", "Kategori", "Warna", "Qty PDK", "Qty PJG", "No. MRP"]],
      body: warnaRows.map((r, i) => [String(i + 1), kategori, r.warna, r.pdk ? formatPcs(r.pdk) : "—", r.pjg ? formatPcs(r.pjg) : "—", po.mrpId]),
      foot: [["", "", "TOTAL", formatPcs(totalPdk), formatPcs(totalPjg), ""]],
      showFoot: "lastPage",
      columnStyles: {
        0: { cellWidth: 28, halign: "center" },
        3: { halign: "right", cellWidth: 65 },
        4: { halign: "right", cellWidth: 65 },
        5: { cellWidth: 80 },
      },
    });
    y = lastAutoTableY(doc) + 22;
  } else {
    // Bukan baris dummy di tabel -- caption eksplisit supaya jelas memang tidak ada rincian aduan pola.
    doc.setFont("helvetica", "italic");
    doc.setFontSize(9);
    doc.setTextColor(...GRAY_LABEL);
    doc.text("Tidak ada rincian aduan pola untuk vendor ini.", MARGIN, y + 14);
    y += 36;
  }

  drawApprovalBoxesSafe(doc, y, { submittedDate: detail?.dates.poSent, approved: po.approved, approvedDate: detail?.dates.poApproved });
}

export function exportMaklonPoPdf(po: MaklonPO, mrpDetails: MrpDetail[]) {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  renderMaklonPoPage(doc, po, mrpDetails);
  doc.save(`PO-${po.id}.pdf`);
}

/** Semua `pos` (PO produksi satu MRP) digambar ke SATU dokumen, 1 halaman per PO -- pasangan
 *  exportMaterialPoPdfBatch untuk tombol "Download PO" di baris MRP tabel PO Produksi. */
export function exportMaklonPoPdfBatch(pos: MaklonPO[], mrpDetails: MrpDetail[], fileName: string) {
  if (pos.length === 0) return;
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  pos.forEach((po, i) => {
    if (i > 0) doc.addPage();
    renderMaklonPoPage(doc, po, mrpDetails);
  });
  doc.save(fileName);
}
