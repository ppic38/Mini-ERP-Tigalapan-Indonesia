"use client";

import { Fragment, useEffect, useState } from "react";
import { StatusPill } from "@/components/ui/status-pill";
import { Button } from "@/components/ui/button";
import { MaklonPoWarnaLenganTable } from "@/components/mrp/maklon-po-warna-lengan-table";
import { useMrpStore } from "@/lib/mrp/store";
import { formatPcs, formatRupiah, maklonPoBadgeWithApproval } from "@/lib/mrp/derive";
import { VENDOR_PRODUKSI } from "@/lib/mrp/seed";
import type { MaklonPO } from "@/lib/mrp/types";

/** Panel "PO Maklon" — konten diekstrak dari halaman lama /finance/po-maklon,
 *  sekarang dipakai sebagai satu sub-tab di halaman gabungan /finance/po-approval. */
export function PoMaklonPanel() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const maklonPOs = useMrpStore((s) => s.maklonPOs);
  const vendorInvoices = useMrpStore((s) => s.vendorInvoices);
  const approveMaklonPo = useMrpStore((s) => s.approveMaklonPo);
  // Item revisi 2026-09-06: dipakai untuk detail per-warna/lengan begitu baris di-expand -- lihat
  // MaklonPoWarnaLenganTable (components/mrp/).
  const mrpDetails = useMrpStore((s) => s.mrpDetails);
  const hargaMaklon = useMrpStore((s) => s.hargaMaklon);

  // Item revisi 2026-09-17 (owner: "PO Approval Finance -- Material & Maklon -- hierarkis per
  // No. MRP"): sama pola dengan PoMaterialPanel di atas -- pilih MRP dulu, baru dikelompokkan per
  // vendor produksi, approve per vendor (PO langsung hilang dari daftar pending begitu approved).
  // TIDAK ada langkah isi entitas di sini (beda dari PO Material) -- PO Maklon di sistem ini
  // memang tidak menggunakan entitas sama sekali (lihat catatan kolom "aksi"/comment di kolom
  // entitas versi lama).
  const [selectedMrpId, setSelectedMrpId] = useState<string>("");

  // Item revisi 2026-09-17 (owner: "bungkus/grouping tabel Semua PO Vendor Produksi seperti di PO
  // Approval Material") -- dulu DataTable flat 1 baris per PO. Sekarang tabel pohon 2 tingkat
  // (No MRP -> Vendor Produksi, leaf = 1 PO), gaya visual sama dengan tree Purchase Order.
  const [expandedMrpAll, setExpandedMrpAll] = useState<string | null>(null);
  const [expandedVendorAll, setExpandedVendorAll] = useState<string | null>(null);
  const [expandedPoAll, setExpandedPoAll] = useState<string | null>(null);

  if (!mounted) return null;

  const pending = maklonPOs.filter((po) => !po.approved);
  const pendingMrpIds = Array.from(new Set(pending.map((p) => p.mrpId)));
  const selectable = mrpDetails.filter((d) => pendingMrpIds.includes(d.mrp.id));
  // Dihitung langsung saat render (BUKAN lewat useEffect) supaya tidak menambah pelanggaran
  // react-hooks/set-state-in-effect -- begitu MRP terpilih sudah tidak ada lagi di pendingMrpIds
  // (semua PO-nya sudah di-approve), otomatis "jatuh" ke MRP pending pertama berikutnya.
  const effectiveMrpId = selectedMrpId && pendingMrpIds.includes(selectedMrpId) ? selectedMrpId : pendingMrpIds[0] ?? "";
  const scopedPending = pending.filter((p) => p.mrpId === effectiveMrpId);

  const groupedByVendor = new Map<string, MaklonPO[]>();
  for (const po of scopedPending) {
    const arr = groupedByVendor.get(po.vendorProduksi) ?? [];
    arr.push(po);
    groupedByVendor.set(po.vendorProduksi, arr);
  }

  async function approveVendorGroup(pos: MaklonPO[]) {
    for (const po of pos) await approveMaklonPo(po.id);
  }

  const recentCancellations = maklonPOs.flatMap((p) => p.cancelledLines.map((c) => ({ po: p, c })));

  // Pohon 2 tingkat untuk "Semua PO Vendor Produksi": No MRP -> Vendor Produksi (leaf = 1 PO) --
  // sama pola dengan tree PO Material Finance (po-material-panel.tsx), tidak ada level Supplier
  // (Maklon tidak punya supplier terpisah).
  // Item revisi 2026-09-18 (owner: "tabel ini rencananya buat detect PO Maklon apa yang SUDAH
  // diapprove Finance, jangan simpan yang belum diapprove") -- dulu ikut PO yang masih menunggu
  // approval (statusnya tampil "WAITING APPROVAL" di sini juga, duplikat dengan daftar pending di
  // atas). Sekarang cuma PO yang `approved` yang masuk sini -- PO yang belum di-approve HANYA
  // muncul di daftar approval di atas, bukan lagi di tree read-only ini.
  const approvedMaklonPOs = maklonPOs.filter((p) => p.approved);
  const allMrpSummaries = (() => {
    const map = new Map<string, MaklonPO[]>();
    for (const p of approvedMaklonPOs) {
      if (!map.has(p.mrpId)) map.set(p.mrpId, []);
      map.get(p.mrpId)!.push(p);
    }
    return Array.from(map.entries())
      .map(([mrpId, pos]) => ({
        mrpId,
        pos,
        vendorCount: new Set(pos.map((p) => p.vendorProduksi)).size,
        totalQty: pos.reduce((sum, p) => sum + p.qty, 0),
        totalNilai: pos.reduce((sum, p) => sum + p.amount, 0),
      }))
      .sort((a, b) => b.mrpId.localeCompare(a.mrpId, "id-ID"));
  })();

  function allVendorSummariesForMrp(pos: MaklonPO[]) {
    const map = new Map<string, MaklonPO[]>();
    for (const p of pos) {
      if (!map.has(p.vendorProduksi)) map.set(p.vendorProduksi, []);
      map.get(p.vendorProduksi)!.push(p);
    }
    return Array.from(map.entries())
      .map(([vendor, ps]) => ({
        vendor,
        vendorName: VENDOR_PRODUKSI[vendor]?.name ?? vendor,
        pos: ps,
        totalQty: ps.reduce((sum, p) => sum + p.qty, 0),
        totalNilai: ps.reduce((sum, p) => sum + p.amount, 0),
      }))
      .sort((a, b) => a.vendorName.localeCompare(b.vendorName, "id-ID"));
  }

  return (
    <>
      {pending.length > 0 && (
        <div className="rounded-lg border border-[#CFE0EF] bg-info-bg px-5 py-3 font-sans text-[11.5px] leading-[1.5] text-info-fg">
          Approve akan memindahkan PO ke dashboard produksi vendor terkait, dan PO material terkait berpindah ke Paying Voucher (Invoice) dengan status <b>waiting invoice</b>.
        </div>
      )}
      {/* Item revisi 2026-09-17 (owner: "hide saja untuk saat ini, siapa tau masih dibutuhkan
         kedepannya, jadi sisa dipanggil lagi") -- disembunyikan, BUKAN dihapus. recentCancellations
         di atas tetap dihitung (biar gampang dipanggil balik nanti, tinggal ganti `false` jadi
         kondisi aslinya). */}
      {false && recentCancellations.length > 0 && (
        <div className="rounded-lg border border-[#EFC9C4] bg-danger-bg px-5 py-3 font-sans text-[11.5px] leading-[1.5] text-danger-fg">
          <div className="font-semibold">Notifikasi: PO material terkait ditutup oleh Procurement</div>
          {recentCancellations.map(({ po, c }, i) => (
            <div key={i} className="mt-1">
              {VENDOR_PRODUKSI[po.vendorProduksi]?.name ?? po.vendorProduksi} — {po.id}
              {c.warna ? ` · ${c.warna} · ${c.lengan}` : ""} · {c.rolls} roll{c.pcs ? ` (${c.pcs} pcs terpotong)` : ""} — remark: "{c.note}"
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center gap-3 rounded-lg border border-border-subtle bg-surface-card px-4 py-3.5">
        <div>
          <div className="font-sans text-[11px] font-medium uppercase tracking-wider text-text-muted">No MRP (menunggu approval)</div>
          <select
            value={effectiveMrpId}
            onChange={(e) => setSelectedMrpId(e.target.value)}
            className="mt-1 rounded-md border border-[#DDE4EB] px-[11px] py-[9px] font-sans text-[12.5px] font-medium text-text-primary"
          >
            <option value="">— pilih MRP —</option>
            {selectable.map((d) => (
              <option key={d.mrp.id} value={d.mrp.id}>
                {d.mrp.id} · {formatPcs(d.mrp.qty)} pcs
              </option>
            ))}
          </select>
        </div>
        {scopedPending.length > 0 && (
          <button
            onClick={() => approveVendorGroup(scopedPending)}
            className="ml-auto rounded-md bg-success px-3.5 py-[9px] font-sans text-xs font-semibold text-white"
          >
            Approve semua PO MRP ini ({scopedPending.length})
          </button>
        )}
      </div>

      {scopedPending.length === 0 && (
        <div className="rounded-lg border border-border-subtle bg-surface-card px-5 py-8 text-center font-sans text-xs text-text-muted">
          Tidak ada PO maklon menunggu approval saat ini.
        </div>
      )}

      {scopedPending.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-border-subtle bg-[#EEF1F5]">
          {Array.from(groupedByVendor.entries()).map(([vendor, pos]) => {
            const vendorQtyTotal = pos.reduce((a, p) => a + p.qty, 0);
            const vendorAmountTotal = pos.reduce((a, p) => a + p.amount, 0);
            return (
              <div key={vendor} className="border-b border-border-subtle last:border-b-0">
                <div className="flex items-center gap-2.5 bg-[#DEE4EC] px-5 py-[11px] font-sans text-[11px] font-semibold text-text-primary">
                  <span>→ {VENDOR_PRODUKSI[vendor]?.name ?? vendor}</span>
                  <button
                    onClick={() => approveVendorGroup(pos)}
                    className="ml-auto rounded-md bg-success px-2.5 py-[6px] font-sans text-[11px] font-semibold text-white"
                  >
                    Approve semua PO vendor ini ({pos.length})
                  </button>
                </div>
                <div className="flex flex-col gap-2.5 px-3.5 py-3">
                  {pos.map((po) => (
                    <div key={po.id} className="flex items-center gap-3 overflow-hidden rounded-md border border-[#D8DEE6] bg-white px-4 py-[11px] shadow-[0_1px_3px_rgba(11,19,27,.06)]">
                      <span className="font-mono text-xs font-medium text-[#31414F]">{po.id}</span>
                      <span className="font-sans text-xs text-[#31414F]">{formatPcs(po.qty)} pcs</span>
                      <span className="ml-auto font-mono text-xs">{formatRupiah(po.amount)}</span>
                      <Button onClick={() => approveMaklonPo(po.id)} variant="success" size="xs">
                        Approve
                      </Button>
                    </div>
                  ))}
                </div>
                <div className="flex flex-wrap items-center gap-4 bg-[#DEE4EC] px-5 py-[10px] font-sans text-[11px] font-semibold text-text-primary">
                  <span>Total vendor {VENDOR_PRODUKSI[vendor]?.name ?? vendor}:</span>
                  <span>Qty: {formatPcs(vendorQtyTotal)} pcs</span>
                  <span>Total: {formatRupiah(vendorAmountTotal)}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="overflow-hidden border border-border-subtle bg-surface-card">
        <div className="border-b border-border-subtle px-4 py-3">
          <div className="font-sans text-[13px] font-semibold text-text-primary">Semua PO Vendor Produksi</div>
          {/* Revisi 2026-09-17 (owner: "yang atas buat approve, yang bawah cuma buat cek status yang
             sudah diapprove"): dulu tabel ini ikut punya tombol Approve per baris (duplikat dengan
             alur approve di atas) -- sekarang murni status checker, read-only. Revisi 2026-09-18:
             sekarang benar-benar HANYA berisi PO yang sudah di-approve (lihat approvedMaklonPOs). */}
          <div className="font-sans text-[11.5px] text-text-muted">Daftar PO vendor produksi yang sudah di-approve Finance.</div>
        </div>
        {allMrpSummaries.length === 0 && <div className="px-5 py-8 text-center font-sans text-xs text-text-muted">Belum ada PO vendor produksi.</div>}
        {allMrpSummaries.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b-2 border-accent-blue bg-info-bg font-sans text-[10.5px] font-medium uppercase tracking-wider text-info-fg">
                  <th className="px-5 py-[9px] text-left">No MRP / Vendor Produksi / No PO</th>
                  <th className="px-3 py-[9px] text-right">Qty</th>
                  <th className="px-3 py-[9px] text-right">Nilai</th>
                  <th className="px-3 py-[9px] text-left">Status</th>
                </tr>
              </thead>
              <tbody>
                {allMrpSummaries.map((m) => {
                  const mrpActive = expandedMrpAll === m.mrpId;
                  return (
                    <Fragment key={m.mrpId}>
                      <tr
                        onClick={() => {
                          const next = mrpActive ? null : m.mrpId;
                          setExpandedMrpAll(next);
                          setExpandedVendorAll(null);
                          setExpandedPoAll(null);
                        }}
                        className={"cursor-pointer border-b border-[#F1F4F7] font-sans text-xs text-[#31414F] hover:bg-[#FAFBFC] " + (mrpActive ? "bg-info-bg" : "")}
                      >
                        <td className="px-5 py-[11px]">
                          <span className="mr-1.5 text-text-muted">{mrpActive ? "▾" : "▸"}</span>
                          <span className="font-mono font-semibold text-text-primary">{m.mrpId}</span>
                          <span className="ml-1.5 font-sans text-[10.5px] text-text-muted">{m.vendorCount} vendor</span>
                        </td>
                        <td className="px-3 py-[11px] text-right font-mono tabular-nums">{formatPcs(m.totalQty)} pcs</td>
                        <td className="px-3 py-[11px] text-right font-mono tabular-nums font-medium">{formatRupiah(m.totalNilai)}</td>
                        <td className="px-3 py-[11px]">
                          <StatusPill tone="neutral">{m.pos.length} PO</StatusPill>
                        </td>
                      </tr>
                      {mrpActive &&
                        allVendorSummariesForMrp(m.pos).map((v) => {
                          const vendorKey = `${m.mrpId}::${v.vendor}`;
                          const vendorActive = expandedVendorAll === vendorKey;
                          return (
                            <Fragment key={vendorKey}>
                              <tr
                                onClick={() => {
                                  const next = vendorActive ? null : vendorKey;
                                  setExpandedVendorAll(next);
                                  setExpandedPoAll(null);
                                }}
                                className={"cursor-pointer border-b border-[#F1F4F7] bg-[#FBFCFD] font-sans text-[11.5px] text-[#31414F] hover:bg-[#F2F5F8] " + (vendorActive ? "bg-info-bg" : "")}
                              >
                                <td className="py-[10px] pl-10 pr-3">
                                  <span className="mr-1.5 text-text-muted">{vendorActive ? "▾" : "▸"}</span>
                                  <span className="font-medium text-text-primary">{v.vendorName}</span>
                                </td>
                                <td className="px-3 py-[10px] text-right font-mono tabular-nums">{formatPcs(v.totalQty)} pcs</td>
                                <td className="px-3 py-[10px] text-right font-mono tabular-nums font-medium">{formatRupiah(v.totalNilai)}</td>
                                <td className="px-3 py-[10px]">
                                  <StatusPill tone="neutral">{v.pos.length} PO</StatusPill>
                                </td>
                              </tr>
                              {vendorActive &&
                                v.pos.map((p) => {
                                  const poActive = expandedPoAll === p.id;
                                  const badge = maklonPoBadgeWithApproval(p, vendorInvoices);
                                  return (
                                    <Fragment key={p.id}>
                                      <tr
                                        onClick={() => setExpandedPoAll(poActive ? null : p.id)}
                                        className={"cursor-pointer border-b border-[#F1F4F7] font-sans text-[11.5px] text-[#31414F] hover:bg-[#FAFBFC] " + (poActive ? "bg-info-bg" : "")}
                                      >
                                        <td className="py-[10px] pl-16 pr-3 font-mono font-medium text-text-primary">{p.id}</td>
                                        <td className="px-3 py-[10px] text-right font-mono tabular-nums">{formatPcs(p.qty)} pcs</td>
                                        <td className="px-3 py-[10px] text-right font-mono tabular-nums font-medium">{formatRupiah(p.amount)}</td>
                                        <td className="px-3 py-[10px]">
                                          <StatusPill tone={badge.tone}>{badge.label}</StatusPill>
                                        </td>
                                      </tr>
                                      {poActive && (
                                        <tr>
                                          <td colSpan={4} className="border-b border-[#F1F4F7] bg-white px-4 py-3 pl-16">
                                            {p.cancelledLines.length > 0 && (
                                              <div className="mb-2 rounded-md border border-[#EFC9C4] bg-danger-bg px-3 py-2 font-sans text-[11px] leading-[1.5] text-danger-fg">
                                                <div className="font-semibold">Cancel Line (dari Procurement)</div>
                                                {p.cancelledLines.map((c, i) => (
                                                  <div key={i}>
                                                    {c.warna ? `${c.warna} · ${c.lengan} — ` : ""}
                                                    {c.rolls} roll{c.pcs ? ` (${c.pcs} pcs)` : ""}: {c.note}
                                                  </div>
                                                ))}
                                              </div>
                                            )}
                                            {/* Item 4 (feedback batch 2026-09-10, owner: "lebih detail ke tipe lengan juga
                                               untuk qty-nya (panjang pendek) serta estimasi harga per warna dan tipe
                                               lengan") -- MaklonPoWarnaLenganTable, komponen yang sama dengan yang dipakai
                                               Procurement > PO Approval untuk PO Maklon yang sama. */}
                                            <MaklonPoWarnaLenganTable
                                              vendorProduksi={p.vendorProduksi}
                                              amount={p.amount}
                                              aduanRows={mrpDetails.find((d) => d.mrp.id === p.mrpId)?.aduanRows.filter((a) => a.vendor === p.vendorProduksi) ?? []}
                                              hargaMaklon={hargaMaklon}
                                            />
                                          </td>
                                        </tr>
                                      )}
                                    </Fragment>
                                  );
                                })}
                            </Fragment>
                          );
                        })}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
