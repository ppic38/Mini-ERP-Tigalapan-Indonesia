// Parser teks invoice supplier KNITTO (hasil OCR atau text layer PDF) -> struktur data.
// Port dari converter mandiri "Konversi Invoice PDF -> Excel" (public/parser.js): logika inti
// (regex baris barang, koreksi salah-baca OCR lewat redundansi berat x harga = jumlah dan
// total = SUBTOTAL) SENGAJA dipertahankan apa adanya -- sudah teruji di invoice OH300726111.
// Murni (tanpa DOM/React) supaya bisa dites langsung di Node.

import type { InvoiceCheck, InvoiceLine, ParsedInvoice, ParsedInvoiceGroup } from "./types";

const OCR_DIGIT: Record<string, string> = { O: "0", o: "0", I: "1", l: "1", "|": "1" };
const fixDigits = (s: string) => String(s).replace(/[OoIl|]/g, (c) => OCR_DIGIT[c]);

export function parseMoney(s: string): number {
  const d = fixDigits(s).replace(/[^\d]/g, "");
  return d ? parseInt(d, 10) : NaN;
}

export function parseWeight(s: string): number {
  let t = fixDigits(s).replace(",", ".").replace(/[^\d.]/g, "");
  const parts = t.split(".");
  if (parts.length > 2) t = parts[0] + "." + parts.slice(1).join("");
  return t ? parseFloat(t) : NaN;
}

export const round2 = (n: number) => Math.round(n * 100) / 100;

const NUM = "[0-9OoIl|][0-9OoIl|.,]*";
const DETAIL = new RegExp(`^\\s*(${NUM})\\s*K\\s*[GC6]\\b[\\s.:]*(${NUM})\\s+(${NUM})\\s*$`, "i");
const HEADER = /^\s*(R[I1l]B\s+)?(.*?)\s*\b(\d{1,3})\s*[S5$]\s*[-–—~]\s*(.+?)\s*$/i;
const NOISE = /^[\s_\-–—=~.‗|]*$/;
const KEYWORDS = /(SUB\s*TOTAL|Total|Diskon|Bayar|Ekspedisi|Customer|Tanggal|Penjualan|Antrian|Pengambilan|Faktur|NB\s*:)/i;

const lastNumber = (line: string) => {
  const m = line.match(new RegExp(`(${NUM})\\s*$`));
  return m ? parseMoney(m[1]) : NaN;
};

/** No Penjualan = 2 huruf awalan + angka (mis. OH300726111). OCR sering menukar O<->0 dan I/l<->1: awalan dipaksa huruf, sisanya dipaksa angka. */
export function normalizeNoPenjualan(raw: string): string {
  const up = String(raw).toUpperCase();
  return up.slice(0, 2).replace(/0/g, "O").replace(/1/g, "I") + fixDigits(up.slice(2));
}

export const normColor = (s: string) => String(s).toUpperCase().replace(/\s+/g, " ").trim();

/**
 * "OH300726111.1234.pdf" -> {noPenjualan:'OH300726111', kodeTransfer:'1234'} (format NOINVOICE.KODETRANSAKSI.pdf).
 * Nama file lama dengan bagian tengah ("OH300726111.YOGI01.1234.pdf") tetap terbaca: bagian terakhir = kode,
 * bagian tengah diabaikan (tujuan tidak lagi dipakai -- vendor tujuan ditentukan oleh PO yang dibuka).
 * Nama file yang bukan format ini (bagian pertama bukan No Penjualan) dibiarkan kosong, bukan ditebak.
 */
export function parseFileName(name: string): { noPenjualan: string; kodeTransfer: string } {
  const base = String(name || "")
    .replace(/^.*[\\/]/, "")
    .replace(/\.pdf$/i, "")
    .replace(/(\s*-\s*copy)?(\s*\(\d+\))?\s*$/i, "") // akhiran salinan Windows/browser: " - Copy", " (1)"
    .trim();
  const parts = base.split(".");
  const no = parts[0] ?? "";
  const kode = parts.length > 1 ? parts[parts.length - 1] : "";
  const noPenjualan = no.trim().toUpperCase();
  if (!/^[A-Z]{2}\d{6,}$/.test(noPenjualan)) return { noPenjualan: "", kodeTransfer: "" };
  return { noPenjualan, kodeTransfer: kode.trim().toUpperCase() };
}

function parseDate(text: string) {
  const m = text.match(/Tanggal\s*[:;]?\s*(\d{2})\s*[-/.]\s*(\d{2})\s*[-/.]\s*(\d{4})/i);
  if (!m) return null;
  return { d: +m[1], m: +m[2], y: +m[3] };
}

