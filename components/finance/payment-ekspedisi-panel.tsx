"use client";

import { useMemo, useState } from "react";
import { StatusPill } from "@/components/ui/status-pill";
import { Checkbox } from "@/components/ui/checkbox";
import { DataTable, type ColumnDef } from "@/components/mrp/data-table";
import { MultiFileInput } from "@/components/mrp/multi-file-input";
import { VendorPhotoLinks, kirimDateText } from "@/components/mrp/ekspedisi-photo-links";
import { useMrpStore } from "@/lib/mrp/store";
import { readProofAsDataUrl } from "@/lib/mrp/clientFiles";
import { saveEkspedisiInvoiceFiles, viewEkspedisiInvoiceFiles, type AttachFile } from "@/lib/mrp/attachments";
import { ekspedisiInvoiceBadge, ekspedisiResiGroups, type EkspedisiResiGroup } from "@/lib/mrp/ekspedisiInvoice";
import { formatDate, formatRupiah } from "@/lib/mrp/derive";
import { VENDOR_PRODUKSI } from "@/lib/mrp/seed";
import { SysadminActionsBar } from "@/components/sysadmin/correction-dialog";
import { ekspedisiInvoiceCorrections } from "@/components/sysadmin/finance-corrections";

const vendorName = (id: string) => VENDOR_PRODUKSI[id]?.name ?? id;
const kg = (n: number) => n.toLocaleString("id-ID", { maximumFractionDigits: 2 }) + " kg";

async function readFile(file: File): Promise<AttachFile | { error: string }> {
  const r = await readProofAsDataUrl(file);
  return "error" in r ? { error: r.error } : { dataUrl: r.dataUrl, fileName: r.fileName };
}

/** Panel "Payment Ekspedisi" di Finance > Payment: invoice ekspedisi per resi yang sudah divalidasi dan diajukan Procurement. Bayar lunas dengan bukti bayar wajib
 *  (pola sama Payment Maklon). Biayanya sudah dipakai sebagai ongkir HPP sejak Procurement memvalidasi. */
