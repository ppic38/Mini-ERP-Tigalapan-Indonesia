"use client";

import { Fragment, useState } from "react";
import { StatusPill } from "@/components/ui/status-pill";
import { useMrpStore } from "@/lib/mrp/store";
import { formatPcs } from "@/lib/mrp/derive";
import { VENDOR_PRODUKSI } from "@/lib/mrp/seed";
import { buildMaterialPerWarna } from "@/lib/mrp/materialPerWarna";

const vendorName = (id: string) => VENDOR_PRODUKSI[id]?.name ?? id;
const selectCls = "rounded-md border border-border-subtle bg-white px-2.5 py-[6px] font-sans text-[11.5px] font-medium text-[#31414F]";
const th = "px-3 py-2 text-right font-sans text-[10.5px] font-medium uppercase tracking-wider text-info-fg";
const td = "px-3 py-2 text-right font-mono text-[11.5px]";

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="relative min-w-0 overflow-hidden rounded-xl border border-border-subtle bg-surface-card px-5 pb-4 pt-5">
      <div className="absolute inset-x-0 top-0 h-[3px] bg-[#38BDF8]" />
      <div className="truncate font-mono text-[10.5px] uppercase tracking-[0.14em] text-text-muted">{label}</div>
      <div className="mt-2 font-sans text-[26px] font-bold leading-none tracking-tight text-text-primary">{value}</div>
      {sub && <div className="mt-2 truncate font-mono text-[10.5px] text-text-muted">{sub}</div>}
    </div>
  );
}

/** Monitoring material PER WARNA lintas vendor produksi: satu warna bisa dikerjakan beberapa vendor, jadi kebutuhan roll dan
 *  estimasi kg dijumlah otomatis dan dirinci per vendor (rencana, di PO Material, diinvoice, diterima). Dipakai Procurement dan SCM. */
