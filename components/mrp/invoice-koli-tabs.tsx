"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { ItemsDetailPanel, USIA_LABEL } from "@/components/mrp/koli-items-detail";
import { viewEkspedisiPhoto } from "@/components/mrp/koli-ekspedisi-card";
import { useMrpStore } from "@/lib/mrp/store";
import { formatDate, formatNoKoli, formatPcs, formatRupiah, invoiceKoliItemsView } from "@/lib/mrp/derive";
import type { VendorInvoice } from "@/lib/mrp/types";

type Tab = "warna" | "koli";

const kg = (n: number) => n.toLocaleString("id-ID", { maximumFractionDigits: 2 }) + " kg";

/** Rincian isi koli untuk satu invoice vendor (Paying Voucher > Invoice Vendor), dua tab:
 *  - Per Warna: total semua koli per warna·lengan, dirinci per size (qty, harga/pc, nilai) dan koli asalnya.
 *  - Per Koli: tiap koli beserta item dan qty-nya, tampilan sama dengan rincian koli di portal vendor.
 *  Angka dibaca dari item koli (bukan target MRP) dan dibatasi pada bagian yang ditagihkan di invoice ini; lihat `invoiceKoliItemsView` (derive.ts). */
export function InvoiceKoliTabs({ inv }: { inv: VendorInvoice }) {
  const vendorInvoices = useMrpStore((s) => s.vendorInvoices);
  const deliveryKolis = useMrpStore((s) => s.deliveryKolis);
  const [tab, setTab] = useState<Tab>("warna");
  const view = useMemo(() => invoiceKoliItemsView(inv, vendorInvoices, deliveryKolis), [inv, vendorInvoices, deliveryKolis]);
  const totalQty = view.kolis.reduce((s, k) => s + k.totalQty, 0);
  const totalNominal = view.kolis.reduce((s, k) => s + k.totalNominal, 0);

  return (
    <div className="mt-3 overflow-hidden rounded-md border border-[#E4E9EE] bg-white">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#E4E9EE] bg-[#F2F5F8] px-3 py-2">
        <div className="font-sans text-[11px] font-medium uppercase tracking-wider text-text-muted">Rincian koli invoice ini</div>
        <div className="flex items-center gap-1" role="tablist">
          {(
            [
              ["warna", "Per Warna"],
              ["koli", `Per Koli (${view.kolis.length})`],
            ] as [Tab, string][]
          ).map(([id, label]) => (
            <button
              key={id}
              role="tab"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
              className={
                "rounded-md border px-3 py-[5px] font-sans text-[11.5px] font-semibold " +
                (tab === id ? "border-action-primary bg-action-primary text-white" : "border-[#CBD5DF] bg-white text-text-muted hover:bg-[#F7F9FB]")
              }
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-[#F1F4F7] px-3 py-1.5 font-sans text-[11px] text-text-muted">
        <span>
          {view.kolis.length} koli · <span className="font-mono font-semibold text-text-primary">{formatPcs(totalQty)} pcs</span> ·{" "}
          <span className="font-mono font-semibold text-text-primary">{formatRupiah(totalNominal)}</span>
        </span>
        <span>Reject tidak ditagihkan sehingga tidak tampil di sini.</span>
      </div>

      {view.unallocatedQty > 0 && (
        <div className="border-b border-[#F0DFC2] bg-warning-bg px-3 py-1.5 font-sans text-[11px] text-warning-fg">
          {formatPcs(view.unallocatedQty)} pcs di invoice ini belum tertaut ke koli (data lama, sebelum pelacakan pengiriman):{" "}
          {view.unallocated.map((u) => `${u.label} ${formatPcs(u.qty)} pcs`).join("; ")}.
        </div>
      )}

      {view.kolis.length === 0 && <div className="px-3 py-3 font-sans text-[11.5px] text-text-muted">Belum ada koli yang tertaut ke invoice ini.</div>}

      {tab === "warna" && view.kolis.length > 0 && (
        <div className="flex flex-col gap-2 p-3">
          {view.warna.map((g) => (
            <div key={g.key} className="overflow-hidden rounded-md border border-[#E4E8EE] bg-white">
              <div className="flex items-center justify-between gap-2 bg-[#F2F4F7] px-3 py-1.5 font-mono text-[11px] text-text-primary">
                <span>
                  {g.mrpId} <span className="text-[#94A3B0]">({g.warna} · {g.lengan}{g.usia ? " · " + USIA_LABEL[g.usia] : ""})</span>
                </span>
                <span>
                  {formatPcs(g.qty)} pcs · {formatRupiah(g.nilai)}
                </span>
              </div>
              <div className="grid grid-cols-[70px_80px_100px_110px_1fr] gap-x-2 border-t border-[#F1F4F7] px-3 py-1.5 font-sans text-[10px] font-medium uppercase tracking-wider text-text-muted">
                <span>Size</span>
                <span className="text-right">Qty</span>
                <span className="text-right">Harga/pc</span>
                <span className="text-right">Nilai</span>
                <span>Koli asal</span>
              </div>
              {g.sizes.map((s) => (
                <div key={s.size} className="grid grid-cols-[70px_80px_100px_110px_1fr] items-center gap-x-2 border-t border-[#F1F4F7] px-3 py-1.5 font-mono text-[11.5px] text-[#31414F]">
                  <span>{s.size}</span>
                  <span className="text-right font-semibold">{formatPcs(s.qty)}</span>
                  <span className="text-right text-text-muted">{formatRupiah(s.ratePerPc)}</span>
                  <span className="text-right">{formatRupiah(s.nilai)}</span>
                  <span className="font-sans text-[11px] text-text-muted">{s.perKoli.map((p) => `${p.label}: ${formatPcs(p.qty)}`).join(" · ")}</span>
                </div>
              ))}
              {g.qty !== g.invoiceQty && (
                <div className="border-t border-[#F1F4F7] px-3 py-1.5 font-sans text-[10.5px] text-warning-fg">
                  Baris invoice {formatPcs(g.invoiceQty)} pcs, yang tertaut ke koli {formatPcs(g.qty)} pcs.
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {tab === "koli" && view.kolis.length > 0 && (
        <div className="flex flex-col gap-3 p-3">
          {view.kolis.map((k) => (
            <div key={k.koliId} className="overflow-hidden rounded-md border border-[#E4E9EE] bg-white">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#E4E9EE] bg-[#F7F9FB] px-3 py-2">
                <div>
                  <div className="font-sans text-[12.5px] font-semibold text-text-primary">
                    Koli <span className="font-mono">{formatNoKoli(k.noKoli) || k.koliId}</span>
                  </div>
                  <div className="mt-0.5 font-sans text-[11px] text-text-muted">
                    {k.ekspedisi || "—"} · resi <span className="font-mono">{k.noResi || "—"}</span> · kirim {formatDate(k.deliveredAt)}
                    {k.beratKoli ? " · " + kg(k.beratKoli) : ""}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="text-right font-mono text-[11.5px] text-[#31414F]">
                    <div className="font-semibold">{formatPcs(k.totalQty)} pcs</div>
                    <div className="text-text-muted">{formatRupiah(k.totalNominal)}</div>
                  </div>
                  {k.ekspedisiNoteAt && (
                    <Button onClick={() => viewEkspedisiPhoto(k.koliId)} variant="ghost" size="xs">
                      Lampiran Resi
                    </Button>
                  )}
                </div>
              </div>
              <div className="p-2">
                <ItemsDetailPanel items={k.items} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
