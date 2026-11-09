import type { Workbook } from "exceljs";
import { SIZE_ORDER, compareNoKoli } from "./derive";
import { dayKey, ltTiba } from "./itemEstimates";
import { koliRowsForItem, type ItemTrackRow, type ItemMrpVendorRow } from "./itemTracking";
import { VENDOR_PRODUKSI } from "./seed";
import type { DeliveryKoli, ProductionBatch, WarehouseReceipt } from "./types";
import type { WosKoliStatus } from "./wosStatusMap";

// Export Excel Tracking Item (PPIC/SCM). Sheet utama "PENGIRIMAN" (format baru 2026-11-09, mengikuti contoh owner): SATU BARIS PER KOLI x ITEM dengan kolom ITEM, NO.PO, QTY,
// NO.KOLI, STATUS, lalu TGL DELIVERY KOLI (tanggal koli dikirim). Di kanan ada EST. TIBA DC (tanggal delivery + LT, rumus; hanya koli yang masih di jalan) dan EST. KIRIM (hanya baris
// yang belum dikirim). Barang yang belum masuk koli ikut tampil per posisi (FG belum masuk koli, Cutting belum FG, Belum cutting) tanpa NO.KOLI. NO.PO = nomor PO Produksi (maklon)
// MRP + vendor. Dua sheet pendukung: "Ringkasan per item" dan "Rincian per MRP dan vendor" (qty per posisi proses, tanggal, estimasi).

const INK = "FF1A1A1F";
const ORANGE = "FFFFC000";
const HEAD_BG = "FF2563EB";
const INPUT_INK = "FF1D4ED8";
const LINE = "FFD3D8DF";
const FONT = "Calibri";
const thin = { style: "thin" as const, color: { argb: LINE } };
const BORDER = { top: thin, left: thin, bottom: thin, right: thin };
const FMT_DATE = "dd/mm/yyyy";
const FMT_INT = "#,##0";

const vendorName = (id: string) => (id ? VENDOR_PRODUKSI[id]?.name ?? id : "BELUM DIALOKASIKAN");
const dateOf = (iso?: string): Date | null => {
  if (!iso) return null;
  const [y, m, d] = iso.split("-").map(Number);
  return y && m && d ? new Date(Date.UTC(y, m - 1, d)) : null;
};
const serial = (iso: string) => {
  const d = dateOf(iso);
  return d ? Math.round((d.getTime() - Date.UTC(1899, 11, 30)) / 86400000) : 0;
};
const dateList = (dates: string[]) => dates.map((d) => d.split("-").reverse().join("/")).join(", ");
const asNumberIfDigits = (s: string): string | number => (/^\d+$/.test(s.trim()) ? Number(s.trim()) : s);

export type TrackingExportInput = {
  rows: ItemTrackRow[];
  filterLabel?: string;
  /** Koli, penerimaan Warehouse ERP, dan status WOS: sumber baris per koli sheet PENGIRIMAN. Kosong = sheet hanya memuat barang yang belum masuk koli. */
  kolis?: DeliveryKoli[];
  receipts?: WarehouseReceipt[];
  wosByKoli?: Record<string, WosKoliStatus>;
  /** Kunci "MRP|vendor" -> nomor PO Produksi (beberapa PO digabung koma). */
  poByMrpVendor?: Record<string, string>;
  /** Filter tanggal kirim di layar (yyyy-mm-dd): hanya koli yang dikirim pada rentang itu yang diekspor. */
  dateFrom?: string;
  dateTo?: string;
  /** Roll produksi (penghubung item koli -> aduan lewat `sourceBatchId`) dan daftar aduan pola semua MRP: sumber sheet per koli dan per aduan. */
  batches?: ProductionBatch[];
  aduans?: AduanRef[];
};

/** Aduan pola (alokasi warna x lengan ke satu vendor) beserta MRP-nya. */
export type AduanRef = { id: string; mrpId: string; kode: string; vendor: string; warna: string; lengan: string; qty: number; qtyRoll: number; sizes: { size: string; qty: number }[] };

export type PengirimanRow = {
  item: string;
  po: string;
  qty: number;
  /** Kosong untuk barang yang belum masuk koli. */
  koli: string;
  status: string;
  /** Tanggal koli dikirim (yyyy-mm-dd). */
  sentAt?: string;
  /** Lama kirim sampai tiba di DC (hari); dipakai kalau `estTiba` dihitung. */
  lt: number;
  /** Est. Tiba DC = tanggal kirim + LT, hanya koli yang sudah dikirim dan belum sampai DC. */
  estTiba: boolean;
  /** Tanggal asumsi kirim, hanya baris yang belum dikirim. */
  estKirim?: string;
};

