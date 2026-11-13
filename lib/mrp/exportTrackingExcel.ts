import type { Workbook } from "exceljs";
import { SIZE_ORDER, targetSizesForBatch } from "./derive";
import { LT_CUTTING_KE_FG, LT_FG_KE_KIRIM, dayKey, maxDay, minDay, plusDays } from "./itemEstimates";
import { itemNameOf, lenganShort, type ItemMrpVendorRow, type ItemTrackRow } from "./itemTracking";
import { VENDOR_PRODUKSI } from "./seed";
import type { AduanPolaRow, DeliveryKoli, Lengan, MaterialPO, ProductionBatch, ProductionResult, RawMaterialInvoice } from "./types";

// Export Excel Tracking Item (PPIC/SCM): SATU sheet "WIP" mengikuti template "WIP Download" owner (2026-11-09), satu baris per ROLL x SIZE:
// Item, No. MRP, Vendor, Kategory, Warna, Size, Code Roll, Target Qty, Target (Hasil Cutting), Tgl good Receiving, Tgl Cutting, Tgl Awal FG, Qty FG, Qty WIP, Status Roll, Estimasi Tanggal Kirim, Status Roll,
// Qty Koli, No. Koli, No. Resi, Qty Delivery, Tanggal Kirim, Estimasi Tiba. (Revisi 2026-11-11: template baru owner menambah empat kolom koli di kanan; kolom "Estimasi" jadi "Estimasi Tanggal Kirim"
// dan kolom "Status" berjudul "Status Roll" juga, persis seperti template. Revisi 2026-11-13: Target (Hasil Cutting), No. Resi, dan Qty Delivery ditambahkan dan disisipkan berurutan menurut alur
// proses: hasil cutting di samping Target Qty, lalu koli -> resi -> qty delivery -> tanggal kirim -> estimasi tiba.)
// Roll x size yang isinya sudah masuk koli tampil SATU BARIS PER KOLI (Qty Koli, No. Koli, Tanggal Kirim = tanggal koli dikirim, Estimasi Tiba = tanggal kirim + 7 hari seperti ETA Excel
// pengiriman Warehouse); Target, tanggal, Qty FG dan Status Roll roll diulang di tiap baris. Qty WIP baris koli = qty koli itu yang belum dikirim (0 kalau koli sudah dikirim); sisa WIP yang
// belum masuk koli jadi baris sendiri tanpa data koli. Jumlah Qty WIP semua baris tetap sama dengan satu baris per roll x size.
// Item rework (FG hasil rework reject, tanpa roll dan tanpa target) ikut sebagai baris "(rework)" dengan Target Qty 0. Mengikuti filter layar (MRP, vendor, kategori, warna, lengan, size).
// Baris PERENCANAAN MRP (owner 2026-11-13, header template TIDAK berubah): target aduan yang belum punya roll ikut diekspor sebagai TOTALAN tanpa Code Roll, per MRP x vendor x warna x lengan x size,
// supaya terlihat apakah bahannya sudah dibeli atau belum. Status Roll: "Belum PO" (belum ada PO Material) atau "Belum GR" (PO Material aktif, roll belum diterima vendor). Begitu roll sudah punya
// code roll, totalan itu dipecah per code roll: roll yang sudah diterima (Good Receive) tapi belum diproses vendor jadi baris sendiri ("Sudah GR"), roll yang sudah masuk produksi memakai baris roll biasa,
// dan sisanya tetap totalan. Sisa totalan = target aduan - target roll yang sudah ada, jadi jumlah Target Qty satu grup tidak berubah saat dipecah. PO Material yang semuanya CANCELLED = baris perencanaannya hilang.
//  - Target Qty  : target roll itu per size = target aduan diprorata menurut jumlah roll (`targetSizesForBatch`, sama dengan form Cutting vendor), sudah ada sebelum roll dicutting; rework = 0.
//  - Qty FG      : hasil Finish Good roll itu (`fgSizeQty`); rework = FG hasil rework.
//  - Qty WIP     : yang belum dikirim = target (roll belum dicutting) + (hasil cutting - FG, selama roll belum ditutup) + (FG belum masuk koli) + (sudah di koli belum dikirim). Roll ditutup:
//                  selisih cutting - FG dianggap reject/kurang, bukan WIP. Reject tidak tercatat per roll, jadi roll yang belum ditutup masih menghitung reject sebagai WIP sampai ditutup.
//  - Estimasi    : estimasi tanggal kirim barang yang masih WIP (cutting + LT Cutting->FG + LT FG->kirim; FG terakhir + LT FG->kirim), sama dengan Est. Kirim di Tracking Item.
//  - Status      : posisi barang yang masih WIP, atau SUDAH DIKIRIM kalau tidak ada sisa.

