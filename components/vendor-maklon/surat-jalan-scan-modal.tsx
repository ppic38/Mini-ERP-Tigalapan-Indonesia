"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { imageToText, pdfToText, terminateOcr } from "@/lib/invoice-import/pdf-text";
import { invoiceForSuratJalan, matchSuratJalan, mergeOcrTexts, normalizeOcrSuratJalan, parseSuratJalanKnitto, suggestBrutoFixes } from "@/lib/invoice-import/surat-jalan";
import { applySuratJalanVendorAction } from "@/lib/mrp/actions";
import { unwrapAction } from "@/lib/mrp/action-result";
import { useMrpStore } from "@/lib/mrp/store";
import type { Lengan, RawMaterialInvoice } from "@/lib/mrp/types";

/** Scan / unggah surat jalan supplier di Good Receive vendor, PER INVOICE (owner 2026-11-23). KNITTO bisa telat mengirim surat jalan ke Procurement, padahal roll sudah tiba di konveksi bersama
 *  surat jalan cetak. Yang dibaca HANYA daftar code roll + bruto (judul, alamat, No Order tidak perlu ikut terpotret): vendor sendiri memilih invoice-nya, dan bruto tiap roll menjadi acuan yang
 *  harus persis sama dengan roll di invoice itu. Foto dibaca (OCR) SEPENUHNYA di perangkat vendor -- gambar tidak dikirim dan tidak disimpan; PDF juga bisa diunggah. Yang dikirim ke server hanya
 *  daftar code roll + bruto setelah dicocokkan (dicek ulang di server). Kalau tidak terbaca / belum siap, code roll tetap bisa diisi manual di tiap roll (jalur cadangan di halaman Good Receive). */
