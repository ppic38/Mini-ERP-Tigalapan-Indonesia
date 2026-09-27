import * as XLSX from "xlsx";
import type { Lengan } from "./types";
import type { MigrationIssue, MigrationLine, MigrationMrp, MigrationRoll, MigrationTahap } from "./migrationTypes";

/** Parser template "Migrasi Data Awal" Konveksi Makassar (owner 2026-09-25) -- 5 sheet:
 *  1_PO_Warna, 2_Roll_Bahan, 3_Sudah_Dipotong, 4_FG_Belum_Kirim, 5_Sudah_Kirim (baris 1 = catatan,
 *  baris 2 = header, data mulai baris 3). Kuncinya "No MRP" (semua sheet) + "Kode Roll" (sheet 2-5).
 *  Hasil: MigrationMrp[] + daftar masalah (error memblokir simpan, warning hanya info). Validasi yang
 *  sama diulang di server (importMigrationAction) -- ini murni supaya user langsung lihat masalahnya
 *  sebelum menekan Simpan. */

const SIZES = ["XS", "S", "M", "L", "XL", "2XL", "3XL", "4XL", "5XL"];

type Row = Record<string, unknown>;

function normHeader(h: string): string {
  return h.replace(/\s*\*\s*$/, "").trim().toLowerCase();
}

function readSheet(wb: XLSX.WorkBook, name: string): { rows: Row[] | null } {
  const ws = wb.Sheets[name];
  if (!ws) return { rows: null };
  const raw = XLSX.utils.sheet_to_json<Row>(ws, { range: 1, defval: null });
  return {
    rows: raw.map((r) => {
      const o: Row = {};
      for (const [k, v] of Object.entries(r)) o[normHeader(k)] = v;
      return o;
    }),
  };
}

function str(v: unknown): string {
  return v == null ? "" : String(v).trim();
}

