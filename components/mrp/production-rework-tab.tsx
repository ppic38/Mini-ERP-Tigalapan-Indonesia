"use client";

import { Fragment, useState } from "react";
import { NumberInput } from "@/components/mrp/number-input";
import { Button } from "@/components/ui/button";
import { useMrpStore } from "@/lib/mrp/store";
import { cumulativeSizeQtyForGroup, cutWarnaLenganGroups, formatDateTimeShort, mrpDetailFor, mrpIdsWithRemainingReject, productionGroupMetaFor, reworkTargetSizeAllowed, KIDS_SIZES, sizeIndex } from "@/lib/mrp/derive";
import { countRemainingRejectGroupsForMrp, pendingMarker } from "@/lib/shell/badges";
import { SysadminPanel } from "@/components/sysadmin/correction-dialog";
import { reworkUndoCorrections } from "@/components/sysadmin/vendor-corrections";
import type { Lengan, Usia } from "@/lib/mrp/types";

const USIA_OPTIONS: Usia[] = ["DEWASA", "KIDS"];

/** Rework fisik cuma bisa memotong lengan PANJANG jadi PENDEK (sisa potongan lengan) — lengan
 *  yang sudah PENDEK tidak bisa "dipanjangkan" lagi, jadi satu-satunya tujuan valid untuk reject
 *  PENDEK adalah tetap PENDEK (size lain), sedangkan reject PANJANG bisa jadi PANJANG atau
 *  PENDEK. Guard yang sama dicek lagi server-side di reworkRejectSizeAction. */
function reworkLenganOptionsFor(fromLengan: Lengan): Lengan[] {
  return fromLengan === "PANJANG" ? ["PANJANG", "PENDEK"] : ["PENDEK"];
}

