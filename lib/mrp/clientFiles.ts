"use client";

/** Item revisi 2026-09-06: "file yang diupload (bukti PV, bukti pembayaran, foto klaim) harus bisa
 *  di-preview DAN di-download, diterapkan konsisten di semua modul (Procurement/Finance/Vendor
 *  Produksi)" -- sebelumnya tiap halaman punya cara sendiri-sendiri (kebanyakan cuma
 *  `window.open(dataUrl)`, yang MEMANG membuka file-nya tapi user harus tahu sendiri cara
 *  men-download dari situ -- beda-beda tergantung viewer PDF/gambar bawaan browser). Satu fungsi
 *  dipakai bareng di semua tempat supaya perilakunya konsisten di semua modul.
 *
 *  Revisi 2026-09-07: owner minta trigger download OTOMATIS (elemen `<a download>` yang diklik
 *  programatik, dulu jalan berbarengan dengan window.open) dihapus -- "tidak perlu download, jadi
 *  ke tab browser dulu baru nanti download dari situ". Sekarang MURNI buka tab baru untuk preview;
 *  user download sendiri lewat viewer PDF/gambar bawaan browser di tab itu kalau memang perlu.
 *  Parameter `fileName` DIHAPUS dari signature (dulu cuma dipakai untuk `<a download>` yang
 *  sekarang tidak ada lagi) -- semua caller di-update ikut menghapus argumen ini.
 *
 *  PENTING: `window.open(dataUrl)` LANGSUNG ke string "data:..." DIBLOKIR browser modern (Chrome
 *  sejak versi 65 menolak navigasi top-level ke skema data: lewat window.open, murni proteksi
 *  anti-phishing bawaan browser -- bukan popup-blocker biasa, jadi tidak ada workaround dari sisi
 *  App kalau tetap pakai data: URI mentah). Makanya di sini data URI dikonversi dulu jadi
 *  Blob + `URL.createObjectURL` (skema `blob:` TIDAK kena blokir yang sama) sebelum di-window.open.
 *  Blob URL sengaja di-revoke belakangan (bukan langsung) supaya tab baru sempat selesai memuat
 *  isinya dulu. */
/** Konversi data URI -> blob: URL (skema yang tidak kena blokir `window.open` seperti data:).
 *  Return null kalau formatnya tidak terduga -- caller fallback ke `window.open(dataUrl)` apa
 *  adanya. Diekstrak dari `viewAndDownloadFile` (item revisi 2026-09-08) supaya bisa dipakai
 *  ulang oleh `fillPreviewWindow` -- lihat catatan di sana soal kenapa keduanya perlu jalur
 *  konversi yang sama tapi TIDAK sama-sama manggil `window.open`. */
function dataUrlToBlobUrl(dataUrl: string): string | null {
  const commaIdx = dataUrl.indexOf(",");
  if (commaIdx === -1) return null;
  const meta = dataUrl.slice(5, commaIdx); // buang prefix "data:"
  const isBase64 = meta.endsWith(";base64");
  const mime = isBase64 ? meta.slice(0, -";base64".length) : meta.split(";")[0];
  try {
    const binary = isBase64 ? atob(dataUrl.slice(commaIdx + 1)) : decodeURIComponent(dataUrl.slice(commaIdx + 1));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return URL.createObjectURL(new Blob([bytes], { type: mime || "application/octet-stream" }));
  } catch {
    return null;
  }
}

export function viewAndDownloadFile(dataUrl: string) {
  const blobUrl = dataUrlToBlobUrl(dataUrl);
  if (!blobUrl) {
    // Fallback kalau data URI-nya tidak terduga formatnya -- lebih baik coba apa adanya
    // (mungkin masih kena blokir, tapi tidak lebih buruk dari sebelumnya) daripada diam saja.
    window.open(dataUrl, "_blank");
    return;
  }
  window.open(blobUrl, "_blank");
  setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
}

/** Item revisi 2026-09-08 (bug fix "Bukti Pembayaran tidak bisa diklik"): buka tab kosong
 *  SEKARANG, secara SINKRON di dalam onClick handler -- SEBELUM `await` Server Action apa pun --
 *  supaya browser masih menganggap tab ini "dipicu langsung oleh klik user". `window.open()`
 *  yang dipanggil SETELAH `await` (mis. fetch bukti pembayaran on-demand karena datanya sengaja
 *  tidak ikut snapshot awal, lihat getInvoicePaymentProofAction/getMaterialClaimPhotoAction)
 *  kehilangan status "user gesture" itu di browser modern dan DIAM-DIAM diblokir popup blocker --
 *  inilah sebabnya tombol "Bukti Pembayaran"/"Bukti Klaim" kelihatan seperti tidak melakukan
 *  apa-apa waktu diklik, padahal fetch-nya sendiri sukses. Isi tab ini belakangan lewat
 *  `fillPreviewWindow` begitu data selesai di-fetch. */
export function openPreviewWindow(): Window | null {
  return window.open("", "_blank");
}

