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
  compact = false,
}: {
  mrpId: string;
  vendorId: string;
  warna: string;
  lengan: Lengan;
  size: string;
  max: number;
  knownSizes: string[];
  onDone: () => void;
  /** Tampilan HP satu form (owner 2026-11-01): judul & bingkai kartu form tidak ditampilkan, dan "Size baru" ditaruh di
   *  samping kotak qty (size asal dipilih di luar form). Hanya mengubah susunan di HP. */
  compact?: boolean;
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

  // HP: field dibuat ringan (tanpa kartu tebal) dan disusun 2 kolom; qty & size baru selebar form.
  const fieldCard = "flex flex-col gap-2 rounded-lg border-2 border-[#BCD3E8] bg-white px-3.5 py-3 shadow-[0_1px_3px_rgba(11,19,27,.08)] max-md:gap-1.5 max-md:border-0 max-md:p-0 max-md:shadow-none";
  const fieldLabel = "font-sans text-[10.5px] font-semibold uppercase tracking-wider text-text-muted";
  return (
    <div
      className={
        "border-t border-[#CFE0EF] bg-info-bg px-4 py-4 max-md:bg-[#FBF7F3] max-md:px-3 max-md:py-3" +
        (compact ? " max-md:border-0 max-md:bg-transparent max-md:p-0" : "")
      }
    >
      <div className={"overflow-hidden rounded-md border border-[#A8C5DF] bg-white max-md:rounded-2xl max-md:border-[#EDE8E2]" + (compact ? " max-md:rounded-none max-md:border-0" : "")}>
        <div className={"border-b border-[#CFE0EF] bg-info-bg px-4 py-2.5" + (compact ? " max-md:hidden" : "")}>
          <span className="font-sans text-[11.5px] font-semibold text-info-fg max-md:text-[13px]">
            <span className="max-md:hidden">Input rework — {warna} · {lengan} · size {size}</span>
            <span className="md:hidden">Rework size {size}</span>
          </span>
        </div>
        {/* compact (HP): grid 6 kolom -- Qty 4/6 + Size baru 2/6 sebaris, lalu Lengan 3/6 + Kids/Dewasa 3/6. */}
        <div className={"grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-3 px-4 py-3 max-md:gap-x-3 max-md:gap-y-3.5 " + (compact ? "max-md:grid-cols-6" : "max-md:grid-cols-2")}>
          <div className={fieldCard + (compact ? " max-md:order-1 max-md:col-span-4" : " max-md:col-span-2")}>
            <div className="flex items-baseline justify-between gap-2">
              <span className={fieldLabel}>
                Qty<span className="max-md:hidden"> dirework</span>
              </span>
              <span className="whitespace-nowrap font-mono text-[10px] text-text-muted max-md:text-[11px]">
                sisa<span className="max-md:hidden"> reject</span> <span className="font-semibold text-[#31414F]">{max}</span>
              </span>
            </div>
            {/* ▼/▲ = -1/+1 dan "Maks" = isi sebesar sisa reject (pola sama Input qty per size di Finish Good). */}
            <div className="flex h-9 items-stretch overflow-hidden rounded-md border border-[#DDE4EB] bg-white max-md:h-11 max-md:rounded-xl">
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
          <div className={fieldCard + (compact ? " max-md:order-3 max-md:col-span-3" : "")}>
            <span className={fieldLabel}>Lengan hasil</span>
            <select value={toLengan} onChange={(e) => setToLengan(e.target.value as Lengan)} className="input h-9 w-full text-[12.5px] font-medium max-md:h-11 max-md:rounded-xl">
              {reworkLenganOptionsFor(lengan).map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
          </div>
          <div className={fieldCard + (compact ? " max-md:order-4 max-md:col-span-3" : "")}>
            <span className={fieldLabel}>Kids / Dewasa</span>
            <select
              value={usia}
              onChange={(e) => {
                const next = e.target.value as Usia;
                setUsia(next);
                // size yang sudah dipilih tapi tidak sah untuk usia baru -> dikosongkan
                if (toSize && !sizeOptionsFor(next).includes(toSize)) setToSize("");
              }}
              className="input h-9 w-full text-[12.5px] font-medium max-md:h-11 max-md:rounded-xl"
            >
              {USIA_OPTIONS.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </select>
          </div>
          <div className={fieldCard + (compact ? " max-md:order-2 max-md:col-span-2" : " max-md:col-span-2")}>
            <span className={fieldLabel}>Size baru</span>
            <select value={toSize} onChange={(e) => setToSize(e.target.value)} className="input h-9 w-full text-[12.5px] font-medium max-md:h-11 max-md:rounded-xl">
              <option value="">{compact ? "Pilih" : "— pilih size —"}</option>
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
        <div className="flex items-center justify-between gap-4 border-t border-[#CFE0EF] bg-[#F3F8FD] px-4 py-3 max-md:flex-col max-md:items-stretch max-md:gap-2.5">
          <span className="font-sans text-[11px] leading-[1.5] text-text-muted">
            <span className="max-md:hidden">
              {usia === "KIDS" ? "Hasil Kids: kain Dewasa dipotong ke ukuran lebih kecil — semua size Kids (XS–2XL) boleh dipilih." : `Size tujuan sama atau lebih kecil dari ${size}, tidak bisa menambah kain.`}
              {lengan === "PENDEK" && " Lengan PENDEK tidak bisa dipanjangkan."}
            </span>
            <span className="md:hidden">{usia === "KIDS" ? "Kids: semua size XS–2XL boleh." : `Size baru maks ${size}.`}</span>
          </span>
          <div className="flex shrink-0 items-center gap-2">
            <Button onClick={onDone} disabled={submitting} variant="ghost" size="md" className="max-md:min-h-11 max-md:rounded-full">
              Batal
            </Button>
            <Button onClick={submit} disabled={!toSize.trim() || qty <= 0 || submitting} variant="primary" size="md" className="min-w-[130px] max-md:min-h-11 max-md:flex-1 max-md:rounded-full">
              {submitting ? "Menyimpan…" : "Simpan Rework"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Remark sisa reject per warna/lengan dengan tombol KONFIRMASI. Remark terkonfirmasi = sisa reject warna ini dianggap sudah ditangani
 *  vendor (badge "Reject & Rework" tidak lagi menghitungnya). "Batalkan" mengosongkan remark -> kembali dihitung. */
export function GroupRemarkBox({ groupKey, vendorProduksi, fallback }: { groupKey: string; vendorProduksi: string; fallback?: string }) {
  const meta = useMrpStore((s) => s.productionGroupMeta.find((m) => m.groupKey === groupKey && m.vendorProduksi === vendorProduksi));
  const setGroupRejectRemark = useMrpStore((s) => s.setGroupRejectRemark);
  const saved = meta?.remarkSisaReject?.trim() ?? "";
  const [draft, setDraft] = useState<string | null>(null); // null = tidak sedang mengedit
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const editing = draft !== null || !saved;
  const value = draft ?? saved ?? "";
  const shown = draft !== null ? draft : saved || fallback || "";

  async function save(text: string) {
    setSaving(true);
    setError(null);
    try {
      await setGroupRejectRemark(groupKey, vendorProduksi, text);
      setDraft(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal menyimpan remark.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mt-3 rounded-md border border-[#CFE0EF] bg-white px-4 py-3 max-md:rounded-2xl max-md:border-[#EDE8E2]">
      <div className="mb-1.5 font-sans text-[10.5px] font-semibold uppercase tracking-wider text-text-muted">
        Remark<span className="max-md:hidden"> sisa reject</span>
      </div>
      {editing ? (
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={shown}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Catatan sisa reject warna ini (mis. M tidak dirework, L dirework ke S)…"
            className="input min-w-[260px] flex-1 text-[11.5px] max-md:h-11 max-md:min-w-0 max-md:basis-full max-md:rounded-xl"
            disabled={saving}
          />
          <Button onClick={() => void save(shown)} disabled={!shown.trim() || saving} variant="primary" size="md" className="max-md:min-h-11 max-md:flex-1 max-md:rounded-full">
            {saving ? "Menyimpan…" : "Konfirmasi"}
          </Button>
          {saved && draft !== null && (
            <Button onClick={() => setDraft(null)} disabled={saving} variant="ghost" size="md">
              Batal
            </Button>
          )}
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <span className="rounded-full bg-success-bg px-2.5 py-1 font-sans text-[10.5px] font-semibold text-success-fg">✓ Dikonfirmasi</span>
          <span className="min-w-0 flex-1 font-mono text-[11.5px] text-[#31414F]">{value || saved}</span>
          <Button onClick={() => setDraft(saved)} variant="muted" size="xs">
            Ubah
          </Button>
          <Button onClick={() => void save("")} disabled={saving} variant="danger" size="xs">
            Batalkan
          </Button>
        </div>
      )}
      <div className="mt-1.5 font-sans text-[10.5px] leading-[1.5] text-text-muted max-md:hidden">
        {saved
          ? "Warna ini sudah ditandai ditangani — tidak lagi dihitung di badge. Sisa reject-nya sekarang bisa dikirim lewat halaman Pengiriman."
          : "Setelah dikonfirmasi, sisa reject warna ini tidak lagi dihitung sebagai pekerjaan tertunda (badge padam) dan bisa dikirim lewat halaman Pengiriman."}
      </div>
      <div className="mt-1.5 font-sans text-[11.5px] leading-[1.5] text-text-muted md:hidden">
        {saved ? "Sudah dikonfirmasi — sisa reject bisa dikirim di Pengiriman." : "Konfirmasi supaya sisa reject bisa dikirim di Pengiriman."}
      </div>
      {error && <div className="mt-1.5 font-sans text-[11px] text-danger-fg">{error}</div>}
    </div>
  );
}

/** fromSize TIDAK disimpan terstruktur -- cuma ikut di teks `note` baris FG ("Rework dari {lengan} size {fromSize} ({usia})"), jadi
 *  di-parse balik (lihat reworkRejectSizeAction di lib/mrp/actions.ts). toSize terstruktur: satu-satunya key `sizeQty` baris FG itu. */
function parseFromSize(note: string): string | null {
  const m = note.match(/size\s+(\S+)/i);
  return m ? m[1] : null;
}
/** Lengan ASAL rework dari teks note ("Rework dari PENDEK size L (DEWASA)"). */
function parseFromLengan(note: string): string | null {
  const m = note.match(/dari\s+(PENDEK|PANJANG)/i);
  return m ? m[1].toUpperCase() : null;
}

/** Riwayat rework vendor ini (terbaru di atas) + koreksi Sysadmin "Batalkan rework". */
export function ReworkHistoryCard({ vendorId }: { vendorId: string }) {
  const mrpDetails = useMrpStore((s) => s.mrpDetails);
  const productionResults = useMrpStore((s) => s.productionResults);
  const productionGroupMeta = useMrpStore((s) => s.productionGroupMeta);
  const rejectRemarks = useMrpStore((s) => s.rejectRemarks);
  const reworkHistory = productionResults
    .filter((r) => r.vendorProduksi === vendorId && r.kind === "FG" && (r.note ?? "").startsWith("Rework"))
    .sort((a, b) => (a.recordedAt < b.recordedAt ? 1 : -1));
  // Template tabel sama dengan tabel Reject & Rework di atas: header biru muda + garis biru tebal; semua kolom rata tengah.
  const COLS = "grid-cols-[1.1fr_1fr_1.4fr_0.8fr_0.8fr_0.9fr_0.6fr_1.8fr_1.1fr]";
  // HP portal vendor (owner 2026-11-01): ringkasan per size -- dijumlah per MRP · warna · lengan asal, lalu per
  // "size asal -> size hasil (usia)". Tampil lewat .vp-rw-summary; daftar per catatan (.vp-rw-detail) disembunyikan.
  const summary = new Map<string, { mrpId: string; label: string; rows: Map<string, { from: string; to: string; usia?: string; qty: number }> }>();
  for (const r of reworkHistory) {
    const note = r.note ?? "";
    const fromLengan = parseFromLengan(note) ?? r.lengan;
    const gk = `${r.mrpId}|${r.warna}|${fromLengan}`;
    const group = summary.get(gk) ?? { mrpId: r.mrpId, label: `${r.warna} · ${fromLengan}`, rows: new Map() };
    const from = parseFromSize(note) ?? "—";
    const to = Object.keys(r.sizeQty)[0] ?? "—";
    const rk = `${from}|${to}|${r.usia ?? ""}`;
    const row = group.rows.get(rk) ?? { from, to, usia: r.usia, qty: 0 };
    row.qty += Object.values(r.sizeQty).reduce((a, b) => a + b, 0);
    group.rows.set(rk, row);
    summary.set(gk, group);
  }
  return (
    <div className="overflow-hidden rounded-lg border border-border-subtle bg-surface-card">
      <div className="border-b border-border-subtle px-4 py-3 font-sans text-[13px] font-semibold text-text-primary">Riwayat rework</div>
      <div className="vp-rw-summary hidden">
        {summary.size === 0 && <div className="px-4 py-6 text-center font-sans text-[13px] text-text-muted">Belum ada rework.</div>}
        {Array.from(summary.values()).map((group) => {
          const rows = Array.from(group.rows.values());
          return (
            <div key={group.mrpId + group.label} className="border-b border-[#F1F4F7] px-4 py-3.5 last:border-b-0">
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-sans text-[14px] font-semibold text-text-primary">{group.label}</span>
                <span className="font-mono text-[11.5px] text-text-muted">{group.mrpId}</span>
              </div>
              <div className="mt-2 flex flex-col gap-1.5">
                {rows.map((row) => (
                  <div key={row.from + row.to + (row.usia ?? "")} className="flex items-center justify-between gap-3 rounded-xl bg-[#F7F5F2] px-3 py-2">
                    <span className="flex items-center gap-2 font-mono text-[14px] font-semibold text-text-primary">
                      {row.from} <span className="font-sans text-text-muted">→</span> {row.to}
                      {row.usia && (
                        <span className={"rounded-full px-2 py-px font-sans text-[10.5px] font-semibold " + (row.usia === "KIDS" ? "bg-info-bg text-info-fg" : "bg-[#EFEBE6] text-text-muted")}>
                          {row.usia === "KIDS" ? "Kids" : "Dewasa"}
                        </span>
                      )}
                    </span>
                    <span className="font-mono text-[14px] font-semibold text-success-fg">{row.qty} pcs</span>
                  </div>
                ))}
              </div>
              {rows.length > 1 && (
                <div className="mt-1.5 text-right font-sans text-[12px] text-text-muted">
                  Total <b className="font-mono text-text-primary">{rows.reduce((a, r) => a + r.qty, 0)} pcs</b>
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div className="vp-rw-detail overflow-x-auto">
        <div className="min-w-[1050px] m-fluid">
          <div className={"m-hide grid items-center gap-x-3 border-b-2 border-accent-blue bg-info-bg px-4 py-[9px] text-center font-sans text-[10.5px] font-medium uppercase tracking-wider text-info-fg " + COLS}>
            <span>MRP</span>
            <span>Kategori</span>
            <span>Warna / lengan</span>
            <span>Usia</span>
            <span>Size (Reject)</span>
            <span>Size (Hasil Rework)</span>
            <span>Qty</span>
            <span>Catatan</span>
            <span>Tanggal</span>
          </div>
          {reworkHistory.length === 0 && <div className="px-4 py-6 text-center font-sans text-xs text-text-muted">Belum ada rework.</div>}
          {reworkHistory.map((r) => {
            const note = r.note ?? "";
            const fromSize = parseFromSize(note);
            const fromLengan = parseFromLengan(note);
            const toSize = Object.keys(r.sizeQty)[0] ?? "—";
            // Catatan = remark sisa reject warna ASAL (group_key reject = mrp|warna|lengan asal); fallback remark lama per PO.
            const sourceKey = fromLengan ? `${r.mrpId}|${r.warna}|${fromLengan}` : "";
            const remark = (sourceKey && productionGroupMeta.find((m) => m.groupKey === sourceKey && m.vendorProduksi === r.vendorProduksi)?.remarkSisaReject?.trim()) || rejectRemarks[r.poId] || "";
            return (
              <div key={r.id} className="border-b border-[#F1F4F7] last:border-b-0">
                <div className={"vp-rwhist m-stack grid items-center gap-x-3 px-4 py-[11px] text-center font-sans text-xs text-[#31414F] " + COLS}>
                  <span data-label="MRP" className="font-mono">{r.mrpId}</span>
                  <span data-label="Kategori">{mrpDetailFor(r.mrpId, mrpDetails)?.mrp.kategori ?? "—"}</span>
                  <span data-label="Warna / lengan">
                    {r.warna} · {r.lengan}
                  </span>
                  <span data-label="Usia">{r.usia ?? "—"}</span>
                  <span data-label="Size (Reject)" className="font-mono font-medium">{fromSize ?? "—"}</span>
                  <span data-label="Size (Hasil)" className="font-mono font-medium">{toSize}</span>
                  <span data-label="Qty" className="font-mono font-medium">{Object.values(r.sizeQty).reduce((a, b) => a + b, 0)}</span>
                  <span data-label="Catatan" className={remark ? "" : "text-text-muted"}>{remark || "—"}</span>
                  <span data-label="Tanggal" className="font-mono text-[11px] text-text-muted">{formatDateTimeShort(r.recordedAt)}</span>
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
