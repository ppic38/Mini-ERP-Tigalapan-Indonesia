"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { formatPcs } from "@/lib/mrp/derive";
import type { AduanPolaRow, Lengan } from "@/lib/mrp/types";

/** Revisi 2026-09-18 (owner: "buat lebih simpel saja tampilannya di mana procurement langsung
 *  pilih warna terus berapa roll yang mau dipindahkan ... tidak perlu sedetail aduan pola"):
 *  dulu 1 baris PER kode aduan (bisa banyak baris untuk 1 warna kalau kode-nya beda-beda) dengan
 *  dropdown vendor + tombol Switch sendiri-sendiri per baris -- sekarang digabung jadi 1 baris PER
 *  warna+lengan (roll dijumlah dari semua kode aduan di kombinasi itu), procurement tinggal isi
 *  berapa roll mau dipindahkan (manual, atau tombol "Max" langsung isi semua roll yang tersedia)
 *  lalu SATU tombol "Pindahkan" untuk semua baris yang diisi sekaligus -- pola input sama seperti
 *  TransferMaterialModal (pindah material antar vendor). Split proporsional per kode aduan kalau
 *  roll yang diminta lebih kecil dari total tersedia ditangani di server
 *  (switchAduanVendorByRollAction, pakai reassignAduanRowsVendor yang sama dgn transfer material). */
type WarnaGroup = { warna: string; lengan: Lengan; totalRoll: number };

export function VendorSwitchModal({
  vendorName,
  rows,
  otherVendors,
  onSwitch,
  onClose,
}: {
  vendorName: string;
  rows: AduanPolaRow[];
  otherVendors: { id: string; name: string }[];
  onSwitch: (warna: string, lengan: Lengan, toVendor: string, rollCount: number) => Promise<void>;
  onClose: () => void;
}) {
  const groups = useMemo(() => {
    const map = new Map<string, WarnaGroup>();
    for (const r of rows) {
      const key = r.warna + "|" + r.lengan;
      const cur = map.get(key);
      if (cur) cur.totalRoll += r.qtyRoll;
      else map.set(key, { warna: r.warna, lengan: r.lengan, totalRoll: r.qtyRoll });
    }
    return Array.from(map.values());
  }, [rows]);

  const [target, setTarget] = useState(otherVendors[0]?.id ?? "");
  const [rollByKey, setRollByKey] = useState<Record<string, number>>({});
  const [saving, setSaving] = useState(false);

  const keyOf = (g: WarnaGroup) => g.warna + "|" + g.lengan;
  const rollFor = (g: WarnaGroup) => rollByKey[keyOf(g)] ?? 0;
  function setRoll(g: WarnaGroup, value: number) {
    setRollByKey((prev) => ({ ...prev, [keyOf(g)]: Math.max(0, Math.min(Math.round(value), g.totalRoll)) }));
  }

  const totalToMove = groups.reduce((s, g) => s + rollFor(g), 0);

  async function handleSubmit() {
    if (!target || totalToMove <= 0) return;
    setSaving(true);
    try {
      for (const g of groups) {
        const rollCount = rollFor(g);
        if (rollCount > 0) await onSwitch(g.warna, g.lengan, target, rollCount);
      }
      setRollByKey({});
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0B131B]/45 p-4">
      <div className="w-full max-w-[620px] overflow-hidden rounded-[9px] bg-surface-card shadow-[0_12px_32px_rgba(11,19,27,.28)]">
        <div className="flex items-center px-5 py-4">
          <div>
            <div className="font-sans text-[17px] font-bold text-text-primary">{vendorName} · pindahkan roll ke vendor lain</div>
            <div className="mt-0.5 font-sans text-[11.5px] text-text-muted">Isi berapa roll per warna yang mau dipindahkan, atau klik Max untuk semua roll tersedia.</div>
          </div>
          <Button onClick={onClose} variant="ghost" size="xs" className="ml-auto">
            Tutup ✕
          </Button>
        </div>
        <div className="px-5 pb-3">
          <label className="font-sans text-[11px] font-medium uppercase tracking-wider text-text-muted">Vendor produksi tujuan</label>
          <select value={target} onChange={(e) => setTarget(e.target.value)} className="mt-1.5 w-full rounded-md border border-[#DDE4EB] px-[11px] py-[9px] font-sans text-[12.5px] font-medium text-text-primary">
            {otherVendors.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
        </div>
        <div className="grid grid-cols-[1fr_100px_140px_60px] gap-2 border-y border-border-subtle bg-[#F7F9FB] px-5 py-[9px] font-sans text-[10px] font-medium uppercase tracking-wider text-text-muted">
          <span>Warna / lengan</span>
          <span className="text-right">Roll tersedia</span>
          <span className="text-right">Roll dipindahkan</span>
          <span />
        </div>
        <div className="max-h-[320px] overflow-y-auto">
          {groups.map((g) => (
            <div key={keyOf(g)} className="grid grid-cols-[1fr_100px_140px_60px] items-center gap-2 border-b border-[#F1F4F7] px-5 py-[9px] font-mono text-[11.5px] text-[#31414F] last:border-b-0">
              <span className="font-sans">
                {g.warna} <span className="text-text-muted">· {g.lengan}</span>
              </span>
              <span className="text-right">{formatPcs(g.totalRoll)}</span>
              <input
                type="number"
                min={0}
                max={g.totalRoll}
                value={rollFor(g)}
                onChange={(e) => setRoll(g, Number(e.target.value))}
                className="w-full rounded-md border border-[#DDE4EB] px-2 py-1 text-right"
              />
              <button onClick={() => setRoll(g, g.totalRoll)} className="font-sans text-[11px] font-semibold text-action-primary underline">
                Max
              </button>
            </div>
          ))}
          {groups.length === 0 && <div className="px-5 py-6 text-center font-sans text-xs text-text-muted">Tidak ada aduan pola di vendor ini.</div>}
        </div>
        <div className="flex items-center gap-2 border-t border-border-subtle px-5 py-4">
          <span className="font-sans text-[11px] text-text-muted">Total {formatPcs(totalToMove)} roll akan dipindahkan ke {otherVendors.find((v) => v.id === target)?.name ?? "—"}.</span>
          <button
            onClick={handleSubmit}
            disabled={!target || totalToMove <= 0 || saving}
            className="ml-auto rounded-md bg-action-primary px-3.5 py-[9px] font-sans text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? "Memindahkan…" : "Pindahkan"}
          </button>
        </div>
      </div>
    </div>
  );
}
