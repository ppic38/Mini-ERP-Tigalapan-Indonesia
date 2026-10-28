# Integrasi ERP Tigalapan → Warehouse Operation System (WOS)

Dokumen untuk tim WOS. ERP **mengirim (POST)** data resi ke WOS setiap kali vendor produksi menerbitkan resi
(selesai "Set Ekspedisi & Resi"). WOS cukup menyediakan **satu alamat (endpoint) penerima**.

> **Status penerima (2026-10-28):** WOS (`Siddiqq38/W.O.S-Tigalapan-Project`) adalah situs statis + Google Sheets manual tanpa server, jadi penerimanya dibuat baru
> di sisi WOS: fungsi Vercel `api/erp-resi.js` yang menyimpan ke **Supabase** (terpisah dari spreadsheet manual) plus halaman `erp-resi.html`.
> Kodenya diajukan lewat pull request ke repo WOS; panduan pemasangan untuk partner ada di `docs/erp-integrasi/PANDUAN.md` di repo itu.
> Contoh endpoint di bawah berlaku sebagai acuan umum.

## Gambaran singkat

1. Vendor menerbitkan resi di ERP.
2. ± 12 detik kemudian ERP mengirim `POST` berisi JSON ke alamat WOS (`WOS_WEBHOOK_URL`).
3. WOS memeriksa tanda tangan, menyimpan data, lalu membalas **HTTP 2xx**.
4. Kalau WOS membalas selain 2xx atau tidak menjawab (batas 8 detik), ERP menyimpannya di antrean dan **mencoba ulang** (otomatis, sampai 8 kali).

Karena ada percobaan ulang, **endpoint WOS harus idempotent**: kiriman yang sama (kunci `eventId` / header `Idempotency-Key`) bisa datang lebih dari sekali, simpan sekali saja.

## Yang perlu disepakati / disiapkan

| Hal | Keterangan |
| --- | --- |
| Alamat endpoint WOS | Contoh `https://wos-xxxx.vercel.app/api/erp/resi`. Diberikan ke pemilik ERP, dipasang sebagai env `WOS_WEBHOOK_URL` di Vercel ERP. |
| Kunci rahasia bersama | Teks acak panjang (≥ 32 karakter), dibuat satu pihak, dipasang di dua sisi: env `WOS_WEBHOOK_SECRET` di ERP dan di WOS. **Jangan** dikirim lewat chat umum / disimpan di GitHub. |

## Permintaan dari ERP

```
POST <alamat endpoint WOS>
Content-Type: application/json
X-ERP-Event: resi.created
X-ERP-Timestamp: 1730100000                      (detik epoch)
X-ERP-Signature: sha256=<hex>                    (HMAC-SHA256 kunci rahasia atas "<timestamp>.<body mentah>")
Idempotency-Key: RESI-000123                     (sama dengan eventId)
```

### Isi (JSON)

```json
{
  "event": "resi.created",
  "eventId": "RESI-000123",
  "sentAt": "2026-10-28T03:15:10.000Z",
  "resi": {
    "resiGroupId": "RESI-000123",
    "resiNo": "AWB12360",
    "expedition": "WUS CARGO BANDUNG - MAKASSAR",
    "note": "",
    "shippingDate": "2026-10-27",
    "totalKoli": 2,
    "totalQty": 150,
    "mrpNumbers": ["W39"],
    "vendor": { "id": "cecep", "name": "CECEP" }
  },
  "kolis": [
    {
      "koliId": "KOLI-000456",
      "koliNo": "0032",
      "mrpNo": "W39",
      "weightKg": 47,
      "items": [
        { "color": "BURGUNDY 24S", "sleeve": "PANJANG", "size": "L", "sku": "BURGUNDY-24S-PJG-L", "qty": 150, "kind": "FG", "age": null }
      ]
    }
  ],
  "attachments": {
    "manifestUrl": "https://mini-erp-tigalapan.vercel.app/api/wos/resi-files?resi=RESI-000123&exp=...&sig=...",
    "expiresAt": "2026-11-04T03:15:10.000Z",
    "files": [
      { "index": 0, "fileName": "resi.jpg", "url": "https://mini-erp-tigalapan.vercel.app/api/wos/resi-file?resi=RESI-000123&i=0&exp=...&sig=..." }
    ]
  }
}
```