const FONT = "Calibri";
const INK = "FF1A1A1F";
const HEAD_BG = "FFE5E7EB";
const LINE = "FFD3D8DF";
const thin = { style: "thin" as const, color: { argb: LINE } };
const BORDER = { top: thin, left: thin, bottom: thin, right: thin };
const FMT_DATE = "dd/mm/yyyy";
const FMT_INT = "#,##0";

const vendorName = (id: string) => VENDOR_PRODUKSI[id]?.name ?? id;
const dateOf = (iso?: string): Date | null => {
  if (!iso) return null;
  const [y, m, d] = iso.split("-").map(Number);
  return y && m && d ? new Date(Date.UTC(y, m - 1, d)) : null;
};
const sizeRank = (size: string) => {
  const i = SIZE_ORDER.indexOf(size.trim().toUpperCase());
  return i < 0 ? SIZE_ORDER.length : i;
};

export type TrackingExportInput = {
  rows: ItemTrackRow[];
  filterLabel?: string;
  /** Sumber baris per roll: roll produksi, hasil FG/rework, koli (qty sudah dikirim / di koli), dan invoice bahan (tanggal good receiving roll). */
  batches?: ProductionBatch[];
  results?: ProductionResult[];
  kolis?: DeliveryKoli[];
  invoices?: RawMaterialInvoice[];
  /** Aduan pola semua MRP: target per size per roll = target aduan dibagi menurut jumlah roll (sama seperti form Cutting vendor). */
  aduans?: AduanPolaRow[];
  /** Baris perencanaan MRP (belum ada code roll): id baris aduan -> No. MRP (jumlah roll per grup), dan PO Material (belum dibeli / sudah dipesan / dibatalkan). */
  aduanMrpIds?: Record<string, string>;
  materialPOs?: MaterialPO[];
};

export type WipRow = {
  item: string;
  mrp: string;
  vendor: string;
  kategori: string;
  warna: string;
  size: string;
  roll: string;
  target: number | null;
  grAt?: string;
  cuttingAt?: string;
  fgFirstAt?: string;
  fg: number;
  wip: number | null;
  statusRoll: string;
  estimasi?: string;
  status: string;
  /** Data koli (satu baris per koli): qty roll+size ini di koli itu, nomor koli, tanggal koli dikirim, dan estimasi tiba (kirim + 7 hari). Kosong kalau baris bukan baris koli. */
  koliQty: number | null;
  noKoli: string;
  /** Nomor resi koli itu (kosong kalau koli belum diberi resi atau baris bukan baris koli). */
  noResi: string;
  kirimAt?: string;
  tibaAt?: string;
  /** Hasil cutting AKTUAL roll x size ini (beda dari Target Qty = target aduan). Kosong kalau roll belum dicutting, baris perencanaan, atau rework. */
  cut: number | null;
  /** Qty roll x size ini di koli yang SUDAH dikirim (Delivery), per baris koli; baris tanpa koli = 0, baris perencanaan kosong. Jumlah per roll x size dibatasi
   *  tidak lebih dari Qty FG dan hasil cutting. */
  qtyDelivery: number | null;
  /** Hanya untuk urutan. */
  lengan: Lengan;
  /** Baris perencanaan MRP (totalan tanpa roll, atau roll sudah diterima tapi belum masuk produksi). Hanya untuk urutan. */
  plan?: boolean;
};

/** Hari yang ditambahkan ke tanggal kirim koli untuk estimasi tiba di DC (sama dengan ETA di Excel pengiriman Warehouse). */
const LT_KIRIM_KE_TIBA = 7;

type KoliEntry = { koliId: string; noKoli: string; noResi: string; qty: number; deliveredAt?: string };
const NO_KOLI = { koliQty: null, noKoli: "", noResi: "", kirimAt: undefined, tibaAt: undefined, qtyDelivery: 0 } as const;
const koliNo = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });

type Moved = { delivered: number; inKoli: number };

