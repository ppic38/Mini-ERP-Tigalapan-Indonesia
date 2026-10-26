import type { MrpDetail } from "./store";
import type { Lengan, Mrp, ProductionBatch, RawMaterialInvoice } from "./types";

/** Laporan "Raw Material" (Procurement, owner 2026-10-26): pembelian dan pemakaian bahan baku per MRP dan vendor produksi, untuk pelaporan bulanan.
 *
 *  Sumber nilai: invoice bahan (`RawMaterialInvoice`) -- tiap roll kain = harga per kg x berat kotor roll itu; diskon invoice (satu angka untuk seluruh
 *  invoice) dibagi sebanding nilai tiap item sehingga jumlah semua item setelah diskon = `totalBiaya` invoice. Pemakaian roll ditelusuri lewat code roll:
 *  roll yang sudah punya batch produksi (resting/cutting/FG) dan belum ditutup = WIP, yang batch-nya sudah ditutup = Selesai, sisanya = Sisa (dibeli
 *  dikurangi WIP dan Selesai, termasuk yang belum diterima vendor -- mengikuti spreadsheet RAW MATERIAL). Item tambahan (rib/kerah/manset) tidak
 *  dilacak pemakaiannya per roll, jadi hanya masuk sisi pembelian (tagihan dan diskon). */

export type RawMaterialLine = {
  key: string;
  mrpId: string;
  vendorProduksi: string;
  invoiceId: string;
  /** Nomor invoice dari supplier (`noInvoiceVendor`); kosong = jatuh ke ID invoice internal. Dipakai untuk tampilan. */
  noInvoice: string;
  supplier: string;
  bookedAt: string;
  /** "KAIN" = roll kain; "TAMBAHAN" = item tambahan invoice (rib/kerah/manset, dst.). */
  kind: "KAIN" | "TAMBAHAN";
  /** Jenis bahan untuk tampilan: "Kain 24S" atau nama item tambahan. */
  jenis: string;
  /** Benang dari kategori produk (mis. "24S"); "-" kalau tidak terbaca. */
  benang: string;
  kategori: string;
  warna: string;
  lengan?: Lengan;
  rollBeli: number;
  rollDiterima: number;
  rollWip: number;
  rollSelesai: number;
  rollSisa: number;
  /** Berat item tambahan (kg); 0 untuk kain. */
  beratKg: number;
  nilaiSebelumDiskon: number;
  diskon: number;
  nilaiSetelahDiskon: number;
  nilaiWip: number;
  nilaiSelesai: number;
  nilaiSisa: number;
};

export type RawMaterialSummary = {
  key: string;
  mrpId: string;
  vendorProduksi: string;
  kategori: string;
  jenis: string;
  invoiceCount: number;
  /** Tanggal invoice terakhir di baris ini (dasar urutan: terbaru di atas). */
  lastBookedAt: string;
  rollBeli: number;
  rollDiterima: number;
  rollWip: number;
  rollSelesai: number;
  rollSisa: number;
  nilaiSebelumDiskon: number;
  diskon: number;
  nilaiSetelahDiskon: number;
  nilaiWip: number;
  nilaiSelesai: number;
  nilaiSisa: number;
  lines: RawMaterialLine[];
};

/** "COMBED 24S" -> "24S"; "KIDS 30S" -> "30S"; tidak ada -> "-". */
export function benangFromKategori(kategori: string | undefined): string {
  const m = (kategori ?? "").match(/(\d{2})\s*S\b/i);
  return m ? `${m[1]}S` : "-";
}

function categoryFor(detail: MrpDetail | undefined, mrp: Mrp | undefined, warna: string, lengan?: Lengan): string {
  const group = detail?.lenganGroups.find((g) => g.warna === warna && (!lengan || g.lengan === lengan) && g.kategori);
  return group?.kategori || mrp?.kategori || detail?.mrp.kategori || "-";
}