/** Status satu koli (aturan sama dengan kolom Diterima DC di tabel Tracking Item). `transit` = sudah dikirim tetapi belum sampai DC. */
function koliStatus(deliveredAt: string | undefined, receivedAt: string | undefined, w: WosKoliStatus | undefined): { label: string; transit: boolean } {
  if (!deliveredAt) return { label: "BELUM DIKIRIM (SUDAH DI KOLI)", transit: false };
  if (receivedAt || w?.code === "DITERIMA") return { label: "DITERIMA", transit: false };
  if (w?.code === "BERMASALAH") return { label: "DITERIMA (BERMASALAH)", transit: false };
  if (w?.code === "TIBA") return { label: "TIBA DC, BELUM VALIDASI", transit: false };
  return { label: "DALAM PERJALANAN", transit: true };
}

/** Baris sheet PENGIRIMAN: per item, koli lebih dulu (urut NO.PO lalu no. koli), lalu barang yang belum masuk koli (FG, Cutting, Belum cutting). */
export function pengirimanRows(input: TrackingExportInput): PengirimanRow[] {
  const { rows, kolis = [], receipts = [], wosByKoli = {}, poByMrpVendor = {}, dateFrom, dateTo } = input;
  const dateOn = !!dateFrom || !!dateTo;
  const poOf = (mrp: string, vendor: string) => poByMrpVendor[`${mrp}|${vendor}`] ?? "";
  const byPo = (a: PengirimanRow, b: PengirimanRow) => a.po.localeCompare(b.po, "id-ID", { numeric: true }) || compareNoKoli(a.koli, b.koli);
  const out: PengirimanRow[] = [];
  for (const r of rows) {
    const cellOf = (mrp: string, vendor: string): ItemMrpVendorRow | undefined => r.breakdown.find((b) => b.mrpId === mrp && b.vendorProduksi === vendor);
    const koliPart: PengirimanRow[] = [];
    for (const k of koliRowsForItem(r, kolis, receipts)) {
      const sent = dayKey(k.deliveredAt);
      if (dateOn && (!sent || (dateFrom && sent < dateFrom) || (dateTo && sent > dateTo))) continue;
      const w = wosByKoli[k.koliId];
      const base = { item: r.itemName, po: poOf(k.mrpId, k.vendorProduksi), qty: k.qty, koli: k.noKoli, sentAt: sent, lt: ltTiba(k.vendorProduksi) };
      const st = koliStatus(k.deliveredAt, k.receivedAt, w);
      koliPart.push({ ...base, status: st.label, estTiba: st.transit && !!sent, estKirim: k.deliveredAt ? undefined : cellOf(k.mrpId, k.vendorProduksi)?.estKirimFg });
    }
    out.push(...koliPart.sort(byPo));
    if (dateOn) continue; // filter tanggal kirim: barang yang belum dikirim tidak ikut
    const restPart: PengirimanRow[] = [];
    for (const b of r.breakdown) {
      if (!b.vendorProduksi) continue; // target yang belum dialokasikan ke vendor belum punya rencana kirim
      const base = { item: r.itemName, po: poOf(b.mrpId, b.vendorProduksi), koli: "", lt: ltTiba(b.vendorProduksi), estTiba: false };
      if (b.fgWip > 0) restPart.push({ ...base, qty: b.fgWip, status: "FG, BELUM MASUK KOLI", estKirim: b.estKirimFg });
      if (b.cuttingWip > 0) restPart.push({ ...base, qty: b.cuttingWip, status: "CUTTING, BELUM FG", estKirim: b.estKirimCut });
      if (b.belumCutting > 0) restPart.push({ ...base, qty: b.belumCutting, status: "BELUM CUTTING" });
    }
    out.push(...restPart.sort((x, y) => x.po.localeCompare(y.po, "id-ID", { numeric: true })));
  }
  return out;
}

