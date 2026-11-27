import { createHash } from "node:crypto";

/** [refresh-per-bagian 2026-11-20] Penanda isi per "bagian" snapshot (satu bagian = satu field FlowState: `productionBatches`, `invoices`, dst.).
 *
 *  Masalah yang diselesaikan: setiap aksi tulis memicu pengambilan ulang SELURUH snapshot (~10 MB), padahal biasanya hanya 1-2 bagian yang berubah. Server tetap
 *  membaca dan menyusun seluruh data (satu putaran database), tetapi hanya MENGIRIM bagian yang isinya beda dari yang sudah dipegang browser. Browser mengganti
 *  hanya bagian itu, jadi bagian lain tetap objek yang sama (turunan `derive.ts` yang bergantung padanya tidak perlu dihitung ulang) dan muatan balasan menciut.
 *
 *  Penanda = hash isi bagian yang SUDAH melewati pemotongan per vendor / pembuangan nama pelaku, jadi kalau sesi browser berganti (vendor lain, sysadmin) isinya
 *  otomatis beda dan bagian itu dikirim lagi -- tidak mungkin ada data vendor A tertinggal di browser vendor B. Tanpa migration database. */
export type SliceTokens = Record<string, string>;

/** Field FlowState yang berisi data server. `hydrated` dan `busy` adalah penanda lokal browser. */
const LOCAL_ONLY_KEYS = new Set(["hydrated", "busy"]);

export function hashSlice(value: unknown): string {
  // JSON.stringify(undefined) = undefined; bagian tanpa nilai tidak ada di data server, tapi jaga-jaga supaya tidak melempar.
  return createHash("sha1")
    .update(JSON.stringify(value) ?? "null")
    .digest("base64url");
}

/** Bagian-bagian `state` yang BERBEDA dari penanda yang dipegang browser (`clientTokens`), plus penanda terbaru SEMUA bagian yang ada di `state`.
 *  `clientTokens` kosong/tidak valid = kirim semuanya. Bagian yang tidak ada di `state` (mis. master harga yang memang dilewati) tidak disentuh sama sekali. */
export function diffSlices<T extends Record<string, unknown>>(state: T, clientTokens: unknown): { changed: Partial<T>; tokens: SliceTokens; sentKeys: string[]; omittedKeys: string[] } {
  const known: SliceTokens = {};
  if (clientTokens && typeof clientTokens === "object" && !Array.isArray(clientTokens)) {
    for (const [k, v] of Object.entries(clientTokens as Record<string, unknown>)) if (typeof v === "string") known[k] = v;
  }
  const changed: Partial<T> = {};
  const tokens: SliceTokens = {};
  const sentKeys: string[] = [];
  const omittedKeys: string[] = [];
  for (const key of Object.keys(state)) {
    if (LOCAL_ONLY_KEYS.has(key)) continue;
    const token = hashSlice(state[key]);
    tokens[key] = token;
    if (known[key] === token) {
      omittedKeys.push(key);
    } else {
      (changed as Record<string, unknown>)[key] = state[key];
      sentKeys.push(key);
    }
  }
  return { changed, tokens, sentKeys, omittedKeys };
}