/** Isi tab yang SUDAH dibuka (dari `openPreviewWindow`, dipanggil SEBELUM await) dengan file
 *  hasil fetch on-demand. Kalau `win` null (jarang -- tetap diblokir meski sudah dicoba lebih
 *  awal, mis. browser yang memblokir SEMUA popup tanpa kecuali), fallback ke
 *  `viewAndDownloadFile` biasa -- masih mungkin diblokir, tapi tidak lebih buruk dari sebelumnya. */
export function fillPreviewWindow(win: Window | null, dataUrl: string) {
  if (!win) {
    viewAndDownloadFile(dataUrl);
    return;
  }
  const blobUrl = dataUrlToBlobUrl(dataUrl);
  if (!blobUrl) {
    win.location.href = dataUrl;
    return;
  }
  win.location.href = blobUrl;
  setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
}

/** Isi tab yang SUDAH dibuka dengan SEMUA file satu lampiran (lebih dari satu) dalam satu halaman: gambar tampil langsung, PDF di dalam bingkai, tiap file punya
 *  tombol unduh, dan ada tombol "Unduh semua". Dipakai satu tombol "Lihat / Download" untuk lampiran yang terdiri dari beberapa file. */
export function fillPreviewWindowMulti(win: Window, files: { dataUrl: string; fileName?: string }[]) {
  const doc = win.document;
  doc.open();
  doc.write('<!doctype html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Lampiran</title></head><body></body></html>');
  doc.close();
  const urls: string[] = [];
  const style = doc.createElement("style");
  style.textContent =
    "body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#F2F5F8;color:#1F2A37}" +
    ".bar{position:sticky;top:0;z-index:5;display:flex;flex-wrap:wrap;align-items:center;gap:10px;padding:10px 16px;background:#fff;border-bottom:1px solid #DDE3EA}" +
    ".bar b{font-size:14px}.bar a,.bar button{font-size:12px;color:#1D4ED8;text-decoration:underline;background:none;border:0;cursor:pointer;padding:0}" +
    ".bar .all{margin-left:auto;border:1px solid #CBD5DF;border-radius:6px;padding:6px 12px;text-decoration:none;background:#fff;font-weight:600}" +
    ".wrap{max-width:1000px;margin:0 auto;padding:16px}.card{background:#fff;border:1px solid #DDE3EA;border-radius:8px;margin-bottom:16px;overflow:hidden}" +
    ".head{display:flex;align-items:center;gap:10px;padding:8px 14px;border-bottom:1px solid #EEF1F4;font-size:12px}.head span{color:#6B7280}.head a{margin-left:auto;color:#1D4ED8;font-weight:600}" +
    "img{display:block;max-width:100%;margin:0 auto}iframe{display:block;width:100%;height:80vh;border:0}";
  doc.head.appendChild(style);
  doc.title = `Lampiran (${files.length} file)`;

  const bar = doc.createElement("div");
  bar.className = "bar";
  const title = doc.createElement("b");
  title.textContent = `Lampiran · ${files.length} file`;
  bar.appendChild(title);
  const wrap = doc.createElement("div");
  wrap.className = "wrap";
  const links: HTMLAnchorElement[] = [];

  files.forEach((f, i) => {
    const blobUrl = dataUrlToBlobUrl(f.dataUrl);
    if (blobUrl) urls.push(blobUrl);
    const src = blobUrl ?? f.dataUrl;
    const name = f.fileName || `lampiran-${i + 1}`;
    const nav = doc.createElement("a");
    nav.href = `#file-${i + 1}`;
    nav.textContent = `${i + 1}. ${name}`;
    bar.appendChild(nav);

    const card = doc.createElement("div");
    card.className = "card";
    card.id = `file-${i + 1}`;
    const head = doc.createElement("div");
    head.className = "head";
    const label = doc.createElement("b");
    label.textContent = `${i + 1} dari ${files.length}`;
    const nm = doc.createElement("span");
    nm.textContent = name;
    const dl = doc.createElement("a");
    dl.href = src;
    dl.download = name;
    dl.textContent = "Download";
    links.push(dl);
    head.append(label, nm, dl);
    card.appendChild(head);
    if (/^data:application\/pdf/i.test(f.dataUrl)) {
      const frame = doc.createElement("iframe");
      frame.src = src;
      frame.title = name;
      card.appendChild(frame);
    } else {
      const img = doc.createElement("img");
      img.src = src;
      img.alt = name;
      card.appendChild(img);
    }
    wrap.appendChild(card);
  });

  const all = doc.createElement("button");
  all.className = "all";
  all.textContent = "Unduh semua";
  all.onclick = () => links.forEach((a, i) => setTimeout(() => a.click(), i * 400));
  bar.appendChild(all);
  doc.body.append(bar, wrap);
  win.addEventListener("pagehide", () => urls.forEach((u) => URL.revokeObjectURL(u)));
}

/** Cadangan kalau tab preview tidak bisa dibuka (popup diblokir browser): unduh file lewat tautan `<a download>`.
 *  Unduhan tidak diperlakukan sebagai popup, jadi tetap jalan walau dipanggil setelah `await`. */
