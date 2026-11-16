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
export const PRODUKSI_HEADERS = ["No MRP", "Code Roll", "Warna", "Lengan", "Size", "Target", "Tgl Cutting", "Hasil Cutting", "Finish Good"];
export const REJECT_HEADERS = ["No MRP", "Warna", "Lengan", "Reject Material", "Reject Produksi"];
export const REWORK_HEADERS = ["No MRP", "Warna", "Lengan Asal", "Size Asal", "Usia", "Lengan Tujuan", "Size Tujuan", "Qty Rework"];

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

export type SheetProdRow = { row: number; mrpId: string; codeRoll: string; size: string; tglCutting?: string; cut?: number; fg?: number };
export type SheetRejectRow = { row: number; mrpId: string; warna: string; lengan: "PENDEK" | "PANJANG"; material?: number; proses?: number };
export type SheetReworkRow = { row: number; mrpId: string; warna: string; fromLengan: "PENDEK" | "PANJANG"; fromSize: string; usia: "KIDS" | "DEWASA"; toLengan: "PENDEK" | "PANJANG"; toSize: string; qty: number };
export type ParsedSheet = { produksi: SheetProdRow[]; reject: SheetRejectRow[]; rework: SheetReworkRow[]; issues: SheetIssue[]; tabsFound: string[] };

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

const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** Tanggal dari sel: Date, serial Excel, "yyyy-mm-dd", atau "dd/mm/yyyy" ("dd-mm-yyyy"). Kosong = undefined. */
function dateCell(v: Cell): { value?: string; error?: string } {
  if (v === null || v === undefined || (typeof v === "string" && v.trim() === "")) return {};
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? { error: "tanggal tidak valid" } : { value: ymd(new Date(v.getUTCFullYear(), v.getUTCMonth(), v.getUTCDate())) };
  if (typeof v === "number") {
    if (v < 20000 || v > 80000) return { error: `"${v}" bukan tanggal` };
    const d = new Date(Math.round((v - 25569) * 86400000));
    return { value: ymd(new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())) };
  }
  const s = String(v).trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (m) return { value: `${m[1]}-${pad(Number(m[2]))}-${pad(Number(m[3]))}` };
  m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/.exec(s);
  if (m) return { value: `${m[3]}-${pad(Number(m[2]))}-${pad(Number(m[1]))}` };
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
    tglCutting: ["tglcutting", "tanggalcutting"],
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
  const out: ParsedSheet = { produksi: [], reject: [], rework: [], issues: [], tabsFound: [] };
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
        const tgl = idx.tglCutting !== undefined ? dateCell(cells[idx.tglCutting]) : {};
        const err = [cut.error && `Hasil Cutting ${cut.error}`, fg.error && `Finish Good ${fg.error}`, tgl.error && `Tgl Cutting ${tgl.error}`].filter(Boolean).join("; ");
        if (err) {
          out.issues.push({ tab: SHEET_TAB_PRODUKSI, row, message: err });
          continue;
        }
        out.produksi.push({ row, mrpId, codeRoll, size, tglCutting: tgl.value, cut: cut.value, fg: fg.value });
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
  /** Waktu cutting yang sudah tercatat (ISO/tanggal), null = belum dicutting. */
  cuttingAt: string | null;
  closed: boolean;
  cut: Record<string, number>;
  fg: Record<string, number>;
  /** Roll punya alih size atau hasil tambahan sisa kain: hasil cutting-nya TIDAK diubah lewat sheet (menyimpan ulang akan menghapus penanda itu). */
  hasShiftsOrExtras: boolean;
};
export type ErpGroupMetaState = { groupKey: string; rejectMaterial: number | null; rejectProses: number | null };
export type ErpState = {
  batches: ErpBatchState[];
  metas: ErpGroupMetaState[];
  /** Total rework yang SUDAH tercatat per kunci reworkKey(). */
  rework: Record<string, number>;
};

export const reworkKey = (r: { mrpId: string; warna: string; fromLengan: string; fromSize: string; usia: string; toLengan: string; toSize: string }) =>
  [r.mrpId, r.warna.toUpperCase(), r.fromLengan, r.fromSize, r.usia, r.toLengan, r.toSize].join("|");

export type SheetOp =
  | { kind: "CUTTING"; label: string; batchId: string; cuttingAt: string; sizeQty: Record<string, number> }
  | { kind: "FG"; label: string; batchId: string; sizeQty: Record<string, number> }
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