export function SuratJalanScanModal({ invoice, onClose }: { invoice: RawMaterialInvoice; onClose: () => void }) {
  const refresh = useMrpStore((s) => s.refresh);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const pdfRef = useRef<HTMLInputElement>(null);
  const [cameraState, setCameraState] = useState<"starting" | "on" | "off">("starting");
  const [cameraError, setCameraError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [done, setDone] = useState<string | null>(null);
  /** Teks hasil baca (sudah dirapikan) -- boleh diperbaiki vendor; seluruh pencocokan dihitung ulang dari sini. */
  const [text, setText] = useState("");
  const [photos, setPhotos] = useState(0);
  const [source, setSource] = useState("scan kamera");
  /** Vendor menegaskan sudah mencocokkan dengan surat jalan fisik walau baris Total tercetak tidak cocok dengan yang terbaca (baris RIB sering salah baca). */
  const [confirmTotal, setConfirmTotal] = useState(false);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setCameraState("off");
  }, []);

  // Tidak mengubah state sebelum `await` (state awal sudah "starting"); tombol "Buka kamera lagi" mengatur ulang state sendiri lewat reopenCamera.
  const startCamera = useCallback(async () => {
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("Peramban ini tidak mendukung kamera (butuh HTTPS).");
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
      streamRef.current = stream;
      const v = videoRef.current;
      if (v) {
        v.srcObject = stream;
        await v.play().catch(() => {});
      }
      setCameraState("on");
    } catch (e) {
      const name = e instanceof DOMException ? e.name : "";
      setCameraError(
        name === "NotAllowedError" || name === "SecurityError"
          ? "Izin kamera ditolak. Izinkan kamera untuk situs ini di pengaturan peramban, atau pakai \"Foto lewat kamera bawaan\" / unggah PDF."
          : name === "NotFoundError"
            ? "Kamera tidak ditemukan di perangkat ini. Pakai \"Foto lewat kamera bawaan\" / unggah PDF."
            : "Kamera tidak bisa dibuka: " + (e instanceof Error ? e.message : String(e))
      );
      setCameraState("off");
    }
  }, []);

  const reopenCamera = useCallback(() => {
    setCameraError("");
    setCameraState("starting");
    void startCamera();
  }, [startCamera]);

  useEffect(() => {
    const t = setTimeout(() => void startCamera(), 0);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      clearTimeout(t);
      window.removeEventListener("keydown", onKey);
      streamRef.current?.getTracks().forEach((t2) => t2.stop());
      streamRef.current = null;
      void terminateOcr();
    };
    // Sengaja sekali saat dibuka.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const forMatch = useMemo(() => invoiceForSuratJalan(invoice), [invoice]);
  // Mode "daftar saja": judul/No Order tidak wajib terbaca (kalau terbaca tetap dicek terhadap nomor invoice).
  const parsed = useMemo(() => (text.trim() ? parseSuratJalanKnitto(text, "", { listOnly: true }) : null), [text]);
  const result = useMemo(() => (parsed ? matchSuratJalan(parsed, forMatch) : null), [parsed, forMatch]);
  // Pencocokan tanpa memblokir karena galat total, supaya roll yang bermasalah tetap terlihat; simpan tetap hanya kalau `result.ok`.
  const diag = useMemo(() => (parsed ? matchSuratJalan({ ...parsed, errors: [] }, forMatch) : null), [parsed, forMatch]);
  const suggestions = useMemo(() => (parsed ? suggestBrutoFixes(parsed, forMatch) : []), [parsed, forMatch]);
  const totalIssues = parsed?.totalIssues ?? [];
  const canSave = !!result && result.ok && result.matches.some((m) => !m.alreadySet) && (totalIssues.length === 0 || confirmTotal);

  function appendText(norm: string) {
    // Foto yang tumpang tindih tidak menggandakan roll: baris roll "CODE BRUTO" yang sudah ada dibuang dari foto berikutnya.
    setText((cur) => {
      if (!cur.trim()) return norm;
      const have = new Set(cur.split(/\r?\n/).map((l) => l.trim().toUpperCase()));
      const fresh = norm.split(/\r?\n/).filter((l) => !/^[A-Z]\d{8,12}\s+\d+\.\d+$/.test(l.trim()) || !have.has(l.trim().toUpperCase()));
      return cur.replace(/\s+$/, "") + "\n" + fresh.join("\n");
    });
  }

  async function readSource(src: HTMLVideoElement | Blob) {
    setBusy("Membaca foto…");
    setError("");
    try {
      // Nilai hasil baca = jumlah galat parser + pencocokan (0 = langsung cocok); dipakai untuk memilih antara dua mode baca OCR.
      const score = (t: string) => {
        const p = parseSuratJalanKnitto(normalizeOcrSuratJalan(t), "", { listOnly: true });
        const full = matchSuratJalan(p, forMatch);
        const diag = matchSuratJalan({ ...p, errors: [] }, forMatch);
        // "ok" hanya kalau tidak ada galat DAN baris/kg cocok dengan Total tercetak; kalau tidak, coba percobaan baca lain dan gabungkan.
        return { ok: full.errors.length === 0 && p.totalIssues.length === 0, score: full.errors.length * 20 + p.totalIssues.length * 5 - diag.matches.length };
      };
      const raws = await imageToText(src, (m) => setBusy(m), score);
      appendText(mergeOcrTexts(raws.map(normalizeOcrSuratJalan), forMatch));
      setSource("scan kamera");
      setPhotos((n) => n + 1);
    } catch (e) {
      setError("Foto tidak bisa dibaca: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setBusy(null);
    }
  }

  async function readPdf(file: File | undefined) {
    if (!file) return;
    if (!/\.pdf$/i.test(file.name)) {
      setError("Pilih berkas PDF.");
      return;
    }
    setBusy("Membaca PDF…");
    setError("");
    try {
      const { text: t, usedOcr } = await pdfToText(file, (m) => setBusy(m));
      appendText(usedOcr ? normalizeOcrSuratJalan(t) : t);
      setSource("PDF " + file.name);
      setPhotos((n) => n + 1);
    } catch (e) {
      setError("PDF tidak bisa dibaca: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setBusy(null);
    }
  }

  async function capture() {
    const v = videoRef.current;
    if (!v || !v.videoWidth) {
      setError("Kamera belum siap.");
      return;
    }
    await readSource(v);
  }

  function applySuggestion(code: string, suggest: number) {
    const re = new RegExp(`(${code})\\s+[0-9.,]+`, "i");
    setText((cur) => cur.replace(re, `$1 ${suggest.toFixed(2)}`));
  }

  async function save() {
    if (!parsed || !result || !canSave) return;
    setBusy("Menyimpan code roll…");
    setError("");
    try {
      const res = unwrapAction(
        await applySuratJalanVendorAction({
          invoiceId: invoice.id,
          noOrder: parsed.noOrder,
          fileName: source,
          assignments: result.matches.map((m) => ({ warna: m.warna, lengan: m.lengan as Lengan, rollIndex: m.rollIndex, codeRoll: m.code, bruto: m.bruto })),
        })
      );
      await refresh();
      stopCamera();
      setDone(`${res.updated} code roll disimpan${res.unchanged > 0 ? `, ${res.unchanged} sudah sama` : ""}. Roll sekarang bisa diterima.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  const th = "px-2.5 py-1.5 text-left font-sans text-[10px] font-semibold uppercase tracking-wider text-text-muted";
  const rollCount = parsed ? parsed.groups.filter((g) => g.kind === "roll").reduce((s, g) => s + g.items.length, 0) : 0;
  const shownMatches = (result && result.matches.length > 0 ? result.matches : diag?.matches) ?? [];
  const unmatchedErrors = (diag?.errors ?? []).filter((m) => !(result?.errors ?? []).includes(m));
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-[#0B131B]/55 p-4 max-md:p-0" onClick={() => !busy && onClose()}>
      <div className="flex max-h-[94vh] w-full max-w-[760px] flex-col overflow-hidden rounded-[9px] bg-surface-card shadow-[0_12px_32px_rgba(11,19,27,.28)] max-md:h-full max-md:max-h-full max-md:rounded-none" onClick={(e) => e.stopPropagation()}>
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 bg-info-bg px-5 py-3">
          <span className="h-2 w-2 rounded-full bg-accent-blue" />
          <span className="font-sans text-xs font-semibold text-info-fg">Scan / unggah surat jalan</span>
          <span className="font-mono text-xs font-semibold text-info-fg">invoice {invoice.noInvoiceVendor || invoice.id}</span>
          <span className="font-sans text-[11px] text-info-fg/80">· {invoice.supplier}</span>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 font-sans text-[12px] text-[#31414F]">
          {!done && (
            <>
              <div className="rounded-md border border-[#F0DDB0] bg-[#FFF9EC] px-3 py-2 text-warning-fg">
                Pastikan ini invoice yang benar: <b className="font-mono">{invoice.noInvoiceVendor || invoice.id}</b>. Surat jalan yang difoto harus milik invoice ini; code roll dicocokkan lewat <b>bruto</b> tiap roll.
              </div>
              <p className="mt-2 text-text-muted">
                Foto <b>bagian daftar saja</b>: dari judul warna (mis. &quot;COMBED 24S SALEM&quot;) sampai baris Total. Judul surat jalan, alamat, dan No Order tidak perlu ikut. Daftar panjang: foto per bagian, roll yang sama tidak
                dihitung dua kali. Foto dibaca di perangkat ini dan tidak disimpan.
              </p>
              <div className="mt-3 overflow-hidden rounded-md border border-[#DCE3EA] bg-black">
                <video ref={videoRef} playsInline muted className={`max-h-[46vh] w-full object-contain ${cameraState === "on" ? "" : "hidden"}`} />
                {cameraState !== "on" && <div className="px-4 py-8 text-center text-[12px] text-white/80">{cameraState === "starting" ? "Membuka kamera…" : cameraError || "Kamera mati."}</div>}
              </div>
              <div className="mt-2.5 flex flex-wrap items-center gap-2">
                <Button variant="primary" size="md" onClick={() => void capture()} disabled={!!busy || cameraState !== "on"}>
                  {photos > 0 ? "Foto bagian berikutnya" : "Ambil foto"}
                </Button>
                {cameraState === "off" && (
                  <Button variant="ghost" size="md" onClick={reopenCamera} disabled={!!busy}>
                    Buka kamera lagi
                  </Button>
                )}
                {/* Cadangan: kamera bawaan HP (capture) atau pilih foto kalau izin kamera ditolak / laptop tanpa webcam. */}
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.target.value = "";
                    if (f) void readSource(f);
                  }}
                />
                <Button variant="ghost" size="md" onClick={() => fileRef.current?.click()} disabled={!!busy}>
                  Foto lewat kamera bawaan
                </Button>
                <input
                  ref={pdfRef}
                  type="file"
                  accept="application/pdf,.pdf"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.target.value = "";
                    void readPdf(f);
                  }}
                />
                <Button variant="ghost" size="md" onClick={() => pdfRef.current?.click()} disabled={!!busy}>
                  Unggah PDF
                </Button>
                {photos > 0 && (
                  <Button
                    variant="ghost"
                    size="md"
                    disabled={!!busy}
                    onClick={() => {
                      setText("");
                      setPhotos(0);
                      setError("");
                      setConfirmTotal(false);
                    }}
                  >
                    Ulangi dari awal
                  </Button>
                )}
              </div>
              {busy && <div className="mt-3 text-info-fg">{busy}</div>}
              {error && <div className="mt-3 rounded-md border border-[#EFC9C4] bg-[#FCF3F1] px-3 py-2 font-medium text-danger-fg">{error}</div>}

              {parsed && result && (
                <div className="mt-4">
                  <div className="flex flex-wrap gap-x-5 gap-y-1">
                    <span>
                      Dibaca: <b>{photos}</b> foto/berkas
                    </span>
                    <span>
                      Roll terbaca: <b>{rollCount}</b>
                    </span>
                    {parsed.noOrder && (
                      <span>
                        No Order: <b className="font-mono">{parsed.noOrder}</b>
                      </span>
                    )}
                    {parsed.total && (
                      <span>
                        Total tercetak: <b>{parsed.total.n} baris · {parsed.total.kg} kg</b>
                      </span>
                    )}
                  </div>
                  {result.errors.length > 0 && (
                    <div className="mt-3 rounded-md border border-[#EFC9C4] bg-[#FCF3F1] px-3 py-2 text-danger-fg">
                      <div className="font-semibold">Belum bisa disimpan:</div>
                      <ul className="mt-1 list-disc pl-5">
                        {result.errors.map((m, i) => (
                          <li key={i}>{m}</li>
                        ))}
                        {unmatchedErrors.map((m, i) => (
                          <li key={"u" + i}>{m}</li>
                        ))}
                      </ul>
                      <div className="mt-1.5 text-[11px] text-text-muted">
                        Perbaiki tulisan yang salah baca di kotak &quot;Hasil baca&quot; di bawah, atau ambil foto ulang yang lebih jelas (cahaya cukup, kertas rata, tidak miring). Kalau tetap tidak terbaca, tutup jendela ini dan isi code
                        roll manual di tiap roll.
                      </div>
                    </div>
                  )}
                  {suggestions.length > 0 && (
                    <div className="mt-2 rounded-md border border-[#F0DDB0] bg-[#FFF9EC] px-3 py-2 text-warning-fg">
                      <div className="font-semibold">Mungkin salah baca bruto:</div>
                      <ul className="mt-1 space-y-1">
                        {suggestions.map((s) => (
                          <li key={s.code} className="flex flex-wrap items-center gap-2">
                            <span>
                              <span className="font-mono">{s.code}</span> terbaca <b className="font-mono">{s.read.toFixed(2)}</b>, di invoice ada <b className="font-mono">{s.suggest.toFixed(2)}</b> ({s.warna})
                            </span>
                            <Button variant="ghost" size="sm" onClick={() => applySuggestion(s.code, s.suggest)} disabled={!!busy}>
                              Pakai {s.suggest.toFixed(2)}
                            </Button>
                          </li>
                        ))}
                      </ul>
                      <div className="mt-1 text-[11px] text-text-muted">Cocokkan dengan surat jalan fisik sebelum memakai saran.</div>
                    </div>
                  )}
                  {totalIssues.length > 0 && (
                    <div className="mt-2 rounded-md border border-[#F0DDB0] bg-[#FFF9EC] px-3 py-2 text-warning-fg">
                      <div className="font-semibold">Perlu dicek ke surat jalan fisik:</div>
                      <ul className="mt-1 list-disc pl-5">
                        {totalIssues.map((m, i) => (
                          <li key={i}>{m.replace("; PDF mungkin tidak terbaca utuh.", ".")}</li>
                        ))}
                      </ul>
                      <div className="mt-1 text-[11px] text-text-muted">
                        Baris RIB dan baris yang tidak terbaca ikut dihitung di Total. Roll yang tidak terbaca tidak disimpan (tetap menunggu atau bisa diisi manual); yang disimpan hanya roll yang brutonya persis sama dengan roll invoice.
                      </div>
                      {result.errors.length === 0 && (
                        <label className="mt-2 flex items-start gap-2 text-[12px] font-medium text-text-primary">
                          <input type="checkbox" className="mt-0.5" checked={confirmTotal} onChange={(e) => setConfirmTotal(e.target.checked)} disabled={!!busy} />
                          <span>Saya sudah mencocokkan code roll di tabel dengan surat jalan fisik dan setuju menyimpan roll yang cocok.</span>
                        </label>
                      )}
                    </div>
                  )}
                  {result.errors.length === 0 && (
                    <div className="mt-3 rounded-md border border-[#BFE3CF] bg-[#F1FAF5] px-3 py-2 font-medium text-success-fg">
                      Cocok: {result.matches.length} roll dipasangkan ke roll invoice dengan bruto yang sama
                      {result.matches.some((m) => m.alreadySet) ? ` (${result.matches.filter((m) => m.alreadySet).length} sudah tercatat)` : ""}. Periksa code roll di tabel dengan surat jalan fisik sebelum menyimpan.
                    </div>
                  )}
                  {result.warnings.length > 0 && (
                    <ul className="mt-2 list-disc pl-5 text-warning-fg">
                      {result.warnings.map((m, i) => (
                        <li key={i}>{m}</li>
                      ))}
                    </ul>
                  )}
                  {shownMatches.length > 0 && (
                    <div className="mt-3 max-h-[240px] overflow-y-auto rounded-md border border-[#E4E9EE]">
                      <table className="w-full border-collapse">
                        <thead className="sticky top-0 bg-[#F2F5F8]">
                          <tr>
                            <th className={th}>Code roll</th>
                            <th className={th}>Warna / lengan</th>
                            <th className={th}>Roll ke</th>
                            <th className={th + " text-right"}>Bruto</th>
                          </tr>
                        </thead>
                        <tbody>
                          {shownMatches.map((m) => (
                            <tr key={m.code} className="border-t border-[#EEF1F4]">
                              <td className="px-2.5 py-1 font-mono">{m.code}</td>
                              <td className="px-2.5 py-1">
                                {m.warna} · {m.lengan === "PENDEK" ? "PDK" : "PJG"}
                              </td>
                              <td className="px-2.5 py-1 font-mono">{m.rollIndex + 1}</td>
                              <td className="px-2.5 py-1 text-right font-mono">{m.bruto.toFixed(2)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}

              {photos > 0 && (
                <div className="mt-4">
                  <label className="font-semibold text-text-primary" htmlFor="sj-scan-text">
                    Hasil baca (boleh diperbaiki)
                  </label>
                  <div className="text-[11px] text-text-muted">Satu baris roll berbentuk &quot;CODE BRUTO&quot;, mis. R2611101758 24.60. Perbaiki huruf/angka yang salah baca; tabel di atas ikut berubah.</div>
                  <textarea
                    id="sj-scan-text"
                    value={text}
                    onChange={(e) => {
                      setText(e.target.value);
                      setConfirmTotal(false);
                    }}
                    spellCheck={false}
                    rows={9}
                    disabled={!!busy}
                    className="mt-1 w-full rounded-md border border-[#CBD5DF] bg-white px-2.5 py-2 font-mono text-[11.5px] leading-5 text-text-primary"
                  />
                </div>
              )}
            </>
          )}
          {done && <div className="rounded-md border border-[#BFE3CF] bg-[#F1FAF5] px-3 py-2 font-semibold text-success-fg">{done}</div>}
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-[#EEF1F4] px-5 py-3">
          <Button variant="ghost" size="md" onClick={onClose} disabled={!!busy}>
            {done ? "Tutup" : "Batal"}
          </Button>
          {!done && (
            <Button variant="primary" size="md" onClick={() => void save()} disabled={!!busy || !canSave}>
              Simpan code roll
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
