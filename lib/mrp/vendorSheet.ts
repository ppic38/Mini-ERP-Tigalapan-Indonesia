// Sinkronisasi spreadsheet vendor (owner 2026-11-16, khusus vendor BAYU): BAYU punya sistem ERP sendiri yang mengisi spreadsheet (template dari ERP kita), spreadsheet itu
// di-"Publish to web", dan ERP kita membaca isinya supaya hasil produksi tidak diinput dua kali. Modul ini MURNI (tanpa database / jaringan) supaya bisa diuji:
//   - normalizeSheetUrl: validasi tautan publish-to-web (hanya docs.google.com/spreadsheets/d/e/<id>/pub, tautan yang kita bentuk sendiri = tidak ada SSRF),
//   - parseSheetTabs: isi tab "Produksi", "Reject", "Rework" menjadi baris terketik + daftar masalah per baris,
//   - planSheetSync: membandingkan baris sheet dengan keadaan ERP dan menghasilkan DAFTAR PERUBAHAN (cutting, finish good, klasifikasi reject, rework) yang idempoten --
//     isi sheet dianggap "keadaan yang diinginkan", jadi menjalankannya berulang tidak menggandakan apa pun.
// Pelaksanaannya (memanggil aksi vendor yang sudah ada dengan aturan yang sama) ada di lib/mrp/actions.ts.

/** Vendor yang boleh memakai sinkronisasi spreadsheet (fitur khusus BAYU). */
export const SHEET_SYNC_VENDORS = ["BAYU"];
export const isSheetSyncVendor = (vendorId: string | null | undefined) => !!vendorId && SHEET_SYNC_VENDORS.includes(vendorId);

export const SHEET_TAB_PRODUKSI = "Produksi";
export const SHEET_TAB_REJECT = "Reject";
export const SHEET_TAB_REWORK = "Rework";

/** Judul kolom template (baris 1 tiap tab). Pembacaan memakai judul ini (tanpa beda huruf besar/kecil, spasi, tanda baca), bukan posisi kolom. */
export const PRODUKSI_HEADERS = ["No MRP", "Code Roll", "Warna", "Lengan", "Size", "Target", "Waktu Cutting", "Hasil Cutting", "Finish Good"];
export const REJECT_HEADERS = ["No MRP", "Warna", "Lengan", "Reject Material", "Reject Produksi"];
export const REWORK_HEADERS = ["No MRP", "Warna", "Lengan Asal", "Size Asal", "Usia", "Lengan Tujuan", "Size Tujuan", "Qty Rework"];
/** Tab Penerimaan (pengganti halaman Good Receive): satu baris per roll invoice supplier; diisi Code Roll dan Tgl Terima. "Roll Ke" mulai dari 1. */
export const SHEET_TAB_PENERIMAAN = "Penerimaan";
export const PENERIMAAN_HEADERS = ["No MRP", "Invoice", "Supplier", "Warna", "Lengan", "Roll Ke", "Berat Kotor (kg)", "Code Roll", "Tgl Terima"];
/** Tab Resting: satu baris per roll yang sudah diterima; diisi Berat Bersih, Gramasi, Setting, Waktu Resting. "Kode Aduan" opsional (kalau satu warna·lengan ada di beberapa kode aduan). */
export const SHEET_TAB_RESTING = "Resting";
export const RESTING_HEADERS = ["No MRP", "Code Roll", "Warna", "Lengan", "Berat Kotor (kg)", "Berat Bersih (kg)", "Gramasi", "Setting", "Waktu Resting", "Kode Aduan"];

export type SheetIssue = { tab: string; row?: number; message: string };

