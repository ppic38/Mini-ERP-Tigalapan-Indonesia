"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { imageToText, terminateOcr } from "@/lib/invoice-import/pdf-text";
import { invoiceForSuratJalan, matchSuratJalan, normalizeOcrSuratJalan, parseSuratJalanKnitto } from "@/lib/invoice-import/surat-jalan";
import { applySuratJalanVendorAction } from "@/lib/mrp/actions";
import { unwrapAction } from "@/lib/mrp/action-result";
import { useMrpStore } from "@/lib/mrp/store";
import type { Lengan, RawMaterialInvoice } from "@/lib/mrp/types";

/** Scan surat jalan cetak dengan KAMERA di Good Receive vendor (owner 2026-11-23). KNITTO bisa telat mengirim surat jalan ke Procurement, padahal roll sudah tiba di konveksi bersama
 *  surat jalan cetak ("Bukti Keluar Barang"). Foto dibaca (OCR) SEPENUHNYA di perangkat vendor -- gambar tidak dikirim dan tidak disimpan; yang dikirim ke server hanya daftar
 *  code roll + bruto setelah dicocokkan. Pengaman: No Order = nomor invoice, jumlah baris dan kg harus sama dengan baris Total tercetak, tiap bruto harus ada pasangannya di invoice
 *  (dicek ulang di server), dan vendor bisa memperbaiki hasil baca sebelum menyimpan. */
