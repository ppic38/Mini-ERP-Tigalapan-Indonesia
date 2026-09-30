"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";
import { useMrpStore } from "@/lib/mrp/store";
import { DEFAULT_WEIGHT_TOLERANCE_PCT, formatDecimal, materialClaimStage, materialClaimsList } from "@/lib/mrp/derive";
import { useSysadminMode } from "@/lib/shell/use-sysadmin-mode";

const MAX_PCT = 50;

/** Master Data SCM: toleransi selisih berat (%) antara berat kotor invoice dan berat bersih hasil timbang vendor
 *  produksi. SATU angka untuk SEMUA vendor produksi (owner 2026-09-30) -- dipakai UI Cutting vendor saat
 *  menginput berat bersih dan ditegakkan server. Hanya yang LEBIH RINGAN dari toleransi menjadi klaim; lebih
 *  berat dari berat kotor tidak pernah jadi klaim.
 *
 *  PERHATIAN yang ditampilkan di layar: klaim diturunkan LIVE dari berat tersimpan vs toleransi, jadi
 *  mengubah angka memengaruhi roll yang SUDAH ditimbang. Panel ini mensimulasikan dampaknya (klaim yang
 *  hilang / roll yang baru jadi klaim) dan MEMBLOKIR penyimpanan kalau ada klaim yang sedang diproses
 *  (sudah diterima/PV pengganti/retur) yang akan berubah status. */