export function downloadDataUrl(dataUrl: string, fileName: string) {
  const blobUrl = dataUrlToBlobUrl(dataUrl) ?? dataUrl;
  const a = document.createElement("a");
  a.href = blobUrl;
  a.download = fileName;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  if (blobUrl.startsWith("blob:")) setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
}

/** Ukuran string base64 APA ADANYA (1 karakter base64 = 1 byte ASCII di payload yang benar-benar
 *  dikirim) -- dipakai untuk cek batas ukuran file yang di-encode ke data URI SEBELUM dikirim ke
 *  Server Action, bukan `file.size` mentah (base64 menggembungkan ukuran ~33%). Disalin dari
 *  payment-panel.tsx (yang punya catatan panjang soal kenapa pengukuran ini harus begini, lihat
 *  riwayat Round-2/Round-3 fix di sana) -- dipakai lagi di sini (claim-replacement-modal.tsx) biar
 *  konsisten, bukan menulis ulang versi ketiga yang berisiko salah lagi. */
export function dataUrlEncodedBytes(dataUrl: string): number {
  const commaIdx = dataUrl.indexOf(",");
  const b64 = commaIdx === -1 ? dataUrl : dataUrl.slice(commaIdx + 1);
  return b64.length;
}

/** Batas ASLI hasil-encode untuk upload PDF lewat Server Action -- margin di bawah limit body 2 MB
 *  (next.config.ts), sama nilainya dengan MAX_PROOF_ENCODED_BYTES di payment-panel.tsx. */
export const MAX_PDF_ENCODED_BYTES = 1.5 * 1024 * 1024;

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("Gagal membaca file, coba lagi."));
    reader.readAsDataURL(file);
  });
}

function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Gambar tidak bisa dibaca -- coba file JPG/PNG lain."));
    img.src = src;
  });
}

/** Perkecil gambar (JPEG) sampai ukuran ter-encode-nya di bawah batas Server Action: sisi terpanjang dikecilkan bertahap
 *  dan kualitas diturunkan. Latar putih supaya PNG transparan tidak jadi hitam. */
async function compressImageToLimit(dataUrl: string, maxEncodedBytes: number): Promise<string | null> {
  const img = await loadImageElement(dataUrl);
  for (const maxSide of [2000, 1600, 1280, 1000, 800]) {
    const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    for (const quality of [0.85, 0.7, 0.55]) {
      const out = canvas.toDataURL("image/jpeg", quality);
      if (dataUrlEncodedBytes(out) <= maxEncodedBytes) return out;
    }
  }
  return null;
}

/** Baca file bukti (PDF, JPG, atau PNG) jadi data URI. PDF yang terlalu besar ditolak (tidak bisa dikecilkan di browser);
 *  gambar yang terlalu besar otomatis dikecilkan jadi JPEG. Resolve {error} kalau gagal, {dataUrl, fileName} kalau berhasil. */
export async function readProofAsDataUrl(file: File): Promise<{ dataUrl: string; fileName: string } | { error: string }> {
  const isPdf = file.type === "application/pdf";
  const isImage = file.type === "image/jpeg" || file.type === "image/png";
  if (!isPdf && !isImage) return { error: "File harus berformat PDF, JPG, atau PNG." };
  try {
    const raw = await readFileAsDataUrl(file);
    if (dataUrlEncodedBytes(raw) <= MAX_PDF_ENCODED_BYTES) return { dataUrl: raw, fileName: file.name };
    if (isPdf) return { error: "File terlalu besar — kompres dulu PDF-nya." };
    const compressed = await compressImageToLimit(raw, MAX_PDF_ENCODED_BYTES);
    if (!compressed) return { error: "Gambar terlalu besar — perkecil resolusinya dulu." };
    return { dataUrl: compressed, fileName: file.name.replace(/\.[^.]+$/, "") + ".jpg" };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Gagal membaca file, coba lagi." };
  }
}

/** Baca 1 file PDF jadi data URI, dengan validasi tipe + ukuran -- dipakai claim-replacement-modal.tsx
 *  untuk upload "Bukti Invoice". Resolve dengan pesan error (string) kalau gagal, atau
 *  {dataUrl, fileName} kalau berhasil -- caller tinggal cek `"error" in result`. */
export function readPdfAsDataUrl(file: File): Promise<{ dataUrl: string; fileName: string } | { error: string }> {
  return new Promise((resolve) => {
    if (file.type !== "application/pdf") {
      resolve({ error: "File harus berformat PDF." });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      if (dataUrlEncodedBytes(dataUrl) > MAX_PDF_ENCODED_BYTES) {
        resolve({ error: "File terlalu besar — kompres dulu PDF-nya." });
        return;
      }
      resolve({ dataUrl, fileName: file.name });
    };
    reader.onerror = () => resolve({ error: "Gagal membaca file, coba lagi." });
    reader.readAsDataURL(file);
  });
}
