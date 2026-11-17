import { mrpDetailFor } from "@/lib/mrp/derive";
import { aduanRowsOfPo } from "@/lib/mrp/exportPoExcel";
import type { MrpDetail } from "@/lib/mrp/store";
import type { Lengan, MaklonPO } from "@/lib/mrp/types";

/** Kategori produk satu warna·lengan di satu MRP, untuk kolom dan filter Kategori di modul Produksi.
 *  Memakai kategori grup lengannya (mis. "COMBED 24S", "COMBED 30S", "KIDS 24S", "TUNIK 24S", "PANJANG + RIB"). Kalau grupnya tidak
 *  ketemu: dari akhiran nama warna (" KID" -> "KIDS", " RIB", " TUNIK"), lalu kategori MRP-nya. */
export function itemKategoriLabel(mrpId: string, warna: string, lengan: Lengan, mrpDetails: MrpDetail[]): string {
  const detail = mrpDetailFor(mrpId, mrpDetails);
  const fromGroup = detail?.lenganGroups.find((g) => g.warna === warna && g.lengan === lengan)?.kategori?.trim();
  if (fromGroup) return fromGroup.toUpperCase();
  if (/\sKIDS?$/i.test(warna)) return "KIDS";
  if (/\sRIB$/i.test(warna)) return "RIB";
  if (/\sTUNIK$/i.test(warna)) return "TUNIK";
  return detail?.mrp.kategori?.trim().toUpperCase() || "—";
}

/** Kategori produk dari id baris Aduan Pola (lewat warna·lengan barisnya). */
export function aduanKategoriLabel(mrpId: string, aduanRowId: string | undefined, mrpDetails: MrpDetail[]): string {
  const a = mrpDetailFor(mrpId, mrpDetails)?.aduanRows.find((x) => x.id === aduanRowId);
  return a ? itemKategoriLabel(mrpId, a.warna, a.lengan, mrpDetails) : "—";
}

/** No. Order (id PO Produksi) yang memuat satu baris Aduan Pola. MRP + vendor dengan satu PO: id PO itu. Dengan PO awal + susulan (-2):
 *  PO yang memuat warna·lengan itu (aturan pembagian yang sama dengan Form Rasio dan PO Approval). "—" kalau vendor belum punya PO. */
export function poIdForAduan(mrpId: string, vendor: string, aduanRowId: string | undefined, mrpDetails: MrpDetail[], maklonPOs: MaklonPO[]): string {
  const pos = maklonPOs.filter((p) => !p.isFob && p.mrpId === mrpId && p.vendorProduksi === vendor);
  if (pos.length === 0) return "—";
  if (pos.length === 1) return pos[0].id;
  const detail = mrpDetailFor(mrpId, mrpDetails);
  const hit = pos.find((p) => aduanRowsOfPo(detail, p, maklonPOs).some((a) => a.id === aduanRowId));
  return (hit ?? pos[0]).id;
}

/** Kunci warna|lengan yang dikerjakan satu PO. null = PO ini satu-satunya PO vendor di MRP itu (semua warna vendor milik PO ini). */
export function poOwnGroupKeys(po: MaklonPO, mrpDetails: MrpDetail[], maklonPOs: MaklonPO[]): Set<string> | null {
  const same = maklonPOs.filter((p) => !p.isFob && p.mrpId === po.mrpId && p.vendorProduksi === po.vendorProduksi);
  if (po.isFob || same.length < 2) return null;
  return new Set(aduanRowsOfPo(mrpDetailFor(po.mrpId, mrpDetails), po, maklonPOs).map((a) => a.warna + "|" + a.lengan));
}