export function parseKnittoInvoice(text: string, fileName = ""): ParsedInvoice {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+$/, ""))
    .filter((l) => l.trim());
  const inv: ParsedInvoice = {
    fileName,
    noPenjualan: "",
    tanggal: parseDate(text),
    customer: "",
    kodeTransfer: "",
    groups: [],
    totals: { subtotal: NaN, diskon: NaN, totalBayar: NaN, kgan: null, rollan: null },
    warnings: [],
    rawText: text,
  };

  const mNo = text.match(/No\s*Penjualan\s*[:;]?\s*([A-Z0-9]{8,})/i);
  if (mNo) inv.noPenjualan = normalizeNoPenjualan(mNo[1]);

  // Nama file NOINVOICE.KODETRANSAKSI.pdf -> kode transaksi
  const fn = parseFileName(fileName);
  inv.kodeTransfer = fn.kodeTransfer;
  if (!inv.noPenjualan) inv.noPenjualan = fn.noPenjualan;
  else if (fn.noPenjualan && fn.noPenjualan !== inv.noPenjualan) {
    inv.warnings.push(`No Penjualan di nama file (${fn.noPenjualan}) berbeda dengan yang terbaca di invoice (${inv.noPenjualan}) — cek.`);
  }

  let current: ParsedInvoiceGroup | null = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*Customer/i.test(line)) {
      let c = line.replace(/^\s*Customer\s*[:;]?\s*/i, "");
      const next = lines[i + 1] || "";
      if (next && !/[:;]/.test(next) && !NOISE.test(next)) c += " " + next.trim();
      inv.customer = c.trim();
    }
    if (/SUB\s*TOTAL/i.test(line)) {
      inv.totals.subtotal = lastNumber(line);
      continue;
    }
    if (/Total\s*Diskon/i.test(line)) {
      inv.totals.diskon = lastNumber(line);
      continue;
    }
    if (/Total\s*Bayar/i.test(line)) {
      inv.totals.totalBayar = lastNumber(line);
      continue;
    }
    if (/Total\s*KG\s*-?\s*an/i.test(line)) {
      const m = line.match(new RegExp(`(${NUM})\\s*KG\\s*\\(\\s*(\\d+)\\s*\\)`, "i"));
      if (m) inv.totals.kgan = { kg: parseWeight(m[1]), n: +m[2] };
      continue;
    }
    if (/Total\s*Roll\s*-?\s*an/i.test(line) && !inv.totals.rollan) {
      const m = line.match(new RegExp(`(${NUM})\\s*KG\\s*\\(\\s*(\\d+)\\s*\\)`, "i"));
      if (m) inv.totals.rollan = { kg: parseWeight(m[1]), n: +m[2] };
      continue;
    }

    const det = line.match(DETAIL);
    if (det && current) {
      current.lines.push({ w: parseWeight(det[1]), price: parseMoney(det[2]), amount: parseMoney(det[3]) });
      continue;
    }
    const hd = line.match(HEADER);
    if (hd && !/^\s*(Total|SUB)/i.test(line)) {
      current = { kind: hd[1] ? "rib" : "roll", warna: normColor(hd[4]), benang: `${hd[3]}S`, lines: [] };
      inv.groups.push(current);
      continue;
    }
    // nama warna panjang yang terpotong ke baris berikut
    if (current && current.lines.length === 0 && line.trim() && !NOISE.test(line) && !KEYWORDS.test(line)) {
      current.warna = normColor(current.warna + " " + line);
    }
  }

  inv.groups = inv.groups.filter((g) => g.lines.length);
  if (!inv.groups.length) inv.warnings.push("Tidak ada baris barang yang terbaca dari PDF.");
  if (!inv.noPenjualan) inv.warnings.push("No Penjualan tidak terbaca — isi manual.");
  if (!inv.tanggal) inv.warnings.push("Tanggal tidak terbaca — isi manual.");

  // No Penjualan memuat tanggal (OH + ddmmyy + urut). Pakai untuk melengkapi/menegur tanggal.
  const mId = inv.noPenjualan.match(/^OH(\d{2})(\d{2})(\d{2})\d+$/);
  if (mId) {
    const idDate = { d: +mId[1], m: +mId[2], y: 2000 + +mId[3] };
    if (!inv.tanggal) inv.tanggal = idDate;
    else if (inv.tanggal.d !== idDate.d || inv.tanggal.m !== idDate.m || inv.tanggal.y !== idDate.y) {
      inv.warnings.push("Tanggal di invoice tidak sama dengan tanggal yang tertanam di No Penjualan — cek.");
    }
  }

  reconcileInvoice(inv);
  return inv;
}

const allLines = (inv: ParsedInvoice): InvoiceLine[] => inv.groups.flatMap((g) => g.lines);
const sumAmount = (inv: ParsedInvoice) => allLines(inv).reduce((a, l) => a + (Number.isFinite(l.amount) ? l.amount : 0), 0);
const expected = (l: InvoiceLine) => Math.round(l.w * l.price);
export const lineOk = (l: InvoiceLine) =>
  Number.isFinite(l.w) && Number.isFinite(l.price) && Number.isFinite(l.amount) && Math.abs(expected(l) - l.amount) <= 1;

/**
 * Koreksi otomatis salah baca OCR memakai redundansi: berat x harga = jumlah, dan total jumlah = SUBTOTAL.
 * Hanya diterapkan bila tepat satu kombinasi perbaikan yang membuat SUBTOTAL cocok.
 */
