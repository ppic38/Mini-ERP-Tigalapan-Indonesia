import type { Workbook, Worksheet } from "exceljs";
import { formatDate, localDateString, materialKgPerRollForGroup, mrpDetailFor, type AduanMaterialKind } from "./derive";
import { ROLL_KG_ESTIMATE, VENDOR_PRODUKSI } from "./seed";
import type { MrpDetail } from "./store";
import type { MaklonPO, MaterialPO } from "./types";
import { poApprovalPrintInfo } from "./poApproval";
import type { PoExportVariant } from "./exportPoPdf";

// Export PO ke Excel (owner 2026-09-26: "download PO dalam bentuk excel atau pdf ... excelnya ada template
// cantiknya, warna header, tidak tercrop, minimalis tapi memuat informasi PO, logo Tigalapan, kop tabel").
// Isi SAMA dengan PDF (exportPoPdf.ts): SEMUA nominal harga sengaja TIDAK ditampilkan (harga master tidak
// untuk ditunjukkan ke supplier/vendor) -- hanya roll/kg (material) atau qty pcs (maklon). 1 PO = 1 sheet
// A4 portrait fit-to-width; banyak PO = banyak sheet dalam 1 file. ExcelJS di-import dinamis supaya tidak
// ikut bundle awal halaman.

const TEAL = "FF0D9488";
const INK = "FF1A1A1F";
const GRAY = "FF828290";
const LINE = "FFA0A5AF";
const SOFT = "FFF0F3F6";
const GREEN = "FF16803D";
const AMBER = "FFB46E00";
const FONT = "Calibri";
const COL_WIDTHS = [6, 22, 26, 14, 16, 26];
const COLS = COL_WIDTHS.length;

const thin = { style: "thin" as const, color: { argb: LINE } };
const BORDER = { top: thin, left: thin, bottom: thin, right: thin };

type Logo = { buffer: ArrayBuffer; w: number; h: number };
const imageIds = new WeakMap<Workbook, number>();
let logoPromise: Promise<Logo | null> | null = null;

/** Logo kop (public/tigalapan-logo-kop.png). Gagal dimuat = kop cukup teks, export tetap jalan. */
function loadLogo(): Promise<Logo | null> {
  if (!logoPromise) {
    logoPromise = (async () => {
      try {
        const res = await fetch("/tigalapan-logo-kop.png");
        if (!res.ok) return null;
        const blob = await res.blob();
        const bmp = await createImageBitmap(blob);
        return { buffer: await blob.arrayBuffer(), w: bmp.width, h: bmp.height };
      } catch {
        return null;
      }
    })();
  }
  return logoPromise;
}

