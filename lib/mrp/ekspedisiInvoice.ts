import { ekspedisiPrice, isEkspedisiBerbiaya } from "./derive";

export { isEkspedisiBerbiaya };
import type { EkspedisiRateRow } from "./masterData";
import type { DeliveryKoli, EkspedisiInvoice, EkspedisiInvoiceStatus } from "./types";

/** Invoice Ekspedisi (migration 0088): satu RESI = satu baris. Kunci resi dasar = `resiGroupId`, atau id koli untuk koli lama tanpa grup resi (konvensi yang sama dipakai
 *  seluruh app, lihat `resiKeyFor` di halaman Pengiriman).
 *
 *  Satu resi fisik kadang dicatat vendor sebagai beberapa pengiriman (beberapa kali "Set Ekspedisi & Resi" dengan nomor resi yang sama), sehingga ada beberapa grup resi
 *  bernomor sama. Di sini grup-grup itu DIGABUNG jadi satu baris (kunci: vendor + ekspedisi + no resi), supaya nota ekspedisi yang satu bisa divalidasi sebagai satu data.
 *  Grup yang invoice-nya sudah diajukan/dibayar tidak ikut digabung (sudah terkunci sebagai invoice sendiri). */
export const EKSPEDISI_NOTA_KIND = "EKSPEDISI_NOTA";
export const EKSPEDISI_BUKTI_KIND = "EKSPEDISI_BUKTI";

export type EkspedisiResiGroup = {
  /** Kunci utama baris/invoice: `invoice.groupKey` kalau invoice gabungan, kalau tidak kunci resi dasar (untuk baris gabungan yang belum divalidasi: kunci terkecil). */
  key: string;
  /** Kunci resi dasar SEMUA grup resi vendor yang tercakup baris ini (lebih dari satu = gabungan). Dikirim ke server saat menyimpan. */
  keys: string[];
  mrpId: string;
  /** Semua MRP yang tercakup (satu resi bisa memuat koli beberapa MRP). */
  mrpIds: string[];
  vendorProduksi: string;
  ekspedisi: string;
  /** No resi saat ini (sudah termasuk penyesuaian Procurement). */
  noResi: string;
  koliIds: string[];
  noKolis: string[];
  /** Koli-koli resi ini (lengkap dengan isinya), untuk rincian koli dan popup isi koli. */
  kolis: DeliveryKoli[];
  /** Satu id koli per grup resi vendor yang punya lampiran foto resi dari vendor (dipakai membuka lampiran). */
  photoKoliIds: string[];
  /** Tanggal kirim paling awal dan paling akhir (beda kalau gabungan dari beberapa pengiriman). */
  tanggalKirim?: string;
  tanggalKirimAkhir?: string;
  beratResi: number;
  /** Estimasi ongkir dari tarif per kg Master Data x berat resi (0 kalau ekspedisi tidak ada di Master Data). */
  estimasiMaster: number;
  tarifMasterPerKg: number;
  invoice?: EkspedisiInvoice;
  /** Total biaya yang sebelumnya divalidasi terpisah per pengiriman (sebelum pengiriman bernomor sama digabung); akan diganti satu invoice gabungan saat disimpan. */
  staleBiaya?: number;
};

/** `isEkspedisiBerbiaya` (ekspedisi yang tidak menimbulkan biaya, mis. pengiriman internal vendor MKS, tidak perlu invoice ekspedisi) kini ada di derive.ts
 *  supaya gate Bongkar Koli memakai aturan yang sama; diekspor ulang di atas agar impor lama tetap jalan. */

/** Kunci resi dasar sebuah koli. */
export function ekspedisiBaseKey(k: DeliveryKoli): string {
  return k.resiGroupId ?? k.id;
}

/** Kunci penggabungan pengiriman bernomor resi sama: vendor + ekspedisi + no resi (tanpa beda huruf besar/kecil dan spasi). Kosong kalau no resi kosong (tidak digabung). */
function mergeKeyOf(k: DeliveryKoli): string | null {
  const resi = (k.noResi ?? "").trim().toUpperCase();
  return resi ? `${k.vendorProduksi}|${k.ekspedisi}|${resi}` : null;
}

