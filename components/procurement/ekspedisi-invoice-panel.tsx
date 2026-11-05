"use client";

import { useMemo, useState } from "react";
import { StatusPill } from "@/components/ui/status-pill";
import { confirmDialog } from "@/components/ui/confirm-dialog";
import { DataTable, type ColumnDef } from "@/components/mrp/data-table";
import { MultiFileInput } from "@/components/mrp/multi-file-input";
import { viewEkspedisiPhoto } from "@/components/mrp/koli-ekspedisi-card";
import { useMrpStore } from "@/lib/mrp/store";
import { readProofAsDataUrl } from "@/lib/mrp/clientFiles";
import { viewEkspedisiInvoiceFiles, type AttachFile } from "@/lib/mrp/attachments";
import { ekspedisiInvoiceBadge, ekspedisiResiGroups, type EkspedisiResiGroup } from "@/lib/mrp/ekspedisiInvoice";
import { formatDate, formatRupiah } from "@/lib/mrp/derive";
import { VENDOR_PRODUKSI } from "@/lib/mrp/seed";
import { ResiKoliDetail } from "@/components/mrp/resi-koli-detail";
import { SysadminActionsBar } from "@/components/sysadmin/correction-dialog";
import { ekspedisiInvoiceCorrections } from "@/components/sysadmin/finance-corrections";

const vendorName = (id: string) => VENDOR_PRODUKSI[id]?.name ?? id;
const kg = (n: number) => n.toLocaleString("id-ID", { maximumFractionDigits: 2 }) + " kg";

async function readFile(file: File): Promise<AttachFile | { error: string }> {
  const r = await readProofAsDataUrl(file);
  return "error" in r ? { error: r.error } : { dataUrl: r.dataUrl, fileName: r.fileName };
}

/** Selisih biaya aktual terhadap estimasi tarif master. Tidak ada estimasi (ekspedisi tidak ada di Master Data) = tanpa pembanding. */
function diffText(biaya: number, estimasi: number): { text: string; tone: string } | null {
  if (!(biaya > 0) || !(estimasi > 0)) return null;
  const diff = biaya - estimasi;
  const pct = (diff / estimasi) * 100;
  const sign = diff > 0 ? "+" : diff < 0 ? "−" : "";
  return {
    text: `${sign}${formatRupiah(Math.abs(diff))} (${sign}${Math.abs(pct).toFixed(1)}%)`,
    tone: diff > 0 ? "text-danger-fg" : diff < 0 ? "text-success-fg" : "text-text-muted",
  };
}

