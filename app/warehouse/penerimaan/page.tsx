"use client";

import { useEffect, useState } from "react";
import { Download } from "lucide-react";
import { exportResiExcel } from "@/lib/mrp/exportResiExcel";
import { exportResiTemplateExcel, type ResiSheet, type ResiSheetRow } from "@/lib/mrp/exportResiTemplateExcel";
import { ResiDownloadDialog } from "@/components/warehouse/resi-download-dialog";
import { MokaPoDialog, MOKA_PO_NOTE, useMokaPoForm } from "@/components/warehouse/moka-po-dialog";
import { KoliDownloadDialog } from "@/components/warehouse/koli-download-dialog";
import { runMokaPoDownload } from "@/components/warehouse/moka-po-download";
import { alertDialog } from "@/components/ui/confirm-dialog";
import { AppShell } from "@/components/shell/app-shell";
import { KpiCard } from "@/components/ui/kpi-card";
import { Button } from "@/components/ui/button";
import { DataTable, type ColumnDef } from "@/components/mrp/data-table";
import { useMrpStore } from "@/lib/mrp/store";
import { formatDate, formatPcs, formatRupiah, localDateString, skuKategoriLookup, skuWarnaFor, warehouseReceivableGroups, warnaWithUsia, type WarehouseReceivableGroup } from "@/lib/mrp/derive";
import { VENDOR_PRODUKSI } from "@/lib/mrp/seed";

/** Panel item read-only + form "Bongkar Koli" -- TIDAK ADA input qty manual (Q5 final, konsisten
 *  R10 di spec): Warehouse cuma mengonfirmasi (boleh isi catatan bebas) lalu submit, qty & HPP
 *  seluruhnya dibaca dari data yang sudah dihitung server-side (`warehouseReceivableGroups`). */