Keterangan field:

- `mrpNumbers`: satu resi bisa memuat koli dari lebih dari satu MRP; nomor MRP tiap koli ada di `kolis[].mrpNo`.
- `sleeve`: `PENDEK` atau `PANJANG`. `kind`: `FG` (finish good) atau `REWORK`. Item reject **tidak** dikirim.
- `sku`: dari Master Data SKU ERP, `null` kalau belum ada pemetaannya.
- `attachments`: lampiran resi (foto) **tidak dikirim sebagai file**, melainkan tautan unduh yang berlaku 7 hari tanpa login.
  Foto bisa lebih dari satu. File ke-2 dst. disimpan vendor beberapa detik setelah resi terbit, jadi untuk daftar yang
  paling lengkap ambil `manifestUrl` (JSON `{ resiGroupId, count, files: [{ index, fileName, url }] }`, selalu terbaru).
  Simpan filenya di penyimpanan WOS sendiri; tautan akan kedaluwarsa.

## Memeriksa tanda tangan (wajib)

Hitung HMAC-SHA256 dari string `"<X-ERP-Timestamp>.<body mentah persis seperti diterima>"` dengan kunci rahasia, bandingkan dengan
`X-ERP-Signature` (tanpa awalan `sha256=`) memakai perbandingan waktu-konstan. Tolak (HTTP 401) kalau tidak cocok atau
`X-ERP-Timestamp` lebih dari 5 menit dari jam server WOS. **Pakai body mentah**, jangan di-parse lalu di-stringify ulang.

### Contoh endpoint penerima (Next.js App Router) — `app/api/erp/resi/route.ts`

```ts
import { createHmac, timingSafeEqual } from "node:crypto";

export async function POST(request: Request) {
  const secret = process.env.ERP_WEBHOOK_SECRET;
  if (!secret) return Response.json({ error: "not configured" }, { status: 503 });

  const raw = await request.text(); // body MENTAH
  const timestamp = request.headers.get("x-erp-timestamp") ?? "";
  const signature = (request.headers.get("x-erp-signature") ?? "").replace(/^sha256=/, "");

  const expected = createHmac("sha256", secret).update(`${timestamp}.${raw}`).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  const fresh = Math.abs(Date.now() / 1000 - Number(timestamp)) < 300;
  if (!fresh || a.length !== b.length || !timingSafeEqual(a, b)) {
    return Response.json({ error: "invalid signature" }, { status: 401 });
  }

  const event = JSON.parse(raw);
  // 1) Idempotent: kalau event.eventId sudah pernah disimpan, langsung balas 200 tanpa menyimpan lagi.
  // 2) Simpan event.resi, event.kolis (+ items) ke database WOS.
  // 3) Ambil lampiran: GET event.attachments.manifestUrl (atau tiap files[].url), simpan file-nya.
  return Response.json({ ok: true });
}
```

## Cara menguji

Belum ada tombol uji di ERP. Untuk uji awal, pemilik ERP menerbitkan satu resi uji di portal vendor, lalu cek log WOS. Balasan non-2xx dari WOS terlihat di tabel `wos_outbox` ERP
(kolom `status`, `last_http_status`, `last_error`).

## Yang belum dicakup

- Pembatalan resi (Sysadmin "Batalkan pengiriman") **belum** dikirim ke WOS. Bisa ditambah sebagai kejadian `resi.cancelled`.
- Konfirmasi balik WOS → ERP (barang diterima di gudang) sudah ada untuk WMS lama lewat fungsi database; untuk WOS belum.
