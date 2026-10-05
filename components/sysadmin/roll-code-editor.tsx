"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { CorrectionDialog } from "@/components/sysadmin/correction-dialog";
import { useSysadminMode } from "@/lib/shell/use-sysadmin-mode";
import { describeRollCodeConflict, findRollCodeConflict, formatDecimal } from "@/lib/mrp/derive";
import { useMrpStore } from "@/lib/mrp/store";
import { sysadminSetRollCodeAction, type SysadminRollCodePatch } from "@/lib/mrp/sysadminActions";
import type { Lengan, RawMaterialInvoice } from "@/lib/mrp/types";

type RollRow = {
  key: string;
  warna: string;
  lengan: Lengan;
  idx: number;
  grossKg: number;
  codeLot: string;
  codeRoll: string;
  arrived: boolean;
  weighed: boolean;
};

function rollRows(invoice: RawMaterialInvoice): RollRow[] {
  return invoice.colorEntries.flatMap((c) =>
    c.rolls.map((grossKg, idx): RollRow => {
      const colorKey = `${c.warna}|${c.lengan}`;
      const arrival = invoice.rollArrivals[colorKey]?.[idx] ?? null;
      const receipt = invoice.rollReceipts[colorKey]?.[idx] ?? null;
      return {
        key: `${colorKey}|${idx}`,
        warna: c.warna,
        lengan: c.lengan,
        idx,
        grossKg,
        codeLot: arrival?.codeLot || c.lots?.[idx]?.trim() || "",
        codeRoll: arrival?.codeRoll || receipt?.codeRoll || "",
        arrived: !!arrival,
        weighed: !!receipt,
      };
    })
  );
}

function EditRollDialog({ invoice, row, onClose }: { invoice: RawMaterialInvoice; row: RollRow; onClose: () => void }) {
  const [lot, setLot] = useState(row.codeLot);
  const [roll, setRoll] = useState(row.codeRoll);
  // Code roll cuma bisa diubah kalau roll sudah diterima & belum ditimbang (cermin aturan server).
  const rollEditable = row.arrived && !row.weighed;
  const lotChanged = lot.trim() !== row.codeLot;
  const rollChanged = rollEditable && roll.trim() !== row.codeRoll;
  // Code roll harus unik (owner 2026-10-05): cek instan ke semua roll yang dimuat; server mengecek ulang.
  const allInvoices = useMrpStore((s) => s.invoices);
  const conflict = rollChanged ? findRollCodeConflict(roll, allInvoices, { invoiceId: invoice.id, warna: row.warna, lengan: row.lengan, rollIndex: row.idx }) : null;
  const patch: SysadminRollCodePatch = {};
  if (lotChanged) patch.codeLot = lot;
  if (rollChanged) patch.codeRoll = roll;

  return (
    <CorrectionDialog
      title={`Koreksi Roll ${row.idx + 1} · ${row.warna} · ${row.lengan === "PENDEK" ? "Pendek" : "Panjang"}`}
      impact={[
        "Code lot hanya label — aman diubah kapan saja. Salinan teks lot di riwayat klaim yang sudah terbentuk tidak ikut berubah.",
        "Code roll hanya bisa diubah kalau roll sudah diterima dan belum ditimbang di Cutting.",
        "Procurement dan vendor tujuan menerima notifikasi perubahan ini.",
      ]}
      confirmLabel="Simpan koreksi"
      extraValid={(lotChanged || rollChanged) && (!rollChanged || roll.trim().length > 0) && !conflict}
      onRun={(reason) => sysadminSetRollCodeAction({ invoiceId: invoice.id, warna: row.warna, lengan: row.lengan, rollIndex: row.idx, patch }, reason)}
      onClose={onClose}
    >
      <div className="grid grid-cols-2 gap-3">
        <div>
          <div className="mb-1 font-sans text-[10.5px] font-medium uppercase tracking-wider text-text-muted">Code lot</div>
          <input value={lot} onChange={(e) => setLot(e.target.value)} className="input w-full font-mono" placeholder="(kosong)" />
        </div>
        <div>
          <div className="mb-1 font-sans text-[10.5px] font-medium uppercase tracking-wider text-text-muted">Code roll</div>
          <input
            value={roll}
            onChange={(e) => setRoll(e.target.value)}
            disabled={!rollEditable}
            title={rollEditable ? undefined : row.weighed ? "Sudah ditimbang — tidak bisa diubah" : "Roll belum diterima vendor"}
            className="input w-full font-mono disabled:opacity-60"
            placeholder="(belum ada)"
          />
        </div>
      </div>
      {conflict && (
        <div className="mt-2 rounded-md border border-[#F0C9C9] bg-danger-bg px-3 py-2 font-sans text-[11px] leading-[1.5] text-danger-fg">{describeRollCodeConflict(conflict)}</div>
      )}
    </CorrectionDialog>
  );
}

/** Tabel koreksi code lot / code roll per roll untuk 1 invoice (Material Tracking, mode Sysadmin).
 *  Tersembunyi (tidak render) kalau bukan Sysadmin. */
export function RollCodeEditor({ invoice }: { invoice: RawMaterialInvoice }) {
  const sysadmin = useSysadminMode();
  const [editKey, setEditKey] = useState<string | null>(null);
  if (!sysadmin) return null;
  const rows = rollRows(invoice);
  if (rows.length === 0) return null;
  const editing = rows.find((r) => r.key === editKey);
  return (
    <details onClick={(e) => e.stopPropagation()} className="mt-2 rounded-md border border-[#E9D9B0] bg-warning-bg/50">
      <summary className="cursor-pointer px-3 py-2 font-sans text-[11.5px] font-semibold text-warning-fg">
        Sysadmin · Koreksi code lot / code roll ({rows.length} roll)
      </summary>
      <div className="max-h-[280px] overflow-y-auto border-t border-[#E9D9B0] bg-white">
        <div className="grid grid-cols-[1.4fr_60px_90px_1fr_1fr_70px] gap-x-2 bg-[#F2F4F7] px-3 py-1.5 font-sans text-[10px] font-medium uppercase tracking-wider text-text-muted">
          <span>Warna · Lengan</span>
          <span className="text-right">Roll</span>
          <span className="text-right">Kotor (kg)</span>
          <span>Code lot</span>
          <span>Code roll</span>
          <span />
        </div>
        {rows.map((r) => (
          <div key={r.key} className="grid grid-cols-[1.4fr_60px_90px_1fr_1fr_70px] items-center gap-x-2 border-t border-[#F1F4F7] px-3 py-1.5 font-sans text-[11.5px] text-[#31414F]">
            <span>
              {r.warna} · {r.lengan === "PENDEK" ? "Pendek" : "Panjang"}
            </span>
            <span className="text-right font-mono">{r.idx + 1}</span>
            <span className="text-right font-mono">{formatDecimal(r.grossKg)}</span>
            <span className="font-mono text-[11px]">{r.codeLot || "—"}</span>
            <span className="font-mono text-[11px]">{r.codeRoll || "—"}</span>
            <Button onClick={() => setEditKey(r.key)} variant="ghost" size="xs">
              Edit
            </Button>
          </div>
        ))}
      </div>
      {editing && <EditRollDialog key={editing.key} invoice={invoice} row={editing} onClose={() => setEditKey(null)} />}
    </details>
  );
}