/** Tautan publish-to-web Google Sheets -> alamat unduh XLSX seluruh dokumen. Hanya bentuk /spreadsheets/d/e/<id>/pub yang diterima. */
export function normalizeSheetUrl(raw: string): { ok: true; id: string; fetchUrl: string } | { ok: false; error: string } {
  const url = (raw ?? "").trim();
  const m = /^https:\/\/docs\.google\.com\/spreadsheets\/d\/e\/([A-Za-z0-9_-]{20,})\/pub/.exec(url);
  if (!m) {
    return {
      ok: false,
      error: 'Tautan bukan hasil "Publish to web". Di Google Sheets: File > Bagikan > Publikasikan ke web > Seluruh dokumen > Publikasikan, lalu salin tautan yang muncul (bentuknya docs.google.com/spreadsheets/d/e/…/pub…).',
    };
  }
  return { ok: true, id: m[1], fetchUrl: `https://docs.google.com/spreadsheets/d/e/${m[1]}/pub?output=xlsx` };
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------
// Pembacaan tab
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------

export type SheetProdRow = { row: number; mrpId: string; codeRoll: string; size: string; waktuCutting?: string; cut?: number; fg?: number };
export type SheetRejectRow = { row: number; mrpId: string; warna: string; lengan: "PENDEK" | "PANJANG"; material?: number; proses?: number };
export type SheetReworkRow = { row: number; mrpId: string; warna: string; fromLengan: "PENDEK" | "PANJANG"; fromSize: string; usia: "KIDS" | "DEWASA"; toLengan: "PENDEK" | "PANJANG"; toSize: string; qty: number };
/** Baris tab Penerimaan: `rollIndex` berbasis 0 (kolom "Roll Ke" - 1); `tglTerima` = yyyy-mm-dd. */
export type SheetReceiveRow = { row: number; mrpId: string; invoiceId: string; warna: string; lengan: "PENDEK" | "PANJANG"; rollIndex: number; codeRoll?: string; tglTerima?: string };
export type SheetRestRow = { row: number; mrpId: string; codeRoll: string; netKg?: number; gramasi?: number; setting?: string; waktuResting?: string; kodeAduan?: string };
export type ParsedSheet = {
  produksi: SheetProdRow[];
  reject: SheetRejectRow[];
  rework: SheetReworkRow[];
  penerimaan: SheetReceiveRow[];
  resting: SheetRestRow[];
  issues: SheetIssue[];
  tabsFound: string[];
};

type Cell = unknown;
const norm = (s: unknown) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
const text = (v: Cell) => (v === null || v === undefined ? "" : String(v).trim());

/** Bilangan bulat >= 0 dari sel; kosong = undefined (tidak diisi, TIDAK berarti 0). Mengembalikan string galat untuk isi yang tidak valid. */
function intCell(v: Cell): { value?: number; error?: string } {
  if (v === null || v === undefined || (typeof v === "string" && v.trim() === "")) return {};
  if (typeof v === "number") {
    if (!Number.isFinite(v) || v < 0 || !Number.isInteger(v)) return { error: `"${v}" harus bilangan bulat 0 atau lebih` };
    return { value: v };
  }
  const s = String(v).trim().replace(/\s/g, "");
  if (/^\d+$/.test(s)) return { value: Number(s) };
  if (/^\d{1,3}(\.\d{3})+$/.test(s)) return { value: Number(s.replace(/\./g, "")) };
  return { error: `"${String(v).trim()}" harus bilangan bulat 0 atau lebih` };
}

/** Zona waktu spreadsheet vendor: WIB (UTC+7; BAYU di Bandung). Sel waktu tanpa zona dianggap jam dinding WIB; teks ber-offset ("...+08:00" / "Z") dipakai apa adanya. */
export const SHEET_TZ_OFFSET_MIN = 7 * 60;
const wallToIso = (y: number, mo: number, d: number, h: number, mi: number, sec = 0) => new Date(Date.UTC(y, mo - 1, d, h, mi, sec) - SHEET_TZ_OFFSET_MIN * 60000).toISOString();
const NEED_TIME = "wajib tanggal DAN jam (mis. 2026-11-10 14:30)";

/** Waktu dari sel (tanggal + jam wajib): Date / serial Excel (jam dinding = komponen UTC, begitu ExcelJS membacanya), "yyyy-mm-dd hh:mm", atau "dd/mm/yyyy hh:mm" (opsional detik, offset). Kosong = undefined;
 *  hanya tanggal = galat (jam wajib supaya durasi resting dan status tepat waktu akurat). Hasil: ISO instan UTC. */
function dateTimeCell(v: Cell): { value?: string; error?: string } {
  if (v === null || v === undefined || (typeof v === "string" && v.trim() === "")) return {};
  const fromWall = (d: Date) => {
    if (Number.isNaN(d.getTime())) return { error: "waktu tidak valid" };
    if (d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0) return { error: NEED_TIME };
    return { value: wallToIso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds()) };
  };
  if (v instanceof Date) return fromWall(v);
  if (typeof v === "number") {
    if (v < 20000 || v > 80000) return { error: `"${v}" bukan waktu` };
    return fromWall(new Date(Math.round((v - 25569) * 86400000)));
  }
  const s = String(v).trim();
  const zone = (z: string | undefined) => (z ? (z.toUpperCase() === "Z" ? 0 : (z[0] === "-" ? -1 : 1) * (Number(z.slice(1, 3)) * 60 + Number(z.slice(-2)))) : null);
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?\s*(Z|[+-]\d{2}:?\d{2})?$/i.exec(s);
  let dt: { y: number; mo: number; d: number; h: number; mi: number; sec: number; z: string | undefined } | null = null;
  if (m) dt = { y: +m[1], mo: +m[2], d: +m[3], h: +m[4], mi: +m[5], sec: +(m[6] ?? 0), z: m[7] };
  else {
    m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})[ T](\d{1,2})[:.](\d{2})(?::(\d{2}))?\s*(Z|[+-]\d{2}:?\d{2})?$/i.exec(s);
    if (m) dt = { y: +m[3], mo: +m[2], d: +m[1], h: +m[4], mi: +m[5], sec: +(m[6] ?? 0), z: m[7] };
  }
  if (!dt) {
    if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(s) || /^\d{1,2}[/-]\d{1,2}[/-]\d{4}$/.test(s)) return { error: NEED_TIME };
    return { error: `"${s}" bukan waktu (pakai yyyy-mm-dd hh:mm atau dd/mm/yyyy hh:mm)` };
  }
  if (dt.mo < 1 || dt.mo > 12 || dt.d < 1 || dt.d > 31 || dt.h > 23 || dt.mi > 59 || dt.sec > 59) return { error: `"${s}" bukan waktu yang valid` };
  const off = zone(dt.z);
  if (off === null) return { value: wallToIso(dt.y, dt.mo, dt.d, dt.h, dt.mi, dt.sec) };
  return { value: new Date(Date.UTC(dt.y, dt.mo - 1, dt.d, dt.h, dt.mi, dt.sec) - off * 60000).toISOString() };
}

/** Bilangan desimal > 0 dari sel (berat, gramasi): "23.45" atau "23,45"; kosong = undefined. */
function decimalCell(v: Cell): { value?: number; error?: string } {
  if (v === null || v === undefined || (typeof v === "string" && v.trim() === "")) return {};
  if (typeof v === "number") return Number.isFinite(v) && v > 0 ? { value: v } : { error: `"${v}" harus lebih dari 0` };
  const s = String(v).trim().replace(/\s/g, "");
  if (/^\d+([.,]\d+)?$/.test(s)) {
    const n = Number(s.replace(",", "."));
    return n > 0 ? { value: n } : { error: `"${s}" harus lebih dari 0` };
  }
  return { error: `"${String(v).trim()}" bukan angka` };
}

/** Tanggal saja (yyyy-mm-dd) dari sel: Date / serial Excel (komponen UTC = jam dinding), "yyyy-mm-dd" atau "dd/mm/yyyy" (bagian jam diabaikan). Kosong = undefined. */
function dateCell(v: Cell): { value?: string; error?: string } {
  if (v === null || v === undefined || (typeof v === "string" && v.trim() === "")) return {};
  const ymd = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? { error: "tanggal tidak valid" } : { value: ymd(v) };
  if (typeof v === "number") return v < 20000 || v > 80000 ? { error: `"${v}" bukan tanggal` } : { value: ymd(new Date(Math.round((v - 25569) * 86400000))) };
  const s = String(v).trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (m) return { value: `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}` };
  m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/.exec(s);
  if (m) return { value: `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` };
  return { error: `"${s}" bukan tanggal (pakai yyyy-mm-dd atau dd/mm/yyyy)` };
}

