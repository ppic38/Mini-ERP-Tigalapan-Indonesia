"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { SysadminPanel } from "@/components/sysadmin/correction-dialog";
import { reworkUndoCorrections } from "@/components/sysadmin/vendor-corrections";
import { formatDateTimeShort, KIDS_SIZES, mrpDetailFor, reworkTargetSizeAllowed, sizeIndex } from "@/lib/mrp/derive";
import { useMrpStore, type MrpDetail } from "@/lib/mrp/store";
import type { Lengan, Usia } from "@/lib/mrp/types";

/** Bagian "Rework" yang dipakai di tab gabungan Reject & Rework (production-result-panel.tsx, kind="REJECT").
 *  Dulu tab Rework sendiri (production-rework-tab.tsx) -- digabung 2026-10-07 (owner: "reject dan rework jadi satu halaman").
 *  Logika rework (aturan size/lengan, server action) TIDAK berubah. */

const USIA_OPTIONS: Usia[] = ["DEWASA", "KIDS"];

/** Rework fisik cuma bisa memotong lengan PANJANG jadi PENDEK (sisa potongan lengan) — lengan yang sudah PENDEK tidak bisa
 *  "dipanjangkan" lagi. Guard yang sama dicek lagi server-side di reworkRejectSizeAction. */
function reworkLenganOptionsFor(fromLengan: Lengan): Lengan[] {
  return fromLengan === "PANJANG" ? ["PANJANG", "PENDEK"] : ["PENDEK"];
}

/** Size TUNGGAL yang dikenal untuk MRP ini (label pasangan cutting seperti "S-2XL, S-XL" dipecah per token) -- pilihan
 *  dropdown "Size baru" untuk hasil Dewasa. */
export function knownSizesForMrp(mrpId: string, mrpDetails: MrpDetail[]): string[] {
  return Array.from(
    new Set(
      (mrpDetailFor(mrpId, mrpDetails)?.aduanRows ?? []).flatMap((a) =>
        a.sizes.flatMap((s) =>
          s.size
            .split(/[,-]/)
            .map((tok) => tok.trim())
            .filter(Boolean)
        )
      )
    )
  ).sort((a, b) => {
    const ia = sizeIndex(a);
    const ib = sizeIndex(b);
    if (ia >= 0 && ib >= 0) return ia - ib;
    if (ia >= 0) return -1;
    if (ib >= 0) return 1;
    return a.localeCompare(b);
  });
}

