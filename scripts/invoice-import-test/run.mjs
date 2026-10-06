// Uji logika "Upload Invoice Supplier" (parser KNITTO + pemetaan warna + rekonsiliasi), tanpa browser.
//   node scripts/invoice-import-test/run.mjs
// Memakai fixture dummy (teks OCR invoice contoh) -- JANGAN taruh data invoice asli di folder ini.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..", "..");
const out = fs.mkdtempSync(path.join(os.tmpdir(), "inv-import-"));
execSync(`npx tsc lib/invoice-import/adapters.ts lib/invoice-import/mapping.ts lib/invoice-import/parser-knitto.ts lib/invoice-import/types.ts --outDir "${out}" --module commonjs --moduleResolution node10 --target es2020 --skipLibCheck --strict`, { cwd: root, stdio: "inherit" });
const require = createRequire(import.meta.url);
const P = require(path.join(out, "parser-knitto.js"));
const M = require(path.join(out, "mapping.js"));
const A = require(path.join(out, "adapters.js"));

const src = fs.readFileSync(path.join(here, "OH300726111.knitto.txt"), "utf8");
const FILE = "OH300726111.YOGI01.MANUAL.pdf";
const inv = P.parseKnittoInvoice(src, FILE);

// ---------- 1. Parser: kriteria penerimaan invoice OH300726111 ----------
assert.equal(inv.noPenjualan, "OH300726111");
assert.equal(inv.tujuan, "YOGI01");
assert.equal(inv.kodeTransfer, "MANUAL");
assert.deepEqual(inv.tanggal, { d: 30, m: 7, y: 2026 });
const rolls = inv.groups.filter((g) => g.kind === "roll");
const ribs = inv.groups.filter((g) => g.kind === "rib");
assert.equal(rolls.length, 2);
assert.equal(rolls[0].warna, "TOSCA MUDA");
assert.equal(rolls[0].lines.length, 4);
assert.equal(rolls[1].warna, "STEEL BLUE");
assert.equal(rolls[1].lines.length, 23);
assert.equal(ribs.length, 2);
assert.deepEqual(ribs[1].lines.map((l) => l.w), [12, 2.6]);
assert.equal(inv.totals.subtotal, 78191280);
assert.equal(inv.totals.diskon, 1374440);
assert.equal(inv.totals.totalBayar, 76816840);
assert.ok(P.validateInvoice(inv).every((c) => c.ok), "semua cek invoice contoh harus hijau");
console.log("parser invoice contoh: OK");

// koreksi otomatis OCR + deteksi kerusakan yang tidak bisa dikoreksi
const broken = src.replace("24.87 KG    111,000     2,760,570", "24.67 KG    111,000     2,760,570").replace("24.61 KG    114,000     2,805,540", "24.61 KG    114,000     2,805,549");
const b = P.parseKnittoInvoice(broken, FILE);
assert.equal(b.groups.flatMap((g) => g.lines).filter((l) => l.fixed).length, 2);
assert.ok(P.validateInvoice(b).every((c) => c.ok));
const worse = P.parseKnittoInvoice(src.replace("24.87 KG    111,000     2,760,570", "24.97 KG    111,000     2,760,999"), FILE);
assert.ok(P.validateInvoice(worse).some((c) => !c.ok && c.blocking), "angka salah yang tak bisa dikoreksi harus memblokir");
// baris roll hilang (OCR melewatkan 1 baris) harus terdeteksi lewat Total Roll-an & SUBTOTAL
const missing = P.parseKnittoInvoice(src.replace("24.9 KG     111,000     2,763,900\n", ""), FILE);
const mc = P.validateInvoice(missing);
assert.ok(mc.some((c) => c.id === "subtotal" && !c.ok) && mc.some((c) => c.id === "roll" && !c.ok), "baris hilang harus terdeteksi");
console.log("koreksi & deteksi OCR: OK");

// OCR menukar O<->0 pada No Penjualan
assert.equal(P.normalizeNoPenjualan("OHO10826001"), "OH010826001");
assert.equal(P.normalizeNoPenjualan("0H300726111"), "OH300726111");
assert.equal(P.parseKnittoInvoice(src.replace("0H300726111", "OH3OO726111"), FILE).noPenjualan, "OH300726111");
// nama file
assert.deepEqual(P.parseFileName("C:\\x\\OH300726111.yogi01.7295 (1).pdf"), { noPenjualan: "OH300726111", tujuan: "YOGI01", kodeTransfer: "7295" });
assert.deepEqual(P.parseFileName("scan-001.pdf"), { noPenjualan: "", tujuan: "", kodeTransfer: "" });
console.log("nama file: OK");