function lenganCell(v: Cell): "PENDEK" | "PANJANG" | null {
  const s = text(v).toUpperCase();
  if (s === "PENDEK" || s === "PDK") return "PENDEK";
  if (s === "PANJANG" || s === "PJG") return "PANJANG";
  return null;
}
/** Kosong = DEWASA (bawaan); isi yang tidak dikenal = null (dilaporkan, tidak ditebak). */
function usiaCell(v: Cell): "KIDS" | "DEWASA" | null {
  const s = text(v).toUpperCase();
  if (s === "" || s === "DEWASA" || s === "ADULT") return "DEWASA";
  if (s === "KIDS" || s === "KID" || s === "ANAK") return "KIDS";
  return null;
}
const sizeCell = (v: Cell) => text(v).toUpperCase().replace(/\s+/g, "");

const ALIASES: Record<string, Record<string, string[]>> = {
  produksi: {
    mrpId: ["nomrp", "mrp", "nomormrp"],
    codeRoll: ["coderoll", "koderoll", "roll"],
    size: ["size", "ukuran"],
    waktuCutting: ["waktucutting", "tglcutting", "tanggalcutting"],
    cut: ["hasilcutting", "cutting", "qtycutting"],
    fg: ["finishgood", "fg", "qtyfg"],
  },
  reject: {
    mrpId: ["nomrp", "mrp", "nomormrp"],
    warna: ["warna"],
    lengan: ["lengan"],
    material: ["rejectmaterial", "material"],
    proses: ["rejectproduksi", "rejectproses", "produksi", "proses"],
  },
  rework: {
    mrpId: ["nomrp", "mrp", "nomormrp"],
    warna: ["warna"],
    fromLengan: ["lenganasal", "lengan"],
    fromSize: ["sizeasal"],
    usia: ["usia"],
    toLengan: ["lengantujuan"],
    toSize: ["sizetujuan"],
    qty: ["qtyrework", "qty", "rework"],
  },
  penerimaan: {
    mrpId: ["nomrp", "mrp", "nomormrp"],
    invoiceId: ["invoice", "noinvoice", "idinvoice"],
    warna: ["warna"],
    lengan: ["lengan"],
    rollKe: ["rollke", "roll", "nomorroll"],
    codeRoll: ["coderoll", "koderoll"],
    tglTerima: ["tglterima", "tanggalterima", "waktuterima"],
  },
  resting: {
    mrpId: ["nomrp", "mrp", "nomormrp"],
    codeRoll: ["coderoll", "koderoll"],
    netKg: ["beratbersihkg", "beratbersih", "netkg"],
    gramasi: ["gramasi"],
    setting: ["setting"],
    waktuResting: ["wakturesting", "tglresting", "tanggalresting"],
    kodeAduan: ["kodeaduan", "kode"],
  },
};

/** Peta nama kolom -> indeks dari baris judul; kolom wajib yang hilang dilaporkan. */
function headerIndex(tab: string, header: Cell[], key: keyof typeof ALIASES, required: string[], issues: SheetIssue[]): Record<string, number> | null {
  const heads = header.map(norm);
  const idx: Record<string, number> = {};
  for (const [field, names] of Object.entries(ALIASES[key])) {
    const i = heads.findIndex((h) => names.includes(h));
    if (i >= 0) idx[field] = i;
  }
  const missing = required.filter((f) => idx[f] === undefined);
  if (missing.length > 0) {
    issues.push({ tab, message: `Kolom wajib tidak ditemukan di baris judul: ${missing.join(", ")}. Pakai template dari ERP tanpa mengubah judul kolom.` });
    return null;
  }
  return idx;
}