function sheetName(wb: Workbook, base: string): string {
  const clean = base.replace(/[\\/*?:[\]]/g, "-").slice(0, 28) || "PO";
  let name = clean;
  let n = 2;
  while (wb.getWorksheet(name)) {
    name = `${clean.slice(0, 26)}-${n}`;
    n++;
  }
  return name;
}

function setupSheet(ws: Worksheet) {
  COL_WIDTHS.forEach((w, i) => {
    ws.getColumn(i + 1).width = w;
  });
  ws.views = [{ showGridLines: false }];
  ws.pageSetup = { paperSize: 9, orientation: "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 0, horizontalCentered: true, margins: { left: 0.5, right: 0.5, top: 0.6, bottom: 0.6, header: 0.3, footer: 0.3 } };
  ws.headerFooter.oddFooter = "&L&8Tigalapan Indonesia&R&8Halaman &P dari &N";
}

function drawHeader(wb: Workbook, ws: Worksheet, logo: Logo | null, title: string): number {
  ws.getRow(1).height = 40;
  ws.mergeCells(1, 2, 1, COLS);
  const name = ws.getCell(1, 2);
  name.value = "TIGALAPAN INDONESIA";
  name.font = { name: FONT, size: 20, bold: true, color: { argb: INK } };
  name.alignment = { vertical: "middle", horizontal: "left", indent: 3 };
  if (logo) {
    // Gambar didaftarkan SEKALI per workbook lalu dipakai ulang di semua sheet (file tidak membengkak).
    let id = imageIds.get(wb);
    if (id === undefined) {
      id = wb.addImage({ buffer: logo.buffer as unknown as ExcelJS_Buffer, extension: "png" });
      imageIds.set(wb, id);
    }
    const h = 40;
    const w = Math.min(64, (logo.w / logo.h) * h);
    ws.addImage(id, { tl: { col: 0.15, row: 0.1 }, ext: { width: w, height: h - 4 } });
  }
  for (let c = 1; c <= COLS; c++) ws.getCell(2, c).border = { top: { style: "medium", color: { argb: TEAL } } };
  ws.getRow(2).height = 6;
  ws.mergeCells(3, 1, 3, COLS);
  const t = ws.getCell(3, 1);
  t.value = title;
  t.font = { name: FONT, size: 14, bold: true, color: { argb: INK } };
  t.alignment = { vertical: "middle", horizontal: "center" };
  ws.getRow(3).height = 30;
  return 5;
}

/** Kotak info 2 kolom (label | nilai) x 2 -- label tebal abu, nilai dibungkus supaya tidak terpotong. */
function drawInfo(ws: Worksheet, row: number, left: [string, string][], right: [string, string][]): number {
  const n = Math.max(left.length, right.length);
  for (let i = 0; i < n; i++) {
    const r = row + i;
    const l = left[i];
    const rt = right[i];
    ws.mergeCells(r, 1, r, 2);
    ws.mergeCells(r, 4, r, 5);
    const cells: [number, string | undefined, boolean][] = [
      [1, l?.[0], true],
      [3, l?.[1], false],
      [4, rt?.[0], true],
      [6, rt?.[1], false],
    ];
    for (const [c, v, isLabel] of cells) {
      const cell = ws.getCell(r, c);
      cell.value = v ?? "";
      cell.font = { name: FONT, size: 10, bold: isLabel, color: { argb: isLabel ? GRAY : INK } };
      cell.alignment = { vertical: "middle", horizontal: "left", wrapText: true, indent: 1 };
    }
    for (let c = 1; c <= COLS; c++) ws.getCell(r, c).border = BORDER;
    const longest = Math.max(String(l?.[1] ?? "").length / 26, String(rt?.[1] ?? "").length / 26);
    ws.getRow(r).height = longest > 1 ? 34 : 22;
  }
  return row + n + 1;
}

function drawSection(ws: Worksheet, row: number, text: string): number {
  ws.mergeCells(row, 1, row, COLS);
  const c = ws.getCell(row, 1);
  c.value = text;
  c.font = { name: FONT, size: 11, bold: true, color: { argb: TEAL } };
  c.alignment = { vertical: "middle", horizontal: "left" };
  ws.getRow(row).height = 22;
  return row + 1;
}

type TableSpec = { head: string[]; body: (string | number)[][]; foot?: (string | number)[]; numFmt?: (string | undefined)[]; align?: ("left" | "center" | "right")[] };

function drawTable(ws: Worksheet, row: number, spec: TableSpec): number {
  const n = spec.head.length;
  const hr = ws.getRow(row);
  hr.height = 24;
  spec.head.forEach((h, i) => {
    const c = ws.getCell(row, i + 1);
    c.value = h;
    c.font = { name: FONT, size: 10, bold: true, color: { argb: "FFFFFFFF" } };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: TEAL } };
    c.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    c.border = BORDER;
  });
  let r = row + 1;
  const style = (c: ReturnType<Worksheet["getCell"]>, i: number, bold: boolean, fill?: string) => {
    c.font = { name: FONT, size: 10, bold, color: { argb: INK } };
    c.alignment = { vertical: "middle", horizontal: spec.align?.[i] ?? "left", wrapText: true, indent: (spec.align?.[i] ?? "left") === "left" ? 1 : 0 };
    c.border = BORDER;
    if (spec.numFmt?.[i] && typeof c.value === "number") c.numFmt = spec.numFmt[i]!;
    if (fill) c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fill } };
  };
  for (const line of spec.body) {
    line.forEach((v, i) => {
      const c = ws.getCell(r, i + 1);
      c.value = v;
      style(c, i, false);
    });
    ws.getRow(r).height = 20;
    r++;
  }
  if (spec.foot) {
    spec.foot.forEach((v, i) => {
      const c = ws.getCell(r, i + 1);
      c.value = v === "" ? null : v;
      style(c, i, true, SOFT);
    });
    for (let i = spec.foot.length; i < n; i++) style(ws.getCell(r, i + 1), i, true, SOFT);
    ws.getRow(r).height = 22;
    r++;
  }
  return r + 1;
}