export function rawMaterialLines(invoices: RawMaterialInvoice[], batches: ProductionBatch[], mrpDetails: MrpDetail[], staticMrps: Mrp[]): RawMaterialLine[] {
  // code roll -> batch (code roll unik se-aplikasi, indeks unik migration 0067).
  const batchByCode = new Map<string, ProductionBatch>();
  for (const b of batches) if (b.codeRoll) batchByCode.set(b.codeRoll, b);
  const detailById = new Map(mrpDetails.map((d) => [d.mrp.id, d]));
  const staticById = new Map(staticMrps.map((m) => [m.id, m]));

  const out: RawMaterialLine[] = [];
  for (const inv of invoices) {
    if (inv.status === "WAITING_INVOICE") continue;
    const vendor = inv.destinationVendor || inv.vendorProduksi;
    const detail = detailById.get(inv.mrpId);
    const mrp = detail?.mrp ?? staticById.get(inv.mrpId);

    const colorValue = (c: RawMaterialInvoice["colorEntries"][number]) => c.rolls.reduce((s, kg) => s + c.hargaPerRoll * kg, 0);
    const baseTotal = inv.colorEntries.reduce((s, c) => s + colorValue(c), 0) + inv.addBuys.reduce((s, a) => s + a.totalHarga, 0);
    // Faktor setelah diskon: total invoice tercatat / nilai sebelum diskon (= 1 - diskon/nilai). Memakai totalBiaya tercatat supaya jumlah laporan
    // selalu sama dengan tagihan invoice, termasuk invoice hasil migrasi.
    const factor = baseTotal > 0 && inv.totalBiaya > 0 ? inv.totalBiaya / baseTotal : 1;

    inv.colorEntries.forEach((c, ci) => {
      const key = `${c.warna}|${c.lengan}`;
      const arrivals = inv.rollArrivals[key] ?? [];
      const receipts = inv.rollReceipts[key] ?? [];
      const kategori = categoryFor(detail, mrp, c.warna, c.lengan);
      const line: RawMaterialLine = {
        key: `${inv.id}|${ci}|${key}`,
        mrpId: inv.mrpId,
        vendorProduksi: vendor,
        invoiceId: inv.id,
        noInvoice: inv.noInvoiceVendor?.trim() || inv.id,
        supplier: inv.supplier,
        bookedAt: inv.bookedAt,
        kind: "KAIN",
        jenis: `Kain ${benangFromKategori(kategori)}`,
        benang: benangFromKategori(kategori),
        kategori,
        warna: c.warna,
        lengan: c.lengan,
        rollBeli: c.rolls.length,
        rollDiterima: 0,
        rollWip: 0,
        rollSelesai: 0,
        rollSisa: 0,
        beratKg: 0,
        nilaiSebelumDiskon: 0,
        diskon: 0,
        nilaiSetelahDiskon: 0,
        nilaiWip: 0,
        nilaiSelesai: 0,
        nilaiSisa: 0,
      };
      c.rolls.forEach((kg, idx) => {
        const before = c.hargaPerRoll * kg;
        const after = before * factor;
        line.nilaiSebelumDiskon += before;
        line.nilaiSetelahDiskon += after;
        if (arrivals[idx]) line.rollDiterima += 1;
        const code = arrivals[idx]?.codeRoll || receipts[idx]?.codeRoll;
        const batch = code ? batchByCode.get(code) : undefined;
        if (batch && batch.closedAt) {
          line.rollSelesai += 1;
          line.nilaiSelesai += after;
        } else if (batch) {
          line.rollWip += 1;
          line.nilaiWip += after;
        } else {
          line.rollSisa += 1;
          line.nilaiSisa += after;
        }
      });
      line.diskon = line.nilaiSebelumDiskon - line.nilaiSetelahDiskon;
      out.push(line);
    });

    inv.addBuys.forEach((a, ai) => {
      const kategori = categoryFor(detail, mrp, a.warna);
      out.push({
        key: `${inv.id}|add|${ai}`,
        mrpId: inv.mrpId,
        vendorProduksi: vendor,
        invoiceId: inv.id,
        noInvoice: inv.noInvoiceVendor?.trim() || inv.id,
        supplier: inv.supplier,
        bookedAt: inv.bookedAt,
        kind: "TAMBAHAN",
        jenis: a.item,
        benang: benangFromKategori(kategori),
        kategori,
        warna: a.warna || "-",
        rollBeli: 0,
        rollDiterima: 0,
        rollWip: 0,
        rollSelesai: 0,
        rollSisa: 0,
        beratKg: a.beratKg,
        nilaiSebelumDiskon: a.totalHarga,
        diskon: a.totalHarga - a.totalHarga * factor,
        nilaiSetelahDiskon: a.totalHarga * factor,
        nilaiWip: 0,
        nilaiSelesai: 0,
        nilaiSisa: 0,
      });
    });
  }
  return mergeLengan(out);
}

