// Surat jalan supplier ("BUKTI KELUAR BARANG", KNITTO) -> code roll per roll invoice (owner 2026-11-19).
// KNITTO baru menerbitkan surat jalan SETELAH invoice dibayar, jadi code roll tidak ada saat Procurement membuat Paying Voucher. Procurement mengunggah surat jalan di
// Material Tracking; ERP membaca nomor order + daftar (code roll, bruto) lalu mencocokkannya ke roll invoice yang SAMA lewat berat bruto, sehingga vendor tidak perlu
// mengetik code roll satu per satu. Dua pengaman salah-unggah: (1) No Order surat jalan harus sama dengan nomor invoice supplier di ERP, (2) setiap roll surat jalan harus
// ketemu pasangan brutonya di invoice itu. Murni (tanpa DOM/React) supaya bisa dites langsung di Node.

import { normName, parseMrpWarna } from "./mapping";

/** Supplier yang code rollnya datang dari SURAT JALAN (bukan dari invoice atau ketikan vendor): KNITTO. Dipakai klien dan server. */
export const supplierUsesSuratJalan = (supplier: string | null | undefined) => /KNITTO/i.test(String(supplier ?? ""));

/** Alur code roll dari surat jalan berlaku mulai MRP W45 (owner 2026-11-19); MRP W44 ke bawah (dan MRP tanpa pola W<angka>) tetap memakai alur lama: vendor mengisi code roll di Good Receive. */
export const SURAT_JALAN_FROM_WEEK = 45;
export function suratJalanActiveForMrp(mrpId: string | null | undefined): boolean {
  const m = String(mrpId ?? "").toUpperCase().match(/(?:^|[^A-Z0-9])W(\d{1,3})(?![0-9])/);
  return !!m && parseInt(m[1], 10) >= SURAT_JALAN_FROM_WEEK;
}
/** Invoice ini memakai alur surat jalan: supplier KNITTO DAN MRP W45 ke atas. */
export const invoiceUsesSuratJalan = (supplier: string | null | undefined, mrpId: string | null | undefined) => supplierUsesSuratJalan(supplier) && suratJalanActiveForMrp(mrpId);

/** Bentuk invoice yang dibutuhkan `matchSuratJalan`, dari invoice di store. Code roll yang sudah tercatat (dari invoice supplier atau surat jalan sebelumnya) ikut menjadi dasar pencocokan,
 *  jadi pemindaian ulang tidak menimpa apa pun. */
export function invoiceForSuratJalan(invoice: {
  noInvoiceVendor: string;
  colorEntries: { warna: string; lengan: string; rolls: number[]; codeRolls?: string[] }[];
  rollArrivals?: Record<string, ({ codeRoll?: string } | null)[] | undefined>;
}): InvoiceForSj {
  return {
    noInvoiceVendor: invoice.noInvoiceVendor,
    colorEntries: invoice.colorEntries.map((c) => ({
      warna: c.warna,
      lengan: c.lengan,
      rolls: c.rolls,
      codeRolls: c.rolls.map((_, i) => (c.codeRolls?.[i] ?? invoice.rollArrivals?.[c.warna + "|" + c.lengan]?.[i]?.codeRoll ?? "").trim()),
    })),
  };
}

export type SjItem = { code: string; bruto: number };
export type SjGroup = {
  /** "roll" = kain roll; "rib" = bagian RIB (kode berawalan lain, berat kecil) -- TIDAK dicocokkan ke roll invoice. */
  kind: "roll" | "rib";
  /** Teks judul blok apa adanya, mis. "COMBED 24S BURGUNDY". */
  header: string;
  /** Nama warna menurut supplier ("BURGUNDY"), tanpa kategori dan benang. */
  warna: string;
  benang: string;
  items: SjItem[];
};
export type ParsedSuratJalan = {
  fileName: string;
  /** No Order surat jalan = nomor invoice supplier (sama dengan "No Penjualan" di invoice KNITTO, mis. OH161126049). */
  noOrder: string;
  /** Nomor internal surat jalan (KS...), hanya informasi. */
  noPenjualan: string;
  tanggal: string | null;
  groups: SjGroup[];
  /** "Total : (12) 279.46 kg" = semua baris termasuk rib. */
  total: { n: number; kg: number } | null;
  /** Masalah yang membuat berkas ini tidak boleh dipakai. */
  errors: string[];
  /** Mode `listOnly` saja: jumlah baris/kg terbaca tidak sama dengan baris Total tercetak. Bukan galat pemblokir (baris RIB sering salah baca padahal tidak dicocokkan); pemanggil meminta vendor
   *  memastikan ke surat jalan fisik. Mode biasa memasukkannya ke `errors`. */
  totalIssues: string[];
  /** Diparse dengan mode `listOnly` (judul warna per blok tidak dapat diandalkan; pencocokan boleh melintasi warna). */
  listOnly?: boolean;
  warnings: string[];
};

