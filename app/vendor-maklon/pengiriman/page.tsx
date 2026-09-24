"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { AppShell } from "@/components/shell/app-shell";
import { NumberInput } from "@/components/mrp/number-input";
import { Button } from "@/components/ui/button";
import { VendorAuthGuard } from "@/components/mrp/vendor-auth-guard";
import { useMrpStore } from "@/lib/mrp/store";
import { usePendingActions } from "@/lib/mrp/usePendingActions";
import { viewEkspedisiPhoto } from "@/components/mrp/koli-ekspedisi-card";
import { ItemsDetailPanel, kindLabel, summarizeItems, USIA_LABEL } from "@/components/mrp/koli-items-detail";
import {
  availableFgToShip,
  formatDate,
  formatDecimal,
  mrpIdsWithClosedRolls,
  mrpIdsWithUnpackedFg,
  rollRemainingBySizeForMrp,
} from "@/lib/mrp/derive";
import { countPengirimanPendingForMrp, pendingMarker } from "@/lib/shell/badges";
import { VENDOR_PRODUKSI } from "@/lib/mrp/seed";
import type { AvailableFgRow } from "@/lib/mrp/derive";
import type { DeliveryKoli, DeliveryKoliItem, Lengan, ShippableKind } from "@/lib/mrp/types";

// Revisi 2026-09-24 (owner: "apa bisa detail seperti [Riwayat pengiriman]?"): USIA_LABEL/kindLabel/
// summarizeItems/ItemsDetailPanel DIPINDAH ke components/mrp/koli-items-detail.tsx supaya bisa
// dipakai bareng oleh Invoice & Payment ("Siap diajukan invoice") -- tampilan detail koli sekarang
// SAMA PERSIS di kedua tempat, bukan disalin manual. PRODUCT_KIND_OPTIONS tetap lokal di sini
// (dipakai rowKey/availableFor untuk logic form, bukan bagian tampilan detail).
//
// Item 20 (feedback batch 2026-09-04): Reject bukan lagi barang yang bisa DITAMBAHKAN ke koli baru
// -- dihapus dari opsi ini supaya tidak ada baris Reject baru yang bisa dibuat. `kindLabel`
// (koli-items-detail.tsx) TETAP tahu label "Reject" supaya koli LAMA yang sudah terlanjur berisi
// baris Reject (dari sebelum perubahan ini) masih bisa dirender wajar (lihat `DeliveryItemKind`).
const PRODUCT_KIND_OPTIONS: { value: ShippableKind; label: string }[] = [
  { value: "FG", label: "Finish Good" },
  { value: "REWORK", label: "Rework" },
];

/** Kunci unik 1 baris "Isi koli" — kombinasi jenis produk + warna + lengan + size + usia. Dulu
 *  tiap baris draft ("+ Tambah item") bisa menunjuk kombinasi APA SAJA lewat dropdown, jadi butuh
 *  logic rumit buat saling mengecualikan qty antar baris. Sekarang 1 kombinasi = 1 baris tetap
 *  (langsung dari hasil produksi yang tersedia), jadi kuncinya juga jadi index draft qty-nya. */
function rowKey(kind: DeliveryKoliItem["kind"], r: Pick<AvailableFgRow, "warna" | "lengan" | "size" | "usia">): string {
  return [kind, r.warna, r.lengan, r.size, r.usia ?? ""].join("|");
}

/** Kunci 1 baris "Isi qty per size (Finish Good)" -- warna·lengan·size, dipakai jadi index draft
 *  qty roll DAN untuk mengagregasi `RollRemainingRow[]` (per roll) jadi 1 baris per size (roll bisa
 *  banyak untuk warna·lengan yang sama). Beda dari `rowKey` di atas (yang juga menyertakan
 *  kind/usia) karena roll FG di sini selalu kind FG & tidak berusia. */
function rollSizeKey(warna: string, lengan: Lengan, size: string): string {
  return [warna, lengan, size].join("|");
}

/** Kunci 1 baris invoice (mrpId+warna+lengan+usia) -- dipakai draft rate di dialog "Submit
 *  Invoice", HARUS PERSIS SAMA format-nya dengan `lineKeyLocal` di actions.ts supaya rate yang
 *  diketik di sini nyambung ke baris yang benar saat submit. */
/** Item 2026-09-10 (migration 0024): kompres foto lampiran ekspedisi di BROWSER sebelum dikirim ke
 *  Server Action, pola SAMA PERSIS `compressImageToDataUrl` di production-cutting-tab.tsx (klaim
 *  fisik) -- resize ke sisi terpanjang maks 1280px, JPEG quality 0.7, disimpan sebagai data-URI. */
async function compressImageToDataUrl(file: File): Promise<string> {
  const raw = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("Gagal membaca file foto."));
    reader.readAsDataURL(file);
  });
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error("Gagal membaca gambar."));
    el.src = raw;
  });
  const MAX_EDGE = 1280;
  let { width, height } = img;
  if (width > MAX_EDGE || height > MAX_EDGE) {
    if (width >= height) {
      height = Math.round((height / width) * MAX_EDGE);
      width = MAX_EDGE;
    } else {
      width = Math.round((width / height) * MAX_EDGE);
      height = MAX_EDGE;
    }
  }
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Browser tidak mendukung kompresi foto (canvas).");
  ctx.drawImage(img, 0, 0, width, height);
  return canvas.toDataURL("image/jpeg", 0.7);
}

const MAX_EKSPEDISI_PHOTO_BYTES = 700 * 1024;

function dataUrlApproxBytes(dataUrl: string): number {
  const commaIdx = dataUrl.indexOf(",");
  const b64 = commaIdx === -1 ? dataUrl : dataUrl.slice(commaIdx + 1);
  return Math.round(b64.length * 0.75);
}

function groupByKey<T>(items: T[], keyFn: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const key = keyFn(item);
    const arr = map.get(key);
    if (arr) arr.push(item);
    else map.set(key, [item]);
  }
  return map;
}

/** Item 2026-09-11 (migration 0026, "checkbox koli yang mau dikirim disamakan ekspedisinya - jadi
 *  satu resi") -- kunci grup 1 koli: `resiGroupId`-nya kalau ada, fallback ke id-nya sendiri untuk
 *  koli LAMA (sebelum migration ini) supaya tetap tampil sebagai "grup isi 1" yang wajar, bukan
 *  error/kosong. */
function resiKeyFor(k: DeliveryKoli): string {
  return k.resiGroupId ?? k.id;
}