/** `tabs`: nama tab (tanpa beda huruf besar/kecil) -> baris-baris sel (baris pertama = judul). Tab yang tidak ada dilewati (bukan galat): BAYU boleh hanya memakai sebagian. */
export function parseSheetTabs(tabs: Record<string, Cell[][]>): ParsedSheet {
  const out: ParsedSheet = { produksi: [], reject: [], rework: [], penerimaan: [], resting: [], issues: [], tabsFound: [] };
  const byName = new Map<string, Cell[][]>();
  for (const [name, rows] of Object.entries(tabs)) byName.set(norm(name), rows);
  const get = (name: string) => {
    const rows = byName.get(norm(name));
    if (rows) out.tabsFound.push(name);
    return rows;
  };
  const dataRows = (rows: Cell[][]) =>
    rows
      .slice(1)
      .map((cells, i) => ({ cells, row: i + 2 }))
      .filter((r) => r.cells.some((c) => text(c) !== ""));

  // ----- Produksi -----
  const prod = get(SHEET_TAB_PRODUKSI);
  if (prod && prod.length > 0) {
    const idx = headerIndex(SHEET_TAB_PRODUKSI, prod[0], "produksi", ["mrpId", "codeRoll", "size"], out.issues);
    if (idx) {
      for (const { cells, row } of dataRows(prod)) {
        const mrpId = text(cells[idx.mrpId]).toUpperCase();
        const codeRoll = text(cells[idx.codeRoll]).toUpperCase();
        const size = sizeCell(cells[idx.size]);
        if (!mrpId || !codeRoll || !size) {
          out.issues.push({ tab: SHEET_TAB_PRODUKSI, row, message: "No MRP, Code Roll, dan Size wajib diisi." });
          continue;
        }
        const cut = idx.cut !== undefined ? intCell(cells[idx.cut]) : {};
        const fg = idx.fg !== undefined ? intCell(cells[idx.fg]) : {};
        const tgl = idx.waktuCutting !== undefined ? dateTimeCell(cells[idx.waktuCutting]) : {};
        const err = [cut.error && `Hasil Cutting ${cut.error}`, fg.error && `Finish Good ${fg.error}`, tgl.error && `Waktu Cutting ${tgl.error}`].filter(Boolean).join("; ");
        if (err) {
          out.issues.push({ tab: SHEET_TAB_PRODUKSI, row, message: err });
          continue;
        }
        out.produksi.push({ row, mrpId, codeRoll, size, waktuCutting: tgl.value, cut: cut.value, fg: fg.value });
      }
    }
  }

  // ----- Reject -----
  const rej = get(SHEET_TAB_REJECT);
  if (rej && rej.length > 0) {
    const idx = headerIndex(SHEET_TAB_REJECT, rej[0], "reject", ["mrpId", "warna", "lengan"], out.issues);
    if (idx) {
      for (const { cells, row } of dataRows(rej)) {
        const mrpId = text(cells[idx.mrpId]).toUpperCase();
        const warna = text(cells[idx.warna]);
        const lengan = lenganCell(cells[idx.lengan]);
        const material = idx.material !== undefined ? intCell(cells[idx.material]) : {};
        const proses = idx.proses !== undefined ? intCell(cells[idx.proses]) : {};
        if (!mrpId || !warna || !lengan) {
          out.issues.push({ tab: SHEET_TAB_REJECT, row, message: "No MRP, Warna, dan Lengan (Pendek/Panjang) wajib diisi." });
          continue;
        }
        const err = [material.error && `Reject Material ${material.error}`, proses.error && `Reject Produksi ${proses.error}`].filter(Boolean).join("; ");
        if (err) {
          out.issues.push({ tab: SHEET_TAB_REJECT, row, message: err });
          continue;
        }
        out.reject.push({ row, mrpId, warna, lengan, material: material.value, proses: proses.value });
      }
    }
  }

  // ----- Rework -----
  const rw = get(SHEET_TAB_REWORK);
  if (rw && rw.length > 0) {
    const idx = headerIndex(SHEET_TAB_REWORK, rw[0], "rework", ["mrpId", "warna", "fromLengan", "fromSize", "toLengan", "toSize", "qty"], out.issues);
    if (idx) {
      for (const { cells, row } of dataRows(rw)) {
        const mrpId = text(cells[idx.mrpId]).toUpperCase();
        const warna = text(cells[idx.warna]);
        const fromLengan = lenganCell(cells[idx.fromLengan]);
        const toLengan = lenganCell(cells[idx.toLengan]);
        const fromSize = sizeCell(cells[idx.fromSize]);
        const toSize = sizeCell(cells[idx.toSize]);
        const usia = idx.usia !== undefined ? usiaCell(cells[idx.usia]) : "DEWASA";
        const qty = intCell(cells[idx.qty]);
        if (usia === null) {
          out.issues.push({ tab: SHEET_TAB_REWORK, row, message: `Usia "${text(cells[idx.usia])}" tidak dikenal (isi Kids atau Dewasa).` });
          continue;
        }
        if (!mrpId || !warna || !fromLengan || !toLengan || !fromSize || !toSize) {
          out.issues.push({ tab: SHEET_TAB_REWORK, row, message: "No MRP, Warna, Lengan Asal, Size Asal, Lengan Tujuan, dan Size Tujuan wajib diisi (lengan: Pendek/Panjang)." });
          continue;
        }
        if (qty.error) {
          out.issues.push({ tab: SHEET_TAB_REWORK, row, message: `Qty Rework ${qty.error}` });
          continue;
        }
        if (qty.value === undefined) continue; // qty kosong = baris belum diisi
        out.rework.push({ row, mrpId, warna, fromLengan, fromSize, usia, toLengan, toSize, qty: qty.value });
      }
    }
  }

  // ----- Penerimaan (Good Receive) -----
  const pen = get(SHEET_TAB_PENERIMAAN);
  if (pen && pen.length > 0) {
    const idx = headerIndex(SHEET_TAB_PENERIMAAN, pen[0], "penerimaan", ["mrpId", "invoiceId", "warna", "lengan", "rollKe"], out.issues);
    if (idx) {
      for (const { cells, row } of dataRows(pen)) {
        const mrpId = text(cells[idx.mrpId]).toUpperCase();
        const invoiceId = text(cells[idx.invoiceId]);
        const warna = text(cells[idx.warna]);
        const lengan = lenganCell(cells[idx.lengan]);
        const rollKe = intCell(cells[idx.rollKe]);
        const codeRoll = idx.codeRoll !== undefined ? text(cells[idx.codeRoll]) : "";
        const tgl = idx.tglTerima !== undefined ? dateCell(cells[idx.tglTerima]) : {};
        if (!mrpId || !invoiceId || !warna || !lengan || rollKe.value === undefined || rollKe.value < 1) {
          out.issues.push({ tab: SHEET_TAB_PENERIMAAN, row, message: 'No MRP, Invoice, Warna, Lengan (Pendek/Panjang), dan "Roll Ke" (mulai dari 1) wajib diisi.' });
          continue;
        }
        if (tgl.error) {
          out.issues.push({ tab: SHEET_TAB_PENERIMAAN, row, message: `Tgl Terima ${tgl.error}` });
          continue;
        }
        out.penerimaan.push({ row, mrpId, invoiceId, warna, lengan, rollIndex: rollKe.value - 1, codeRoll: codeRoll || undefined, tglTerima: tgl.value });
      }
    }
  }

  // ----- Resting -----
  const rest = get(SHEET_TAB_RESTING);
  if (rest && rest.length > 0) {
    const idx = headerIndex(SHEET_TAB_RESTING, rest[0], "resting", ["mrpId", "codeRoll"], out.issues);
    if (idx) {
      for (const { cells, row } of dataRows(rest)) {
        const mrpId = text(cells[idx.mrpId]).toUpperCase();
        const codeRoll = text(cells[idx.codeRoll]);
        if (!mrpId || !codeRoll) {
          out.issues.push({ tab: SHEET_TAB_RESTING, row, message: "No MRP dan Code Roll wajib diisi." });
          continue;
        }
        const net = idx.netKg !== undefined ? decimalCell(cells[idx.netKg]) : {};
        const gram = idx.gramasi !== undefined ? decimalCell(cells[idx.gramasi]) : {};
        const wkt = idx.waktuResting !== undefined ? dateTimeCell(cells[idx.waktuResting]) : {};
        const err = [net.error && `Berat Bersih ${net.error}`, gram.error && `Gramasi ${gram.error}`, wkt.error && `Waktu Resting ${wkt.error}`].filter(Boolean).join("; ");
        if (err) {
          out.issues.push({ tab: SHEET_TAB_RESTING, row, message: err });
          continue;
        }
        const setting = idx.setting !== undefined ? text(cells[idx.setting]) : "";
        const kode = idx.kodeAduan !== undefined ? text(cells[idx.kodeAduan]) : "";
        out.resting.push({ row, mrpId, codeRoll, netKg: net.value, gramasi: gram.value, setting: setting || undefined, waktuResting: wkt.value, kodeAduan: kode || undefined });
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------
// Rencana perubahan
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------

export type ErpBatchState = {
  id: string;
  mrpId: string;
  codeRoll: string;
  warna: string;
  lengan: string;
  /** Waktu resting yang tercatat (ISO), null kalau tidak diketahui. */
  restingAt: string | null;
  /** Waktu cutting yang sudah tercatat (ISO/tanggal), null = belum dicutting. */
  cuttingAt: string | null;
  closed: boolean;
  cut: Record<string, number>;
  fg: Record<string, number>;
  /** Roll punya alih size atau hasil tambahan sisa kain: hasil cutting-nya TIDAK diubah lewat sheet (menyimpan ulang akan menghapus penanda itu). */
  hasShiftsOrExtras: boolean;
};
export type ErpGroupMetaState = { groupKey: string; rejectMaterial: number | null; rejectProses: number | null };
/** Satu roll di invoice material MRP itu (tujuan vendor ini): dasar tab Penerimaan dan Resting. */
export type ErpInvoiceRoll = {
  invoiceId: string;
  invoiceStatus: string;
  warna: string;
  lengan: string;
  rollIndex: number;
  grossKg: number;
  netKg: number | null;
  /** Berat bersih sudah ditimbang dan dikonfirmasi (roll masuk pool Resting). */
  weighConfirmed: boolean;
  receivedAt: string | null;
  codeRoll: string | null;
};
/** Baris Aduan Pola vendor di MRP itu; `used` = jumlah roll yang sudah di-Resting ke baris ini. */
export type ErpAduanRow = { id: string; kode: string; warna: string; lengan: string; qtyRoll: number; used: number };
export type ErpState = {
  batches: ErpBatchState[];
  metas: ErpGroupMetaState[];
  /** Total rework yang SUDAH tercatat per kunci reworkKey(). */
  rework: Record<string, number>;
  invoiceRolls: ErpInvoiceRoll[];
  aduanRows: ErpAduanRow[];
};

/** Satu spreadsheet = satu MRP (owner 2026-11-16): baris untuk MRP lain dibuang dan dilaporkan; tab/baris lain tidak berubah. */
export function filterSheetToMrp(sheet: ParsedSheet, mrpId: string): ParsedSheet {
  const want = mrpId.toUpperCase();
  const issues = [...sheet.issues];
  const foreign = new Map<string, number>();
  const keep = <T extends { mrpId: string }>(rows: T[]) =>
    rows.filter((r) => {
      if (r.mrpId === want) return true;
      foreign.set(r.mrpId, (foreign.get(r.mrpId) ?? 0) + 1);
      return false;
    });
  const produksi = keep(sheet.produksi);
  const reject = keep(sheet.reject);
  const rework = keep(sheet.rework);
  const penerimaan = keep(sheet.penerimaan);
  const resting = keep(sheet.resting);
  if (foreign.size > 0) {
    issues.push({ tab: "-", message: `Spreadsheet ini untuk MRP ${want}, tetapi memuat baris MRP ${Array.from(foreign.keys()).join(", ")} (${Array.from(foreign.values()).reduce((a, b) => a + b, 0)} baris). Baris itu diabaikan; pakai satu spreadsheet per MRP.` });
  }
  return { ...sheet, produksi, reject, rework, penerimaan, resting, issues };
}

export const reworkKey = (r: { mrpId: string; warna: string; fromLengan: string; fromSize: string; usia: string; toLengan: string; toSize: string }) =>
  [r.mrpId, r.warna.toUpperCase(), r.fromLengan, r.fromSize, r.usia, r.toLengan, r.toSize].join("|");

/** Acuan batch yang BELUM ada saat rencana dibuat tetapi akan dibuat oleh operasi REST di putaran yang sama; pelaksana menggantinya dengan id batch asli. */
export const pendingBatchRef = (mrpId: string, codeRoll: string) => `pending:${mrpId}|${codeRoll.toUpperCase()}`;

/** Satu roll di operasi Resting. `codeRoll` = kode PERSIS seperti di ERP (pencocokan roll di database peka huruf besar/kecil). */
export type RestLine = { codeRoll: string; aduanRowId: string; gramasi: number; setting: string; netKg: number; invoiceId: string; warna: string; lengan: string; rollIndex: number; needsWeigh: boolean };

export type SheetOp =
  | { kind: "RECEIVE"; label: string; invoiceId: string; warna: string; lengan: string; date: string; rolls: { rollIndex: number; codeRoll: string }[] }
  | { kind: "REST"; label: string; mrpId: string; restingAt: string; lines: RestLine[] }
  | { kind: "CUTTING"; label: string; batchRef: string; cuttingAt: string; sizeQty: Record<string, number> }
  | { kind: "FG"; label: string; batchRef: string; sizeQty: Record<string, number> }
  | { kind: "REJECT_SPLIT"; label: string; groupKey: string; material: number; proses: number }
  | { kind: "REWORK"; label: string; input: { mrpId: string; warna: string; lengan: "PENDEK" | "PANJANG"; fromSize: string; qty: number; toLengan: "PENDEK" | "PANJANG"; toSize: string; usia: "KIDS" | "DEWASA" } };

export type SheetPlan = { ops: SheetOp[]; unchanged: number; issues: SheetIssue[] };

const positive = (m: Record<string, number>) => Object.fromEntries(Object.entries(m).filter(([, q]) => q > 0));
export function sameQtyMap(a: Record<string, number>, b: Record<string, number>): boolean {
  const pa = positive(a);
  const pb = positive(b);
  const ka = Object.keys(pa);
  return ka.length === Object.keys(pb).length && ka.every((k) => pa[k] === pb[k]);
}

/** Good Receive hanya untuk invoice yang sudah berstatus Delivery / Receiving (aturan layar portal; server aksi tidak memeriksanya, jadi sinkron yang menegakkannya). */
const RECEIVABLE_STATUS = ["DELIVERY", "RECEIVING"];

/** Bandingkan sheet dengan ERP dan hasilkan daftar perubahan (murni, tanpa database). Urutan operasi = urutan tahap: terima, resting, cutting, finish good, reject, rework. Roll yang
 *  baru akan diterima/di-resting pada putaran yang sama dihitung sebagai roll "virtual", jadi sheet yang sudah terisi sampai Finish Good mengalir dalam sekali baca. */
export function planSheetSync(sheet: ParsedSheet, erp: ErpState): SheetPlan {
  const issues: SheetIssue[] = [];
  let unchanged = 0;
  const receiveOps: SheetOp[] = [];
  const restOps: SheetOp[] = [];
  const cuttingOps: SheetOp[] = [];
  const fgOps: SheetOp[] = [];
  const rejectOps: SheetOp[] = [];
  const reworkOps: SheetOp[] = [];

  // ----- Penerimaan (Good Receive) -----
  const rollKey = (r: { invoiceId: string; warna: string; lengan: string; rollIndex: number }) => `${r.invoiceId}|${r.warna}|${r.lengan}|${r.rollIndex}`;
  const invRoll = new Map(erp.invoiceRolls.map((r) => [rollKey(r), r]));
  /** Roll yang SUDAH diterima di ERP atau akan diterima putaran ini, menurut code roll (huruf besar). */
  const receivedByCode = new Map<string, ErpInvoiceRoll>();
  for (const r of erp.invoiceRolls) if (r.receivedAt && r.codeRoll) receivedByCode.set(r.codeRoll.toUpperCase(), r);
  const recvGroups = new Map<string, { invoiceId: string; warna: string; lengan: string; date: string; rolls: { rollIndex: number; codeRoll: string }[] }>();
  for (const row of sheet.penerimaan) {
    const code = row.codeRoll?.toUpperCase();
    const label = `Terima ${row.invoiceId} ${row.warna} ${row.lengan === "PENDEK" ? "Pendek" : "Panjang"} roll ke-${row.rollIndex + 1}`;
    if (!code && !row.tglTerima) continue; // baris belum diisi
    const r = invRoll.get(rollKey(row));
    if (!r) {
      issues.push({ tab: SHEET_TAB_PENERIMAAN, row: row.row, message: `${label}: roll tidak ditemukan di invoice itu (periksa Invoice, Warna, Lengan, dan Roll Ke).` });
      continue;
    }
    // Code roll bawaan supplier yang hanya diulang template (tanpa Tgl Terima) bukan isian vendor: baris dianggap belum diisi.
    if (!r.receivedAt && !row.tglTerima && r.codeRoll && code === r.codeRoll.toUpperCase()) continue;
    if (r.receivedAt) {
      if (code && r.codeRoll && code !== r.codeRoll.toUpperCase()) {
        issues.push({ tab: SHEET_TAB_PENERIMAAN, row: row.row, message: `${label}: sudah diterima di ERP dengan code roll ${r.codeRoll}; code roll di sheet (${row.codeRoll}) tidak mengubahnya.` });
      } else {
        unchanged++;
      }
      continue;
    }
    const missing = [!code && "Code Roll", !row.tglTerima && "Tgl Terima"].filter(Boolean);
    if (missing.length > 0) {
      issues.push({ tab: SHEET_TAB_PENERIMAAN, row: row.row, message: `${label}: ${missing.join(" dan ")} wajib diisi. Baris ditahan.` });
      continue;
    }
    if (!RECEIVABLE_STATUS.includes(r.invoiceStatus)) {
      issues.push({ tab: SHEET_TAB_PENERIMAAN, row: row.row, message: `${label}: invoice ${row.invoiceId} belum berstatus Delivery (belum dibayar / belum diset Delivery oleh Procurement), jadi belum bisa diterima. Baris ditahan.` });
      continue;
    }
    // Code roll bawaan supplier yang sama (selain huruf besar/kecil) dipakai persis seperti di ERP.
    const exact = r.codeRoll && r.codeRoll.toUpperCase() === code ? r.codeRoll : row.codeRoll!;
    const gk = `${row.invoiceId}|${row.warna}|${row.lengan}|${row.tglTerima}`;
    const g = recvGroups.get(gk) ?? { invoiceId: row.invoiceId, warna: row.warna, lengan: row.lengan, date: row.tglTerima!, rolls: [] };
    g.rolls.push({ rollIndex: row.rollIndex, codeRoll: exact });
    recvGroups.set(gk, g);
    receivedByCode.set(code!, { ...r, receivedAt: row.tglTerima!, codeRoll: exact });
  }
  for (const g of recvGroups.values()) {
    receiveOps.push({ kind: "RECEIVE", label: `Terima ${g.invoiceId} ${g.warna} ${g.lengan === "PENDEK" ? "Pendek" : "Panjang"} (${g.rolls.length} roll)`, invoiceId: g.invoiceId, warna: g.warna, lengan: g.lengan, date: g.date, rolls: g.rolls });
  }

  // ----- Resting -----
  const batchByKey = new Map(erp.batches.map((b) => [`${b.mrpId}|${b.codeRoll.toUpperCase()}`, b]));
  const aduanUsed = new Map(erp.aduanRows.map((a) => [a.id, a.used]));
  const restGroups = new Map<string, { mrpId: string; lines: RestLine[]; labels: string[] }>();
  for (const row of sheet.resting) {
    const code = row.codeRoll.toUpperCase();
    const key = `${row.mrpId}|${code}`;
    if (batchByKey.has(key)) continue; // sudah di-Resting di ERP (tidak bisa diubah setelah Resting)
    if (row.netKg === undefined && row.gramasi === undefined && !row.setting && !row.waktuResting) continue; // baris belum diisi
    const label = `Resting roll ${row.codeRoll} (${row.mrpId})`;
    const roll = receivedByCode.get(code);
    if (!roll) {
      issues.push({ tab: SHEET_TAB_RESTING, row: row.row, message: `${label}: roll belum di-Good Receive di ERP (atau code roll tidak sama persis). Baris ditahan.` });
      continue;
    }
    const missing = [!(row.netKg! > 0) && "Berat Bersih", !(row.gramasi! > 0) && "Gramasi", !row.setting && "Setting", !row.waktuResting && "Waktu Resting (tanggal + jam)"].filter(Boolean);
    if (missing.length > 0) {
      issues.push({ tab: SHEET_TAB_RESTING, row: row.row, message: `${label}: ${missing.join(", ")} wajib diisi. Baris ditahan.` });
      continue;
    }
    // Baris Aduan Pola: warna·lengan yang sama, dipakai berurutan (baris yang masih punya jatah roll lebih dulu) -- sama dengan layar Resting di portal.
    const cands = erp.aduanRows.filter((a) => a.warna === roll.warna && a.lengan === roll.lengan && (!row.kodeAduan || a.kode.toUpperCase() === row.kodeAduan.toUpperCase()));
    const pick = cands.find((a) => (aduanUsed.get(a.id) ?? 0) < a.qtyRoll) ?? cands[0];
    if (!pick) {
      issues.push({ tab: SHEET_TAB_RESTING, row: row.row, message: `${label}: tidak ada baris Aduan Pola untuk ${roll.warna} ${roll.lengan}${row.kodeAduan ? ` dengan kode ${row.kodeAduan}` : ""} di MRP ini.` });
      continue;
    }
    aduanUsed.set(pick.id, (aduanUsed.get(pick.id) ?? 0) + 1);
    const line: RestLine = {
      codeRoll: roll.codeRoll!,
      aduanRowId: pick.id,
      gramasi: row.gramasi!,
      setting: row.setting!,
      netKg: row.netKg!,
      invoiceId: roll.invoiceId,
      warna: roll.warna,
      lengan: roll.lengan,
      rollIndex: roll.rollIndex,
      needsWeigh: !(roll.weighConfirmed && roll.netKg !== null && Math.abs(roll.netKg - row.netKg!) < 1e-9),
    };
    const g = restGroups.get(row.waktuResting!) ?? { mrpId: row.mrpId, lines: [], labels: [] };
    g.lines.push(line);
    g.labels.push(row.codeRoll);
    restGroups.set(row.waktuResting!, g);
    // Roll "virtual" untuk tahap Produksi di putaran yang sama.
    batchByKey.set(key, { id: pendingBatchRef(row.mrpId, code), mrpId: row.mrpId, codeRoll: code, warna: roll.warna, lengan: roll.lengan, restingAt: row.waktuResting!, cuttingAt: null, closed: false, cut: {}, fg: {}, hasShiftsOrExtras: false });
  }
  for (const [restingAt, g] of restGroups) {
    restOps.push({ kind: "REST", label: `Resting ${g.lines.length} roll (${g.labels.join(", ")})`, mrpId: g.mrpId, restingAt, lines: g.lines });
  }

  // ----- Produksi: per roll -----
  const rolls = new Map<string, SheetProdRow[]>();
  for (const r of sheet.produksi) {
    const k = `${r.mrpId}|${r.codeRoll}`;
    rolls.set(k, [...(rolls.get(k) ?? []), r]);
  }
  for (const [key, rows] of rolls) {
    const [mrpId, codeRoll] = key.split("|");
    const label = `Roll ${codeRoll} (${mrpId})`;
    if (!rows.some((r) => r.cut !== undefined || r.fg !== undefined)) continue; // baris belum diisi (daftar dari template)
    const batch = batchByKey.get(key);
    if (!batch) {
      // Gerbang per ROLL (bukan per invoice/MRP): pengiriman material parsial tidak jadi masalah, tiap roll baru diterima datanya setelah Good Receive + Resting.
      const received = receivedByCode.has(codeRoll);
      issues.push({
        tab: SHEET_TAB_PRODUKSI,
        row: rows[0].row,
        message: received
          ? `${label}: roll sudah di-Good Receive tetapi belum di-Resting. Isi tab Resting untuk roll ini (Berat Bersih, Gramasi, Setting, Waktu Resting).`
          : `${label}: roll belum di-Good Receive di ERP (atau code roll tidak sama persis). Data roll ini baru diterima setelah Good Receive.`,
      });
      continue;
    }
    const sizeSeen = new Set<string>();
    let dup = false;
    for (const r of rows) {
      if (sizeSeen.has(r.size)) dup = true;
      sizeSeen.add(r.size);
    }
    if (dup) {
      issues.push({ tab: SHEET_TAB_PRODUKSI, row: rows[0].row, message: `${label}: ada size yang muncul lebih dari satu baris. Satu baris per size.` });
      continue;
    }
    const hasCut = rows.some((r) => r.cut !== undefined);
    const hasFg = rows.some((r) => r.fg !== undefined);
    const sheetCut: Record<string, number> = {};
    const sheetFg: Record<string, number> = {};
    for (const r of rows) {
      if (r.cut !== undefined) sheetCut[r.size] = r.cut;
      if (r.fg !== undefined) sheetFg[r.size] = r.fg;
    }
    const waktuCutting = rows.find((r) => r.waktuCutting)?.waktuCutting;

    let effectiveCut = batch.cut;
    let cuttingReady = !!batch.cuttingAt;
    let cuttingHeld = false;
    if (hasCut) {
      if (sameQtyMap(sheetCut, batch.cut)) {
        unchanged++;
      } else if (Object.keys(positive(sheetCut)).length === 0) {
        // semua 0 / kosong: tidak menghapus hasil cutting yang sudah ada di ERP lewat sheet
        if (Object.keys(positive(batch.cut)).length > 0) issues.push({ tab: SHEET_TAB_PRODUKSI, row: rows[0].row, message: `${label}: Hasil Cutting di sheet kosong/0 tetapi ERP sudah punya hasil cutting. Tidak ditimpa; ubah lewat portal kalau memang salah.` });
      } else if (batch.hasShiftsOrExtras) {
        issues.push({ tab: SHEET_TAB_PRODUKSI, row: rows[0].row, message: `${label}: roll ini punya alih size / hasil tambahan sisa kain di ERP, jadi hasil cutting-nya tidak diubah lewat sheet. Ubah lewat portal vendor.` });
      } else {
        // Waktu cutting wajib (tanggal + jam) untuk hasil cutting BARU: durasi resting dan status tepat waktu dihitung dari situ, jadi tidak diganti waktu saat sinkron.
        // Roll yang sudah punya waktu cutting di ERP mempertahankan waktu itu (yang dikoreksi hanya qty).
        const cuttingAt = batch.cuttingAt ?? waktuCutting;
        if (!cuttingAt) {
          cuttingHeld = true;
          issues.push({ tab: SHEET_TAB_PRODUKSI, row: rows[0].row, message: `${label}: Waktu Cutting wajib diisi (tanggal + jam) untuk hasil cutting baru. Baris ditahan sampai waktunya ada.` });
        } else if (!batch.cuttingAt && batch.restingAt && Date.parse(cuttingAt) < Date.parse(batch.restingAt)) {
          cuttingHeld = true;
          issues.push({ tab: SHEET_TAB_PRODUKSI, row: rows[0].row, message: `${label}: Waktu Cutting lebih awal dari Waktu Resting roll ini. Periksa waktunya. Baris ditahan.` });
        } else {
          cuttingOps.push({ kind: "CUTTING", label, batchRef: batch.id, cuttingAt, sizeQty: positive(sheetCut) });
          effectiveCut = positive(sheetCut);
          cuttingReady = true;
        }
      }
    }
    if (hasFg) {
      if (sameQtyMap(sheetFg, batch.fg)) {
        unchanged++;
      } else if (batch.closed) {
        issues.push({ tab: SHEET_TAB_PRODUKSI, row: rows[0].row, message: `${label}: roll sudah ditutup di ERP, Finish Good tidak bisa diubah lewat sheet.` });
      } else if (!cuttingReady) {
        if (!cuttingHeld) issues.push({ tab: SHEET_TAB_PRODUKSI, row: rows[0].row, message: `${label}: Finish Good diisi tetapi hasil cutting roll ini belum ada. Isi Hasil Cutting dulu.` });
      } else {
        const over = Object.entries(sheetFg).filter(([size, q]) => q > (effectiveCut[size] ?? 0));
        if (over.length > 0) {
          issues.push({ tab: SHEET_TAB_PRODUKSI, row: rows[0].row, message: `${label}: Finish Good melebihi hasil cutting pada size ${over.map(([s, q]) => `${s} (${q} > ${effectiveCut[s] ?? 0})`).join(", ")}.` });
        } else {
          fgOps.push({ kind: "FG", label, batchRef: batch.id, sizeQty: positive(sheetFg) });
        }
      }
    }
  }

  // ----- Reject: klasifikasi per warna·lengan -----
  const metaByKey = new Map(erp.metas.map((m) => [m.groupKey, m]));
  for (const r of sheet.reject) {
    if (r.material === undefined && r.proses === undefined) continue;
    const label = `Reject ${r.warna} ${r.lengan} (${r.mrpId})`;
    if (r.material === undefined || r.proses === undefined) {
      issues.push({ tab: SHEET_TAB_REJECT, row: r.row, message: `${label}: isi Reject Material DAN Reject Produksi (jumlahnya harus sama dengan total reject).` });
      continue;
    }
    const groupKey = `${r.mrpId}|${r.warna}|${r.lengan}`;
    const meta = metaByKey.get(groupKey);
    if (meta && meta.rejectMaterial === r.material && meta.rejectProses === r.proses) {
      unchanged++;
      continue;
    }
    rejectOps.push({ kind: "REJECT_SPLIT", label, groupKey, material: r.material, proses: r.proses });
  }

  // ----- Rework: selisih terhadap yang sudah tercatat (hanya bertambah) -----
  const reworkWanted = new Map<string, { row: SheetReworkRow; qty: number }>();
  for (const r of sheet.rework) {
    const k = reworkKey(r);
    const cur = reworkWanted.get(k);
    reworkWanted.set(k, { row: r, qty: (cur?.qty ?? 0) + r.qty });
  }
  for (const [k, { row: r, qty }] of reworkWanted) {
    const have = erp.rework[k] ?? 0;
    const label = `Rework ${r.warna} ${r.fromLengan} ${r.fromSize} → ${r.toLengan} ${r.toSize} (${r.mrpId})`;
    if (qty === have) {
      unchanged++;
    } else if (qty < have) {
      issues.push({ tab: SHEET_TAB_REWORK, row: r.row, message: `${label}: sheet ${qty} pcs lebih kecil dari ERP ${have} pcs. Pengurangan rework tidak dilakukan otomatis; batalkan lewat portal/Sysadmin.` });
    } else {
      reworkOps.push({ kind: "REWORK", label: `${label} +${qty - have} pcs`, input: { mrpId: r.mrpId, warna: r.warna, lengan: r.fromLengan, fromSize: r.fromSize, qty: qty - have, toLengan: r.toLengan, toSize: r.toSize, usia: r.usia } });
    }
  }
  return { ops: [...receiveOps, ...restOps, ...cuttingOps, ...fgOps, ...rejectOps, ...reworkOps], unchanged, issues };
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------
// Bentuk data yang dibaca layar vendor
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------

export type SheetSyncSummary = { applied: number; appliedLabels: string[]; unchanged: number; pending: number; issues: SheetIssue[]; tabsFound: string[]; note?: string };
/** Tautan spreadsheet satu MRP milik vendor + hasil sinkron terakhirnya. */
export type VendorMrpSheetLink = { mrpId: string; url: string; enabled: boolean; lastSyncAt: string | null; lastStatus: string | null; summary: SheetSyncSummary | null };
