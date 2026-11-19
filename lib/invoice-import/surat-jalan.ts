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
  const m = String(mrpId ?? "").toUpperCase().match(/(?:^|[^A-Z0-9])W(d{1,3})(?![0-9])/);
  return !!m && parseInt(m[1], 10) >= SURAT_JALAN_FROM_WEEK;
}
/** Invoice ini memakai alur surat jalan: supplier KNITTO DAN MRP W45 ke atas. */
export const invoiceUsesSuratJalan = (supplier: string | null | undefined, mrpId: string | null | undefined) => supplierUsesSuratJalan(supplier) && suratJalanActiveForMrp(mrpId);

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
  warnings: string[];
};

const round2 = (n: number) => Math.round(n * 100) / 100;
const num = (s: string) => Number(String(s).replace(",", "."));

/** Nomor invoice: huruf besar, tanpa spasi (perbandingan tidak peka huruf besar/kecil dan spasi). */
export const normInvoiceNo = (s: string | null | undefined) => String(s ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");

const ITEM_RE = /^\s*([A-Z]\d{8,12})\s+(\d{1,3}(?:[.,]\d{1,3})?)\s*$/;
const HEADER_RE = /^\s*(RIB\s+)?([A-Z]+(?:\s+[A-Z]+)*?)\s+(\d{2}S)\s+([A-Z][A-Z0-9 ]*?)\s*$/;
const TOTAL_RE = /Total\s*[:;]?\s*\(\s*(\d+)\s*\)\s*([\d.,]+)\s*kg/i;

/** Nama file "OH161126049.pdf" -> "OH161126049" (cadangan kalau No Order tidak terbaca). */
function stemOfFile(name: string): string {
  const base = String(name || "").replace(/^.*[\\/]/, "").replace(/\.pdf$/i, "").replace(/(\s*-\s*copy)?(\s*\(\d+\))?\s*$/i, "").trim().toUpperCase();
  return /^[A-Z]{2}\d{6,}$/.test(base) ? base : "";
}

export function parseSuratJalanKnitto(text: string, fileName = ""): ParsedSuratJalan {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+$/, ""))
    .filter((l) => l.trim());
  const out: ParsedSuratJalan = { fileName, noOrder: "", noPenjualan: "", tanggal: null, groups: [], total: null, errors: [], warnings: [] };

  if (!/BUKTI\s*KELUAR\s*BARANG/i.test(text)) out.errors.push('Berkas ini bukan "Bukti Keluar Barang" (surat jalan) KNITTO.');
  const mNo = text.match(/No\s*Order\s*[:;]?\s*([A-Z]{2}\d{6,})/i);
  if (mNo) out.noOrder = mNo[1].toUpperCase();
  const stem = stemOfFile(fileName);
  if (!out.noOrder) out.noOrder = stem;
  else if (stem && stem !== out.noOrder) out.warnings.push(`Nama file (${stem}) berbeda dengan No Order di surat jalan (${out.noOrder}); yang dipakai No Order di isi surat jalan.`);
  if (!out.noOrder) out.errors.push("No Order tidak terbaca di surat jalan.");
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
    if (all.length !== out.total.n) out.errors.push(`Jumlah baris terbaca (${all.length}) tidak sama dengan total di surat jalan (${out.total.n}); PDF mungkin tidak terbaca utuh.`);
    else if (Math.abs(sum - out.total.kg) > 0.03) out.errors.push(`Jumlah berat terbaca (${sum} kg) tidak sama dengan total di surat jalan (${out.total.kg} kg); PDF mungkin tidak terbaca utuh.`);
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

  for (const g of rollGroups) {
    const gBase = normName(g.warna);
    const sameColor = refs.filter((r) => r.base === gBase);
    const pool = sameColor.length > 0 ? sameColor : refs;
    if (sameColor.length === 0) warnings.push(`Warna "${g.warna}" di surat jalan tidak persis sama dengan warna invoice; roll dicocokkan lewat berat bruto saja.`);
    for (const it of g.items) {
      // Roll yang SUDAH punya code roll yang sama (unggah ulang surat jalan yang sama) dianggap cocok.
      let ref = pool.find((r) => !r.used && r.code && r.code.toUpperCase() === it.code);
      let already = !!ref;
      if (ref && Math.abs(ref.gross - it.bruto) > BRUTO_TOLERANCE) {
        errors.push(`Code roll ${it.code} sudah tercatat di invoice dengan bruto ${ref.gross} kg, tetapi surat jalan menulis ${it.bruto} kg.`);
        continue;
      }
      if (!ref) {
        const cand = pool.filter((r) => !r.used && !r.code && Math.abs(r.gross - it.bruto) <= BRUTO_TOLERANCE).sort((a, b) => Math.abs(a.gross - it.bruto) - Math.abs(b.gross - it.bruto));
        ref = cand[0];
        already = false;
      }
      if (!ref) {
        const hasWeightButCoded = pool.some((r) => !r.used && r.code && Math.abs(r.gross - it.bruto) <= BRUTO_TOLERANCE);
        errors.push(
          hasWeightButCoded
            ? `Roll ${it.code} (${it.bruto} kg): roll invoice dengan bruto itu sudah punya code roll lain. Surat jalan ini mungkin bukan untuk roll yang tersisa.`
            : `Roll ${it.code} (${it.bruto} kg, ${g.warna}) tidak ada pasangannya di invoice ${invoice.noInvoiceVendor} (tidak ada roll dengan bruto itu yang masih kosong). Mungkin surat jalan salah invoice.`
        );
        continue;
      }
      ref.used = true;
      matches.push({ warna: ref.warna, lengan: ref.lengan, rollIndex: ref.rollIndex, code: it.code, bruto: it.bruto, gross: ref.gross, sjWarna: g.warna, alreadySet: already });
    }
  }
  const rollsStillWithoutCode = refs.filter((r) => !r.used && !r.code).length;
  if (errors.length === 0 && rollsStillWithoutCode > 0) warnings.push(`${rollsStillWithoutCode} roll invoice belum punya code roll setelah surat jalan ini (menunggu surat jalan berikutnya).`);
  return result({ rollsStillWithoutCode, ribIgnored });
}
