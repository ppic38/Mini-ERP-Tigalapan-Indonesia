"use client";

import { useRef, useState } from "react";
import { NumberInput } from "@/components/mrp/number-input";
import { StatusPill } from "@/components/ui/status-pill";
import { Button } from "@/components/ui/button";
import { Tabs } from "@/components/ui/tabs";
import { useMrpStore } from "@/lib/mrp/store";
import {
  availableRollsByAduanRow,
  startedRollsForAduan,
  formatDateTime,
  formatDecimal,
  formatDuration,
  lockedClaimKeys,
  materialClaimsList,
  materialClaimStage,
  materialReceivedForMaklon,
  mrpProductionStarted,
  restingCandidateRolls,
  restingMinutes,
  restingSessionGroups,
  targetSizesForBatch,
  weightVariance,
  YIELD_ALERT_THRESHOLD_PCT,
  type MaterialClaimStage,
  type RestingCandidateRoll,
} from "@/lib/mrp/derive";
import { countCuttingAwaitingUpdateForMrp, pendingMarker } from "@/lib/shell/badges";
import { RESTING_TARGET_MINUTES } from "@/lib/mrp/seed";
import type { AduanPolaRow, Lengan, ProductionBatch } from "@/lib/mrp/types";

/** Item 3.2 (feedback batch 2026-09-04): kompres foto bukti di BROWSER sebelum dikirim ke Server
 *  Action (limit body 1 MB default Next.js, lihat next.config.ts) -- resize ke sisi terpanjang maks
 *  1280px, JPEG quality 0.7. Dikembalikan sebagai data-URI (sama pola penyimpanan seperti
 *  buktiPvDataUrl di PV, lihat types.ts) supaya tidak butuh Supabase Storage. */
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

const MAX_CLAIM_PHOTO_BYTES = 700 * 1024;

function dataUrlApproxBytes(dataUrl: string): number {
  const commaIdx = dataUrl.indexOf(",");
  const b64 = commaIdx === -1 ? dataUrl : dataUrl.slice(commaIdx + 1);
  return Math.round(b64.length * 0.75);
}

/** Item 16 (Decided OQ3: per roll, grouped under warna headings) -- batch "butuh Input Hasil
 *  Cutting" kalau belum pernah dicutting SAMA SEKALI, ATAU sudah dicutting tapi hasil aduannya
 *  masih kosong/nol semua (item 18.3 "Perbaiki Hasil Cutting"). Batch yang sudah lengkap TIDAK
 *  butuh aksi lagi -- tidak ikut modal grup. */
function batchNeedsCuttingInput(b: ProductionBatch): boolean {
  if (!b.cuttingAt) return true;
  if (!b.sizeQty || Object.keys(b.sizeQty).length === 0) return true;
  return Object.values(b.sizeQty).every((v) => !v || v <= 0);
}

type AduanGroup = { kode: string; lengan: Lengan; rows: (AduanPolaRow & { available: number })[]; totalQty: number; totalAvailable: number; totalStarted: number; totalMissing: number };

/** 1 baris di "List roll" (sebelum Resting): roll yang sudah dipilih lewat popup + isian per roll. */
type RollLine = { id: string; roll: RestingCandidateRoll; netKg: number; gramasi: number; setting: string; codeRoll: string };

// Kolom baris GRUP "Material dalam produksi" -- MRP | Kode·lengan | Part | Warna | Roll | Resting |
// Cutting | Durasi Resting | Status Resting | Hasil Aduan/Yield | expander. Item 5 (feedback
// batch 2026-09-05): 1 baris = 1 SESI RESTING ("Part", lihat restingSessionGroups di
// lib/mrp/derive.ts); Code roll, Gramasi & Setting ada di sub-tabel per-roll (CUTTING_BATCH_COLUMNS).
const CUTTING_SESSION_COLUMNS =
  "minmax(85px,0.5fr) minmax(140px,0.8fr) minmax(90px,0.5fr) minmax(150px,0.9fr) minmax(60px,0.4fr) minmax(160px,1fr) minmax(190px,1.1fr) minmax(110px,0.6fr) minmax(160px,0.9fr) minmax(230px,1.4fr) minmax(110px,0.6fr)";

// Kolom sub-tabel PER ROLL (ditampilkan begitu 1 baris grup di atas di-expand) -- Warna | Code
// roll | Gramasi | Setting | Cutting | Hasil Aduan/Yield.
const CUTTING_BATCH_COLUMNS = "minmax(150px,1fr) minmax(130px,0.8fr) minmax(90px,0.5fr) minmax(110px,0.7fr) minmax(160px,1fr) minmax(230px,1.4fr)";

// Kolom "List roll": Warna | Code roll | Berat kotor | Berat bersih | Selisih | Gramasi | Setting | Aksi.
const LIST_GRID = "minmax(140px,1fr) minmax(130px,0.9fr) minmax(90px,0.6fr) minmax(110px,0.7fr) minmax(130px,0.9fr) minmax(90px,0.6fr) minmax(120px,0.8fr) minmax(130px,0.8fr)";

/** Kontrol qty per size di modal Input Hasil Cutting (revisi 2026-09-19): kosong di awal (TIDAK lagi
 *  terisi otomatis), ▼/▲ untuk -1/+1, dan "Maks" mengisi sebesar qty target MRP size itu. Nilai tidak
 *  pernah bisa melebihi `max` (ketikan/▲ di-clamp). Controlled penuh dari parent (value 0 tampil kosong)
 *  supaya clamp langsung terlihat -- beda dari NumberInput yang menyimpan teks sendiri. */
function SizeQtyControl({ size, max, value, onChange }: { size: string; max: number; value: number; onChange: (v: number) => void }) {
  const clamp = (n: number) => Math.max(0, Math.min(max, Math.floor(n)));
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between gap-2">
        <span className="whitespace-nowrap font-sans text-[11px] font-semibold text-[#31414F]">{size}</span>
        <span className="whitespace-nowrap font-mono text-[10px] text-text-muted">maks {max}</span>
      </div>
      <div className="flex items-stretch overflow-hidden rounded-md border border-[#DDE4EB] bg-white">
        <button
          type="button"
          onClick={() => onChange(clamp(value - 1))}
          disabled={value <= 0}
          aria-label={`Kurangi ${size}`}
          className="w-7 flex-none border-r border-[#DDE4EB] text-[9px] text-text-muted hover:bg-[#F2F4F7] disabled:cursor-not-allowed disabled:opacity-40"
        >
          ▼
        </button>
        <input
          value={value > 0 ? String(value) : ""}
          onChange={(e) => {
            const digits = e.target.value.replace(/[^0-9]/g, "");
            onChange(clamp(digits ? parseInt(digits, 10) : 0));
          }}
          inputMode="numeric"
          placeholder="0"
          className="w-full min-w-0 px-1 py-1.5 text-center font-mono text-[13px] font-semibold outline-none"
        />
        <button
          type="button"
          onClick={() => onChange(clamp(value + 1))}
          disabled={value >= max}
          aria-label={`Tambah ${size}`}
          className="w-7 flex-none border-l border-[#DDE4EB] text-[9px] text-text-muted hover:bg-[#F2F4F7] disabled:cursor-not-allowed disabled:opacity-40"
        >
          ▲
        </button>
        <button
          type="button"
          onClick={() => onChange(max)}
          disabled={max <= 0 || value === max}
          className="flex-none border-l border-[#DDE4EB] bg-info-bg px-2 font-sans text-[10.5px] font-semibold text-info-fg hover:bg-[#DCEBF8] disabled:cursor-not-allowed disabled:opacity-40"
        >
          Maks
        </button>
      </div>
    </div>
  );
}

