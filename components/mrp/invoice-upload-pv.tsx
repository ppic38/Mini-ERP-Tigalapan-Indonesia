"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { aliasesToSave, autoMap, buildPvDraft, evaluateMapping, findDuplicateInvoices, poColorsFromPo, tujuanMatchesVendor, type AliasMap, type GroupMapping, aliasKey } from "@/lib/invoice-import/mapping";
import { lineOk, parseMoney, parseWeight, round2 } from "@/lib/invoice-import/parser-knitto";
import { pdfToText, terminateOcr } from "@/lib/invoice-import/pdf-text";
import type { AppliedImport, InvoiceAdapter, ParsedInvoice } from "@/lib/invoice-import/types";
import { listSupplierColorAliasesAction } from "@/lib/mrp/supplierColorAliasActions";
import { formatRupiah } from "@/lib/mrp/derive";
import type { AddBuyItem, ColorEntry, Lengan, MaterialPO, RawMaterialInvoice } from "@/lib/mrp/types";

export type UploadApplyPayload = {
  colorEntries: ColorEntry[];
  addBuys: AddBuyItem[];
  diskon: number;
  noInvoiceVendor: string;
  kodeTransaksi: string;
  file: File;
  info: AppliedImport;
};

const fmt = (n: number) => (Number.isFinite(n) ? Math.round(n * 100) / 100 : n).toLocaleString("id-ID");

/** Chip hijau (cocok) / merah (perlu dicek) -- sama gaya dengan chip validasi di converter referensi. */
function Chip({ ok, children, detail }: { ok: boolean; children: React.ReactNode; detail?: string }) {
  return (
    <span className={"inline-flex flex-wrap items-center gap-1 rounded-md border px-2 py-[3px] font-sans text-[11px] " + (ok ? "border-[#BFE3CF] bg-success-bg text-success-fg" : "border-[#F0C4C4] bg-danger-bg text-danger-fg")}>
      <span className="font-semibold">{ok ? "✓" : "⚠"}</span>
      <span className="font-medium">{children}</span>
      {detail ? <span className="font-mono text-[10px] opacity-80">{detail}</span> : null}
    </span>
  );
}

function statusLabel(m: GroupMapping): string {
  if (m.alloc.length === 0) return "Belum dipetakan";
  if (!m.confirmed) return m.how === "fuzzy" ? "Saran — cek" : m.how === "variant" ? "Varian — cek" : "Perlu konfirmasi";
  if (m.how === "alias") return "Tersimpan";
  if (m.how === "exact") return "Cocok persis";
  return "Dikonfirmasi";
}

/**
 * "Upload invoice supplier" di Paying Voucher: baca PDF invoice (OCR/teks), petakan warna invoice ke
 * warna MRP/PO, rekonsiliasi per warna, lalu ISI form Paying Voucher otomatis. Tidak menyimpan apa
 * pun ke server -- hasilnya diterapkan ke form wizard yang tetap bisa diedit & baru tersimpan lewat
 * "Ajukan (Paying Voucher)" seperti biasa.
 */