/** Form rework inline (dibuka di bawah baris size yang punya sisa reject). Mengurus state & submit sendiri. */
export function ReworkInlineForm({
  mrpId,
  vendorId,
  warna,
  lengan,
  size,
  max,
  knownSizes,
  onDone,
}: {
  mrpId: string;
  vendorId: string;
  warna: string;
  lengan: Lengan;
  size: string;
  max: number;
  knownSizes: string[];
  onDone: () => void;
}) {
  const reworkRejectSize = useMrpStore((s) => s.reworkRejectSize);
  const [qty, setQty] = useState(Math.min(1, max));
  const [toLengan, setToLengan] = useState<Lengan>(reworkLenganOptionsFor(lengan)[0]);
  const [toSize, setToSize] = useState("");
  const [usia, setUsia] = useState<Usia>("DEWASA");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Hasil Kids: seluruh size Kids (XS - 2XL, kain Dewasa dipotong ke ukuran lebih kecil). Dewasa: size MRP ini yang sama atau lebih
  // kecil dari size asal. Divalidasi ulang server-side (reworkTargetSizeAllowed).
  const sizeOptionsFor = (u: Usia) => (u === "KIDS" ? KIDS_SIZES : knownSizes.filter((s) => reworkTargetSizeAllowed(size, s, u)));
  const options = sizeOptionsFor(usia);

  async function submit() {
    if (!toSize.trim() || qty <= 0 || submitting) return;
    if (lengan === "PENDEK" && toLengan === "PANJANG") return;
    setError(null);
    setSubmitting(true);
    try {
      await reworkRejectSize({ mrpId, vendorProduksi: vendorId, warna, lengan, fromSize: size, qty: Math.min(qty, max), toLengan, toSize: toSize.trim(), usia });
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal menyimpan rework.");
    } finally {
      setSubmitting(false);
    }
  }

  const fieldCard = "flex flex-col gap-2 rounded-lg border-2 border-[#BCD3E8] bg-white px-3.5 py-3 shadow-[0_1px_3px_rgba(11,19,27,.08)]";
  const fieldLabel = "font-sans text-[10.5px] font-semibold uppercase tracking-wider text-text-muted";
  return (
    <div className="border-t border-[#CFE0EF] bg-info-bg px-4 py-4">
      <div className="overflow-hidden rounded-md border border-[#A8C5DF] bg-white">
        <div className="border-b border-[#CFE0EF] bg-info-bg px-4 py-2.5">
          <span className="font-sans text-[11.5px] font-semibold text-info-fg">
            Input rework — {warna} · {lengan} · size {size}
          </span>
        </div>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-3 px-4 py-3">
          <div className={fieldCard}>
            <div className="flex items-baseline justify-between gap-2">
              <span className={fieldLabel}>Qty dirework</span>
              <span className="whitespace-nowrap font-mono text-[10px] text-text-muted">
                sisa reject <span className="font-semibold text-[#31414F]">{max}</span>
              </span>
            </div>
            {/* ▼/▲ = -1/+1 dan "Maks" = isi sebesar sisa reject (pola sama Input qty per size di Finish Good). */}
            <div className="flex h-9 items-stretch overflow-hidden rounded-md border border-[#DDE4EB] bg-white">
              <button
                type="button"
                onClick={() => setQty((v) => Math.max(0, v - 1))}
                disabled={qty <= 0}
                aria-label="Kurangi qty"
                className="w-8 flex-none border-r border-[#DDE4EB] text-[10px] text-text-muted hover:bg-[#F2F4F7] disabled:cursor-not-allowed disabled:opacity-40"
              >
                ▼
              </button>
              <input
                value={qty > 0 ? String(qty) : ""}
                onChange={(e) => {
                  const digits = e.target.value.replace(/[^0-9]/g, "");
                  setQty(Math.min(max, digits ? parseInt(digits, 10) : 0));
                }}
                inputMode="numeric"
                placeholder="0"
                className="w-full min-w-0 px-1 text-center font-mono text-[13px] font-semibold outline-none"
              />
              <button
                type="button"
                onClick={() => setQty((v) => Math.min(max, v + 1))}
                disabled={qty >= max}
                aria-label="Tambah qty"
                className="w-8 flex-none border-l border-[#DDE4EB] text-[10px] text-text-muted hover:bg-[#F2F4F7] disabled:cursor-not-allowed disabled:opacity-40"
              >
                ▲
              </button>
              <button
                type="button"
                onClick={() => setQty(max)}
                disabled={qty === max}
                className="flex-none border-l border-[#DDE4EB] bg-info-bg px-2.5 font-sans text-[11px] font-semibold text-info-fg hover:bg-[#DCEBF8] disabled:cursor-not-allowed disabled:opacity-40"
              >
                Maks
              </button>
            </div>
          </div>
          <div className={fieldCard}>
            <span className={fieldLabel}>Lengan hasil</span>
            <select value={toLengan} onChange={(e) => setToLengan(e.target.value as Lengan)} className="input h-9 w-full text-[12.5px] font-medium">
              {reworkLenganOptionsFor(lengan).map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
          </div>
          <div className={fieldCard}>
            <span className={fieldLabel}>Kids / Dewasa</span>
            <select
              value={usia}
              onChange={(e) => {
                const next = e.target.value as Usia;
                setUsia(next);
                // size yang sudah dipilih tapi tidak sah untuk usia baru -> dikosongkan
                if (toSize && !sizeOptionsFor(next).includes(toSize)) setToSize("");
              }}
              className="input h-9 w-full text-[12.5px] font-medium"
            >
              {USIA_OPTIONS.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </select>
          </div>
          <div className={fieldCard}>
            <span className={fieldLabel}>Size baru</span>
            <select value={toSize} onChange={(e) => setToSize(e.target.value)} className="input h-9 w-full text-[12.5px] font-medium">
              <option value="">— pilih size —</option>
              {options.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            {options.length === 0 && <span className="font-sans text-[10px] text-danger-fg">Tidak ada size ≤ {size} untuk MRP ini.</span>}
          </div>
        </div>
        {error && <div className="border-t border-[#EFC9C4] bg-danger-bg px-4 py-2 font-sans text-[11.5px] leading-[1.5] text-danger-fg">{error}</div>}
        <div className="flex items-center justify-between gap-4 border-t border-[#CFE0EF] bg-[#F3F8FD] px-4 py-3">
          <span className="font-sans text-[11px] leading-[1.5] text-text-muted">
            {usia === "KIDS" ? "Hasil Kids: kain Dewasa dipotong ke ukuran lebih kecil — semua size Kids (XS–2XL) boleh dipilih." : `Size tujuan sama atau lebih kecil dari ${size}, tidak bisa menambah kain.`}
            {lengan === "PENDEK" && " Lengan PENDEK tidak bisa dipanjangkan."}
          </span>
          <div className="flex shrink-0 items-center gap-2">
            <Button onClick={onDone} disabled={submitting} variant="ghost" size="md">
              Batal
            </Button>
            <Button onClick={submit} disabled={!toSize.trim() || qty <= 0 || submitting} variant="primary" size="md" className="min-w-[130px]">
              {submitting ? "Menyimpan…" : "Simpan Rework"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** fromSize TIDAK disimpan terstruktur -- cuma ikut di teks `note` baris FG ("Rework dari {lengan} size {fromSize} ({usia})"), jadi
 *  di-parse balik (lihat reworkRejectSizeAction di lib/mrp/actions.ts). toSize terstruktur: satu-satunya key `sizeQty` baris FG itu. */
function parseFromSize(note: string): string | null {
  const m = note.match(/size\s+(\S+)/i);
  return m ? m[1] : null;
}

/** Riwayat rework vendor ini (terbaru di atas) + koreksi Sysadmin "Batalkan rework". */
export function ReworkHistoryCard({ vendorId }: { vendorId: string }) {
  const mrpDetails = useMrpStore((s) => s.mrpDetails);
  const productionResults = useMrpStore((s) => s.productionResults);
  const productionGroupMeta = useMrpStore((s) => s.productionGroupMeta);
  const reworkHistory = productionResults
    .filter((r) => r.vendorProduksi === vendorId && r.kind === "FG" && (r.note ?? "").startsWith("Rework"))
    .sort((a, b) => (a.recordedAt < b.recordedAt ? 1 : -1));
  return (
    <div className="overflow-hidden rounded-lg border border-border-subtle bg-surface-card">
      <div className="border-b border-border-subtle px-4 py-3 font-sans text-[13px] font-semibold text-text-primary">Riwayat rework</div>
      <div className="overflow-x-auto">
        <div className="min-w-[900px]">
          <div className="grid grid-cols-8 gap-x-2 border-b border-border-subtle bg-[#F7F9FB] px-4 py-[9px] font-sans text-[10.5px] font-medium uppercase tracking-wider text-text-muted">
            <span>MRP</span>
            <span>Kategori</span>
            <span>Warna / lengan</span>
            <span>Usia</span>
            <span>Size (asal → baru)</span>
            <span className="text-right">Qty</span>
            <span>Catatan</span>
            <span>Tanggal</span>
          </div>
          {reworkHistory.length === 0 && <div className="px-4 py-6 text-center font-sans text-xs text-text-muted">Belum ada rework.</div>}
          {reworkHistory.map((r) => {
            const fromSize = parseFromSize(r.note ?? "");
            const toSize = Object.keys(r.sizeQty)[0] ?? "—";
            return (
              <div key={r.id} className="border-b border-[#F1F4F7] last:border-b-0">
                <div className="grid grid-cols-8 items-center gap-x-2 px-4 py-[11px] font-sans text-xs text-[#31414F]">
                  <span className="font-mono">{r.mrpId}</span>
                  <span>{mrpDetailFor(r.mrpId, mrpDetails)?.mrp.kategori ?? "—"}</span>
                  <span>
                    {r.warna} · {r.lengan}
                  </span>
                  <span>{r.usia ?? "—"}</span>
                  <span className="font-mono font-medium">
                    {fromSize ?? "—"} <span className="text-text-muted">→</span> {toSize}
                  </span>
                  <span className="text-right font-mono font-medium">{Object.values(r.sizeQty).reduce((a, b) => a + b, 0)}</span>
                  <span>{r.note}</span>
                  <span className="font-mono text-[11px] text-text-muted">{formatDateTimeShort(r.recordedAt)}</span>
                </div>
                {/* Koreksi Sysadmin: vendor tidak punya cara membatalkan rework yang salah. `empty:hidden` -- tidak makan ruang kalau bukan Sysadmin. */}
                <div className="px-4 pb-2 empty:hidden">
                  <SysadminPanel actions={reworkUndoCorrections(r, productionGroupMeta)} />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