function pengirimanSheet(wb: Workbook, input: TrackingExportInput) {
  const rows = pengirimanRows(input);
  const ws = wb.addWorksheet("PENGIRIMAN", { views: [{ state: "frozen", ySplit: 1 }] });
  const heads = ["ITEM", "NO.PO", "QTY", "NO.KOLI", "STATUS", "TGL DELIVERY KOLI", "EST. TIBA DC", "EST. KIRIM"];
  ws.columns = [{ width: 28 }, { width: 28 }, { width: 9 }, { width: 10 }, { width: 32 }, { width: 18 }, { width: 14 }, { width: 14 }];
  heads.forEach((h, i) => {
    const cell = ws.getCell(1, i + 1);
    cell.value = h;
    cell.font = { name: FONT, size: 10, bold: true, color: { argb: INK } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: ORANGE } };
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    cell.border = BORDER;
  });
  ws.getCell(1, 7).note = "Tanggal delivery koli + LT (lama kirim sampai tiba di DC: Konveksi Makassar 1 hari, vendor lain 7 hari). Hanya untuk koli berstatus DALAM PERJALANAN.";
  ws.getCell(1, 8).note = "Tanggal asumsi kirim (Est. Kirim) untuk barang yang belum dikirim.";
  ws.getRow(1).height = 24;

  const FIRST = 2;
  rows.forEach((r, idx) => {
    const n = FIRST + idx;
    const put = (c: number, v: unknown, fmt?: string, input = false, align?: "left" | "right" | "center") => {
      const cell = ws.getCell(n, c);
      cell.value = v as never;
      cell.font = { name: FONT, size: 10, color: { argb: input ? INPUT_INK : INK } };
      cell.border = BORDER;
      if (fmt) cell.numFmt = fmt;
      if (align) cell.alignment = { horizontal: align };
    };
    put(1, r.item);
    put(2, r.po || null);
    put(3, r.qty, FMT_INT, true, "right");
    put(4, r.koli ? asNumberIfDigits(r.koli) : null, undefined, true, "right");
    put(5, r.status);
    put(6, r.sentAt ? dateOf(r.sentAt) : null, FMT_DATE, true, "center");
    if (r.estTiba && r.sentAt) put(7, { formula: `IF(F${n}="","",F${n}+${r.lt})`, result: serial(r.sentAt) + r.lt }, FMT_DATE, false, "center");
    else put(7, null, FMT_DATE);
    put(8, r.estKirim ? dateOf(r.estKirim) : null, FMT_DATE, false, "center");
  });
  const LAST = FIRST + rows.length - 1;
  if (rows.length > 0) {
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: LAST, column: heads.length } };
    const T = LAST + 2;
    ws.getCell(T, 1).value = "TOTAL";
    ws.getCell(T, 1).font = { name: FONT, size: 10, bold: true, color: { argb: INK } };
    const cell = ws.getCell(T, 3);
    cell.value = { formula: `SUBTOTAL(9,C${FIRST}:C${LAST})`, result: rows.reduce((a, r) => a + r.qty, 0) };
    cell.numFmt = FMT_INT;
    cell.font = { name: FONT, size: 10, bold: true, color: { argb: INK } };
  }
  ws.pageSetup = { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
}

// ---- Sheet "Sudah Delivery per Koli" dan "WIP per Aduan" (2026-11-09): susunan kolom dan warna header mengikuti sheet Detail Roll di Laporan HPP, TANPA nilai HPP / biaya.
// Dipisah menurut posisi barang: yang SUDAH DIKIRIM dilihat per koli (satu baris per koli x aduan x size; aduan ditemukan lewat roll asal item: `sourceBatchId` -> roll -> aduan, item tanpa
// roll asal = "(tanpa aduan)"); yang MASIH WIP (belum cutting, cutting, FG, atau sudah di koli tetapi belum dikirim) dilihat per aduan x size. Keduanya saling melengkapi tanpa tumpang tindih.

const GRP_ID = "FF475569";
const GRP_ONG = "FFB45309";
const GRP_ADU = "FF7C3AED";
const NO_ADUAN = "(tanpa aduan)";
const sizeRank = (size: string) => {
  const i = SIZE_ORDER.indexOf(size.trim().toUpperCase());
  return i < 0 ? SIZE_ORDER.length : i;
};

export type KoliAduanRow = {
  vendor: string;
  po: string;
  mrp: string;
  aduan: string;
  warna: string;
  lengan: string;
  size: string;
  roll: string;
  qty: number;
  resi: string;
  koli: string;
  ekspedisi: string;
  sentAt?: string;
  status: string;
  beratKoli: number | null;
  beratResi: number | null;
  pcsKoli: number;
};