const round2 = (n: number) => Math.round(n * 100) / 100;
const num = (s: string) => Number(String(s).replace(",", "."));

/** Nomor invoice: huruf besar, tanpa spasi (perbandingan tidak peka huruf besar/kecil dan spasi). */
export const normInvoiceNo = (s: string | null | undefined) => String(s ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");

const ITEM_RE = /^\s*([A-Z]\d{8,12})\s+(\d{1,3}(?:[.,]\d{1,3})?)\s*$/;
const HEADER_RE = /^\s*(RIB\s+)?([A-Z]+(?:\s+[A-Z]+)*?)\s+(\d{2}S)\s+([A-Z][A-Z0-9 ]*?)\s*$/;
const TOTAL_RE = /Total\s*[:;]?\s*\(\s*(\d+)(?:\s*[.,]\s*0+)?\s*\)\s*([\d.,]+)\s*kg/i;
/** Baris Total versi OCR: "Total. (1300) 25501 ky" -> "Total : (13) 255.01 kg" (titik desimal hilang, "kg" salah baca). */
const OCR_TOTAL_RE = /^\W*T[o0]tal\W{0,3}\(\s*([0-9OQDIlSB]+)\s*(?:[.,]\s*([0-9OQDIlSB]+))?\s*\)\s*([0-9OQDIlSB.,]+)\s*\S{0,3}\s*$/i;

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------
// Foto kamera -> teks OCR yang dirapikan (owner 2026-11-23: vendor memotret surat jalan cetak saat KNITTO telat mengirim surat jalan ke Procurement)
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------

/** Salah baca OCR yang umum pada angka: O/Q/D -> 0, I/l/| -> 1, Z -> 2, S -> 5, B -> 8. Hanya dipakai di bagian yang SEHARUSNYA angka. */
const OCR_DIGIT: Record<string, string> = { O: "0", Q: "0", D: "0", o: "0", I: "1", l: "1", "|": "1", i: "1", Z: "2", S: "5", s: "5", B: "8" };
const fixDigits = (s: string) => s.replace(/[OQDoIl|iZSsB]/g, (c) => OCR_DIGIT[c] ?? c);
/** Pola baris roll versi OCR: huruf kode + 8-12 karakter mirip-angka, lalu sisa baris (bruto, centang tulisan tangan, dll). Boleh ada karakter sampah/kolom lain di kiri. */
const OCR_CODE_RE = /(?:^|[\s|.,:;'"[\]])([A-Z])\s?([0-9OQDIl|ZSB]{8,12})(?![0-9OQDIl|ZSB])\s+(.*)$/;
const D = "[0-9OQDIl|ZSB]";
/** Bruto dari sisa baris. Foto struk termal sering menghilangkan titik desimal atau menjadikannya spasi: "24.60", "24,60", "24 60", "2460" (-> 24.60), "155" (-> 1.55). Bruto kain selalu dua angka di belakang koma. */
function parseOcrBruto(rest: string): string | null {
  const r = rest.trim();
  let m = new RegExp(`^(${D}{1,3})\\s*[.,]\\s*(${D}{1,2})(?![0-9])`).exec(r);
  if (m) return fixDigits(m[1]) + "." + fixDigits(m[2]);
  m = new RegExp(`^(${D}{1,2})\\s+(${D}{2})(?![0-9])`).exec(r);
  if (m) return fixDigits(m[1]) + "." + fixDigits(m[2]);
  m = new RegExp(`^(${D}{3,4})(?![0-9])`).exec(r);
  if (m) {
    const t = fixDigits(m[1]);
    return t.slice(0, -2) + "." + t.slice(-2);
  }
  return null;
}

/** Rapikan teks OCR foto surat jalan sebelum diparse: baris roll dikembalikan ke bentuk baku "CODE BRUTO" (salah baca O/0, I/1, S/5, B/8 pada bagian angka dibetulkan, titik desimal yang hilang
 *  dipulihkan, kolom lain dan centang tulisan tangan dibuang). Baris lain dibiarkan. Ini HANYA mempermudah pembacaan; keutuhan tetap dijaga baris Total (jumlah baris dan kg) dan pencocokan bruto
 *  persis ke invoice, jadi salah baca yang tidak terbetulkan akan ditolak, bukan diam-diam tersimpan. */
export function normalizeOcrSuratJalan(text: string): string {
  return text
    .split(/\r?\n/)
    .map((raw) => {
      const line = raw.replace(/[\u2018\u2019`´]/g, "'").replace(/\s+$/, "");
      if (TOTAL_RE.test(line)) return line;
      const tm = OCR_TOTAL_RE.exec(line);
      if (tm) {
        // "(1300)" = "(13.00)" kalau titik hilang dan berakhir 00; berat tanpa pemisah ("25501") = 255.01.
        let n = fixDigits(tm[1]);
        if (!tm[2] && n.length >= 3 && n.endsWith("00")) n = n.slice(0, -2);
        let kg = fixDigits(tm[3]).replace(",", ".");
        if (!kg.includes(".") && kg.length >= 4) kg = kg.slice(0, -2) + "." + kg.slice(-2);
        return `Total : (${parseInt(n, 10)}) ${kg} kg`;
      }
      const m = OCR_CODE_RE.exec(line);
      if (!m) return line;
      const bruto = parseOcrBruto(m[3]);
      if (!bruto) return line;
      return `${m[1]}${fixDigits(m[2])} ${bruto}`;
    })
    .join("\n");
}

/** Nama file "OH161126049.pdf" -> "OH161126049" (cadangan kalau No Order tidak terbaca). */
function stemOfFile(name: string): string {
  const base = String(name || "").replace(/^.*[\\/]/, "").replace(/\.pdf$/i, "").replace(/(\s*-\s*copy)?(\s*\(\d+\))?\s*$/i, "").trim().toUpperCase();
  return /^[A-Z]{2}\d{6,}$/.test(base) ? base : "";
}

/** `listOnly` = hanya daftar roll yang dibaca (foto/PDF yang memotret bagian daftar saja, tanpa judul "BUKTI KELUAR BARANG" dan tanpa No Order): vendor sendiri yang memilih invoice-nya, jadi
 *  penjaganya adalah pencocokan bruto persis ke invoice itu. Judul/No Order yang kebetulan terbaca tetap dipakai. Baris tanpa judul warna digolongkan dari awalan code: "R" = roll kain, selain itu = RIB. */
export function parseSuratJalanKnitto(text: string, fileName = "", opts: { listOnly?: boolean } = {}): ParsedSuratJalan {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+$/, ""))
    .filter((l) => l.trim());
  const out: ParsedSuratJalan = { fileName, noOrder: "", noPenjualan: "", tanggal: null, groups: [], total: null, errors: [], totalIssues: [], warnings: [], listOnly: !!opts.listOnly };

  if (!opts.listOnly && !/BUKTI\s*KELUAR\s*BARANG/i.test(text)) out.errors.push('Berkas ini bukan "Bukti Keluar Barang" (surat jalan) KNITTO.');
  const mNo = text.match(/No\s*Order\s*[:;]?\s*([A-Z]{2}\d{6,})/i);
  if (mNo) out.noOrder = mNo[1].toUpperCase();
  const stem = stemOfFile(fileName);
  if (!out.noOrder) out.noOrder = stem;
  else if (stem && stem !== out.noOrder) out.warnings.push(`Nama file (${stem}) berbeda dengan No Order di surat jalan (${out.noOrder}); yang dipakai No Order di isi surat jalan.`);
  if (!out.noOrder && !opts.listOnly) out.errors.push("No Order tidak terbaca di surat jalan.");
  const mPj = text.match(/No\s*Penjualan\s*[:;]?\s*([A-Z]{2}\d{6,})/i);
  if (mPj) out.noPenjualan = mPj[1].toUpperCase();
  const mTgl = text.match(/Tanggal\s*[:;]?\s*(\d{2})\s*[-/.]\s*(\d{2})\s*[-/.]\s*(\d{4})/i);
  if (mTgl) out.tanggal = `${mTgl[3]}-${mTgl[2]}-${mTgl[1]}`;

  let current: SjGroup | null = null;
  for (const line of lines) {
    const t = TOTAL_RE.exec(line);
    if (t) {
      out.total = { n: Number(t[1]), kg: num(t[2]) };
      current = null;
      continue;
    }
    const it = ITEM_RE.exec(line);
    if (it && opts.listOnly) {
      const code = it[1].toUpperCase();
      const isRoll = code.startsWith("R");
      // Roll kain mengikuti judul warna terakhir kalau ada; selain itu (atau RIB) masuk grup tanpa judul menurut awalan code.
      let g: SjGroup | undefined = isRoll && current && current.kind === "roll" ? current : out.groups.find((x) => x.header === "(tanpa judul)" && x.kind === (isRoll ? "roll" : "rib"));
      if (!g) {
        g = { kind: isRoll ? "roll" : "rib", header: "(tanpa judul)", warna: "", benang: "", items: [] };
        out.groups.push(g);
      }
      g.items.push({ code, bruto: round2(num(it[2])) });
      continue;
    }
    if (it && current) {
      current.items.push({ code: it[1].toUpperCase(), bruto: round2(num(it[2])) });
      continue;
    }
    const h = HEADER_RE.exec(line);
    if (h && !ITEM_RE.test(line)) {
      current = { kind: h[1] ? "rib" : "roll", header: line.trim().replace(/\s+/g, " "), warna: h[4].trim(), benang: h[3].toUpperCase(), items: [] };
      out.groups.push(current);
    }
  }

  const rolls = out.groups.filter((g) => g.kind === "roll");
  if (rolls.every((g) => g.items.length === 0)) out.errors.push("Tidak ada baris roll (code roll + bruto) yang terbaca di surat jalan.");
  // Keutuhan: jumlah baris dan berat semua baris harus sama dengan "Total" yang tercetak.
  if (out.total) {
    const all = out.groups.flatMap((g) => g.items);
    const sum = round2(all.reduce((s, x) => s + x.bruto, 0));
    const issue = (msg: string) => (opts.listOnly ? out.totalIssues : out.errors).push(msg);
    if (all.length !== out.total.n) issue(`Jumlah baris terbaca (${all.length}) tidak sama dengan total di surat jalan (${out.total.n}); PDF mungkin tidak terbaca utuh.`);
    else if (Math.abs(sum - out.total.kg) > 0.03) issue(`Jumlah berat terbaca (${sum} kg) tidak sama dengan total di surat jalan (${out.total.kg} kg); PDF mungkin tidak terbaca utuh.`);
  } else {
    out.warnings.push("Baris Total tidak terbaca, jadi kelengkapan isi surat jalan tidak bisa diperiksa.");
  }
  const dup = new Set<string>();
  for (const x of out.groups.flatMap((g) => g.items)) {
    if (dup.has(x.code)) out.errors.push(`Code roll ${x.code} muncul dua kali di surat jalan.`);
    dup.add(x.code);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------
// Pencocokan ke invoice
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------

/** Selisih bruto yang masih dianggap sama: invoice dan surat jalan sama-sama dicetak 2 desimal, jadi harus PERSIS (hanya galat pembulatan floating). Toleransi lebih longgar bisa menukar
 *  dua roll yang beratnya berbeda 0,01 kg (mis. 24.94 dan 24.95). */
export const BRUTO_TOLERANCE = 0.004;

export type InvoiceForSj = {
  /** Nomor invoice supplier di ERP (`noInvoiceVendor`). */
  noInvoiceVendor: string;
  colorEntries: { warna: string; lengan: string; rolls: number[]; codeRolls?: string[] }[];
};
export type SjMatch = { warna: string; lengan: string; rollIndex: number; code: string; bruto: number; gross: number; sjWarna: string; alreadySet: boolean };
export type SjMatchResult = {
  ok: boolean;
  matches: SjMatch[];
  errors: string[];
  warnings: string[];
  /** Roll invoice yang belum punya code roll sesudah pencocokan ini (menunggu surat jalan berikutnya). */
  rollsStillWithoutCode: number;
  /** Bagian RIB di surat jalan yang tidak dicocokkan. */
  ribIgnored: { items: number; kg: number };
};

/** Cocokkan surat jalan ke satu invoice. `ok` hanya kalau No Order sama DAN setiap roll surat jalan menemukan pasangan bruto di invoice itu. */
export function matchSuratJalan(sj: ParsedSuratJalan, invoice: InvoiceForSj): SjMatchResult {
  const errors = [...sj.errors];
  const warnings = [...sj.warnings];
  const matches: SjMatch[] = [];
  const result = (extra: Partial<SjMatchResult> = {}): SjMatchResult => ({
    ok: errors.length === 0,
    matches,
    errors,
    warnings,
    rollsStillWithoutCode: 0,
    ribIgnored: { items: 0, kg: 0 },
    ...extra,
  });

  // Pengaman 1: surat jalan harus untuk invoice ini.
  if (sj.noOrder && normInvoiceNo(sj.noOrder) !== normInvoiceNo(invoice.noInvoiceVendor)) {
    errors.push(`Surat jalan ini untuk invoice ${sj.noOrder}, bukan invoice ${invoice.noInvoiceVendor || "(tanpa nomor)"}. Periksa kembali baris invoice yang dipilih.`);
  }
  const rib = sj.groups.filter((g) => g.kind === "rib");
  const ribIgnored = { items: rib.reduce((s, g) => s + g.items.length, 0), kg: round2(rib.reduce((s, g) => s + g.items.reduce((a, x) => a + x.bruto, 0), 0)) };
  if (errors.length > 0) return result({ ribIgnored });

  type Ref = { warna: string; lengan: string; rollIndex: number; gross: number; code: string; used: boolean; base: string };
  const refs: Ref[] = [];
  for (const c of invoice.colorEntries) {
    c.rolls.forEach((gross, i) => refs.push({ warna: c.warna, lengan: c.lengan, rollIndex: i, gross: round2(gross), code: (c.codeRolls?.[i] ?? "").trim(), used: false, base: normName(parseMrpWarna(c.warna).base) }));
  }
  const rollGroups = sj.groups.filter((g) => g.kind === "roll");

  // Mode `listOnly` (foto/PDF yang hanya memuat daftar): judul warna sering tidak terbaca sehingga roll terkelompok ke warna yang salah. Warna hanya PREFERENSI: putaran pertama mencocokkan di warna
  // yang sama saja (supaya bruto yang kembar di dua warna tidak tertukar), sisa yang tidak ketemu dicoba lagi di semua warna invoice pada putaran kedua.
  const loose = !!sj.listOnly;
  const pending: { it: SjItem; g: SjGroup }[] = [];

  const matchOne = (it: SjItem, g: SjGroup, pool: typeof refs, final: boolean) => {
    // Roll yang SUDAH punya code roll yang sama (unggah ulang surat jalan yang sama) dianggap cocok.
    let ref = pool.find((r) => !r.used && r.code && r.code.toUpperCase() === it.code);
    let already = !!ref;
    if (ref && Math.abs(ref.gross - it.bruto) > BRUTO_TOLERANCE) {
      errors.push(`Code roll ${it.code} sudah tercatat di invoice dengan bruto ${ref.gross} kg, tetapi surat jalan menulis ${it.bruto} kg.`);
      return;
    }
    if (!ref) {
      const cand = pool.filter((r) => !r.used && !r.code && Math.abs(r.gross - it.bruto) <= BRUTO_TOLERANCE).sort((a, b) => Math.abs(a.gross - it.bruto) - Math.abs(b.gross - it.bruto));
      ref = cand[0];
      already = false;
    }
    if (!ref) {
      if (!final) {
        pending.push({ it, g });
        return;
      }
      const hasWeightButCoded = pool.some((r) => !r.used && r.code && Math.abs(r.gross - it.bruto) <= BRUTO_TOLERANCE);
      errors.push(
        hasWeightButCoded
          ? `Roll ${it.code} (${it.bruto} kg): roll invoice dengan bruto itu sudah punya code roll lain. Surat jalan ini mungkin bukan untuk roll yang tersisa.`
          : `Roll ${it.code} (${it.bruto} kg${g.warna ? ", " + g.warna : ""}) tidak ada pasangannya di invoice ${invoice.noInvoiceVendor} (tidak ada roll dengan bruto itu yang masih kosong). Mungkin surat jalan salah invoice atau bruto salah baca.`
      );
      return;
    }
    ref.used = true;
    matches.push({ warna: ref.warna, lengan: ref.lengan, rollIndex: ref.rollIndex, code: it.code, bruto: it.bruto, gross: ref.gross, sjWarna: g.warna, alreadySet: already });
  };

  for (const g of rollGroups) {
    const gBase = normName(g.warna);
    const sameColor = refs.filter((r) => r.base === gBase);
    const pool = sameColor.length > 0 ? sameColor : refs;
    if (sameColor.length === 0 && g.warna && !loose) warnings.push(`Warna "${g.warna}" di surat jalan tidak persis sama dengan warna invoice; roll dicocokkan lewat berat bruto saja.`);
    for (const it of g.items) matchOne(it, g, pool, !loose || pool === refs);
  }
  for (const { it, g } of pending) matchOne(it, g, refs, true);
  const rollsStillWithoutCode = refs.filter((r) => !r.used && !r.code).length;
  if (errors.length === 0 && rollsStillWithoutCode > 0) warnings.push(`${rollsStillWithoutCode} roll invoice belum punya code roll setelah surat jalan ini (menunggu surat jalan berikutnya).`);
  return result({ rollsStillWithoutCode, ribIgnored });
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------
// Saran koreksi bruto salah baca (foto struk termal: 24.84 terbaca 24.64)
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------

export type BrutoFixSuggestion = { code: string; read: number; suggest: number; warna: string; lengan: string; rollIndex: number };

/** Untuk roll surat jalan yang brutonya TIDAK punya pasangan di invoice: kalau ada roll invoice yang belum terpasang dan brutonya hanya beda SATU digit dari yang terbaca (dan pasangan itu satu-satunya
 *  kandidat, tidak diperebutkan roll lain), sarankan brutonya. Hanya saran: vendor yang memutuskan lewat tombol. */
export function suggestBrutoFixes(sj: ParsedSuratJalan, invoice: InvoiceForSj): BrutoFixSuggestion[] {
  // Pencocokan dijalankan walau parser sudah melapor galat (mis. total kg tidak cocok karena salah baca) supaya roll yang bermasalah bisa ditunjuk.
  const res = matchSuratJalan({ ...sj, errors: [] }, invoice);
  const used = new Set(res.matches.map((m) => `${m.warna}|${m.lengan}|${m.rollIndex}`));
  const matchedCodes = new Set(res.matches.map((m) => m.code));
  const free: { warna: string; lengan: string; rollIndex: number; gross: number }[] = [];
  for (const c of invoice.colorEntries) {
    c.rolls.forEach((gross, i) => {
      if (used.has(`${c.warna}|${c.lengan}|${i}`)) return;
      if ((c.codeRolls?.[i] ?? "").trim()) return;
      free.push({ warna: c.warna, lengan: c.lengan, rollIndex: i, gross: round2(gross) });
    });
  }
  const oneDigitApart = (a: number, b: number) => {
    const x = a.toFixed(2);
    const y = b.toFixed(2);
    if (x.length !== y.length) return false;
    let d = 0;
    for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) d++;
    return d === 1;
  };
  // Kandidat dibatasi ke warna yang sama dengan judul grup baris itu (kalau judulnya terbaca dan warnanya ada di invoice): bruto yang mirip di warna lain bukan saran yang masuk akal.
  const unmatched = sj.groups.filter((g) => g.kind === "roll").flatMap((g) => g.items.filter((it) => !matchedCodes.has(it.code)).map((it) => ({ it, warna: g.warna })));
  const baseOf = (w: string) => normName(parseMrpWarna(w).base);
  const cands = unmatched.map(({ it, warna }) => {
    const sameColor = warna ? free.filter((f) => baseOf(f.warna) === normName(warna)) : [];
    const pool = sameColor.length > 0 ? sameColor : free;
    return { it, c: pool.filter((f) => oneDigitApart(f.gross, it.bruto)) };
  });
  const out: BrutoFixSuggestion[] = [];
  for (const { it, c } of cands) {
    if (c.length !== 1) continue;
    const f = c[0];
    // Kandidat yang sama diperebutkan roll lain = ambigu, tidak disarankan.
    if (cands.some((o) => o.it !== it && o.c.some((x) => x === f))) continue;
    out.push({ code: it.code, read: it.bruto, suggest: f.gross, warna: f.warna, lengan: f.lengan, rollIndex: f.rollIndex });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------
// Gabungan beberapa percobaan baca OCR (tiap percobaan gagal di baris yang berbeda)
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------

const MERGE_ROLL_RE = /^\s*([A-Z]\d{8,12})\s+(\d{1,3}\.\d{1,2})\s*$/;

/** Gabungkan hasil beberapa percobaan OCR (sudah lewat `normalizeOcrSuratJalan`, yang TERBAIK lebih dulu) menjadi satu teks. Dasarnya teks terbaik. Bruto sebuah code yang tidak punya pasangan di
 *  roll invoice yang masih kosong diganti bruto dari percobaan lain untuk code yang sama kalau yang itu cocok persis. Baris roll yang hanya ada di percobaan lain ikut ditambahkan HANYA kalau
 *  brutonya persis sama dengan roll invoice yang masih kosong (bruto invoice jadi kamus, jadi baris sampah tidak ikut). Hasilnya tetap diperiksa pengaman biasa (total, pencocokan) dan boleh dikoreksi vendor. */
export function mergeOcrTexts(texts: string[], invoice: InvoiceForSj): string {
  if (texts.length === 0) return "";
  const base = texts[0];
  if (texts.length === 1) return base;
  const free = new Map<string, number>();
  for (const c of invoice.colorEntries) {
    c.rolls.forEach((g, i) => {
      if ((c.codeRolls?.[i] ?? "").trim()) return;
      const k = round2(g).toFixed(2);
      free.set(k, (free.get(k) ?? 0) + 1);
    });
  }
  const norm2 = (b: string) => round2(Number(b)).toFixed(2);
  const cand = new Map<string, string[]>();
  for (const t of texts) {
    for (const line of t.split(/\r?\n/)) {
      const m = MERGE_ROLL_RE.exec(line);
      if (!m) continue;
      const arr = cand.get(m[1]) ?? [];
      if (!arr.includes(norm2(m[2]))) arr.push(norm2(m[2]));
      cand.set(m[1], arr);
    }
  }
  const take = (k: string) => {
    const n = free.get(k) ?? 0;
    if (n <= 0) return false;
    free.set(k, n - 1);
    return true;
  };
  const seen = new Set<string>();
  const outLines = base.split(/\r?\n/).map((line) => {
    const m = MERGE_ROLL_RE.exec(line);
    if (!m) return line;
    seen.add(m[1]);
    const own = norm2(m[2]);
    if (take(own)) return `${m[1]} ${own}`;
    const alt = (cand.get(m[1]) ?? []).find((b) => b !== own && take(b));
    return alt ? `${m[1]} ${alt}` : line;
  });
  const extra: string[] = [];
  for (const [code, brutos] of cand) {
    if (seen.has(code)) continue;
    const hit = brutos.find((b) => take(b));
    if (hit) extra.push(`${code} ${hit}`);
  }
  // Total: kalau teks terbaik tidak punya baris Total yang terbaca, ambil dari percobaan lain.
  let totalLine = "";
  if (!outLines.some((l) => TOTAL_RE.test(l))) {
    for (const t of texts.slice(1)) {
      const l = t.split(/\r?\n/).find((x) => TOTAL_RE.test(x));
      if (l) {
        totalLine = l;
        break;
      }
    }
  }
  return [...outLines, ...extra, ...(totalLine ? [totalLine] : [])].join("\n");
}