// ---------- 2. Adapter ----------
assert.equal(A.adapterForSupplier("KNITTO")?.id, "knitto");
assert.equal(A.adapterForSupplier("PT Knitto Tekstil Indonesia")?.id, "knitto");
assert.equal(A.adapterForSupplier("SUPPLIER LAIN"), null);
console.log("adapter: OK");

// ---------- 3. Pemetaan warna ----------
// PO: tiap warna punya 2 lengan; "HITAM 24S" sudah pernah di-PV-kan sebagian.
const po = {
  colorBreakdown: [
    { warna: "TOSCA MUDA 24S", lengan: "PENDEK", rollCount: 3 },
    { warna: "TOSCA MUDA 24S", lengan: "PANJANG", rollCount: 1 },
    { warna: "STEEL BLUE 24S", lengan: "PENDEK", rollCount: 13 },
    { warna: "STEEL BLUE 24S", lengan: "PANJANG", rollCount: 10 },
    { warna: "HITAM 24S", lengan: "PENDEK", rollCount: 20 },
    { warna: "STEEL BLUE 24S KID", lengan: "PENDEK", rollCount: 5 },
  ],
  invoicedByColor: {},
};
const colors = M.poColorsFromPo(po);
assert.equal(colors.find((c) => c.warna === "TOSCA MUDA 24S").total, 4);

let maps = M.autoMap(inv, colors, {});
let ev = M.evaluateMapping(inv, maps, colors);
assert.ok(maps.filter((m) => m.kind === "roll").every((m) => m.how === "exact" && m.confirmed), "nama persis -> terkonfirmasi otomatis");
assert.equal(ev.pvTotal, 76816840, "total PV = Total Bayar invoice");
assert.equal(ev.totalDiff, 0);
assert.ok(ev.ok, JSON.stringify(ev.issues));
const draft = M.buildPvDraft(inv, maps, po);
const matTotal = draft.colorEntries.reduce((a, c) => a + c.hargaPerRoll * c.rolls.reduce((s, w) => s + w, 0), 0);
const ribTotal = draft.addBuys.reduce((a, x) => a + x.totalHarga, 0);
assert.equal(Math.round(matTotal + ribTotal - draft.diskon), 76816840, "total hasil susunan PV = Total Bayar");
assert.equal(draft.colorEntries.reduce((a, c) => a + c.rolls.length, 0), 27);
assert.equal(draft.leftoverRolls, 0);
// lengan terisi berurutan sesuai sisa per lengan
assert.deepEqual(draft.colorEntries.filter((c) => c.warna === "STEEL BLUE 24S").map((c) => [c.lengan, c.rolls.length]), [["PENDEK", 13], ["PANJANG", 10]]);
// rib: TOSCA 2,6 kg ; STEEL BLUE 12 + 2,6 kg (1 baris per warna+harga)
const ribBy = Object.fromEntries(draft.addBuys.map((x) => [x.warna, x]));
assert.equal(ribBy["TOSCA MUDA 24S"].beratKg, 2.6);
assert.equal(ribBy["STEEL BLUE 24S"].beratKg, 14.6);
assert.equal(ribBy["STEEL BLUE 24S"].totalHarga, 1476000 + 319800);
console.log("pemetaan persis + susunan PV: OK");

// Nama invoice beda dari MRP ("HITAM REAKTIF" vs "HITAM 24S"): TIDAK boleh lolos tanpa konfirmasi
const invHitam = P.parseKnittoInvoice(
  ["No Penjualan :OH300726222", "Tanggal :30-07-2026", "COMBED 24S - HITAM REAKTIF", "25 KG    100,000   2,500,000", "24 KG    100,000   2,400,000",
   "SUBTOTAL: Rp 4,900,000", "Total Bayar Rp. 4,900,000", "Total Berat", "Total Roll-an:   49 Kg (2)"].join("\n"),
  "OH300726222.YOGI01.MANUAL.pdf"
);
maps = M.autoMap(invHitam, colors, {});
assert.equal(maps[0].confirmed, false, "tanpa alias, nama beda tidak otomatis terkonfirmasi");
ev = M.evaluateMapping(invHitam, maps, colors);
assert.ok(!ev.ok && ev.issues.some((i) => /saran|dipetakan/i.test(i.message)), "harus diblokir sampai dikonfirmasi");
// user memilih HITAM 24S lalu konfirmasi
maps[0].alloc = [{ warna: "HITAM 24S", qty: 2 }];
maps[0].how = "manual";
maps[0].confirmed = true;
ev = M.evaluateMapping(invHitam, maps, colors);
assert.ok(ev.ok, JSON.stringify(ev.issues));
const saved = M.aliasesToSave(maps);
assert.deepEqual(saved, [{ invoiceWarna: "HITAM REAKTIF", benang: "24S", mrpWarna: "HITAM 24S" }]);
// invoice berikutnya: alias tersimpan -> terkonfirmasi otomatis
const aliases = { [M.aliasKey("HITAM REAKTIF", "24S")]: "HITAM 24S" };
maps = M.autoMap(invHitam, colors, aliases);
assert.ok(maps[0].how === "alias" && maps[0].confirmed && maps[0].alloc[0].warna === "HITAM 24S");
console.log("alias warna: OK");