/** Baris "Sudah Delivery per Koli": hanya koli yang sudah dikirim, dan item (MRP x vendor x warna x lengan x size) yang lolos filter layar; reject tidak dihitung. */
export function koliAduanRows(input: TrackingExportInput): KoliAduanRow[] {
  const { rows, kolis = [], receipts = [], wosByKoli = {}, poByMrpVendor = {}, batches = [], aduans = [], dateFrom, dateTo } = input;
  const dateOn = !!dateFrom || !!dateTo;
  const scope = new Set<string>();
  for (const r of rows) for (const b of r.breakdown) if (b.vendorProduksi) scope.add(`${b.mrpId}|${b.vendorProduksi}|${r.warna}|${r.lengan}|${r.size}`);
  const batchById = new Map(batches.map((b) => [b.id, b]));
  const aduanById = new Map(aduans.map((a) => [a.id, a]));
  const receivedAt = new Map<string, string>();
  for (const rc of receipts) for (const id of rc.koliIds) receivedAt.set(id, rc.receivedAt);
  // Berat resi = jumlah berat semua koli dalam satu grup resi (termasuk koli yang tidak lolos filter).
  const weightByResi = new Map<string, number>();
  for (const k of kolis) if (k.resiGroupId && k.beratKoli) weightByResi.set(k.resiGroupId, (weightByResi.get(k.resiGroupId) ?? 0) + k.beratKoli);

  const out: KoliAduanRow[] = [];
  for (const k of kolis) {
    if (!k.deliveredAt) continue; // koli yang belum dikirim = WIP, ada di sheet "WIP per Aduan"
    const sent = dayKey(k.deliveredAt);
    if (dateOn && (!sent || (dateFrom && sent < dateFrom) || (dateTo && sent > dateTo))) continue;
    const pcsKoli = k.items.reduce((s, it) => s + (it.kind === "REJECT" ? 0 : it.qty), 0);
    const groups = new Map<string, KoliAduanRow & { codes: Set<string> }>();
    for (const it of k.items) {
      if (it.kind === "REJECT" || it.qty <= 0) continue;
      if (!scope.has(`${k.mrpId}|${k.vendorProduksi}|${it.warna}|${it.lengan}|${it.size}`)) continue;
      const batch = it.sourceBatchId ? batchById.get(it.sourceBatchId) : undefined;
      const aduan = batch ? aduanById.get(batch.aduanRowId) : undefined;
      const aduanLabel = aduan ? aduan.kode : batch?.kode || NO_ADUAN;
      const key = `${aduanLabel}|${it.warna}|${it.lengan}|${it.size}`;
      let g = groups.get(key);
      if (!g) {
        const st = koliStatus(k.deliveredAt, receivedAt.get(k.id), wosByKoli[k.id]);
        g = {
          vendor: vendorName(k.vendorProduksi), po: poByMrpVendor[`${k.mrpId}|${k.vendorProduksi}`] ?? "", mrp: k.mrpId, aduan: aduanLabel, warna: it.warna, lengan: it.lengan === "PENDEK" ? "Pendek" : "Panjang", size: it.size,
          roll: "", qty: 0, resi: k.noResi ?? "", koli: k.noKoli, ekspedisi: k.ekspedisi ?? "", sentAt: sent, status: st.label, beratKoli: k.beratKoli ?? null,
          beratResi: k.resiGroupId ? weightByResi.get(k.resiGroupId) ?? null : null, pcsKoli, codes: new Set<string>(),
        };
        groups.set(key, g);
      }
      g.qty += it.qty;
      if (batch?.codeRoll) g.codes.add(batch.codeRoll);
    }
    for (const g of groups.values()) {
      const { codes, ...rest } = g;
      out.push({ ...rest, roll: Array.from(codes).sort().join(", ") });
    }
  }
  return out.sort(
    (a, b) =>
      a.po.localeCompare(b.po, "id-ID", { numeric: true }) || compareNoKoli(a.koli, b.koli) || a.aduan.localeCompare(b.aduan, "id-ID", { numeric: true }) || a.warna.localeCompare(b.warna) || sizeRank(a.size) - sizeRank(b.size)
  );
}

type SheetCol<T> = { head: string; width: number; bg: string; kind: "text" | "int" | "dec" | "date"; value: (r: T) => string | number | Date | null };

/** Sheet bergaya Laporan HPP: judul, catatan, header berwarna per kelompok, filter, baris beku, dan TOTAL (SUBTOTAL) di bawah kolom qty. */
function templateSheet<T>(wb: Workbook, name: string, title: string, note: string, cols: SheetCol<T>[], rows: T[], totalCols: number[]) {
  const ws = wb.addWorksheet(name, { views: [{ state: "frozen", xSplit: 3, ySplit: 4 }] });
  ws.columns = cols.map((c) => ({ width: c.width }));
  ws.mergeCells(1, 1, 1, Math.min(cols.length, 9));
  ws.getCell(1, 1).value = title;
  ws.getCell(1, 1).font = { name: FONT, size: 14, bold: true, color: { argb: INK } };
  ws.mergeCells(2, 1, 2, Math.min(cols.length, 14));
  ws.getCell(2, 1).value = note;
  ws.getCell(2, 1).font = { name: FONT, size: 9, italic: true, color: { argb: "FF828290" } };
  ws.getCell(2, 1).alignment = { wrapText: true, vertical: "top" };
  ws.getRow(2).height = 52;
  ws.mergeCells(3, 1, 3, Math.min(cols.length, 14));
  ws.getCell(3, 1).value = "Warna header: ABU = identitas dan qty · ORANYE = koli dan pengiriman · UNGU = aduan · BIRU = data masukan (angka dari produksi dan pengiriman)";
  ws.getCell(3, 1).font = { name: FONT, size: 9, bold: true, color: { argb: INPUT_INK } };
  cols.forEach((c, i) => {
    const cell = ws.getCell(4, i + 1);
    cell.value = c.head;
    cell.font = { name: FONT, size: 10, bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: c.bg } };
    cell.alignment = { vertical: "middle", horizontal: c.kind === "text" || c.kind === "date" ? "left" : "right", wrapText: true };
    cell.border = BORDER;
  });
  ws.getRow(4).height = 32;
  rows.forEach((r, ri) => {
    cols.forEach((c, ci) => {
      const cell = ws.getCell(5 + ri, ci + 1);
      const v = c.value(r);
      cell.value = v === "" ? null : v;
      cell.font = { name: FONT, size: 10, color: { argb: typeof v === "number" ? INPUT_INK : INK } };
      cell.border = BORDER;
      cell.alignment = { vertical: "middle", horizontal: c.kind === "text" || c.kind === "date" ? "left" : "right" };
      if (c.kind === "int") cell.numFmt = FMT_INT;
      if (c.kind === "dec") cell.numFmt = "#,##0.00";
      if (c.kind === "date") cell.numFmt = FMT_DATE;
      if (ri % 2 === 1) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF0F3F6" } };
    });
  });
  if (rows.length === 0) {
    ws.getCell(5, 1).value = "Belum ada data.";
    return;
  }
  const FIRST = 5;
  const LAST = FIRST + rows.length - 1;
  ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: LAST, column: cols.length } };
  const T = LAST + 2;
  ws.getCell(T, 1).value = "TOTAL";
  ws.getCell(T, 1).font = { name: FONT, size: 10, bold: true, color: { argb: INK } };
  for (const ci of totalCols) {
    const L = colLetter(ci + 1);
    const cell = ws.getCell(T, ci + 1);
    cell.value = { formula: `SUBTOTAL(9,${L}${FIRST}:${L}${LAST})`, result: rows.reduce((a, r) => a + (Number(cols[ci].value(r)) || 0), 0) };
    cell.numFmt = FMT_INT;
    cell.font = { name: FONT, size: 10, bold: true, color: { argb: INK } };
  }
  ws.pageSetup = { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
}

