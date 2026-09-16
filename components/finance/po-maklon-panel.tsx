"use client";

import { useEffect, useState } from "react";
import { StatusPill } from "@/components/ui/status-pill";
import { Button } from "@/components/ui/button";
import { DataTable, type ColumnDef } from "@/components/mrp/data-table";
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

  const columns: ColumnDef<MaklonPO>[] = [
    { key: "noPo", label: "No PO", default: true, render: (p) => <span className="font-mono font-medium">{p.id}</span> },
    { key: "vendor", label: "Vendor", default: true, render: (p) => VENDOR_PRODUKSI[p.vendorProduksi]?.name ?? p.vendorProduksi },
    { key: "qty", label: "Qty", default: true, align: "right", render: (p) => formatPcs(p.qty) },
    { key: "nilai", label: "Nilai", default: true, align: "right", render: (p) => formatRupiah(p.amount) },
    // Entitas SENGAJA tidak ditampilkan di sini — beda dari PO Material, PO Maklon di sistem ini
    // tidak menggunakan entitas sama sekali (bukan cuma "belum ditentukan").
    {
      key: "status",
      label: "Status",
      default: true,
      render: (p) => {
        const badge = maklonPoBadgeWithApproval(p, vendorInvoices);
        return <StatusPill tone={badge.tone}>{badge.label}</StatusPill>;
      },
    },
    {
      // default:false — dibatasi ke 7 kolom total (termasuk No. MRP), dan kolom ini hampir
      // selalu "—" kecuali ada line yang dibatalkan Procurement — cukup dicek lewat toggle "Kolom".
      key: "cancelLines",
      label: "Cancel Line (dari Procurement)",
      default: false,
      render: (p) =>
        p.cancelledLines.length ? (
          <div className="flex flex-col gap-1">
            {p.cancelledLines.map((c, i) => (
              <div key={i} className="text-danger-fg">
                {c.warna ? `${c.warna} · ${c.lengan} — ` : ""}
                {c.rolls} roll{c.pcs ? ` (${c.pcs} pcs)` : ""}: {c.note}
              </div>
            ))}
          </div>
        ) : (
          "—"
        ),
    },
    { key: "aksi", label: "Aksi", default: true, render: (p) => (p.approved ? "—" : <Button onClick={() => approveMaklonPo(p.id)} variant="success" size="xs">Approve</Button>) },
  ];

  const recentCancellations = maklonPOs.flatMap((p) => p.cancelledLines.map((c) => ({ po: p, c })));

  return (
    <>
      {pending.length > 0 && (
        <div className="rounded-lg border border-[#CFE0EF] bg-info-bg px-5 py-3 font-sans text-[11.5px] leading-[1.5] text-info-fg">
          Approve akan memindahkan PO ke dashboard produksi vendor terkait, dan PO material terkait berpindah ke Paying Voucher (Invoice) dengan status <b>waiting invoice</b>.
        </div>
      )}
      {recentCancellations.length > 0 && (
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

      <DataTable
        title="Semua PO Vendor Produksi"
        columns={columns}
        rows={maklonPOs}
        keyOf={(p) => p.id}
        firstColumnLabel="No. MRP"
        firstColumnRender={(p) => <span className="font-mono">{p.mrpId}</span>}
        filterDefs={[
          { label: "No MRP", options: Array.from(new Set(maklonPOs.map((p) => p.mrpId))), test: (p, v) => p.mrpId === v },
          { label: "No PO", options: Array.from(new Set(maklonPOs.map((p) => p.id))), test: (p, v) => p.id === v },
          {
            label: "Status",
            options: Array.from(new Set(maklonPOs.map((p) => maklonPoBadgeWithApproval(p, vendorInvoices).label))),
            test: (p, v) => maklonPoBadgeWithApproval(p, vendorInvoices).label === v,
          },
        ]}
        emptyText="Belum ada PO vendor produksi."
        // Item 4 (feedback batch 2026-09-10, owner: "lebih detail ke tipe lengan juga untuk
        // qty-nya (panjang pendek) serta estimasi harga per warna dan tipe lengan") -- dulu tabel
        // detail di sini lebih polos (warna·lengan 1 baris, tanpa harga, lewat
        // maklonPoWarnaBreakdown). Diganti MaklonPoWarnaLenganTable, komponen yang sama dengan
        // yang dipakai Procurement > PO Approval untuk PO Maklon yang sama -- qty Pendek/Panjang
        // dipisah + harga per pc masing-masing.
        renderExpanded={(p) => (
          <MaklonPoWarnaLenganTable
            vendorProduksi={p.vendorProduksi}
            amount={p.amount}
            aduanRows={mrpDetails.find((d) => d.mrp.id === p.mrpId)?.aduanRows.filter((a) => a.vendor === p.vendorProduksi) ?? []}
            hargaMaklon={hargaMaklon}
          />
        )}
      />
    </>
  );
}