function num(v: unknown): number {
  if (typeof v === "number") return v;
  const s = str(v);
  if (!s) return 0;
  const normalized = s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s;
  const n = Number(normalized);
  return Number.isFinite(n) ? n : 0;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** Tanggal -> "YYYY-MM-DD". Terima serial Excel (angka), teks "YYYY-MM-DD", atau "DD/MM/YYYY". */
function dateStr(v: unknown): string {
  if (typeof v === "number" && v > 20000) {
    const d = new Date(Math.round((v - 25569) * 86400 * 1000));
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  }
  const s = str(v);
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const dmy = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (dmy) return `${dmy[3]}-${pad(Number(dmy[2]))}-${pad(Number(dmy[1]))}`;
  return "";
}

function lengan(v: unknown): Lengan | null {
  const s = str(v).toUpperCase();
  if (s === "PENDEK" || s === "PDK") return "PENDEK";
  if (s === "PANJANG" || s === "PJG") return "PANJANG";
  return null;
}

function tahap(v: unknown): MigrationTahap | null {
  const c = str(v).charAt(0).toUpperCase();
  return c === "G" || c === "A" || c === "B" || c === "C" || c === "D" ? c : null;
}

function sizesOf(row: Row): Record<string, number> {
  const out: Record<string, number> = {};
  for (const s of SIZES) {
    const q = Math.round(num(row[s.toLowerCase()]));
    if (q > 0) out[s] = q;
  }
  return out;
}

const sum = (o: Record<string, number>) => Object.values(o).reduce((a, b) => a + b, 0);

function isBlank(row: Row): boolean {
  return Object.values(row).every((v) => v == null || str(v) === "");
}

export type ParsedMigration = { mrps: MigrationMrp[]; issues: MigrationIssue[] };

export async function parseMigrationImportFile(file: File): Promise<ParsedMigration> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  const issues: MigrationIssue[] = [];
  const err = (sheet: string, row: number | undefined, message: string) => issues.push({ severity: "error", sheet, row, message });
  const warn = (sheet: string, row: number | undefined, message: string) => issues.push({ severity: "warning", sheet, row, message });

  const s1 = readSheet(wb, "1_PO_Warna").rows;
  const s2 = readSheet(wb, "2_Roll_Bahan").rows;
  if (!s1 || !s2) throw new Error('File ini bukan template migrasi -- sheet "1_PO_Warna" dan "2_Roll_Bahan" tidak ditemukan.');
  const s3 = readSheet(wb, "3_Sudah_Dipotong").rows ?? [];
  const s4 = readSheet(wb, "4_FG_Belum_Kirim").rows ?? [];
  const s5 = readSheet(wb, "5_Sudah_Kirim").rows ?? [];
  const sAduan = readSheet(wb, "Aduan_Pola").rows ?? [];

  const isExample = (r: Row) => str(r["catatan"]).toLowerCase().startsWith("contoh");
  const key = (mrpId: string, code: string) => mrpId + "||" + code;
  // Baris contoh di sheet 2 (Catatan "Contoh...") -- baris di sheet 3/4/5 untuk roll yang sama juga
  // dianggap contoh (sheet 3 versi lama tidak punya kolom Catatan), supaya template kosong yang
  // belum dibersihkan tidak memunculkan error palsu.
  const exampleRoll = new Set<string>();
  for (const r of s2) {
    if (!isBlank(r) && isExample(r)) {
      const m = str(r["no mrp"]);
      const c = str(r["kode roll"]);
      if (m && c) exampleRoll.add(key(m, c));
    }
  }

  // ---------- Sheet 1: baris warna+lengan per MRP ----------
  const mrps = new Map<string, MigrationMrp>();
  s1.forEach((r, i) => {
    if (isBlank(r) || isExample(r)) return;
    const rowNum = i + 3;
    const mrpId = str(r["no mrp"]);
    const kategori = str(r["kategori"]);
    const warna = str(r["warna"]);
    const len = lengan(r["lengan"]);
    const qtyRoll = num(r["qty roll (sisa)"]);
    const sizes = sizesOf(r);
    if (!mrpId) return err("1_PO_Warna", rowNum, "No MRP kosong");
    if (!kategori) err("1_PO_Warna", rowNum, "Kategori kosong");
    if (!warna) err("1_PO_Warna", rowNum, "Warna kosong");
    if (!len) err("1_PO_Warna", rowNum, "Lengan harus PENDEK atau PANJANG");
    if (!(qtyRoll > 0)) err("1_PO_Warna", rowNum, "Qty Roll harus lebih dari 0");
    if (sum(sizes) <= 0) err("1_PO_Warna", rowNum, "Isi minimal satu ukuran (pcs rencana)");
    if (!kategori || !warna || !len) return;
    const mrp = mrps.get(mrpId) ?? { mrpId, poRef: undefined, poDate: undefined, lines: [] as MigrationLine[], rolls: [] as MigrationRoll[] };
    if (!mrp.poRef) mrp.poRef = str(r["no po manual (referensi)"]) || undefined;
    if (!mrp.poDate) mrp.poDate = dateStr(r["tanggal po"]) || undefined;
    if (mrp.lines.some((l) => l.warna === warna && l.lengan === len)) err("1_PO_Warna", rowNum, `${mrpId}: ${warna} · ${len} muncul lebih dari sekali`);
    else mrp.lines.push({ kategori, warna, lengan: len, qtyRoll, sizes });
    mrps.set(mrpId, mrp);
  });

  // ---------- Sheet Aduan_Pola (opsional): rincian per kode pairing ----------
  sAduan.forEach((r, i) => {
    if (isBlank(r) || isExample(r)) return;
    const rowNum = i + 3;
    const mrpId = str(r["no mrp"]);
    const warna = str(r["warna"]);
    const len = lengan(r["lengan"]);
    const kode = str(r["kode pairing"]);
    const qtyRoll = num(r["qty roll"]);
    const sizes = sizesOf(r);
    if (!mrpId || !warna || !len || !kode) return err("Aduan_Pola", rowNum, "No MRP, Warna, Lengan, dan Kode Pairing wajib diisi");
    if (!(qtyRoll > 0)) err("Aduan_Pola", rowNum, `${kode}: Qty Roll harus lebih dari 0`);
    if (sum(sizes) <= 0) err("Aduan_Pola", rowNum, `${kode}: isi minimal satu ukuran (pcs)`);
    const line = mrps.get(mrpId)?.lines.find((l) => l.warna === warna && l.lengan === len);
    if (!line) return err("Aduan_Pola", rowNum, `${mrpId}: ${warna} · ${len} tidak ada di 1_PO_Warna`);
    line.aduan = line.aduan ?? [];
    if (line.aduan.some((a) => a.kode === kode)) return err("Aduan_Pola", rowNum, `${mrpId}: kode pairing ${kode} muncul lebih dari sekali untuk ${warna} · ${len}`);
    line.aduan.push({ kode, qtyRoll, sizes });
  });

  // ---------- Sheet 3-5 diindeks per (No MRP + Kode Roll) ----------
  const cutting = new Map<string, { row: number; v: NonNullable<MigrationRoll["cutting"]>; kodePairing?: string }>();
  s3.forEach((r, i) => {
    if (isBlank(r) || isExample(r)) return;
    const rowNum = i + 3;
    const mrpId = str(r["no mrp"]);
    const code = str(r["kode roll"]);
    if (!mrpId || !code) return err("3_Sudah_Dipotong", rowNum, "No MRP dan Kode Roll wajib diisi");
    if (exampleRoll.has(key(mrpId, code))) return;
    const restingAt = dateStr(r["tanggal mulai resting"]);
    const netKg = num(r["berat bersih (kg)"]);
    const kodePairing = str(r["kode pairing"]);
    if (!restingAt) err("3_Sudah_Dipotong", rowNum, `${code}: Tanggal Mulai Resting kosong/tidak valid (format YYYY-MM-DD)`);
    if (!(netKg > 0)) err("3_Sudah_Dipotong", rowNum, `${code}: Berat Bersih harus lebih dari 0`);
    if (cutting.has(key(mrpId, code))) return err("3_Sudah_Dipotong", rowNum, `${code}: muncul lebih dari sekali`);
    const gramasi = num(r["gramasi (gsm)"]);
    cutting.set(key(mrpId, code), { row: rowNum, v: { restingAt, netKg, gramasi: gramasi > 0 ? gramasi : undefined, setting: str(r["setting"]) || undefined, sizes: sizesOf(r) }, kodePairing: kodePairing || undefined });
  });
  const fgMap = new Map<string, { row: number; v: Record<string, number> }>();
  s4.forEach((r, i) => {
    if (isBlank(r) || isExample(r)) return;
    const rowNum = i + 3;
    const mrpId = str(r["no mrp"]);
    const code = str(r["kode roll"]);
    if (!mrpId || !code) return err("4_FG_Belum_Kirim", rowNum, "No MRP dan Kode Roll wajib diisi");
    if (exampleRoll.has(key(mrpId, code))) return;
    if (fgMap.has(key(mrpId, code))) return err("4_FG_Belum_Kirim", rowNum, `${code}: muncul lebih dari sekali`);
    fgMap.set(key(mrpId, code), { row: rowNum, v: sizesOf(r) });
  });
  const shipMap = new Map<string, { row: number; v: NonNullable<MigrationRoll["ship"]> }>();
  s5.forEach((r, i) => {
    if (isBlank(r) || isExample(r)) return;
    const rowNum = i + 3;
    const mrpId = str(r["no mrp"]);
    const code = str(r["kode roll"]);
    if (!mrpId || !code) return err("5_Sudah_Kirim", rowNum, "No MRP dan Kode Roll wajib diisi");
    if (exampleRoll.has(key(mrpId, code))) return;
    const noResi = str(r["no resi"]);
    const ekspedisi = str(r["ekspedisi"]);
    const tanggalKirim = dateStr(r["tanggal kirim"]);
    const noKoli = str(r["no koli"]);
    if (!noResi) err("5_Sudah_Kirim", rowNum, `${code}: No Resi kosong`);
    if (!ekspedisi) err("5_Sudah_Kirim", rowNum, `${code}: Ekspedisi kosong`);
    if (!tanggalKirim) err("5_Sudah_Kirim", rowNum, `${code}: Tanggal Kirim kosong/tidak valid (format YYYY-MM-DD)`);
    if (!noKoli) err("5_Sudah_Kirim", rowNum, `${code}: No Koli kosong`);
    if (shipMap.has(key(mrpId, code))) return err("5_Sudah_Kirim", rowNum, `${code}: muncul lebih dari sekali`);
    const berat = num(r["berat koli (kg)"]);
    shipMap.set(key(mrpId, code), { row: rowNum, v: { noResi, ekspedisi, tanggalKirim, noKoli, beratKoli: berat > 0 ? berat : undefined } });
  });

  // ---------- Sheet 2: roll ----------
  const seenCodes = new Map<string, number>();
  const usedCutting = new Set<string>();
  const usedFg = new Set<string>();
  const usedShip = new Set<string>();
  s2.forEach((r, i) => {
    if (isBlank(r) || isExample(r)) return;
    const rowNum = i + 3;
    const mrpId = str(r["no mrp"]);
    const warna = str(r["warna"]);
    const len = lengan(r["lengan"]);
    const codeRoll = str(r["kode roll"]);
    const grossKg = num(r["berat kotor (kg)"]);
    const hargaPerKg = num(r["harga per kg (rp)"]);
    const th = tahap(r["tahap roll"]);
    if (!mrpId || !warna || !len) return err("2_Roll_Bahan", rowNum, "No MRP, Warna, dan Lengan wajib diisi");
    if (!th) return err("2_Roll_Bahan", rowNum, `${codeRoll || "(roll)"}: Tahap Roll wajib dipilih (G/A/B/C/D)`);
    const label = codeRoll || `roll baris ${rowNum}`;
    if (th !== "G" && !codeRoll) return err("2_Roll_Bahan", rowNum, "Kode Roll wajib diisi (kecuali tahap G - menunggu Good Receive)");
    if (!(grossKg > 0)) err("2_Roll_Bahan", rowNum, `${label}: Berat Kotor harus lebih dari 0`);
    if (!(hargaPerKg > 0)) err("2_Roll_Bahan", rowNum, `${label}: Harga per Kg WAJIB diisi`);
    if (th === "G" && codeRoll) warn("2_Roll_Bahan", rowNum, `${codeRoll}: tahap G -- kode roll diabaikan, vendor mengisinya saat Good Receive`);
    if (th !== "G") {
      if (seenCodes.has(codeRoll)) return err("2_Roll_Bahan", rowNum, `Kode Roll ${codeRoll} dobel (juga di baris ${seenCodes.get(codeRoll)}) -- kode roll harus unik di seluruh file`);
      seenCodes.set(codeRoll, rowNum);
    }
    const mrp = mrps.get(mrpId);
    if (!mrp) return err("2_Roll_Bahan", rowNum, `${codeRoll}: No MRP ${mrpId} tidak ada di sheet 1_PO_Warna`);
    if (!mrp.lines.some((l) => l.warna === warna && l.lengan === len)) return err("2_Roll_Bahan", rowNum, `${codeRoll}: ${warna} · ${len} tidak ada di 1_PO_Warna untuk ${mrpId}`);

    const roll: MigrationRoll = { warna, lengan: len, codeRoll: th === "G" ? "" : codeRoll, grossKg, codeLot: str(r["kode lot"]) || undefined, hargaPerKg, tahap: th };
    const k = key(mrpId, codeRoll);
    if (th === "G") {
      mrp.rolls.push(roll);
      return;
    }
    if (th !== "A") {
      const c = cutting.get(k);
      if (!c) err("2_Roll_Bahan", rowNum, `${codeRoll}: tahap ${th} tapi tidak ada di sheet 3_Sudah_Dipotong`);
      else {
        usedCutting.add(k);
        roll.cutting = c.v;
        roll.kodePairing = c.kodePairing;
        const line = mrp.lines.find((l) => l.warna === warna && l.lengan === len)!;
        const kodes = line.aduan ?? [];
        if (kodes.length > 1 && !c.kodePairing) err("3_Sudah_Dipotong", c.row, `${codeRoll}: Kode Pairing wajib diisi (baris ini punya ${kodes.length} kode aduan pola)`);
        else if (c.kodePairing && kodes.length > 0 && !kodes.some((a) => a.kode === c.kodePairing)) err("3_Sudah_Dipotong", c.row, `${codeRoll}: Kode Pairing ${c.kodePairing} tidak ada di sheet Aduan_Pola untuk ${warna} · ${len}`);
        if (th !== "B" && sum(c.v.sizes) <= 0) err("3_Sudah_Dipotong", c.row, `${codeRoll}: hasil potong per size wajib diisi untuk tahap ${th}`);
      }
    } else if (cutting.has(k)) warn("3_Sudah_Dipotong", cutting.get(k)!.row, `${codeRoll}: di sheet 2 tahap A (belum dipotong) -- baris ini diabaikan`);
    if (th === "C" || th === "D") {
      const f = fgMap.get(k);
      if (!f) err("2_Roll_Bahan", rowNum, `${codeRoll}: tahap ${th} tapi tidak ada di sheet 4_FG_Belum_Kirim`);
      else {
        usedFg.add(k);
        roll.fg = f.v;
        if (roll.cutting) {
          for (const [size, q] of Object.entries(f.v)) {
            if (q > (roll.cutting.sizes[size] ?? 0)) err("4_FG_Belum_Kirim", f.row, `${codeRoll}: FG ${size} (${q}) melebihi hasil potong (${roll.cutting.sizes[size] ?? 0})`);
          }
        }
      }
    } else if (fgMap.has(k)) warn("4_FG_Belum_Kirim", fgMap.get(k)!.row, `${codeRoll}: tahap ${th} -- baris FG ini diabaikan`);
    if (th === "D") {
      const s = shipMap.get(k);
      if (!s) err("2_Roll_Bahan", rowNum, `${codeRoll}: tahap D tapi tidak ada di sheet 5_Sudah_Kirim`);
      else {
        usedShip.add(k);
        roll.ship = s.v;
      }
    } else if (shipMap.has(k)) warn("5_Sudah_Kirim", shipMap.get(k)!.row, `${codeRoll}: tahap ${th} -- baris pengiriman ini diabaikan`);
    mrp.rolls.push(roll);
  });

  for (const [k, v] of cutting) if (!usedCutting.has(k) && !seenCodes.has(k.split("||")[1])) err("3_Sudah_Dipotong", v.row, `Kode Roll ${k.split("||")[1]} tidak ada di sheet 2_Roll_Bahan`);
  for (const [k, v] of fgMap) if (!usedFg.has(k) && !seenCodes.has(k.split("||")[1])) err("4_FG_Belum_Kirim", v.row, `Kode Roll ${k.split("||")[1]} tidak ada di sheet 2_Roll_Bahan`);
  for (const [k, v] of shipMap) if (!usedShip.has(k) && !seenCodes.has(k.split("||")[1])) err("5_Sudah_Kirim", v.row, `Kode Roll ${k.split("||")[1]} tidak ada di sheet 2_Roll_Bahan`);

  // ---------- Per MRP: jumlah roll harus ada & cocok dengan rencana ----------
  for (const mrp of mrps.values()) {
    for (const line of mrp.lines) {
      const count = mrp.rolls.filter((r) => r.warna === line.warna && r.lengan === line.lengan).length;
      if (count === 0) err("2_Roll_Bahan", undefined, `${mrp.mrpId}: ${line.warna} · ${line.lengan} belum punya roll di sheet 2_Roll_Bahan`);
      else if (Math.abs(count - line.qtyRoll) > 0.5) warn("1_PO_Warna", undefined, `${mrp.mrpId}: ${line.warna} · ${line.lengan} — Qty Roll ${line.qtyRoll} tapi roll di sheet 2 ada ${count}; sistem memakai ${count}.`);
      if (line.aduan && line.aduan.length > 0) {
        const aduanRoll = line.aduan.reduce((s, a) => s + a.qtyRoll, 0);
        const aduanPcs = line.aduan.reduce((s, a) => s + sum(a.sizes), 0);
        if (count > 0 && Math.abs(aduanRoll - count) > 0.5) warn("Aduan_Pola", undefined, `${mrp.mrpId}: ${line.warna} · ${line.lengan} — total Qty Roll aduan pola ${aduanRoll} tapi roll di sheet 2 ada ${count}.`);
        if (Math.abs(aduanPcs - sum(line.sizes)) > 0) warn("Aduan_Pola", undefined, `${mrp.mrpId}: ${line.warna} · ${line.lengan} — total pcs aduan pola ${aduanPcs} beda dari rencana di 1_PO_Warna (${sum(line.sizes)}).`);
      }
    }
  }

  if (mrps.size === 0 && issues.length === 0) throw new Error("Tidak ada data di file ini (sheet 1_PO_Warna kosong).");
  return { mrps: Array.from(mrps.values()), issues };
}