export function ProductionCuttingTab({ vendorId }: { vendorId: string }) {
  const mrpDetails = useMrpStore((s) => s.mrpDetails);
  const maklonPOs = useMrpStore((s) => s.maklonPOs);
  const invoices = useMrpStore((s) => s.invoices);
  const productionBatches = useMrpStore((s) => s.productionBatches);
  const startProductionBatches = useMrpStore((s) => s.startProductionBatches);
  // saveGroup pakai updateBatchesToCutting (1 round-trip utk semua roll grup, lihat komentar
  // saveGroup di bawah). Fungsi single-nya (updateBatchToCutting) tidak dipakai di sini.
  const updateBatchesToCutting = useMrpStore((s) => s.updateBatchesToCutting);
  const receiveRawMaterialRoll = useMrpStore((s) => s.receiveRawMaterialRoll);
  const submitRollDefectClaim = useMrpStore((s) => s.submitRollDefectClaim);
  const materialClaimResolutions = useMrpStore((s) => s.materialClaimResolutions);
  const materialClaimReturRequests = useMrpStore((s) => s.materialClaimReturRequests);
  const materialClaimReturDeliveries = useMrpStore((s) => s.materialClaimReturDeliveries);
  const materialClaimReturReceipts = useMrpStore((s) => s.materialClaimReturReceipts);
  // Flow bertahap 2026-09-11 (C1 di spec) -- dipakai hanya untuk teks banner (KLAIM_DITERIMA /
  // PV_DIBUAT), TIDAK mengubah status terkunci/tidaknya roll.
  const materialClaimAcceptances = useMrpStore((s) => s.materialClaimAcceptances);
  const materialClaimReplacements = useMrpStore((s) => s.materialClaimReplacements);
  const confirmMaterialClaimReturReceived = useMrpStore((s) => s.confirmMaterialClaimReturReceived);

  const [selectedMrpId, setSelectedMrpId] = useState("");
  const [selectedGroupKey, setSelectedGroupKey] = useState("");
  // Tab lengan di tabel Aduan pola (sama seperti Good Receive): Pendek dulu, Panjang kalau hanya itu.
  const [aduanLengan, setAduanLengan] = useState<"PENDEK" | "PANJANG">("PENDEK");
  // Daftar roll dalam proses klaim dibuka lewat popup (bukan container yang selalu terbuka).
  const [claimListOpen, setClaimListOpen] = useState(false);
  // Revisi 2026-09-19 (owner, alur Cutting baru): tahap "Timbang roll" yang berdiri sendiri DIHAPUS.
  // Begitu Good Receive selesai, roll langsung masuk pilihan aduan pola. Di sini user memilih warna ->
  // mencentang roll di popup -> roll masuk "List roll", tempat berat bersih (kg), gramasi, setting &
  // pengajuan claim diisi. Waktu MULAI resting dicatat otomatis saat tombol Resting diklik (tidak ada
  // lagi field tanggal/jam manual).
  const [lines, setLines] = useState<RollLine[]>([]);
  // Popup form "Tambah roll": langkah 1 pilih warna (hanya yang bahannya sudah diterima), langkah 2 tentukan jumlah roll.
  const [pickOpen, setPickOpen] = useState(false);
  const [pickWarna, setPickWarna] = useState("");
  const [pickChecked, setPickChecked] = useState<Set<string>>(new Set());
  const [fillGramasi, setFillGramasi] = useState(0);
  const [fillSetting, setFillSetting] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [restingError, setRestingError] = useState<string | null>(null);

  // Dialog claim per roll di List roll: "BERAT" (selisih berat bersih vs kotor di luar toleransi) atau
  // "FISIK" (cacat: shading/kotor/dll) -- foto bukti WAJIB untuk keduanya.
  const [claimLineId, setClaimLineId] = useState<string | null>(null);
  const [claimKind, setClaimKind] = useState<"BERAT" | "FISIK">("BERAT");
  const [claimNote, setClaimNote] = useState("");
  const [claimPhotoDataUrl, setClaimPhotoDataUrl] = useState<string | null>(null);
  const [claimPhotoFileName, setClaimPhotoFileName] = useState<string | undefined>(undefined);
  const [claimPhotoError, setClaimPhotoError] = useState<string | null>(null);
  const [claimPhotoBusy, setClaimPhotoBusy] = useState(false);
  const [claimSubmitting, setClaimSubmitting] = useState(false);
  const [claimError, setClaimError] = useState<string | null>(null);
  // Ref ke <input type="file"> supaya "Ganti foto" bisa ikut mengosongkan value DOM-nya, bukan cuma
  // state React -- tanpa ini memilih file YANG SAMA lagi tidak memicu onChange.
  const claimPhotoInputRef = useRef<HTMLInputElement>(null);

  // Modal "Input Hasil Cutting" di-scope ke SATU SESI RESTING ("Part") -- `activeCuttingGroupKey`
  // berisi RestingSessionGroup.key penuh (mrpId|kode|lengan|restingAt).
  const [activeCuttingGroupKey, setActiveCuttingGroupKey] = useState<string | null>(null);
  // Hasil aduan AKTUAL per roll (qty per size), keyed per batch id.
  const [cuttingSizeDraft, setCuttingSizeDraft] = useState<Record<string, Record<string, number>>>({});
  // BUG FIX (2026-09-09): error server (mis. grup sudah dikunci "Final Produksi") ditangkap &
  // ditampilkan di modal supaya user tahu PERSIS kenapa gagal.
  const [cuttingGroupError, setCuttingGroupError] = useState<string | null>(null);
  // Item 14: mode "edit" (dibuka lewat "Edit ✎") mencakup SEMUA roll sesi ini, bukan cuma yang belum diisi.
  const [cuttingGroupEditAll, setCuttingGroupEditAll] = useState(false);
  // Item 5: expand/collapse per SESI RESTING ("Part") di tabel "Material dalam produksi".
  const [expandedSessions, setExpandedSessions] = useState<Set<string>>(new Set());
  function toggleSessionExpanded(key: string) {
    setExpandedSessions((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const claimDicts = {
    resolutions: materialClaimResolutions,
    returRequests: materialClaimReturRequests,
    returDeliveries: materialClaimReturDeliveries,
    returReceipts: materialClaimReturReceipts,
  };
  // Roll yang terkunci klaim (atau klaimnya sudah selesai & digantikan) tidak boleh muncul di pilihan.
  const lockedKeys = lockedClaimKeys(invoices, claimDicts);

  const activeStages: string[] = ["PARTIAL_WAITING_MATERIAL", "FULL_WAITING_MATERIAL", "PRODUCTION", "PARTIAL_PRODUCTION"];
  // BUG FIX (2026-09-09): status PO maklon bisa auto-advance LEWAT "PRODUCTION", tapi kalau masih ada
  // roll yang belum di-resting / belum diisi hasil cutting-nya, MRP itu TETAP harus muncul di dropdown
  // ini -- terlepas dari status resmi PO-nya.
  const readyMrpIds = Array.from(
    new Set(
      maklonPOs
        .filter(
          (p) =>
            p.vendorProduksi === vendorId &&
            p.approved &&
            // Revisi 2026-09-20: roll yang sudah diterima BARU muncul di sini setelah "Mulai Produksi" ditekan
            // di Good Receive (PO tidak lagi *_WAITING_MATERIAL). Pekerjaan yang sudah berjalan (batch yang
            // masih butuh input cutting) tetap tampil apa pun status PO-nya.
            ((mrpProductionStarted(p.mrpId, vendorId, maklonPOs) &&
              ((activeStages.includes(p.status) && materialReceivedForMaklon(p.mrpId, vendorId, invoices)) ||
                restingCandidateRolls(p.mrpId, vendorId, invoices, productionBatches, lockedKeys).length > 0)) ||
              productionBatches.some((b) => b.mrpId === p.mrpId && b.vendorProduksi === vendorId && batchNeedsCuttingInput(b)))
        )
        .map((p) => p.mrpId)
    )
  );
  const readyMrps = mrpDetails.filter((d) => readyMrpIds.includes(d.mrp.id));

  const selectedDetail = mrpDetails.find((d) => d.mrp.id === selectedMrpId);
  const aduanRows = (selectedDetail?.aduanRows ?? []).filter((a) => a.vendor === vendorId);

  // Roll yang sedang DALAM PROSES KLAIM untuk MRP ini (terkunci) -- tetap ditampilkan supaya vendor
  // bisa mengonfirmasi roll pengganti yang sudah sampai ("Tandai Diterima"). Roll pengganti yang
  // sudah diterima (RETUR_DITERIMA) langsung muncul di pilihan aduan pola untuk ditimbang ulang.
  const claimRolls = selectedMrpId
    ? materialClaimsList(invoices)
        .filter((c) => c.mrpId === selectedMrpId && c.vendorProduksi === vendorId)
        .map((c) => ({
          claim: c,
          stage: materialClaimStage(
            c.key,
            materialClaimResolutions,
            materialClaimReturRequests,
            materialClaimReturDeliveries,
            materialClaimReturReceipts,
            materialClaimReplacements,
            materialClaimAcceptances
          ) as MaterialClaimStage,
        }))
        .filter((x) => x.stage !== "SELESAI" && x.stage !== "RETUR_DITERIMA")
    : [];
  function stageBanner(stage: MaterialClaimStage, isDefect: boolean, deliveryNote?: string): string {
    switch (stage) {
      case "BELUM":
        return isDefect
          ? "Diklaim CACAT FISIK -- sudah dikirim ke Procurement (lihat Klaim Material). Roll TERKUNCI sampai Procurement atur retur & kirim roll pengganti."
          : "Selisih berat kurang dari toleransi -- sudah dikirim ke Procurement (lihat Klaim Material). Roll TERKUNCI sampai Procurement atur retur & kirim roll pengganti.";
      case "RETUR_DIMINTA":
        return "Retur sudah diminta Procurement ke supplier -- menunggu roll pengganti dikirim.";
      case "RETUR_DIKIRIM":
        return `Roll pengganti sudah dikirim Procurement${deliveryNote ? ` (${deliveryNote})` : ""} -- sudah diterima fisik?`;
      case "KLAIM_DITERIMA":
        return "Klaim sudah diterima Procurement -- menunggu PV pengganti dibuat.";
      case "PV_DIBUAT":
        return "PV pengganti sudah dibuat Procurement -- roll pengganti akan datang sebagai roll BARU di Good Receive.";
      default:
        return "";
    }
  }

  // Dihitung SEKALIGUS untuk semua baris (bukan per-baris independen) -- baris dengan warna+lengan
  // sama berbagi satu pool roll fisik, lihat catatan di availableRollsByAduanRow.
  const availableByRow = selectedMrpId ? availableRollsByAduanRow(aduanRows, invoices, productionBatches, selectedMrpId, lockedKeys) : {};
  const groups = new Map<string, AduanGroup>();
  for (const row of aduanRows) {
    const available = availableByRow[row.id] ?? 0;
    const key = row.kode + "|" + row.lengan;
    const g = groups.get(key) ?? { kode: row.kode, lengan: row.lengan, rows: [], totalQty: 0, totalAvailable: 0, totalStarted: 0, totalMissing: 0 };
    // Revisi 2026-09-20 (owner): roll yang SUDAH di-resting dicatat terpisah supaya kelihatan sisa yang
    // masih harus diterima -- belum diterima = kebutuhan aduan - sudah diresting - tersedia sekarang.
    const started = startedRollsForAduan(row.id, productionBatches);
    const missing = Math.max(0, row.qtyRoll - started - available);
    g.rows.push({ ...row, available });
    g.totalQty += row.qtyRoll;
    g.totalAvailable += available;
    g.totalStarted += started;
    g.totalMissing += missing;
    groups.set(key, g);
  }
  const groupList = Array.from(groups.values());
  const selectedGroup = groups.get(selectedGroupKey) ?? null;

  const candidates = selectedMrpId ? restingCandidateRolls(selectedMrpId, vendorId, invoices, productionBatches, lockedKeys) : [];
  // Baris list yang rollnya sudah tidak tersedia lagi (mis. baru saja diklaim/terkunci) gugur otomatis.
  const visibleLines = lines.filter((l) => candidates.some((c) => c.claimKey === l.id));

  function pickMrp(mrpId: string) {
    setSelectedMrpId(mrpId);
    setSelectedGroupKey("");
    setLines([]);
    closePick();
    setRestingError(null);
  }

  function pickGroup(key: string) {
    if (selectedGroupKey === key) {
      setSelectedGroupKey("");
      setLines([]);
      closePick();
      return;
    }
    setSelectedGroupKey(key);
    setLines([]);
    closePick();
    setRestingError(null);
  }

  // Popup form "Tambah roll": hanya warna yang bahannya SUDAH diterima & masih punya sisa yang bisa
  // dipakai (belum diterima = tidak ditampilkan). Setelah warna dipilih, user menentukan JUMLAH roll
  // (stepper) -- code roll terpilih mengikuti urutan, dan bisa disesuaikan dengan centang manual.
  const warnaOptions = selectedGroup
    ? selectedGroup.rows
        .map((r) => ({ warna: r.warna, free: r.available - visibleLines.filter((l) => l.roll.warna === r.warna).length }))
        .filter((o) => o.free > 0)
    : [];
  const pickRow = selectedGroup && pickWarna ? selectedGroup.rows.find((r) => r.warna === pickWarna) : undefined;
  const pickCandidates =
    selectedGroup && pickWarna ? candidates.filter((c) => c.warna === pickWarna && c.lengan === selectedGroup.lengan && !visibleLines.some((l) => l.id === c.claimKey)) : [];
  const pickMax = pickRow ? Math.max(0, Math.min(pickCandidates.length, pickRow.available - visibleLines.filter((l) => l.roll.warna === pickWarna).length)) : 0;

  function openPick() {
    setPickOpen(true);
    setPickWarna(warnaOptions.length === 1 ? warnaOptions[0].warna : "");
    setPickChecked(new Set());
  }
  function closePick() {
    setPickOpen(false);
    setPickWarna("");
    setPickChecked(new Set());
  }
  function choosePickWarna(warna: string) {
    setPickWarna(warna);
    setPickChecked(new Set());
  }
  function setPickCount(n: number) {
    const count = Math.max(0, Math.min(pickMax, Math.floor(n) || 0));
    setPickChecked(new Set(pickCandidates.slice(0, count).map((c) => c.claimKey)));
  }
  function togglePick(key: string) {
    setPickChecked((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else if (next.size < pickMax) next.add(key);
      return next;
    });
  }
  function addPickedToList() {
    const picked = pickCandidates.filter((c) => pickChecked.has(c.claimKey));
    if (picked.length === 0) return;
    setLines((prev) => [
      ...prev.filter((l) => candidates.some((c) => c.claimKey === l.id)),
      ...picked.map((roll) => ({
        id: roll.claimKey,
        roll,
        // Default berat bersih = berat kotor invoice (sama seperti tahap timbang lama), tinggal
        // dikoreksi kalau timbangan fisik berbeda.
        netKg: roll.netKg ?? roll.grossKg,
        gramasi: fillGramasi,
        setting: fillSetting,
        codeRoll: roll.codeRoll,
      })),
    ]);
    closePick();
  }

  function updateLine(id: string, patch: Partial<RollLine>) {
    setLines((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  }
  function removeLine(id: string) {
    setLines((prev) => prev.filter((l) => l.id !== id));
  }
  function applyFillToAll() {
    setLines((prev) => prev.map((l) => ({ ...l, gramasi: fillGramasi > 0 ? fillGramasi : l.gramasi, setting: fillSetting.trim() ? fillSetting : l.setting })));
  }

  const claimableLines = visibleLines.filter((l) => weightVariance(l.roll.grossKg, l.netKg).claimable);
  const canRest = visibleLines.length > 0 && claimableLines.length === 0 && visibleLines.every((l) => l.netKg > 0);

  async function submitResting() {
    if (!selectedGroup || submitting || !canRest) return;
    setSubmitting(true);
    setRestingError(null);
    try {
      // 1) simpan berat bersih tiap roll (tahap timbang lama, sekarang bagian dari Resting) --
      // roll pengganti klaim boleh ganti code roll; roll lain code-nya tidak diubah.
      await Promise.all(
        visibleLines.map((l) =>
          receiveRawMaterialRoll(l.roll.invoiceId, l.roll.warna, l.roll.lengan, l.roll.rollIndex, l.netKg, undefined, l.roll.isReplacement ? l.codeRoll : undefined)
        )
      );
      // 2) buat batch resting -- waktu MULAI resting = saat tombol ini diklik (otomatis).
      const resolved = visibleLines.map((l) => {
        const row = selectedGroup.rows.find((r) => r.warna === l.roll.warna);
        return row ? { aduanRowId: row.id, gramasi: l.gramasi, codeRoll: l.roll.isReplacement ? l.codeRoll : l.roll.codeRoll, setting: l.setting } : null;
      });
      const validLines = resolved.filter((x): x is NonNullable<typeof x> => x !== null);
      if (validLines.length > 0) {
        await startProductionBatches({ mrpId: selectedMrpId, restingAt: new Date().toISOString(), lines: validLines });
      }
      setLines([]);
      setSelectedGroupKey("");
    } catch (e) {
      setRestingError(e instanceof Error ? e.message : "Gagal memulai resting.");
    } finally {
      setSubmitting(false);
    }
  }

  // ---- Dialog claim (per roll di List roll) ----
  const claimLine = claimLineId ? (visibleLines.find((l) => l.id === claimLineId) ?? null) : null;
  const claimVariance = claimLine ? weightVariance(claimLine.roll.grossKg, claimLine.netKg) : null;
  function openClaim(line: RollLine) {
    setClaimLineId(line.id);
    setClaimKind(weightVariance(line.roll.grossKg, line.netKg).claimable ? "BERAT" : "FISIK");
    setClaimNote("");
    setClaimError(null);
    resetClaimPhoto();
  }
  function closeClaim() {
    setClaimLineId(null);
    setClaimNote("");
    setClaimError(null);
    resetClaimPhoto();
  }
  function resetClaimPhoto() {
    setClaimPhotoDataUrl(null);
    setClaimPhotoFileName(undefined);
    setClaimPhotoError(null);
    setClaimPhotoBusy(false);
    if (claimPhotoInputRef.current) claimPhotoInputRef.current.value = "";
  }
  async function onClaimPhotoSelected(file: File) {
    setClaimPhotoError(null);
    setClaimPhotoBusy(true);
    try {
      const compressed = await compressImageToDataUrl(file);
      if (dataUrlApproxBytes(compressed) > MAX_CLAIM_PHOTO_BYTES) {
        setClaimPhotoError("Foto terlalu besar, ambil ulang dengan resolusi lebih kecil");
        setClaimPhotoDataUrl(null);
        return;
      }
      setClaimPhotoDataUrl(compressed);
      setClaimPhotoFileName(file.name);
    } catch (e) {
      setClaimPhotoError(e instanceof Error ? e.message : "Gagal memproses foto.");
    } finally {
      setClaimPhotoBusy(false);
    }
  }
  const claimTypeInvalid = claimKind === "BERAT" ? !claimVariance?.claimable : !claimNote.trim();
  async function submitClaim() {
    if (!claimLine || !claimPhotoDataUrl || claimTypeInvalid || claimSubmitting) return;
    setClaimSubmitting(true);
    setClaimError(null);
    const photo = { dataUrl: claimPhotoDataUrl, fileName: claimPhotoFileName };
    const r = claimLine.roll;
    try {
      if (claimKind === "BERAT" && claimVariance) {
        await receiveRawMaterialRoll(r.invoiceId, r.warna, r.lengan, r.rollIndex, claimLine.netKg, { diffKg: claimVariance.diff, pct: claimVariance.pct }, undefined, photo);
      } else {
        await submitRollDefectClaim([{ invoiceId: r.invoiceId, warna: r.warna, lengan: r.lengan, rollIndex: r.rollIndex, netKg: claimLine.netKg }], claimNote.trim(), photo);
      }
      removeLine(claimLine.id);
      closeClaim();
    } catch (e) {
      setClaimError(e instanceof Error ? e.message : "Gagal mengajukan claim.");
    } finally {
      setClaimSubmitting(false);
    }
  }

  const myBatches = productionBatches.filter((b) => b.vendorProduksi === vendorId);
  // Item 5: satu-satunya sumber "sesi resting" (Part) untuk tabel "Material dalam produksi" DAN
  // modal Input Hasil Cutting -- dihitung sekali di sini supaya keduanya selalu konsisten.
  const sessionGroups = restingSessionGroups(myBatches);

  // Buka modal "Input/Perbaiki/Edit Hasil Cutting" untuk SATU SESI RESTING ("Part"). `editAll=true`
  // (tombol "Edit ✎" pada sesi yang sudah selesai) membuka SEMUA roll sesi ini dengan nilai yang sudah
  // tersimpan. Alur input baru mulai KOSONG (tidak lagi terisi otomatis dengan target).
  function openCuttingGroupModal(sessionKey: string, editAll = false) {
    const session = sessionGroups.find((g) => g.key === sessionKey);
    const groupBatches = editAll ? (session?.batches ?? []) : (session?.batches ?? []).filter(batchNeedsCuttingInput);
    setCuttingSizeDraft((prev) => {
      const next = { ...prev };
      for (const b of groupBatches) next[b.id] = b.sizeQty ?? {};
      return next;
    });
    setCuttingGroupEditAll(editAll);
    setCuttingGroupError(null);
    setActiveCuttingGroupKey(sessionKey);
  }
  function closeCuttingGroupModal() {
    setActiveCuttingGroupKey(null);
    setCuttingGroupError(null);
    setCuttingGroupEditAll(false);
  }

  // Revisi 2026-09-19 (owner): tabel Aduan pola dibagi 2 (lengan PENDEK dulu, baru PANJANG), tanpa filter.
  // Tabel "Input Resting dan Cutting" TIDAK dibagi.
  // Revisi 2026-09-20 (owner: "pisah tabel panjang & pendek seperti di Good Receive"): tabel Aduan pola
  // ditampilkan per TAB lengan (satu tabel sekali tampil), default Pendek; kalau hanya ada Panjang ya Panjang.
  const lenganWithAduan = (["PENDEK", "PANJANG"] as const).filter((l) => groupList.some((g) => g.lengan === l));
  const activeLengan = lenganWithAduan.includes(aduanLengan) ? aduanLengan : lenganWithAduan[0];
  const visibleLengan = activeLengan ? [activeLengan] : [];
  const lenganTabsAduan = lenganWithAduan.map((l) => ({
    key: l,
    label: l === "PENDEK" ? "Lengan Pendek" : "Lengan Panjang",
    badge: groupList.filter((g) => g.lengan === l).reduce((sum, g) => sum + g.totalAvailable, 0),
  }));
  // Tabel "Input Resting dan Cutting" KOSONG sampai MRP dipilih.
  const scopedSessions = selectedMrpId ? sessionGroups.filter((g) => g.mrpId === selectedMrpId) : [];

  // Panel "List roll" untuk aduan pola terpilih -- dirender tepat di bawah tabel lengan-nya.
  const builderPanel = selectedGroup ? (
            <div className="border-t border-[#CFE0EF] bg-info-bg p-4">
              <div className="font-sans text-xs font-semibold text-info-fg">
                {selectedGroup.kode} · {selectedGroup.lengan} — roll yang akan di-resting
              </div>

              <div className="mt-2.5 flex flex-wrap items-end justify-between gap-2">
                <div className="flex items-center gap-3">
                  <div className="font-sans text-xs font-semibold text-info-fg">List roll ({visibleLines.length})</div>
                  <Button onClick={openPick} disabled={warnaOptions.length === 0} variant="primary" size="sm">
                    + Tambah roll
                  </Button>
                  {warnaOptions.length === 0 && <span className="font-sans text-[11px] text-text-muted">Tidak ada roll yang tersedia untuk aduan pola ini.</span>}
                </div>
                {visibleLines.length > 0 && (
                  <div className="flex flex-wrap items-end gap-2">
                    <div>
                      <div className="font-sans text-[10px] font-medium uppercase tracking-wider text-text-muted">Gramasi semua</div>
                      <NumberInput value={fillGramasi} onChange={setFillGramasi} decimals={0} className="input mt-0.5 w-[90px] text-right" />
                    </div>
                    <div>
                      <div className="font-sans text-[10px] font-medium uppercase tracking-wider text-text-muted">Setting semua</div>
                      <input value={fillSetting} onChange={(e) => setFillSetting(e.target.value)} placeholder="mis. lebar / heat setting" className="input mt-0.5 w-[170px]" />
                    </div>
                    <Button onClick={applyFillToAll} variant="accent" size="sm">
                      Terapkan ke semua
                    </Button>
                  </div>
                )}
              </div>

              <div className="mt-2 overflow-x-auto rounded-md border border-[#CFE0EF] bg-white">
                <div
                  className="grid min-w-[980px] gap-x-3 bg-[#F7F9FB] px-3 py-1.5 font-sans text-[10px] font-medium uppercase tracking-wider text-text-muted"
                  style={{ gridTemplateColumns: LIST_GRID }}
                >
                  <span>Warna</span>
                  <span>Code roll</span>
                  <span className="text-right">Berat kotor (kg)</span>
                  <span className="text-right">Berat bersih (kg)</span>
                  <span className="text-right">Selisih</span>
                  <span className="text-right">Gramasi (gsm)</span>
                  <span>Setting</span>
                  <span className="text-right">Aksi</span>
                </div>
                {visibleLines.length === 0 && (
                  <div className="px-3 py-4 text-center font-sans text-[11px] text-text-muted">Belum ada roll di list — klik &quot;+ Tambah roll&quot; untuk memilih warna dan jumlah roll.</div>
                )}
                {visibleLines.map((l) => {
                  const variance = weightVariance(l.roll.grossKg, l.netKg);
                  return (
                    <div key={l.id} className="grid min-w-[980px] items-center gap-x-3 border-t border-[#F1F4F7] px-3 py-1.5 font-sans text-xs text-[#31414F]" style={{ gridTemplateColumns: LIST_GRID }}>
                      <span className="font-medium">
                        {l.roll.warna}
                        {l.roll.isReplacement && <span className="ml-1.5 font-mono text-[10px] text-success-fg">(roll pengganti)</span>}
                      </span>
                      {l.roll.isReplacement ? (
                        <input
                          value={l.codeRoll}
                          onChange={(e) => updateLine(l.id, { codeRoll: e.target.value })}
                          placeholder="Code roll pengganti"
                          className="rounded-md border border-[#DDE4EB] px-1.5 py-1 font-mono text-[11px]"
                        />
                      ) : (
                        <span className="font-mono text-[11px]">{l.roll.codeRoll}</span>
                      )}
                      <span className="text-right font-mono">{formatDecimal(l.roll.grossKg)}</span>
                      <span className="flex justify-end">
                        <NumberInput value={l.netKg} decimals={2} onChange={(v) => updateLine(l.id, { netKg: v })} className="input w-[100px] text-right" />
                      </span>
                      <span className={"text-right font-mono text-[11px] " + (variance.claimable ? "text-danger-fg" : variance.withinTolerance ? "text-success-fg" : "text-warning-fg")}>
                        {variance.diff >= 0 ? "+" : ""}
                        {formatDecimal(variance.diff)} ({variance.pct.toFixed(1)}%)
                      </span>
                      <span className="flex justify-end">
                        <NumberInput value={l.gramasi} onChange={(v) => updateLine(l.id, { gramasi: v })} decimals={0} className="input w-[80px] text-right" />
                      </span>
                      <input value={l.setting} onChange={(e) => updateLine(l.id, { setting: e.target.value })} placeholder="Setting" className="rounded-md border border-[#DDE4EB] px-1.5 py-1 text-[11.5px]" />
                      <span className="flex justify-end gap-1.5">
                        <Button onClick={() => openClaim(l)} variant="danger" size="xs" title={variance.claimable ? "Selisih berat di luar toleransi -- ajukan claim" : "Ajukan claim (selisih berat / cacat fisik)"}>
                          {variance.claimable ? "Claim ⚠" : "Claim"}
                        </Button>
                        <Button onClick={() => removeLine(l.id)} variant="muted" size="xs">
                          Hapus
                        </Button>
                      </span>
                    </div>
                  );
                })}
              </div>

              {claimableLines.length > 0 && (
                <div className="mt-2.5 rounded-md border border-[#F0DFC2] bg-warning-bg px-3 py-2 font-sans text-[11px] leading-[1.5] text-warning-fg">
                  {claimableLines.length} roll selisih beratnya di luar toleransi (lebih ringan dari berat kotor). Ajukan Claim untuk roll itu, atau koreksi berat bersihnya, sebelum Resting.
                </div>
              )}
              {restingError && <div className="mt-2.5 rounded-md border border-danger bg-danger-bg px-3 py-2 font-sans text-[11px] leading-[1.5] text-danger-fg">{restingError}</div>}

              <div className="mt-3 flex items-center gap-2">
                <button
                  onClick={submitResting}
                  disabled={!canRest || submitting}
                  className="rounded-md bg-action-primary px-3.5 py-2 font-sans text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Resting ({visibleLines.length})
                </button>
                <button
                  onClick={() => {
                    setSelectedGroupKey("");
                    setLines([]);
                  }}
                  disabled={submitting}
                  className="rounded-md border border-[#CBD5DF] bg-white px-3.5 py-2 font-sans text-xs font-semibold text-action-primary disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Batal
                </button>
                <span className="font-sans text-[11px] text-text-muted">Waktu mulai resting dicatat otomatis saat tombol Resting diklik.</span>
              </div>
            </div>
  ) : null;

  return (
    <>
      <div className="rounded-lg border border-border-subtle bg-surface-card px-4 py-3.5">
        <div className="font-sans text-[11px] font-medium uppercase tracking-wider text-text-muted">Mulai Produksi — pilih MRP</div>
        <select
          value={selectedMrpId}
          onChange={(e) => pickMrp(e.target.value)}
          className="mt-1 w-full max-w-[420px] rounded-md border border-[#DDE4EB] px-[11px] py-[9px] font-sans text-[12.5px] font-medium text-text-primary"
        >
          <option value="">— pilih MRP —</option>
          {readyMrps.map((d) => (
            <option key={d.mrp.id} value={d.mrp.id}>
              {d.mrp.id}
              {pendingMarker(countCuttingAwaitingUpdateForMrp(d.mrp.id, vendorId, productionBatches, invoices, claimDicts, maklonPOs), "roll belum selesai")}
            </option>
          ))}
        </select>
        {readyMrps.length === 0 && <div className="mt-2 font-sans text-xs text-text-muted">Belum ada MRP dengan bahan siap dan pekerjaan belum selesai.</div>}
      </div>

      {selectedMrpId && claimRolls.length > 0 && (
        <button
          onClick={() => setClaimListOpen(true)}
          className="flex w-full items-center justify-between gap-3 rounded-lg border border-[#F0DFC2] bg-warning-bg px-4 py-2.5 text-left"
        >
          <span className="font-sans text-[13px] font-semibold text-warning-fg">Roll dalam proses klaim — {claimRolls.length} roll (terkunci)</span>
          <span className="font-sans text-[11px] font-semibold text-warning-fg underline">Lihat detail →</span>
        </button>
      )}

      {selectedDetail && (
        <div className="overflow-hidden rounded-lg border border-border-subtle bg-surface-card">
          <div className="border-b border-border-subtle px-4 py-3 font-sans text-[13px] font-semibold text-text-primary">Aduan pola — {selectedDetail.mrp.id}</div>
          <div className="px-4 py-2 font-sans text-[11px] leading-[1.5] text-info-fg bg-info-bg border-b border-[#CFE0EF]">
            Roll yang sudah diterima di Good Receive otomatis masuk di sini. Pilih aduan pola untuk melihat materialnya, lalu pilih warna &amp; roll yang akan di-resting.
          </div>
          {/* Tab lengan di dalam container tabel -- hanya kalau MRP ini punya aduan Pendek DAN Panjang. Badge = roll tersedia. */}
          {lenganTabsAduan.length > 1 && (
            <div className="border-b border-border-subtle px-4">
              <Tabs
                items={lenganTabsAduan}
                active={activeLengan ?? ""}
                onChange={(key) => {
                  setAduanLengan(key as "PENDEK" | "PANJANG");
                  // aduan pola terpilih di lengan lain ikut ditutup supaya panel List roll tidak "menggantung".
                  if (selectedGroup && selectedGroup.lengan !== key) {
                    setSelectedGroupKey("");
                    setLines([]);
                    closePick();
                  }
                }}
              />
            </div>
          )}
          {visibleLengan.map((len) => {
            const gl = groupList.filter((g) => g.lengan === len);
            return (
              <div key={len} className="border-b border-[#CFE0EF] last:border-b-0">
                <div className="grid grid-cols-6 gap-2 border-b-2 border-accent-blue bg-info-bg px-4 py-[9px] font-sans text-[10.5px] font-medium uppercase tracking-wider text-info-fg">
                  <span>Kode Aduan (Lengan {len === "PENDEK" ? "Pendek" : "Panjang"})</span>
                  <span className="text-right">Total roll aduan MRP</span>
                  <span className="text-right">Sudah diresting</span>
                  <span className="text-right">Total roll tersedia</span>
                  <span className="text-right">Belum diterima</span>
                  <span />
                </div>
                {gl.length === 0 && <div className="px-4 py-4 text-center font-sans text-xs text-text-muted">Tidak ada aduan pola lengan {len} di MRP ini.</div>}
                {gl.map((g) => {
                  const key = g.kode + "|" + g.lengan;
                  const isSel = selectedGroupKey === key;
                  return (
                    <div key={key} className={"grid grid-cols-6 items-center gap-2 border-b border-[#F1F4F7] px-4 py-[11px] font-sans text-xs text-[#31414F] last:border-b-0 " + (isSel ? "bg-[#F3F8FE]" : "")}>
                      <span className="font-mono font-medium">{g.kode}</span>
                      <span className="text-right font-mono font-semibold text-info-fg">{g.totalQty}</span>
                      <span className={"text-right font-mono " + (g.totalStarted > 0 ? "font-semibold text-success-fg" : "text-text-muted")}>{g.totalStarted}</span>
                      <span className={"text-right font-mono font-semibold " + (g.totalAvailable > 0 ? "text-info-fg" : "text-danger-fg")}>{g.totalAvailable}</span>
                      <span className={"text-right font-mono " + (g.totalMissing > 0 ? "font-semibold text-warning-fg" : "text-text-muted")}>{g.totalMissing}</span>
                      <span className="text-right">
                        <button
                          onClick={() => pickGroup(key)}
                          disabled={g.totalAvailable <= 0 && !isSel}
                          className="font-sans text-[11px] font-semibold text-action-primary disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          {isSel ? "Tutup ✕" : "Pilih"}
                        </button>
                      </span>
                    </div>
                  );
                })}
                {selectedGroup?.lengan === len && builderPanel}
              </div>
            );
          })}
        </div>
      )}

      <div className="overflow-hidden rounded-lg border border-border-subtle bg-surface-card">
        <div className="border-b border-border-subtle px-4 py-3 font-sans text-[13px] font-semibold text-text-primary">Input Resting dan Cutting</div>
        <div className="overflow-x-auto">
          {/* Revisi 2026-09-19: wrapper ini min-w-[1550px] -- header, baris grup, dan sub-tabel per-roll
              semua berbagi lebar yang SAMA sehingga latar/border-nya tidak terpotong saat digulir. */}
          <div className="min-w-[1550px]">
            {!selectedMrpId && (
              <div className="px-4 py-8 text-center font-sans text-xs text-text-muted">
                Pilih MRP di atas untuk menampilkan kode aduan, progres input resting &amp; cutting, dan riwayatnya.
              </div>
            )}
            {selectedMrpId && (
              <>
            <div
              className="grid min-w-[1550px] gap-x-5 border-b-2 border-accent-blue bg-info-bg px-4 py-[9px] font-sans text-[10.5px] font-medium uppercase tracking-wider text-info-fg"
              style={{ gridTemplateColumns: CUTTING_SESSION_COLUMNS }}
            >
              <span>MRP</span>
              <span>Kode Aduan</span>
              <span>Part</span>
              <span>Warna</span>
              <span className="text-right">Roll</span>
              <span>Resting</span>
              <span>Cutting</span>
              <span>Durasi Resting</span>
              <span>Status Resting</span>
              <span>Hasil Aduan / Yield</span>
              <span className="text-center">Detail</span>
            </div>
                    {scopedSessions.length === 0 && <div className="px-4 py-5 text-center font-sans text-xs text-text-muted">Belum ada batch produksi untuk MRP ini.</div>}
                    {scopedSessions.map((g) => {
              const isExpanded = expandedSessions.has(g.key);
              const detail = mrpDetails.find((d) => d.mrp.id === g.mrpId);
              const distinctWarna = Array.from(new Set(g.batches.map((b) => b.warna))).join(", ");
              const anyMissingCuttingAt = g.batches.some((b) => !b.cuttingAt);
              const anyNeedsInput = g.batches.some((b) => batchNeedsCuttingInput(b));
              const sessionComplete = !anyMissingCuttingAt && !anyNeedsInput;
              const cuttingAts = g.batches.map((b) => b.cuttingAt).filter((c): c is string => !!c);
              // "Kalau mereka pernah berbeda, tampilkan yang paling awal" (5.2) -- normalnya semua
              // identik karena saveGroup menyetempel SATU cuttingAt untuk semua batch di grup ini.
              const earliestCuttingAt = cuttingAts.length > 0 ? cuttingAts.reduce((min, c) => (Date.parse(c) < Date.parse(min) ? c : min)) : undefined;
              const durasiKurang = g.batches.some((b) => b.cuttingAt && restingMinutes(g.restingAt, b.cuttingAt) < RESTING_TARGET_MINUTES);
              const filledCount = g.batches.filter((b) => !!b.sizeQty).length;
              const totalTarget = g.batches.reduce((sum, b) => sum + Object.values(targetSizesForBatch(b, detail?.aduanRows ?? [])).reduce((a, c) => a + c, 0), 0);
              const totalActual = g.batches.reduce((sum, b) => sum + (b.sizeQty ? Object.values(b.sizeQty).reduce((a, c) => a + c, 0) : 0), 0);
              const groupYieldPct = filledCount === g.batches.length && totalTarget > 0 ? (totalActual / totalTarget) * 100 : null;
              const groupYieldAlert = groupYieldPct !== null && groupYieldPct < YIELD_ALERT_THRESHOLD_PCT;
              return (
                <div key={g.key} className="border-b border-[#F1F4F7] last:border-b-0">
                  <div className="grid min-w-[1550px] items-center gap-x-5 px-4 py-[11px] font-sans text-xs text-[#31414F]" style={{ gridTemplateColumns: CUTTING_SESSION_COLUMNS }}>
                    <span className="font-mono">{g.mrpId}</span>
                    <span className="font-mono font-medium">
                      {g.kode} · {g.lengan}
                    </span>
                    <span>
                      Part {g.partNo}
                      {g.partTotal > 1 && <span className="ml-1 font-mono text-[10px] text-text-muted">dari {g.partTotal}</span>}
                    </span>
                    <span>{distinctWarna}</span>
                    <span className="text-right font-mono">{g.batches.length}</span>
                    <span className="font-mono text-[11px]">{formatDateTime(g.restingAt)}</span>
                    <span className="font-mono text-[11px]">
                      {sessionComplete ? (
                        <span className="flex items-center gap-1.5">
                          {formatDateTime(earliestCuttingAt ?? g.restingAt)}
                          <button
                            onClick={() => openCuttingGroupModal(g.key, true)}
                            title="Edit hasil cutting sesi ini"
                            className="font-sans text-[10.5px] font-semibold text-action-primary underline"
                          >
                            Edit ✎
                          </button>
                        </span>
                      ) : (
                        <Button onClick={() => openCuttingGroupModal(g.key)} variant="primary" size="xs">
                          {anyMissingCuttingAt ? "Input Hasil Cutting →" : "Perbaiki Hasil Cutting →"}
                        </Button>
                      )}
                    </span>
                    <span className="font-mono text-[11px] text-text-muted">{formatDuration(g.restingAt, earliestCuttingAt ?? new Date().toISOString())}</span>
                    <span>{durasiKurang && <StatusPill tone="warning">RESTING KURANG DARI TARGET</StatusPill>}</span>
                    <span className="flex flex-col gap-0.5 font-mono text-[11px]">
                      {filledCount === 0 ? (
                        <span className="text-text-muted">Target: {totalTarget} pcs</span>
                      ) : filledCount < g.batches.length ? (
                        <span className="text-text-muted">
                          {filledCount}/{g.batches.length} roll terisi
                        </span>
                      ) : (
                        <span className="flex flex-wrap items-center gap-1">
                          <span>
                            {totalActual} / {totalTarget} pcs
                          </span>
                          {groupYieldPct !== null && <StatusPill tone={groupYieldAlert ? "danger" : "success"}>{groupYieldPct.toFixed(1)}%</StatusPill>}
                        </span>
                      )}
                    </span>
                    <span className="text-center">
                      <button onClick={() => toggleSessionExpanded(g.key)} className="font-sans text-[11px] font-semibold text-action-primary">
                        {isExpanded ? "Sembunyikan" : "Lihat roll →"}
                      </button>
                    </span>
                  </div>
                  {isExpanded && (
                    <div className="bg-[#FAFBFC]">
                      <div
                        className="grid min-w-[1550px] gap-x-3 border-y border-[#CFE0EF] bg-info-bg/60 px-8 py-[7px] font-sans text-[10px] font-medium uppercase tracking-wider text-info-fg"
                        style={{ gridTemplateColumns: CUTTING_BATCH_COLUMNS }}
                      >
                        <span>Warna</span>
                        <span>Code roll</span>
                        <span className="text-right">Gramasi</span>
                        <span>Setting</span>
                        <span>Cutting</span>
                        <span>Hasil Aduan / Yield</span>
                      </div>
                      {g.batches.map((b) => {
                        const targetSizes = targetSizesForBatch(b, detail?.aduanRows ?? []);
                        const targetTotal = Object.values(targetSizes).reduce((a, c) => a + c, 0);
                        const actualTotal = b.sizeQty ? Object.values(b.sizeQty).reduce((a, c) => a + c, 0) : 0;
                        const yieldPct = targetTotal > 0 && b.sizeQty ? (actualTotal / targetTotal) * 100 : null;
                        const yieldAlert = yieldPct !== null && yieldPct < YIELD_ALERT_THRESHOLD_PCT;
                        const sizesForDetail = Array.from(new Set([...Object.keys(targetSizes), ...Object.keys(b.sizeQty ?? {})]));
                        return (
                          <div
                            key={b.id}
                            className="grid min-w-[1550px] items-center gap-x-3 border-b border-[#F1F4F7] px-8 py-[9px] font-sans text-xs text-[#31414F] last:border-b-0"
                            style={{ gridTemplateColumns: CUTTING_BATCH_COLUMNS }}
                          >
                            <span>{b.warna}</span>
                            <span className="font-mono text-[11px]">{b.codeRoll || "—"}</span>
                            <span className="text-right font-mono">{b.gramasi} gsm</span>
                            <span className="text-[11.5px]">{b.setting || "—"}</span>
                            <span className="font-mono text-[11px]">{b.cuttingAt ? formatDateTime(b.cuttingAt) : "—"}</span>
                            <span className="flex flex-col gap-0.5 font-mono text-[11px]">
                              {b.cuttingAt ? (
                                b.sizeQty ? (
                                  <>
                                    <span className="flex flex-wrap items-center gap-1">
                                      <span>
                                        {actualTotal} / {targetTotal} pcs
                                      </span>
                                      {yieldPct !== null && <StatusPill tone={yieldAlert ? "danger" : "success"}>{yieldPct.toFixed(1)}%</StatusPill>}
                                    </span>
                                    {sizesForDetail.length > 0 && (
                                      <span className="text-[10px] text-text-muted">
                                        {sizesForDetail.map((size) => `${size} ${b.sizeQty?.[size] ?? 0}/${targetSizes[size] ?? 0}`).join(" · ")}
                                      </span>
                                    )}
                                  </>
                                ) : (
                                  <span className="text-text-muted">— (belum diisi)</span>
                                )
                              ) : (
                                <span className="text-text-muted">Target: {targetTotal} pcs</span>
                              )}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
                    })}
              </>
            )}
          </div>
        </div>
      </div>

      {/* Popup daftar roll dalam proses klaim -- dibuka dari baris ringkasan di atas. */}
      {claimListOpen && claimRolls.length > 0 && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0B131B]/45 p-4">
          <div className="flex max-h-[88vh] w-full max-w-[640px] flex-col rounded-lg bg-white shadow-[0_8px_24px_rgba(11,19,27,.2)]">
            <div className="border-b border-border-subtle px-5 py-3.5">
              <div className="font-sans text-[13px] font-semibold text-text-primary">Roll dalam proses klaim — {selectedMrpId}</div>
              <div className="mt-0.5 font-sans text-[11px] text-text-muted">{claimRolls.length} roll terkunci, tidak bisa dipilih untuk resting sampai klaimnya selesai.</div>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-3">
              {Array.from(new Set(claimRolls.map((x) => x.claim.warna + "|" + x.claim.lengan))).map((wk) => {
                const [warna, lengan] = wk.split("|");
                const items = claimRolls.filter((x) => x.claim.warna === warna && x.claim.lengan === lengan);
                return (
                  <div key={wk} className="mb-4 last:mb-0">
                    <div className="mb-1.5 flex items-center justify-between border-b border-[#F0DFC2] pb-1 font-sans text-[12px] font-semibold text-warning-fg">
                      <span>
                        {warna} · {lengan}
                      </span>
                      <span className="font-mono text-[10.5px] font-normal">{items.length} roll</span>
                    </div>
                    <div className="flex flex-col gap-2">
                      {items.map(({ claim, stage }) => (
                        <div key={claim.key} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-[#F0DFC2] bg-[#FFFBF3] px-3 py-2">
                          <div className="font-sans text-[11.5px] text-[#31414F]">
                            <span className="font-semibold">Roll {claim.rollIndex + 1}</span>{" "}
                            <span className="font-mono text-[10.5px] text-text-muted">{claim.codeRoll || "—"}</span>
                            <span className="ml-2 rounded bg-danger-bg px-1.5 py-px font-sans text-[10px] font-semibold text-danger-fg">{claim.reason === "FISIK" ? "CACAT FISIK" : "SELISIH BERAT"}</span>
                            <div className="mt-0.5 text-[11px] text-text-muted">{stageBanner(stage, claim.reason === "FISIK", materialClaimReturDeliveries[claim.key]?.note)}</div>
                          </div>
                          {stage === "RETUR_DIKIRIM" && (
                            <Button onClick={() => confirmMaterialClaimReturReceived(claim.key)} variant="primary" size="xs">
                              Tandai Diterima
                            </Button>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="flex justify-end border-t border-border-subtle px-5 py-3.5">
              <button onClick={() => setClaimListOpen(false)} className="rounded-md border border-[#CBD5DF] bg-white px-3.5 py-[7px] font-sans text-xs font-semibold text-action-primary">
                Tutup
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Popup form "Tambah roll" -- 1) pilih warna (hanya yang sudah diterima), 2) tentukan jumlah roll yang
          masuk tahap resting (ditimbang, dll di List roll). */}
      {pickOpen && selectedGroup && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0B131B]/45 p-4">
          <div className="flex max-h-[88vh] w-full max-w-[480px] flex-col rounded-lg bg-white shadow-[0_8px_24px_rgba(11,19,27,.2)]">
            <div className="border-b border-border-subtle px-5 py-3.5">
              <div className="font-sans text-[13px] font-semibold text-text-primary">Tambah roll ke resting</div>
              <div className="mt-0.5 font-sans text-[11px] text-text-muted">
                {selectedGroup.kode} · {selectedGroup.lengan}
              </div>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-4">
              <div className="font-sans text-[10.5px] font-medium uppercase tracking-wider text-text-muted">1. Pilih warna</div>
              <div className="mt-1.5 flex flex-wrap gap-2">
                {warnaOptions.map((o) => (
                  <button
                    key={o.warna}
                    onClick={() => choosePickWarna(o.warna)}
                    className={
                      "rounded-md border px-3 py-[7px] font-sans text-[11.5px] font-semibold " +
                      (pickWarna === o.warna ? "border-action-primary bg-action-primary text-white" : "border-[#CBD5DF] bg-white text-action-primary")
                    }
                  >
                    {o.warna} <span className="font-mono text-[10.5px] font-normal opacity-80">({o.free} roll)</span>
                  </button>
                ))}
              </div>

              {pickWarna && (
                <>
                  <div className="mt-4 font-sans text-[10.5px] font-medium uppercase tracking-wider text-text-muted">2. Jumlah roll yang dimasukkan</div>
                  <div className="mt-1.5 flex items-center gap-2">
                    <div className="flex items-stretch overflow-hidden rounded-md border border-[#DDE4EB]">
                      <button
                        type="button"
                        onClick={() => setPickCount(pickChecked.size - 1)}
                        disabled={pickChecked.size <= 0}
                        className="w-8 border-r border-[#DDE4EB] text-[11px] text-text-muted hover:bg-[#F2F4F7] disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        −
                      </button>
                      <input
                        value={pickChecked.size > 0 ? String(pickChecked.size) : ""}
                        onChange={(e) => setPickCount(parseInt(e.target.value.replace(/[^0-9]/g, ""), 10) || 0)}
                        inputMode="numeric"
                        placeholder="0"
                        className="w-14 px-1 py-1.5 text-center font-mono text-[13px] font-semibold outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => setPickCount(pickChecked.size + 1)}
                        disabled={pickChecked.size >= pickMax}
                        className="w-8 border-l border-[#DDE4EB] text-[11px] text-text-muted hover:bg-[#F2F4F7] disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        +
                      </button>
                    </div>
                    <Button onClick={() => setPickCount(pickMax)} disabled={pickMax <= 0} variant="accent" size="sm">
                      Semua ({pickMax})
                    </Button>
                    <span className="font-sans text-[11px] text-text-muted">maks {pickMax} roll</span>
                  </div>

                  <div className="mt-3 font-sans text-[10.5px] font-medium uppercase tracking-wider text-text-muted">Code roll terpilih (bisa disesuaikan)</div>
                  <div className="mt-1.5 flex flex-col gap-1.5">
                    {/* Hanya roll yang dialokasikan ke aduan pola ini (sebanyak kuota/pickMax) -- roll
                        sisa warna yang sama untuk aduan pola lain tidak ditampilkan di sini. */}
                    {pickCandidates.slice(0, pickMax).map((c) => {
                      const checked = pickChecked.has(c.claimKey);
                      const disabled = !checked && pickChecked.size >= pickMax;
                      return (
                        <label
                          key={c.claimKey}
                          className={
                            "flex items-center gap-2.5 rounded-md border px-3 py-1.5 font-sans text-xs " +
                            (checked ? "border-action-primary bg-[#F3F8FE]" : "border-[#E4E8EE] bg-white") +
                            (disabled ? " opacity-50" : " cursor-pointer")
                          }
                        >
                          <input type="checkbox" checked={checked} disabled={disabled} onChange={() => togglePick(c.claimKey)} className="h-3.5 w-3.5" />
                          <span className="font-mono font-medium">{c.codeRoll}</span>
                          <span className="ml-auto font-mono text-[10.5px] text-text-muted">
                            {formatDecimal(c.grossKg)} kg{c.isReplacement ? " · pengganti" : ""}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
            <div className="flex justify-end gap-2 border-t border-border-subtle px-5 py-3.5">
              <button onClick={closePick} className="rounded-md border border-[#CBD5DF] bg-white px-3.5 py-[7px] font-sans text-xs font-semibold text-action-primary">
                Batal
              </button>
              <Button onClick={addPickedToList} disabled={pickChecked.size === 0} variant="primary" size="md">
                Simpan ke list ({pickChecked.size})
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Dialog claim per roll (selisih berat / cacat fisik) -- foto bukti wajib. */}
      {claimLine && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0B131B]/45 p-4">
          <div className="w-full max-w-[470px] rounded-lg bg-white shadow-[0_8px_24px_rgba(11,19,27,.2)]">
            <div className="border-b border-danger-bg bg-danger-bg px-5 py-3.5">
              <span className="font-sans text-[13px] font-semibold text-danger-fg">
                Ajukan Claim — {claimLine.roll.warna} · {claimLine.roll.lengan} · {claimLine.roll.codeRoll}
              </span>
            </div>
            <div className="px-5 py-4">
              <div className="flex gap-2">
                <button
                  onClick={() => setClaimKind("BERAT")}
                  className={
                    "flex-1 rounded-md border px-3 py-2 text-left font-sans text-[11.5px] " +
                    (claimKind === "BERAT" ? "border-danger bg-danger-bg text-danger-fg" : "border-[#DDE4EB] bg-white text-text-muted")
                  }
                >
                  <div className="font-semibold">Selisih berat</div>
                  <div className="text-[10.5px]">
                    {claimVariance?.claimable
                      ? `${claimVariance.diff >= 0 ? "+" : ""}${formatDecimal(claimVariance.diff)} kg (${claimVariance.pct.toFixed(1)}%)`
                      : "Berat bersih masih dalam toleransi"}
                  </div>
                </button>
                <button
                  onClick={() => setClaimKind("FISIK")}
                  className={
                    "flex-1 rounded-md border px-3 py-2 text-left font-sans text-[11.5px] " +
                    (claimKind === "FISIK" ? "border-danger bg-danger-bg text-danger-fg" : "border-[#DDE4EB] bg-white text-text-muted")
                  }
                >
                  <div className="font-semibold">Cacat fisik</div>
                  <div className="text-[10.5px]">Shading, kotor, dll</div>
                </button>
              </div>
              {claimKind === "BERAT" && !claimVariance?.claimable && (
                <div className="mt-2 font-sans text-[11px] text-danger-fg">Claim selisih berat hanya bisa diajukan kalau berat bersih lebih ringan dari toleransi. Koreksi berat bersih dulu, atau pilih Cacat fisik.</div>
              )}
              {claimKind === "FISIK" && (
                <>
                  <div className="mt-3 font-sans text-[10.5px] font-medium uppercase tracking-wider text-text-muted">Keterangan cacat (wajib)</div>
                  <textarea
                    value={claimNote}
                    onChange={(e) => setClaimNote(e.target.value)}
                    placeholder="Contoh: warna belang/shading di bagian tengah roll, kain kotor terkena oli..."
                    rows={3}
                    className="input mt-1 w-full"
                  />
                </>
              )}
              <div className="mt-3 font-sans text-[10.5px] font-medium uppercase tracking-wider text-text-muted">
                Foto bukti — <span className="text-danger-fg">wajib</span>
              </div>
              <div className="mt-1.5 rounded-md border border-dashed border-[#CBD5DF] bg-[#FAFBFC] p-3">
                <input
                  ref={claimPhotoInputRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) onClaimPhotoSelected(file);
                  }}
                  className="input w-full file:mr-2.5 file:rounded file:border-0 file:bg-info-bg file:px-2.5 file:py-1 file:font-sans file:text-[11px] file:font-semibold file:text-info-fg"
                />
                {!claimPhotoDataUrl && !claimPhotoBusy && !claimPhotoError && <div className="mt-1.5 font-sans text-[11px] text-text-muted">Belum ada foto — wajib sebelum claim bisa dikirim.</div>}
                {claimPhotoBusy && <div className="mt-1.5 font-sans text-[11px] text-text-muted">Memproses foto…</div>}
                {claimPhotoError && <div className="mt-1.5 font-sans text-[11px] text-danger-fg">{claimPhotoError}</div>}
                {claimPhotoDataUrl && !claimPhotoBusy && !claimPhotoError && (
                  <div className="mt-1.5 flex items-center gap-2">
                    {/* eslint-disable-next-line @next/next/no-img-element -- preview data URI base64, bukan aset statis (lihat compressImageToDataUrl di atas) */}
                    <img src={claimPhotoDataUrl} alt="Foto bukti claim" className="h-16 w-16 rounded-md border border-[#E4E8EE] object-cover" />
                    <div className="font-sans text-[11px] text-success-fg">✓ {claimPhotoFileName} terupload.</div>
                  </div>
                )}
              </div>
              <div className="mt-2 font-sans text-[10.5px] text-text-muted">Roll yang diklaim langsung TERKUNCI dan keluar dari list sampai Procurement atur retur.</div>
              {claimError && <div className="mt-2 font-sans text-[11px] text-danger-fg">{claimError}</div>}
            </div>
            <div className="flex justify-end gap-2 border-t border-border-subtle px-5 py-3.5">
              <button onClick={closeClaim} className="rounded-md border border-[#CBD5DF] bg-white px-3.5 py-[7px] font-sans text-xs font-semibold text-action-primary">
                Batal
              </button>
              <button
                onClick={submitClaim}
                disabled={!claimPhotoDataUrl || claimPhotoBusy || claimTypeInvalid || claimSubmitting}
                className="rounded-md bg-danger px-3.5 py-[7px] font-sans text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                {claimSubmitting ? "Mengirim…" : "Ya, Kirim Claim"}
              </button>
            </div>
          </div>
        </div>
      )}

      {activeCuttingGroupKey &&
        (() => {
          // Modal di-scope ke SATU SESI RESTING ("Part") -- cari sesinya dari sessionGroups, lalu filter
          // roll yang masih butuh aksi (atau SEMUA roll di mode edit).
          const session = sessionGroups.find((g) => g.key === activeCuttingGroupKey);
          if (!session) return null;
          const { kode, lengan, partNo } = session;
          const groupBatches = cuttingGroupEditAll ? session.batches : session.batches.filter(batchNeedsCuttingInput);
          if (groupBatches.length === 0) return null;
          const byWarna = new Map<string, typeof groupBatches>();
          for (const b of groupBatches) byWarna.set(b.warna, [...(byWarna.get(b.warna) ?? []), b]);
          // Item 16.3: tidak bisa Simpan sampai SEMUA roll di modal ini punya minimal 1 size bukan-nol.
          const incompleteIds = groupBatches.filter((b) => Object.values(cuttingSizeDraft[b.id] ?? {}).every((v) => !v || v <= 0));
          const canSaveGroup = incompleteIds.length === 0;
          const modalDetail = mrpDetails.find((d) => d.mrp.id === session.mrpId);
          const grandTarget = groupBatches.reduce((sum, b) => sum + Object.values(targetSizesForBatch(b, modalDetail?.aduanRows ?? [])).reduce((a, c) => a + c, 0), 0);
          const grandActual = groupBatches.reduce((sum, b) => sum + Object.values(cuttingSizeDraft[b.id] ?? {}).reduce((a, c) => a + c, 0), 0);
          async function saveGroup() {
            if (!canSaveGroup) return;
            setCuttingGroupError(null);
            try {
              // Revisi 2026-09-19 (owner): waktu cutting dicatat OTOMATIS saat Simpan diklik (dari situ
              // durasi resting dihitung) -- tidak ada lagi input tanggal/jam manual, dan jam resting
              // tidak bisa diedit dari sini. Kalau semua roll di modal ini SUDAH pernah punya waktu
              // cutting (mode Edit/Perbaiki), waktu aslinya dipertahankan -- yang dikoreksi cuma qty.
              const existing = groupBatches.map((b) => b.cuttingAt).filter((c): c is string => !!c);
              const effectiveCuttingAt =
                existing.length === groupBatches.length ? existing.reduce((min, c) => (Date.parse(c) < Date.parse(min) ? c : min)) : new Date().toISOString();
              const sizeQtyByBatchId = Object.fromEntries(groupBatches.map((b) => [b.id, cuttingSizeDraft[b.id] ?? {}]));
              // Opsi A ("tidak ada loading, kerja di belakang layar"): updateBatchesToCutting SENGAJA
              // TIDAK di-`await` -- sudah optimistic penuh & meng-alert/revert sendiri kalau server
              // menolak (lihat store.ts), jadi `.catch()` di sini cuma bikin alert dobel.
              updateBatchesToCutting(
                groupBatches.map((b) => b.id),
                effectiveCuttingAt,
                sizeQtyByBatchId
              );
              closeCuttingGroupModal();
            } catch (err) {
              setCuttingGroupError(err instanceof Error ? err.message : "Gagal menyimpan hasil cutting.");
            }
          }
          return (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0B131B]/45 p-4">
              <div className="flex max-h-[90vh] w-full max-w-[760px] flex-col rounded-lg bg-white shadow-[0_8px_24px_rgba(11,19,27,.2)]">
                <div className="border-b border-border-subtle px-5 py-3.5">
                  <div className="font-sans text-[13px] font-semibold text-text-primary">
                    {cuttingGroupEditAll ? "Edit" : "Input"} Hasil Cutting — {kode} · {lengan} · Part {partNo}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 font-sans text-[11px] text-text-muted">
                    <span>
                      Mulai resting: <span className="font-mono font-semibold text-[#31414F]">{formatDateTime(session.restingAt)}</span>
                    </span>
                    <span>{groupBatches.length} roll</span>
                    <span>Waktu cutting dicatat otomatis saat Simpan</span>
                  </div>
                </div>
                <div className="flex-1 overflow-y-auto px-5 py-3">
                  {Array.from(byWarna.entries()).map(([warna, batches]) => (
                    <div key={warna} className="mb-4 last:mb-0">
                      <div className="mb-2 border-b border-[#CFE0EF] pb-1 font-sans text-[12px] font-semibold text-info-fg">{warna}</div>
                      <div className="flex flex-col gap-2.5">
                        {batches.map((b) => {
                          const targetSizes = targetSizesForBatch(b, modalDetail?.aduanRows ?? []);
                          const sizeDraft = cuttingSizeDraft[b.id] ?? {};
                          const sizes = Array.from(new Set([...Object.keys(targetSizes), ...Object.keys(b.sizeQty ?? {})]));
                          const targetTotal = Object.values(targetSizes).reduce((a, c) => a + c, 0);
                          const actualTotal = Object.values(sizeDraft).reduce((a, c) => a + c, 0);
                          const isIncomplete = incompleteIds.some((x) => x.id === b.id);
                          return (
                            <div key={b.id} className="rounded-md border border-[#E4E8EE] bg-[#FAFBFC] px-3 py-2.5">
                              <div className="mb-2 flex items-center justify-between gap-2">
                                <span className="font-mono text-[11.5px] font-semibold text-[#31414F]">{b.codeRoll || "—"}</span>
                                <span className="font-mono text-[11px] text-text-muted">
                                  {actualTotal} / {targetTotal} pcs
                                </span>
                              </div>
                              {sizes.length === 0 ? (
                                <span className="font-sans text-[11px] text-text-muted">Aduan pola untuk roll ini tidak punya rincian size.</span>
                              ) : (
                                <div className="grid grid-cols-[repeat(auto-fill,minmax(178px,1fr))] gap-2.5">
                                  {sizes.map((size) => (
                                    <SizeQtyControl
                                      key={size}
                                      size={size}
                                      max={targetSizes[size] ?? 0}
                                      value={sizeDraft[size] ?? 0}
                                      onChange={(v) => setCuttingSizeDraft((prev) => ({ ...prev, [b.id]: { ...(prev[b.id] ?? {}), [size]: v } }))}
                                    />
                                  ))}
                                </div>
                              )}
                              {isIncomplete && <div className="mt-1.5 font-sans text-[10.5px] text-danger-fg">Isi minimal satu size</div>}
                              {!isIncomplete && targetTotal > 0 && actualTotal / targetTotal < YIELD_ALERT_THRESHOLD_PCT / 100 && (
                                <div className="mt-1.5 font-sans text-[10.5px] text-danger-fg">
                                  Yield {((actualTotal / targetTotal) * 100).toFixed(1)}% — di bawah baseline {YIELD_ALERT_THRESHOLD_PCT}%, akan masuk alert yield ke portal Produksi.
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
                {cuttingGroupError && (
                  <div className="border-t border-[#F0DFC2] bg-danger-bg px-5 py-2.5 font-sans text-[11px] leading-[1.5] text-danger-fg">{cuttingGroupError}</div>
                )}
                <div className="flex items-center justify-between gap-2 border-t border-border-subtle px-5 py-3.5">
                  <span className="font-mono text-[11.5px] text-text-muted">
                    Total {grandActual} / {grandTarget} pcs
                  </span>
                  <div className="flex gap-2">
                    <button onClick={closeCuttingGroupModal} className="rounded-md border border-[#CBD5DF] bg-white px-3.5 py-[7px] font-sans text-xs font-semibold text-action-primary">
                      Batal
                    </button>
                    <Button onClick={saveGroup} disabled={!canSaveGroup} variant="success" size="sm">
                      Simpan
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          );
        })()}
    </>
  );
}