export function reconcileInvoice(inv: ParsedInvoice): void {
  const bad = allLines(inv).filter((l) => !lineOk(l));
  if (!bad.length || !Number.isFinite(inv.totals.subtotal) || bad.length > 4) return;
  type Opt = { w: number; amount: number; how: string };
  const options: Opt[][] = bad.map((l) => {
    const opts: Opt[] = [];
    if (Number.isFinite(l.price) && l.price > 0 && Number.isFinite(l.amount)) {
      const w = l.amount / l.price;
      if (Math.abs(w * 100 - Math.round(w * 100)) < 1e-6) opts.push({ w: round2(w), amount: l.amount, how: "berat dikoreksi dari jumlah" });
    }
    if (Number.isFinite(l.w) && Number.isFinite(l.price)) opts.push({ w: l.w, amount: expected(l), how: "jumlah dihitung ulang dari berat × harga" });
    return opts;
  });
  if (options.some((o) => !o.length)) return;
  const base = sumAmount(inv) - bad.reduce((a, l) => a + (Number.isFinite(l.amount) ? l.amount : 0), 0);
  const winners: Opt[][] = [];
  const walk = (k: number, picks: Opt[], total: number) => {
    if (k === bad.length) {
      if (total === inv.totals.subtotal) winners.push(picks);
      return;
    }
    for (const o of options[k]) walk(k + 1, [...picks, o], total + o.amount);
  };
  walk(0, [], base);
  if (winners.length !== 1) return;
  winners[0].forEach((o, k) => {
    Object.assign(bad[k], { w: o.w, amount: o.amount, fixed: o.how });
  });
}

export const fmtNum = (n: number) => (Number.isFinite(n) ? Math.round(n * 100) / 100 : n).toLocaleString("id-ID");

/**
 * Daftar pemeriksaan silang. `blocking` = ketidakcocokan yang berarti data hasil baca TIDAK boleh
 * dipakai begitu saja (angka salah baca / baris hilang) -- harus diperbaiki di tabel hasil baca.
 */
export function validateInvoice(inv: ParsedInvoice): InvoiceCheck[] {
  const checks: InvoiceCheck[] = [];
  const add = (id: string, label: string, ok: boolean, detail: string, blocking = true) => checks.push({ id, label, ok, detail, blocking });
  const lines = allLines(inv);
  const badLines = lines.filter((l) => !lineOk(l));
  add("lines", "Berat × harga = jumlah di setiap baris", badLines.length === 0, badLines.length ? `${badLines.length} baris tidak cocok (ditandai merah)` : `${lines.length} baris cocok`);

  const fixed = lines.filter((l) => l.fixed);
  if (fixed.length) add("fixed", "Koreksi otomatis OCR", true, `${fixed.length} baris dikoreksi (ditandai kuning)`, false);

  const t = inv.totals;
  const sum = sumAmount(inv);
  if (Number.isFinite(t.subtotal)) add("subtotal", "Total jumlah = SUBTOTAL invoice", sum === t.subtotal, `${fmtNum(sum)} vs ${fmtNum(t.subtotal)}`);
  else add("subtotal", "SUBTOTAL terbaca", false, "SUBTOTAL tidak terbaca");

  if (Number.isFinite(t.subtotal) && Number.isFinite(t.totalBayar)) {
    const dsk = Number.isFinite(t.diskon) ? t.diskon : 0;
    add("bayar", "SUBTOTAL − Diskon = Total Bayar", t.subtotal - dsk === t.totalBayar, `${fmtNum(t.subtotal - dsk)} vs ${fmtNum(t.totalBayar)}`);
  } else {
    add("bayar", "Total Bayar terbaca", false, "Total Bayar / SUBTOTAL tidak terbaca");
  }

  const rolls = inv.groups.filter((g) => g.kind === "roll").flatMap((g) => g.lines);
  const ribs = inv.groups.filter((g) => g.kind === "rib").flatMap((g) => g.lines);
  const kgSum = (a: InvoiceLine[]) => round2(a.reduce((x, l) => x + (Number.isFinite(l.w) ? l.w : 0), 0));
  if (t.rollan)
    add("roll", "Jumlah & berat roll = Total Roll-an", rolls.length === t.rollan.n && Math.abs(kgSum(rolls) - t.rollan.kg) < 0.011, `${rolls.length} roll / ${kgSum(rolls)} kg vs ${t.rollan.n} / ${t.rollan.kg} kg`);
  else if (rolls.length) add("roll", "Total Roll-an terbaca", false, "Baris \"Total Roll-an\" tidak terbaca — jumlah roll tidak bisa diverifikasi");
  if (t.kgan)
    add("rib", "Jumlah & berat rib = Total KG-an", ribs.length === t.kgan.n && Math.abs(kgSum(ribs) - t.kgan.kg) < 0.011, `${ribs.length} baris / ${kgSum(ribs)} kg vs ${t.kgan.n} / ${t.kgan.kg} kg`);
  else if (ribs.length) add("rib", "Total KG-an terbaca", false, "Baris \"Total KG-an\" tidak terbaca — jumlah rib tidak bisa diverifikasi");

  for (const w of inv.warnings) add("warn", w, false, "", /nama file|tidak ada baris|No Penjualan tidak/i.test(w));
  return checks;
}
