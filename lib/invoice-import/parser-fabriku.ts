// Parser teks invoice supplier FABRIKU (PT Kenari Mulia Lestari) -> struktur data yang sama dengan KNITTO.
// Teks berasal dari text layer PDF (pdf-text.ts menggabungkan kolom dengan 3 spasi): tiap baris barang
//   NO   PRODUK   WARNA   KODEROL   QTY   HARGA   TOTAL
// Produk "S COT 24 CM ..." = kain roll, "R COT 24 ..." = rib; produk lain TIDAK dikenal dan menggagalkan invoice (owner 2026-10-29).
// Beda dari KNITTO: ada kode roll per roll (KODEROL), tidak ada baris SUBTOTAL / Total Roll-an / Total KG-an; diskon tercetak
// sebagai baris barang bernilai minus; pembanding berat = "Total Qty". Nomor invoice & kode transaksi dari NAMA FILE.
// Murni (tanpa DOM/React) supaya bisa dites langsung di Node.

import { checkInvoiceFileName, type FileNameRule } from "./filename";
import { fmtNum, lineOk, normColor, round2 } from "./parser-knitto";
import type { InvoiceCheck, InvoiceLine, ParsedInvoice, ParsedInvoiceGroup } from "./types";

/** Nomor invoice FABRIKU di nama file: huruf/angka (boleh strip), minimal ada satu angka, mis. A027. */
export const FABRIKU_FILENAME_RULE: FileNameRule = { noPattern: /^(?=.*\d)[A-Z0-9-]{2,20}$/, example: "A027.1234.pdf" };

const MONTHS: Record<string, number> = { JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, MEI: 5, JUN: 6, JUL: 7, AUG: 8, AGU: 8, AGS: 8, SEP: 9, OCT: 10, OKT: 10, NOV: 11, DEC: 12, DES: 12 };

const money = (s: string): number => {
  const d = String(s).replace(/[^\d]/g, "");
  return d ? parseInt(d, 10) : NaN;
};
const weight = (s: string): number => {
  const t = String(s).replace(/,/g, "").replace(/[^\d.]/g, "");
  return t ? parseFloat(t) : NaN;
};

function parseDate(text: string): { d: number; m: number; y: number } | null {
  const named = text.match(/TANGGAL\s*NOTA\s*[:;]?\s*(\d{1,2})\s*[-/ ]\s*([A-Za-z]{3,})\s*[-/ ]\s*(\d{4})/i);
  if (named) {
    const m = MONTHS[named[2].slice(0, 3).toUpperCase()];
    if (m) return { d: +named[1], m, y: +named[3] };
  }
  const num = text.match(/TANGGAL\s*NOTA\s*[:;]?\s*(\d{1,2})\s*[-/.]\s*(\d{1,2})\s*[-/.]\s*(\d{4})/i);
  return num ? { d: +num[1], m: +num[2], y: +num[3] } : null;
}