function PengirimanContent({ vendorId }: { vendorId: string }) {
  const productionResults = useMrpStore((s) => s.productionResults);
  const productionBatches = useMrpStore((s) => s.productionBatches);
  const deliveryKolis = useMrpStore((s) => s.deliveryKolis);
  const ekspedisiRates = useMrpStore((s) => s.ekspedisiRates);
  const productionGroupMeta = useMrpStore((s) => s.productionGroupMeta);
  const maklonPOs = useMrpStore((s) => s.maklonPOs);
  const createDeliveryKoli = useMrpStore((s) => s.createDeliveryKoli);
  const updateDeliveryKoli = useMrpStore((s) => s.updateDeliveryKoli);
  const setKoliEkspedisiResiGroup = useMrpStore((s) => s.setKoliEkspedisiResiGroup);
  const deliverKoliResiGroup = useMrpStore((s) => s.deliverKoliResiGroup);

  // BUG FIX (2026-09-09): union dengan mrpIdsWithClosedRolls -- lihat catatan panjang di
  // definisinya (lib/mrp/derive.ts). Tanpa ini, MRP yang FG-nya semua lewat jalur "Tutup Roll"
  // (paling umum sekarang) tidak akan pernah muncul di dropdown ini sama sekali.
  const mrpIds = Array.from(
    new Set([...mrpIdsWithUnpackedFg(vendorId, productionResults, deliveryKolis, productionGroupMeta, maklonPOs), ...mrpIdsWithClosedRolls(vendorId, productionBatches, deliveryKolis, maklonPOs, productionGroupMeta)])
  );

  // Item Master Data Ekspedisi (menggantikan EKSPEDISI_LIST hardcode lama, lihat lib/mrp/seed.ts)
  // -- opsi dropdown "Set Ekspedisi & Resi" SEKARANG bersumber dari Master Data (ekspedisiRates,
  // dikelola Procurement), diurutkan alfabetis.
  const ekspedisiNames = [...ekspedisiRates].map((r) => r.nama).sort((a, b) => a.localeCompare(b));
  // Revisi 2026-09-23 (owner: "Makassar tidak perlu ada biaya untuk ongkir karena bisa pakai
  // pengiriman internal") -- opsi tambahan KHUSUS vendor Konveksi Makassar (vendorId "MKS"), tidak
  // match nama manapun di Master Data Ekspedisi sehingga ekspedisiPrice()-nya otomatis 0 (lihat
  // lib/mrp/derive.ts) tanpa perlu baris Master Data baru.
  const ekspedisiOptions = vendorId === "MKS" ? ["Pengiriman Internal (tanpa ongkir)", ...ekspedisiNames] : ekspedisiNames;

  const [mrpId, setMrpId] = useState("");
  const [noKoli, setNoKoli] = useState("");
  // Qty per baris "Isi koli" (Rework & sisa FG lama sebelum fitur roll), keyed by
  // rowKey(kind, warna|lengan|size|usia) — lihat rowKey().
  const [qtyDraft, setQtyDraft] = useState<Record<string, number>>({});
  // Berat DRAFT per koli (belum tersimpan sampai "Delivery" grup diklik) -- keyed by koliId.
  const [weightDraft, setWeightDraft] = useState<Record<string, number>>({});
  const [editingKoliId, setEditingKoliId] = useState<string | null>(null);
  // Item 2026-09-10 (migration 0024, "roll boleh dikirim sebagian"): qty per baris "Isi qty per
  // size (Finish Good)", keyed by rollSizeKey(warna,lengan,size) -- pola SAMA PERSIS "Isi qty per
  // size" di Finish Good (production-result-panel.tsx, item 15): user ketik TOTAL qty per size,
  // submit mendistribusikannya ke roll manapun yang cocok (roll pertama dulu, isi sisa
  // kapasitasnya) jadi DeliveryKoliItem[] ber-`sourceBatchId` -- lihat buildRollItems().
  const [rollQtyDraft, setRollQtyDraft] = useState<Record<string, number>>({});
  // Item 2026-09-12 (user-reported): daftar roll mentah ("Roll | Warna/lengan | Sisa per size")
  // cuma referensi teknis, bikin form penuh sebelum sempat diisi -- default disembunyikan, mirip
  // pola "Lihat daftar roll" di tab Finish Good (production-result-panel.tsx).
  const [showRollList, setShowRollList] = useState(false);
  // Filter warna untuk tabel "qty per size" (kosong = semua warna). Hanya memfilter tampilan -- qty yang sudah
  // diisi di warna lain tetap ikut tersimpan.
  const [warnaFilter, setWarnaFilter] = useState("");
  // Klik baris "Koli belum dikirim"/"Riwayat pengiriman" untuk expand/collapse rincian isi koli
  // per item — id koli unik lintas kedua tabel jadi aman pakai 1 Set gabungan.
  const [expandedKoli, setExpandedKoli] = useState<Set<string>>(new Set());
  // Item 2026-09-11 (migration 0026): checkbox pilih koli mana (yang BELUM punya ekspedisi/resi)
  // mau dikirim bareng ke ekspedisi yang sama.
  const [selectedForEkspedisi, setSelectedForEkspedisi] = useState<Set<string>>(new Set());
  // Item revisi 2026-09-07 (owner: aksi vendor produksi terasa lambat -- tidak ada tanda loading
  // sama sekali sebelum ini): dipakai tombol "Delivery →"/"Submit Invoice" di bawah, per GRUP
  // resi (banyak grup independen di daftar yang sama, tidak boleh saling mengunci).
  const { isPending, run: runPendingAction } = usePendingActions();

  function toggleKoliExpanded(koliId: string) {
    setExpandedKoli((prev) => {
      const next = new Set(prev);
      if (next.has(koliId)) next.delete(koliId);
      else next.add(koliId);
      return next;
    });
  }

  function toggleSelectedForEkspedisi(koliId: string) {
    setSelectedForEkspedisi((prev) => {
      const next = new Set(prev);
      if (next.has(koliId)) next.delete(koliId);
      else next.add(koliId);
      return next;
    });
  }

  // MRP yang lagi dipilih di form ini bisa "habis" (semua FG/Rework sudah masuk koli)
  // begitu koli TERAKHIR untuk MRP itu disimpan — begitu itu terjadi, MRP-nya hilang dari
  // `mrpIds` (lihat mrpIdsWithUnpackedFg), tapi state `mrpId` di form ini TIDAK ikut ter-reset
  // sendiri. Akibatnya dropdown <select> tampil kosong (value-nya tidak cocok ke option manapun,
  // browser default balik ke placeholder), tapi bagian "Isi koli" di bawahnya tetap nyangkut ke
  // MRP lama yang sudah tidak relevan. Reset form-nya begitu ini kedeteksi (kecuali lagi edit
  // koli — biarkan edit tetap jalan meski MRP-nya sudah habis di form "buat baru").
  useEffect(() => {
    if (mrpId && !editingKoliId && !mrpIds.includes(mrpId)) {
      setMrpId("");
      setQtyDraft({});
      setRollQtyDraft({});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mrpId, editingKoliId, mrpIds.join(",")]);

  function availableFor(kind: ShippableKind) {
    return mrpId ? availableFgToShip(mrpId, vendorId, productionResults, deliveryKolis, productionGroupMeta, maklonPOs, editingKoliId ?? undefined, kind) : [];
  }

  const availableByKind: Record<ShippableKind, ReturnType<typeof availableFgToShip>> = {
    FG: availableFor("FG"),
    REWORK: availableFor("REWORK"),
  };

  // Satu baris tetap per kombinasi jenis produk+warna+lengan+size+usia yang benar-benar tersedia
  // (bukan lagi baris draft bebas yang harus di-"+ Tambah item" dulu) — user tinggal isi qty
  // langsung di baris yang relevan, sisanya biarkan 0 (tidak ikut koli ini).
  const rows = PRODUCT_KIND_OPTIONS.flatMap((opt) => availableByKind[opt.value].map((r) => ({ ...r, kind: opt.value, key: rowKey(opt.value, r) })));
  const anyAvailable = rows.length > 0;

  // Item 2026-09-10 (migration 0024) -- sisa qty FG PER SIZE dari roll (ProductionBatch) yang
  // sudah "Tutup Roll" & masih ada sisa untuk MRP ini (`editingKoliId` diteruskan supaya qty yang
  // SUDAH ada di koli yang sedang di-edit tetap terhitung "tersedia", bukan "sudah terpakai koli
  // lain" -- lihat rollRemainingBySizeForMrp).
  const rollRows = mrpId ? rollRemainingBySizeForMrp(mrpId, vendorId, productionBatches, deliveryKolis, maklonPOs, productionGroupMeta, editingKoliId ?? undefined) : [];
  const availableBySize = new Map<string, number>();
  for (const row of rollRows) {
    for (const [size, qty] of Object.entries(row.remaining)) {
      const key = rollSizeKey(row.roll.warna, row.roll.lengan, size);
      availableBySize.set(key, (availableBySize.get(key) ?? 0) + qty);
    }
  }
  const rollSizeRows = Array.from(availableBySize.entries())
    .map(([key, available]) => {
      const [warna, lengan, size] = key.split("|");
      return { key, warna, lengan: lengan as Lengan, size, available };
    })
    // Urut per warna (A-Z), di dalam tiap warna Pendek dulu baru Panjang, lalu size.
    .sort((a, b) => a.warna.localeCompare(b.warna) || (a.lengan === b.lengan ? 0 : a.lengan === "PENDEK" ? -1 : 1) || a.size.localeCompare(b.size));
  const warnaOptions = Array.from(new Set(rollSizeRows.map((r) => r.warna)));
  const activeWarnaFilter = warnaOptions.includes(warnaFilter) ? warnaFilter : "";
  const visibleRollSizeRows = activeWarnaFilter ? rollSizeRows.filter((r) => r.warna === activeWarnaFilter) : rollSizeRows;

  function setRowQty(key: string, qty: number) {
    setQtyDraft((prev) => ({ ...prev, [key]: qty }));
  }

  function setRollQty(key: string, qty: number) {
    setRollQtyDraft((prev) => ({ ...prev, [key]: qty }));
  }

  function pickMrp(id: string) {
    setMrpId(id);
    setQtyDraft({});
    setRollQtyDraft({});
    setShowRollList(false);
    setWarnaFilter("");
  }

  function editKoli(k: (typeof deliveryKolis)[number]) {
    setEditingKoliId(k.id);
    setMrpId(k.mrpId);
    setNoKoli(k.noKoli);
    setQtyDraft(Object.fromEntries(k.items.filter((it) => !it.sourceBatchId).map((it) => [rowKey(it.kind ?? "FG", it), it.qty])));
    // Qty roll yang SUDAH ada di koli ini (item ber-sourceBatchId), diagregasi kembali ke draft
    // per size supaya form "Isi qty per size" pre-filled dengan isi koli saat ini.
    const rollDraft: Record<string, number> = {};
    for (const it of k.items) {
      if (!it.sourceBatchId) continue;
      const key = rollSizeKey(it.warna, it.lengan, it.size);
      rollDraft[key] = (rollDraft[key] ?? 0) + it.qty;
    }
    setRollQtyDraft(rollDraft);
  }

  function cancelEdit() {
    setEditingKoliId(null);
    setMrpId("");
    setNoKoli("");
    setQtyDraft({});
    setRollQtyDraft({});
  }

  // Item 2026-09-10 (migration 0024): distribusikan TOTAL qty per size (rollQtyDraft) ke roll
  // manapun yang cocok -- roll PERTAMA dulu, isi sisa kapasitasnya, pola SAMA PERSIS
  // `saveSizeTotals` di production-result-panel.tsx (Finish Good, item 15). Tiap sub-hasil jadi 1
  // DeliveryKoliItem ber-`sourceBatchId` (bisa lebih dari 1 item per size kalau 1 size dipecah
  // lintas >1 roll) -- server (clampDeliveryItemsBySourceBatch, actions.ts) meng-clamp ULANG qty
  // ini ke snapshot fresh sebelum benar-benar disimpan, jadi hasil distribusi di sini murni
  // optimistik/UI, bukan satu-satunya pertahanan terhadap balapan.
  function buildRollItems(): DeliveryKoliItem[] {
    const items: DeliveryKoliItem[] = [];
    for (const [key, draftQtyRaw] of Object.entries(rollQtyDraft)) {
      const draftQty = Math.min(draftQtyRaw, availableBySize.get(key) ?? 0);
      if (draftQty <= 0) continue;
      const [warna, lengan, size] = key.split("|");
      let sisa = draftQty;
      for (const row of rollRows) {
        if (sisa <= 0) break;
        if (row.roll.warna !== warna || row.roll.lengan !== lengan) continue;
        const avail = row.remaining[size] ?? 0;
        if (avail <= 0) continue;
        const take = Math.min(sisa, avail);
        items.push({ warna, lengan: lengan as Lengan, size, qty: take, kind: "FG", sourceBatchId: row.roll.id });
        sisa -= take;
      }
    }
    return items;
  }

  // Item revisi 2026-09-07 (owner: aksi vendor produksi terasa lambat -- tidak ada tanda loading
  // sama sekali sebelum ini): dulu fungsi ini TIDAK async & TIDAK menunggu createDeliveryKoli/
  // updateDeliveryKoli sama sekali -- form langsung dikosongkan SEKETIKA meski createDeliveryKoli
  // (koli BARU, bukan optimistic -- lihat store.ts) belum tentu sudah selesai di server, jadi ada
  // jeda "form kosong tapi koli barunya belum kelihatan" sampai backgroundRefresh selesai, tanpa
  // ada tanda apa pun kalau masih diproses.
  // submit() sekarang tidak menunggu server (optimistic) -- tidak ada state "submitting" lagi.
  const submitting = false;
  async function submit() {
    if (!mrpId || !noKoli.trim() || submitting) return;
    const validItems: DeliveryKoliItem[] = rows
      .filter((r) => (qtyDraft[r.key] ?? 0) > 0)
      .map((r) => ({ warna: r.warna, lengan: r.lengan, size: r.size, usia: r.usia, qty: Math.min(qtyDraft[r.key] ?? 0, r.available), kind: r.kind }));
    const rollItems = buildRollItems();
    const allItems = [...validItems, ...rollItems];
    if (allItems.length === 0) return;
    // Revisi 2026-09-19 (owner: "langsung ada hasilnya saja dulu"): TIDAK lagi menunggu server --
    // store (createDeliveryKoli/updateDeliveryKoli) sudah optimistic penuh (koli langsung muncul di
    // daftar), form dikosongkan seketika. Kalau server menolak, store sudah alert + membatalkan
    // perubahan; di sini form dikembalikan supaya input tidak hilang.
    if (editingKoliId) {
      const existing = deliveryKolis.find((k) => k.id === editingKoliId);
      const editedId = editingKoliId;
      updateDeliveryKoli(editedId, { ekspedisi: existing?.ekspedisi ?? "", noKoli: noKoli.trim(), items: allItems }).catch(() => {
        const k = useMrpStore.getState().deliveryKolis.find((x) => x.id === editedId);
        if (k) editKoli(k);
      });
      cancelEdit();
    } else {
      // Ekspedisi & resi belum dipilih di sini — dipilih belakangan lewat checkbox + "Set
      // Ekspedisi & Resi" di tabel "Koli belum dikirim" di bawah (migration 0026).
      const draftNoKoli = noKoli;
      const draftQty = qtyDraft;
      const draftRollQty = rollQtyDraft;
      createDeliveryKoli({ mrpId, vendorProduksi: vendorId, ekspedisi: "", noKoli: noKoli.trim(), items: allItems }).catch(() => {
        setNoKoli(draftNoKoli);
        setQtyDraft(draftQty);
        setRollQtyDraft(draftRollQty);
      });
      setNoKoli("");
      setQtyDraft({});
      setRollQtyDraft({});
    }
  }

  // Item 2026-09-11 (migration 0026, feedback: "Checkbox Koli yang mau dikirim (disamakan
  // ekspedisinya - jadi satu resi)"): dialog "Set Ekspedisi & Resi" sekarang beroperasi pada
  // SEKUMPULAN koliIds sekaligus (bukan 1 koliId lagi) -- ekspedisi+catatan+foto+NO RESI (field
  // baru, dulu tergabung bebas di catatan) diterapkan identik ke semua koli terpilih dalam SATU
  // aksi atomik (setKoliEkspedisiResiGroupAction), semuanya dapat resiGroupId BARU yang sama.
  const [ekspedisiDialogKoliIds, setEkspedisiDialogKoliIds] = useState<string[] | null>(null);
  const [ekspedisiDraft, setEkspedisiDraft] = useState("");
  // Berat per koli (kg) diinput di dialog ini -- timbang dulu, baru resi dikeluarkan.
  const [dialogWeights, setDialogWeights] = useState<Record<string, number>>({});
  const [ekspedisiNoteDraft, setEkspedisiNoteDraft] = useState("");
  const [noResiDraft, setNoResiDraft] = useState("");
  const [ekspedisiPhotoDataUrl, setEkspedisiPhotoDataUrl] = useState<string | null>(null);
  const [ekspedisiPhotoFileName, setEkspedisiPhotoFileName] = useState<string | undefined>(undefined);
  const [ekspedisiPhotoError, setEkspedisiPhotoError] = useState<string | null>(null);
  const [ekspedisiPhotoBusy, setEkspedisiPhotoBusy] = useState(false);
  const [ekspedisiSubmitting, setEkspedisiSubmitting] = useState(false);
  const [ekspedisiError, setEkspedisiError] = useState<string | null>(null);
  const ekspedisiPhotoInputRef = useRef<HTMLInputElement>(null);

  function openEkspedisiDialog(koliIds: string[]) {
    if (koliIds.length === 0) return;
    setEkspedisiDialogKoliIds(koliIds);
    setDialogWeights(Object.fromEntries(koliIds.map((id) => [id, deliveryKolis.find((k) => k.id === id)?.beratKoli ?? 0])));
    setEkspedisiDraft("");
    setEkspedisiNoteDraft("");
    setNoResiDraft("");
    setEkspedisiPhotoDataUrl(null);
    setEkspedisiPhotoFileName(undefined);
    setEkspedisiPhotoError(null);
    setEkspedisiError(null);
  }
  function closeEkspedisiDialog() {
    setEkspedisiDialogKoliIds(null);
    setDialogWeights({});
    setEkspedisiDraft("");
    setEkspedisiNoteDraft("");
    setNoResiDraft("");
    setEkspedisiPhotoDataUrl(null);
    setEkspedisiPhotoFileName(undefined);
    setEkspedisiPhotoError(null);
    setEkspedisiError(null);
    if (ekspedisiPhotoInputRef.current) ekspedisiPhotoInputRef.current.value = "";
  }
  async function onEkspedisiPhotoSelected(file: File) {
    setEkspedisiPhotoError(null);
    setEkspedisiPhotoBusy(true);
    try {
      const compressed = await compressImageToDataUrl(file);
      if (dataUrlApproxBytes(compressed) > MAX_EKSPEDISI_PHOTO_BYTES) {
        setEkspedisiPhotoError("Foto terlalu besar, ambil ulang dengan resolusi lebih kecil");
        setEkspedisiPhotoDataUrl(null);
        return;
      }
      setEkspedisiPhotoDataUrl(compressed);
      setEkspedisiPhotoFileName(file.name);
    } catch (e) {
      setEkspedisiPhotoError(e instanceof Error ? e.message : "Gagal memproses foto.");
    } finally {
      setEkspedisiPhotoBusy(false);
    }
  }
  async function submitEkspedisi() {
    if (!ekspedisiDialogKoliIds || !ekspedisiDraft || !noResiDraft.trim() || !ekspedisiPhotoDataUrl || ekspedisiSubmitting) return;
    if (ekspedisiDialogKoliIds.some((id) => !((dialogWeights[id] ?? 0) > 0))) return;
    setEkspedisiSubmitting(true);
    setEkspedisiError(null);
    try {
      await setKoliEkspedisiResiGroup(ekspedisiDialogKoliIds, ekspedisiDraft, ekspedisiNoteDraft.trim(), noResiDraft.trim(), { dataUrl: ekspedisiPhotoDataUrl, fileName: ekspedisiPhotoFileName }, dialogWeights);
      setSelectedForEkspedisi(new Set());
      closeEkspedisiDialog();
    } catch (e) {
      setEkspedisiError(e instanceof Error ? e.message : "Gagal menyimpan ekspedisi.");
    } finally {
      setEkspedisiSubmitting(false);
    }
  }

  const myKolis = deliveryKolis.filter((k) => k.vendorProduksi === vendorId);
  const pending = myKolis.filter((k) => !k.deliveredAt);
  const delivered = myKolis.filter((k) => k.deliveredAt);

  // Item 2026-09-11 (migration 0026): "Koli belum dikirim" sekarang 2 bagian -- koli yang BELUM
  // punya ekspedisi/resi (checkbox pilih mau digabung ke resi mana), dan koli yang SUDAH (siap
  // diisi berat + Delivery per GRUP).
  const pendingWithoutEkspedisi = pending.filter((k) => !k.resiGroupId);
  const pendingWithEkspedisi = pending.filter((k) => k.resiGroupId);
  const pendingGroups = Array.from(groupByKey(pendingWithEkspedisi, resiKeyFor).entries());
  const deliveredGroups = Array.from(groupByKey(delivered, resiKeyFor).entries());

  // Item 2026-09-11 (migration 0026, owner: "berat dan delivery itu digabung jadi satu aksi ...
  // yang dibayarkan itu adalah berat total koli yang dikirimkan ke satu ekspedisi"): SATU tombol
  // "Delivery" per GRUP resi -- enabled cuma kalau SEMUA koli dalam grup sudah diisi berat > 0.
  // Berat koli sekarang tersimpan sejak "Set Ekspedisi & Resi" (beratKoli); weightDraft cuma
  // fallback untuk koli LAMA yang sudah punya ekspedisi tapi beratnya belum pernah diisi.
  function weightOf(k: DeliveryKoli): number {
    return k.beratKoli && k.beratKoli > 0 ? k.beratKoli : weightDraft[k.id] ?? 0;
  }
  function doDeliveryGroup(groupKey: string, kolis: DeliveryKoli[]) {
    const items = kolis.map((k) => ({ koliId: k.id, beratKoli: weightOf(k) }));
    if (items.some((it) => !(it.beratKoli > 0)) || isPending(groupKey)) return;
    runPendingAction(groupKey, deliverKoliResiGroup(items));
  }

  return (
    <AppShell
      role="vendorMaklon"
      vendorId={vendorId}
      activeHref="/vendor-maklon/pengiriman"
      breadcrumb={["Dashboard", "Pengiriman"]}
      title="Pengiriman"
      roleOverride={VENDOR_PRODUKSI[vendorId]?.name ?? vendorId}
      entityOverride="Vendor Produksi"
    >
      <div className="rounded-lg border border-border-subtle bg-surface-card px-4 py-3.5">
        <div className="flex items-center gap-2">
          <div className="font-sans text-[13px] font-semibold text-text-primary">{editingKoliId ? `Edit koli — ${noKoli}` : "Buat koli baru"}</div>
          {editingKoliId && (
            <Button onClick={cancelEdit} variant="danger" size="xs" className="ml-auto">
              Batal edit
            </Button>
          )}
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <div>
            <div className="font-sans text-[10.5px] font-medium uppercase tracking-wider text-text-muted">Pilih MRP</div>
            <select value={mrpId} onChange={(e) => pickMrp(e.target.value)} disabled={!!editingKoliId} className="input mt-1 disabled:bg-[#F7F9FB] disabled:text-text-muted">
              <option value="">— pilih MRP —</option>
              {(editingKoliId && !mrpIds.includes(mrpId) ? [mrpId, ...mrpIds] : mrpIds).map((id) => (
                <option key={id} value={id}>
                  {id}
                  {pendingMarker(countPengirimanPendingForMrp(id, vendorId, productionResults, deliveryKolis, productionGroupMeta, maklonPOs), "pcs belum dikemas")}
                </option>
              ))}
            </select>
            {mrpIds.length === 0 && !editingKoliId && (
              <div className="mt-1 font-sans text-[11px] text-text-muted">Belum ada finish good siap dikemas.</div>
            )}
          </div>
          <div>
            <div className="font-sans text-[10.5px] font-medium uppercase tracking-wider text-text-muted">No koli</div>
            <input value={noKoli} onChange={(e) => setNoKoli(e.target.value)} placeholder="Contoh: KOLI-001" className="input mt-1" />
          </div>
        </div>

        {mrpId && (
          <div className="mt-4">
            {/* Item 2026-09-10 (migration 0024, feedback: "Saya ingin bisa input per size untuk
                qty tapi ... qty di roll yang telah ditentukan akan berkurang, sama seperti input
                finish good saat ini"): checkbox pilih ROLL UTUH DIHAPUS -- diganti input per size
                (pola sama Finish Good, item 15). Qty yang diketik mengurangi sisa roll manapun
                yang cocok -- 1 roll SEKARANG BOLEH dikirim sebagian (sisanya tetap tersedia untuk
                koli lain nanti), dikonfirmasi lewat AskUserQuestion. */}
            <div className="font-sans text-[11px] font-medium uppercase tracking-wider text-text-muted">Finish Good — qty per size</div>
            {/* Item 2026-09-12 (user-reported): qty per size TIDAK BOLEH diketik sebelum No koli
                diisi -- dulu bisa diisi begitu MRP dipilih meski No koli masih kosong, gampang
                kepencet lupa ngisi No koli-nya baru sadar pas "Simpan koli" gagal. */}
            {rollSizeRows.length === 0 && (
              <div className="mt-2 font-sans text-xs text-text-muted">Belum ada roll selesai untuk MRP ini.</div>
            )}
            {warnaOptions.length > 1 && (
              <div className="mt-2 flex items-center gap-2">
                <span className="font-sans text-[10.5px] font-medium uppercase tracking-wider text-text-muted">Filter warna</span>
                <select value={activeWarnaFilter} onChange={(e) => setWarnaFilter(e.target.value)} className="input w-[220px]">
                  <option value="">Semua warna</option>
                  {warnaOptions.map((w) => (
                    <option key={w} value={w}>
                      {w}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {rollSizeRows.length > 0 && (
              <div className="mt-2 overflow-hidden rounded-md border border-border-subtle bg-white">
                <div className="grid grid-cols-4 gap-x-2 border-b border-[#F1F4F7] bg-[#F7F9FB] px-3 py-1.5 font-sans text-[10px] font-medium uppercase tracking-wider text-text-muted">
                  <span>Warna / lengan</span>
                  <span>Size</span>
                  <span className="text-right">Sisa bisa dikirim</span>
                  <span className="text-right">Qty</span>
                </div>
                {visibleRollSizeRows.map((r) => (
                  <div key={r.key} className="grid grid-cols-4 items-center gap-x-2 border-b border-[#F1F4F7] px-3 py-1.5 font-sans text-xs text-[#31414F] last:border-b-0">
                    <span>
                      {r.warna} · {r.lengan}
                    </span>
                    <span>{r.size}</span>
                    <span className="text-right font-mono text-text-muted">{r.available} pcs</span>
                    <span className="flex justify-end">
                      <NumberInput
                        value={rollQtyDraft[r.key] ?? 0}
                        decimals={0}
                        disabled={!noKoli.trim()}
                        onChange={(v) => setRollQty(r.key, Math.max(0, Math.min(v, r.available)))}
                        className="input w-[90px] text-right disabled:cursor-not-allowed disabled:bg-[#F7F9FB] disabled:text-text-muted"
                      />
                    </span>
                  </div>
                ))}
              </div>
            )}
            {/* Item 2026-09-12 (user-reported): daftar roll mentah dihide default (toggle), lihat
                catatan di deklarasi showRollList di atas. */}
            {rollRows.length > 0 && (
              <button onClick={() => setShowRollList((v) => !v)} className="mt-2 font-sans text-[11px] font-semibold text-action-primary underline">
                {showRollList ? "Sembunyikan daftar roll ↑" : `Lihat daftar roll (${rollRows.length}) →`}
              </button>
            )}
            {showRollList && rollRows.length > 0 && (
              <div className="mt-2 overflow-hidden rounded-md border border-[#F1F4F7] bg-[#FAFBFC]">
                <div className="grid grid-cols-4 gap-x-2 border-b border-[#F1F4F7] px-3 py-1 font-sans text-[9.5px] font-medium uppercase tracking-wider text-text-muted">
                  <span>Roll</span>
                  <span>Warna / lengan</span>
                  <span>Sisa per size</span>
                  <span className="text-right">Sisa total</span>
                </div>
                {rollRows.map((row) => {
                  const sizeSummary = Object.entries(row.remaining)
                    .map(([size, q]) => `${size} ${q}`)
                    .join(", ");
                  const remainingTotal = Object.values(row.remaining).reduce((a, b) => a + b, 0);
                  return (
                    <div key={row.roll.id} className="grid grid-cols-4 items-center gap-x-2 border-b border-[#F1F4F7] px-3 py-1 font-sans text-[10.5px] text-text-muted last:border-b-0">
                      <span className="font-mono">{row.roll.codeRoll || row.roll.id}</span>
                      <span>
                        {row.roll.warna} · {row.roll.lengan}
                      </span>
                      <span className="font-mono">{sizeSummary || "—"}</span>
                      <span className="text-right font-mono">{remainingTotal} pcs</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {mrpId && anyAvailable && (
          <div className="mt-4">
            <div className="font-sans text-[11px] font-medium uppercase tracking-wider text-text-muted">Rework &amp; sisa FG lama</div>
            {anyAvailable && (
              <div className="mt-2 overflow-hidden rounded-md border border-border-subtle bg-white">
                <div className="grid grid-cols-6 gap-x-2 border-b border-[#F1F4F7] bg-[#F7F9FB] px-3 py-1.5 font-sans text-[10px] font-medium uppercase tracking-wider text-text-muted">
                  <span>Jenis produk</span>
                  <span>Warna</span>
                  <span>Lengan</span>
                  <span>Size / Usia</span>
                  <span className="text-right">Sisa bisa dikirim</span>
                  <span className="text-right">Qty</span>
                </div>
                {rows.map((r) => {
                  const qty = qtyDraft[r.key] ?? 0;
                  return (
                    <div key={r.key} className="grid grid-cols-6 items-center gap-x-2 border-b border-[#F1F4F7] px-3 py-1.5 font-sans text-xs text-[#31414F] last:border-b-0">
                      <span>{kindLabel(r.kind)}</span>
                      <span>{r.warna}</span>
                      <span>{r.lengan}</span>
                      <span>
                        {r.size}
                        {r.usia ? " · " + USIA_LABEL[r.usia] : ""}
                      </span>
                      <span className="text-right font-mono text-text-muted">{r.available} pcs</span>
                      <span className="flex justify-end">
                        <NumberInput
                          value={qty}
                          decimals={0}
                          disabled={!noKoli.trim()}
                          onChange={(v) => setRowQty(r.key, Math.max(0, Math.min(v, r.available)))}
                          className="input w-[90px] text-right disabled:cursor-not-allowed disabled:bg-[#F7F9FB] disabled:text-text-muted"
                        />
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        <div className="mt-3">
          {/* updateDeliveryKoli sudah optimistic penuh & createDeliveryKoli sekarang langsung
             di-patch dari hasil nyata server (1 round-trip, bukan lagi nunggu backgroundRefresh
             snapshot penuh) -- teks "Menyimpan…" dilepas, `disabled` cukup dipertahankan diam-diam
             (cegah dobel klik) tanpa indikator terlihat, sama seperti tombol "Resting". */}
          <button
            onClick={submit}
            disabled={submitting}
            className="rounded-md bg-action-primary px-3.5 py-2 font-sans text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            {editingKoliId ? "Update koli" : "Simpan koli"}
          </button>
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-border-subtle bg-surface-card">
        <div className="border-b border-border-subtle px-4 py-3 font-sans text-[13px] font-semibold text-text-primary">Koli belum dikirim</div>

        {/* Item 2026-09-11 (migration 0026): koli yang BELUM punya ekspedisi/resi -- checkbox
           pilih mau digabung ke resi yang mana. */}
        <div className="border-b border-border-subtle px-4 py-3">
          <div className="font-sans text-[11px] font-medium uppercase tracking-wider text-text-muted">Belum ada ekspedisi</div>
          {pendingWithoutEkspedisi.length === 0 ? (
            <div className="mt-2 font-sans text-xs text-text-muted">Tidak ada koli.</div>
          ) : (
            <>
              <div className="mt-2 overflow-hidden rounded-md border border-border-subtle bg-white">
                <div className="grid grid-cols-5 gap-x-2 border-b border-[#F1F4F7] bg-[#F7F9FB] px-3 py-1.5 font-sans text-[10px] font-medium uppercase tracking-wider text-text-muted">
                  <span />
                  <span>No MRP</span>
                  <span>No Koli</span>
                  <span>Isi</span>
                  <span className="text-right">Edit</span>
                </div>
                {pendingWithoutEkspedisi.map((k) => {
                  const isExpanded = expandedKoli.has(k.id);
                  return (
                    <Fragment key={k.id}>
                      <div className="grid grid-cols-5 items-center gap-x-2 border-b border-[#F1F4F7] px-3 py-1.5 font-sans text-xs text-[#31414F] last:border-b-0">
                        <input type="checkbox" checked={selectedForEkspedisi.has(k.id)} onChange={() => toggleSelectedForEkspedisi(k.id)} disabled={k.id.startsWith("tmp-")} className="h-3.5 w-3.5 disabled:opacity-40" />
                        <span className="font-mono">{k.mrpId}</span>
                        <span className="font-mono font-medium">{k.noKoli}</span>
                        <button
                          onClick={() => toggleKoliExpanded(k.id)}
                          className="flex items-center gap-1 text-left font-sans text-xs text-[#31414F] hover:text-action-primary"
                          title="Klik untuk lihat rincian isi koli per item"
                        >
                          {isExpanded ? <ChevronDown className="h-3.5 w-3.5 flex-none text-text-muted" /> : <ChevronRight className="h-3.5 w-3.5 flex-none text-text-muted" />}
                          {summarizeItems(k.items)}
                        </button>
                        <span className="text-right">
                          <Button onClick={() => editKoli(k)} disabled={k.id.startsWith("tmp-")} variant="ghost" size="xs">
                            Edit
                          </Button>
                        </span>
                      </div>
                      {isExpanded && (
                        <div className="border-b border-[#F1F4F7] bg-[#FAFBFC] px-3 py-3 last:border-b-0">
                          <ItemsDetailPanel items={k.items} />
                        </div>
                      )}
                    </Fragment>
                  );
                })}
              </div>
              <div className="mt-2">
                <button
                  onClick={() => openEkspedisiDialog(Array.from(selectedForEkspedisi))}
                  disabled={selectedForEkspedisi.size === 0}
                  className="rounded-md bg-action-primary px-3.5 py-2 font-sans text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Set Ekspedisi &amp; Resi ({selectedForEkspedisi.size} koli)
                </button>
              </div>
            </>
          )}
        </div>

        {/* Item 2026-09-11 (migration 0026): koli yang SUDAH punya ekspedisi/resi -- dikelompokkan
           per grup resi, berat diisi per koli tapi Delivery jadi SATU aksi per grup. Ongkir yang
           ditampilkan (grup & per koli) live-preview dari berat DRAFT (belum tersimpan), pola
           perhitungan SAMA PERSIS koliOngkirShare (derive.ts) cuma pakai draft, bukan data
           tersimpan. */}
        {/* Revisi 2026-09-19: tombol Delivery dihapus dari alur normal -- "Set Ekspedisi & Resi"
            sekarang langsung mengirim koli (masuk Riwayat Pengiriman). Bagian ini HANYA tampil untuk
            koli LAMA yang sudah punya ekspedisi tapi belum sempat di-Delivery. */}
        {pendingGroups.length > 0 && (
        <div className="px-4 py-3">
          <div className="font-sans text-[11px] font-medium uppercase tracking-wider text-text-muted">Sudah ada ekspedisi (belum dikirim)</div>
          {pendingGroups.length === 0 ? (
            <div className="mt-2 font-sans text-xs text-text-muted">Tidak ada grup.</div>
          ) : (
            <div className="mt-2 flex flex-col gap-3">
              {pendingGroups.map(([groupKey, kolis]) => {
                const first = kolis[0];
                const allWeighed = kolis.every((k) => weightOf(k) > 0);
                return (
                  <div key={groupKey} className="overflow-hidden rounded-md border border-border-subtle bg-white">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-[#F1F4F7] bg-[#F7F9FB] px-3 py-2 font-sans text-[11.5px] text-[#31414F]">
                      <span className="font-mono font-semibold">{first.noResi || "—"}</span>
                      <span>
                        Ekspedisi: <span className="font-medium">{first.ekspedisi}</span>
                      </span>
                      {first.ekspedisiNoteAt && (
                        <button onClick={() => viewEkspedisiPhoto(first.id)} className="font-semibold text-action-primary underline">
                          Lihat / Download foto
                        </button>
                      )}
                    </div>
                    {first.ekspedisiNote && <div className="border-b border-[#F1F4F7] px-3 py-1.5 font-sans text-[10.5px] text-text-muted">Catatan: {first.ekspedisiNote}</div>}
                    <div className="grid grid-cols-5 gap-x-2 border-b border-[#F1F4F7] bg-[#FAFBFC] px-3 py-1.5 font-sans text-[10px] font-medium uppercase tracking-wider text-text-muted">
                      <span>No MRP</span>
                      <span>No Koli</span>
                      <span>Isi</span>
                      <span className="text-right">Berat (kg)</span>
                      <span className="text-right">Edit</span>
                    </div>
                    {kolis.map((k) => {
                      const isExpanded = expandedKoli.has(k.id);
                      const myWeight = weightOf(k);
                      return (
                        <Fragment key={k.id}>
                          <div className="grid grid-cols-5 items-center gap-x-2 border-b border-[#F1F4F7] px-3 py-1.5 font-sans text-xs text-[#31414F] last:border-b-0">
                            <span className="font-mono">{k.mrpId}</span>
                            <span className="font-mono font-medium">{k.noKoli}</span>
                            <button
                              onClick={() => toggleKoliExpanded(k.id)}
                              className="flex items-center gap-1 text-left font-sans text-xs text-[#31414F] hover:text-action-primary"
                              title="Klik untuk lihat rincian isi koli per item"
                            >
                              {isExpanded ? <ChevronDown className="h-3.5 w-3.5 flex-none text-text-muted" /> : <ChevronRight className="h-3.5 w-3.5 flex-none text-text-muted" />}
                              {summarizeItems(k.items)}
                            </button>
                            <span className="flex justify-end">
                              {k.beratKoli && k.beratKoli > 0 ? (
                                <span className="font-mono">{formatDecimal(k.beratKoli)}</span>
                              ) : (
                                <NumberInput value={myWeight} decimals={2} onChange={(v) => setWeightDraft((prev) => ({ ...prev, [k.id]: v }))} className="input w-[90px] text-right" />
                              )}
                            </span>
                            <span className="text-right">
                              <Button onClick={() => editKoli(k)} variant="ghost" size="xs">
                                Edit
                              </Button>
                            </span>
                          </div>
                          {isExpanded && (
                            <div className="border-b border-[#F1F4F7] bg-[#FAFBFC] px-3 py-3 last:border-b-0">
                              <ItemsDetailPanel items={k.items} />
                            </div>
                          )}
                        </Fragment>
                      );
                    })}
                    <div className="px-3 py-2.5">
                      {/* Item 2026-09-12 (user-reported): variant disamakan ke "primary" (solid
                         biru) supaya terlihat sama tegas seperti tombol "Simpan koli" -- dulu
                         "success" (outline putih) gampang terlewat/dikira kurang penting.
                         deliverKoliResiGroup sudah optimistic penuh di store.ts -- isPending/teks
                         "Mengirim…" dilepas. */}
                      <Button onClick={() => doDeliveryGroup(groupKey, kolis)} disabled={!allWeighed} variant="primary" size="xs">
                        {`Delivery → (${kolis.length} koli)`}
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
        )}
      </div>

      <div className="overflow-hidden rounded-lg border border-border-subtle bg-surface-card">
        <div className="border-b border-border-subtle px-4 py-3 font-sans text-[13px] font-semibold text-text-primary">Riwayat pengiriman</div>
        {deliveredGroups.length === 0 ? (
          <div className="px-4 py-6 text-center font-sans text-xs text-text-muted">Belum ada koli terkirim.</div>
        ) : (
          <div className="flex flex-col gap-3 px-4 py-3">
            {deliveredGroups.map(([groupKey, kolis]) => {
              const first = kolis[0];
              const totalWeight = kolis.reduce((s, k) => s + (k.beratKoli ?? 0), 0);
              const alreadyInvoiced = kolis.some((k) => k.resiInvoicedAt);
              return (
                <div key={groupKey} className="overflow-hidden rounded-md border border-border-subtle bg-white">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-[#F1F4F7] bg-[#F7F9FB] px-3 py-2 font-sans text-[11.5px] text-[#31414F]">
                    <span className="font-mono font-semibold">{first.noResi || "—"}</span>
                    <span>
                      Ekspedisi: <span className="font-medium">{first.ekspedisi}</span>
                    </span>
                    <span>
                      Total berat: <span className="font-mono">{formatDecimal(totalWeight)} kg</span>
                    </span>
                    <span className="font-mono text-[11px] text-text-muted">{formatDate(first.deliveredAt)}</span>
                    {first.ekspedisiNoteAt && (
                      <button onClick={() => viewEkspedisiPhoto(first.id)} className="font-semibold text-action-primary underline">
                        Lihat / Download foto
                      </button>
                    )}
                    {/* Revisi 2026-09-23 (owner): tombol "Submit Invoice" pindah ke halaman Invoice & Payment
                        (tab Invoice Vendor) -- di sini cukup status ringkas. */}
                    <span className="ml-auto">
                      {alreadyInvoiced ? (
                        <span className="rounded-full bg-success-bg px-2.5 py-1 font-sans text-[10.5px] font-semibold text-success-fg">Sudah diinvoice</span>
                      ) : (
                        <span className="rounded-full bg-warning-bg px-2.5 py-1 font-sans text-[10.5px] font-semibold text-warning-fg">
                          Belum diinvoice — ajukan di Invoice &amp; Payment
                        </span>
                      )}
                    </span>
                  </div>
                  {first.ekspedisiNote && <div className="border-b border-[#F1F4F7] px-3 py-1.5 font-sans text-[10.5px] text-text-muted">Catatan: {first.ekspedisiNote}</div>}
                  <div className="grid grid-cols-4 gap-x-2 border-b border-[#F1F4F7] bg-[#FAFBFC] px-3 py-1.5 font-sans text-[10px] font-medium uppercase tracking-wider text-text-muted">
                    <span>No MRP</span>
                    <span>No Koli</span>
                    <span>Isi</span>
                    <span className="text-right">Berat (kg)</span>
                  </div>
                  {kolis.map((k) => {
                    const isExpanded = expandedKoli.has(k.id);
                    return (
                      <Fragment key={k.id}>
                        <div className="grid grid-cols-4 items-center gap-x-2 border-b border-[#F1F4F7] px-3 py-1.5 font-sans text-xs text-[#31414F] last:border-b-0">
                          <span className="font-mono">{k.mrpId}</span>
                          <span className="font-mono font-medium">{k.noKoli}</span>
                          <button
                            onClick={() => toggleKoliExpanded(k.id)}
                            className="flex items-center gap-1 text-left font-sans text-xs text-[#31414F] hover:text-action-primary"
                            title="Klik untuk lihat rincian isi koli per item"
                          >
                            {isExpanded ? <ChevronDown className="h-3.5 w-3.5 flex-none text-text-muted" /> : <ChevronRight className="h-3.5 w-3.5 flex-none text-text-muted" />}
                            {summarizeItems(k.items)}
                          </button>
                          <span className="text-right font-mono">{formatDecimal(k.beratKoli ?? 0)}</span>
                        </div>
                        {isExpanded && (
                          <div className="border-b border-[#F1F4F7] bg-[#FAFBFC] px-3 py-3 last:border-b-0">
                            <ItemsDetailPanel items={k.items} />
                          </div>
                        )}
                      </Fragment>
                    );
                  })}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Item 2026-09-11 (migration 0026): dialog "Set Ekspedisi & Resi" -- sekarang beroperasi
         pada >=1 koliIds, + field "No Resi" baru (terpisah dari catatan). */}
      {ekspedisiDialogKoliIds && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-[#0B131B]/45 p-4">
          <div className="w-full max-w-[480px] rounded-lg bg-white shadow-[0_8px_24px_rgba(11,19,27,.2)]">
            <div className="border-b border-border-subtle px-5 py-3.5">
              <span className="font-sans text-[13px] font-semibold text-text-primary">Set Ekspedisi &amp; Resi — {ekspedisiDialogKoliIds.length} koli</span>
            </div>
            <div className="max-h-[75vh] overflow-y-auto px-5 py-4">
              <div className="font-sans text-[10.5px] font-medium uppercase tracking-wider text-text-muted">Ekspedisi</div>
              <select value={ekspedisiDraft} onChange={(e) => setEkspedisiDraft(e.target.value)} className="input mt-1 w-full">
                <option value="">— pilih ekspedisi —</option>
                {ekspedisiOptions.map((e) => (
                  <option key={e} value={e}>
                    {e}
                  </option>
                ))}
              </select>
              <div className="mt-3 font-sans text-[10.5px] font-medium uppercase tracking-wider text-text-muted">No Resi (wajib)</div>
              <input value={noResiDraft} onChange={(e) => setNoResiDraft(e.target.value)} placeholder="Contoh: JX1234567890" className="input mt-1 w-full" />
              <div className="mt-3 font-sans text-[10.5px] font-medium uppercase tracking-wider text-text-muted">Catatan ekspedisi (opsional)</div>
              <textarea
                value={ekspedisiNoteDraft}
                onChange={(e) => setEkspedisiNoteDraft(e.target.value)}
                placeholder="Contoh: estimasi tiba, kontak ekspedisi..."
                rows={3}
                className="input mt-1 w-full"
              />
              <div className="mt-3 font-sans text-[10.5px] font-medium uppercase tracking-wider text-text-muted">Berat per koli (kg) — wajib</div>
              <div className="mt-1 overflow-hidden rounded-md border border-[#CFE0EF]">
                {ekspedisiDialogKoliIds.map((id) => {
                  const koli = deliveryKolis.find((k) => k.id === id);
                  return (
                    <div key={id} className="flex items-center gap-3 border-b border-[#F1F4F7] px-3 py-1.5 last:border-b-0">
                      <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] font-medium text-[#31414F]" title={koli?.noKoli}>
                        {koli?.noKoli ?? id}
                      </span>
                      <span className="whitespace-nowrap font-sans text-[10.5px] text-text-muted">{koli ? summarizeItems(koli.items) : ""}</span>
                      <NumberInput
                        value={dialogWeights[id] ?? 0}
                        decimals={2}
                        onChange={(v) => setDialogWeights((prev) => ({ ...prev, [id]: v }))}
                        className="input w-[90px] text-right"
                      />
                    </div>
                  );
                })}
                {(() => {
                  const totalW = ekspedisiDialogKoliIds.reduce((s, id) => s + (dialogWeights[id] ?? 0), 0);
                  return (
                    <div className="flex items-center justify-between gap-3 border-t-2 border-accent-blue bg-info-bg px-3 py-1.5 font-sans text-[11px] font-semibold text-info-fg">
                      <span>Total berat: {formatDecimal(totalW)} kg</span>
                    </div>
                  );
                })()}
              </div>
              <div className="mt-3 font-sans text-[10.5px] font-medium uppercase tracking-wider text-text-muted">Foto lampiran (wajib)</div>
              {/* Revisi 2026-09-19 (owner): tampilan tombol pilih file disamakan dengan upload Bukti
                  Paying Voucher di Procurement (components/mrp/paying-voucher-wizard.tsx). */}
              <input
                ref={ekspedisiPhotoInputRef}
                type="file"
                accept="image/*"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) onEkspedisiPhotoSelected(file);
                }}
                className="input mt-1 file:mr-2.5 file:rounded file:border-0 file:bg-info-bg file:px-2.5 file:py-1 file:font-sans file:text-[11px] file:font-semibold file:text-info-fg"
              />
              {ekspedisiPhotoFileName && ekspedisiPhotoDataUrl && !ekspedisiPhotoBusy && (
                <div className="mt-1 font-sans text-[11px] text-success-fg">✓ {ekspedisiPhotoFileName} terupload.</div>
              )}
              {ekspedisiPhotoBusy && <div className="mt-1.5 font-sans text-[10.5px] text-text-muted">Memproses foto…</div>}
              {ekspedisiPhotoError && <div className="mt-1.5 font-sans text-[10.5px] text-danger-fg">{ekspedisiPhotoError}</div>}
              {ekspedisiPhotoDataUrl && !ekspedisiPhotoBusy && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={ekspedisiPhotoDataUrl} alt="Preview foto lampiran ekspedisi" className="mt-2 max-h-[160px] rounded-md border border-[#EEF1F4]" />
              )}
              {ekspedisiError && <div className="mt-2 font-sans text-[10.5px] text-danger-fg">{ekspedisiError}</div>}
            </div>
            <div className="flex justify-end gap-2 border-t border-border-subtle px-5 py-3.5">
              <button onClick={closeEkspedisiDialog} className="rounded-md border border-[#CBD5DF] bg-white px-3.5 py-[7px] font-sans text-xs font-semibold text-action-primary">
                Batal
              </button>
              <Button
                onClick={submitEkspedisi}
                disabled={
                  !ekspedisiDraft ||
                  !noResiDraft.trim() ||
                  !ekspedisiPhotoDataUrl ||
                  ekspedisiSubmitting ||
                  ekspedisiDialogKoliIds.some((id) => !((dialogWeights[id] ?? 0) > 0))
                }
                variant="accent"
                size="sm"
              >
                {ekspedisiSubmitting ? "Menyimpan…" : "Simpan & kirim"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}

export default function VendorPengirimanPage() {
  return <VendorAuthGuard>{(vendorId) => <PengirimanContent vendorId={vendorId} />}</VendorAuthGuard>;
}