/** Posisi barang yang masih WIP dan label statusnya; dipakai baris roll dan baris rework. `cut` = hasil cutting size itu (0 kalau roll belum dicutting). */
function wipParts(target: number, hasCut: boolean, cut: number, fg: number, closed: boolean, moved: Moved) {
  const belumCutting = hasCut ? 0 : target;
  const cutting = !hasCut || closed ? 0 : Math.max(0, cut - fg);
  const fgPart = Math.max(0, fg - moved.inKoli - moved.delivered);
  const koli = moved.inKoli;
  const labels = [
    belumCutting > 0 ? "BELUM CUTTING" : "",
    cutting > 0 ? "CUTTING, BELUM FG" : "",
    fgPart > 0 ? "FG, BELUM MASUK KOLI" : "",
    koli > 0 ? "DI KOLI, BELUM DIKIRIM" : "",
  ].filter(Boolean);
  return { belumCutting, cutting, fgPart, koli, wip: belumCutting + cutting + fgPart + koli, status: labels.length > 0 ? labels.join(" + ") : moved.delivered > 0 ? "SUDAH DIKIRIM" : "TIDAK ADA HASIL CUTTING" };
}

/** Baris sheet WIP: per roll x size, lalu rework per item. */
export function wipRows(input: TrackingExportInput): WipRow[] {
  const { rows, kolis = [], batches = [], results = [], invoices = [], aduans = [], aduanMrpIds = {}, materialPOs = [] } = input;
  const cellByKey = new Map<string, ItemMrpVendorRow>(); // mrp|vendor|warna|lengan|size
  const lineScope = new Set<string>(); // mrp|vendor|warna|lengan
  for (const r of rows) {
    for (const b of r.breakdown) {
      if (!b.vendorProduksi) continue;
      cellByKey.set(`${b.mrpId}|${b.vendorProduksi}|${r.warna}|${r.lengan}|${r.size}`, b);
      lineScope.add(`${b.mrpId}|${b.vendorProduksi}|${r.warna}|${r.lengan}`);
    }
  }
  const kategoriOf = (mrp: string, vendor: string, warna: string, lengan: string) => {
    for (const [k, c] of cellByKey) if (k.startsWith(`${mrp}|${vendor}|${warna}|${lengan}|`)) return c.kategori;
    return "";
  };

  // Tanggal good receiving per roll: roll datang di invoice bahan, dicocokkan lewat code roll.
  const grByRoll = new Map<string, string>();
  for (const inv of invoices) {
    for (const arrivals of Object.values(inv.rollArrivals)) {
      for (const a of arrivals) {
        if (!a?.codeRoll) continue;
        const key = `${inv.mrpId}|${inv.destinationVendor}|${a.codeRoll}`;
        const day = minDay(grByRoll.get(key), dayKey(a.arrivedAt));
        if (day) grByRoll.set(key, day);
      }
    }
  }
  // Tanggal FG per roll x size (catatan "Roll {code}") dan FG hasil rework per item.
  const fgDates = new Map<string, { first?: string; last?: string }>();
  const reworkFg = new Map<string, { qty: number; first?: string; last?: string }>();
  for (const r of results) {
    if (r.kind !== "FG") continue;
    const day = dayKey(r.recordedAt);
    for (const [size, qty] of Object.entries(r.sizeQty)) {
      if (!(qty > 0)) continue;
      if (r.note?.startsWith("Roll ")) {
        const key = `${r.mrpId}|${r.vendorProduksi}|${r.note.slice(5).trim()}|${size}`;
        const cur = fgDates.get(key) ?? {};
        fgDates.set(key, { first: minDay(cur.first, day), last: maxDay(cur.last, day) });
      } else if (r.note?.startsWith("Rework dari")) {
        const key = `${r.mrpId}|${r.vendorProduksi}|${r.warna}|${r.lengan}|${size}`;
        const cur = reworkFg.get(key) ?? { qty: 0 };
        reworkFg.set(key, { qty: cur.qty + qty, first: minDay(cur.first, day), last: maxDay(cur.last, day) });
      }
    }
  }
  // Koli: qty yang sudah dikirim / sudah di koli belum dikirim, per roll x size (FG) dan per item (rework). Reject tidak dihitung.
  const rollMoved = new Map<string, Moved>(); // batchId|size
  const reworkMoved = new Map<string, Moved>(); // mrp|vendor|warna|lengan|size
  const rollKolis = new Map<string, KoliEntry[]>(); // batchId|size -> per koli
  const reworkKolis = new Map<string, KoliEntry[]>(); // mrp|vendor|warna|lengan|size -> per koli
  const bump = (map: Map<string, Moved>, entries: Map<string, KoliEntry[]>, key: string, k: DeliveryKoli, qty: number) => {
    const m = map.get(key) ?? { delivered: 0, inKoli: 0 };
    if (k.deliveredAt) m.delivered += qty;
    else m.inKoli += qty;
    map.set(key, m);
    const list = entries.get(key) ?? [];
    const e = list.find((x) => x.koliId === k.id);
    if (e) e.qty += qty;
    else list.push({ koliId: k.id, noKoli: k.noKoli, noResi: k.noResi ?? "", qty, deliveredAt: dayKey(k.deliveredAt) });
    entries.set(key, list);
  };
  for (const k of kolis) {
    for (const it of k.items) {
      if (it.kind === "REJECT" || it.qty <= 0) continue;
      if (it.kind === "REWORK") bump(reworkMoved, reworkKolis, `${k.mrpId}|${k.vendorProduksi}|${it.warna}|${it.lengan}|${it.size}`, k, it.qty);
      else if (it.sourceBatchId) bump(rollMoved, rollKolis, `${it.sourceBatchId}|${it.size}`, k, it.qty);
    }
  }
  // Satu baris per koli (lihat catatan di atas); tanpa koli: satu baris apa adanya.
  // `cap` = batas Qty Delivery roll x size ini: tidak boleh lebih dari Qty FG dan hasil cutting (data koli yang kelebihan dipotong di sini, koli diurutkan nomor naik).
  const withKoli = (base: WipRow, p: ReturnType<typeof wipParts>, entries: KoliEntry[], koliEst: string | undefined, restEst: string | undefined, cap: number): WipRow[] => {
    if (entries.length === 0) return [base];
    const rows: WipRow[] = [];
    let capLeft = Math.max(0, cap);
    for (const e of [...entries].sort((a, b) => koliNo(a.noKoli, b.noKoli))) {
      const sent = !!e.deliveredAt;
      const delivered = sent ? Math.min(e.qty, capLeft) : 0;
      capLeft -= delivered;
      rows.push({ ...base, wip: sent ? 0 : e.qty, estimasi: sent ? undefined : koliEst, status: sent ? "SUDAH DIKIRIM" : "DI KOLI, BELUM DIKIRIM", koliQty: e.qty, noKoli: e.noKoli, noResi: e.noResi, kirimAt: e.deliveredAt, tibaAt: plusDays(e.deliveredAt, LT_KIRIM_KE_TIBA), qtyDelivery: delivered });
    }
    const restWip = p.belumCutting + p.cutting + p.fgPart;
    if (restWip > 0) {
      const labels = [p.belumCutting > 0 ? "BELUM CUTTING" : "", p.cutting > 0 ? "CUTTING, BELUM FG" : "", p.fgPart > 0 ? "FG, BELUM MASUK KOLI" : ""].filter(Boolean);
      rows.push({ ...base, wip: restWip, estimasi: restEst, status: labels.join(" + "), ...NO_KOLI });
    }
    return rows;
  };

  const out: WipRow[] = [];
  for (const b of batches) {
    if (!lineScope.has(`${b.mrpId}|${b.vendorProduksi}|${b.warna}|${b.lengan}`)) continue;
    const kategori = kategoriOf(b.mrpId, b.vendorProduksi, b.warna, b.lengan);
    const roll = b.codeRoll ?? "";
    const cuttingAt = dayKey(b.cuttingAt);
    const closed = !!b.closedAt;
    const plan = targetSizesForBatch(b, aduans);
    const hasCut = Object.keys(b.sizeQty ?? {}).length > 0 || !!b.cuttingAt;
    const allSizes = Array.from(new Set([...Object.keys(plan), ...Object.keys(b.sizeQty ?? {}), ...Object.keys(b.fgSizeQty ?? {})]));
    const sizes = allSizes.filter((sz) => cellByKey.has(`${b.mrpId}|${b.vendorProduksi}|${b.warna}|${b.lengan}|${sz}`));
    const grOf = (size: string) => grByRoll.get(`${b.mrpId}|${b.vendorProduksi}|${roll}`) ?? cellByKey.get(`${b.mrpId}|${b.vendorProduksi}|${b.warna}|${b.lengan}|${size}`)?.grAt;
    if (allSizes.length === 0) {
      // Roll tanpa aduan yang bisa dibaca dan belum ada hasil per size: satu baris tanpa size supaya roll tetap terlihat.
      out.push({
        item: `${b.warna} ${lenganShort(b.lengan)}`, mrp: b.mrpId, vendor: vendorName(b.vendorProduksi), kategori, warna: b.warna, size: "", roll, target: null, grAt: grByRoll.get(`${b.mrpId}|${b.vendorProduksi}|${roll}`),
        cuttingAt, fgFirstAt: undefined, fg: 0, wip: null, statusRoll: hasCut ? "Sudah cutting" : "Resting", estimasi: undefined, status: hasCut ? "TIDAK ADA HASIL CUTTING" : "BELUM CUTTING", ...NO_KOLI, cut: null, lengan: b.lengan,
      });
      continue;
    }
    for (const size of sizes) {
      const target = plan[size] ?? b.sizeQty?.[size] ?? 0;
      const cut = b.sizeQty?.[size] ?? 0;
      const fg = b.fgSizeQty?.[size] ?? 0;
      if (target === 0 && cut === 0 && fg === 0) continue;
      const p = wipParts(target, hasCut, cut, fg, closed, rollMoved.get(`${b.id}|${size}`) ?? { delivered: 0, inKoli: 0 });
      const fd = fgDates.get(`${b.mrpId}|${b.vendorProduksi}|${roll}|${size}`);
      const fgEst = plusDays(fd?.last ?? plusDays(cuttingAt, LT_CUTTING_KE_FG), LT_FG_KE_KIRIM);
      let est: string | undefined;
      if (p.cutting > 0) est = plusDays(plusDays(cuttingAt, LT_CUTTING_KE_FG), LT_FG_KE_KIRIM);
      if (p.fgPart > 0 || p.koli > 0) est = maxDay(est, fgEst);
      let restEst: string | undefined;
      if (p.cutting > 0) restEst = plusDays(plusDays(cuttingAt, LT_CUTTING_KE_FG), LT_FG_KE_KIRIM);
      if (p.fgPart > 0) restEst = maxDay(restEst, fgEst);
      out.push(
        ...withKoli(
          {
            item: itemNameOf(b.warna, b.lengan, size), mrp: b.mrpId, vendor: vendorName(b.vendorProduksi), kategori, warna: b.warna, size, roll, target, grAt: grOf(size), cuttingAt, fgFirstAt: fd?.first, fg,
            wip: p.wip, statusRoll: closed ? "Roll ditutup" : fg > 0 ? "FG berjalan" : hasCut ? "Sudah cutting" : "Resting", estimasi: p.wip > 0 ? est : undefined, status: p.status, ...NO_KOLI, cut: hasCut ? cut : null, lengan: b.lengan,
          },
          p,
          rollKolis.get(`${b.id}|${size}`) ?? [],
          fgEst,
          restEst,
          hasCut ? Math.min(fg, cut) : 0
        )
      );
    }
  }
  // Perencanaan MRP: target aduan yang belum punya roll (lihat catatan di atas berkas).
  const groupOf = (mrp: string, vendor: string, warna: string, lengan: string) => `${mrp}|${vendor}|${warna}|${lengan}`;
  const allocByGroup = new Map<string, Record<string, number>>();
  for (const [k, c] of cellByKey) {
    if (!(c.alokasi > 0)) continue;
    const [mrp, vendor, warna, lengan, size] = k.split("|");
    const g = groupOf(mrp, vendor, warna, lengan);
    const cur = allocByGroup.get(g) ?? {};
    cur[size] = (cur[size] ?? 0) + c.alokasi;
    allocByGroup.set(g, cur);
  }
  if (allocByGroup.size > 0) {
    const usedTarget = new Map<string, Record<string, number>>();
    const usedRolls = new Map<string, number>();
    const batchCodes = new Set<string>(); // mrp|vendor|codeRoll
    for (const b of batches) {
      if (b.codeRoll) batchCodes.add(`${b.mrpId}|${b.vendorProduksi}|${b.codeRoll}`);
      const g = groupOf(b.mrpId, b.vendorProduksi, b.warna, b.lengan);
      if (!allocByGroup.has(g)) continue;
      const plan = targetSizesForBatch(b, aduans);
      const t = Object.keys(plan).length > 0 ? plan : b.sizeQty ?? {};
      const cur = usedTarget.get(g) ?? {};
      for (const [size, qty] of Object.entries(t)) cur[size] = (cur[size] ?? 0) + qty;
      usedTarget.set(g, cur);
      usedRolls.set(g, (usedRolls.get(g) ?? 0) + b.qtyRoll);
    }
    const totalRolls = new Map<string, number>();
    for (const a of aduans) {
      const mrp = aduanMrpIds[a.id];
      if (!mrp) continue;
      const g = groupOf(mrp, a.vendor, a.warna, a.lengan);
      totalRolls.set(g, (totalRolls.get(g) ?? 0) + a.qtyRoll);
    }
    // Roll yang sudah diterima vendor (punya code roll) tetapi belum dimulai produksinya (belum ada batch).
    const grRolls = new Map<string, { code: string; at?: string }[]>();
    for (const inv of invoices) {
      if (inv.sourceClaimId) continue; // roll pengganti klaim bukan kebutuhan baru
      for (const [ck, arrivals] of Object.entries(inv.rollArrivals)) {
        const [warna, lengan] = ck.split("|");
        const g = groupOf(inv.mrpId, inv.destinationVendor, warna, lengan);
        if (!allocByGroup.has(g)) continue;
        for (const a of arrivals) {
          if (!a?.codeRoll || batchCodes.has(`${inv.mrpId}|${inv.destinationVendor}|${a.codeRoll}`)) continue;
          const list = grRolls.get(g) ?? [];
          if (!list.some((x) => x.code === a.codeRoll)) list.push({ code: a.codeRoll, at: dayKey(a.arrivedAt) });
          grRolls.set(g, list);
        }
      }
    }
    const poState = (mrp: string, vendor: string, warna: string, lengan: string): "NONE" | "ACTIVE" | "CANCELLED" => {
      const list = materialPOs.filter((p) => p.mrpId === mrp && p.vendorProduksi === vendor && p.colorBreakdown.some((c) => c.warna === warna && c.lengan === lengan));
      if (list.length === 0) return "NONE";
      return list.some((p) => p.status !== "CANCELLED") ? "ACTIVE" : "CANCELLED";
    };
    for (const [g, alloc] of allocByGroup) {
      const [mrp, vendor, warna, lengan] = g.split("|");
      const state = poState(mrp, vendor, warna, lengan);
      if (state === "CANCELLED") continue; // PO Material dibatalkan: tidak jadi dibeli, baris perencanaannya hilang
      const total = totalRolls.get(g) ?? 0;
      const remRolls = total > 0 ? Math.round(total - (usedRolls.get(g) ?? 0)) : 0;
      if (total > 0 && remRolls <= 0) continue; // semua roll sudah punya batch; selisih pembulatan target tidak ditampilkan lagi
      const grUse = remRolls > 0 ? [...(grRolls.get(g) ?? [])].sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true })).slice(0, remRolls) : [];
      const used = usedTarget.get(g) ?? {};
      const kategori = kategoriOf(mrp, vendor, warna, lengan);
      const base = { mrp, vendor: vendorName(vendor), kategori, warna, target: 0, cuttingAt: undefined, fgFirstAt: undefined, fg: 0, estimasi: undefined, ...NO_KOLI, cut: null, qtyDelivery: null, lengan: lengan as Lengan, plan: true };
      for (const size of Object.keys(alloc).sort((a, b) => sizeRank(a) - sizeRank(b) || a.localeCompare(b))) {
        const rem = Math.max(0, alloc[size] - (used[size] ?? 0));
        if (rem === 0) continue;
        const item = itemNameOf(warna, lengan as Lengan, size);
        let left = rem;
        if (grUse.length > 0) {
          const per = Math.floor(rem / remRolls);
          const extra = rem - per * remRolls;
          grUse.forEach((r, i) => {
            const t = Math.min(left, per + (i < extra ? 1 : 0));
            if (t <= 0) return;
            left -= t;
            out.push({ ...base, item, size, roll: r.code, target: t, grAt: grByRoll.get(`${mrp}|${vendor}|${r.code}`) ?? r.at, wip: t, statusRoll: "Sudah GR", status: "BELUM CUTTING" });
          });
        }
        if (left > 0) {
          const label = state === "ACTIVE" ? "Belum GR" : "Belum PO";
          out.push({ ...base, item, size, roll: "", target: left, grAt: undefined, wip: left, statusRoll: label, status: label.toUpperCase() });
        }
      }
    }
  }
  // Item rework: FG hasil rework reject, tanpa roll dan tanpa target (Target Qty 0).
  for (const [key, rw] of reworkFg) {
    const cell = cellByKey.get(key);
    if (!cell) continue;
    const [mrp, vendor, warna, lengan, size] = key.split("|");
    const p = wipParts(0, true, rw.qty, rw.qty, true, reworkMoved.get(key) ?? { delivered: 0, inKoli: 0 });
    const rwEst = plusDays(rw.last, LT_FG_KE_KIRIM);
    out.push(
      ...withKoli(
        {
          item: itemNameOf(warna, lengan as Lengan, size), mrp, vendor: vendorName(vendor), kategori: cell.kategori, warna, size, roll: "(rework)", target: 0, grAt: undefined, cuttingAt: undefined, fgFirstAt: rw.first,
          fg: rw.qty, wip: p.wip, statusRoll: "Rework", estimasi: p.wip > 0 ? rwEst : undefined, status: p.status, ...NO_KOLI, cut: null, lengan: lengan as Lengan,
        },
        p,
        reworkKolis.get(key) ?? [],
        rwEst,
        rwEst,
        rw.qty
      )
    );
  }
  return out.sort(
    (a, b) =>
      b.mrp.localeCompare(a.mrp, undefined, { numeric: true }) ||
      a.vendor.localeCompare(b.vendor) ||
      a.warna.localeCompare(b.warna) ||
      (a.lengan === b.lengan ? 0 : a.lengan === "PENDEK" ? -1 : 1) ||
      (a.roll === "(rework)" ? 2 : a.plan ? 1 : 0) - (b.roll === "(rework)" ? 2 : b.plan ? 1 : 0) ||
      (a.roll === "" ? 1 : 0) - (b.roll === "" ? 1 : 0) ||
      a.roll.localeCompare(b.roll, undefined, { numeric: true }) ||
      sizeRank(a.size) - sizeRank(b.size) ||
      (a.noKoli === "" ? 1 : 0) - (b.noKoli === "" ? 1 : 0) ||
      koliNo(a.noKoli, b.noKoli)
  );
}

