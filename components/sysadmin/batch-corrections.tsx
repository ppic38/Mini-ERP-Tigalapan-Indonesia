"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { CorrectionDialog, SysadminActionsBar, type CorrectionAction } from "@/components/sysadmin/correction-dialog";
import { useSysadminMode } from "@/lib/shell/use-sysadmin-mode";
import { formatDecimal, getWeightTolerancePct, weightVariance } from "@/lib/mrp/derive";
import { sysadminSetBatchNetWeightAction, sysadminUndoCuttingAction, sysadminUndoRestingAction } from "@/lib/mrp/sysadminActions";
import type { ProductionBatch, RawMaterialInvoice } from "@/lib/mrp/types";

// Koreksi Sysadmin per roll di tab Cutting portal Vendor Produksi (owner 2026-09-30). Aturan di sini hanya
// untuk UI (tombol nonaktif + alasan); server (sysadminActions.ts) memeriksa ulang semuanya, termasuk hal
// yang tidak terlihat di klien (progres Finish Good tersimpan, koli, status Selesai/Final grup).

/** Alasan roll ini tidak bisa dikoreksi dari sini, atau undefined kalau boleh (cermin loadBatchUntouchedByFg). */
function batchBlock(b: ProductionBatch): string | undefined {
  if (b.closedAt) return "Roll sudah ditutup (Tutup Roll) — buka lagi dulu dari portal vendor";
  if (b.fgSizeQty && Object.keys(b.fgSizeQty).length > 0) return "Roll sudah punya progres Finish Good";
  return undefined;
}

function batchActions(b: ProductionBatch): CorrectionAction[] {
  const label = `${b.codeRoll ?? b.id} · ${b.warna} · ${b.lengan === "PENDEK" ? "Pendek" : "Panjang"}`;
  if (!b.cuttingAt) {
    return [
      {
        key: "undo-resting",
        label: "Batalkan resting",
        danger: true,
        disabledReason: batchBlock(b),
        title: `Batalkan resting ${label}`,
        impact: [
          "Roll dikeluarkan dari produksi (data resting dihapus) dan kembali ke daftar roll yang siap diresting.",
          "Berat bersih dan data roll fisik TIDAK berubah. Hanya untuk roll yang belum punya hasil cutting.",
          "Data lama tercatat di Log Audit. Vendor menerima notifikasi.",
        ],
        confirmLabel: "Batalkan resting",
        run: (reason) => sysadminUndoRestingAction(b.id, reason),
      },
    ];
  }
  return [
    {
      key: "undo-cutting",
      label: "Batalkan cutting",
      danger: true,
      disabledReason: batchBlock(b),
      title: `Batalkan hasil cutting ${label}`,
      impact: [
        "Hasil cutting per size dihapus dan roll kembali ke status resting; vendor menginput ulang hasil cutting.",
        "Resolusi yield alert roll ini (kalau ada) ikut dihapus supaya alert tidak salah tampil “sudah ditindak”.",
        "Hanya untuk roll yang belum punya Finish Good/koli, dan grupnya belum Selesai/Final. Vendor menerima notifikasi.",
      ],
      confirmLabel: "Batalkan hasil cutting",
      run: (reason) => sysadminUndoCuttingAction(b.id, reason),
    },
  ];
}

/** Roll fisik milik batch (cocokkan code roll di invoice vendor ini) beserta berat kotor & berat bersih tersimpan. */
function findRoll(b: ProductionBatch, invoices: RawMaterialInvoice[]): { grossKg: number; netKg: number } | null {
  if (!b.codeRoll) return null;
  for (const inv of invoices) {
    if (inv.mrpId !== b.mrpId || inv.destinationVendor !== b.vendorProduksi) continue;
    const key = `${b.warna}|${b.lengan}`;
    const receipts = inv.rollReceipts[key] ?? [];
    const idx = receipts.findIndex((r) => r?.codeRoll === b.codeRoll);
    if (idx === -1) continue;
    const grossKg = inv.colorEntries.find((c) => c.warna === b.warna && c.lengan === b.lengan)?.rolls[idx];
    const netKg = receipts[idx]?.netKg;
    if (grossKg != null && netKg != null) return { grossKg, netKg };
  }
  return null;
}

function WeightDialog({ batch, roll, onClose }: { batch: ProductionBatch; roll: { grossKg: number; netKg: number }; onClose: () => void }) {
  const [value, setValue] = useState(String(roll.netKg));
  const n = Number(value.replace(",", "."));
  const valid = Number.isFinite(n) && n > 0 && n !== roll.netKg;
  const variance = valid ? weightVariance(roll.grossKg, n) : null;
  const outOfTolerance = variance?.claimable ?? false;
  return (
    <CorrectionDialog
      title={`Koreksi berat bersih ${batch.codeRoll ?? batch.id}`}
      impact={[
        `Berat kotor ${formatDecimal(roll.grossKg)} kg, berat bersih tersimpan ${formatDecimal(roll.netKg)} kg.`,
        `Hanya berat yang TIDAK menjadi klaim selisih berat (dalam toleransi ${getWeightTolerancePct()}% yang diatur SCM, atau lebih berat dari berat kotor). Klaim butuh foto bukti dan alur retur Procurement, tidak bisa dibuat dari sini.`,
        "Vendor dan Procurement menerima notifikasi.",
      ]}
      confirmLabel="Simpan berat"
      extraValid={valid && !outOfTolerance}
      onRun={(reason) => sysadminSetBatchNetWeightAction(batch.id, n, reason)}
      onClose={onClose}
    >
      <div>
        <div className="mb-1 font-sans text-[10.5px] font-medium uppercase tracking-wider text-text-muted">Berat bersih baru (kg)</div>
        <input value={value} onChange={(e) => setValue(e.target.value)} inputMode="decimal" className="input w-full font-mono" />
        {variance && (
          <div className={"mt-1 font-sans text-[11px] " + (outOfTolerance ? "font-semibold text-danger-fg" : "text-text-muted")}>
            Selisih terhadap berat kotor: {variance.diff >= 0 ? "+" : ""}
            {formatDecimal(variance.diff)} kg ({variance.pct.toFixed(1)}%){outOfTolerance ? " — di luar toleransi, menjadi klaim; tidak bisa disimpan dari sini" : ""}
          </div>
        )}
      </div>
    </CorrectionDialog>
  );
}

/** Tombol koreksi Sysadmin untuk 1 roll (batch) di tab Cutting: batalkan resting / batalkan hasil cutting,
 *  plus koreksi berat bersih. Tidak render apa pun kalau bukan Mode Sysadmin. */
export function SysadminBatchActions({ batch, invoices }: { batch: ProductionBatch; invoices: RawMaterialInvoice[] }) {
  const sysadmin = useSysadminMode();
  const [weightOpen, setWeightOpen] = useState(false);
  if (!sysadmin) return null;
  const roll = findRoll(batch, invoices);
  return (
    <div onClick={(e) => e.stopPropagation()} className="flex flex-wrap items-center gap-1">
      <SysadminActionsBar compact actions={batchActions(batch)} />
      {roll && (
        <Button onClick={() => setWeightOpen(true)} disabled={!!batchBlock(batch)} title={batchBlock(batch)} variant="ghost" size="xs">
          Koreksi berat
        </Button>
      )}
      {weightOpen && roll && <WeightDialog batch={batch} roll={roll} onClose={() => setWeightOpen(false)} />}
    </div>
  );
}
