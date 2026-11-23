// PDF invoice -> teks, SEMUA di browser (PDF tidak dikirim ke server mana pun).
//  - PDF yang punya text layer asli: teks dibaca langsung (paling akurat).
//  - PDF berupa gambar: halaman dirender ke canvas lalu di-OCR (Tesseract.js, PSM 6).
// pdf.js & Tesseract (worker, core wasm, data bahasa) disajikan dari origin yang sama
// (public/invoice-ocr/) -- tanpa CDN -- dan dimuat lazy, hanya saat fitur ini dipakai.

const BASE = "/invoice-ocr";
const abs = (p: string) => new URL(p, window.location.origin).href;

/* eslint-disable @typescript-eslint/no-explicit-any */
type PdfJs = any;
type TesseractWorker = any;

let pdfjsPromise: Promise<PdfJs> | null = null;
function loadPdfjs(): Promise<PdfJs> {
  if (!pdfjsPromise) {
    const url = abs(`${BASE}/pdfjs/pdf.min.mjs`);
    pdfjsPromise = import(/* webpackIgnore: true */ /* turbopackIgnore: true */ url).then((mod: PdfJs) => {
      mod.GlobalWorkerOptions.workerSrc = abs(`${BASE}/pdfjs/pdf.worker.min.mjs`);
      return mod;
    });
    pdfjsPromise.catch(() => {
      pdfjsPromise = null;
    });
  }
  return pdfjsPromise;
}

let tesseractScript: Promise<void> | null = null;
function loadTesseractScript(): Promise<void> {
  if ((window as any).Tesseract) return Promise.resolve();
  if (!tesseractScript) {
    tesseractScript = new Promise<void>((resolve, reject) => {
      const s = document.createElement("script");
      s.src = `${BASE}/tesseract/tesseract.min.js`;
      s.onload = () => resolve();
      s.onerror = () => {
        tesseractScript = null;
        reject(new Error("Mesin OCR gagal dimuat."));
      };
      document.head.appendChild(s);
    });
  }
  return tesseractScript;
}

let worker: TesseractWorker | null = null;
let onOcrProgress: (fraction: number) => void = () => {};

async function getWorker(): Promise<TesseractWorker> {
  if (worker) return worker;
  await loadTesseractScript();
  const T = (window as any).Tesseract;
  const w = await T.createWorker("eng", 1, {
    workerPath: abs(`${BASE}/tesseract/worker.min.js`),
    corePath: abs(`${BASE}/tesseract/core`),
    langPath: abs(`${BASE}/tesseract/lang`),
    gzip: true,
    logger: (m: { status: string; progress: number }) => {
      if (m.status === "recognizing text") onOcrProgress(m.progress);
    },
  });
  await w.setParameters({ tessedit_pageseg_mode: "6", preserve_interword_spaces: "1" });
  worker = w;
  return w;
}

/** Lepas memori mesin OCR (panggil saat panel upload ditutup). */
export async function terminateOcr(): Promise<void> {
  const w = worker;
  worker = null;
  if (w) {
    try {
      await w.terminate();
    } catch {
      /* abaikan */
    }
  }
}

/** Text layer asli PDF -> teks per baris (dikelompokkan menurut koordinat y). Null kalau PDF ini gambar. */
async function textLayer(page: any): Promise<string | null> {
  const tc = await page.getTextContent();
  const items = (tc.items as any[]).filter((i) => i.str && i.str.trim());
  if (items.length < 20) return null;
  const rows = new Map<number, any[]>();
  for (const it of items) {
    const y = Math.round(it.transform[5] / 3);
    if (!rows.has(y)) rows.set(y, []);
    rows.get(y)!.push(it);
  }
  return [...rows.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([, r]) =>
      r
        .sort((a, b) => a.transform[4] - b.transform[4])
        .map((i) => i.str)
        .join("   ")
    )
    .join("\n");
}

/** Foto kamera -> kanvas hitam-putih siap OCR dengan ambang ADAPTIF lokal (Bradley): cetakan termal pudar, bayangan tidak merata, dan latar abu membuat kontras global gagal (diuji pada foto struk KNITTO
 *  asli: kontras global hampir tidak terbaca, ambang adaptif membaca hampir semua code roll). Skala sisi panjang ~3200 px (dibesarkan paling banyak 2,5x, foto sangat besar dikecilkan supaya HP tidak
 *  kehabisan memori). `t` = seberapa gelap piksel dibanding rata-rata lingkungannya agar dianggap tinta (makin kecil makin sensitif, makin banyak noise). */