export function MaterialPerWarnaView() {
  const mrpDetails = useMrpStore((s) => s.mrpDetails);
  const materialPOs = useMrpStore((s) => s.materialPOs);
  const invoices = useMrpStore((s) => s.invoices);
  const mrpIds = mrpDetails.filter((d) => d.aduanRows.some((a) => a.qtyRoll > 0)).map((d) => d.mrp.id).sort().reverse();
  const [picked, setPicked] = useState("");
  const mrpId = picked && mrpIds.includes(picked) ? picked : mrpIds[0] ?? "";
  const [vendorFilter, setVendorFilter] = useState("");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<Set<string>>(new Set());

  const all = mrpId ? buildMaterialPerWarna(mrpId, mrpDetails, materialPOs, invoices) : [];
  const vendors = Array.from(new Set(all.flatMap((r) => r.vendors.map((v) => v.vendor)))).sort();
  const rows = all.filter((r) => (!query.trim() || r.warna.toLowerCase().includes(query.trim().toLowerCase())) && (!vendorFilter || r.vendors.some((v) => v.vendor === vendorFilter)));
  const multi = rows.filter((r) => r.vendors.filter((v) => v.rollRencana > 0 || v.rollPo > 0).length > 1).length;
  const sum = (k: "rollRencana" | "rollPo" | "rollInvoice" | "rollDiterima" | "kgEstimasi" | "kgInvoice") => rows.reduce((n, r) => n + r[k], 0);
  const toggle = (key: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2.5 rounded-lg border border-border-subtle bg-surface-card px-4 py-3">
        <label className="flex items-center gap-1.5 font-sans text-[11px] font-medium uppercase tracking-wider text-text-muted">
          MRP
          <select value={mrpId} onChange={(e) => setPicked(e.target.value)} className={selectCls}>
            {mrpIds.map((id) => (
              <option key={id} value={id}>
                {id}
              </option>
            ))}
          </select>
        </label>
        <select value={vendorFilter} onChange={(e) => setVendorFilter(e.target.value)} className={selectCls} aria-label="Filter vendor">
          <option value="">Vendor: Semua</option>
          {vendors.map((v) => (
            <option key={v} value={v}>
              {vendorName(v)}
            </option>
          ))}
        </select>
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Cari warna…" className="input max-w-[220px] !py-[6px] !text-[11.5px]" />
        <span className="ml-auto font-sans text-[11px] text-text-muted">
          {rows.length} warna·lengan{multi > 0 ? ` · ${multi} dikerjakan >1 vendor` : ""}
        </span>
      </div>

      <div className="grid grid-cols-4 gap-3 max-lg:grid-cols-2 max-sm:grid-cols-1">
        <Stat label="Roll rencana" value={formatPcs(sum("rollRencana"))} sub={`≈ ${formatPcs(Math.round(sum("kgEstimasi")))} kg estimasi`} />
        <Stat label="Roll di PO Material" value={formatPcs(sum("rollPo"))} sub={`${formatPcs(Math.max(0, sum("rollRencana") - sum("rollPo")))} roll belum di PO`} />
        <Stat label="Roll diinvoice" value={formatPcs(sum("rollInvoice"))} sub={`${formatPcs(Math.round(sum("kgInvoice")))} kg berat kotor`} />
        <Stat label="Roll diterima vendor" value={formatPcs(sum("rollDiterima"))} sub={`${formatPcs(Math.max(0, sum("rollInvoice") - sum("rollDiterima")))} roll belum diterima`} />
      </div>

      <div className="overflow-x-auto rounded-lg border border-border-subtle bg-surface-card">
        <table className="w-full min-w-[900px] border-collapse">
          <thead>
            <tr className="border-b-2 border-accent-blue bg-info-bg">
              <th className="px-3 py-2 text-left font-sans text-[10.5px] font-medium uppercase tracking-wider text-info-fg">Warna · Lengan</th>
              <th className={th}>Roll rencana</th>
              <th className={th}>Est. kg</th>
              <th className={th}>Di PO</th>
              <th className={th}>Diinvoice</th>
              <th className={th}>Diterima</th>
              <th className="px-3 py-2 text-left font-sans text-[10.5px] font-medium uppercase tracking-wider text-info-fg">Vendor</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center font-sans text-xs text-text-muted">
                  Belum ada data material untuk filter ini.
                </td>
              </tr>
            )}
            {rows.map((r) => {
              const isOpen = open.has(r.key);
              const active = r.vendors.filter((v) => v.rollRencana > 0 || v.rollPo > 0 || v.rollInvoice > 0);
              return (
                <Fragment key={r.key}>
                  <tr onClick={() => toggle(r.key)} className={"cursor-pointer border-b border-[#F1F4F7] font-sans text-xs text-[#31414F] hover:bg-[#FAFBFC] " + (isOpen ? "bg-info-bg/50" : "")}>
                    <td className="px-3 py-2.5">
                      <span className="mr-1.5 text-text-muted">{isOpen ? "▾" : "▸"}</span>
                      <span className="font-medium text-text-primary">{r.warna}</span>
                      <span className="ml-1.5 font-mono text-[10.5px] text-text-muted">{r.lengan === "PENDEK" ? "PDK" : "PJG"}</span>
                    </td>
                    <td className={td}>{formatPcs(r.rollRencana)}</td>
                    <td className={td + " text-text-muted"}>{formatPcs(Math.round(r.kgEstimasi))}</td>
                    <td className={td}>{formatPcs(r.rollPo)}</td>
                    <td className={td}>{formatPcs(r.rollInvoice)}</td>
                    <td className={td}>{formatPcs(r.rollDiterima)}</td>
                    <td className="px-3 py-2.5">
                      <span className="flex flex-wrap items-center gap-1">
                        {active.map((v) => (
                          <span key={v.vendor} className="rounded-md border border-[#DDE5EE] bg-[#F8FAFC] px-2 py-[2px] font-mono text-[10.5px] text-[#475569]">
                            <b className="text-text-primary">{vendorName(v.vendor)}</b> {formatPcs(v.rollRencana)}
                          </span>
                        ))}
                        {active.length > 1 && <StatusPill tone="info">{active.length} vendor</StatusPill>}
                      </span>
                    </td>
                  </tr>
                  {isOpen &&
                    r.vendors
                      .filter((v) => !vendorFilter || v.vendor === vendorFilter)
                      .map((v) => (
                        <tr key={r.key + v.vendor} className="border-b border-[#F1F4F7] bg-[#FAFBFC] font-sans text-[11.5px] text-[#31414F]">
                          <td className="py-2 pl-9 pr-3">
                            <span className="font-medium">{vendorName(v.vendor)}</span>
                            <span className="ml-2 text-[10.5px] text-text-muted">{v.suppliers.length > 0 ? v.suppliers.join(", ") : "supplier belum ditentukan"}</span>
                          </td>
                          <td className={td}>{formatPcs(v.rollRencana)}</td>
                          <td className={td + " text-text-muted"}>{formatPcs(Math.round(v.rollRencana * (r.kgEstimasi / Math.max(1, r.rollRencana))))}</td>
                          <td className={td}>{formatPcs(v.rollPo)}</td>
                          <td className={td}>
                            {formatPcs(v.rollInvoice)}
                            {v.kgInvoice > 0 && <span className="ml-1 text-[10px] text-text-muted">{formatPcs(Math.round(v.kgInvoice))} kg</span>}
                          </td>
                          <td className={td + (v.rollInvoice > v.rollDiterima ? " text-warning-fg" : "")}>{formatPcs(v.rollDiterima)}</td>
                          <td className="px-3 py-2 font-mono text-[10.5px] text-text-muted">{v.poIds.length > 0 ? v.poIds.join(", ") : "belum ada PO"}</td>
                        </tr>
                      ))}
                </Fragment>
              );
            })}
          </tbody>
          {rows.length > 0 && (
            <tfoot>
              <tr className="border-t-2 border-accent-blue bg-info-bg font-sans text-xs font-semibold text-info-fg">
                <td className="px-3 py-2">Total</td>
                <td className={td}>{formatPcs(sum("rollRencana"))}</td>
                <td className={td}>{formatPcs(Math.round(sum("kgEstimasi")))}</td>
                <td className={td}>{formatPcs(sum("rollPo"))}</td>
                <td className={td}>{formatPcs(sum("rollInvoice"))}</td>
                <td className={td}>{formatPcs(sum("rollDiterima"))}</td>
                <td />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}