export function InvoiceUploadPanel({
  po,
  adapter,
  existingInvoices,
  vendor,
  hasExistingEntries,
  onApply,
}: {
  po: MaterialPO;
  adapter: InvoiceAdapter;
  existingInvoices: RawMaterialInvoice[];
  vendor: { key: string; name: string };
  hasExistingEntries: boolean;
  onApply: (payload: UploadApplyPayload) => void;
}) {
  const poColors = useMemo(() => poColorsFromPo(po), [po]);
  const [phase, setPhase] = useState<"idle" | "busy" | "review">("idle");
  const [status, setStatus] = useState<{ msg: string; frac: number | null }>({ msg: "", frac: null });
  const [error, setError] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [parsed, setParsed] = useState<ParsedInvoice | null>(null);
  const [mappings, setMappings] = useState<GroupMapping[]>([]);
  const [ackTujuan, setAckTujuan] = useState(false);
  const [ackDup, setAckDup] = useState(false);
  const [showUntouched, setShowUntouched] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [applying, setApplying] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const aliasPromise = useRef<Promise<AliasMap>>(Promise.resolve({}));
  const aliasesRef = useRef<AliasMap>({});
  // Browser menahan proses render/OCR kalau tab tidak terlihat -- beri tahu user supaya tidak mengira macet.
  const [tabHidden, setTabHidden] = useState(false);
  useEffect(() => {
    if (phase !== "busy") return;
    const sync = () => setTabHidden(document.visibilityState === "hidden");
    document.addEventListener("visibilitychange", sync);
    window.addEventListener("focus", sync);
    return () => {
      document.removeEventListener("visibilitychange", sync);
      window.removeEventListener("focus", sync);
    };
  }, [phase]);

  useEffect(() => {
    aliasPromise.current = listSupplierColorAliasesAction(po.supplier)
      .then((r) => {
        const map: AliasMap = {};
        if (r.ok) for (const a of r.data) map[aliasKey(a.invoiceWarna, a.benang)] = a.mrpWarna;
        aliasesRef.current = map;
        return map;
      })
      .catch(() => ({}) as AliasMap);
    return () => {
      void terminateOcr();
    };
  }, [po.supplier]);

  async function handleFile(f: File | null | undefined) {
    if (!f) return;
    if (!/\.pdf$/i.test(f.name) && f.type !== "application/pdf") {
      setError("File harus berformat PDF.");
      return;
    }
    setError("");
    setPhase("busy");
    setStatus({ msg: "Membuka PDF…", frac: 0.01 });
    try {
      const { text } = await pdfToText(f, (msg, frac) => setStatus({ msg, frac }));
      const inv = adapter.parse(text, f.name);
      const aliases = await aliasPromise.current;
      setFile(f);
      setParsed(inv);
      setMappings(autoMap(inv, poColors, aliases));
      setAckTujuan(false);
      setAckDup(false);
      setPhase("review");
    } catch (err) {
      console.error(err);
      setError("Gagal membaca PDF: " + (err instanceof Error ? err.message : String(err)));
      setPhase("idle");
    } finally {
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  function reset() {
    setPhase("idle");
    setParsed(null);
    setFile(null);
    setMappings([]);
    setError("");
  }

  // ---------- pemetaan ----------
  /** Rib yang belum dipilih manual selalu mengikuti warna roll yang sama (nama & benang sama). */
  function syncRibs(ms: GroupMapping[]): GroupMapping[] {
    return ms.map((m) => {
      if (m.kind !== "rib" || m.manualTarget) return m;
      const sib = ms.find((x) => x.kind === "roll" && x.invoiceWarna === m.invoiceWarna && x.benang === m.benang && x.alloc.length > 0);
      if (!sib) return m;
      return { ...m, alloc: [{ warna: sib.alloc[0].warna, qty: 0 }], how: sib.how, confirmed: sib.confirmed };
    });
  }
  function patchMapping(key: string, fn: (m: GroupMapping) => GroupMapping) {
    setMappings((prev) => syncRibs(prev.map((m) => (m.key === key ? fn(m) : m))));
  }
  function chooseTarget(m: GroupMapping, allocIndex: number, warna: string) {
    const cand = m.candidates.find((c) => c.warna === warna);
    patchMapping(m.key, (x) => {
      const alloc = x.alloc.length ? x.alloc.map((a, i) => (i === allocIndex ? { ...a, warna } : a)) : [{ warna, qty: x.kind === "roll" ? (parsed?.groups[x.groupIndex].lines.length ?? 0) : 0 }];
      return { ...x, alloc, how: cand ? cand.kind : "manual", confirmed: true, manualTarget: x.kind === "rib" ? true : x.manualTarget };
    });
  }
  function setQty(m: GroupMapping, allocIndex: number, qty: number) {
    patchMapping(m.key, (x) => ({ ...x, alloc: x.alloc.map((a, i) => (i === allocIndex ? { ...a, qty: Math.max(0, Math.floor(qty) || 0) } : a)), confirmed: true }));
  }
  function splitMore(m: GroupMapping) {
    const used = new Set(m.alloc.map((a) => a.warna));
    const free = poColors.filter((p) => !used.has(p.warna) && p.remaining > 0);
    const next = free.find((p) => m.candidates.some((c) => c.warna === p.warna)) ?? free[0];
    if (!next) return;
    patchMapping(m.key, (x) => {
      const first = x.alloc[0] ?? { warna: next.warna, qty: 0 };
      const take = first.qty > 1 ? 1 : 0;
      return { ...x, alloc: [{ ...first, qty: first.qty - take }, ...x.alloc.slice(1), { warna: next.warna, qty: take }], how: "manual", confirmed: false };
    });
  }
  function removeAlloc(m: GroupMapping, allocIndex: number) {
    patchMapping(m.key, (x) => {
      if (x.alloc.length <= 1) return x;
      const removed = x.alloc[allocIndex];
      const rest = x.alloc.filter((_, i) => i !== allocIndex);
      rest[0] = { ...rest[0], qty: rest[0].qty + removed.qty };
      return { ...x, alloc: rest, confirmed: false };
    });
  }
  function confirmMapping(m: GroupMapping) {
    patchMapping(m.key, (x) => ({ ...x, confirmed: true }));
  }

  // ---------- edit hasil baca ----------
  function editParsed(fn: (draft: ParsedInvoice) => void, structural = false) {
    if (!parsed) return;
    const next: ParsedInvoice = { ...parsed, groups: parsed.groups.map((g) => ({ ...g, lines: g.lines.map((l) => ({ ...l })) })), totals: { ...parsed.totals } };
    fn(next);
    setParsed(next);
    if (structural) {
      // Jumlah baris berubah: pemetaan blok yang jumlah rollnya tidak lagi cocok dikembalikan ke usulan awal.
      const fresh = autoMap(next, poColors, aliasesRef.current);
      setMappings((pm) =>
        syncRibs(
          fresh.map((f) => {
            const old = pm.find((p) => p.key === f.key);
            const n = next.groups[f.groupIndex].lines.length;
            return old && (old.kind === "rib" || old.alloc.reduce((a, x) => a + x.qty, 0) === n) ? old : f;
          })
        )
      );
    }
  }

  // ---------- evaluasi ----------
  const evalResult = useMemo(() => (parsed ? evaluateMapping(parsed, mappings, poColors) : null), [parsed, mappings, poColors]);
  const checks = useMemo(() => (parsed ? adapter.validate(parsed) : []), [parsed, adapter]);
  const tujuanState: "none" | "ok" | "mismatch" = !parsed?.tujuan ? "none" : tujuanMatchesVendor(parsed.tujuan, vendor) ? "ok" : "mismatch";
  const duplicates = useMemo(
    () => (parsed ? findDuplicateInvoices(parsed.noPenjualan, po.supplier, existingInvoices.map((i) => ({ id: i.id, poId: i.poId, supplier: i.supplier, noInvoiceVendor: i.noInvoiceVendor }))) : []),
    [parsed, po.supplier, existingInvoices]
  );
  const blockingChecks = checks.filter((c) => c.blocking && !c.ok);
  const canApply = !!parsed && !!evalResult?.ok && blockingChecks.length === 0 && (tujuanState !== "mismatch" || ackTujuan) && (duplicates.length === 0 || ackDup) && !applying;

  async function handleApply() {
    if (!parsed || !file || !evalResult) return;
    const draft = buildPvDraft(parsed, mappings, po);
    if (draft.leftoverRolls > 0) {
      setError(`${draft.leftoverRolls} roll tidak punya tempat di PO (sisa per lengan tidak cukup) — periksa pemetaan.`);
      return;
    }
    setApplying(true);
    const rollKg = round2(draft.colorEntries.reduce((a, c) => a + c.rolls.reduce((s, w) => s + w, 0), 0));
    const info: AppliedImport = {
      adapterLabel: adapter.label,
      fileName: file.name,
      noInvoice: parsed.noPenjualan,
      totalBayar: parsed.totals.totalBayar,
      subtotal: parsed.totals.subtotal,
      diskon: draft.diskon,
      rollCount: evalResult.invoiceRolls,
      rollKg,
      ribKg: evalResult.invoiceRibKg,
      aliases: aliasesToSave(mappings),
    };
    onApply({
      colorEntries: draft.colorEntries.map((c) => ({ warna: c.warna, lengan: c.lengan as Lengan, hargaPerRoll: c.hargaPerRoll, rolls: c.rolls })),
      addBuys: draft.addBuys.map((a) => ({ id: a.id, item: a.item, warna: a.warna, beratKg: a.beratKg, hargaPerKg: a.hargaPerKg, totalHarga: a.totalHarga, remark: a.remark })),
      diskon: draft.diskon,
      noInvoiceVendor: parsed.noPenjualan,
      kodeTransaksi: /^\d{4}$/.test(parsed.kodeTransfer) ? parsed.kodeTransfer : "",
      file,
      info,
    });
    setApplying(false);
  }

  // ---------- render ----------
  if (phase !== "review" || !parsed || !evalResult) {
    return (
      <div className="mt-3">
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            if (phase !== "busy") void handleFile(e.dataTransfer.files?.[0]);
          }}
          onClick={() => phase !== "busy" && fileInput.current?.click()}
          className={
            "cursor-pointer rounded-md border-2 border-dashed px-5 py-8 text-center font-sans transition-colors " +
            (dragOver ? "border-accent-blue bg-info-bg" : "border-[#CFE0EF] bg-white hover:bg-info-bg/50") +
            (phase === "busy" ? " cursor-wait" : "")
          }
        >
          <input ref={fileInput} type="file" accept="application/pdf" className="hidden" onChange={(e) => void handleFile(e.target.files?.[0])} />
          {phase === "busy" ? (
            <>
              <div className="text-xs font-semibold text-info-fg">{status.msg}</div>
              {status.frac != null && (
                <div className="mx-auto mt-2 h-1.5 w-64 overflow-hidden rounded-full bg-[#DCE6F0]">
                  <div className="h-full bg-accent-blue transition-all" style={{ width: Math.round(status.frac * 100) + "%" }} />
                </div>
              )}
              <div className={"mt-2 text-[11px] " + (tabHidden ? "font-semibold text-danger-fg" : "text-text-muted")}>
                {tabHidden ? "Tab ini sedang tidak terlihat — browser menahan prosesnya. Kembali ke tab ini supaya pembacaan lanjut." : "Biarkan tab ini tetap terbuka di depan sampai selesai (±15–20 detik untuk invoice berupa gambar)."}
              </div>
            </>
          ) : (
            <>
              <div className="text-[13px] font-semibold text-text-primary">Tarik &amp; lepas PDF invoice {adapter.label} di sini, atau klik untuk memilih file</div>
              <div className="mt-1.5 text-[11.5px] text-text-muted">
                Nama file: <span className="font-mono">NOPENJUALAN.TUJUAN.KODETRANSFER.pdf</span> — mis. <span className="font-mono">OH300726111.YOGI01.1234.pdf</span>
              </div>
              <div className="mt-1 text-[11px] text-text-muted">PDF dibaca langsung di browser Anda (tidak dikirim ke server). Hasil bisa dicek &amp; diedit sebelum dipakai.</div>
            </>
          )}
        </div>
        {error && <div className="mt-2 font-sans text-[11.5px] font-medium text-danger-fg">{error}</div>}
      </div>
    );
  }

  const optionLabel = (p: (typeof poColors)[number]) => `${p.warna} — sisa ${p.remaining}/${p.total}`;
  const touched = evalResult.recon.filter((r) => r.thisInvoice > 0);
  const untouched = evalResult.recon.filter((r) => r.thisInvoice === 0 && r.total - r.before > 0);
  const untouchedRolls = untouched.reduce((a, r) => a + (r.total - r.before), 0);
  const unconfirmed = mappings.filter((m) => !m.confirmed && m.alloc.length > 0).length;
  const unmapped = mappings.filter((m) => m.alloc.length === 0).length;
  const mappedGroups = mappings.filter((m) => m.alloc.length > 0 && m.confirmed).length;

  return (
    <div className="mt-3 space-y-3">
      {/* Ringkasan + cek silang invoice */}
      <div className="rounded-md border border-[#CFE0EF] bg-white p-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <div className="font-sans text-xs font-semibold text-text-primary">
            {file?.name} <span className="font-normal text-text-muted">· {adapter.label}</span>
          </div>
          <div className="font-mono text-[11px] text-text-muted">
            No Penjualan <b className="text-text-primary">{parsed.noPenjualan || "—"}</b>
          </div>
          {parsed.tanggal && (
            <div className="font-mono text-[11px] text-text-muted">
              Tanggal {String(parsed.tanggal.d).padStart(2, "0")}-{String(parsed.tanggal.m).padStart(2, "0")}-{parsed.tanggal.y}
            </div>
          )}
          <button onClick={reset} className="ml-auto font-sans text-[11px] font-semibold text-action-primary underline">
            Ganti file
          </button>
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {checks.map((c, i) => (
            <Chip key={c.id + i} ok={c.ok} detail={c.detail}>
              {c.label}
            </Chip>
          ))}
          <Chip ok={mappedGroups === mappings.length && mappings.length > 0} detail={`${mappedGroups}/${mappings.length} blok`}>
            Warna terpetakan &amp; terkonfirmasi
          </Chip>
          <Chip ok={evalResult.allocatedRolls === evalResult.invoiceRolls} detail={`${evalResult.allocatedRolls}/${evalResult.invoiceRolls} roll`}>
            Roll invoice teralokasi
          </Chip>
          <Chip ok={evalResult.totalDiff === 0} detail={Number.isFinite(evalResult.totalDiff) ? `${formatRupiah(evalResult.pvTotal)} vs ${formatRupiah(evalResult.invoiceTotalBayar)}` : "Total Bayar tidak terbaca"}>
            Total PV = Total Bayar invoice
          </Chip>
          {tujuanState === "ok" && <Chip ok detail={`${parsed.tujuan} = ${vendor.name}`}>Tujuan nama file sesuai vendor PO</Chip>}
          {tujuanState === "none" && (
            <span className="rounded-md border border-[#E4E8EE] bg-[#F7F9FB] px-2 py-[3px] font-sans text-[11px] text-text-muted">Nama file tanpa tujuan — mengikuti vendor PO ({vendor.name})</span>
          )}
          {tujuanState === "mismatch" && (
            <Chip ok={ackTujuan} detail={`${parsed.tujuan} ≠ ${vendor.name}`}>
              Tujuan nama file BEDA dengan vendor PO ini
            </Chip>
          )}
          {duplicates.length > 0 && (
            <Chip ok={ackDup} detail={duplicates.map((d) => d.id).join(", ")}>
              No invoice ini sudah pernah dibuat PV-nya
            </Chip>
          )}
        </div>
        {tujuanState === "mismatch" && (
          <label className="mt-2 flex items-center gap-2 font-sans text-[11.5px] text-danger-fg">
            <input type="checkbox" checked={ackTujuan} onChange={(e) => setAckTujuan(e.target.checked)} />
            Invoice ini memang untuk {vendor.name} (nama file salah ketik) — lanjutkan.
          </label>
        )}
        {duplicates.length > 0 && (
          <label className="mt-2 flex items-center gap-2 font-sans text-[11.5px] text-danger-fg">
            <input type="checkbox" checked={ackDup} onChange={(e) => setAckDup(e.target.checked)} />
            Saya sudah cek — ini BUKAN invoice yang sama dengan {duplicates.map((d) => d.id).join(", ")} (mis. invoice bertahap).
          </label>
        )}
      </div>

      {/* Pemetaan warna */}
      <div className="overflow-hidden rounded-md border border-[#CFE0EF] bg-white">
        <div className="flex items-center gap-2 border-b-2 border-accent-blue bg-info-bg px-3 py-1.5 font-sans text-[10px] font-medium uppercase tracking-wider text-info-fg">
          <span>Pemetaan warna invoice → warna MRP</span>
          <span className="ml-auto normal-case tracking-normal text-[11px] font-normal">
            {unmapped > 0 ? `${unmapped} belum dipetakan · ` : ""}
            {unconfirmed > 0 ? `${unconfirmed} perlu konfirmasi` : "semua terkonfirmasi"}
          </span>
        </div>
        {mappings.map((m) => {
          const g = parsed.groups[m.groupIndex];
          const kg = round2(g.lines.reduce((a, l) => a + l.w, 0));
          const prices = Array.from(new Set(g.lines.map((l) => l.price)));
          const sum = m.alloc.reduce((a, x) => a + x.qty, 0);
          const optionsSorted = [...poColors].sort((a, b) => {
            const ca = m.candidates.findIndex((c) => c.warna === a.warna);
            const cb = m.candidates.findIndex((c) => c.warna === b.warna);
            if (ca >= 0 || cb >= 0) return (ca < 0 ? 999 : ca) - (cb < 0 ? 999 : cb);
            return a.warna.localeCompare(b.warna, "id-ID");
          });
          const statusTone = m.alloc.length === 0 ? "bg-danger-bg text-danger-fg" : m.confirmed ? "bg-success-bg text-success-fg" : "bg-warning-bg text-warning-fg";
          return (
            <div key={m.key} className="grid grid-cols-[1.3fr_2fr_auto] items-start gap-3 border-t border-[#F1F4F7] px-3 py-2 font-sans text-xs text-[#31414F]">
              <div>
                <span className={"mr-1.5 rounded px-1.5 py-[1px] font-mono text-[9.5px] font-semibold " + (m.kind === "rib" ? "bg-warning-bg text-warning-fg" : "bg-info-bg text-info-fg")}>{m.kind === "rib" ? "RIB" : "ROLL"}</span>
                <span className="font-semibold text-text-primary">{m.invoiceWarna}</span> <span className="text-text-muted">{m.benang}</span>
                <div className="mt-0.5 font-mono text-[10.5px] text-text-muted">
                  {g.lines.length} {m.kind === "rib" ? "baris" : "roll"} · {fmt(kg)} kg · {prices.length === 1 ? `@ ${formatRupiah(prices[0])}/kg` : "harga berbeda!"}
                </div>
              </div>
              <div className="space-y-1">
                {(m.alloc.length ? m.alloc : [{ warna: "", qty: 0 }]).map((a, ai) => (
                  <div key={ai} className="flex items-center gap-1.5">
                    <select value={a.warna} onChange={(e) => chooseTarget(m, ai, e.target.value)} className="input min-w-0 flex-1 !py-1 text-[11.5px]">
                      {!a.warna && <option value="">— pilih warna di PO ini —</option>}
                      {optionsSorted.map((p) => (
                        <option key={p.warna} value={p.warna}>
                          {m.candidates.some((c) => c.warna === p.warna) ? "★ " : ""}
                          {optionLabel(p)}
                        </option>
                      ))}
                    </select>
                    {m.kind === "roll" && m.alloc.length > 1 && (
                      <>
                        <input value={a.qty} onChange={(e) => setQty(m, ai, Number(e.target.value.replace(/\D/g, "")))} className="input w-14 !py-1 text-center font-mono text-[11.5px]" inputMode="numeric" aria-label="Jumlah roll" />
                        <span className="text-[10.5px] text-text-muted">roll</span>
                        <button onClick={() => removeAlloc(m, ai)} className="px-1 text-[13px] font-semibold text-danger-fg" title="Hapus pembagian ini">
                          ×
                        </button>
                      </>
                    )}
                  </div>
                ))}
                {m.kind === "roll" && (
                  <div className="flex items-center gap-3 text-[10.5px]">
                    {m.alloc.length > 1 && (
                      <span className={sum === g.lines.length ? "text-success-fg" : "font-semibold text-danger-fg"}>
                        Teralokasi {sum}/{g.lines.length} roll
                      </span>
                    )}
                    <button onClick={() => splitMore(m)} className="font-semibold text-accent-blue underline">
                      + Pecah ke warna lain
                    </button>
                  </div>
                )}
              </div>
              <div className="flex flex-col items-end gap-1">
                <span className={"rounded-full px-2 py-0.5 font-mono text-[9.5px] font-semibold " + statusTone}>{statusLabel(m)}</span>
                {m.alloc.length > 0 && !m.confirmed && (
                  <Button onClick={() => confirmMapping(m)} variant="primary" size="xs">
                    Konfirmasi
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Rekonsiliasi per warna PO */}
      <div className="overflow-hidden rounded-md border border-[#CFE0EF] bg-white">
        <div className="border-b-2 border-accent-blue bg-info-bg px-3 py-1.5 font-sans text-[10px] font-medium uppercase tracking-wider text-info-fg">Rekonsiliasi terhadap PO ini (per warna MRP)</div>
        <div className="grid grid-cols-[2fr_repeat(4,0.8fr)_1fr] gap-2 border-b border-[#F1F4F7] bg-[#F7F9FB] px-3 py-1.5 font-sans text-[10px] font-medium uppercase tracking-wider text-text-muted">
          <span>Warna MRP</span>
          <span className="text-right">Total PO</span>
          <span className="text-right">Sudah PV</span>
          <span className="text-right">Invoice ini</span>
          <span className="text-right">Sisa</span>
          <span className="text-right">Status</span>
        </div>
        {touched.map((r) => (
          <div key={r.warna} className={"grid grid-cols-[2fr_repeat(4,0.8fr)_1fr] items-center gap-2 border-t border-[#F1F4F7] px-3 py-1.5 font-sans text-xs " + (r.over ? "bg-danger-bg/50" : "")}>
            <span className="font-medium text-text-primary">{r.warna}</span>
            <span className="text-right font-mono">{r.total}</span>
            <span className="text-right font-mono text-text-muted">{r.before}</span>
            <span className="text-right font-mono font-semibold">{r.thisInvoice}</span>
            <span className="text-right font-mono">{r.after}</span>
            <span className={"text-right text-[11px] font-semibold " + (r.over ? "text-danger-fg" : r.after === 0 ? "text-success-fg" : "text-warning-fg")}>{r.over ? `Lebih ${-r.after}` : r.after === 0 ? "Lunas tagih" : "Bertahap"}</span>
          </div>
        ))}
        <div className="grid grid-cols-[2fr_repeat(4,0.8fr)_1fr] items-center gap-2 border-t-2 border-accent-blue bg-info-bg px-3 py-1.5 font-sans text-xs font-semibold text-info-fg">
          <span>Total</span>
          <span className="text-right font-mono">{evalResult.recon.reduce((a, r) => a + r.total, 0)}</span>
          <span className="text-right font-mono">{evalResult.recon.reduce((a, r) => a + r.before, 0)}</span>
          <span className="text-right font-mono">{evalResult.recon.reduce((a, r) => a + r.thisInvoice, 0)}</span>
          <span className="text-right font-mono">{evalResult.recon.reduce((a, r) => a + r.after, 0)}</span>
          <span />
        </div>
        {untouched.length > 0 && (
          <div className="border-t border-[#F1F4F7] bg-warning-bg/40 px-3 py-2 font-sans text-[11.5px] text-warning-fg">
            <button onClick={() => setShowUntouched((v) => !v)} className="font-semibold underline">
              {showUntouched ? "Sembunyikan" : "Lihat"} {untouched.length} warna ({untouchedRolls} roll) di PO ini yang BELUM ada di invoice ini
            </button>
            <span className="ml-1 text-text-muted">— tetap menunggu invoice berikutnya.</span>
            {showUntouched && (
              <div className="mt-1.5 grid grid-cols-2 gap-x-6 gap-y-0.5 md:grid-cols-3">
                {untouched.map((r) => (
                  <div key={r.warna} className="flex justify-between font-mono text-[11px] text-[#31414F]">
                    <span>{r.warna}</span>
                    <span>sisa {r.total - r.before}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Hasil baca yang bisa diedit */}
      <details open={blockingChecks.length > 0} className="rounded-md border border-[#CFE0EF] bg-white">
        <summary className="cursor-pointer px-3 py-2 font-sans text-xs font-semibold text-info-fg">Hasil baca invoice (bisa diedit — merah = tidak cocok, kuning = dikoreksi otomatis)</summary>
        <div className="max-h-80 overflow-auto px-3 pb-3">
          <table className="w-full border-collapse font-sans text-xs">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wider text-text-muted">
                <th className="py-1">Warna / roll</th>
                <th className="py-1 text-right">Berat (kg)</th>
                <th className="py-1 text-right">Harga/kg</th>
                <th className="py-1 text-right">Jumlah</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {parsed.groups.map((g, gi) => (
                <GroupRows key={gi} g={g} gi={gi} editParsed={editParsed} />
              ))}
            </tbody>
          </table>
        </div>
      </details>

      {parsed.rawText && (
        <details className="rounded-md border border-[#E4E8EE] bg-white">
          <summary className="cursor-pointer px-3 py-2 font-sans text-[11px] text-text-muted">Teks mentah hasil baca (untuk pengecekan)</summary>
          <pre className="max-h-60 overflow-auto whitespace-pre-wrap px-3 pb-3 font-mono text-[10.5px] text-[#31414F]">{parsed.rawText}</pre>
        </details>
      )}

      {evalResult.issues.length > 0 && (
        <div className="rounded-md border border-[#F0C4C4] bg-danger-bg px-3 py-2">
          <div className="font-sans text-[11.5px] font-semibold text-danger-fg">Belum bisa dipakai — selesaikan dulu:</div>
          <ul className="mt-1 list-disc pl-5 font-sans text-[11.5px] text-danger-fg">
            {evalResult.issues.map((i, k) => (
              <li key={k}>
                <b>{i.where}:</b> {i.message}
              </li>
            ))}
            {blockingChecks.map((c, k) => (
              <li key={"c" + k}>
                <b>Pemeriksaan invoice:</b> {c.label}
                {c.detail ? ` (${c.detail})` : ""}
              </li>
            ))}
          </ul>
        </div>
      )}
      {error && <div className="font-sans text-[11.5px] font-medium text-danger-fg">{error}</div>}

      <div className="flex items-center gap-2">
        <button
          onClick={() => void handleApply()}
          disabled={!canApply}
          className="rounded-md bg-action-primary px-3.5 py-2 font-sans text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          Pakai data invoice ini → isi Paying Voucher
        </button>
        {hasExistingEntries && <span className="font-sans text-[11px] text-warning-fg">Isian PV yang sudah ada akan diganti.</span>}
      </div>
    </div>
  );
}

function GroupRows({ g, gi, editParsed }: { g: ParsedInvoice["groups"][number]; gi: number; editParsed: (fn: (d: ParsedInvoice) => void, structural?: boolean) => void }) {
  return (
    <>
      <tr>
        <td colSpan={5} className="pt-2">
          <span className={"mr-1.5 rounded px-1.5 py-[1px] font-mono text-[9.5px] font-semibold " + (g.kind === "rib" ? "bg-warning-bg text-warning-fg" : "bg-info-bg text-info-fg")}>{g.kind === "rib" ? "RIB" : "ROLL"}</span>
          <span className="font-semibold text-text-primary">
            {g.warna} {g.benang}
          </span>
          <button onClick={() => editParsed((d) => d.groups[gi].lines.push({ w: 0, price: g.lines[0]?.price ?? 0, amount: 0 }), true)} className="ml-3 text-[11px] font-semibold text-accent-blue underline">
            + baris
          </button>
        </td>
      </tr>
      {g.lines.map((l, li) => {
        const bad = !lineOk(l);
        return (
          <tr key={`${gi}-${li}-${l.w}-${l.price}-${l.amount}`} className={bad ? "bg-danger-bg/60" : l.fixed ? "bg-warning-bg/60" : ""}>
            <td className="py-0.5 pl-3 font-mono text-[10.5px] text-text-muted">{li + 1}</td>
            <td className="py-0.5 text-right">
              <input
                defaultValue={Number.isFinite(l.w) ? String(l.w).replace(".", ",") : ""}
                onBlur={(e) => {
                  const w = parseWeight(e.target.value);
                  editParsed((d) => {
                    const t = d.groups[gi].lines[li];
                    t.w = w;
                    t.amount = Math.round(w * t.price);
                    delete t.fixed;
                  });
                }}
                className="input w-24 !py-0.5 text-right font-mono text-[11.5px]"
                inputMode="decimal"
              />
            </td>
            <td className="py-0.5 text-right">
              <input
                defaultValue={Number.isFinite(l.price) ? String(l.price) : ""}
                onBlur={(e) => {
                  const p = parseMoney(e.target.value);
                  editParsed((d) => {
                    const t = d.groups[gi].lines[li];
                    t.price = p;
                    t.amount = Math.round(t.w * p);
                    delete t.fixed;
                  });
                }}
                className="input w-24 !py-0.5 text-right font-mono text-[11.5px]"
                inputMode="numeric"
              />
            </td>
            <td className="py-0.5 text-right">
              <input
                defaultValue={Number.isFinite(l.amount) ? String(l.amount) : ""}
                onBlur={(e) =>
                  editParsed((d) => {
                    const t = d.groups[gi].lines[li];
                    t.amount = parseMoney(e.target.value);
                    delete t.fixed;
                  })
                }
                className="input w-28 !py-0.5 text-right font-mono text-[11.5px]"
                inputMode="numeric"
              />
            </td>
            <td className="py-0.5 pl-2">
              <button onClick={() => editParsed((d) => d.groups[gi].lines.splice(li, 1), true)} className="px-1 text-[13px] font-semibold text-danger-fg" title="Hapus baris" aria-label="Hapus baris">
                ×
              </button>
            </td>
          </tr>
        );
      })}
    </>
  );
}