function binarizeForOcr(src: CanvasImageSource, w: number, h: number, t: number): HTMLCanvasElement {
  const scale = Math.min(2.5, 3200 / Math.max(w, h));
  const cw = Math.max(1, Math.round(w * scale));
  const ch = Math.max(1, Math.round(h * scale));
  const canvas = document.createElement("canvas");
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, cw, ch);
  ctx.drawImage(src, 0, 0, cw, ch);
  const img = ctx.getImageData(0, 0, cw, ch);
  const d = img.data;
  const g = new Uint8Array(cw * ch);
  for (let i = 0, p = 0; i < d.length; i += 4, p++) g[p] = Math.round(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]);
  // Citra integral (Uint32 cukup: 255 x jumlah piksel < 4,29 miliar) untuk rata-rata lokal O(1) per piksel.
  const stride = cw + 1;
  const ii = new Uint32Array(stride * (ch + 1));
  for (let y = 0; y < ch; y++) {
    let row = 0;
    for (let x = 0; x < cw; x++) {
      row += g[y * cw + x];
      ii[(y + 1) * stride + x + 1] = ii[y * stride + x + 1] + row;
    }
  }
  const half = Math.max(4, Math.round(cw / 10) >> 1);
  for (let y = 0; y < ch; y++) {
    const y0 = Math.max(0, y - half);
    const y1 = Math.min(ch - 1, y + half);
    for (let x = 0; x < cw; x++) {
      const x0 = Math.max(0, x - half);
      const x1 = Math.min(cw - 1, x + half);
      const cnt = (x1 - x0 + 1) * (y1 - y0 + 1);
      const sum = ii[(y1 + 1) * stride + x1 + 1] - ii[y0 * stride + x1 + 1] - ii[(y1 + 1) * stride + x0] + ii[y0 * stride + x0];
      const v = g[y * cw + x] * cnt < sum * (1 - t) ? 0 : 255;
      const o = (y * cw + x) * 4;
      d[o] = d[o + 1] = d[o + 2] = v;
      d[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

export type OcrEval = { score: number; ok: boolean };

/** Foto (kanvas dari kamera, atau berkas gambar) -> teks lewat OCR di browser. Gambar tidak dikirim ke server mana pun dan tidak disimpan.
 *  Tanpa `evaluate`: satu kali baca. Dengan `evaluate`: beberapa percobaan (dua kepekaan ambang x mode baca PSM 6 dan 4) sampai ada yang `ok`; hasilnya semua percobaan, yang `score`-nya paling kecil lebih dulu. */
export async function imageToText(
  source: HTMLCanvasElement | HTMLVideoElement | Blob,
  onProgress: (message: string, fraction: number | null) => void,
  evaluate?: (text: string) => OcrEval
): Promise<string[]> {
  onProgress("Menyiapkan gambar…", 0.01);
  let src: CanvasImageSource;
  let w: number;
  let h: number;
  let bmp: ImageBitmap | null = null;
  if (source instanceof Blob) {
    bmp = await createImageBitmap(source);
    src = bmp;
    w = bmp.width;
    h = bmp.height;
  } else if (source instanceof HTMLVideoElement) {
    src = source;
    w = source.videoWidth;
    h = source.videoHeight;
  } else {
    src = source;
    w = source.width;
    h = source.height;
  }
  try {
    onProgress("Menyiapkan mesin OCR (pertama kali agak lama)…", 0.02);
    const worker = await getWorker();
    const tries: { t: number; psm: "6" | "4" }[] = evaluate
      ? [
          { t: 0.06, psm: "6" },
          { t: 0.06, psm: "4" },
          { t: 0.1, psm: "6" },
          { t: 0.1, psm: "4" },
        ]
      : [{ t: 0.06, psm: "6" }];
    const results: { text: string; ev: OcrEval }[] = [];
    let canvas: HTMLCanvasElement | null = null;
    let canvasT = -1;
    try {
      for (let i = 0; i < tries.length; i++) {
        const tr = tries[i];
        if (!canvas || canvasT !== tr.t) {
          canvas = binarizeForOcr(src, w, h, tr.t);
          canvasT = tr.t;
        }
        await worker.setParameters({ tessedit_pageseg_mode: tr.psm });
        onOcrProgress = (f) => onProgress(`Membaca foto… ${Math.round(f * 100)}%${tries.length > 1 ? ` (percobaan ${i + 1}/${tries.length})` : ""}`, f);
        const { data } = await worker.recognize(canvas);
        const text = String(data.text ?? "");
        const ev = evaluate ? evaluate(text) : { score: 0, ok: true };
        results.push({ text, ev });
        if (ev.ok) break;
      }
    } finally {
      await worker.setParameters({ tessedit_pageseg_mode: "6" });
    }
    // Terbaik lebih dulu (skor kecil); pemanggil boleh menggabungkan hasil percobaan lain (tiap percobaan sering gagal di baris yang berbeda).
    return results.sort((x, y) => x.ev.score - y.ev.score).map((r) => r.text);
  } finally {
    bmp?.close();
  }
}

export type PdfTextResult = { text: string; usedOcr: boolean; pages: number };

/** @param onProgress dipanggil dengan pesan status & progres 0..1 (null = tak tentu). */
export async function pdfToText(file: File, onProgress: (message: string, fraction: number | null) => void): Promise<PdfTextResult> {
  onProgress("Membuka PDF…", 0.01);
  const pdfjs = await loadPdfjs();
  const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  let text = "";
  let usedOcr = false;
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const native = await textLayer(page);
    if (native) {
      text += native + "\n";
      continue;
    }
    usedOcr = true;
    const vp1 = page.getViewport({ scale: 1 });
    const scale = Math.min(3, 15000 / vp1.height);
    const vp = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(vp.width);
    canvas.height = Math.ceil(vp.height);
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    onProgress("Menyiapkan mesin OCR (pertama kali agak lama)…", 0.02);
    const w = await getWorker();
    onOcrProgress = (f) => onProgress(`Membaca halaman ${p}/${pdf.numPages}… ${Math.round(f * 100)}%`, f);
    const { data } = await w.recognize(canvas);
    text += data.text + "\n";
  }
  return { text, usedOcr, pages: pdf.numPages };
}
