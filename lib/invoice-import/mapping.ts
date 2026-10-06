// Pemetaan warna invoice supplier -> warna MRP/PO, alokasi roll, dan rekonsiliasi.
//
// Prinsip (owner: "tidak ingin ada selisih nanti dari hasil akhir kalkulasi ... kalau miss saya
// ingin tau missnya di mana"): TIDAK ADA warna/roll invoice yang boleh "hilang diam-diam".
//  - Setiap blok barang invoice (roll & rib) HARUS dipetakan ke warna PO dan statusnya terlihat.
//  - Pemetaan yang cuma ditebak (nama mirip) harus DIKONFIRMASI manual; yang cocok persis atau
//    sudah pernah disimpan (alias per supplier) otomatis terkonfirmasi tapi tetap ditampilkan.
//  - Jumlah roll invoice == jumlah roll yang dialokasikan, dan tidak boleh melebihi sisa roll PO.
//  - Semua selisih ditampilkan per warna di tabel rekonsiliasi, bukan cuma angka total.
// Murni (tanpa DOM/React) supaya bisa dites langsung di Node.

import type { ParsedInvoice, ParsedInvoiceGroup } from "./types";
import { round2 } from "./parser-knitto";

// ---------- Nama warna ----------

export type ParsedMrpWarna = { base: string; benang: string; variant: string };

