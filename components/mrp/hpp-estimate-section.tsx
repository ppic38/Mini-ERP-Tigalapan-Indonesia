"use client";

import { formatDate, formatPcs, formatRupiah } from "@/lib/mrp/derive";
import { VENDOR_PRODUKSI } from "@/lib/mrp/seed";
import type { PoHppEstimate } from "@/lib/mrp/poHppEstimate";

// Rincian estimasi HPP (lib/mrp/poHppEstimate.ts), dipakai bersama antrean Approval PO dan Approval MRP (owner 2026-11-27).

export const hppPctText = (p: number | null) => (p == null ? "—" : `${p.toLocaleString("id-ID", { maximumFractionDigits: 1 })}%`);
/** Warna rasio HPP: <= 70% hijau, <= 80% kuning, di atas itu merah. */
export const hppPctTone = (p: number | null) => (p == null ? "text-text-muted" : p <= 70 ? "text-success-fg" : p <= 80 ? "text-warning-fg" : "text-danger-fg");

/** Rincian estimasi HPP di jendela "Lihat detail" (owner 2026-11-27). */
export function HppEstimateSection({ est, className = "mt-5" }: { est: PoHppEstimate; className?: string }) {
  const rp = (n: number) => formatRupiah(Math.round(n));
  const rows: [string, number, string?][] = [
    ["Bahan (roll x 25 kg x harga kain)", est.bahan],
    ["Rib, kerah, manset", est.rib],
    ["Diskon supplier (historis)", -est.diskon, "pengurang bahan"],
    ["Maklon (matriks harga maklon)", est.maklon],
    ["Ongkir (rata-rata per kategori)", est.ongkir],
  ];
  return (
    <div className={className}>
      <div className="mb-2 font-sans text-[10.5px] font-semibold uppercase tracking-wider text-text-muted">Estimasi HPP</div>
      <div className="mb-2 font-sans text-[11px] text-text-muted">
        {est.frozenLines === est.lines.length && est.lines.length > 0
          ? `Terkunci saat PO diajukan${est.lines[0].frozenAt ? " (" + formatDate(est.lines[0].frozenAt) + ")" : ""}: tidak berubah walau harga atau rata-rata berubah.`
          : est.frozenLines > 0
            ? `${est.frozenLines} dari ${est.lines.length} baris terkunci saat PO diajukan; sisanya dihitung dari data terkini.`
            : "Dihitung dari data terkini; angka dikunci saat Procurement mengajukan PO Material (PO yang diajukan sebelum fitur ini tetap dihitung terkini)."}
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          ["Est. HPP", rp(est.hpp), ""],
          ["HPP / pcs", rp(est.hppPerPcs), ""],
          ["Nilai jual", rp(est.hargaJual), ""],
          ["Rasio HPP", hppPctText(est.pct), hppPctTone(est.pct)],
        ].map(([k, v, tone]) => (
          <div key={k} className="rounded-md border border-[#E4E8EE] bg-[#FBFCFD] px-3 py-2">
            <div className="font-sans text-[10px] font-medium uppercase tracking-wider text-text-muted">{k}</div>
            <div className={"mt-0.5 font-mono text-[12.5px] font-semibold " + (tone || "text-text-primary")}>{v}</div>
          </div>
        ))}
      </div>
      <table className="mt-3 w-full border-collapse font-sans text-[11.5px]">
        <tbody>
          {rows.map(([k, v, note]) => (
            <tr key={k} className="border-t border-[#F1F4F7]">
              <td className="px-3 py-1 text-[#31414F]">
                {k}
                {note && <span className="ml-1 text-[10.5px] text-text-muted">({note})</span>}
              </td>
              <td className="px-3 py-1 text-right font-mono">{rp(v)}</td>
            </tr>
          ))}
          <tr className="border-t border-[#E4E8EE] font-semibold">
            <td className="px-3 py-1">Total HPP · {formatPcs(est.pcs)} pcs</td>
            <td className="px-3 py-1 text-right font-mono">{rp(est.hpp)}</td>
          </tr>
        </tbody>
      </table>
      <div className="mt-3 overflow-x-auto rounded-md border border-[#E4E8EE]">
        <table className="w-full border-collapse font-sans text-[11.5px]">
          <thead className="bg-[#F2F5F8]">
            <tr className="text-left text-text-muted">
              <th className="px-3 py-1 font-medium">Vendor · warna · lengan</th>
              <th className="px-3 py-1 font-medium">Kategori</th>
              <th className="px-3 py-1 text-right font-medium">Pcs</th>
              <th className="px-3 py-1 text-right font-medium">Maklon/pcs</th>
              <th className="px-3 py-1 text-right font-medium">HPP/pcs</th>
              <th className="px-3 py-1 text-right font-medium">Rasio</th>
            </tr>
          </thead>
          <tbody>
            {est.lines.map((l) => {
              const pct = l.hargaJual > 0 ? (l.hpp / l.hargaJual) * 100 : null;
              return (
                <tr key={l.mrpId + l.vendor + l.warna + l.lengan} className="border-t border-[#F1F4F7]">
                  <td className="px-3 py-1">
                    {VENDOR_PRODUKSI[l.vendor]?.name ?? l.vendor} · {l.warna} · {l.lengan}
                    {l.kainTanpaHarga && <span className="ml-1 text-[10px] font-semibold text-danger-fg">harga kain tidak ada</span>}
                    {l.kainViaKnitto && <span className="ml-1 text-[10px] text-warning-fg" title="Warna ini belum punya harga kain di supplier tersebut">harga kain KNITTO</span>}
                    {l.supplierAsumsi && <span className="ml-1 text-[10px] text-warning-fg" title="Supplier belum dipilih: memakai supplier terakhir yang membeli warna ini">asumsi {l.supplier}</span>}
                    {l.fob && <span className="ml-1 text-[10px] text-text-muted">FOB</span>}
                  </td>
                  <td className="px-3 py-1">{l.segmen}</td>
                  <td className="px-3 py-1 text-right font-mono">{formatPcs(l.pcs)}</td>
                  <td className="px-3 py-1 text-right font-mono">{rp(l.maklonRate)}</td>
                  <td className="px-3 py-1 text-right font-mono">{rp(l.pcs > 0 ? l.hpp / l.pcs : 0)}</td>
                  <td className={"px-3 py-1 text-right font-mono font-semibold " + hppPctTone(pct)}>{hppPctText(pct)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="mt-2 font-sans text-[10.5px] leading-[1.5] text-text-muted">
        Estimasi, bukan HPP aktual. Bahan dan rib dari Master Data harga, diskon = rata-rata diskon invoice supplier yang sama sebelumnya, maklon dari
        matriks Master Data Harga Maklon per kategori, ongkir = rata-rata ongkir per pcs kategori (Dewasa/Combed, Kids, Tunik) dari pengiriman sebelumnya.
        Rasio = HPP / nilai jual Master SKU.
        {est.pcsTanpaHarga > 0 &&
          ` ${formatPcs(est.pcsTanpaHarga)} pcs belum punya harga jual di Master SKU: size yang kosong memakai rata-rata size lain warna yang sama, warna yang sama sekali tidak punya harga jual tidak dihitung di rasio.`}
      </div>
    </div>
  );
}