export function WeightTolerancePanel() {
  const current = useMrpStore((s) => s.weightTolerancePct) ?? DEFAULT_WEIGHT_TOLERANCE_PCT;
  const invoices = useMrpStore((s) => s.invoices);
  const resolutions = useMrpStore((s) => s.materialClaimResolutions);
  const returRequests = useMrpStore((s) => s.materialClaimReturRequests);
  const returDeliveries = useMrpStore((s) => s.materialClaimReturDeliveries);
  const returReceipts = useMrpStore((s) => s.materialClaimReturReceipts);
  const replacements = useMrpStore((s) => s.materialClaimReplacements);
  const acceptances = useMrpStore((s) => s.materialClaimAcceptances);
  const updateWeightTolerancePct = useMrpStore((s) => s.updateWeightTolerancePct);
  const sysadmin = useSysadminMode();

  const [draft, setDraft] = useState(String(current));
  const [exampleGross, setExampleGross] = useState("24.45");
  const [ack, setAck] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<number | null>(null);

  const parsed = Number(draft.replace(",", "."));
  const valid = draft.trim() !== "" && Number.isFinite(parsed) && parsed >= 0 && parsed <= MAX_PCT;
  const next = valid ? Math.round(parsed * 100) / 100 : current;
  const changed = valid && next !== current;

  // Simulasi dampak: bandingkan daftar klaim BERAT dengan toleransi sekarang vs toleransi baru.
  const impact = useMemo(() => {
    if (!changed) return { removed: [], added: [], blocked: [] as string[] };
    const berat = (pct: number) => materialClaimsList(invoices, pct).filter((c) => c.reason === "BERAT");
    const oldList = berat(current);
    const newList = berat(next);
    const newKeys = new Set(newList.map((c) => c.key));
    const oldKeys = new Set(oldList.map((c) => c.key));
    const removed = oldList.filter((c) => !newKeys.has(c.key));
    const added = newList.filter((c) => !oldKeys.has(c.key));
    // Klaim yang akan hilang tapi SUDAH diproses (bukan baru "BELUM", bukan sudah "SELESAI") -- memutus alurnya di tengah.
    const blocked = removed
      .filter((c) => {
        const stage = materialClaimStage(c.key, resolutions, returRequests, returDeliveries, returReceipts, replacements, acceptances);
        return stage !== "BELUM" && stage !== "SELESAI";
      })
      .map((c) => `${c.poId} · ${c.warna} · ${c.lengan} · roll ${c.rollIndex + 1}${c.codeRoll ? ` (${c.codeRoll})` : ""}`);
    return { removed, added, blocked };
  }, [changed, invoices, current, next, resolutions, returRequests, returDeliveries, returReceipts, replacements, acceptances]);

  const needsAck = changed && (impact.removed.length > 0 || impact.added.length > 0);
  const canSave = !sysadmin && changed && !saving && impact.blocked.length === 0 && (!needsAck || ack);

  async function save() {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    setSaved(null);
    try {
      await updateWeightTolerancePct(next);
      setSaved(next);
      setAck(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal menyimpan toleransi.");
    } finally {
      setSaving(false);
    }
  }

  const gross = Number(exampleGross.replace(",", "."));
  const exampleOk = Number.isFinite(gross) && gross > 0;
  const minNet = exampleOk ? gross * (1 - next / 100) : null;

  return (
    <div className="flex flex-col gap-4">
      <div className="overflow-hidden rounded-lg border border-border-subtle bg-surface-card">
        <div className="flex items-center gap-2 border-b border-border-subtle px-5 py-3.5">
          <span className="font-sans text-[13px] font-semibold text-text-primary">Toleransi selisih berat</span>
          <StatusPill tone="info">Berlaku untuk semua vendor produksi</StatusPill>
          <span className="ml-auto font-mono text-[12px] text-text-muted">
            Saat ini: <span className="font-semibold text-text-primary">{formatDecimal(current)}%</span>
          </span>
        </div>

        <div className="grid gap-5 px-5 py-4 md:grid-cols-2">
          <div>
            <div className="font-sans text-[10.5px] font-medium uppercase tracking-wider text-text-muted">Toleransi (%)</div>
            <div className="mt-1 flex items-center gap-2">
              <input
                value={draft}
                onChange={(e) => {
                  setDraft(e.target.value);
                  setAck(false);
                  setSaved(null);
                  setError(null);
                }}
                inputMode="decimal"
                disabled={sysadmin}
                className="input w-[120px] text-right font-mono"
              />
              <span className="font-sans text-xs text-text-muted">% dari berat kotor</span>
            </div>
            {!valid && <div className="mt-1 font-sans text-[11px] text-danger-fg">Isi angka antara 0 dan {MAX_PCT}.</div>}
            <p className="mt-3 font-sans text-[11.5px] leading-[1.55] text-[#31414F]">
              Berat bersih yang <span className="font-semibold">lebih ringan</span> dari berat kotor lebih dari angka ini dihitung <span className="font-semibold">klaim selisih berat</span> (butuh foto bukti dan alur Procurement).
              Berat yang lebih berat dari berat kotor tidak pernah menjadi klaim. Vendor produksi langsung memakai angka ini saat menginput berat bersih di tab Cutting, dan server menegakkan aturan yang sama.
            </p>
          </div>

          <div className="rounded-md border border-[#E4E9EE] bg-[#FAFBFC] p-3">
            <div className="font-sans text-[10.5px] font-medium uppercase tracking-wider text-text-muted">Contoh perhitungan</div>
            <div className="mt-2 flex items-center gap-2 font-sans text-xs text-[#31414F]">
              Berat kotor
              <input value={exampleGross} onChange={(e) => setExampleGross(e.target.value)} inputMode="decimal" className="input w-[90px] text-right font-mono" />
              kg
            </div>
            {minNet != null ? (
              <div className="mt-2 font-sans text-[11.5px] leading-[1.6] text-[#31414F]">
                Toleransi {formatDecimal(next)}% = <span className="font-mono">{formatDecimal(gross * (next / 100), 3)}</span> kg.
                <br />
                Berat bersih minimal tanpa klaim: <span className="font-mono font-semibold text-text-primary">{formatDecimal(minNet, 3)} kg</span> (berat kotor × {formatDecimal(1 - next / 100, 4)}).
              </div>
            ) : (
              <div className="mt-2 font-sans text-[11.5px] text-text-muted">Isi berat kotor contoh.</div>
            )}
          </div>
        </div>

        {changed && (
          <div className="border-t border-border-subtle px-5 py-4">
            <div className="font-sans text-[11px] font-medium uppercase tracking-wider text-text-muted">
              Dampak perubahan {formatDecimal(current)}% → {formatDecimal(next)}% pada roll yang sudah ditimbang
            </div>
            <div className="mt-2 grid gap-2 md:grid-cols-2">
              <div className="rounded-md border border-[#E4E9EE] bg-white px-3 py-2 font-sans text-[11.5px] text-[#31414F]">
                <span className="font-mono text-[13px] font-semibold text-text-primary">{impact.removed.length}</span> klaim selisih berat <span className="font-semibold">hilang</span> (beratnya kini dalam toleransi)
              </div>
              <div className="rounded-md border border-[#E4E9EE] bg-white px-3 py-2 font-sans text-[11.5px] text-[#31414F]">
                <span className="font-mono text-[13px] font-semibold text-text-primary">{impact.added.length}</span> roll <span className="font-semibold">menjadi klaim baru</span> (beratnya kini di luar toleransi)
              </div>
            </div>
            {impact.blocked.length > 0 && (
              <div className="mt-2 rounded-md border border-[#EFC9C4] bg-danger-bg px-3 py-2 font-sans text-[11.5px] leading-[1.5] text-danger-fg">
                <div className="font-semibold">Tidak bisa disimpan — {impact.blocked.length} klaim yang sedang diproses akan berubah status:</div>
                <ul className="mt-1 list-disc pl-4">
                  {impact.blocked.slice(0, 6).map((b) => (
                    <li key={b} className="font-mono text-[11px]">
                      {b}
                    </li>
                  ))}
                  {impact.blocked.length > 6 && <li>…dan {impact.blocked.length - 6} lainnya</li>}
                </ul>
                <div className="mt-1">Selesaikan klaim itu dulu di Procurement → Klaim Material, atau pilih toleransi yang tidak mengubahnya.</div>
              </div>
            )}
            {impact.blocked.length === 0 && impact.added.length > 0 && (
              <div className="mt-2 rounded-md border border-[#F0DFC2] bg-warning-bg px-3 py-2 font-sans text-[11.5px] leading-[1.5] text-warning-fg">
                Roll yang sudah ditimbang (termasuk yang sudah resting) dengan berat di luar toleransi baru akan <span className="font-semibold">langsung tampil sebagai klaim</span> di Klaim Material dan terkunci untuk pemakaian berikutnya.
              </div>
            )}
            {needsAck && impact.blocked.length === 0 && (
              <label className="mt-3 flex items-center gap-2 font-sans text-[11.5px] text-[#31414F]">
                <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="h-3.5 w-3.5" />
                Saya paham dampak ini terhadap roll yang sudah ditimbang.
              </label>
            )}
          </div>
        )}

        <div className="flex items-center gap-3 border-t border-border-subtle px-5 py-3.5">
          <Button onClick={save} disabled={!canSave} variant="primary" size="md">
            {saving ? "Menyimpan…" : "Simpan toleransi"}
          </Button>
          {sysadmin && <span className="font-sans text-[11.5px] text-text-muted">Mode Sysadmin hanya melihat — toleransi diatur oleh SCM.</span>}
          {saved != null && <span className="font-sans text-[11.5px] font-medium text-success-fg">Tersimpan: {formatDecimal(saved)}% — dipakai semua vendor produksi, Procurement dan vendor diberi notifikasi.</span>}
          {error && <span className="font-sans text-[11.5px] font-medium text-danger-fg">{error}</span>}
        </div>
      </div>
    </div>
  );
}