function ReceivableGroupPanel({ group }: { group: WarehouseReceivableGroup }) {
  const receiveWarehouseResiGroup = useMrpStore((s) => s.receiveWarehouseResiGroup);
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [koliFilter, setKoliFilter] = useState("");
  const [hppFilter, setHppFilter] = useState("");
  const [downloadOpen, setDownloadOpen] = useState(false);
  const [poOpen, setPoOpen] = useState(false);
  const mokaForm = useMokaPoForm();
  const itemSellingPrices = useMrpStore((s) => s.itemSellingPrices);

  // HPP per item selalu tampil begitu ada baris HPP-nya (dari mesin HPP yang sama dengan Laporan HPP Finance: master data harga
  // maklon + biaya bahan + ongkir), TIDAK menunggu Finance membayar invoice. Selama roll belum ditutup nilainya diberi tanda
  // "estimasi"; reject tidak punya HPP.
  const hasHpp = (it: WarehouseReceivableGroup["items"][number]) => it.kind !== "REJECT" && it.hppPerItem > 0;
  const hppItems = group.items.filter(hasHpp);
  const anyEstimasi = hppItems.some((it) => it.sementara);
  const totalHppQty = hppItems.reduce((s, it) => s + it.qty, 0);
  const totalHppNilai = hppItems.reduce((s, it) => s + it.qty * it.hppPerItem, 0);
  const koliOptions = Array.from(new Set(group.items.map((it) => it.noKoli ?? it.deliveryKoliId))).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const hppQuery = hppFilter.replace(/[^0-9]/g, "");
  const visibleItems = group.items.filter((it) => {
    if (koliFilter && (it.noKoli ?? it.deliveryKoliId) !== koliFilter) return false;
    if (hppQuery && !(hasHpp(it) && String(Math.round(it.hppPerItem)).includes(hppQuery))) return false;
    return true;
  });

  /** `kolis` null = seluruh koli resi; selain itu hanya koli yang dipilih di popup (nama file memuat nomor kolinya). */
  async function handleDownload(kolis: string[] | null) {
    setError("");
    try {
      const safe = String(group.noResi ?? group.resiGroupId).replace(/[^A-Za-z0-9_-]+/g, "_");
      const koliPart = kolis && kolis.length > 0 ? "-Koli-" + kolis.map((k) => k.replace(/[^A-Za-z0-9_-]+/g, "_")).join("-") : "";
      await exportResiExcel(group, `Resi-${safe}${koliPart}.xlsx`, { kategoriOf: skuKategoriLookup(itemSellingPrices), koli: kolis ?? undefined });
    } catch (err) {
      setError("Gagal membuat file Excel: " + (err instanceof Error ? err.message : String(err)));
    }
  }

  /** Download PO per resi (owner 2026-11-16): template Moka yang sama dengan Download PO di kepala tabel, tetapi hanya item koli yang dipilih di popup (koli yang benar-benar datang;
   *  resi kadang tidak datang utuh). `kolis` null = seluruh koli. */
  async function handlePoDownload(kolis: string[] | null) {
    setError("");
    mokaForm.save();
    const picked = kolis && kolis.length > 0 ? new Set(kolis) : null;
    const scoped: WarehouseReceivableGroup = picked ? { ...group, items: group.items.filter((it) => picked.has(it.noKoli ?? it.deliveryKoliId)) } : group;
    const safe = String(group.noResi ?? group.resiGroupId);
    const tag = picked ? `${safe}-Koli-${Array.from(picked).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).join("-")}` : safe;
    await runMokaPoDownload(itemSellingPrices, [scoped], mokaForm.supplier, mokaForm.template!.text, tag);
  }

  async function handleBongkar() {
    setSubmitting(true);
    setError("");
    try {
      await receiveWarehouseResiGroup(group.resiGroupId, note.trim() || undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <select value={koliFilter} onChange={(e) => setKoliFilter(e.target.value)} className="input !w-auto !py-1.5 !text-[11.5px]">
          <option value="">Semua nomor koli</option>
          {koliOptions.map((k) => (
            <option key={k} value={k}>
              Koli {k}
            </option>
          ))}
        </select>
        <input
          value={hppFilter}
          onChange={(e) => setHppFilter(e.target.value)}
          inputMode="numeric"
          placeholder="Filter HPP/item (angka)…"
          className="input !w-[190px] !py-1.5 !text-[11.5px]"
        />
        {(koliFilter || hppFilter) && (
          <button onClick={() => { setKoliFilter(""); setHppFilter(""); }} className="font-sans text-[11px] font-semibold text-accent-blue">
            Reset
          </button>
        )}
        <span className="font-sans text-[10.5px] text-text-muted">
          {visibleItems.length} dari {group.items.length} baris
        </span>
        {/* Popup: unduh seluruh koli resi ini atau koli tertentu saja (tidak terpengaruh filter di atas). Download Excel = surat jalan; Download PO = template Import PO Moka (HPP). */}
        <div className="ml-auto flex items-center gap-2">
          <Button variant="ghost" size="sm" disabled={group.items.length === 0} onClick={() => setPoOpen(true)} title="Isi template Import PO Moka dari koli yang dipilih">
            Download PO
          </Button>
          <Button variant="accent" size="sm" disabled={group.items.length === 0} onClick={() => setDownloadOpen(true)} className="inline-flex items-center gap-1.5">
            <Download className="h-3.5 w-3.5" />
            Download Excel
          </Button>
        </div>
      </div>
      <div className="overflow-x-auto rounded-md border border-[#E4E9EE] bg-white">
        <table className="w-full min-w-[760px] border-collapse">
          <thead>
            <tr className="border-b border-[#E4E9EE] bg-[#F2F5F8] font-sans text-[10px] font-semibold uppercase tracking-wider text-text-muted">
              <th className="px-3 py-2 text-left">Koli</th>
              <th className="px-3 py-2 text-left">Warna / lengan</th>
              <th className="px-3 py-2 text-left">Size</th>
              <th className="px-3 py-2 text-left">Jenis</th>
              <th className="px-3 py-2 text-right">Qty</th>
              <th className="px-3 py-2 text-right">HPP/item</th>
              <th className="px-3 py-2 text-right">Nilai</th>
            </tr>
          </thead>
          <tbody>
            {visibleItems.map((it, i) => (
              <tr key={i} className="border-b border-[#EEF1F4] font-sans text-[11.5px] text-[#31414F] last:border-b-0">
                <td className="px-3 py-1.5 font-mono text-text-muted">{it.noKoli ?? it.deliveryKoliId}</td>
                <td className="px-3 py-1.5">
                  {it.warna} · {it.lengan}
                </td>
                <td className="px-3 py-1.5">{it.size}</td>
                <td className="px-3 py-1.5">{it.kind === "FG" ? "FG" : it.kind === "REWORK" ? "Rework" : "Reject"}</td>
                <td className="px-3 py-1.5 text-right font-mono">{formatPcs(it.qty)}</td>
                <td className="px-3 py-1.5 text-right font-mono">
                  {hasHpp(it) ? formatRupiah(it.hppPerItem) : "—"}
                  {hasHpp(it) && it.sementara && <span className="ml-1.5 rounded bg-warning-bg px-1.5 py-0.5 font-sans text-[9px] font-semibold text-warning-fg">Estimasi</span>}
                </td>
                <td className="px-3 py-1.5 text-right font-mono font-semibold text-text-primary">{hasHpp(it) ? formatRupiah(it.qty * it.hppPerItem) : "—"}</td>
              </tr>
            ))}
            {hppItems.length > 0 && (
              <tr className="border-t-2 border-accent-blue bg-info-bg font-sans text-[11.5px] font-semibold text-info-fg">
                <td colSpan={4} className="px-3 py-1.5 text-left">
                  Total HPP{anyEstimasi ? " (termasuk estimasi)" : ""}
                </td>
                <td className="px-3 py-1.5 text-right font-mono">{formatPcs(totalHppQty)}</td>
                <td />
                <td className="px-3 py-1.5 text-right font-mono">{formatRupiah(totalHppNilai)}</td>
              </tr>
            )}
            {visibleItems.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-4 text-center font-sans text-[11.5px] text-text-muted">
                  {group.items.length === 0 ? "Koli dalam resi ini belum punya item." : "Tidak ada baris yang cocok dengan filter."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {anyEstimasi && (
        <div className="font-sans text-[10.5px] text-text-muted">Estimasi = roll bahan belum ditutup Finance, jadi angka HPP masih bisa berubah sampai roll final. HPP dihitung dari data yang sama dengan Laporan HPP Finance.</div>
      )}

      {group.gateReason ? (
        <div className="rounded-md border border-[#EFC9C4] bg-[#FCF3F1] px-3 py-2 font-sans text-[11.5px] font-medium text-danger-fg">{group.gateReason}</div>
      ) : (
        <div className="flex items-end gap-2.5">
          <div className="flex-1">
            <div className="font-sans text-[9.5px] font-medium uppercase tracking-wider text-text-muted">Catatan (opsional)</div>
            <input value={note} onChange={(e) => setNote(e.target.value)} className="input mt-1 !py-1.5 !text-[11.5px]" placeholder="Catatan penerimaan…" />
          </div>
          <Button variant="primary" size="sm" disabled={submitting} onClick={handleBongkar}>
            {submitting ? "Memproses…" : "Bongkar Koli"}
          </Button>
        </div>
      )}
      {error && <div className="font-sans text-[10.5px] font-medium text-danger-fg">{error}</div>}
      {downloadOpen && <KoliDownloadDialog group={group} onDownload={handleDownload} onClose={() => setDownloadOpen(false)} />}
      {poOpen && (
        <KoliDownloadDialog
          group={group}
          title="Download PO (Import Moka) Resi"
          note={MOKA_PO_NOTE}
          extraFields={mokaForm.fields}
          extraReady={mokaForm.ready}
          onDownload={handlePoDownload}
          onClose={() => setPoOpen(false)}
        />
      )}
    </div>
  );
}

export default function WarehousePenerimaanPage() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const deliveryKolis = useMrpStore((s) => s.deliveryKolis);
  const vendorInvoices = useMrpStore((s) => s.vendorInvoices);
  const mrpDetails = useMrpStore((s) => s.mrpDetails);
  const staticMrps = useMrpStore((s) => s.staticMrps);
  const productionBatches = useMrpStore((s) => s.productionBatches);
  const productionResults = useMrpStore((s) => s.productionResults);
  const productionGroupMeta = useMrpStore((s) => s.productionGroupMeta);
  const rawInvoices = useMrpStore((s) => s.invoices);
  const warehouseReceipts = useMrpStore((s) => s.warehouseReceipts);
  const ekspedisiRates = useMrpStore((s) => s.ekspedisiRates);
  const itemSellingPrices = useMrpStore((s) => s.itemSellingPrices);
  const hargaMaklon = useMrpStore((s) => s.hargaMaklon);
  const maklonPOs = useMrpStore((s) => s.maklonPOs);
  const [downloadOpen, setDownloadOpen] = useState(false);
  const [poOpen, setPoOpen] = useState(false);

  if (!mounted) return null;

  const groupsUnsorted = warehouseReceivableGroups(
    deliveryKolis,
    vendorInvoices,
    mrpDetails,
    staticMrps,
    productionBatches,
    productionResults,
    productionGroupMeta,
    rawInvoices,
    warehouseReceipts,
    ekspedisiRates,
    itemSellingPrices,
    hargaMaklon
  );

  // Terbaru di atas: tanggal kirim terbaru dulu (hanya tanggal, tanpa jam), sama tanggal -> koli yang paling baru dibuat dulu, lalu kunci resi yang lebih baru.
  const koliCreatedAt = new Map(deliveryKolis.map((k) => [k.id, k.createdAt ?? ""]));
  const newestKoliOf = (g: WarehouseReceivableGroup) => g.koliIds.reduce((m, id) => ((koliCreatedAt.get(id) ?? "") > m ? (koliCreatedAt.get(id) ?? "") : m), "");
  const groups = [...groupsUnsorted].sort(
    (a, b) =>
      (b.deliveredAt ?? "").localeCompare(a.deliveredAt ?? "") ||
      newestKoliOf(b).localeCompare(newestKoliOf(a)) ||
      b.resiGroupId.localeCompare(a.resiGroupId, undefined, { numeric: true })
  );

  const uniqSorted = (xs: string[]) => Array.from(new Set(xs.filter(Boolean))).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const vendorName = (g: WarehouseReceivableGroup) => VENDOR_PRODUKSI[g.vendorProduksi]?.name ?? g.vendorProduksi;
  const hppOf = (g: WarehouseReceivableGroup) => {
    const billable = g.items.filter((it) => it.kind !== "REJECT");
    const missing = billable.some((it) => it.hppPerItem <= 0);
    return { value: g.totalNilai, anyEstimasi: g.items.some((it) => it.sementara), missing, none: billable.every((it) => it.hppPerItem <= 0) };
  };

  /** Excel pengiriman per resi (template owner 2026-11-09): satu sheet satu resi. Nama item dari Master SKU (tanpa itu "WARNA PDK/PJG SIZE"); NO PO = PO Produksi MRP + vendor resi itu. */
  async function downloadResiSheets(selected: WarehouseReceivableGroup[]) {
    try {
      const nameByKey = new Map<string, string>();
      for (const r of itemSellingPrices) {
        const key = `${r.warna}|${r.lengan}|${r.size}`;
        if (r.itemName && !nameByKey.has(key)) nameByKey.set(key, r.itemName);
      }
      const sheets: ResiSheet[] = selected.map((g) => {
        const merged = new Map<string, ResiSheetRow>();
        // HPP per item = rata-rata tertimbang qty kalau item yang sama berasal dari beberapa roll; reject tidak punya HPP.
        const hppAcc = new Map<string, { nilai: number; qty: number; estimasi: boolean }>();
        for (const it of g.items) {
          const type = it.kind === "FG" ? "FINISH GOOD" : it.kind === "REWORK" ? "REWORK" : "REJECT";
          const noKoli = it.noKoli ?? it.deliveryKoliId;
          // Item (MOKA): warna memakai nama di Master Data SKU lewat Mapping Warna (mis. FUCHSIA 24S -> FANTA 24S). Nama item (Master SKU) dicari dengan nama warna ERP lalu nama warna SKU.
          // Item Kids: nama varian Kids ("BEIGE 24S" + Kids -> "BEIGE 24S KID" -> mapping "BEIGE KID 24S"), supaya tidak tertukar dengan item dewasa warna yang sama.
          const warna = warnaWithUsia(it.warna, it.usia);
          const skuWarna = skuWarnaFor(it.warna, it.usia);
          const itemMoka = `${skuWarna} ${it.lengan === "PENDEK" ? "PDK" : "PJG"} ${it.size}`;
          const itemName = nameByKey.get(`${warna}|${it.lengan}|${it.size}`) ?? nameByKey.get(`${skuWarna}|${it.lengan}|${it.size}`) ?? itemMoka;
          const key = [noKoli, itemName, type].join("|");
          const cur = merged.get(key);
          if (cur) cur.qty += it.qty;
          else merged.set(key, { noKoli, itemName, itemMoka, qty: it.qty, type, hppPerItem: null });
          if (it.kind !== "REJECT" && it.hppPerItem > 0) {
            const a = hppAcc.get(key) ?? { nilai: 0, qty: 0, estimasi: false };
            a.nilai += it.qty * it.hppPerItem;
            a.qty += it.qty;
            a.estimasi = a.estimasi || !!it.sementara;
            hppAcc.set(key, a);
          }
        }
        for (const [key, row] of merged) {
          const a = hppAcc.get(key);
          if (a && a.qty > 0) {
            row.hppPerItem = a.nilai / a.qty;
            row.estimasi = a.estimasi;
          }
        }
        const noPo = maklonPOs.filter((p) => g.mrpIds.includes(p.mrpId) && p.vendorProduksi === g.vendorProduksi).map((p) => p.id).join(", ");
        return { noResi: g.noResi ?? g.resiGroupId, noPo, deliveredAt: g.deliveredAt, rows: Array.from(merged.values()) };
      });
      await exportResiTemplateExcel(sheets, `Pengiriman-per-Resi-${localDateString(new Date())}.xlsx`);
    } catch (e) {
      await alertDialog({ title: "Gagal membuat Excel", message: e instanceof Error ? e.message : "Terjadi kesalahan saat membuat file Excel.", tone: "danger" });
    }
  }

  /** Download PO dari kepala tabel (pilih resi): isi template Moka, logikanya di `runMokaPoDownload`. */
  const downloadMokaPo = (selected: WarehouseReceivableGroup[], supplierEmail: string, templateText: string) => runMokaPoDownload(itemSellingPrices, selected, supplierEmail, templateText);

  const readyCount = groups.filter((g) => !g.gateReason).length;
  const waitingCount = groups.length - readyCount;
  const totalNilaiReady = groups.filter((g) => !g.gateReason).reduce((s, g) => s + g.totalNilai, 0);

  // Tampilan tabel (owner 2026-11-09): No MRP (W39, W40, tanpa kategori), Jumlah Koli, Ekspedisi, No Resi (kolom pertama), Tanggal Kirim, Total Qty, Total HPP, dan Status
  // = apakah resi sudah divalidasi Procurement (Invoice Ekspedisi), BUKAN lagi status pembayaran invoice vendor. Syarat Bongkar (invoice vendor ada dan tidak direvisi, ongkir tervalidasi)
  // tetap berlaku dan tampil di panel rincian baris serta kolom opsional "Syarat Bongkar".
  // Label dipendekkan (owner 2026-11-16: tabel terpotong di layar); keterangan lengkap ada di tooltip kolom Status.
  const STATUS_RESI = ["Sudah divalidasi", "Menunggu validasi", "Tanpa ongkir"];
  const ongkirLabelOf = (g: WarehouseReceivableGroup) => (g.ongkirValidasi === "VALIDATED" ? STATUS_RESI[0] : g.ongkirValidasi === "PENDING" ? STATUS_RESI[1] : STATUS_RESI[2]);
  const ongkirTitleOf = (g: WarehouseReceivableGroup) =>
    g.ongkirValidasi === "VALIDATED" ? "Resi sudah divalidasi Procurement (Invoice Ekspedisi)" : g.ongkirValidasi === "PENDING" ? "Menunggu Procurement memvalidasi invoice ekspedisi resi ini" : "Pengiriman internal, tanpa ongkir";
  const columns: ColumnDef<WarehouseReceivableGroup>[] = [
    { key: "mrp", label: "No MRP", default: true, render: (g) => <span className="font-mono font-semibold">{g.mrpIds.join(", ")}</span> },
    { key: "vendor", label: "Vendor", default: true, render: (g) => VENDOR_PRODUKSI[g.vendorProduksi]?.name ?? g.vendorProduksi },
    { key: "jumlahKoli", label: "Koli", default: true, align: "right", render: (g) => <span className="font-mono">{g.koliIds.length}</span> },
    {
      key: "ekspedisi",
      label: "Ekspedisi",
      default: true,
      render: (g) => (g.ekspedisi ? <span title={g.ekspedisi} className="inline-block max-w-[170px] truncate align-bottom">{g.ekspedisi}</span> : "—"),
    },
    { key: "tanggalKirim", label: "Tanggal Kirim", default: true, render: (g) => formatDate(g.deliveredAt) },
    { key: "qty", label: "Qty", default: true, align: "right", render: (g) => <span className="font-mono">{formatPcs(g.totalQty)}</span> },
    {
      // HPP resi ini = Σ qty x HPP/item (mesin HPP yang sama dengan Laporan HPP Finance), tampil walau invoice belum dibayar.
      key: "totalHpp",
      label: "HPP",
      default: true,
      align: "right",
      render: (g) => {
        const h = hppOf(g);
        if (h.none) return <span className="text-text-muted">—</span>;
        return (
          <span className="font-mono">
            {formatRupiah(h.value)}
            {(h.anyEstimasi || h.missing) && <span className="ml-1.5 font-sans text-[9.5px] font-semibold text-warning-fg">{h.missing ? "belum lengkap" : "est."}</span>}
          </span>
        );
      },
    },
    {
      key: "status",
      label: "Status",
      default: true,
      render: (g) =>
        g.ongkirValidasi === "VALIDATED" ? (
          <span title={ongkirTitleOf(g)} className="font-sans text-[11px] font-semibold text-success-fg">✓ {ongkirLabelOf(g)}</span>
        ) : g.ongkirValidasi === "PENDING" ? (
          <span title={ongkirTitleOf(g)} className="font-sans text-[11px] font-semibold text-danger-fg">{ongkirLabelOf(g)}</span>
        ) : (
          <span title={ongkirTitleOf(g)} className="font-sans text-[11px] text-text-muted">{ongkirLabelOf(g)}</span>
        ),
    },
    { key: "noKoli", label: "No Koli", default: false, render: (g) => g.noKoli },
    { key: "invoice", label: "No Invoice Vendor", default: false, render: (g) => (g.invoiceIds.length > 0 ? g.invoiceIds.join(", ") : "—") },
    {
      // Syarat Bongkar: invoice vendor ada, tidak sedang direvisi, dan ongkir tervalidasi (pembayaran invoice bukan syarat lagi). Tidak tampil bawaan.
      key: "syaratBongkar",
      label: "Syarat Bongkar",
      default: false,
      render: (g) =>
        g.gateReason ? <span className="font-sans text-[10.5px] font-semibold text-danger-fg">{g.gateReason}</span> : <span className="font-sans text-[10.5px] font-semibold text-success-fg">Siap dibongkar</span>,
    },
    {
      // Item 2026-09-16 (integrasi WMS, migration 0041) -- status TERPISAH: murni menandai barang sudah dicek fisik masuk di
      // WMS atau belum, tidak memengaruhi boleh/tidaknya "Bongkar Koli".
      key: "statusWms",
      label: "Status WMS",
      default: false,
      render: (g) =>
        g.wmsReceivedAt ? (
          <span className="font-sans text-[10.5px] font-semibold text-success-fg">✓ Diterima WMS · {formatDate(g.wmsReceivedAt)}</span>
        ) : (
          <span className="font-sans text-[10.5px] text-text-muted">Belum dikonfirmasi WMS</span>
        ),
    },
  ];

  return (
    <AppShell
      role="warehouse"
      activeHref="/warehouse/penerimaan"
      breadcrumb={["Warehouse", "Penerimaan"]}
      title="Penerimaan"
    >
      <div className="grid grid-cols-3 gap-3.5">
        <KpiCard label="Siap dibongkar" value={formatPcs(readyCount)} sub="invoice vendor ada dan ongkir tervalidasi" accent="success" />
        <KpiCard label="Menunggu invoice" value={formatPcs(waitingCount)} sub="resi belum lolos syarat" accent="orange" />
        <KpiCard label="Nilai siap dibongkar" value={formatRupiah(totalNilaiReady)} accent="blue" />
      </div>

      <DataTable
        title="Batch Pengiriman (Resi)"
        subtitle="Klik baris untuk lihat rincian item & tombol Bongkar"
        headerActions={
          <div className="flex items-center gap-2">
            <Button onClick={() => setPoOpen(true)} variant="ghost" size="md" disabled={groups.length === 0} title="Isi template Import PO Moka (supplier, order = qty, unit cost = HPP) dari resi yang dipilih">
              Download PO
            </Button>
            <Button onClick={() => setDownloadOpen(true)} variant="ghost" size="md" disabled={groups.length === 0} title="Excel pengiriman: satu sheet per resi, pilih resi yang diunduh">
              Download Excel
            </Button>
          </div>
        }
        nowrap
        columns={columns}
        rows={groups}
        keyOf={(g) => g.resiGroupId}
        search={{
          placeholder: "Cari no resi, no koli, no MRP, no invoice…",
          getText: (g) => [g.noResi, g.resiGroupId, g.noKoli, g.mrpLabel, g.mrpId, g.invoiceIds.join(" ")].filter(Boolean).join(" "),
        }}
        searchRight
        fitExpanded
        bordered
        singleExpand
        filterDefs={[
          { label: "No MRP", options: uniqSorted(groups.flatMap((g) => g.mrpIds)).reverse(), test: (g, v) => g.mrpIds.includes(v) },
          { label: "Vendor", options: uniqSorted(groups.map(vendorName)), test: (g, v) => vendorName(g) === v },
          { label: "Status Resi", options: STATUS_RESI.filter((o) => groups.some((g) => ongkirLabelOf(g) === o)), test: (g, v) => ongkirLabelOf(g) === v },
          { label: "Ekspedisi", options: uniqSorted(groups.map((g) => g.ekspedisi)), test: (g, v) => g.ekspedisi === v },
        ]}
        firstColumnLabel="No Resi"
        firstColumnRender={(g) => <span className="font-mono">{g.noResi ?? g.resiGroupId}</span>}
        renderExpanded={(g) => <ReceivableGroupPanel group={g} />}
        emptyText="Belum ada koli yang siap/menunggu diterima."
      />
      {poOpen && <MokaPoDialog groups={groups} vendorName={vendorName} onDownload={downloadMokaPo} onClose={() => setPoOpen(false)} />}
      {downloadOpen && <ResiDownloadDialog groups={groups} vendorName={vendorName} onDownload={downloadResiSheets} onClose={() => setDownloadOpen(false)} />}
    </AppShell>
  );
}
