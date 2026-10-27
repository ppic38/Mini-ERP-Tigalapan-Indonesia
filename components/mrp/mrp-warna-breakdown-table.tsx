"use client";

import { useState } from "react";
import { formatPcs } from "@/lib/mrp/derive";
import type { MrpWarnaBreakdown } from "@/lib/mrp/derive";

/** Angka satu warna untuk SATU vendor saja (dari bagian vendor itu di `vendors`); total panjang + pendek dihitung ulang. */
function onlyVendorPart(w: MrpWarnaBreakdown, vendor: string): MrpWarnaBreakdown | null {
  const v = w.vendors.find((x) => x.vendor === vendor);
  if (!v) return null;
  return {
    ...w,
    qtyPanjang: v.qtyPanjang,
    qtyPendek: v.qtyPendek,
    qtyTotal: v.qty,
    rollPanjang: v.rollPanjang,
    rollPendek: v.rollPendek,
    rollTotal: v.roll,
    ribPanjang: v.ribPanjang,
    ribPendek: v.ribPendek,
    ribTotal: v.ribPanjang + v.ribPendek,
    kerahPanjang: v.kerahPanjang,
    kerahPendek: v.kerahPendek,
    kerahTotal: v.kerahPanjang + v.kerahPendek,
    mansetPanjang: v.mansetPanjang,
    mansetPendek: v.mansetPendek,
    mansetTotal: v.mansetPanjang + v.mansetPendek,
    vendors: [v],
    isEmpty: false,
  };
}

/** Tabel rincian qty/roll/rib(/kerah/manset) per warna (panjang · pendek · total) — dipakai di
 *  baris expand halaman MRP PPIC & Approval/Monitoring SCM supaya tampilannya konsisten di kedua
 *  tempat (satu komponen, satu sumber kebenaran tampilan).
 *
 *  Revisi 2026-09-16 (owner: MRP kategori WANGKI MYNO bisa ~30 baris warna, banyak yang "Tidak ada
 *  pemesanan" ikut ke-scroll) — 2 penambahan MURNI tampilan, tidak mengubah data/perhitungan:
 *  (a) baris tanpa pesanan diberi LATAR warning (oren pastel) supaya lebih kentara dari sekadar
 *  teks abu-abu, (b) filter dropdown per warna supaya bisa fokus ke 1 warna tanpa scroll manual. */
