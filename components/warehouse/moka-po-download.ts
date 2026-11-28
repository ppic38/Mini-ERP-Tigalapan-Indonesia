import { alertDialog } from "@/components/ui/confirm-dialog";
import { buildMokaPoCsv, downloadCsv, type MokaPoItem } from "@/lib/mrp/exportMokaPo";
import { downloadMokaPoExcel } from "@/lib/mrp/exportMokaHppExcel";
import { skuWarnaFor, warnaWithUsia, localDateString, type WarehouseReceivableGroup } from "@/lib/mrp/derive";
import type { ItemSellingPriceRow } from "@/lib/mrp/masterData";

/** Download PO (owner 2026-11-10): isi template Moka "Import - Items Purchase Order" dari resi terpilih. Item digabung per Item (MOKA) (qty dijumlah, HPP rata-rata tertimbang); reject tidak ikut (tanpa HPP).
 *  Dipakai tombol Download PO di kepala tabel (pilih resi) dan di rincian satu resi (pilih koli, owner 2026-11-16: grup diberi `items` yang sudah disaring ke koli terpilih).
 *  `fileTag` (opsional) disisipkan di nama file, mis. "12461-Koli-7-8" -> PO-Moka-12461-Koli-7-8-2026-11-16.csv. */
export async function runMokaPoDownload(
  itemSellingPrices: ItemSellingPriceRow[],
  selected: WarehouseReceivableGroup[],
  supplierEmail: string,
  templateText: string,
  fileTag?: string
): Promise<void> {
  try {
    const skuByKey = new Map<string, { sku: string | null; itemName: string }>();
    for (const r of itemSellingPrices) {
      const key = `${r.warna}|${r.lengan}|${r.size}`;
      if (!skuByKey.has(key)) skuByKey.set(key, { sku: r.sku, itemName: r.itemName });
    }
    const acc = new Map<string, MokaPoItem & { nilai: number; qtyCost: number }>();
    for (const g of selected) {
      for (const it of g.items) {
        if (it.kind === "REJECT") continue;
        const warna = warnaWithUsia(it.warna, it.usia);
        const skuWarna = skuWarnaFor(it.warna, it.usia);
        const itemMoka = `${skuWarna} ${it.lengan === "PENDEK" ? "PDK" : "PJG"} ${it.size}`;
        const master = skuByKey.get(`${warna}|${it.lengan}|${it.size}`) ?? skuByKey.get(`${skuWarna}|${it.lengan}|${it.size}`);
        // Item RIB di Moka tidak memuat PDK/PJG ("BENHUR KID + RIB XS", "HITAM + RIB L"): cadangan pencocokan tanpa lengan.
        const alt = skuWarna.includes("+ RIB") ? [`${skuWarna} ${it.size}`] : undefined;
        const cur = acc.get(itemMoka) ?? { itemMoka, itemName: master?.itemName ?? null, alt, sku: master?.sku ?? null, qty: 0, hppPerItem: null, nilai: 0, qtyCost: 0, lengan: it.lengan, size: it.size };
        cur.qty += it.qty;
        if (it.hppPerItem > 0) {
          cur.nilai += it.qty * it.hppPerItem;
          cur.qtyCost += it.qty;
        }
        acc.set(itemMoka, cur);
      }
    }
    const items: MokaPoItem[] = Array.from(acc.values()).map((x) => ({ itemMoka: x.itemMoka, itemName: x.itemName, alt: x.alt, sku: x.sku, qty: x.qty, hppPerItem: x.qtyCost > 0 ? x.nilai / x.qtyCost : null, lengan: x.lengan, size: x.size }));
    const res = buildMokaPoCsv(templateText, supplierEmail, items);
    if (res.error) {
      await alertDialog({ title: "Template tidak bisa dipakai", message: res.error, tone: "danger" });
      return;
    }
    if (res.filledRows === 0) {
      await alertDialog({ title: "Tidak ada item yang cocok", message: "Tidak satu pun item pilihan ditemukan di template Moka (dicocokkan lewat kolom Items Name), jadi file tidak dibuat.", tone: "danger" });
      return;
    }
    const tag = fileTag ? fileTag.replace(/[^A-Za-z0-9_-]+/g, "_") + "-" : "";
    // SATU file Excel dua sheet (owner 2026-11-28): sheet 1 "PO Moka" = isi template Moka yang sudah terisi, sheet 2 "HPP" = format template "HPP BY41 REG"
    // (hanya item yang terisi, kolom ITEM dan COGS). CSV tidak lagi diunduh terpisah; kalau Moka butuh CSV, simpan sheet 1 sebagai CSV dari Excel.
    // Cadangan: kalau pembuatan xlsx gagal, CSV Moka tetap diunduh supaya pekerjaan tidak terhenti.
    const baseName = `PO-Moka-${tag}${localDateString(new Date())}`;
    try {
      await downloadMokaPoExcel(res.csv, res.filledItems, `${baseName}.xlsx`);
    } catch (e) {
      console.error("Gagal membuat file Excel PO, mengunduh CSV sebagai cadangan", e);
      downloadCsv(res.csv, `${baseName}.csv`);
    }
    const list = (xs: MokaPoItem[]) => Array.from(new Set(xs.map((x) => x.itemMoka))).slice(0, 12).join(", ");
    const warnings: string[] = [];
    if (res.notFound.length > 0) warnings.push(`${res.notFound.length} item tidak ditemukan di template Moka dan TIDAK ikut file: ${list(res.notFound)}${res.notFound.length > 12 ? ", …" : ""}.`);
    if (res.noCost.length > 0) warnings.push(`${res.noCost.length} item belum punya HPP, kolom Unit Cost dikosongkan: ${list(res.noCost)}${res.noCost.length > 12 ? ", …" : ""}.`);
    if (warnings.length > 0) {
      await alertDialog({ title: `File PO dibuat (${res.filledRows} item, ${res.filledQty.toLocaleString("id-ID")} pcs)`, message: warnings.join("\n\n") });
    }
  } catch (e) {
    await alertDialog({ title: "Gagal membuat file PO", message: e instanceof Error ? e.message : "Terjadi kesalahan saat membuat file PO.", tone: "danger" });
  }
}