export function parseFabrikuInvoice(text: string, fileName = ""): ParsedInvoice {
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
    totals: { subtotal: NaN, diskon: 0, totalBayar: NaN, kgan: null, rollan: null, totalKg: null },
    warnings: [],
    rawText: text,
  };

  const fn = checkInvoiceFileName(fileName, FABRIKU_FILENAME_RULE);
  if (fn.ok) {
    inv.noPenjualan = fn.noInvoice;
    inv.kodeTransfer = fn.kodeTransaksi;
  } else {
    inv.warnings.push(fn.message);
  }

  const groups = new Map<string, ParsedInvoiceGroup>();
  const unknown: string[] = [];
  const unread: string[] = [];
  let diskon = 0;
  let printedNo = "";

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const cols = line.trim().split(/\s{3,}/).map((c) => c.trim()).filter(Boolean);

    if (/PELANGGAN/i.test(line) && !inv.customer) {
      const same = line.replace(/^.*PELANGGAN\s*[:;]?\s*/i, "").trim();
      inv.customer = same || (lines[i + 1] ?? "").trim();
      continue;
    }
    // Nomor tercetak di kop (mis. "A027") -- hanya untuk dicocokkan dengan nama file, tidak dipakai sebagai sumber.
    if (!printedNo && i < 15 && /^[A-Z]{1,3}\d{2,6}$/.test(line.trim())) printedNo = line.trim();

    const qty = line.match(/Total\s*Qty\s*[:;]?\s*([\d.,]+)/i);
    if (qty) {
      inv.totals.totalKg = round2(weight(qty[1]));
      continue;
    }
    const total = line.match(/^\s*TOTAL\s*(?:Rp\.?)?\s*([\d.,]+)\s*$/i);
    if (total) {
      inv.totals.totalBayar = money(total[1]);
      continue;
    }

    // Baris barang / diskon: kolom pertama = nomor urut.
    if (cols.length >= 3 && /^\d+$/.test(cols[0])) {
      if (/^Diskon$/i.test(cols[1])) {
        const amt = money(cols[cols.length - 1]);
        if (Number.isFinite(amt)) diskon += amt;
        continue;
      }
      if (cols.length === 7) {
        const [no, produk, warna, kode, qtyS, hargaS, totalS] = cols;
        const pm = produk.match(/^\s*(S|R)\s+COT\s+(\d{1,3})\b/i);
        if (!pm) {
          unknown.push(`${no}: ${produk}`);
          continue;
        }
        const kind: "roll" | "rib" = pm[1].toUpperCase() === "R" ? "rib" : "roll";
        const benang = `${pm[2]}S`;
        const w = normColor(warna);
        const key = `${kind}|${w}|${benang}`;
        let g = groups.get(key);
        if (!g) {
          g = { kind, warna: w, benang, lines: [] };
          groups.set(key, g);
        }
        const l: InvoiceLine = { w: weight(qtyS), price: money(hargaS), amount: money(totalS) };
        // Kode roll hanya berarti untuk roll kain; rib dihitung per kg.
        if (kind === "roll") l.code = kode.trim().toUpperCase();
        g.lines.push(l);
        continue;
      }
      // Baris bernomor tapi kolomnya tidak terbaca utuh (PDF hasil scan / OCR): jangan ditebak.
      if (/\b(S|R)\s+COT\b/i.test(line)) unread.push(cols[0]);
      else unknown.push(`${cols[0]}: ${cols[1] ?? "?"}`);
    }
  }

  inv.groups = Array.from(groups.values());
  inv.totals.diskon = diskon;
  const sum = inv.groups.flatMap((g) => g.lines).reduce((a, l) => a + (Number.isFinite(l.amount) ? l.amount : 0), 0);
  inv.totals.subtotal = inv.groups.length ? sum : NaN;

  if (unknown.length) inv.warnings.push(`Produk tidak dikenal (hanya "S COT …" kain dan "R COT …" rib yang didukung): ${unknown.slice(0, 5).join("; ")}${unknown.length > 5 ? " …" : ""}`);
  if (unread.length) inv.warnings.push(`Baris tidak terbaca utuh (nomor ${unread.slice(0, 8).join(", ")}) — PDF kemungkinan hasil scan, upload ulang file aslinya`);
  if (!inv.groups.length) inv.warnings.push("Tidak ada baris barang yang terbaca dari PDF.");
  if (!inv.tanggal) inv.warnings.push("Tanggal tidak terbaca — isi manual.");
  if (printedNo && inv.noPenjualan && printedNo.toUpperCase() !== inv.noPenjualan) {
    inv.warnings.push(`Nomor invoice di file (${inv.noPenjualan}) berbeda dengan nomor tercetak di invoice (${printedNo}) — cek.`);
  }
  const codes = inv.groups.filter((g) => g.kind === "roll").flatMap((g) => g.lines.map((l) => l.code ?? ""));
  const dupCodes = codes.filter((c, i) => c && codes.indexOf(c) !== i);
  if (dupCodes.length) inv.warnings.push(`Kode roll ganda di invoice: ${Array.from(new Set(dupCodes)).slice(0, 5).join(", ")}`);
  return inv;
}

const BLOCKING_WARNING = /tidak sesuai format|tidak dikenal|tidak terbaca utuh|tidak ada baris|kode roll ganda/i;

export function validateFabrikuInvoice(inv: ParsedInvoice): InvoiceCheck[] {
  const checks: InvoiceCheck[] = [];
  const add = (id: string, label: string, ok: boolean, detail: string, blocking = true) => checks.push({ id, label, ok, detail, blocking });
  const lines = inv.groups.flatMap((g) => g.lines);
  const bad = lines.filter((l) => !lineOk(l));
  add("lines", "Berat × harga = jumlah di setiap baris", bad.length === 0, bad.length ? `${bad.length} baris tidak cocok (ditandai merah)` : `${lines.length} baris cocok`);

  const t = inv.totals;
  if (Number.isFinite(t.subtotal) && Number.isFinite(t.totalBayar)) {
    add("bayar", "Jumlah baris − Diskon = TOTAL invoice", t.subtotal - t.diskon === t.totalBayar, `${fmtNum(t.subtotal - t.diskon)} vs ${fmtNum(t.totalBayar)}`);
  } else {
    add("bayar", "TOTAL invoice terbaca", false, "TOTAL / baris barang tidak terbaca");
  }

  const kgSum = round2(lines.reduce((a, l) => a + (Number.isFinite(l.w) ? l.w : 0), 0));
  if (t.totalKg != null) add("kg", "Total berat = Total Qty invoice", Math.abs(kgSum - t.totalKg) < 0.011, `${fmtNum(kgSum)} vs ${fmtNum(t.totalKg)} kg`);
  else add("kg", "Total Qty terbaca", false, "Baris \"Total Qty\" tidak terbaca — berat tidak bisa diverifikasi", false);

  const rolls = inv.groups.filter((g) => g.kind === "roll").flatMap((g) => g.lines);
  const noCode = rolls.filter((l) => !l.code).length;
  add("codes", "Kode roll terbaca di setiap roll", noCode === 0, noCode ? `${noCode} roll tanpa kode` : `${rolls.length} kode roll`, false);

  for (const w of inv.warnings) add("warn", w, false, "", BLOCKING_WARNING.test(w));
  return checks;
}