/** Bandingkan sheet dengan ERP. `todayIso` = tanggal hari ini (yyyy-mm-dd) untuk roll yang belum punya tanggal cutting dan sheet-nya juga tidak mengisi. */
export function planSheetSync(sheet: ParsedSheet, erp: ErpState, todayIso: string): SheetPlan {
  const ops: SheetOp[] = [];
  const issues: SheetIssue[] = [];
  let unchanged = 0;

  // ----- Produksi: per roll -----
  const batchByKey = new Map(erp.batches.map((b) => [`${b.mrpId}|${b.codeRoll.toUpperCase()}`, b]));
  const rolls = new Map<string, SheetProdRow[]>();
  for (const r of sheet.produksi) {
    const k = `${r.mrpId}|${r.codeRoll}`;
    rolls.set(k, [...(rolls.get(k) ?? []), r]);
  }
  const cuttingOps: SheetOp[] = [];
  const fgOps: SheetOp[] = [];
  for (const [key, rows] of rolls) {
    const [mrpId, codeRoll] = key.split("|");
    const label = `Roll ${codeRoll} (${mrpId})`;
    const batch = batchByKey.get(key);
    if (!batch) {
      issues.push({ tab: SHEET_TAB_PRODUKSI, row: rows[0].row, message: `${label}: roll belum ada di ERP. Mulai Resting roll ini dulu di portal vendor (code roll harus sama persis).` });
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
    const date = rows.find((r) => r.tglCutting)?.tglCutting;

    let effectiveCut = batch.cut;
    let cuttingReady = !!batch.cuttingAt;
    if (hasCut) {
      if (sameQtyMap(sheetCut, batch.cut)) {
        unchanged++;
      } else if (Object.keys(positive(sheetCut)).length === 0) {
        // semua 0 / kosong: tidak menghapus hasil cutting yang sudah ada di ERP lewat sheet
        if (Object.keys(positive(batch.cut)).length > 0) issues.push({ tab: SHEET_TAB_PRODUKSI, row: rows[0].row, message: `${label}: Hasil Cutting di sheet kosong/0 tetapi ERP sudah punya hasil cutting. Tidak ditimpa; ubah lewat portal kalau memang salah.` });
      } else if (batch.hasShiftsOrExtras) {
        issues.push({ tab: SHEET_TAB_PRODUKSI, row: rows[0].row, message: `${label}: roll ini punya alih size / hasil tambahan sisa kain di ERP, jadi hasil cutting-nya tidak diubah lewat sheet. Ubah lewat portal vendor.` });
      } else {
        const cuttingAt = batch.cuttingAt ?? `${date ?? todayIso}T12:00:00.000Z`;
        cuttingOps.push({ kind: "CUTTING", label, batchId: batch.id, cuttingAt, sizeQty: positive(sheetCut) });
        effectiveCut = positive(sheetCut);
        cuttingReady = true;
      }
    }
    if (hasFg) {
      if (sameQtyMap(sheetFg, batch.fg)) {
        unchanged++;
      } else if (batch.closed) {
        issues.push({ tab: SHEET_TAB_PRODUKSI, row: rows[0].row, message: `${label}: roll sudah ditutup di ERP, Finish Good tidak bisa diubah lewat sheet.` });
      } else if (!cuttingReady) {
        issues.push({ tab: SHEET_TAB_PRODUKSI, row: rows[0].row, message: `${label}: Finish Good diisi tetapi hasil cutting roll ini belum ada. Isi Hasil Cutting dulu.` });
      } else {
        const over = Object.entries(sheetFg).filter(([size, q]) => q > (effectiveCut[size] ?? 0));
        if (over.length > 0) {
          issues.push({ tab: SHEET_TAB_PRODUKSI, row: rows[0].row, message: `${label}: Finish Good melebihi hasil cutting pada size ${over.map(([s, q]) => `${s} (${q} > ${effectiveCut[s] ?? 0})`).join(", ")}.` });
        } else {
          fgOps.push({ kind: "FG", label, batchId: batch.id, sizeQty: positive(sheetFg) });
        }
      }
    }
  }
  ops.push(...cuttingOps, ...fgOps);

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
    ops.push({ kind: "REJECT_SPLIT", label, groupKey, material: r.material, proses: r.proses });
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
      ops.push({ kind: "REWORK", label: `${label} +${qty - have} pcs`, input: { mrpId: r.mrpId, warna: r.warna, lengan: r.fromLengan, fromSize: r.fromSize, qty: qty - have, toLengan: r.toLengan, toSize: r.toSize, usia: r.usia } });
    }
  }
  return { ops, unchanged, issues };
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------
// Bentuk data yang dibaca layar vendor
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------

export type SheetSyncSummary = { applied: number; appliedLabels: string[]; unchanged: number; pending: number; issues: SheetIssue[]; tabsFound: string[]; note?: string };
export type VendorSheetStatus = { url: string; enabled: boolean; lastSyncAt: string | null; lastStatus: string | null; summary: SheetSyncSummary | null } | null;