/** Lengan pendek dan panjang untuk warna yang sama dalam satu invoice digabung jadi satu baris (owner 2026-10-26); nilai dan roll dijumlahkan.
 *  Item tambahan tidak punya lengan jadi tidak diubah. */
function mergeLengan(lines: RawMaterialLine[]): RawMaterialLine[] {
  const merged = new Map<string, RawMaterialLine>();
  const rest: RawMaterialLine[] = [];
  for (const l of lines) {
    if (l.kind !== "KAIN") {
      rest.push(l);
      continue;
    }
    const key = `${l.invoiceId}|KAIN|${l.warna}|${l.jenis}`;
    const cur = merged.get(key);
    if (!cur) {
      merged.set(key, { ...l, key, lengan: undefined });
      continue;
    }
    cur.rollBeli += l.rollBeli;
    cur.rollDiterima += l.rollDiterima;
    cur.rollWip += l.rollWip;
    cur.rollSelesai += l.rollSelesai;
    cur.rollSisa += l.rollSisa;
    cur.nilaiSebelumDiskon += l.nilaiSebelumDiskon;
    cur.diskon += l.diskon;
    cur.nilaiSetelahDiskon += l.nilaiSetelahDiskon;
    cur.nilaiWip += l.nilaiWip;
    cur.nilaiSelesai += l.nilaiSelesai;
    cur.nilaiSisa += l.nilaiSisa;
  }
  return [...merged.values(), ...rest];
}

/** Satu baris per MRP x vendor (kategori dan jenis bahan digabung bila lebih dari satu). Urutan: MRP terbaru (tanggal MRP dibuat, `mrpCreated`) di paling atas,
 *  sama seperti daftar MRP di PPIC; MRP tanpa tanggal ditaruh paling bawah menurut tanggal invoice terakhir; dalam satu MRP urut nama vendor. */
export function summarizeRawMaterial(lines: RawMaterialLine[], mrpCreated?: Map<string, string>): RawMaterialSummary[] {
  const map = new Map<string, RawMaterialSummary & { _inv: Set<string>; _kat: Set<string>; _jenis: Set<string> }>();
  for (const l of lines) {
    const key = `${l.mrpId}|${l.vendorProduksi}`;
    let s = map.get(key);
    if (!s) {
      s = {
        key, mrpId: l.mrpId, vendorProduksi: l.vendorProduksi, kategori: "", jenis: "", invoiceCount: 0, lastBookedAt: "",
        rollBeli: 0, rollDiterima: 0, rollWip: 0, rollSelesai: 0, rollSisa: 0,
        nilaiSebelumDiskon: 0, diskon: 0, nilaiSetelahDiskon: 0, nilaiWip: 0, nilaiSelesai: 0, nilaiSisa: 0,
        lines: [], _inv: new Set(), _kat: new Set(), _jenis: new Set(),
      };
      map.set(key, s);
    }
    if (l.bookedAt > s.lastBookedAt) s.lastBookedAt = l.bookedAt;
    s._inv.add(l.invoiceId);
    s._kat.add(l.kategori);
    s._jenis.add(l.jenis);
    s.rollBeli += l.rollBeli;
    s.rollDiterima += l.rollDiterima;
    s.rollWip += l.rollWip;
    s.rollSelesai += l.rollSelesai;
    s.rollSisa += l.rollSisa;
    s.nilaiSebelumDiskon += l.nilaiSebelumDiskon;
    s.diskon += l.diskon;
    s.nilaiSetelahDiskon += l.nilaiSetelahDiskon;
    s.nilaiWip += l.nilaiWip;
    s.nilaiSelesai += l.nilaiSelesai;
    s.nilaiSisa += l.nilaiSisa;
    s.lines.push(l);
  }
  return Array.from(map.values())
    .map(({ _inv, _kat, _jenis, ...s }) => ({ ...s, invoiceCount: _inv.size, kategori: Array.from(_kat).sort().join(", "), jenis: Array.from(_jenis).sort().join(", ") }))
    .sort((a, b) => {
      const ca = mrpCreated?.get(a.mrpId) ?? "";
      const cb = mrpCreated?.get(b.mrpId) ?? "";
      if (ca !== cb) return ca < cb ? 1 : -1;
      if (a.mrpId !== b.mrpId) return (a.lastBookedAt < b.lastBookedAt ? 1 : a.lastBookedAt > b.lastBookedAt ? -1 : 0) || b.mrpId.localeCompare(a.mrpId, undefined, { numeric: true });
      return a.vendorProduksi.localeCompare(b.vendorProduksi);
    });
}