function EkspedisiInvoiceModal({ group, onClose }: { group: EkspedisiResiGroup; onClose: () => void }) {
  const saveEkspedisiInvoice = useMrpStore((s) => s.saveEkspedisiInvoice);
  const inv = group.invoice;
  const [noResi, setNoResi] = useState(inv?.noResi ?? group.noResi);
  const [noNota, setNoNota] = useState(inv?.noNota ?? "");
  const [biayaText, setBiayaText] = useState(inv ? String(Math.round(inv.biaya)) : "");
  const [catatan, setCatatan] = useState(inv?.catatan ?? "");
  const [files, setFiles] = useState<AttachFile[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const biaya = Number(biayaText.replace(/[^0-9]/g, "")) || 0;
  const perKg = group.beratResi > 0 && biaya > 0 ? biaya / group.beratResi : 0;
  const diff = diffText(biaya, group.estimasiMaster);
  const hasNota = files.length > 0 || (inv?.notaCount ?? 0) > 0;
  const vendorNoResi = inv?.noResiAsli ?? group.noResi;
  const resiChanged = noResi.trim() !== vendorNoResi;

  async function run(submitAfter: boolean) {
    if (busy) return;
    if (!noResi.trim()) return setError("No resi wajib diisi.");
    if (biaya <= 0) return setError("Biaya ekspedisi harus lebih dari 0.");
    if (submitAfter && !hasNota) return setError("Upload nota/lampiran ekspedisi dulu sebelum diajukan ke Finance.");
    setBusy(true);
    setError("");
    try {
      // Satu alur: simpan + unggah nota + (ajukan), satu kali ambil-ulang data di akhir (sebelumnya tiga langkah dengan tiga kali ambil-ulang, sehingga lama).
      const res = await saveEkspedisiInvoice({ key: group.key, noResi: noResi.trim(), biaya, noNota: noNota.trim(), catatan: catatan.trim(), submit: submitAfter }, files);
      if (res.extraError) {
        setError("Biaya tersimpan, tetapi langkah berikutnya gagal: " + res.extraError);
        return;
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-[#0B131B]/45 p-4" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()} role="presentation">
      <div role="dialog" aria-modal="true" className="flex max-h-[92vh] w-full max-w-[640px] flex-col overflow-hidden rounded-xl bg-white shadow-[0_12px_32px_rgba(11,19,27,.25)]">
        <div className="border-b border-[#E4E9EE] px-6 py-4">
          <div className="font-sans text-[15px] font-semibold text-text-primary">Validasi invoice ekspedisi</div>
          <div className="mt-0.5 font-sans text-[11.5px] text-text-muted">
            Biaya yang disimpan di sini menggantikan tarif master sebagai ongkir HPP untuk resi ini.
          </div>
        </div>

        <div className="flex flex-col gap-4 overflow-y-auto px-6 py-4">
          <div className="grid grid-cols-2 gap-x-6 gap-y-2 rounded-md border border-[#E4E9EE] bg-[#FAFBFC] p-3 font-sans text-[11.5px] text-[#31414F]">
            <div>
              MRP: <span className="font-mono font-semibold">{group.mrpId}</span>
            </div>
            <div>
              Vendor: <span className="font-semibold">{vendorName(group.vendorProduksi)}</span>
            </div>
            <div>
              Ekspedisi: <span className="font-semibold">{group.ekspedisi}</span>
            </div>
            <div>
              Tgl kirim: <span className="font-mono">{formatDate(group.tanggalKirim)}</span>
            </div>
            <div className="col-span-2">
              No koli ({group.koliIds.length} koli): <span className="font-mono">{group.noKolis.join(", ")}</span>
            </div>
            <div>
              No resi dari vendor: <span className="font-mono font-semibold">{vendorNoResi || "—"}</span>
            </div>
            <div>
              Lampiran vendor:{" "}
              {group.hasVendorPhoto ? (
                <button onClick={() => viewEkspedisiPhoto(group.firstKoliId)} className="font-semibold text-action-primary underline">
                  Lihat / Download
                </button>
              ) : (
                <span className="text-text-muted">—</span>
              )}
            </div>
            <div>
              Berat resi: <span className="font-mono font-semibold">{kg(group.beratResi)}</span>
            </div>
            <div>
              Tarif master: <span className="font-mono">{group.tarifMasterPerKg > 0 ? `${formatRupiah(group.tarifMasterPerKg)}/kg` : "tidak ada di Master Data"}</span>
            </div>
            <div className="col-span-2">
              Estimasi ongkir (tarif master x berat): <span className="font-mono font-semibold">{group.estimasiMaster > 0 ? formatRupiah(group.estimasiMaster) : "—"}</span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 font-sans text-[11px] font-medium uppercase tracking-wider text-text-muted">
              No resi (sesuai nota ekspedisi)
              <input
                value={noResi}
                onChange={(e) => setNoResi(e.target.value)}
                maxLength={80}
                className="rounded-md border border-[#DDE4EB] px-3 py-2 font-mono text-[12.5px] normal-case tracking-normal text-text-primary"
              />
              {resiChanged && <span className="font-sans text-[10.5px] font-medium normal-case tracking-normal text-warning-fg">Berbeda dari resi vendor — no resi di data pengiriman ikut diubah.</span>}
            </label>
            <label className="flex flex-col gap-1 font-sans text-[11px] font-medium uppercase tracking-wider text-text-muted">
              No nota/invoice ekspedisi (opsional)
              <input
                value={noNota}
                onChange={(e) => setNoNota(e.target.value)}
                maxLength={80}
                className="rounded-md border border-[#DDE4EB] px-3 py-2 font-mono text-[12.5px] normal-case tracking-normal text-text-primary"
              />
            </label>
            <label className="col-span-2 flex flex-col gap-1 font-sans text-[11px] font-medium uppercase tracking-wider text-text-muted">
              Biaya ekspedisi aktual, total resi ini (Rp)
              <span className="flex items-stretch gap-2">
                <input
                  value={biayaText ? Number(biayaText.replace(/[^0-9]/g, "")).toLocaleString("id-ID") : ""}
                  onChange={(e) => setBiayaText(e.target.value.replace(/[^0-9]/g, ""))}
                  inputMode="numeric"
                  placeholder="0"
                  className="min-w-0 flex-1 rounded-md border border-[#DDE4EB] px-3 py-2 font-mono text-[14px] font-semibold normal-case tracking-normal text-text-primary"
                />
                {group.estimasiMaster > 0 && (
                  <button
                    type="button"
                    onClick={() => setBiayaText(String(Math.round(group.estimasiMaster)))}
                    disabled={biaya === Math.round(group.estimasiMaster)}
                    title="Isi biaya dengan estimasi tarif master x berat resi, kalau nota ekspedisi sesuai tarif master"
                    className="flex-none rounded-md border border-action-primary bg-white px-3 font-sans text-[11.5px] font-semibold normal-case tracking-normal text-action-primary hover:bg-info-bg disabled:cursor-default disabled:border-[#CBD5DF] disabled:bg-[#F2F5F8] disabled:text-success-fg"
                  >
                    {biaya === Math.round(group.estimasiMaster) ? "✓ Sesuai estimasi master" : `Valid sesuai master (${formatRupiah(group.estimasiMaster)})`}
                  </button>
                )}
              </span>
              <span className="font-sans text-[11px] font-normal normal-case tracking-normal text-text-muted">
                {perKg > 0 ? (
                  <>
                    Setara <span className="font-mono">{formatRupiah(Math.round(perKg))}/kg</span>
                    {diff && (
                      <>
                        {" · selisih dari estimasi master: "}
                        <span className={"font-mono font-semibold " + diff.tone}>{diff.text}</span>
                      </>
                    )}
                  </>
                ) : (
                  "Isi total biaya sesuai nota ekspedisi."
                )}
              </span>
            </label>
            <label className="col-span-2 flex flex-col gap-1 font-sans text-[11px] font-medium uppercase tracking-wider text-text-muted">
              Catatan (opsional)
              <input
                value={catatan}
                onChange={(e) => setCatatan(e.target.value)}
                maxLength={500}
                className="rounded-md border border-[#DDE4EB] px-3 py-2 font-sans text-[12.5px] normal-case tracking-normal text-text-primary"
              />
            </label>
          </div>

          <div className="flex flex-col gap-1.5">
            <div className="font-sans text-[11px] font-medium uppercase tracking-wider text-text-muted">Nota / lampiran ekspedisi (wajib sebelum diajukan)</div>
            {(inv?.notaCount ?? 0) > 0 && (
              <div className="flex items-center gap-2 font-sans text-[11.5px] text-[#31414F]">
                <span>{inv?.notaCount} file sudah diunggah.</span>
                <button onClick={() => void viewEkspedisiInvoiceFiles(group.key, "NOTA")} className="font-semibold text-action-primary underline">
                  Lihat / Download
                </button>
                <span className="text-text-muted">Memilih file baru di bawah akan mengganti semuanya.</span>
              </div>
            )}
            <MultiFileInput files={files} onChange={setFiles} readFile={readFile} accept="application/pdf,image/jpeg,image/png" />
          </div>

          {error && <div className="rounded-md border border-[#F1C9C9] bg-danger-bg px-3 py-2 font-sans text-[11.5px] font-medium text-danger-fg">{error}</div>}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-[#E4E9EE] px-6 py-3.5">
          <button onClick={onClose} disabled={busy} className="rounded-md border border-[#CBD5DF] bg-white px-4 py-2 font-sans text-xs font-semibold text-[#31414F] hover:bg-[#F7F9FB] disabled:opacity-50">
            Batal
          </button>
          <button onClick={() => void run(false)} disabled={busy} className="rounded-md border border-action-primary bg-white px-4 py-2 font-sans text-xs font-semibold text-action-primary disabled:opacity-50">
            {busy ? "Menyimpan…" : "Simpan"}
          </button>
          <button
            onClick={() => void run(true)}
            disabled={busy || !hasNota}
            title={!hasNota ? "Upload nota ekspedisi dulu" : undefined}
            className="rounded-md bg-action-primary px-4 py-2 font-sans text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            Simpan &amp; Ajukan ke Finance
          </button>
        </div>
      </div>
    </div>
  );
}

/** Panel "Invoice Ekspedisi" di Paying Voucher (Invoice), Procurement. Satu baris per resi yang sudah terkirim: Procurement mencocokkan nota ekspedisi dengan
 *  lampiran vendor, menyesuaikan no resi dan biaya aktual, lalu mengajukannya ke Finance. Biaya tervalidasi dipakai sebagai ongkir HPP resi itu (derive.ts). */
export function EkspedisiInvoicePanel() {
  const deliveryKolis = useMrpStore((s) => s.deliveryKolis);
  const ekspedisiRates = useMrpStore((s) => s.ekspedisiRates);
  const submitEkspedisiInvoice = useMrpStore((s) => s.submitEkspedisiInvoice);
  const withdrawEkspedisiInvoice = useMrpStore((s) => s.withdrawEkspedisiInvoice);
  const groups = useMemo(() => ekspedisiResiGroups(deliveryKolis, ekspedisiRates), [deliveryKolis, ekspedisiRates]);
  const [editKey, setEditKey] = useState<string | null>(null);
  const editing = editKey ? groups.find((g) => g.key === editKey) : undefined;

  const toProcess = groups.filter((g) => !g.invoice || g.invoice.status === "DRAFT").length;

  async function submit(g: EkspedisiResiGroup) {
    const ok = await confirmDialog({
      title: "Ajukan ke Finance?",
      message: `Invoice ekspedisi resi ${g.invoice?.noResi ?? g.noResi} sebesar ${formatRupiah(g.invoice?.biaya ?? 0)} akan diajukan ke Finance untuk dibayar.`,
      confirmLabel: "Ajukan",
    });
    if (!ok) return;
    try {
      await submitEkspedisiInvoice(g.key);
    } catch {
      // pesan gagal sudah ditampilkan store
    }
  }

  async function withdraw(g: EkspedisiResiGroup) {
    const ok = await confirmDialog({
      title: "Tarik kembali dari Finance?",
      message: `Invoice ekspedisi resi ${g.invoice?.noResi ?? g.noResi} kembali ke status tervalidasi supaya bisa diperbaiki, lalu diajukan lagi.`,
      confirmLabel: "Tarik kembali",
    });
    if (!ok) return;
    try {
      await withdrawEkspedisiInvoice(g.key);
    } catch {
      // pesan gagal sudah ditampilkan store
    }
  }

  const columns: ColumnDef<EkspedisiResiGroup>[] = [
    { key: "sysadmin", label: "Aksi Sysadmin", default: true, sysadmin: true, render: (g) => <SysadminActionsBar compact actions={ekspedisiInvoiceCorrections(g.key, g.invoice)} /> },
    { key: "mrp", label: "No MRP", default: true, render: (g) => <span className="font-mono">{g.mrpId}</span> },
    { key: "vendor", label: "Vendor", default: true, render: (g) => vendorName(g.vendorProduksi) },
    { key: "ekspedisi", label: "Ekspedisi", default: true, render: (g) => g.ekspedisi },
    // Daftar nomor koli disembunyikan secara default (owner 2026-11-05): nomornya terlihat saat baris dibuka (klik nomor untuk melihat isinya), atau tampilkan lewat menu Kolom.
    { key: "koli", label: "No Koli", default: false, render: (g) => <span className="font-mono text-[11px]">{g.noKolis.join(", ")}</span> },
    { key: "jumlahKoli", label: "Jumlah Koli", default: true, align: "right", render: (g) => <span className="font-mono font-semibold">{g.koliIds.length}</span> },
    { key: "tgl", label: "Tgl Kirim", default: true, render: (g) => formatDate(g.tanggalKirim) },
    { key: "berat", label: "Berat Resi", default: true, align: "right", render: (g) => <span className="font-mono">{kg(g.beratResi)}</span> },
    {
      key: "estimasi",
      label: "Estimasi Master",
      default: true,
      align: "right",
      render: (g) => <span className="font-mono">{g.estimasiMaster > 0 ? formatRupiah(g.estimasiMaster) : "—"}</span>,
    },
    {
      key: "biaya",
      label: "Biaya Aktual",
      default: true,
      align: "right",
      render: (g) => {
        if (!g.invoice) return <span className="text-text-muted">—</span>;
        const d = diffText(g.invoice.biaya, g.estimasiMaster);
        return (
          <>
            <div className="font-mono font-semibold">{formatRupiah(g.invoice.biaya)}</div>
            {d && <div className={"font-mono text-[10px] " + d.tone}>{d.text}</div>}
          </>
        );
      },
    },
    {
      key: "lampiranVendor",
      label: "Lampiran Vendor",
      default: true,
      render: (g) =>
        g.hasVendorPhoto ? (
          <span onClick={(e) => e.stopPropagation()}>
            <button onClick={() => viewEkspedisiPhoto(g.firstKoliId)} className="font-sans text-[11px] font-semibold text-action-primary underline">
              Lihat
            </button>
          </span>
        ) : (
          <span className="text-text-muted">—</span>
        ),
    },
    {
      key: "nota",
      label: "Nota Ekspedisi",
      default: true,
      render: (g) =>
        (g.invoice?.notaCount ?? 0) > 0 ? (
          <span onClick={(e) => e.stopPropagation()}>
            <button onClick={() => void viewEkspedisiInvoiceFiles(g.key, "NOTA")} className="font-sans text-[11px] font-semibold text-action-primary underline">
              Lihat ({g.invoice?.notaCount})
            </button>
          </span>
        ) : (
          <span className="text-text-muted">—</span>
        ),
    },
    { key: "status", label: "Status", default: true, render: (g) => <StatusPill tone={ekspedisiInvoiceBadge(g.invoice?.status).tone}>{ekspedisiInvoiceBadge(g.invoice?.status).label}</StatusPill> },
    {
      key: "aksi",
      label: "Aksi",
      default: true,
      render: (g) => {
        const s = g.invoice?.status;
        return (
          <span onClick={(e) => e.stopPropagation()} className="flex items-center gap-2">
            {s !== "SUBMITTED" && s !== "PAID" && (
              <button onClick={() => setEditKey(g.key)} className="font-sans text-[11px] font-semibold text-action-primary underline">
                {s ? "Ubah" : "Validasi"}
              </button>
            )}
            {s === "DRAFT" && (
              <button
                onClick={() => void submit(g)}
                disabled={(g.invoice?.notaCount ?? 0) === 0}
                title={(g.invoice?.notaCount ?? 0) === 0 ? "Upload nota ekspedisi dulu (lewat Ubah)" : undefined}
                className="rounded bg-action-primary px-2 py-0.5 font-sans text-[10.5px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                Ajukan
              </button>
            )}
            {s === "SUBMITTED" && (
              <button onClick={() => void withdraw(g)} className="font-sans text-[11px] font-semibold text-warning-fg underline">
                Tarik kembali
              </button>
            )}
            {s === "PAID" && <span className="font-sans text-[10.5px] text-text-muted">Lunas {formatDate(g.invoice?.paidAt)}</span>}
          </span>
        );
      },
    },
  ];

  return (
    <>
      {toProcess > 0 && (
        <div className="rounded-lg border border-[#F0DFC2] bg-warning-bg px-5 py-[10px] font-sans text-xs font-medium text-warning-fg">
          {toProcess} resi belum divalidasi atau belum diajukan ke Finance. Selama belum divalidasi, ongkir HPP resi memakai tarif per kg Master Data Ekspedisi.
        </div>
      )}
      <DataTable
        title="Invoice ekspedisi per resi"
        columns={columns}
        rows={groups}
        keyOf={(g) => g.key}
        search={{ placeholder: "Cari no resi, no koli, no MRP, vendor…", getText: (g) => [g.noResi, g.invoice?.noResi, g.invoice?.noNota, g.noKolis.join(" "), g.mrpId, vendorName(g.vendorProduksi), g.ekspedisi].filter(Boolean).join(" ") }}
        filterDefs={[
          { label: "No MRP", options: Array.from(new Set(groups.map((g) => g.mrpId))).sort().reverse(), test: (g, v) => g.mrpId === v },
          { label: "Vendor", options: Array.from(new Set(groups.map((g) => vendorName(g.vendorProduksi)))).sort(), test: (g, v) => vendorName(g.vendorProduksi) === v },
          { label: "Ekspedisi", options: Array.from(new Set(groups.map((g) => g.ekspedisi))).sort(), test: (g, v) => g.ekspedisi === v },
          // No resi yang tampil di tabel (sudah termasuk penyesuaian Procurement). Satu nomor resi bisa dipakai beberapa pengiriman, jadi satu pilihan bisa memunculkan beberapa baris.
          { label: "No Resi", options: Array.from(new Set(groups.map((g) => g.invoice?.noResi ?? g.noResi).filter(Boolean))).sort((a, b) => a.localeCompare(b, "id-ID", { numeric: true })), test: (g, v) => (g.invoice?.noResi ?? g.noResi) === v },
          { label: "Status", options: ["BELUM DIVALIDASI", "TERVALIDASI", "DIAJUKAN KE FINANCE", "LUNAS"], test: (g, v) => ekspedisiInvoiceBadge(g.invoice?.status).label === v },
        ]}
        firstColumnLabel="No Resi"
        firstColumnRender={(g) => (
          <span className="flex flex-col">
            <span className="font-mono font-medium">{g.invoice?.noResi ?? g.noResi}</span>
            {g.invoice?.noResiAsli && <span className="font-sans text-[10px] text-warning-fg">diubah dari {g.invoice.noResiAsli}</span>}
          </span>
        )}
        renderExpanded={(g) => <ResiKoliDetail kolis={g.kolis} />}
        emptyText="Belum ada resi yang dikirim vendor."
      />
      {editing && <EkspedisiInvoiceModal group={editing} onClose={() => setEditKey(null)} />}
    </>
  );
}