/** Normalisasi nama untuk perbandingan: huruf besar, tanpa tanda baca, spasi tunggal. */
export function normName(s: string): string {
  return String(s ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
const compact = (s: string) => normName(s).replace(/ /g, "");

/** "ABU MUDA 24S KID" -> {base:"ABU MUDA", benang:"24S", variant:"KID"}. Tanpa token benang -> semua jadi base. */
export function parseMrpWarna(warna: string): ParsedMrpWarna {
  const tokens = normName(warna).split(" ").filter(Boolean);
  const idx = tokens.findIndex((t) => /^\d{2}S$/.test(t));
  if (idx < 0) return { base: tokens.join(" "), benang: "", variant: "" };
  return { base: tokens.slice(0, idx).join(" "), benang: tokens[idx], variant: tokens.slice(idx + 1).join(" ") };
}

const tokenSet = (s: string) => new Set(normName(s).split(" ").filter(Boolean));
function jaccard(a: Set<string>, b: Set<string>) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

// ---------- Warna PO ----------

/** Bentuk minimal PO yang dibutuhkan (struktural -- cocok dengan MaterialPO di lib/mrp/types.ts). */
export type PoLike = {
  colorBreakdown: { warna: string; lengan: string; rollCount: number }[];
  invoicedByColor: Record<string, number>;
};

export type PoColorInfo = {
  warna: string;
  total: number;
  /** Sudah ditagih di Paying Voucher sebelumnya (semua lengan). */
  before: number;
  remaining: number;
  parsed: ParsedMrpWarna;
};

/** Ringkas colorBreakdown PO per warna (gabungan semua lengan) + sisa roll yang belum di-PV-kan. */
export function poColorsFromPo(po: PoLike): PoColorInfo[] {
  const map = new Map<string, PoColorInfo>();
  for (const c of po.colorBreakdown) {
    if (!(c.rollCount > 0)) continue;
    const cur = map.get(c.warna) ?? { warna: c.warna, total: 0, before: 0, remaining: 0, parsed: parseMrpWarna(c.warna) };
    cur.total += c.rollCount;
    cur.before += po.invoicedByColor[`${c.warna}|${c.lengan}`] ?? 0;
    map.set(c.warna, cur);
  }
  for (const c of map.values()) c.remaining = Math.max(0, c.total - c.before);
  return Array.from(map.values()).sort((a, b) => a.warna.localeCompare(b.warna, "id-ID"));
}

// ---------- Pencocokan nama ----------

export type MatchKind = "alias" | "exact" | "variant" | "fuzzy" | "manual" | "none";

/** Alias tersimpan per supplier: kunci aliasKey(warna invoice, benang) -> nama warna MRP lengkap. */
export type AliasMap = Record<string, string>;
export const aliasKey = (invoiceWarna: string, benang: string) => `${compact(invoiceWarna)}|${normName(benang)}`;

export type Candidate = { warna: string; kind: Exclude<MatchKind, "manual" | "none">; score: number };

/** Urutkan warna PO dari yang paling mungkin untuk 1 warna invoice. Hanya saran -- bukan keputusan. */
export function rankCandidates(invoiceWarna: string, benang: string, poColors: PoColorInfo[], aliases: AliasMap): Candidate[] {
  const out: Candidate[] = [];
  const aliasTarget = aliases[aliasKey(invoiceWarna, benang)];
  const inv = compact(invoiceWarna);
  const invTokens = tokenSet(invoiceWarna);
  for (const p of poColors) {
    if (benang && p.parsed.benang && normName(benang) !== p.parsed.benang) continue; // 24S vs 30S: tidak pernah cocok
    if (aliasTarget && normName(aliasTarget) === normName(p.warna)) {
      out.push({ warna: p.warna, kind: "alias", score: 200 });
      continue;
    }
    const baseCompact = p.parsed.base.replace(/ /g, "");
    if (inv === baseCompact) {
      out.push(p.parsed.variant === "" ? { warna: p.warna, kind: "exact", score: 100 } : { warna: p.warna, kind: "variant", score: 85 });
      continue;
    }
    const sim = jaccard(invTokens, tokenSet(p.parsed.base));
    const contains = baseCompact.length >= 3 && (inv.includes(baseCompact) || baseCompact.includes(inv));
    const score = Math.max(sim * 60, contains ? 45 : 0);
    if (score >= 20) out.push({ warna: p.warna, kind: "fuzzy", score: p.parsed.variant === "" ? score : score - 3 });
  }
  return out.sort((a, b) => b.score - a.score || a.warna.localeCompare(b.warna, "id-ID"));
}

// ---------- Pemetaan ----------

export type Alloc = { warna: string; qty: number };

export type GroupMapping = {
  key: string;
  /** Indeks blok di ParsedInvoice.groups. */
  groupIndex: number;
  kind: "roll" | "rib";
  invoiceWarna: string;
  benang: string;
  /** Roll: pembagian jumlah roll ke warna PO (jumlah qty = jumlah baris invoice). Rib: 1 warna tujuan (qty diabaikan). */
  alloc: Alloc[];
  how: MatchKind;
  /** Sudah dikonfirmasi (alias/persis otomatis; saran/varian/manual lewat klik user). */
  confirmed: boolean;
  /** Saran urut dari yang terbaik (untuk ditampilkan). */
  candidates: Candidate[];
  /** Rib saja: true kalau user memilih warna tujuan sendiri (tidak lagi otomatis mengikuti warna roll). */
  manualTarget?: boolean;
};

/**
 * Pemetaan awal otomatis. Pencocokan persis & alias langsung terkonfirmasi; nama yang cuma mirip
 * hanya DISARANKAN (confirmed=false) -- user wajib mengonfirmasi. Roll yang melebihi sisa warna
 * target dilimpahkan ke varian saudara (KID/RIB/TUNIK warna & benang sama) hanya sebagai usulan
 * yang juga wajib dikonfirmasi; sisanya dibiarkan tak teralokasi (muncul sebagai selisih merah).
 */
export function autoMap(inv: ParsedInvoice, poColors: PoColorInfo[], aliases: AliasMap): GroupMapping[] {
  const used = new Map<string, number>(); // roll yang sudah "dipakai" grup lain pada pemetaan awal
  const remainingOf = (w: string) => Math.max(0, (poColors.find((p) => p.warna === w)?.remaining ?? 0) - (used.get(w) ?? 0));
  const mappings: GroupMapping[] = [];

  const rollGroups = inv.groups.map((g, i) => ({ g, i })).filter((x) => x.g.kind === "roll");
  const ribGroups = inv.groups.map((g, i) => ({ g, i })).filter((x) => x.g.kind === "rib");

  for (const { g, i } of rollGroups) {
    const candidates = rankCandidates(g.warna, g.benang, poColors, aliases);
    const best = candidates[0];
    const n = g.lines.length;
    const m: GroupMapping = { key: `roll:${i}`, groupIndex: i, kind: "roll", invoiceWarna: g.warna, benang: g.benang, alloc: [], how: best ? best.kind : "none", confirmed: false, candidates };
    if (best) {
      const primary = poColors.find((p) => p.warna === best.warna)!;
      const first = Math.min(n, remainingOf(primary.warna));
      let left = n - first;
      m.alloc.push({ warna: primary.warna, qty: first });
      used.set(primary.warna, (used.get(primary.warna) ?? 0) + first);
      if (left > 0) {
        const siblings = poColors
          .filter((p) => p.warna !== primary.warna && p.parsed.base === primary.parsed.base && p.parsed.benang === primary.parsed.benang)
          .sort((a, b) => a.parsed.variant.localeCompare(b.parsed.variant));
        for (const s of siblings) {
          if (left <= 0) break;
          const take = Math.min(left, remainingOf(s.warna));
          if (take <= 0) continue;
          m.alloc.push({ warna: s.warna, qty: take });
          used.set(s.warna, (used.get(s.warna) ?? 0) + take);
          left -= take;
        }
      }
      // Qty pertama 0 (warna target sudah penuh) tidak berguna ditampilkan sebagai baris alokasi.
      m.alloc = m.alloc.filter((a, idx) => a.qty > 0 || (idx === 0 && m.alloc.length === 1));
      const single = m.alloc.length === 1;
      m.confirmed = (best.kind === "alias" || best.kind === "exact") && single && left === 0;
    }
    mappings.push(m);
  }

  for (const { g, i } of ribGroups) {
    const candidates = rankCandidates(g.warna, g.benang, poColors, aliases);
    // Rib mengikuti warna roll yang sama (nama & benang sama) -- ini yang paling aman: rib warna X
    // selalu dibeli untuk kain warna X di invoice yang sama.
    const sibling = mappings.find((m) => m.kind === "roll" && m.invoiceWarna === g.warna && m.benang === g.benang && m.alloc.length > 0);
    let target: string | null = null;
    let how: MatchKind = "none";
    let confirmed = false;
    if (sibling) {
      target = sibling.alloc[0].warna;
      how = sibling.how;
      confirmed = sibling.confirmed;
    } else if (candidates[0]) {
      target = candidates[0].warna;
      how = candidates[0].kind;
      confirmed = candidates[0].kind === "alias" || candidates[0].kind === "exact";
    }
    mappings.push({ key: `rib:${i}`, groupIndex: i, kind: "rib", invoiceWarna: g.warna, benang: g.benang, alloc: target ? [{ warna: target, qty: 0 }] : [], how, confirmed, candidates });
  }
  return mappings;
}

// ---------- Evaluasi & rekonsiliasi ----------

export type ImportIssue = { level: "error" | "warn"; where: string; message: string };

export type ReconRow = {
  warna: string;
  total: number;
  before: number;
  thisInvoice: number;
  after: number;
  /** after < 0 : roll invoice melebihi sisa PO. */
  over: boolean;
};

export type Evaluation = {
  issues: ImportIssue[];
  recon: ReconRow[];
  invoiceRolls: number;
  allocatedRolls: number;
  invoiceRollKg: number;
  invoiceRibKg: number;
  /** Total PV yang akan terbentuk (bahan + rib - diskon), pembulatan ke rupiah. */
  pvTotal: number;
  /** Total Bayar tercetak di invoice. */
  invoiceTotalBayar: number;
  /** pvTotal - invoiceTotalBayar (0 = tidak ada selisih). NaN kalau Total Bayar tidak terbaca. */
  totalDiff: number;
  ok: boolean;
};

const sumW = (g: ParsedInvoiceGroup) => g.lines.reduce((a, l) => a + l.w, 0);

function priceSet(g: ParsedInvoiceGroup) {
  return Array.from(new Set(g.lines.map((l) => l.price)));
}

export function evaluateMapping(inv: ParsedInvoice, mappings: GroupMapping[], poColors: PoColorInfo[]): Evaluation {
  const issues: ImportIssue[] = [];
  const err = (where: string, message: string) => issues.push({ level: "error", where, message });
  const poByName = new Map(poColors.map((p) => [p.warna, p]));
  const thisInvoice = new Map<string, number>();
  const priceByWarna = new Map<string, { price: number; from: string }>();
  let allocatedRolls = 0;

  for (const m of mappings) {
    const g = inv.groups[m.groupIndex];
    const label = `${m.kind === "rib" ? "RIB " : ""}${m.invoiceWarna} ${m.benang}`;
    if (m.alloc.length === 0 || m.alloc.some((a) => !poByName.has(a.warna))) {
      err(label, "Belum dipetakan ke warna di PO ini.");
      continue;
    }
    if (!m.confirmed) err(label, "Pemetaan masih berupa saran — konfirmasi dulu (atau pilih warna lain).");
    if (m.kind === "roll") {
      const sum = m.alloc.reduce((a, x) => a + x.qty, 0);
      if (sum !== g.lines.length) err(label, `Jumlah roll di invoice ${g.lines.length}, baru teralokasi ${sum} (selisih ${g.lines.length - sum}).`);
      allocatedRolls += sum;
      for (const a of m.alloc) thisInvoice.set(a.warna, (thisInvoice.get(a.warna) ?? 0) + a.qty);
      const prices = priceSet(g);
      if (prices.length > 1) err(label, `Harga per kg berbeda dalam satu warna (${prices.join(", ")}) — tidak bisa dibuat otomatis, pakai input manual.`);
      else if (prices.length === 1) {
        for (const a of m.alloc) {
          if (a.qty <= 0) continue;
          const prev = priceByWarna.get(a.warna);
          if (prev && prev.price !== prices[0]) err(label, `Warna MRP ${a.warna} menerima harga berbeda (${prev.price} dari ${prev.from} vs ${prices[0]}) — satu warna hanya boleh satu harga/kg.`);
          else priceByWarna.set(a.warna, { price: prices[0], from: label });
        }
      }
    }
  }

  // Blok invoice yang tidak punya pemetaan sama sekali tidak boleh lolos diam-diam.
  inv.groups.forEach((g, i) => {
    if (!mappings.some((m) => m.groupIndex === i)) err(`${g.kind === "rib" ? "RIB " : ""}${g.warna} ${g.benang}`, "Blok invoice ini tidak punya pemetaan.");
  });

  const recon: ReconRow[] = poColors
    .filter((p) => (thisInvoice.get(p.warna) ?? 0) > 0 || p.remaining > 0)
    .map((p) => {
      const t = thisInvoice.get(p.warna) ?? 0;
      return { warna: p.warna, total: p.total, before: p.before, thisInvoice: t, after: p.total - p.before - t, over: p.total - p.before - t < 0 };
    });
  for (const r of recon) if (r.over) err(r.warna, `Roll invoice (${r.thisInvoice}) melebihi sisa PO (${r.total - r.before}) — kelebihan ${-r.after} roll.`);

  const rollGroups = inv.groups.filter((g) => g.kind === "roll");
  const ribGroups = inv.groups.filter((g) => g.kind === "rib");
  const invoiceRolls = rollGroups.reduce((a, g) => a + g.lines.length, 0);
  const materialTotal = rollGroups.reduce((a, g) => a + g.lines.reduce((s, l) => s + l.price * l.w, 0), 0);
  const ribTotal = ribGroups.reduce((a, g) => a + g.lines.reduce((s, l) => s + l.amount, 0), 0);
  const diskon = Number.isFinite(inv.totals.diskon) ? inv.totals.diskon : 0;
  const pvTotal = Math.round(materialTotal + ribTotal - diskon);
  const totalDiff = Number.isFinite(inv.totals.totalBayar) ? pvTotal - inv.totals.totalBayar : NaN;
  if (Number.isFinite(totalDiff) && totalDiff !== 0) err("Total", `Total PV Rp ${pvTotal.toLocaleString("id-ID")} berbeda dari Total Bayar invoice Rp ${inv.totals.totalBayar.toLocaleString("id-ID")} (selisih Rp ${totalDiff.toLocaleString("id-ID")}).`);

  return {
    issues,
    recon,
    invoiceRolls,
    allocatedRolls,
    invoiceRollKg: round2(rollGroups.reduce((a, g) => a + sumW(g), 0)),
    invoiceRibKg: round2(ribGroups.reduce((a, g) => a + sumW(g), 0)),
    pvTotal,
    invoiceTotalBayar: inv.totals.totalBayar,
    totalDiff,
    ok: !issues.some((i) => i.level === "error"),
  };
}

// ---------- Cek silang konteks PO ----------

export type DuplicateInvoice = { id: string; poId: string };

/** Invoice supplier dengan nomor yang sama sudah pernah dibuat PV-nya (supplier yang sama)? */
export function findDuplicateInvoices(noInvoice: string, supplier: string, existing: { id: string; poId: string; supplier: string; noInvoiceVendor: string }[]): DuplicateInvoice[] {
  const n = compact(noInvoice);
  if (!n) return [];
  return existing.filter((e) => compact(e.noInvoiceVendor) === n && normName(e.supplier) === normName(supplier)).map((e) => ({ id: e.id, poId: e.poId }));
}

// ---------- Hasil akhir untuk wizard PV ----------

export type DraftColorEntry = { warna: string; lengan: string; hargaPerRoll: number; rolls: number[] };
export type DraftAddBuy = { id: string; item: string; warna: string; beratKg: number; hargaPerKg: number; totalHarga: number; remark: string };

/** Bagi roll berurutan ke tiap lengan sesuai sisa roll per lengan (urutan sama seperti input manual di wizard). */
export function splitRollsAcrossLengan<L extends string>(rolls: number[], breakdown: { lengan: L; remaining: number }[]) {
  let idx = 0;
  const result: { lengan: L; rolls: number[] }[] = [];
  for (const b of breakdown) {
    if (b.remaining <= 0 || idx >= rolls.length) continue;
    const take = Math.min(b.remaining, rolls.length - idx);
    if (take <= 0) continue;
    result.push({ lengan: b.lengan, rolls: rolls.slice(idx, idx + take) });
    idx += take;
  }
  return { parts: result, leftover: rolls.length - idx };
}

export const REMARK_UPLOAD = "Dari invoice supplier (upload)";

/**
 * Susun isi Paying Voucher dari invoice + pemetaan. Dipanggil hanya setelah evaluateMapping().ok.
 * Roll tiap warna MRP dibagi berurutan ke lengan sesuai sisa roll per lengan di PO (sama seperti
 * input manual). Rib dibuat 1 baris add-buy per (warna MRP, harga) dengan total = jumlah tercetak.
 */
export function buildPvDraft(inv: ParsedInvoice, mappings: GroupMapping[], po: PoLike): { colorEntries: (DraftColorEntry & { lengan: string })[]; addBuys: DraftAddBuy[]; diskon: number; leftoverRolls: number } {
  const rollsByWarna = new Map<string, { rolls: number[]; price: number }>();
  for (const m of mappings.filter((x) => x.kind === "roll")) {
    const g = inv.groups[m.groupIndex];
    let cursor = 0;
    for (const a of m.alloc) {
      if (a.qty <= 0) continue;
      const cur = rollsByWarna.get(a.warna) ?? { rolls: [], price: g.lines[0].price };
      cur.rolls.push(...g.lines.slice(cursor, cursor + a.qty).map((l) => l.w));
      rollsByWarna.set(a.warna, cur);
      cursor += a.qty;
    }
  }

  const colorEntries: (DraftColorEntry & { lengan: string })[] = [];
  let leftoverRolls = 0;
  for (const [warna, { rolls, price }] of rollsByWarna) {
    const breakdown = po.colorBreakdown
      .filter((c) => c.warna === warna)
      .map((c) => ({ lengan: c.lengan, remaining: Math.max(0, c.rollCount - (po.invoicedByColor[`${c.warna}|${c.lengan}`] ?? 0)) }));
    const { parts, leftover } = splitRollsAcrossLengan(rolls, breakdown);
    leftoverRolls += leftover;
    for (const p of parts) colorEntries.push({ warna, lengan: p.lengan, hargaPerRoll: price, rolls: p.rolls });
  }

  const addBuys: DraftAddBuy[] = [];
  let seq = 0;
  for (const m of mappings.filter((x) => x.kind === "rib")) {
    const g = inv.groups[m.groupIndex];
    const warna = m.alloc[0]?.warna ?? "";
    for (const price of priceSet(g)) {
      const ls = g.lines.filter((l) => l.price === price);
      const beratKg = round2(ls.reduce((a, l) => a + l.w, 0));
      const totalHarga = ls.reduce((a, l) => a + l.amount, 0);
      addBuys.push({ id: `ab-up-${Date.now()}-${seq++}`, item: "Rib", warna, beratKg, hargaPerKg: price, totalHarga, remark: REMARK_UPLOAD });
    }
  }
  const diskon = Number.isFinite(inv.totals.diskon) ? inv.totals.diskon : 0;
  return { colorEntries, addBuys, diskon, leftoverRolls };
}

/** Alias yang layak disimpan: pemetaan 1-ke-1 yang dikonfirmasi user dan BUKAN sekadar alias/persis. */
export function aliasesToSave(mappings: GroupMapping[]): { invoiceWarna: string; benang: string; mrpWarna: string }[] {
  const out = new Map<string, { invoiceWarna: string; benang: string; mrpWarna: string }>();
  for (const m of mappings) {
    if (m.kind !== "roll" || !m.confirmed || m.alloc.length !== 1 || m.how === "alias" || m.how === "exact") continue;
    out.set(aliasKey(m.invoiceWarna, m.benang), { invoiceWarna: m.invoiceWarna, benang: m.benang, mrpWarna: m.alloc[0].warna });
  }
  return Array.from(out.values());
}

export type AppliedCheck = { id: string; label: string; ok: boolean; detail: string };

/** Bandingkan isi form PV saat ini dengan angka invoice supplier. Semua harus cocok = tanpa selisih. */
export function compareApplied(
  info: { totalBayar: number; diskon: number; rollCount: number; rollKg: number; ribKg: number },
  cur: { pvTotal: number; rolls: number; rollKg: number; ribKg: number; diskon: number }
): AppliedCheck[] {
  const rp = (n: number) => "Rp " + Math.round(n).toLocaleString("id-ID");
  const kg = (n: number) => round2(n).toLocaleString("id-ID");
  const checks: AppliedCheck[] = [];
  checks.push({ id: "total", label: "Total PV = Total Bayar invoice", ok: Math.round(cur.pvTotal) === info.totalBayar, detail: `${rp(cur.pvTotal)} vs ${rp(info.totalBayar)}` });
  checks.push({ id: "roll", label: "Jumlah roll = invoice", ok: cur.rolls === info.rollCount, detail: `${cur.rolls} vs ${info.rollCount} roll` });
  checks.push({ id: "rollkg", label: "Berat roll = invoice", ok: Math.abs(cur.rollKg - info.rollKg) < 0.011, detail: `${kg(cur.rollKg)} vs ${kg(info.rollKg)} kg` });
  checks.push({ id: "rib", label: "Berat rib = invoice", ok: Math.abs(cur.ribKg - info.ribKg) < 0.011, detail: `${kg(cur.ribKg)} vs ${kg(info.ribKg)} kg` });
  checks.push({ id: "diskon", label: "Diskon = invoice", ok: Math.round(cur.diskon) === Math.round(info.diskon), detail: `${rp(cur.diskon)} vs ${rp(info.diskon)}` });
  return checks;
}
