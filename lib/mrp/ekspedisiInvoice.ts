import { ekspedisiPrice } from "./derive";
import type { EkspedisiRateRow } from "./masterData";
import type { DeliveryKoli, EkspedisiInvoice, EkspedisiInvoiceStatus } from "./types";

/** Invoice Ekspedisi (migration 0088): satu resi = satu baris. Kunci resi = `resiGroupId`, atau id koli untuk koli lama tanpa grup resi
 *  (konvensi yang sama dipakai seluruh app, lihat `resiKeyFor` di halaman Pengiriman). */
export const EKSPEDISI_NOTA_KIND = "EKSPEDISI_NOTA";
export const EKSPEDISI_BUKTI_KIND = "EKSPEDISI_BUKTI";

export type EkspedisiResiGroup = {
  /** Kunci resi: resiGroupId ?? id koli. */
  key: string;
  mrpId: string;
  vendorProduksi: string;
  ekspedisi: string;
  /** No resi saat ini (sudah termasuk penyesuaian Procurement). */
  noResi: string;
  koliIds: string[];
  noKolis: string[];
  /** Koli pertama grup, dipakai untuk membuka lampiran ekspedisi dari vendor. */
  firstKoliId: string;
  hasVendorPhoto: boolean;
  tanggalKirim?: string;
  beratResi: number;
  /** Estimasi ongkir dari tarif per kg Master Data x berat resi (0 kalau ekspedisi tidak ada di Master Data). */
  estimasiMaster: number;
  tarifMasterPerKg: number;
  invoice?: EkspedisiInvoice;
};

/** Ekspedisi yang tidak menimbulkan biaya (mis. pengiriman internal vendor MKS) tidak perlu invoice ekspedisi. */
export function isEkspedisiBerbiaya(ekspedisi: string): boolean {
  return !!ekspedisi && !/^pengiriman internal/i.test(ekspedisi.trim());
}

/** Semua resi yang sudah terkirim (Delivery) dan berbiaya, satu baris per resi, terbaru di atas. */
export function ekspedisiResiGroups(kolis: DeliveryKoli[], rates: EkspedisiRateRow[]): EkspedisiResiGroup[] {
  const byKey = new Map<string, DeliveryKoli[]>();
  for (const k of kolis) {
    if (!k.deliveredAt || !isEkspedisiBerbiaya(k.ekspedisi)) continue;
    const key = k.resiGroupId ?? k.id;
    const list = byKey.get(key);
    if (list) list.push(k);
    else byKey.set(key, [k]);
  }
  const rows: EkspedisiResiGroup[] = [];
  for (const [key, members] of byKey) {
    const first = members[0];
    const beratResi = members.reduce((s, k) => s + (k.beratKoli ?? 0), 0);
    const rate = rates.find((r) => r.nama === first.ekspedisi);
    rows.push({
      key,
      mrpId: first.mrpId,
      vendorProduksi: first.vendorProduksi,
      ekspedisi: first.ekspedisi,
      noResi: first.noResi ?? "",
      koliIds: members.map((k) => k.id),
      noKolis: members.map((k) => k.noKoli || k.id),
      firstKoliId: first.id,
      hasVendorPhoto: members.some((k) => !!k.ekspedisiNoteAt),
      tanggalKirim: first.deliveredAt,
      beratResi,
      estimasiMaster: ekspedisiPrice(first.ekspedisi, beratResi, rates),
      tarifMasterPerKg: rate?.pricePerKg ?? 0,
      invoice: first.ekspedisiInvoice,
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