const colLetter = (n: number) => {
  let s = "";
  for (let x = n; x > 0; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(65 + ((x - 1) % 26)) + s;
  return s;
};

function koliAduanSheet(wb: Workbook, input: TrackingExportInput, note: string) {
  const rows = koliAduanRows(input);
  const cols: SheetCol<KoliAduanRow>[] = [
    { head: "Vendor", width: 20, bg: GRP_ID, kind: "text", value: (r) => r.vendor },
    { head: "No PO Produksi", width: 24, bg: GRP_ID, kind: "text", value: (r) => r.po },
    { head: "MRP", width: 9, bg: GRP_ID, kind: "text", value: (r) => r.mrp },
    { head: "Kode Aduan", width: 16, bg: GRP_ADU, kind: "text", value: (r) => r.aduan },
    { head: "Warna", width: 24, bg: GRP_ID, kind: "text", value: (r) => r.warna },
    { head: "Lengan", width: 9, bg: GRP_ID, kind: "text", value: (r) => r.lengan },
    { head: "Size", width: 8, bg: GRP_ID, kind: "text", value: (r) => r.size },
    { head: "Code Roll", width: 22, bg: GRP_ADU, kind: "text", value: (r) => r.roll },
    { head: "Qty (pcs)", width: 10, bg: GRP_ID, kind: "int", value: (r) => r.qty },
    { head: "No Resi", width: 18, bg: GRP_ONG, kind: "text", value: (r) => r.resi },
    { head: "No Koli", width: 10, bg: GRP_ONG, kind: "int", value: (r) => (r.koli ? asNumberIfDigits(r.koli) : null) },
    { head: "Ekspedisi", width: 14, bg: GRP_ONG, kind: "text", value: (r) => r.ekspedisi },
    { head: "Tgl Kirim", width: 12, bg: GRP_ONG, kind: "date", value: (r) => (r.sentAt ? dateOf(r.sentAt) : null) },
    { head: "Status Pengiriman", width: 30, bg: GRP_ONG, kind: "text", value: (r) => r.status },
    { head: "Berat Resi (kg)", width: 13, bg: GRP_ONG, kind: "dec", value: (r) => r.beratResi },
    { head: "Berat Koli (kg)", width: 12, bg: GRP_ONG, kind: "dec", value: (r) => r.beratKoli },
    { head: "Pcs di Koli", width: 10, bg: GRP_ONG, kind: "int", value: (r) => r.pcsKoli },
  ];
  templateSheet(
    wb,
    "Sudah Delivery per Koli",
    "Sudah Delivery per Koli",
    `${note} · Hanya koli yang sudah dikirim (dalam perjalanan, tiba, atau diterima DC). Satu baris = satu koli x aduan x size (qty yang berasal dari aduan itu); gunakan filter di kolom No Koli atau Kode Aduan. Barang yang belum dikirim ada di sheet "WIP per Aduan". Susunan kolom mengikuti sheet Detail Roll di Laporan HPP, tanpa nilai HPP dan biaya. Pcs di Koli = isi seluruh koli (bukan hanya baris ini); Berat Resi = jumlah berat semua koli dalam resi yang sama. Reject tidak dihitung.`,
    cols,
    rows,
    [8]
  );
}

type WipRow = {
  mrp: string;
  vendor: string;
  po: string;
  aduan: string;
  warna: string;
  lengan: string;
  size: string;
  alokasi: number;
  belumCutting: number;
  cuttingWip: number;
  fgWip: number;
  diKoli: number;
  total: number;
  estKirim?: string;
};

/** Barang yang MASIH WIP per aduan x size: belum cutting, sudah cutting belum FG, FG belum masuk koli, dan sudah di koli tetapi belum dikirim. Hanya baris dengan sisa WIP > 0, mengikuti
 *  filter MRP, vendor, warna, lengan, dan size di layar (kosong kalau filter Tanggal Kirim aktif, karena WIP belum punya tanggal kirim). Rumus per size = rumus Tracking Item tetapi dari roll
 *  milik aduan itu: belum cutting = alokasi - cutting; cutting = cutting - FG; FG = FG - di koli - dikirim. Reject tidak tercatat per aduan, jadi masih ikut di kolom Cutting (belum FG). */
export function wipAduanRows(input: TrackingExportInput): WipRow[] {
  const { rows, kolis = [], poByMrpVendor = {}, batches = [], aduans = [], dateFrom, dateTo } = input;
  if (dateFrom || dateTo) return [];
  const cellByKey = new Map<string, ItemMrpVendorRow>();
  for (const r of rows) for (const b of r.breakdown) if (b.vendorProduksi) cellByKey.set(`${b.mrpId}|${b.vendorProduksi}|${r.warna}|${r.lengan}|${r.size}`, b);
  const batchesByAduan = new Map<string, ProductionBatch[]>();
  for (const b of batches) batchesByAduan.set(b.aduanRowId, [...(batchesByAduan.get(b.aduanRowId) ?? []), b]);
  const aduanOfBatch = new Map<string, string>();
  for (const b of batches) aduanOfBatch.set(b.id, b.aduanRowId);
  // Qty item koli per aduan x size, dipisah sudah dikirim / belum (reject tidak dihitung).
  const koliQty = new Map<string, { diKoli: number; dikirim: number }>();
  for (const k of kolis) {
    for (const it of k.items) {
      if (it.kind === "REJECT" || !it.sourceBatchId) continue;
      const aid = aduanOfBatch.get(it.sourceBatchId);
      if (!aid) continue;
      const key = `${aid}|${it.size}`;
      const q = koliQty.get(key) ?? { diKoli: 0, dikirim: 0 };
      if (k.deliveredAt) q.dikirim += it.qty;
      else q.diKoli += it.qty;
      koliQty.set(key, q);
    }
  }
  const out: WipRow[] = [];
  for (const a of aduans) {
    const bs = batchesByAduan.get(a.id) ?? [];
    const sizes = new Set<string>(a.sizes.map((s) => s.size));
    for (const b of bs) {
      for (const sz of Object.keys(b.sizeQty ?? {})) sizes.add(sz);
      for (const sz of Object.keys(b.fgSizeQty ?? {})) sizes.add(sz);
    }
    for (const sz of sizes) {
      const cell = cellByKey.get(`${a.mrpId}|${a.vendor}|${a.warna}|${a.lengan}|${sz}`);
      if (!cell) continue; // di luar filter layar
      const alokasi = a.sizes.find((s) => s.size === sz)?.qty ?? 0;
      const cutting = bs.reduce((s, b) => s + (b.sizeQty?.[sz] ?? 0), 0);
      const fg = bs.reduce((s, b) => s + (b.fgSizeQty?.[sz] ?? 0), 0);
      const q = koliQty.get(`${a.id}|${sz}`) ?? { diKoli: 0, dikirim: 0 };
      const belumCutting = Math.max(0, alokasi - cutting);
      const cuttingWip = Math.max(0, cutting - fg);
      const fgWip = Math.max(0, fg - q.diKoli - q.dikirim);
      const total = belumCutting + cuttingWip + fgWip + q.diKoli;
      if (total <= 0) continue;
      out.push({
        mrp: a.mrpId, vendor: vendorName(a.vendor), po: poByMrpVendor[`${a.mrpId}|${a.vendor}`] ?? "", aduan: a.kode, warna: a.warna, lengan: a.lengan === "PENDEK" ? "Pendek" : "Panjang", size: sz,
        alokasi, belumCutting, cuttingWip, fgWip, diKoli: q.diKoli, total, estKirim: cell.estKirim,
      });
    }
  }
  return out.sort(
    (x, y) =>
      y.mrp.localeCompare(x.mrp, undefined, { numeric: true }) || x.po.localeCompare(y.po, "id-ID", { numeric: true }) || x.aduan.localeCompare(y.aduan, "id-ID", { numeric: true }) || x.warna.localeCompare(y.warna) || x.lengan.localeCompare(y.lengan) || sizeRank(x.size) - sizeRank(y.size)
  );
}

function wipAduanSheet(wb: Workbook, input: TrackingExportInput, note: string) {
  const rows = wipAduanRows(input);
  const cols: SheetCol<WipRow>[] = [
    { head: "MRP", width: 9, bg: GRP_ID, kind: "text", value: (r) => r.mrp },
    { head: "Vendor", width: 20, bg: GRP_ID, kind: "text", value: (r) => r.vendor },
    { head: "No PO Produksi", width: 24, bg: GRP_ID, kind: "text", value: (r) => r.po },
    { head: "Kode Aduan", width: 16, bg: GRP_ADU, kind: "text", value: (r) => r.aduan },
    { head: "Warna", width: 24, bg: GRP_ID, kind: "text", value: (r) => r.warna },
    { head: "Lengan", width: 9, bg: GRP_ID, kind: "text", value: (r) => r.lengan },
    { head: "Size", width: 8, bg: GRP_ID, kind: "text", value: (r) => r.size },
    { head: "Alokasi Aduan (pcs)", width: 12, bg: GRP_ID, kind: "int", value: (r) => r.alokasi },
    { head: "Belum Cutting", width: 11, bg: GRP_ADU, kind: "int", value: (r) => r.belumCutting },
    { head: "Cutting (belum FG)", width: 12, bg: GRP_ADU, kind: "int", value: (r) => r.cuttingWip },
    { head: "Finish Good (belum masuk koli)", width: 15, bg: GRP_ADU, kind: "int", value: (r) => r.fgWip },
    { head: "Di Koli (belum dikirim)", width: 13, bg: GRP_ONG, kind: "int", value: (r) => r.diKoli },
    { head: "Total WIP (pcs)", width: 12, bg: GRP_ID, kind: "int", value: (r) => r.total },
    { head: "Est. Kirim", width: 12, bg: GRP_ONG, kind: "date", value: (r) => (r.estKirim ? dateOf(r.estKirim) : null) },
  ];
  templateSheet(
    wb,
    "WIP per Aduan",
    "Barang masih WIP per Aduan",
    `${note} · Satu baris = satu aduan x size yang masih punya sisa WIP (belum dikirim). Posisi tidak tumpang tindih: Belum Cutting + Cutting (belum FG) + Finish Good (belum masuk koli) + Di Koli (belum dikirim) = Total WIP. Dihitung dari roll milik aduan itu; reject tidak tercatat per aduan sehingga masih ikut di kolom Cutting (belum FG). Item koli tanpa roll asal (koli lama, rework) tidak bisa dikaitkan ke aduan, jadi tidak ikut di sini. Est. Kirim = tanggal asumsi kirim item (MRP x vendor x size). Barang yang sudah dikirim ada di sheet "Sudah Delivery per Koli". Kosong kalau filter Tanggal Kirim aktif.`,
    cols,
    rows,
    [7, 8, 9, 10, 11, 12]
  );
}

type Col<T> = { head: string; width: number; value: (r: T) => string | number | Date | null; fmt?: string };

function tableSheet<T>(wb: Workbook, name: string, title: string, cols: Col<T>[], rows: T[]) {
  const ws = wb.addWorksheet(name, { views: [{ state: "frozen", xSplit: 1, ySplit: 3 }] });
  ws.columns = cols.map((c) => ({ width: c.width }));
  ws.getCell(1, 1).value = title;
  ws.getCell(1, 1).font = { name: FONT, size: 14, bold: true, color: { argb: INK } };
  const HEAD = 3;
  cols.forEach((c, i) => {
    const cell = ws.getCell(HEAD, i + 1);
    cell.value = c.head;
    cell.font = { name: FONT, size: 10, bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEAD_BG } };
    cell.alignment = { vertical: "middle", horizontal: c.fmt === FMT_INT ? "right" : "left", wrapText: true };
    cell.border = BORDER;
  });
  ws.getRow(HEAD).height = 32;
  rows.forEach((r, idx) => {
    cols.forEach((c, i) => {
      const cell = ws.getCell(HEAD + 1 + idx, i + 1);
      cell.value = c.value(r);
      cell.font = { name: FONT, size: 10, color: { argb: INK } };
      cell.border = BORDER;
      if (c.fmt) cell.numFmt = c.fmt;
    });
  });
  if (rows.length > 0) ws.autoFilter = { from: { row: HEAD, column: 1 }, to: { row: HEAD + rows.length, column: cols.length } };
  ws.pageSetup = { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
}

type Stage = ItemTrackRow | ItemMrpVendorRow;
const shipDates = (r: Stage) => dateList("breakdown" in r ? r.shipDates : r.shipments.map((s) => s.date));
/** Kolom qty dan tanggal. Est. Tiba DC hanya di ringkasan per item; di rincian per MRP dan vendor estimasi tiba tidak ditampilkan (owner 2026-11-07). */
const stageCols = <T extends Stage>(withTiba: boolean): Col<T>[] => [
  { head: "Target MRP", width: 11, fmt: FMT_INT, value: (r) => ("breakdown" in r ? r.target : r.alokasi) },
  { head: "Belum Cutting", width: 11, fmt: FMT_INT, value: (r) => r.belumCutting },
  { head: "Tgl Good Receive", width: 14, fmt: FMT_DATE, value: (r) => dateOf(r.grAt) },
  { head: "Cutting (belum FG)", width: 11, fmt: FMT_INT, value: (r) => r.cuttingWip },
  { head: "Tgl Awal Cutting", width: 13, fmt: FMT_DATE, value: (r) => dateOf(r.cuttingAt) },
  { head: "Est. FG", width: 13, fmt: FMT_DATE, value: (r) => dateOf(r.estFg) },
  { head: "Finish Good (belum masuk koli)", width: 14, fmt: FMT_INT, value: (r) => r.fgWip },
  { head: "Tgl Awal FG", width: 13, fmt: FMT_DATE, value: (r) => dateOf(r.fgFirstAt) },
  { head: "Reject", width: 9, fmt: FMT_INT, value: (r) => r.reject },
  { head: "Di Koli (belum dikirim)", width: 12, fmt: FMT_INT, value: (r) => r.diKoli },
  { head: "Tgl Awal Di Koli", width: 13, fmt: FMT_DATE, value: (r) => dateOf(r.koliFirstAt) },
  { head: "Est. Kirim", width: 13, fmt: FMT_DATE, value: (r) => dateOf(r.estKirim) },
  { head: "Tanggal Kirim", width: 24, value: shipDates },
  { head: "Tgl Kirim Terakhir", width: 13, fmt: FMT_DATE, value: (r) => dateOf(r.shipLastAt) },
  { head: "Dikirim (belum tiba)", width: 12, fmt: FMT_INT, value: (r) => r.perjalanan },
  ...(withTiba ? [{ head: "Est. Tiba DC", width: 13, fmt: FMT_DATE, value: (r: T) => dateOf(r.estTiba) } as Col<T>] : []),
  { head: "Tiba DC (belum validasi)", width: 12, fmt: FMT_INT, value: (r) => r.tibaDc },
  { head: "Diterima DC", width: 11, fmt: FMT_INT, value: (r) => r.diterima },
  { head: "Tgl Diterima DC", width: 14, fmt: FMT_DATE, value: (r) => dateOf(r.receivedAt) },
  { head: "No. Koli Diterima", width: 20, value: (r) => r.receivedKoli.join(", ") || null },
  { head: "Total Cutting (kumulatif)", width: 12, fmt: FMT_INT, value: (r) => r.cutting },
  { head: "Total FG (kumulatif)", width: 12, fmt: FMT_INT, value: (r) => r.fg },
  { head: "Total Dikirim (kumulatif)", width: 12, fmt: FMT_INT, value: (r) => r.dikirim },
];

export async function buildTrackingWorkbook(input: TrackingExportInput): Promise<Workbook> {
  const ExcelJS = (await import("exceljs")).default;
  const wb: Workbook = new ExcelJS.Workbook();
  wb.creator = "Mini ERP Tigalapan";
  wb.created = new Date();
  wb.calcProperties.fullCalcOnLoad = true;
  const stamp = new Date().toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" });
  const note = `Diunduh ${stamp}${input.filterLabel ? " · " + input.filterLabel : ""}`;

  pengirimanSheet(wb, input);
  koliAduanSheet(wb, input, note);
  wipAduanSheet(wb, input, note);
  tableSheet<ItemTrackRow>(
    wb,
    "Ringkasan per item",
    `Ringkasan per item · qty per posisi proses (tidak tumpang tindih) · ${note}`,
    [
      { head: "Item", width: 28, value: (r) => r.itemName },
      { head: "Kategori", width: 14, value: (r) => r.kategori.join(", ") },
      ...stageCols<ItemTrackRow>(true),
    ],
    input.rows
  );
  const detail = input.rows.flatMap((r) => r.breakdown.map((b) => ({ item: r, cell: b })));
  tableSheet<{ item: ItemTrackRow; cell: ItemMrpVendorRow }>(
    wb,
    "Rincian per MRP dan vendor",
    `Rincian per MRP dan vendor · ${note}`,
    [
      { head: "Item", width: 28, value: (r) => r.item.itemName },
      { head: "No. MRP", width: 10, value: (r) => r.cell.mrpId },
      { head: "Vendor", width: 22, value: (r) => vendorName(r.cell.vendorProduksi) },
      { head: "Kategori", width: 14, value: (r) => r.cell.kategori },
      ...stageCols<ItemMrpVendorRow>(false).map((c) => ({ ...c, value: (r: { item: ItemTrackRow; cell: ItemMrpVendorRow }) => c.value(r.cell) })),
    ],
    detail
  );
  return wb;
}

export async function exportTrackingExcel(input: TrackingExportInput, fileName: string): Promise<void> {
  const wb = await buildTrackingWorkbook(input);
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