function drawApproval(ws: Worksheet, row: number, o: { submittedDate?: string; approved: boolean; approvedDate?: string; approver?: { role: string; name: string; pendingText: string } }): number {
  const boxes: { c1: number; c2: number; heading: string; role: string; status: string; color: string; name: string; meta: string }[] = [
    {
      c1: 1,
      c2: 3,
      heading: "DIAJUKAN OLEH",
      role: "Procurement",
      status: "DIAJUKAN",
      color: TEAL,
      name: "Tim Procurement",
      meta: o.submittedDate ? `Tanggal pengajuan: ${formatDate(o.submittedDate)}` : "Tanggal pengajuan: —",
    },
    {
      c1: 4,
      c2: 6,
      heading: "DISETUJUI OLEH",
      role: o.approver?.role ?? "Finance",
      status: o.approved ? "DISETUJUI" : "MENUNGGU PERSETUJUAN",
      color: o.approved ? GREEN : AMBER,
      name: o.approver?.name ?? "Finance",
      meta: o.approved ? (o.approvedDate ? `Tanggal persetujuan: ${formatDate(o.approvedDate)}` : "Sudah disetujui") : (o.approver?.pendingText ?? "Belum disetujui Finance"),
    },
  ];
  const rows = [row, row + 1, row + 2, row + 3];
  ws.getRow(rows[0]).height = 20;
  ws.getRow(rows[1]).height = 40;
  ws.getRow(rows[2]).height = 20;
  ws.getRow(rows[3]).height = 18;
  for (const b of boxes) {
    for (const r of rows) {
      ws.mergeCells(r, b.c1, r, b.c2);
      for (let c = b.c1; c <= b.c2; c++) ws.getCell(r, c).border = BORDER;
    }
    const head = ws.getCell(rows[0], b.c1);
    head.value = `${b.heading}  ·  ${b.role}`;
    head.font = { name: FONT, size: 9, bold: true, color: { argb: INK } };
    head.fill = { type: "pattern", pattern: "solid", fgColor: { argb: SOFT } };
    head.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
    const status = ws.getCell(rows[1], b.c1);
    status.value = b.status;
    status.font = { name: FONT, size: 11, bold: true, color: { argb: b.color } };
    status.alignment = { vertical: "middle", horizontal: "center" };
    const nm = ws.getCell(rows[2], b.c1);
    nm.value = b.name;
    nm.font = { name: FONT, size: 10, bold: true, color: { argb: INK } };
    nm.alignment = { vertical: "middle", horizontal: "center" };
    nm.border = { ...BORDER, top: { style: "thin", color: { argb: INK } } };
    const meta = ws.getCell(rows[3], b.c1);
    meta.value = b.meta;
    meta.font = { name: FONT, size: 8, color: { argb: GRAY } };
    meta.alignment = { vertical: "middle", horizontal: "center" };
  }
  return row + 5;
}