export function SuratJalanScanModal({ invoice, onClose }: { invoice: RawMaterialInvoice; onClose: () => void }) {
  const refresh = useMrpStore((s) => s.refresh);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [cameraState, setCameraState] = useState<"starting" | "on" | "off">("starting");
  const [cameraError, setCameraError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [done, setDone] = useState<string | null>(null);
  /** Teks hasil baca (sudah dirapikan) -- boleh diperbaiki vendor; seluruh pencocokan dihitung ulang dari sini. */
  const [text, setText] = useState("");
  const [photos, setPhotos] = useState(0);

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
          ? "Izin kamera ditolak. Izinkan kamera untuk situs ini di pengaturan peramban, atau pakai tombol \"Foto lewat kamera bawaan\"."
          : name === "NotFoundError"
            ? "Kamera tidak ditemukan di perangkat ini. Pakai tombol \"Foto lewat kamera bawaan\" atau pilih foto."
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
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      void terminateOcr();
    };
    // Sengaja sekali saat dibuka.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const forMatch = useMemo(() => invoiceForSuratJalan(invoice), [invoice]);
  // Judul "BUKTI KELUAR BARANG" sering salah baca OCR dan bukan bagian yang menjaga keamanan (penjaganya: No Order = nomor invoice, baris Total, bruto persis), jadi kalau judulnya tidak
  // terbaca kita tidak membuat vendor buntu: judul ditambahkan di depan sebelum diparse.
  const parsed = useMemo(() => (text.trim() ? parseSuratJalanKnitto(/BUKTI\s*KELUAR\s*BARANG/i.test(text) ? text : "BUKTI KELUAR BARANG\n" + text, "") : null), [text]);
  const result = useMemo(() => (parsed ? matchSuratJalan(parsed, forMatch) : null), [parsed, forMatch]);

  async function readSource(src: HTMLVideoElement | Blob) {
    setBusy("Membaca foto…");
    setError("");
    try {
      // Nilai hasil baca = jumlah galat parser + pencocokan (0 = langsung cocok); dipakai untuk memilih antara dua mode baca OCR.
      const score = (t: string) => {
        const n = normalizeOcrSuratJalan(t);
        const p = parseSuratJalanKnitto(/BUKTI\s*KELUAR\s*BARANG/i.test(n) ? n : "BUKTI KELUAR BARANG\n" + n, "");
        return matchSuratJalan(p, forMatch).errors.length;
      };
      const raw = await imageToText(src, (m) => setBusy(m), score);
      const norm = normalizeOcrSuratJalan(raw);
      // Foto berikutnya (surat jalan lebih dari satu lembar) ditambahkan di bawah hasil sebelumnya; baris Total terakhir yang dipakai parser.
      setText((cur) => (cur.trim() ? cur.replace(/\s+$/, "") + "\n" + norm : norm));
      setPhotos((n) => n + 1);
    } catch (e) {
      setError("Foto tidak bisa dibaca: " + (e instanceof Error ? e.message : String(e)));
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

  async function save() {
    if (!parsed || !result || !result.ok) return;
    setBusy("Menyimpan code roll…");
    setError("");
    try {
      const res = unwrapAction(
        await applySuratJalanVendorAction({
          invoiceId: invoice.id,
          noOrder: parsed.noOrder,
          fileName: "scan kamera",
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
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-[#0B131B]/55 p-4 max-md:p-0" onClick={() => !busy && onClose()}>
      <div className="flex max-h-[94vh] w-full max-w-[760px] flex-col overflow-hidden rounded-[9px] bg-surface-card shadow-[0_12px_32px_rgba(11,19,27,.28)] max-md:h-full max-md:max-h-full max-md:rounded-none" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2.5 bg-info-bg px-5 py-3">
          <span className="h-2 w-2 rounded-full bg-accent-blue" />
          <span className="font-sans text-xs font-semibold text-info-fg">Scan surat jalan · invoice {invoice.noInvoiceVendor || invoice.id}</span>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 font-sans text-[12px] text-[#31414F]">
          {!done && (
            <>
              <p className="text-text-muted">
                Arahkan kamera ke <b>surat jalan cetak (&quot;Bukti Keluar Barang&quot;)</b> {invoice.supplier} sampai seluruh tulisan <b>No Order</b>, daftar <b>code roll + bruto</b>, dan baris <b>Total</b> terlihat jelas, lalu ambil
                foto. Surat jalan lebih dari satu lembar: foto lembar berikutnya juga. Foto hanya dibaca di perangkat ini dan tidak disimpan. Nomor No Order harus <span className="font-mono font-semibold">{invoice.noInvoiceVendor || "(belum ada nomor)"}</span>.
              </p>
              <div className="mt-3 overflow-hidden rounded-md border border-[#DCE3EA] bg-black">
                <video ref={videoRef} playsInline muted className={`max-h-[46vh] w-full object-contain ${cameraState === "on" ? "" : "hidden"}`} />
                {cameraState !== "on" && (
                  <div className="px-4 py-8 text-center text-[12px] text-white/80">{cameraState === "starting" ? "Membuka kamera…" : cameraError || "Kamera mati."}</div>
                )}
              </div>
              <div className="mt-2.5 flex flex-wrap items-center gap-2">
                <Button variant="primary" size="md" onClick={() => void capture()} disabled={!!busy || cameraState !== "on"}>
                  {photos > 0 ? "Ambil foto lembar berikutnya" : "Ambil foto"}
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
                {photos > 0 && (
                  <Button
                    variant="ghost"
                    size="md"
                    disabled={!!busy}
                    onClick={() => {
                      setText("");
                      setPhotos(0);
                      setError("");
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
                      Foto dibaca: <b>{photos}</b>
                    </span>
                    <span>
                      No Order: <b className="font-mono">{parsed.noOrder || "—"}</b>
                    </span>
                    <span>
                      Roll terbaca: <b>{rollCount}</b>
                    </span>
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
                      </ul>
                      <div className="mt-1.5 text-[11px] text-text-muted">Perbaiki tulisan yang salah baca di kotak &quot;Hasil baca&quot; di bawah, atau ambil foto ulang yang lebih jelas (cahaya cukup, kertas rata, tidak miring).</div>
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
                  {result.matches.length > 0 && (
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
                          {result.matches.map((m) => (
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
                  <div className="text-[11px] text-text-muted">Satu baris roll berbentuk &quot;CODE BRUTO&quot;, mis. R2610048153 25.35. Perbaiki huruf/angka yang salah baca; tabel di atas ikut berubah.</div>
                  <textarea
                    id="sj-scan-text"
                    value={text}
                    onChange={(e) => setText(e.target.value)}
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
            <Button variant="primary" size="md" onClick={() => void save()} disabled={!!busy || !result || !result.ok || result.matches.every((m) => m.alreadySet)}>
              Simpan code roll
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
