import { createSign } from "node:crypto";

/** Penulis data resi ke Google Sheets WOS (tab ERP_INCOMING) -- owner 2026-11-05.
 *  ERP login sebagai AKUN LAYANAN Google (spreadsheet dibagikan ke emailnya sebagai Editor) lalu menambah atau menimpa baris lewat Sheets API.
 *  Tanpa Apps Script, tanpa token yang dibagikan partner, dan tanpa mengubah repo WOS. Satu baris = satu koli di satu resi, kunci `id` =
 *  `{id resi}|{id koli}` sehingga kiriman ulang menimpa barisnya (tidak dobel). Yang ditimpa hanya kolom milik ERP; kolom lain di tab itu
 *  (mis. status yang nanti diisi WOS di sebelah kanan) TIDAK disentuh. Env: WOS_SHEETS_ID, GOOGLE_SA_EMAIL, GOOGLE_SA_PRIVATE_KEY, opsional WOS_SHEETS_TAB. */

export const SHEET_HEADERS = ["id", "waktu_server", "tanggal", "resi_group", "resi", "ekspedisi", "vendor", "mrp", "no_koli", "koli_erp", "items", "qty", "hpp_total", "catatan"] as const;
type Header = (typeof SHEET_HEADERS)[number];

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/spreadsheets";
const API_TIMEOUT_MS = 15000;

export type SheetsConfig = { spreadsheetId: string; email: string; privateKey: string; tab: string };