function materialSheet(wb: Workbook, ws: Worksheet, logo: Logo | null, po: MaterialPO, mrpDetails: MrpDetail[], variant: PoExportVariant = "internal") {
  setupSheet(ws);
  const vendorName = VENDOR_PRODUKSI[po.vendorProduksi]?.name ?? po.vendorProduksi;
  const mrpDetail = mrpDetailFor(po.mrpId, mrpDetails);
  const kategori = mrpDetail?.mrp.kategori ?? "—";
  const totalRoll = po.colorBreakdown.reduce((s, c) => s + c.rollCount, 0);
  const totalKg = totalRoll * ROLL_KG_ESTIMATE;
  // "external" -- lihat catatan lengkap di exportPoPdf.ts (PoExportVariant): gabung PENDEK+PANJANG
  // warna yang sama jadi 1 baris.
  const colorBreakdown =
    variant === "internal"
      ? po.colorBreakdown
      : Array.from(
          po.colorBreakdown.reduce((map, c) => {
            const cur = map.get(c.warna);
            if (cur) cur.rollCount += c.rollCount;
            else map.set(c.warna, { warna: c.warna, lengan: c.lengan, rollCount: c.rollCount, entitas: c.entitas });
            return map;
          }, new Map<string, (typeof po.colorBreakdown)[number]>()).values()
        );

  let r = drawHeader(wb, ws, logo, "PROPOSAL PURCHASE ORDER MATERIAL BAHAN");
  r = drawInfo(
    ws,
    r,
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
      ["Total Roll", `${totalRoll.toLocaleString("id-ID", { maximumFractionDigits: 1 })}`],
      ["Total Kg (estimasi)", `${totalKg.toLocaleString("id-ID", { maximumFractionDigits: 1 })}`],
    ]
  );

  r = drawSection(ws, r, `1. Rincian Bahan — ${po.supplier}`);
  r = drawTable(ws, r, {
    head: ["No", "Kategori", "Warna", "Roll", "Kg"],
    body: colorBreakdown.map((c, i) => [i + 1, kategori, variant === "internal" && c.lengan ? `${c.warna} · ${c.lengan}` : c.warna, c.rollCount, c.rollCount * ROLL_KG_ESTIMATE]),
    foot: ["", "", "TOTAL", totalRoll, totalKg],
    numFmt: [undefined, undefined, undefined, "#,##0.0", "#,##0.0"],
    align: ["center", "left", "left", "right", "right"],
  });

  let section = 1;
  const kinds: [AduanMaterialKind, string][] = [
    ["rib", "RIB"],
    ["kerah", "KERAH"],
    ["manset", "MANSET"],
  ];
  for (const [kind, label] of kinds) {
    const rawList = po.colorBreakdown.map((c) => {
      const group = mrpDetail?.lenganGroups.find((g) => g.warna === c.warna && g.lengan === c.lengan);
      const kgPerRoll = group ? materialKgPerRollForGroup(group, kind) : 0;
      return { warna: c.warna, lengan: c.lengan, roll: c.rollCount, kgPerRoll, kg: kgPerRoll * c.rollCount };
    });
    const list =
      variant === "internal"
        ? rawList
        : Array.from(
            rawList.reduce((map, x) => {
              const cur = map.get(x.warna);
              if (cur) {
                cur.roll += x.roll;
                cur.kg += x.kg;
              } else map.set(x.warna, { ...x });
              return map;
            }, new Map<string, (typeof rawList)[number]>()).values()
          );
    const totalKgKind = list.reduce((s, x) => s + x.kg, 0);
    if (totalKgKind <= 0) continue;
    section++;
    r = drawSection(ws, r, `${section}. Permintaan ${label}`);
    r =
      variant === "internal"
        ? drawTable(ws, r, {
            head: ["No", "Warna", "Lengan", "Roll", `${label}/roll (kg)`, `Total ${label} (kg)`],
            body: list.map((x, i) => [i + 1, x.warna, x.lengan, x.roll, x.kgPerRoll, x.kg]),
            foot: ["", "", "TOTAL", list.reduce((s, x) => s + x.roll, 0), "", totalKgKind],
            numFmt: [undefined, undefined, undefined, "#,##0.0", "#,##0.00", "#,##0.00"],
            align: ["center", "left", "left", "right", "right", "right"],
          })
        : drawTable(ws, r, {
            head: ["No", "Warna", "Roll", `Total ${label} (kg)`],
            body: list.map((x, i) => [i + 1, x.warna, x.roll, x.kg]),
            foot: ["", "TOTAL", list.reduce((s, x) => s + x.roll, 0), totalKgKind],
            numFmt: [undefined, undefined, "#,##0.0", "#,##0.00"],
            align: ["center", "left", "right", "right"],
          });
  }
  drawApproval(ws, r + 1, { submittedDate: mrpDetail?.dates.poSent, approved: po.approved, approvedDate: mrpDetail?.dates.poApproved, approver: poApprovalPrintInfo(po) });
}