/** Semua resi yang sudah terkirim (Delivery) dan berbiaya, satu baris per resi (pengiriman bernomor sama digabung), terbaru di atas. */
export function ekspedisiResiGroups(kolis: DeliveryKoli[], rates: EkspedisiRateRow[]): EkspedisiResiGroup[] {
  const eligible = kolis.filter((k) => k.deliveredAt && isEkspedisiBerbiaya(k.ekspedisi));

  // 1) Kelompokkan per grup resi dasar.
  const byBase = new Map<string, DeliveryKoli[]>();
  for (const k of eligible) {
    const key = ekspedisiBaseKey(k);
    const list = byBase.get(key);
    if (list) list.push(k);
    else byBase.set(key, [k]);
  }

  // 2) Gabungkan grup dasar menjadi baris: yang sudah punya invoice ikut kunci invoice-nya (groupKey bila gabungan), yang diajukan/dibayar berdiri sendiri,
  //    sisanya (belum divalidasi atau masih tervalidasi sendiri-sendiri) digabung menurut vendor + ekspedisi + no resi.
  const rowMembers = new Map<string, { baseKeys: string[]; kolis: DeliveryKoli[] }>();
  const add = (rowKey: string, baseKey: string, members: DeliveryKoli[]) => {
    const row = rowMembers.get(rowKey);
    if (row) {
      row.baseKeys.push(baseKey);
      row.kolis.push(...members);
    } else rowMembers.set(rowKey, { baseKeys: [baseKey], kolis: [...members] });
  };
  const pending = new Map<string, { baseKey: string; members: DeliveryKoli[] }[]>();
  for (const [baseKey, members] of byBase) {
    const inv = members[0].ekspedisiInvoice;
    if (inv?.groupKey) add(`inv:${inv.groupKey}`, baseKey, members);
    else if (inv && inv.status !== "DRAFT") add(`inv:${baseKey}`, baseKey, members);
    else {
      const mk = mergeKeyOf(members[0]);
      const rowKey = mk ? `merge:${mk}` : `inv:${baseKey}`;
      const list = pending.get(rowKey);
      if (list) list.push({ baseKey, members });
      else pending.set(rowKey, [{ baseKey, members }]);
    }
  }
  for (const [rowKey, parts] of pending) for (const p of parts) add(rowKey, p.baseKey, p.members);

  const rows: EkspedisiResiGroup[] = [];
  for (const [rowKey, row] of rowMembers) {
    const baseKeys = Array.from(new Set(row.baseKeys)).sort();
    const first = row.kolis[0];
    // Invoice baris ini: invoice gabungan (groupKey) atau invoice satu grup. Kalau baris menggabungkan beberapa pengiriman yang MASING-MASING sudah divalidasi terpisah
    // (sebelum digabung), angka lamanya hanya untuk sebagian koli, jadi tidak dianggap invoice baris ini; totalnya ditampilkan sebagai `staleBiaya` dan diganti saat disimpan.
    const found = row.kolis.find((k) => k.ekspedisiInvoice)?.ekspedisiInvoice;
    const groupKeyed = row.kolis.some((k) => k.ekspedisiInvoice?.groupKey);
    const inv = baseKeys.length > 1 && !groupKeyed ? undefined : found;
    const staleBiaya =
      baseKeys.length > 1 && !groupKeyed
        ? baseKeys.reduce((s, bk) => s + (byBase.get(bk)?.[0].ekspedisiInvoice?.biaya ?? 0), 0) || undefined
        : undefined;
    const key = rowKey.startsWith("inv:") ? rowKey.slice(4) : baseKeys[0];
    const beratResi = row.kolis.reduce((s, k) => s + (k.beratKoli ?? 0), 0);
    const rate = rates.find((r) => r.nama === first.ekspedisi);
    const dates = row.kolis.map((k) => k.deliveredAt ?? "").filter(Boolean).sort();
    // Satu id koli per grup dasar yang punya foto resi (foto disalin ke semua koli satu grup).
    const photoKoliIds = baseKeys.flatMap((bk) => {
      const withPhoto = (byBase.get(bk) ?? []).find((k) => !!k.ekspedisiNoteAt);
      return withPhoto ? [withPhoto.id] : [];
    });
    rows.push({
      key,
      keys: baseKeys,
      mrpId: first.mrpId,
      mrpIds: Array.from(new Set(row.kolis.map((k) => k.mrpId))),
      vendorProduksi: first.vendorProduksi,
      ekspedisi: first.ekspedisi,
      noResi: inv?.noResi ?? first.noResi ?? "",
      koliIds: row.kolis.map((k) => k.id),
      noKolis: row.kolis.map((k) => k.noKoli || k.id),
      kolis: row.kolis,
      photoKoliIds,
      tanggalKirim: dates[0],
      tanggalKirimAkhir: dates[dates.length - 1] !== dates[0] ? dates[dates.length - 1] : undefined,
      beratResi,
      estimasiMaster: ekspedisiPrice(first.ekspedisi, beratResi, rates),
      tarifMasterPerKg: rate?.pricePerKg ?? 0,
      invoice: inv,
      staleBiaya,
    });
  }
  return rows.sort((a, b) => (b.tanggalKirim ?? "").localeCompare(a.tanggalKirim ?? "") || b.key.localeCompare(a.key));
}

export function ekspedisiInvoiceBadge(status: EkspedisiInvoiceStatus | undefined): { label: string; tone: "neutral" | "info" | "warning" | "success" } {
  if (status === "PAID") return { label: "LUNAS", tone: "success" };
  if (status === "SUBMITTED") return { label: "DIAJUKAN KE FINANCE", tone: "warning" };
  if (status === "DRAFT") return { label: "TERVALIDASI", tone: "info" };
  return { label: "BELUM DIVALIDASI", tone: "neutral" };
}

/** Procurement: resi yang masih perlu diproses (belum divalidasi, atau sudah divalidasi tetapi belum diajukan). */
export function countEkspedisiToProcess(kolis: DeliveryKoli[], rates: EkspedisiRateRow[]): number {
  return ekspedisiResiGroups(kolis, rates).filter((g) => !g.invoice || g.invoice.status === "DRAFT").length;
}

/** Finance: invoice ekspedisi yang sudah diajukan dan menunggu dibayar. */
export function countEkspedisiReadyToPay(kolis: DeliveryKoli[], rates: EkspedisiRateRow[]): number {
  return ekspedisiResiGroups(kolis, rates).filter((g) => g.invoice?.status === "SUBMITTED").length;
}