export function MrpWarnaBreakdownTable({ breakdown: allBreakdown }: { breakdown: MrpWarnaBreakdown[] }) {
  const [filterWarna, setFilterWarna] = useState("");
  const [filterVendor, setFilterVendor] = useState("");
  const [query, setQuery] = useState("");
  // Filter vendor: hanya warna yang dikerjakan vendor itu, dengan angka bagian vendor itu (bukan total warna semua vendor).
  const vendorOptions = Array.from(new Set(allBreakdown.flatMap((w) => w.vendors.map((v) => v.vendor)))).sort((a, b) => a.localeCompare(b));
  const breakdown = filterVendor ? allBreakdown.map((w) => onlyVendorPart(w, filterVendor)).filter((w): w is MrpWarnaBreakdown => w !== null) : allBreakdown;

  if (allBreakdown.length === 0) {
    return <div className="font-sans text-[11.5px] text-text-muted">Belum ada rincian warna/lengan untuk MRP ini (data lama atau tanpa detail import).</div>;
  }
  // Item BAGIAN 2 (Req 20) — grup kolom Kerah/Manset cuma ditampilkan kalau ADA baris breakdown
  // yang benar-benar punya nilai (MRP kategori "WANGKI MYNO"), supaya MRP kategori lain tidak
  // penuh kolom 0.
  const showKerahManset = breakdown.some((w) => w.kerahTotal > 0 || w.mansetTotal > 0);
  const byWarna = filterWarna && breakdown.some((w) => w.warna === filterWarna) ? breakdown.filter((w) => w.warna === filterWarna) : breakdown;
  // Cari warna: hasil menyempit saat mengetik.
  const needle = query.trim().toLowerCase();
  const filtered = needle ? byWarna.filter((w) => w.warna.toLowerCase().includes(needle)) : byWarna;
  const warnaFilterActive = filtered !== breakdown;
  // Pilihan dropdown warna berurut abjad.
  const warnaOptions = [...breakdown].sort((a, b) => a.warna.localeCompare(b.warna, "id", { numeric: true }));

  return (
    <div className="flex flex-col gap-2">
      {(allBreakdown.length > 1 || vendorOptions.length > 1) && (
        <div className="flex flex-wrap items-center gap-2">
          {vendorOptions.length > 1 && (
            <select
              value={filterVendor}
              onChange={(e) => {
                setFilterVendor(e.target.value);
                setFilterWarna("");
              }}
              className="input w-auto !py-1.5 !text-[11px]"
            >
              <option value="">Semua vendor ({vendorOptions.length})</option>
              {vendorOptions.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          )}
          <select value={filterWarna} onChange={(e) => setFilterWarna(e.target.value)} className="input w-auto !py-1.5 !text-[11px]">
            <option value="">Semua warna ({breakdown.length})</option>
            {warnaOptions.map((w) => (
              <option key={w.warna} value={w.warna}>
                {w.warna}
                {w.isEmpty ? " — tidak ada pemesanan" : ""}
              </option>
            ))}
          </select>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Cari warna…"
            aria-label="Cari warna"
            className="input ml-auto w-[220px] !py-1.5 !text-[11px] max-sm:w-full"
          />
        </div>
      )}
      <div className="overflow-hidden overflow-x-auto rounded-md border border-[#E4E8EE] bg-white">
        <table className="w-full min-w-[720px] border-collapse">
          <thead>
            <tr className="border-b border-[#E4E8EE] bg-[#F2F4F7] font-sans text-[10px] font-medium uppercase tracking-wider text-text-muted">
              <th rowSpan={2} className="px-3 py-2 text-left align-bottom">
                Warna
              </th>
              <th colSpan={3} className="border-l border-[#E4E8EE] px-3 py-1.5 text-center">
                Qty (pcs)
              </th>
              <th colSpan={3} className="border-l border-[#E4E8EE] px-3 py-1.5 text-center">
                Roll
              </th>
              <th colSpan={3} className="border-l border-[#E4E8EE] px-3 py-1.5 text-center">
                Rib (kg)
              </th>
              {showKerahManset && (
                <>
                  <th colSpan={3} className="border-l border-[#E4E8EE] px-3 py-1.5 text-center">
                    Kerah (kg)
                  </th>
                  <th colSpan={3} className="border-l border-[#E4E8EE] px-3 py-1.5 text-center">
                    Manset (kg)
                  </th>
                </>
              )}
              <th rowSpan={2} className="border-l border-[#E4E8EE] px-3 py-2 text-left align-bottom">
                Vendor produksi
              </th>
            </tr>
            <tr className="border-b border-[#E4E8EE] bg-[#F2F4F7] font-sans text-[10px] font-medium uppercase tracking-wider text-text-muted">
              <th className="border-l border-[#E4E8EE] px-3 py-1.5 text-right">Panjang</th>
              <th className="px-3 py-1.5 text-right">Pendek</th>
              <th className="px-3 py-1.5 text-right">Total</th>
              <th className="border-l border-[#E4E8EE] px-3 py-1.5 text-right">Panjang</th>
              <th className="px-3 py-1.5 text-right">Pendek</th>
              <th className="px-3 py-1.5 text-right">Total</th>
              <th className="border-l border-[#E4E8EE] px-3 py-1.5 text-right">Panjang</th>
              <th className="px-3 py-1.5 text-right">Pendek</th>
              <th className="px-3 py-1.5 text-right">Total</th>
              {showKerahManset && (
                <>
                  <th className="border-l border-[#E4E8EE] px-3 py-1.5 text-right">Panjang</th>
                  <th className="px-3 py-1.5 text-right">Pendek</th>
                  <th className="px-3 py-1.5 text-right">Total</th>
                  <th className="border-l border-[#E4E8EE] px-3 py-1.5 text-right">Panjang</th>
                  <th className="px-3 py-1.5 text-right">Pendek</th>
                  <th className="px-3 py-1.5 text-right">Total</th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {filtered.map((w) => (
              <tr
                key={w.warna}
                className={"border-b border-[#F1F4F7] font-sans text-[11.5px] last:border-b-0 " + (w.isEmpty ? "bg-warning-bg text-warning-fg" : "text-[#31414F]")}
              >
                <td className="px-3 py-2 font-medium">
                  {w.warna}
                  {w.isEmpty && <div className="font-sans text-[10px] font-normal opacity-80">Tidak ada pemesanan</div>}
                </td>
                <td className="border-l border-[#F1F4F7] px-3 py-2 text-right font-mono">{formatPcs(w.qtyPanjang)}</td>
                <td className="px-3 py-2 text-right font-mono">{formatPcs(w.qtyPendek)}</td>
                <td className="px-3 py-2 text-right font-mono font-semibold">{formatPcs(w.qtyTotal)}</td>
                <td className="border-l border-[#F1F4F7] px-3 py-2 text-right font-mono">{w.rollPanjang.toLocaleString("id-ID")}</td>
                <td className="px-3 py-2 text-right font-mono">{w.rollPendek.toLocaleString("id-ID")}</td>
                <td className="px-3 py-2 text-right font-mono font-semibold">{w.rollTotal.toLocaleString("id-ID")}</td>
                <td className="border-l border-[#F1F4F7] px-3 py-2 text-right font-mono">
                  {w.ribPanjang.toLocaleString("id-ID", { maximumFractionDigits: 2 })}
                </td>
                <td className="px-3 py-2 text-right font-mono">{w.ribPendek.toLocaleString("id-ID", { maximumFractionDigits: 2 })}</td>
                <td className="px-3 py-2 text-right font-mono font-semibold">
                  {w.ribTotal.toLocaleString("id-ID", { maximumFractionDigits: 2 })}
                </td>
                {showKerahManset && (
                  <>
                    <td className="border-l border-[#F1F4F7] px-3 py-2 text-right font-mono">
                      {w.kerahPanjang.toLocaleString("id-ID", { maximumFractionDigits: 2 })}
                    </td>
                    <td className="px-3 py-2 text-right font-mono">{w.kerahPendek.toLocaleString("id-ID", { maximumFractionDigits: 2 })}</td>
                    <td className="px-3 py-2 text-right font-mono font-semibold">
                      {w.kerahTotal.toLocaleString("id-ID", { maximumFractionDigits: 2 })}
                    </td>
                    <td className="border-l border-[#F1F4F7] px-3 py-2 text-right font-mono">
                      {w.mansetPanjang.toLocaleString("id-ID", { maximumFractionDigits: 2 })}
                    </td>
                    <td className="px-3 py-2 text-right font-mono">{w.mansetPendek.toLocaleString("id-ID", { maximumFractionDigits: 2 })}</td>
                    <td className="px-3 py-2 text-right font-mono font-semibold">
                      {w.mansetTotal.toLocaleString("id-ID", { maximumFractionDigits: 2 })}
                    </td>
                  </>
                )}
                {/* Vendor yang mengerjakan warna ini (satu warna bisa dibagi ke beberapa vendor): nama, pcs, dan roll tiap vendor. */}
                <td className="border-l border-[#F1F4F7] px-3 py-2 align-top">
                  {w.vendors.length === 0 ? (
                    <span className="text-text-muted">—</span>
                  ) : (
                    <div className="flex flex-col gap-0.5">
                      {w.vendors.map((v) => (
                        <div key={v.vendor} className="flex items-baseline gap-1.5 whitespace-nowrap">
                          <span className="font-medium">{v.vendor}</span>
                          <span className="font-mono text-[10.5px] text-text-muted">
                            {formatPcs(v.qty)} pcs · {v.roll.toLocaleString("id-ID")} roll
                          </span>
                        </div>
                      ))}
                      {w.vendors.length > 1 && <span className="mt-0.5 font-sans text-[10px] font-semibold text-info-fg">{w.vendors.length} vendor</span>}
                    </div>
                  )}
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={showKerahManset ? 20 : 11} className="px-3 py-4 text-center font-sans text-[11.5px] text-text-muted">
                  Tidak ada warna yang cocok dengan filter.
                </td>
              </tr>
            )}
            {!warnaFilterActive && breakdown.length > 1 && (
              <tr className="border-t-2 border-accent-blue bg-info-bg font-sans text-[11.5px] font-semibold text-info-fg">
                <td className="px-3 py-2">Total semua warna</td>
                <td className="border-l border-accent-blue/20 px-3 py-2 text-right font-mono">{formatPcs(breakdown.reduce((s, w) => s + w.qtyPanjang, 0))}</td>
                <td className="px-3 py-2 text-right font-mono">{formatPcs(breakdown.reduce((s, w) => s + w.qtyPendek, 0))}</td>
                <td className="px-3 py-2 text-right font-mono">{formatPcs(breakdown.reduce((s, w) => s + w.qtyTotal, 0))}</td>
                <td className="border-l border-accent-blue/20 px-3 py-2 text-right font-mono">{breakdown.reduce((s, w) => s + w.rollPanjang, 0).toLocaleString("id-ID")}</td>
                <td className="px-3 py-2 text-right font-mono">{breakdown.reduce((s, w) => s + w.rollPendek, 0).toLocaleString("id-ID")}</td>
                <td className="px-3 py-2 text-right font-mono">{breakdown.reduce((s, w) => s + w.rollTotal, 0).toLocaleString("id-ID")}</td>
                <td className="border-l border-accent-blue/20 px-3 py-2 text-right font-mono">
                  {breakdown.reduce((s, w) => s + w.ribPanjang, 0).toLocaleString("id-ID", { maximumFractionDigits: 2 })}
                </td>
                <td className="px-3 py-2 text-right font-mono">{breakdown.reduce((s, w) => s + w.ribPendek, 0).toLocaleString("id-ID", { maximumFractionDigits: 2 })}</td>
                <td className="px-3 py-2 text-right font-mono">{breakdown.reduce((s, w) => s + w.ribTotal, 0).toLocaleString("id-ID", { maximumFractionDigits: 2 })}</td>
                {showKerahManset && (
                  <>
                    <td className="border-l border-accent-blue/20 px-3 py-2 text-right font-mono">
                      {breakdown.reduce((s, w) => s + w.kerahPanjang, 0).toLocaleString("id-ID", { maximumFractionDigits: 2 })}
                    </td>
                    <td className="px-3 py-2 text-right font-mono">
                      {breakdown.reduce((s, w) => s + w.kerahPendek, 0).toLocaleString("id-ID", { maximumFractionDigits: 2 })}
                    </td>
                    <td className="px-3 py-2 text-right font-mono">
                      {breakdown.reduce((s, w) => s + w.kerahTotal, 0).toLocaleString("id-ID", { maximumFractionDigits: 2 })}
                    </td>
                    <td className="border-l border-accent-blue/20 px-3 py-2 text-right font-mono">
                      {breakdown.reduce((s, w) => s + w.mansetPanjang, 0).toLocaleString("id-ID", { maximumFractionDigits: 2 })}
                    </td>
                    <td className="px-3 py-2 text-right font-mono">
                      {breakdown.reduce((s, w) => s + w.mansetPendek, 0).toLocaleString("id-ID", { maximumFractionDigits: 2 })}
                    </td>
                    <td className="px-3 py-2 text-right font-mono">
                      {breakdown.reduce((s, w) => s + w.mansetTotal, 0).toLocaleString("id-ID", { maximumFractionDigits: 2 })}
                    </td>
                  </>
                )}
                <td className="border-l border-accent-blue/20 px-3 py-2" />
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