function maklonSheet(wb: Workbook, ws: Worksheet, logo: Logo | null, po: MaklonPO, mrpDetails: MrpDetail[], variant: PoExportVariant = "internal") {
  setupSheet(ws);
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

  let r = drawHeader(wb, ws, logo, "PROPOSAL PURCHASE ORDER PRODUKSI");
  r = drawInfo(
    ws,
    r,
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
      ["Total Qty", `${po.qty.toLocaleString("id-ID")} pcs`],
    ]
  );
  r = drawSection(ws, r, `1. ${vendorName}`);
  if (warnaRows.length > 0) {
    r =
      variant === "internal"
        ? drawTable(ws, r, {
            head: ["No", "Kategori", "Warna", "Qty PDK", "Qty PJG", "No. MRP"],
            body: warnaRows.map((x, i) => [i + 1, kategori, x.warna, x.pdk || "—", x.pjg || "—", po.mrpId]),
            foot: ["", "", "TOTAL", warnaRows.reduce((s, x) => s + x.pdk, 0), warnaRows.reduce((s, x) => s + x.pjg, 0), ""],
            numFmt: [undefined, undefined, undefined, "#,##0", "#,##0", undefined],
            align: ["center", "left", "left", "right", "right", "left"],
          })
        : drawTable(ws, r, {
            head: ["No", "Kategori", "Warna", "Qty", "No. MRP"],
            body: warnaRows.map((x, i) => [i + 1, kategori, x.warna, x.pdk + x.pjg, po.mrpId]),
            foot: ["", "", "TOTAL", warnaRows.reduce((s, x) => s + x.pdk + x.pjg, 0), ""],
            numFmt: [undefined, undefined, undefined, "#,##0", undefined],
            align: ["center", "left", "left", "right", "left"],
          });
  } else {
    const c = ws.getCell(r, 1);
    c.value = "Tidak ada rincian aduan pola untuk vendor ini.";
    c.font = { name: FONT, size: 9, italic: true, color: { argb: GRAY } };
    r += 2;
  }
  drawApproval(ws, r + 1, { submittedDate: detail?.dates.poSent, approved: po.approved, approvedDate: detail?.dates.poApproved, approver: poApprovalPrintInfo(po) });
}

async function download(wb: Workbook, fileName: string) {
  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

async function newWorkbook(): Promise<{ wb: Workbook; logo: Logo | null }> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = "Tigalapan Indonesia";
  wb.created = new Date();
  return { wb, logo: await loadLogo() };
}

/** 1 PO Material = 1 sheet; banyak PO = banyak sheet dalam 1 file. No-op kalau `pos` kosong. */
export async function exportMaterialPoExcel(pos: MaterialPO[], mrpDetails: MrpDetail[], fileName: string, variant: PoExportVariant = "internal") {
  if (pos.length === 0) return;
  const { wb, logo } = await newWorkbook();
  for (const po of pos) materialSheet(wb, wb.addWorksheet(sheetName(wb, `PO ${po.id.replace(/^PO-(SUP-)?/, "")}`)), logo, po, mrpDetails, variant);
  await download(wb, fileName);
}

/** 1 PO Produksi (maklon) = 1 sheet; banyak PO = banyak sheet dalam 1 file. No-op kalau `pos` kosong. */
export async function exportMaklonPoExcel(pos: MaklonPO[], mrpDetails: MrpDetail[], fileName: string, variant: PoExportVariant = "internal") {
  if (pos.length === 0) return;
  const { wb, logo } = await newWorkbook();
  for (const po of pos) maklonSheet(wb, wb.addWorksheet(sheetName(wb, `PO ${po.id.replace(/^PO-(MKL-)?/, "")}`)), logo, po, mrpDetails, variant);
  await download(wb, fileName);
}

type ExcelJS_Buffer = Parameters<Workbook["addImage"]>[0]["buffer"];