export function PaymentEkspedisiPanel() {
  const deliveryKolis = useMrpStore((s) => s.deliveryKolis);
  const ekspedisiRates = useMrpStore((s) => s.ekspedisiRates);
  const payEkspedisiInvoices = useMrpStore((s) => s.payEkspedisiInvoices);
  const refresh = useMrpStore((s) => s.refresh);
  const groups = useMemo(() => ekspedisiResiGroups(deliveryKolis, ekspedisiRates), [deliveryKolis, ekspedisiRates]);
  const ready = groups.filter((g) => g.invoice?.status === "SUBMITTED");
  const paid = groups.filter((g) => g.invoice?.status === "PAID").sort((a, b) => (b.invoice?.paidAt ?? "").localeCompare(a.invoice?.paidAt ?? ""));

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [proofFiles, setProofFiles] = useState<AttachFile[]>([]);
  const [paying, setPaying] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const selectedList = ready.filter((g) => selected.has(g.key));
  const selectedTotal = selectedList.reduce((s, g) => s + (g.invoice?.biaya ?? 0), 0);

  function toggle(key: string) {
    setResult(null);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function payAll() {
    if (paying || proofFiles.length === 0 || selectedList.length === 0) return;
    setPaying(true);
    try {
      const keys = selectedList.map((g) => g.key);
      await payEkspedisiInvoices(keys, { dataUrl: proofFiles[0].dataUrl, fileName: proofFiles[0].fileName });
      // File bukti ke-2 dan seterusnya disimpan setelah pembayaran tercatat; kegagalannya hanya diberi tahu.
      let extraError: string | null = null;
      if (proofFiles.length > 1) {
        for (const key of keys) {
          extraError = await saveEkspedisiInvoiceFiles(key, "BUKTI", proofFiles, true);
          if (extraError) break;
        }
        await refresh();
      }
      setResult(extraError ? `${keys.length} invoice ekspedisi dibayar lunas, tetapi file tambahan gagal diunggah: ${extraError}` : `${keys.length} invoice ekspedisi dibayar lunas.`);
      setSelected(new Set());
      setProofFiles([]);
    } catch {
      // pesan gagal sudah ditampilkan store dan perubahan dibatalkan; bukti tetap terisi supaya bisa dicoba lagi
    } finally {
      setPaying(false);
    }
  }

  const common: ColumnDef<EkspedisiResiGroup>[] = [
    { key: "sysadmin", label: "Aksi Sysadmin", default: true, sysadmin: true, render: (g) => <SysadminActionsBar compact actions={ekspedisiInvoiceCorrections(g.key, g.invoice)} /> },
    { key: "mrp", label: "No MRP", default: true, render: (g) => <span className="font-mono">{g.mrpIds.join(", ")}</span> },
    { key: "vendor", label: "Vendor", default: true, render: (g) => vendorName(g.vendorProduksi) },
    { key: "ekspedisi", label: "Ekspedisi", default: true, render: (g) => g.ekspedisi },
    { key: "koli", label: "No Koli", default: true, render: (g) => <span className="font-mono text-[11px]">{g.noKolis.join(", ")}</span> },
    { key: "tgl", label: "Tgl Kirim", default: true, render: (g) => <span className="whitespace-nowrap">{kirimDateText(g)}</span> },
    { key: "jumlahKoli", label: "Jumlah Koli", default: true, align: "right", render: (g) => <span className="font-mono font-semibold">{g.koliIds.length}</span> },
    { key: "berat", label: "Berat Resi", default: false, align: "right", render: (g) => <span className="font-mono">{kg(g.beratResi)}</span> },
    { key: "noNota", label: "No Nota", default: true, render: (g) => <span className="font-mono text-[11px]">{g.invoice?.noNota ?? "—"}</span> },
    { key: "biaya", label: "Biaya Ekspedisi", default: true, align: "right", render: (g) => <span className="font-mono font-semibold">{formatRupiah(g.invoice?.biaya ?? 0)}</span> },
    {
      key: "lampiranVendor",
      label: "Lampiran Vendor",
      default: false,
      render: (g) => <VendorPhotoLinks ids={g.photoKoliIds} />,
    },
    {
      key: "nota",
      label: "Nota Ekspedisi",
      default: true,
      render: (g) =>
        (g.invoice?.notaCount ?? 0) > 0 ? (
          <span onClick={(e) => e.stopPropagation()}>
            <button onClick={() => void viewEkspedisiInvoiceFiles(g.key, "NOTA")} className="font-sans text-[11px] font-semibold text-action-primary underline">
              Lihat / Download ({g.invoice?.notaCount})
            </button>
          </span>
        ) : (
          <span className="text-text-muted">—</span>
        ),
    },
  ];

  const readyColumns: ColumnDef<EkspedisiResiGroup>[] = [
    ...common,
    { key: "diajukan", label: "Diajukan", default: true, render: (g) => <span className="font-sans text-[11px]">{formatDate(g.invoice?.submittedAt)} · {g.invoice?.submittedBy ?? "-"}</span> },
    { key: "status", label: "Status", default: true, render: (g) => <StatusPill tone={ekspedisiInvoiceBadge(g.invoice?.status).tone}>{ekspedisiInvoiceBadge(g.invoice?.status).label}</StatusPill> },
  ];

  const paidColumns: ColumnDef<EkspedisiResiGroup>[] = [
    ...common,
    { key: "tglLunas", label: "Tanggal Lunas", default: true, render: (g) => formatDate(g.invoice?.paidAt) },
    { key: "pic", label: "PIC Pembayaran", default: true, render: (g) => <span className="font-sans text-[11px]">{g.invoice?.paidBy ?? "-"}</span> },
    {
      key: "bukti",
      label: "Bukti Bayar",
      default: true,
      render: (g) =>
        (g.invoice?.buktiCount ?? 0) > 0 ? (
          <span onClick={(e) => e.stopPropagation()}>
            <button onClick={() => void viewEkspedisiInvoiceFiles(g.key, "BUKTI")} className="font-sans text-[11px] font-semibold text-action-primary underline">
              Lihat / Download
            </button>
          </span>
        ) : (
          <span className="text-text-muted">—</span>
        ),
    },
    { key: "status", label: "Status", default: true, render: (g) => <StatusPill tone={ekspedisiInvoiceBadge(g.invoice?.status).tone}>{ekspedisiInvoiceBadge(g.invoice?.status).label}</StatusPill> },
  ];

  const searchDef = {
    placeholder: "Cari no resi, no koli, no MRP, vendor…",
    getText: (g: EkspedisiResiGroup) => [g.invoice?.noResi, g.invoice?.noNota, g.noKolis.join(" "), g.mrpIds.join(" "), vendorName(g.vendorProduksi), g.ekspedisi].filter(Boolean).join(" "),
  };
  const firstCol = (g: EkspedisiResiGroup) => (
    <span className="flex flex-col">
      <span className="font-mono font-medium">{g.invoice?.noResi ?? g.noResi}</span>
      {g.invoice?.noResiAsli && <span className="font-sans text-[10px] text-warning-fg">diubah dari {g.invoice.noResiAsli}</span>}
    </span>
  );
  const filterFor = (rows: EkspedisiResiGroup[]) => [
    { label: "No MRP", options: Array.from(new Set(rows.flatMap((g) => g.mrpIds))).sort().reverse(), test: (g: EkspedisiResiGroup, v: string) => g.mrpIds.includes(v) },
    { label: "Vendor", options: Array.from(new Set(rows.map((g) => vendorName(g.vendorProduksi)))).sort(), test: (g: EkspedisiResiGroup, v: string) => vendorName(g.vendorProduksi) === v },
    { label: "Ekspedisi", options: Array.from(new Set(rows.map((g) => g.ekspedisi))).sort(), test: (g: EkspedisiResiGroup, v: string) => g.ekspedisi === v },
  ];

  return (
    <>
      {result && (
        <div className="flex items-center gap-2 rounded-lg border border-[#F0DFC2] bg-warning-bg px-5 py-[10px] font-sans text-xs font-medium text-warning-fg">
          {result}
          <button onClick={() => setResult(null)} className="ml-auto font-sans text-[11px] font-semibold underline">
            Tutup
          </button>
        </div>
      )}

      {selected.size > 0 && (
        <div className="flex items-center gap-2 rounded-lg border border-[#CFE0EF] bg-info-bg px-5 py-[10px]">
          <span className="font-sans text-xs font-medium text-info-fg">
            {selected.size} dipilih · total {formatRupiah(selectedTotal)}
          </span>
          <div className="flex items-start gap-2 font-sans text-[11.5px] text-info-fg">
            <span className="pt-1 font-semibold">Bukti pembayaran (wajib):</span>
            <div className="w-[260px]">
              <MultiFileInput
                files={proofFiles}
                onChange={setProofFiles}
                readFile={readFile}
                accept="application/pdf,image/jpeg,image/png"
                inputClassName="w-full rounded-md border border-[#A8C5DF] bg-white px-2 py-1 text-[11px] file:mr-2 file:rounded file:border-0 file:bg-info-bg file:px-2 file:py-0.5 file:text-[11px] file:font-semibold file:text-info-fg"
              />
            </div>
          </div>
          <button
            onClick={() => void payAll()}
            disabled={paying || proofFiles.length === 0}
            title={proofFiles.length === 0 ? "Upload bukti pembayaran (PDF/JPG/PNG) dulu" : undefined}
            className="rounded-md border border-[#A8C5DF] bg-white px-2.5 py-[6px] font-sans text-[11.5px] font-semibold text-success-fg disabled:cursor-not-allowed disabled:opacity-50"
          >
            Bayar Penuh
          </button>
        </div>
      )}

      <DataTable
        title="Invoice ekspedisi siap dibayar"
        columns={readyColumns}
        rows={ready}
        keyOf={(g) => g.key}
        search={searchDef}
        filterDefs={filterFor(ready)}
        firstColumnLabel="No Resi"
        firstColumnRender={(g) => (
          <span className="flex items-center gap-2.5">
            <span onClick={(e) => e.stopPropagation()}>
              <Checkbox checked={selected.has(g.key)} onChange={() => toggle(g.key)} />
            </span>
            {firstCol(g)}
          </span>
        )}
        emptyText="Belum ada invoice ekspedisi yang diajukan Procurement."
      />

      <DataTable
        title="Riwayat pembayaran ekspedisi"
        columns={paidColumns}
        rows={paid}
        keyOf={(g) => g.key}
        search={searchDef}
        filterDefs={filterFor(paid)}
        firstColumnLabel="No Resi"
        firstColumnRender={firstCol}
        emptyText="Belum ada invoice ekspedisi yang dibayar."
      />
    </>
  );
}