export function ProductionReworkTab({ vendorId }: { vendorId: string }) {
  const mrpDetails = useMrpStore((s) => s.mrpDetails);
  const productionBatches = useMrpStore((s) => s.productionBatches);
  const productionResults = useMrpStore((s) => s.productionResults);
  const productionGroupMeta = useMrpStore((s) => s.productionGroupMeta);
  const reworkRejectSize = useMrpStore((s) => s.reworkRejectSize);

  const [selectedMrpId, setSelectedMrpId] = useState("");
  const [reworking, setReworking] = useState<{ warna: string; lengan: Lengan; size: string; max: number } | null>(null);
  const [qty, setQty] = useState(1);
  const [toLengan, setToLengan] = useState<Lengan>("PENDEK");
  const [toSize, setToSize] = useState("");
  const [usia, setUsia] = useState<Usia>("DEWASA");
  // Pesan error dari reworkRejectSize -- dulu kalau grup sudah "Selesai Produksi" action-nya diam-
  // diam tidak melakukan apa-apa (tidak ada error, tidak ada perubahan), jadi terlihat seperti
  // tombol tidak berfungsi. Sekarang server melempar error yang ditangkap & ditampilkan di sini
  // (lihat juga filter `groups` di bawah — grup yang sudah selesai sekarang tidak lagi ditampilkan
  // di daftar sisa reject, supaya kasus ini jarang kejadian dari awal).
  const [actionError, setActionError] = useState<string | null>(null);
  // Item revisi 2026-09-07 (owner: aksi vendor produksi terasa lambat -- tidak ada tanda loading
  // sama sekali sebelum ini): pola sama seperti submitResting di production-cutting-tab.tsx.
  const [submitting, setSubmitting] = useState(false);

  const mrpIds = mrpIdsWithRemainingReject(vendorId, productionBatches, productionResults, productionGroupMeta);
  // Grup yang sudah "Selesai Produksi" dikunci (lihat markProductionGroupDoneAction) -- tidak
  // ditampilkan lagi sebagai baris "sisa reject" yang bisa di-rework, supaya tidak mengarahkan
  // vendor ke aksi yang pasti akan ditolak server (buka kunci dulu di tab Final Produksi kalau
  // memang masih perlu rework).
  const allGroups = selectedMrpId ? cutWarnaLenganGroups(selectedMrpId, vendorId, productionBatches) : [];
  const groups = allGroups.filter((g) => !productionGroupMetaFor(selectedMrpId + "|" + g.warna + "|" + g.lengan, productionGroupMeta)?.doneAt);
  const lockedGroupCount = allGroups.length - groups.length;
  const selectedKategori = selectedMrpId ? (mrpDetailFor(selectedMrpId, mrpDetails)?.mrp.kategori ?? "—") : "";
  // Size TUNGGAL yang dikenal untuk MRP ini -- dipakai sebagai pilihan dropdown "Size baru (hasil
  // rework)". Revisi 2026-09-23 (owner: "kenapa malah masuk size aduan pairing? kan ini untuk
  // rework"): `aduanRows[].sizes[].size` MENTAH bisa berupa label PASANGAN cutting seperti "L-L",
  // "M-L-XL", atau bahkan "S-2XL, S-XL" (2 pasangan sekaligus, dipisah koma) -- itu representasi
  // layout potong, BUKAN satu ukuran baju. Rework menghasilkan 1 potongan baju BERUKURAN TUNGGAL,
  // jadi label pasangan itu dipecah dulu per token (koma & strip) sebelum di-dedup -- "S-2XL, S-XL"
  // jadi kandidat {S, 2XL, XL} masing-masing berdiri sendiri, bukan tetap sebagai 1 pilihan gabungan.
  const knownSizes = Array.from(
    new Set(
      (mrpDetailFor(selectedMrpId, mrpDetails)?.aduanRows ?? []).flatMap((a) =>
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

  function openRework(warna: string, lengan: Lengan, size: string, max: number) {
    setActionError(null);
    setReworking({ warna, lengan, size, max });
    setQty(Math.min(1, max));
    setToLengan(reworkLenganOptionsFor(lengan)[0]);
    setToSize("");
    setUsia("DEWASA");
  }

  async function submitRework() {
    if (!reworking || !toSize.trim() || qty <= 0 || submitting) return;
    // Guard lagi di client (selain di server) — dropdown toLengan sudah dibatasi opsinya lewat
    // reworkLenganOptionsFor, tapi dicek ulang di sini kalau-kalau state-nya nyangkut.
    if (reworking.lengan === "PENDEK" && toLengan === "PANJANG") return;
    setActionError(null);
    setSubmitting(true);
    try {
      await reworkRejectSize({
        mrpId: selectedMrpId,
        vendorProduksi: vendorId,
        warna: reworking.warna,
        lengan: reworking.lengan,
        fromSize: reworking.size,
        qty: Math.min(qty, reworking.max),
        toLengan,
        toSize: toSize.trim(),
        usia,
      });
      setReworking(null);
      setToSize("");
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Gagal menyimpan rework.");
    } finally {
      setSubmitting(false);
    }
  }

  const reworkHistory = productionResults.filter((r) => r.vendorProduksi === vendorId && r.kind === "FG" && (r.note ?? "").startsWith("Rework")).sort((a, b) => (a.recordedAt < b.recordedAt ? 1 : -1));

  // Owner 2026-09-24 (screenshot "Riwayat rework" -- "tambahkan informasi mengenai rework dari
  // size apa ke size apa"): fromSize TIDAK pernah disimpan sebagai kolom terstruktur -- cuma ikut
  // dalam teks bebas `note` baris FG ("Rework dari {lengan} size {fromSize} ({usia})", lihat
  // reworkRejectSizeAction di lib/mrp/actions.ts) -- jadi di-parse balik dari situ dengan regex.
  // toSize SUDAH terstruktur -- key satu-satunya di `sizeQty` baris FG hasil rework (isinya selalu
  // persis 1 entri: {toSize: qty}, lihat insert production_result_sizes di action yang sama).
  function parseFromSize(note: string): string | null {
    const m = note.match(/size\s+(\S+)/i);
    return m ? m[1] : null;
  }

  // Opsi size tujuan: Kids = seluruh size Kids (XS - 2XL, kain Dewasa dipotong ke ukuran lebih kecil); Dewasa = size MRP ini
  // yang sama atau lebih kecil dari size asal (lihat reworkTargetSizeAllowed -- divalidasi ulang server-side).
  function sizeOptionsFor(fromSize: string, u: Usia): string[] {
    return u === "KIDS" ? KIDS_SIZES : knownSizes.filter((s) => reworkTargetSizeAllowed(fromSize, s, u));
  }

  function renderReworkForm(r: { warna: string; lengan: Lengan; size: string; max: number }) {
    const options = sizeOptionsFor(r.size, usia);
    const fieldCard = "flex flex-col gap-2 rounded-lg border-2 border-[#BCD3E8] bg-white px-3.5 py-3 shadow-[0_1px_3px_rgba(11,19,27,.08)]";
    const fieldLabel = "font-sans text-[10.5px] font-semibold uppercase tracking-wider text-text-muted";
    return (
      <div className="border-b border-[#CFE0EF] bg-info-bg px-4 py-4">
        <div className="overflow-hidden rounded-md border border-[#A8C5DF] bg-white">
          <div className="flex items-center justify-between gap-3 border-b border-[#CFE0EF] bg-info-bg px-4 py-2.5">
            <span className="font-sans text-[11.5px] font-semibold text-info-fg">
              Input rework — {r.warna} · {r.lengan} · size {r.size}
            </span>
            <span className="font-mono text-[10.5px] text-text-muted">
              sisa reject <b className="text-text-primary">{r.max}</b> pcs
            </span>
          </div>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-3 px-4 py-3">
            <div className={fieldCard}>
              <span className={fieldLabel}>Qty dirework</span>
              <NumberInput value={qty} onChange={(v) => setQty(Math.max(1, Math.min(v, r.max)))} decimals={0} className="input h-9 w-full text-right text-[13px] font-semibold" />
            </div>
            <div className={fieldCard}>
              <span className={fieldLabel}>Lengan hasil</span>
              <select value={toLengan} onChange={(e) => setToLengan(e.target.value as Lengan)} className="input h-9 w-full text-[12.5px] font-medium">
                {reworkLenganOptionsFor(r.lengan).map((l) => (
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
                  if (toSize && !sizeOptionsFor(r.size, next).includes(toSize)) setToSize("");
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
              {options.length === 0 && <span className="font-sans text-[10px] text-danger-fg">Tidak ada size ≤ {r.size} untuk MRP ini.</span>}
            </div>
          </div>
          <div className="flex items-center justify-between gap-4 border-t border-[#CFE0EF] bg-[#F3F8FD] px-4 py-3">
            <span className="font-sans text-[11px] leading-[1.5] text-text-muted">
              {usia === "KIDS"
                ? "Hasil Kids: kain Dewasa dipotong ke ukuran lebih kecil — semua size Kids (XS–2XL) boleh dipilih."
                : `Size tujuan sama atau lebih kecil dari ${r.size}, tidak bisa menambah kain.`}
              {r.lengan === "PENDEK" && " Lengan PENDEK tidak bisa dipanjangkan."}
            </span>
            <div className="flex shrink-0 items-center gap-2">
              <Button onClick={() => setReworking(null)} disabled={submitting} variant="ghost" size="md">
                Batal
              </Button>
              <Button onClick={submitRework} disabled={!toSize.trim() || submitting} variant="primary" size="md" className="min-w-[130px]">
                {submitting ? "Menyimpan…" : "Simpan Rework"}
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="rounded-lg border border-border-subtle bg-surface-card px-4 py-3.5">
        <div className="font-sans text-[11px] font-medium uppercase tracking-wider text-text-muted">Pilih MRP</div>
        <select
          value={selectedMrpId}
          onChange={(e) => {
            setSelectedMrpId(e.target.value);
            setReworking(null);
          }}
          className="mt-1 w-full max-w-[420px] rounded-md border border-[#DDE4EB] px-[11px] py-[9px] font-sans text-[12.5px] font-medium text-text-primary"
        >
          <option value="">— pilih MRP —</option>
          {mrpIds.map((id) => (
            <option key={id} value={id}>
              {id}
              {pendingMarker(countRemainingRejectGroupsForMrp(id, vendorId, productionBatches, productionResults, productionGroupMeta), "warna/lengan ada sisa reject")}
            </option>
          ))}
        </select>
        {mrpIds.length === 0 && <div className="mt-2 font-sans text-xs text-text-muted">Belum ada MRP dengan sisa reject yang belum di-rework.</div>}
        {selectedMrpId && (
          <div className="mt-2 font-sans text-[11.5px] text-text-muted">
            Kategori: <span className="font-semibold text-text-primary">{selectedKategori}</span>
          </div>
        )}
      </div>

      {actionError && (
        <div className="rounded-lg border border-[#EFC9C4] bg-danger-bg px-4 py-3 font-sans text-[11.5px] leading-[1.5] text-danger-fg">{actionError}</div>
      )}

      {selectedMrpId && (
        <div className="overflow-hidden rounded-lg border border-border-subtle bg-surface-card">
          <div className="border-b border-border-subtle px-4 py-3 font-sans text-[13px] font-semibold text-text-primary">Sisa reject — {selectedMrpId}</div>
          {lockedGroupCount > 0 && (
            <div className="border-b border-border-subtle bg-[#F7F9FB] px-4 py-2 font-sans text-[11px] text-text-muted">
              {lockedGroupCount} warna/lengan sudah ditandai &quot;Selesai Produksi&quot; — tidak ditampilkan di sini lagi. Buka kunci dulu di tab Final Produksi kalau masih perlu rework.
            </div>
          )}
          <div className="grid grid-cols-5 gap-x-2 border-b border-border-subtle bg-[#F7F9FB] px-4 py-[9px] font-sans text-[10.5px] font-medium uppercase tracking-wider text-text-muted">
            <span>Kategori</span>
            <span>Warna / lengan</span>
            <span>Size</span>
            <span className="text-right">Sisa reject</span>
            <span />
          </div>
          {groups.flatMap((g) => {
            const groupKey = selectedMrpId + "|" + g.warna + "|" + g.lengan;
            const remaining = cumulativeSizeQtyForGroup(groupKey, "REJECT", productionResults);
            return Object.entries(remaining)
              .filter(([, qty]) => qty > 0)
              .map(([size, remainingQty]) => {
                const isOpen = !!reworking && reworking.warna === g.warna && reworking.lengan === g.lengan && reworking.size === size;
                return (
                  <Fragment key={groupKey + size}>
                    <div className={"grid grid-cols-5 items-center gap-x-2 border-b border-[#F1F4F7] px-4 py-[11px] font-sans text-xs text-[#31414F] " + (isOpen ? "bg-info-bg" : "")}>
                      <span>{selectedKategori}</span>
                      <span>
                        {g.warna} · {g.lengan}
                      </span>
                      <span className="font-mono font-medium">{size}</span>
                      <span className="text-right font-mono text-danger-fg">{remainingQty}</span>
                      <span className="text-right">
                        {isOpen ? (
                          <Button onClick={() => setReworking(null)} variant="accent" size="xs" disabled={submitting}>
                            Tutup
                          </Button>
                        ) : (
                          <Button onClick={() => openRework(g.warna, g.lengan, size, remainingQty)} variant="primary" size="xs">
                            Rework jadi baju →
                          </Button>
                        )}
                      </span>
                    </div>
                    {isOpen && reworking && renderReworkForm(reworking)}
                  </Fragment>
                );
              });
          })}
          {groups.every((g) => Object.values(cumulativeSizeQtyForGroup(selectedMrpId + "|" + g.warna + "|" + g.lengan, "REJECT", productionResults)).every((v) => v <= 0)) && (
            <div className="px-4 py-6 text-center font-sans text-xs text-text-muted">Tidak ada sisa reject untuk MRP ini.</div>
          )}

        </div>
      )}

      <div className="overflow-hidden rounded-lg border border-border-subtle bg-surface-card">
        <div className="border-b border-border-subtle px-4 py-3 font-sans text-[13px] font-semibold text-text-primary">Riwayat rework</div>
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
              {/* Koreksi Sysadmin (owner 2026-09-30): vendor tidak punya cara membatalkan rework yang
                  salah. `empty:hidden` -- wadah tidak makan ruang kalau bukan Sysadmin. */}
              <div className="px-4 pb-2 empty:hidden">
                <SysadminPanel actions={reworkUndoCorrections(r, productionGroupMeta)} />
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
