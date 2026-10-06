"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { aliasesToSave, autoMap, buildPvDraft, evaluateMapping, findDuplicateInvoices, poColorsFromPo, type AliasMap, type GroupMapping, aliasKey } from "@/lib/invoice-import/mapping";
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
  hasExistingEntries,
  onApply,
}: {
  po: MaterialPO;
  adapter: InvoiceAdapter;
  existingInvoices: RawMaterialInvoice[];
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
  const [ackDup, setAckDup] = useState(false);
  const [showOk, setShowOk] = useState(false);
  const [editingKey, setEditingKey] = useState<string | null>(null);
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
  const duplicates = useMemo(
    () => (parsed ? findDuplicateInvoices(parsed.noPenjualan, po.supplier, existingInvoices.map((i) => ({ id: i.id, poId: i.poId, supplier: i.supplier, noInvoiceVendor: i.noInvoiceVendor }))) : []),
    [parsed, po.supplier, existingInvoices]
  );
  const blockingChecks = checks.filter((c) => c.blocking && !c.ok);
  const canApply = !!parsed && !!evalResult?.ok && blockingChecks.length === 0 && (duplicates.length === 0 || ackDup) && !applying;

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
                Nama file: <span className="font-mono">NOINVOICE.KODETRANSAKSI.pdf</span> — mis. <span className="font-mono">OH300726111.1234.pdf</span>
              </div>
              <div className="mt-1 text-[11px] text-text-muted">PDF dibaca langsung di browser Anda (tidak dikirim ke server). Hasil bisa dicek &amp; diedit sebelum dipakai.</div>
            </>
          )}
        </div>
        {error && <div className="mt-2 font-sans text-[11.5px] font-medium text-danger-fg">{error}</div>}
      </div>
    );
  }

  // ---------- tampilan review (minimalis: yang bermasalah di atas, yang beres diringkas) ----------
  const rows: { key: string; roll?: GroupMapping; rib?: GroupMapping }[] = [];
  const claimedRibs = new Set<string>();
  for (const m of mappings.filter((x) => x.kind === "roll")) {
    const rib = mappings.find((x) => x.kind === "rib" && !claimedRibs.has(x.key) && x.invoiceWarna === m.invoiceWarna && x.benang === m.benang);
    if (rib) claimedRibs.add(rib.key);
    rows.push({ key: m.key, roll: m, rib });
  }
  for (const m of mappings.filter((x) => x.kind === "rib" && !claimedRibs.has(x.key))) rows.push({ key: m.key, rib: m });

  const labelOf = (m: GroupMapping) => `${m.kind === "rib" ? "RIB " : ""}${m.invoiceWarna} ${m.benang}`;
  const rowIssues = (r: (typeof rows)[number]) => evalResult.issues.filter((i) => [r.roll, r.rib].some((m) => m && i.where === labelOf(m)) && !/saran|belum dipetakan/i.test(i.message));
  const rowNeedsAttention = (r: (typeof rows)[number]) => [r.roll, r.rib].some((m) => m && (m.alloc.length === 0 || !m.confirmed)) || rowIssues(r).length > 0;
  const attentionRows = rows.filter(rowNeedsAttention);
  const okRows = rows.filter((r) => !rowNeedsAttention(r));

  const totalPoRoll = evalResult.recon.reduce((a, r) => a + r.total, 0);
  const sisaRoll = evalResult.recon.reduce((a, r) => a + r.after, 0);
  const untouchedCount = evalResult.recon.filter((r) => r.thisInvoice === 0 && r.total - r.before > 0).length;
  const hasOver = evalResult.recon.some((r) => r.over);

  // Semua pemeriksaan dalam satu daftar; yang gagal ditampilkan di kotak "perlu diselesaikan", yang lulus diringkas.
  type CheckRow = { label: string; ok: boolean; detail: string };
  const allChecks: CheckRow[] = [
    ...checks.map((c) => ({ label: c.label, ok: c.ok, detail: c.detail })),
    { label: "Warna terpetakan & terkonfirmasi", ok: mappings.length > 0 && mappings.every((m) => m.alloc.length > 0 && m.confirmed), detail: `${mappings.filter((m) => m.alloc.length > 0 && m.confirmed).length}/${mappings.length} blok` },
    { label: "Roll invoice teralokasi ke PO", ok: evalResult.allocatedRolls === evalResult.invoiceRolls, detail: `${evalResult.allocatedRolls}/${evalResult.invoiceRolls} roll` },
    {
      label: "Total PV = Total Bayar invoice",
      ok: evalResult.totalDiff === 0,
      detail: Number.isFinite(evalResult.totalDiff) ? `${formatRupiah(evalResult.pvTotal)} vs ${formatRupiah(evalResult.invoiceTotalBayar)}` : "Total Bayar tidak terbaca",
    },
  ];
  const passed = allChecks.filter((c) => c.ok);

  const selectFor = (m: GroupMapping, ai: number, warna: string) => {
    const sorted = [...poColors].sort((a, b) => {
      const ca = m.candidates.findIndex((c) => c.warna === a.warna);
      const cb = m.candidates.findIndex((c) => c.warna === b.warna);
      if (ca >= 0 || cb >= 0) return (ca < 0 ? 999 : ca) - (cb < 0 ? 999 : cb);
      return a.warna.localeCompare(b.warna, "id-ID");
    });
    return (
      <select value={warna} onChange={(e) => chooseTarget(m, ai, e.target.value)} className="input min-w-0 flex-1 !py-1 text-[12px]">
        {!warna && <option value="">— pilih warna di PO —</option>}
        {sorted.map((p) => (
          <option key={p.warna} value={p.warna}>
            {m.candidates.some((c) => c.warna === p.warna) ? "★ " : ""}
            {p.warna} · sisa {p.remaining}
          </option>
        ))}
      </select>
    );
  };

  const renderRow = (r: (typeof rows)[number]) => {
    const main = r.roll ?? r.rib!;
    const g = parsed.groups[main.groupIndex];
    const kg = round2(g.lines.reduce((a, l) => a + l.w, 0));
    const prices = Array.from(new Set(g.lines.map((l) => l.price)));
    const ribG = r.roll && r.rib ? parsed.groups[r.rib.groupIndex] : null;
    const ribKg = ribG ? round2(ribG.lines.reduce((a, l) => a + l.w, 0)) : 0;
    const attention = rowNeedsAttention(r);
    const editing = editingKey === r.key || attention;
    const issues = rowIssues(r);
    const sum = main.alloc.reduce((a, x) => a + x.qty, 0);
    const targetText = main.alloc.map((a) => (main.kind === "roll" && main.alloc.length > 1 ? `${a.warna} (${a.qty})` : a.warna)).join(" + ");
    const unconfirmed = [r.roll, r.rib].some((m) => m && m.alloc.length > 0 && !m.confirmed);
    return (
      <div key={r.key} className={"px-4 py-2.5 " + (attention ? "bg-warning-bg/40" : "")}>
        <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)_200px] items-start gap-x-4">
          <div className="min-w-0">
            <div className="truncate font-sans text-[12.5px] font-semibold text-text-primary">
              {main.invoiceWarna} <span className="font-normal text-text-muted">{main.benang}</span>
              {main.kind === "rib" && <span className="ml-1.5 rounded bg-warning-bg px-1 py-[1px] font-mono text-[9px] font-semibold text-warning-fg">RIB</span>}
            </div>
            <div className="font-mono text-[10.5px] text-text-muted">
              {g.lines.length} {main.kind === "rib" ? "baris" : "roll"} · {fmt(kg)} kg{ribG ? ` · rib ${fmt(ribKg)} kg` : ""} · {prices.length === 1 ? `@${fmt(prices[0])}` : "harga berbeda!"}
            </div>
          </div>
          <div className="min-w-0 font-sans text-xs">
            {!editing ? (
              <span className="text-[#31414F]">
                <span className="text-text-muted">→</span> <b className="font-semibold">{targetText}</b>
              </span>
            ) : (
              <div className="space-y-1">
                {(main.alloc.length ? main.alloc : [{ warna: "", qty: 0 }]).map((a, ai) => (
                  <div key={ai} className="flex items-center gap-1.5">
                    {selectFor(main, ai, a.warna)}
                    {main.kind === "roll" && main.alloc.length > 1 && (
                      <>
                        <input value={a.qty} onChange={(e) => setQty(main, ai, Number(e.target.value.replace(/\D/g, "")))} className="input w-14 !py-1 text-center font-mono text-[12px]" inputMode="numeric" aria-label="Jumlah roll" />
                        <span className="text-[10.5px] text-text-muted">roll</span>
                        <button onClick={() => removeAlloc(main, ai)} className="px-1 text-[14px] leading-none text-danger-fg" title="Hapus pembagian ini">
                          ×
                        </button>
                      </>
                    )}
                  </div>
                ))}
                {r.roll && r.rib && (
                  <div className="flex items-center gap-1.5">
                    {selectFor(r.rib, 0, r.rib.alloc[0]?.warna ?? "")}
                    <span className="w-8 text-[10px] font-semibold text-warning-fg">rib</span>
                  </div>
                )}
                <div className="flex items-center gap-3 text-[10.5px]">
                  {main.kind === "roll" && main.alloc.length > 1 && <span className={sum === g.lines.length ? "text-success-fg" : "font-semibold text-danger-fg"}>{sum}/{g.lines.length} roll</span>}
                  {main.kind === "roll" && (
                    <button onClick={() => splitMore(main)} className="text-accent-blue hover:underline">
                      + pecah ke warna lain
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
          <div className="flex items-center justify-end gap-2 whitespace-nowrap">
            {unconfirmed ? (
              <>
                <span className="font-sans text-[11px] text-warning-fg">{main.how === "fuzzy" ? "mirip, cek" : main.how === "variant" ? "varian, cek" : "perlu konfirmasi"}</span>
                <Button onClick={() => [r.roll, r.rib].forEach((m) => m && !m.confirmed && m.alloc.length > 0 && confirmMapping(m))} variant="primary" size="xs">
                  Konfirmasi
                </Button>
              </>
            ) : main.alloc.length === 0 ? (
              <span className="font-sans text-[11px] font-medium text-danger-fg">belum dipetakan</span>
            ) : (
              <>
                <span className="font-sans text-[11px] text-success-fg">✓ {main.how === "alias" ? "tersimpan" : main.how === "exact" ? "persis" : "dikonfirmasi"}</span>
                <button onClick={() => setEditingKey(editingKey === r.key ? null : r.key)} className="font-sans text-[11px] text-text-muted hover:text-accent-blue hover:underline">
                  {editingKey === r.key ? "Tutup" : "Ubah"}
                </button>
              </>
            )}
          </div>
        </div>
        {issues.map((i, k) => (
          <div key={k} className="mt-1 font-sans text-[11px] text-danger-fg">
            {i.message}
          </div>
        ))}
      </div>
    );
  };

  const blockers: string[] = [
    ...evalResult.issues.filter((i) => !/saran|belum dipetakan/i.test(i.message) && i.where !== "Total").map((i) => `${i.where}: ${i.message}`),
    ...blockingChecks.map((c) => `${c.label}${c.detail ? ` (${c.detail})` : ""}`),
    ...(attentionRows.some((r) => [r.roll, r.rib].some((m) => m && (m.alloc.length === 0 || !m.confirmed))) ? [`${attentionRows.length} warna perlu dikonfirmasi / dipetakan di bawah`] : []),
    ...(Number.isFinite(evalResult.totalDiff) && evalResult.totalDiff !== 0 ? [`Total PV ${formatRupiah(evalResult.pvTotal)} berbeda dari Total Bayar invoice ${formatRupiah(evalResult.invoiceTotalBayar)}`] : []),
  ];
  const uniqueBlockers = Array.from(new Set(blockers));

  return (
    <div className="mt-3 space-y-3 font-sans">
      {/* Ringkasan */}
      <div className="rounded-lg border border-[#CFE0EF] bg-white">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-4 pt-3">
          <span className="text-[13px] font-semibold text-text-primary">{file?.name}</span>
          <span className="font-mono text-[11px] text-text-muted">
            {parsed.noPenjualan || "—"}
            {parsed.tanggal ? ` · ${String(parsed.tanggal.d).padStart(2, "0")}-${String(parsed.tanggal.m).padStart(2, "0")}-${parsed.tanggal.y}` : ""}
          </span>
          <button onClick={reset} className="ml-auto text-[11.5px] font-semibold text-action-primary hover:underline">
            Ganti file
          </button>
        </div>
        <div className="grid grid-cols-2 gap-px px-4 py-3 md:grid-cols-4">
          {[
            { k: "Roll", v: `${evalResult.allocatedRolls}/${evalResult.invoiceRolls}`, s: `${fmt(evalResult.invoiceRollKg)} kg` },
            { k: "Rib", v: `${fmt(evalResult.invoiceRibKg)} kg`, s: "" },
            { k: "Total Bayar invoice", v: formatRupiah(evalResult.invoiceTotalBayar), s: evalResult.totalDiff === 0 ? "= total PV ✓" : "≠ total PV" },
            { k: "Sisa PO setelah ini", v: `${sisaRoll} roll`, s: untouchedCount > 0 ? `${untouchedCount} warna menunggu invoice lain` : "lunas ditagih" },
          ].map((x) => (
            <div key={x.k} className="pr-3">
              <div className="text-[10px] font-medium uppercase tracking-wider text-text-muted">{x.k}</div>
              <div className="font-mono text-[14px] font-semibold text-text-primary">{x.v}</div>
              {x.s && <div className={"text-[10.5px] " + (x.s.includes("≠") ? "text-danger-fg" : "text-text-muted")}>{x.s}</div>}
            </div>
          ))}
        </div>

        {uniqueBlockers.length > 0 || duplicates.length > 0 ? (
          <div className="border-t border-[#F0C4C4] bg-danger-bg/60 px-4 py-2.5">
            <div className="text-[11.5px] font-semibold text-danger-fg">Perlu diselesaikan sebelum dipakai</div>
            <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[11.5px] text-danger-fg">
              {uniqueBlockers.map((b, k) => (
                <li key={k}>{b}</li>
              ))}
            </ul>
            {duplicates.length > 0 && (
              <label className="mt-2 flex items-start gap-2 text-[11.5px] text-danger-fg">
                <input type="checkbox" className="mt-0.5" checked={ackDup} onChange={(e) => setAckDup(e.target.checked)} />
                <span>No invoice ini sudah pernah dibuat PV-nya ({duplicates.map((d) => d.id).join(", ")}). Ini BUKAN invoice yang sama — lanjutkan.</span>
              </label>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-3 border-t border-[#BFE3CF] bg-success-bg/60 px-4 py-2.5">
            <span className="text-[12px] font-semibold text-success-fg">✓ Siap dipakai — {passed.length} pemeriksaan lulus, tidak ada selisih</span>
          </div>
        )}
        <div className="flex items-center gap-3 border-t border-[#E8EEF4] px-4 py-2.5">
          <button
            onClick={() => void handleApply()}
            disabled={!canApply}
            className="rounded-md bg-action-primary px-3.5 py-2 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            Pakai data ini → isi Paying Voucher
          </button>
          {hasExistingEntries && <span className="text-[11px] text-warning-fg">Isian PV yang sudah ada akan diganti.</span>}
          {error && <span className="text-[11.5px] font-medium text-danger-fg">{error}</span>}
        </div>
      </div>

      {/* Pemetaan warna */}
      <div className="overflow-hidden rounded-lg border border-[#CFE0EF] bg-white">
        <div className="flex items-center border-b border-[#E8EEF4] px-4 py-2">
          <span className="text-[12px] font-semibold text-text-primary">Pemetaan warna</span>
          <span className="ml-2 text-[11px] text-text-muted">invoice → warna MRP</span>
          <span className={"ml-auto text-[11px] " + (attentionRows.length ? "font-semibold text-warning-fg" : "text-success-fg")}>
            {attentionRows.length ? `${attentionRows.length} perlu perhatian` : `✓ ${rows.length} warna sudah cocok`}
          </span>
        </div>
        <div className="divide-y divide-[#F1F4F7]">{attentionRows.map(renderRow)}</div>
        {okRows.length > 0 && (
          <>
            <button onClick={() => setShowOk((v) => !v)} className="w-full border-t border-[#F1F4F7] px-4 py-2 text-left text-[11.5px] text-text-muted hover:bg-[#F7F9FB]">
              {showOk ? "▾" : "▸"} {attentionRows.length ? `${okRows.length} warna lain sudah cocok` : "Lihat pemetaan"}
            </button>
            {showOk && <div className="divide-y divide-[#F1F4F7] border-t border-[#F1F4F7]">{okRows.map(renderRow)}</div>}
          </>
        )}
      </div>

      {/* Rekonsiliasi */}
      <details open={hasOver} className="rounded-lg border border-[#CFE0EF] bg-white">
        <summary className="cursor-pointer px-4 py-2.5 text-[12px] font-semibold text-text-primary">
          Rekonsiliasi PO <span className="ml-1 font-normal text-text-muted">· {evalResult.recon.reduce((a, r) => a + r.thisInvoice, 0)} dari {totalPoRoll - evalResult.recon.reduce((a, r) => a + r.before, 0)} roll tersisa dipakai invoice ini</span>
        </summary>
        <div className="border-t border-[#E8EEF4] px-4 pb-3">
          <div className="grid grid-cols-[2fr_repeat(4,1fr)] gap-2 py-1.5 text-[10px] font-medium uppercase tracking-wider text-text-muted">
            <span>Warna MRP</span>
            <span className="text-right">Total PO</span>
            <span className="text-right">Sudah PV</span>
            <span className="text-right">Invoice ini</span>
            <span className="text-right">Sisa</span>
          </div>
          {[...evalResult.recon].sort((a, b) => Number(b.thisInvoice > 0) - Number(a.thisInvoice > 0)).map((r) => (
            <div key={r.warna} className={"grid grid-cols-[2fr_repeat(4,1fr)] gap-2 border-t border-[#F1F4F7] py-1 text-xs " + (r.over ? "text-danger-fg" : r.thisInvoice === 0 ? "text-text-muted" : "text-[#31414F]")}>
              <span className={r.thisInvoice > 0 ? "font-medium" : ""}>{r.warna}</span>
              <span className="text-right font-mono">{r.total}</span>
              <span className="text-right font-mono">{r.before}</span>
              <span className="text-right font-mono font-semibold">{r.thisInvoice || "—"}</span>
              <span className="text-right font-mono">{r.over ? `−${-r.after}` : r.after}</span>
            </div>
          ))}
        </div>
      </details>

      {/* Detail: pemeriksaan, hasil baca, teks mentah */}
      <details open={blockingChecks.length > 0} className="rounded-lg border border-[#CFE0EF] bg-white">
        <summary className="cursor-pointer px-4 py-2.5 text-[12px] font-semibold text-text-primary">
          Detail pemeriksaan &amp; hasil baca <span className="ml-1 font-normal text-text-muted">· {passed.length}/{allChecks.length} lulus · bisa diedit jika ada angka salah baca</span>
        </summary>
        <div className="border-t border-[#E8EEF4] px-4 py-3">
          <ul className="space-y-0.5 text-[11.5px]">
            {allChecks.map((c, k) => (
              <li key={k} className={c.ok ? "text-success-fg" : "text-danger-fg"}>
                {c.ok ? "✓" : "⚠"} <span className="font-medium">{c.label}</span> <span className="font-mono text-[10.5px] opacity-80">{c.detail}</span>
              </li>
            ))}
          </ul>
          <div className="mt-3 max-h-80 overflow-auto">
            <table className="w-full border-collapse text-xs">
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
          {parsed.rawText && (
            <details className="mt-2">
              <summary className="cursor-pointer text-[11px] text-text-muted">Teks mentah hasil baca</summary>
              <pre className="mt-1 max-h-60 overflow-auto whitespace-pre-wrap font-mono text-[10.5px] text-[#31414F]">{parsed.rawText}</pre>
            </details>
          )}
        </div>
      </details>
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