// ---------- 4. Bertahap: 40 warna, 3 invoice x 13 warna = 39 -> sisa 1 harus ketahuan ----------
const poBig = { colorBreakdown: [], invoicedByColor: {} };
for (let i = 1; i <= 40; i++) poBig.colorBreakdown.push({ warna: `WARNA${String(i).padStart(2, "0")} 24S`, lengan: "PENDEK", rollCount: 2 });
function mkInvoice(no, from, to) {
  const lines = [`No Penjualan :${no}`, "Tanggal :01-08-2026"];
  let sub = 0, n = 0;
  for (let i = from; i <= to; i++) {
    lines.push(`COMBED 24S - WARNA${String(i).padStart(2, "0")}`);
    for (let r = 0; r < 2; r++) { lines.push(`25 KG    100,000   2,500,000`); sub += 2500000; n++; }
  }
  lines.push(`SUBTOTAL: Rp ${sub.toLocaleString("en-US")}`, `Total Bayar Rp. ${sub.toLocaleString("en-US")}`, `Total Roll-an:   ${n * 25}.00 Kg (${n})`);
  return P.parseKnittoInvoice(lines.join("\n"), `${no}.YOGI01.MANUAL.pdf`);
}
const batches = [mkInvoice("OH010826001", 1, 13), mkInvoice("OH010826002", 14, 26), mkInvoice("OH010826003", 27, 39)];
for (const bi of batches) {
  assert.ok(P.validateInvoice(bi).every((c) => c.ok));
  const cs = M.poColorsFromPo(poBig);
  const mp = M.autoMap(bi, cs, {});
  const e = M.evaluateMapping(bi, mp, cs);
  assert.ok(e.ok, JSON.stringify(e.issues));
  const d = M.buildPvDraft(bi, mp, poBig);
  for (const c of d.colorEntries) poBig.invoicedByColor[`${c.warna}|${c.lengan}`] = (poBig.invoicedByColor[`${c.warna}|${c.lengan}`] ?? 0) + c.rolls.length;
}
const csAfter = M.poColorsFromPo(poBig);
const left = csAfter.filter((c) => c.remaining > 0);
assert.equal(left.length, 1);
assert.equal(left[0].warna, "WARNA40 24S");
assert.equal(left[0].remaining, 2);
console.log("invoice bertahap (39 dari 40 warna -> sisa WARNA40): OK");

// invoice yang melebihi sisa PO -> ditolak dengan alasan jelas
const dup = mkInvoice("OH010826004", 1, 1); // WARNA01 sudah penuh
const csD = M.poColorsFromPo(poBig);
const mD = M.autoMap(dup, csD, {});
const eD = M.evaluateMapping(dup, mD, csD);
assert.ok(!eD.ok && eD.issues.some((i) => /sisa|teralokasi|dipetakan/i.test(i.message)), JSON.stringify(eD.issues));
console.log("warna sudah penuh ditolak: OK");

// warna di invoice yang tidak ada di PO -> tidak boleh hilang diam-diam
const alien = P.parseKnittoInvoice(["No Penjualan :OH010826005", "COMBED 24S - UNGU LANGKA", "25 KG    100,000   2,500,000", "SUBTOTAL: Rp 2,500,000", "Total Bayar Rp. 2,500,000", "Total Roll-an:   25 Kg (1)"].join("\n"), "OH010826005.YOGI01.MANUAL.pdf");
const mA = M.autoMap(alien, csD, {});
assert.equal(mA[0].alloc.length, 0);
assert.ok(!M.evaluateMapping(alien, mA, csD).ok);
console.log("warna tak dikenal diblokir: OK");

// ---------- 5. Cek silang konteks ----------
assert.ok(M.tujuanMatchesVendor("YOGI01", { key: "GI-01", name: "YOGI 01" }));
assert.ok(M.tujuanMatchesVendor("gi-01", { key: "GI-01", name: "YOGI 01" }));
assert.ok(!M.tujuanMatchesVendor("BAYU", { key: "GI-01", name: "YOGI 01" }));
const existing = [{ id: "INV-1", poId: "PO-1", supplier: "KNITTO", noInvoiceVendor: "OH300726111" }];
assert.equal(M.findDuplicateInvoices("oh300726111", "KNITTO", existing).length, 1);
assert.equal(M.findDuplicateInvoices("OH300726999", "KNITTO", existing).length, 0);
console.log("cek silang tujuan & duplikat: OK");

fs.rmSync(out, { recursive: true, force: true });
console.log("\nSEMUA UJI LULUS");