export function sheetsConfig(): SheetsConfig | null {
  const spreadsheetId = process.env.WOS_SHEETS_ID?.trim();
  const email = process.env.GOOGLE_SA_EMAIL?.trim();
  let privateKey = process.env.GOOGLE_SA_PRIVATE_KEY?.trim();
  if (!spreadsheetId || !email || !privateKey) return null;
  // Kunci dari file JSON sering ditempel dengan tanda kutip dan "\n" harfiah.
  privateKey = privateKey.replace(/^["']|["']$/g, "").replace(/\\n/g, "\n");
  return { spreadsheetId, email, privateKey, tab: process.env.WOS_SHEETS_TAB?.trim() || "ERP_INCOMING" };
}

/** Bentuk minimal data resi yang dibutuhkan penulis (kompatibel dengan ResiPayload di wosPush.ts). */
export type SheetResi = {
  resi: { resiGroupId: string; resiNo: string; expedition: string; note: string; shippingDate: string; vendor: { name: string } };
  kolis: {
    koliId: string;
    koliNo: string;
    mrpNo: string;
    items: { color: string; sleeve: string; size: string; qty: number; kind: string; age: string | null; itemName?: string | null; hppPerItem?: number | null; hppEstimate?: boolean }[];
  }[];
};

type SheetItem = SheetResi["kolis"][number]["items"][number];

/** "NAMA ITEM xQTY @HPP; NAMA ITEM xQTY @HPP": nama dari Master SKU (item_name); item yang sama dalam satu koli dijumlahkan (HPP = rata-rata
 *  tertimbang qty). `@HPP` = HPP per pcs dalam rupiah (bilangan bulat); akhiran `~` = masih estimasi (roll belum ditutup atau invoice vendor
 *  belum ada). Item tanpa HPP yang bisa ditelusuri tidak memuat `@`. Pola baca: /^(.*) x(\d+)(?: @(\d+)(~)?)?$/ per bagian yang dipisah "; ". */
export function itemsText(items: SheetItem[]): string {
  const merged = new Map<string, { label: string; qty: number; hppQty: number; hppSum: number; estimate: boolean }>();
  for (const it of items) {
    const name = it.itemName?.trim() || `${it.color} ${it.sleeve === "PENDEK" ? "PDK" : it.sleeve === "PANJANG" ? "PJG" : it.sleeve} ${it.size}`;
    const label = name + (it.kind === "REWORK" ? " (rework)" : "") + (it.age ? ` [${it.age}]` : "");
    const m = merged.get(label) ?? { label, qty: 0, hppQty: 0, hppSum: 0, estimate: false };
    m.qty += it.qty;
    if (it.hppPerItem != null && it.hppPerItem > 0) {
      m.hppQty += it.qty;
      m.hppSum += it.qty * it.hppPerItem;
      if (it.hppEstimate) m.estimate = true;
    } else {
      m.estimate = true; // sebagian baris item ini tanpa HPP: rata-rata hanya dari baris yang punya, jadi tandai estimasi
    }
    merged.set(label, m);
  }
  return Array.from(merged.values())
    .map((m) => `${m.label} x${m.qty}` + (m.hppQty > 0 ? ` @${Math.round(m.hppSum / m.hppQty)}${m.estimate ? "~" : ""}` : ""))
    .join("; ");
}

/** Total HPP satu koli (rupiah, bulat): jumlah qty x HPP/pcs semua item yang HPP-nya ada; kosong kalau tidak ada satu pun. */
export function koliHppTotal(items: SheetItem[]): string {
  let total = 0;
  let any = false;
  for (const it of items) {
    if (it.hppPerItem != null && it.hppPerItem > 0) {
      total += it.qty * it.hppPerItem;
      any = true;
    }
  }
  return any ? String(Math.round(total)) : "";
}

/** Waktu WITA "yyyy-MM-dd HH:mm:ss" (sama dengan kolom waktu_server yang diisi Apps Script WOS). */
export function witaNow(d: Date = new Date()): string {
  return d.toLocaleString("sv-SE", { timeZone: "Asia/Makassar" });
}

/** Satu baris per koli, dikunci menurut nama kolom. HPP (per item di `items`, total di `hpp_total`) hanya terisi kalau datanya dibawa payload. */
export function buildSheetRows(p: SheetResi, nowText: string): Record<Header, string>[] {
  return p.kolis.map((k) => ({
    id: `${p.resi.resiGroupId}|${k.koliId}`,
    waktu_server: nowText,
    tanggal: p.resi.shippingDate,
    resi_group: p.resi.resiGroupId,
    resi: p.resi.resiNo,
    ekspedisi: p.resi.expedition,
    vendor: p.resi.vendor.name,
    mrp: k.mrpNo,
    no_koli: k.koliNo,
    koli_erp: k.koliId,
    items: itemsText(k.items),
    qty: String(k.items.reduce((s, i) => s + i.qty, 0)),
    hpp_total: koliHppTotal(k.items),
    catatan: p.resi.note,
  }));
}

export function colLetter(index: number): string {
  let n = index + 1;
  let out = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    out = String.fromCharCode(65 + r) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

function b64url(input: string | Buffer): string {
  return Buffer.from(input).toString("base64url");
}

let cachedToken: { token: string; exp: number; key: string } | null = null;

async function accessToken(cfg: SheetsConfig): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && cachedToken.key === cfg.email && cachedToken.exp - 60 > now) return cachedToken.token;
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(JSON.stringify({ iss: cfg.email, scope: SCOPE, aud: TOKEN_URL, iat: now, exp: now + 3600 }));
  const signature = createSign("RSA-SHA256").update(`${header}.${claims}`).sign(cfg.privateKey).toString("base64url");
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${header}.${claims}.${signature}` }).toString(),
    signal: AbortSignal.timeout(API_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Login Google gagal: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  const data = (await res.json()) as { access_token: string; expires_in?: number };
  cachedToken = { token: data.access_token, exp: now + (data.expires_in ?? 3600), key: cfg.email };
  return data.access_token;
}

async function sheetsApi<T>(cfg: SheetsConfig, token: string, path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(cfg.spreadsheetId)}/${path}`, {
    method: init.method ?? "GET",
    headers: { Authorization: `Bearer ${token}`, ...(init.body ? { "Content-Type": "application/json" } : {}) },
    body: init.body ? JSON.stringify(init.body) : undefined,
    signal: AbortSignal.timeout(API_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Google Sheets API HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return (await res.json()) as T;
}

const UPDATE_CHUNK = 400;
const APPEND_CHUNK = 500;

/** Tulis (tambah atau timpa) baris SEMUA resi di `payloads` ke tab, dengan judul dan kolom id dibaca SEKALI (aman untuk kirim ulang
 *  ratusan resi lama: hanya beberapa panggilan Google, jauh di bawah batas 60 tulis/menit). Melempar Error kalau gagal. */
export async function writeResisToSheets(cfg: SheetsConfig, payloads: SheetResi[]): Promise<{ added: number; updated: number }> {
  const rows = payloads.flatMap((p) => buildSheetRows(p, witaNow()));
  if (rows.length === 0) return { added: 0, updated: 0 };
  const token = await accessToken(cfg);
  const range = (a1: string) => encodeURIComponent(`'${cfg.tab}'!${a1}`);

  // 1) Judul kolom harus memuat semua kolom milik ERP (urutan bebas, kolom tambahan boleh ada).
  const head = await sheetsApi<{ values?: string[][] }>(cfg, token, `values/${range("1:1")}`);
  const headers = head.values?.[0] ?? [];
  const col = new Map<string, number>(headers.map((h, i) => [h.trim(), i]));
  const missing = SHEET_HEADERS.filter((h) => !col.has(h));
  if (missing.length > 0) throw new Error(`Judul kolom tab ${cfg.tab} tidak sesuai, tidak ada: ${missing.join(", ")}`);

  // 2) Baris yang sudah ada menurut kolom id.
  const idLetter = colLetter(col.get("id")!);
  const idCol = await sheetsApi<{ values?: string[][] }>(cfg, token, `values/${range(`${idLetter}2:${idLetter}`)}`);
  const rowOfId = new Map<string, number>();
  (idCol.values ?? []).forEach((r, i) => {
    if (r[0]) rowOfId.set(String(r[0]), i + 2);
  });

  const updates: { range: string; values: string[][] }[] = [];
  const appends: string[][] = [];
  const width = Math.max(headers.length, ...SHEET_HEADERS.map((h) => col.get(h)! + 1));
  for (const row of rows) {
    const existing = rowOfId.get(row.id);
    if (existing) {
      // Timpa hanya kolom milik ERP; waktu_server tetap waktu pertama ditulis, kolom lain (status WOS dst.) tidak disentuh.
      for (const h of SHEET_HEADERS) {
        if (h === "id" || h === "waktu_server") continue;
        updates.push({ range: `'${cfg.tab}'!${colLetter(col.get(h)!)}${existing}`, values: [[row[h]]] });
      }
    } else {
      const cells = new Array<string>(width).fill("");
      for (const h of SHEET_HEADERS) cells[col.get(h)!] = row[h];
      appends.push(cells);
    }
  }

  for (let i = 0; i < updates.length; i += UPDATE_CHUNK) {
    await sheetsApi(cfg, token, "values:batchUpdate", { method: "POST", body: { valueInputOption: "RAW", data: updates.slice(i, i + UPDATE_CHUNK) } });
  }
  for (let i = 0; i < appends.length; i += APPEND_CHUNK) {
    await sheetsApi(cfg, token, `values/${range("A1")}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, { method: "POST", body: { values: appends.slice(i, i + APPEND_CHUNK) } });
  }
  return { added: appends.length, updated: rows.length - appends.length };
}

/** Satu resi (dipakai pengiriman saat resi terbit). */
export function writeResiToSheets(cfg: SheetsConfig, p: SheetResi): Promise<{ added: number; updated: number }> {
  return writeResisToSheets(cfg, [p]);
}

/** Baca seluruh isi tab (baris judul + baris data) untuk ditampilkan atau diolah ERP, mis. status yang diisi WOS. */
export async function readTabRows(cfg: SheetsConfig): Promise<{ headers: string[]; rows: string[][] }> {
  const token = await accessToken(cfg);
  const res = await sheetsApi<{ values?: string[][] }>(cfg, token, `values/${encodeURIComponent(`'${cfg.tab}'!A1:AZ`)}`);
  const values = res.values ?? [];
  return { headers: values[0] ?? [], rows: values.slice(1) };
}