export async function buildTrackingWorkbook(input: TrackingExportInput): Promise<Workbook> {
  const ExcelJS = (await import("exceljs")).default;
  const wb: Workbook = new ExcelJS.Workbook();
  wb.creator = "Mini ERP Tigalapan";
  wb.created = new Date();
  const rows = wipRows(input);
  const ws = wb.addWorksheet("WIP", { views: [{ state: "frozen", ySplit: 1 }] });
  const cols: { head: string; width: number; kind: "text" | "int" | "date"; value: (r: WipRow) => string | number | Date | null; note?: string }[] = [
    { head: "Item", width: 26, kind: "text", value: (r) => r.item },
    { head: "No. MRP", width: 9, kind: "text", value: (r) => r.mrp },
    { head: "Vendor", width: 20, kind: "text", value: (r) => r.vendor },
    { head: "Kategory", width: 14, kind: "text", value: (r) => r.kategori },
    { head: "Warna", width: 24, kind: "text", value: (r) => r.warna },
    { head: "Size", width: 7, kind: "text", value: (r) => r.size },
    { head: "Code Roll", width: 16, kind: "text", value: (r) => r.roll },
    { head: "Target Qty", width: 11, kind: "int", value: (r) => r.target, note: "Target roll ini per size: target aduan dibagi menurut jumlah roll (sama seperti form Cutting vendor), sudah ada sebelum roll dicutting. Item rework tidak punya target (0)." },
    { head: "Target (Hasil Cutting)", width: 14, kind: "int", value: (r) => r.cut, note: "Hasil cutting AKTUAL roll ini per size (beda dari Target Qty yang dari aduan). Kosong kalau roll belum dicutting, baris perencanaan, dan item rework. Diulang di tiap baris koli roll x size yang sama." },
    { head: "Tgl good Receiving", width: 16, kind: "date", value: (r) => dateOf(r.grAt) },
    { head: "Tgl Cutting", width: 12, kind: "date", value: (r) => dateOf(r.cuttingAt) },
    { head: "Tgl Awal FG", width: 12, kind: "date", value: (r) => dateOf(r.fgFirstAt) },
    { head: "Qty FG", width: 9, kind: "int", value: (r) => r.fg },
    {
      head: "Qty WIP",
      width: 10,
      kind: "int",
      value: (r) => r.wip,
      note: "Barang yang belum dikirim: target (roll belum dicutting) + (hasil cutting - FG, selama roll belum ditutup) + FG belum masuk koli + sudah di koli belum dikirim. Reject tidak tercatat per roll, jadi roll yang belum ditutup masih menghitung reject sebagai WIP.",
    },
    { head: "Status Roll", width: 16, kind: "text", value: (r) => r.statusRoll },
    {
      head: "Estimasi Tanggal Kirim",
      width: 14,
      kind: "date",
      value: (r) => dateOf(r.estimasi),
      note: `Estimasi tanggal kirim barang yang masih WIP: tanggal cutting + ${LT_CUTTING_KE_FG} hari (FG) + ${LT_FG_KE_KIRIM} hari (kirim); untuk FG: tanggal FG terakhir + ${LT_FG_KE_KIRIM} hari.`,
    },
    { head: "Status Roll", width: 34, kind: "text", value: (r) => r.status },
    { head: "Qty Koli", width: 9, kind: "int", value: (r) => r.koliQty, note: "Qty roll dan size ini yang ada di koli pada baris ini. Roll dan size yang isinya tersebar di beberapa koli tampil satu baris per koli." },
    { head: "No. Koli", width: 9, kind: "text", value: (r) => r.noKoli },
    { head: "No. Resi", width: 16, kind: "text", value: (r) => r.noResi, note: "Nomor resi pengiriman koli pada baris ini. Kosong kalau koli belum diberi resi." },
    { head: "Qty Delivery", width: 11, kind: "int", value: (r) => r.qtyDelivery, note: "Qty roll dan size ini di koli yang SUDAH dikirim (Delivery) pada baris ini; koli belum dikirim = 0. Jumlah per roll x size tidak pernah melebihi Qty FG dan hasil cutting (kelebihan data koli dipotong)." },
    { head: "Tanggal Kirim", width: 12, kind: "date", value: (r) => dateOf(r.kirimAt), note: "Tanggal koli dikirim (tanggal kirim di resi). Kosong kalau koli belum dikirim." },
    { head: "Estimasi Tiba", width: 12, kind: "date", value: (r) => dateOf(r.tibaAt), note: `Tanggal kirim + ${LT_KIRIM_KE_TIBA} hari (sama dengan ETA di Excel pengiriman Warehouse).` },
  ];
  ws.columns = cols.map((c) => ({ width: c.width }));
  cols.forEach((c, i) => {
    const cell = ws.getCell(1, i + 1);
    cell.value = c.head;
    cell.font = { name: FONT, size: 10, bold: true, color: { argb: INK } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEAD_BG } };
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    cell.border = BORDER;
    if (c.note) cell.note = c.note;
  });
  if (input.filterLabel) ws.getCell(1, 1).note = `Diunduh ${new Date().toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" })} · ${input.filterLabel}`;
  ws.getRow(1).height = 28;
  rows.forEach((r, ri) => {
    cols.forEach((c, ci) => {
      const cell = ws.getCell(2 + ri, ci + 1);
      const v = c.value(r);
      cell.value = v === "" ? null : v;
      cell.font = { name: FONT, size: 10, color: { argb: INK } };
      cell.border = BORDER;
      if (c.kind === "int") {
        cell.numFmt = FMT_INT;
        cell.alignment = { horizontal: "right" };
      }
      if (c.kind === "date") {
        cell.numFmt = FMT_DATE;
        cell.alignment = { horizontal: "center" };
      }
    });
  });
  if (rows.length > 0) ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1 + rows.length, column: cols.length } };
  ws.pageSetup = { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
  return wb;
}

export async function exportTrackingExcel(input: TrackingExportInput, fileName: string): Promise<void> {
  const wb = await buildTrackingWorkbook(input);
  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
