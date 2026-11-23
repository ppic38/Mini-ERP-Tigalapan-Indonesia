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

/** Foto kamera -> kanvas siap OCR: skala disesuaikan (sisi panjang ~2400 px; terlalu kecil dibesarkan, terlalu besar dikecilkan supaya HP murah tidak kehabisan memori), lalu abu-abu dengan kontras
 *  diregangkan (1% tergelap -> hitam, 1% terterang -> putih) supaya cetakan termal yang pudar lebih terbaca. */
function prepareImageForOcr(src: CanvasImageSource, w: number, h: number): HTMLCanvasElement {
  const long = Math.max(w, h);
  const scale = Math.min(2.5, 2400 / long);
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
  const hist = new Uint32Array(256);
  for (let i = 0; i < d.length; i += 4) {
    const g = Math.round(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]);
    d[i] = d[i + 1] = d[i + 2] = g;
    hist[g]++;
  }
  const total = cw * ch;
  let lo = 0;
  let hi = 255;
  for (let acc = 0; lo < 255; lo++) {
    acc += hist[lo];
    if (acc >= total * 0.01) break;
  }
  for (let acc = 0; hi > 0; hi--) {
    acc += hist[hi];
    if (acc >= total * 0.01) break;
  }
  if (hi - lo > 20) {
    const k = 255 / (hi - lo);
    for (let i = 0; i < d.length; i += 4) {
      const g = Math.max(0, Math.min(255, Math.round((d[i] - lo) * k)));
      d[i] = d[i + 1] = d[i + 2] = g;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

/** Foto (kanvas dari kamera, atau berkas gambar) -> teks lewat OCR di browser. Gambar tidak dikirim ke server mana pun dan tidak disimpan. */
export async function imageToText(
  source: HTMLCanvasElement | HTMLVideoElement | Blob,
  onProgress: (message: string, fraction: number | null) => void,
  /** Menilai hasil baca: 0 = bagus, makin besar makin buruk. Kalau mode baca pertama (PSM 6) belum bagus, dicoba mode PSM 4 (lebih tahan foto berisik/buram) dan dipakai yang nilainya lebih kecil. */
  evaluate?: (text: string) => number
): Promise<string> {
  onProgress("Menyiapkan gambar…", 0.01);
  let canvas: HTMLCanvasElement;
  if (source instanceof Blob) {
    const bmp = await createImageBitmap(source);
    canvas = prepareImageForOcr(bmp, bmp.width, bmp.height);
    bmp.close();
  } else if (source instanceof HTMLVideoElement) {
    canvas = prepareImageForOcr(source, source.videoWidth, source.videoHeight);
  } else {
    canvas = prepareImageForOcr(source, source.width, source.height);
  }
  onProgress("Menyiapkan mesin OCR (pertama kali agak lama)…", 0.02);
  const w = await getWorker();
  onOcrProgress = (f) => onProgress(`Membaca foto… ${Math.round(f * 100)}%`, f);
  const { data } = await w.recognize(canvas);
  let best = String(data.text ?? "");
  if (evaluate) {
    let bestScore = evaluate(best);
    if (bestScore > 0) {
      onProgress("Mencoba mode baca lain…", null);
      try {
        await w.setParameters({ tessedit_pageseg_mode: "4" });
        const second = await w.recognize(canvas);
        const t2 = String(second.data.text ?? "");
        const s2 = evaluate(t2);
        if (s2 < bestScore) {
          best = t2;
          bestScore = s2;
        }
      } finally {
        await w.setParameters({ tessedit_pageseg_mode: "6" });
      }
    }
  }
  return best;
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
