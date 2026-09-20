"use client";

import { useEffect, useState } from "react";
import { AppShell } from "@/components/shell/app-shell";
import { StatusPill } from "@/components/ui/status-pill";
import { Button } from "@/components/ui/button";
import { VendorAuthGuard } from "@/components/mrp/vendor-auth-guard";
import { useMrpStore } from "@/lib/mrp/store";
import {
  addDays,
  formatDate,
  formatDecimal,
  formatPcs,
  invoiceBadge,
  materialReceivedForMaklon,
  mrpDetailFor,
  rollArrivalProgress,
  rollArrivalStatus,
  rollArrivalStatusBadge,
} from "@/lib/mrp/derive";
import { countGoodReceiveEligibleForMrp, pendingMarker } from "@/lib/shell/badges";
import { VENDOR_PRODUKSI } from "@/lib/mrp/seed";
import type { Lengan } from "@/lib/mrp/types";

type DraftCode = { codeRoll: string };

// Kolom kartu "Terima Material": Roll/Item | Code roll/Warna | Code lot | Berat | Status/Aksi (lebar tetap, rata kanan).
const RECEIVE_GRID = "minmax(80px,0.6fr) minmax(220px,2fr) minmax(80px,0.6fr) minmax(120px,0.8fr) 190px";

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

function randomLetters(n: number): string {
  let s = "";
  for (let i = 0; i < n; i++) s += LETTERS[Math.floor(Math.random() * LETTERS.length)];
  return s;
}

function randomDigits(n: number): string {
  let s = "";
  for (let i = 0; i < n; i++) s += Math.floor(Math.random() * 10);
  return s;
}

/** Format contoh: HSGU23492384 (4 huruf + 8 digit). */
function generateCodeRoll(taken: Set<string>): string {
  let code = "";
  do {
    code = randomLetters(4) + randomDigits(8);
  } while (taken.has(code));
  return code;
}

function ReceivingContent({ vendorId }: { vendorId: string }) {
  const invoices = useMrpStore((s) => s.invoices);
  const maklonPOs = useMrpStore((s) => s.maklonPOs);
  const mrpDetails = useMrpStore((s) => s.mrpDetails);
  const advanceMaklonProduction = useMrpStore((s) => s.advanceMaklonProduction);
  const markRollArrived = useMrpStore((s) => s.markRollArrived);
  const receiveRawMaterialAddBuy = useMrpStore((s) => s.receiveRawMaterialAddBuy);
  const receiveMaterialBatch = useMrpStore((s) => s.receiveMaterialBatch);

  const [selectedMrpId, setSelectedMrpId] = useState("");
  // Filter status PO material — default "Semua" (perilaku lama). Sengaja dipisah dari status
  // asli invoice ("DELIVERY"/"RECEIVING") supaya list yang sudah RECEIVING (biasanya jauh lebih
  // banyak) tidak menenggelamkan yang masih DELIVERY dan justru butuh dipantau/ditindaklanjuti.
  const [statusFilter, setStatusFilter] = useState<"ALL" | "DELIVERY" | "RECEIVING" | "PARSIAL">("ALL");
  const [selectedInvoiceId, setSelectedInvoiceId] = useState("");
  const [selectedColorKey, setSelectedColorKey] = useState("");
  const [draftCode, setDraftCode] = useState<Record<number, DraftCode>>({});
  // Item revisi 2026-09-18 (owner, Gambar 3) -- toggle "Pilih warna" chip row, lihat catatan
  // panjang di dekat pemakaiannya di bawah.
  const [showAllColors, setShowAllColors] = useState(false);

  const eligible = invoices.filter((i) => i.destinationVendor === vendorId && (i.status === "DELIVERY" || i.status === "RECEIVING"));
  // MRP tetap tampil di dropdown selama masih ada invoice DELIVERY atau RECEIVING (termasuk yang
  // sudah mulai diterima tapi belum semua roll-nya ditandai) — sebelumnya cuma DELIVERY, jadi MRP
  // hilang begitu roll pertama ditandai meski masih ada roll lain yang belum ditandai.
  const mrpIds = Array.from(new Set(eligible.map((i) => i.mrpId)));
  const mrpInvoicesAll = eligible.filter((i) => i.mrpId === selectedMrpId);
  const mrpInvoices =
    statusFilter === "ALL"
      ? mrpInvoicesAll
      : statusFilter === "PARSIAL"
        ? mrpInvoicesAll.filter((i) => rollArrivalStatus(i) === "PARSIAL")
        : mrpInvoicesAll.filter((i) => i.status === statusFilter);
  const deliveryCount = mrpInvoicesAll.filter((i) => i.status === "DELIVERY").length;
  const receivingCount = mrpInvoicesAll.filter((i) => i.status === "RECEIVING").length;
  const parsialCount = mrpInvoicesAll.filter((i) => rollArrivalStatus(i) === "PARSIAL").length;
  const selectedInvoice = eligible.find((i) => i.id === selectedInvoiceId) ?? null;
  // PO maklon untuk MRP ini yang masih menunggu bahan TAPI bahannya sudah mulai diterima —
  // aksi "Mulai Produksi" sengaja ditaruh di sini (bukan di PO Produksi Saya) supaya begitu
  // vendor selesai tandai roll diterima, langsung bisa lanjut produksi tanpa pindah halaman.
  const readyMaklonPOs = maklonPOs.filter(
    (p) =>
      p.mrpId === selectedMrpId &&
      p.vendorProduksi === vendorId &&
      (p.status === "FULL_WAITING_MATERIAL" || p.status === "PARTIAL_WAITING_MATERIAL") &&
      materialReceivedForMaklon(p.mrpId, p.vendorProduksi, invoices)
  );
  const colorOptions = selectedInvoice?.colorEntries ?? [];
  const selectedColor = colorOptions.find((c) => c.warna + "|" + c.lengan === selectedColorKey) ?? null;

  // Auto-generate Code Roll per roll (unik dalam batch ini) begitu warna dipilih — demi kebutuhan
  // simulasi supaya tidak perlu input manual. Tetap bisa diedit sebelum "Tandai diterima".
  // Ditandai berdasarkan rollArrivals (bukan rollReceipts lagi) — roll sudah dianggap "selesai di
  // sini" begitu ditandai diterima, tidak perlu menunggu ditimbang (itu di Cutting).
  // Item revisi 2026-09-08: Code Lot TIDAK LAGI di-auto-generate/diinput di sini — sudah diinput
  // Procurement saat Paying Voucher (ColorEntry.lots), ditampilkan read-only di tabel di bawah.
  useEffect(() => {
    if (!selectedColor || !selectedInvoice) return;
    setDraftCode((prev) => {
      const usedRoll = new Set(Object.values(prev).map((c) => c.codeRoll).filter(Boolean));
      const next = { ...prev };
      let changed = false;
      selectedColor.rolls.forEach((_, idx) => {
        const arrival = selectedInvoice.rollArrivals[selectedColorKey]?.[idx];
        if (arrival || next[idx]) return;
        const codeRoll = generateCodeRoll(usedRoll);
        usedRoll.add(codeRoll);
        next[idx] = { codeRoll };
        changed = true;
      });
      return changed ? next : prev;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedColorKey]);

  function pickMrp(mrpId: string) {
    setSelectedMrpId(mrpId);
    setSelectedInvoiceId("");
    setSelectedColorKey("");
    setDraftCode({});
  }

  // Item revisi 2026-09-18 (owner: "ganti redaksi 'Pilih' jadi 'Lihat Detail', bisa di-close lagi
  // tabelnya") -- dulu SELALU set selectedInvoiceId (sekali diklik, tidak bisa ditutup lagi selain
  // pindah pilih invoice lain). Sekarang toggle: klik baris yang SEDANG terbuka lagi -> tutup
  // (selectedInvoiceId dikosongkan), sama seperti pola expand/collapse baris di tabel lain.
  function pickInvoice(id: string) {
    if (selectedInvoiceId === id) {
      setSelectedInvoiceId("");
      setSelectedColorKey("");
      setDraftCode({});
      return;
    }
    setSelectedInvoiceId(id);
    const inv = eligible.find((i) => i.id === id);
    const first = inv?.colorEntries[0];
    setSelectedColorKey(first ? first.warna + "|" + first.lengan : "");
    setDraftCode({});
    setShowAllColors(false);
  }

  function pickColor(key: string) {
    setSelectedColorKey(key);
    setDraftCode({});
  }

  function markArrived(idx: number) {
    if (!selectedInvoice || !selectedColor) return;
    const code = draftCode[idx] ?? { codeRoll: "" };
    if (!code.codeRoll.trim()) return;
    markRollArrived(selectedInvoice.id, selectedColor.warna, selectedColor.lengan, idx, code.codeRoll.trim());
  }

  // Revisi 2026-09-19 (owner: "tabel terima material & tabel di atasnya ter-close begitu klik Mulai
  // Produksi"): detail PO + tabel Terima Material ditutup (sama seperti klik "Tutup detail") --
  // dipanggil SEBELUM aksinya (optimistic, PO langsung pindah status) supaya tidak ada jeda tampil.
  function startProduction(maklonPoId: string) {
    setSelectedInvoiceId("");
    setSelectedColorKey("");
    setDraftCode({});
    setShowAllColors(false);
    advanceMaklonProduction(maklonPoId);
  }

  // Revisi 2026-09-19 (owner: "simpan semua untuk roll dan simpan semua untuk item tambahan (Rib,
  // Kerah, Manset) dipisah"): dulu SATU tombol "Terima semua" menerima roll warna terpilih SEKALIGUS
  // semua item tambahan invoice ini (item tambahan dari warna-warna lain ikut tersimpan padahal
  // user cuma mau menerima roll 1 warna). Sekarang dua aksi terpisah:
  //   - receiveAllRolls: HANYA roll warna·lengan yang sedang dipilih;
  //   - receiveAllAddBuys: HANYA item tambahan invoice ini (tidak menyentuh roll).
  // Keduanya tetap 1 optimistic patch + 1 tulisan server (receiveMaterialBatch), tanpa flicker.
  const pendingRollIdx =
    selectedInvoice && selectedColor ? selectedColor.rolls.map((_, i) => i).filter((i) => !selectedInvoice.rollArrivals[selectedColorKey]?.[i]) : [];
  const pendingAddBuyIds = selectedInvoice ? selectedInvoice.addBuys.filter((b) => !selectedInvoice.addBuyReceipts[b.id]).map((b) => b.id) : [];
  // Code roll WAJIB terisi sebelum roll boleh diterima (Terima / Terima semua roll).
  const rollsMissingCode = pendingRollIdx.filter((i) => !draftCode[i]?.codeRoll?.trim());
  function receiveAllRolls() {
    if (!selectedInvoice || !selectedColor || pendingRollIdx.length === 0 || rollsMissingCode.length > 0) return;
    receiveMaterialBatch(
      selectedInvoice.id,
      selectedColor.warna,
      selectedColor.lengan,
      pendingRollIdx.map((i) => ({ rollIndex: i, codeRoll: draftCode[i]!.codeRoll.trim() })),
      []
    );
  }
  function receiveAllAddBuys() {
    if (!selectedInvoice || pendingAddBuyIds.length === 0) return;
    receiveMaterialBatch(selectedInvoice.id, "", "PENDEK", [], pendingAddBuyIds);
  }

  // Revisi 2026-09-19 (owner: "tidak bisa lanjut ke produksi kalau ada roll yang tidak diinput code
  // rollnya"): roll yang SUDAH diterima tapi code rollnya kosong (mis. data lama) -- "Mulai Produksi"
  // untuk MRP ini diblokir sampai semuanya punya code roll.
  function rollsWithoutCode(mrpId: string) {
    const out: { invoiceId: string; poId: string; warna: string; lengan: Lengan; idx: number }[] = [];
    for (const inv of invoices) {
      if (inv.mrpId !== mrpId || inv.destinationVendor !== vendorId) continue;
      for (const c of inv.colorEntries) {
        const key = c.warna + "|" + c.lengan;
        (inv.rollArrivals[key] ?? []).forEach((a, idx) => {
          if (a && !a.codeRoll?.trim()) out.push({ invoiceId: inv.id, poId: inv.poId, warna: c.warna, lengan: c.lengan, idx });
        });
      }
    }
    return out;
  }
  const [legacyCodeDraft, setLegacyCodeDraft] = useState<Record<string, string>>({});

  // Item revisi 2026-09-19: daftar "item diterima" untuk kartu Mulai Produksi -- dihitung dari roll
  // yang SUDAH ditandai diterima (semua invoice MRP ini ke vendor ini), dibandingkan rencana roll
  // dari aduan pola; estimasi pcs = qty aduan x (roll diterima / roll rencana).
  function receivedItemsFor(mrpId: string) {
    const aduan = mrpDetailFor(mrpId, mrpDetails)?.aduanRows.filter((a) => a.vendor === vendorId) ?? [];
    const map = new Map<string, { warna: string; lengan: string; arrived: number; invoiced: number }>();
    for (const inv of invoices) {
      if (inv.mrpId !== mrpId || inv.destinationVendor !== vendorId) continue;
      for (const c of inv.colorEntries) {
        const key = c.warna + "|" + c.lengan;
        const arrivals = inv.rollArrivals[key] ?? [];
        const g = map.get(key) ?? { warna: c.warna, lengan: c.lengan, arrived: 0, invoiced: 0 };
        g.invoiced += c.rolls.length;
        g.arrived += c.rolls.filter((_, i) => arrivals[i] != null).length;
        map.set(key, g);
      }
    }
    return Array.from(map.values())
      .filter((g) => g.arrived > 0)
      .map((g) => {
        const rows = aduan.filter((a) => a.warna === g.warna && a.lengan === g.lengan);
        const plannedRoll = rows.reduce((s, a) => s + a.qtyRoll, 0) || g.invoiced;
        const plannedPcs = rows.reduce((s, a) => s + a.qty, 0);
        const ratio = plannedRoll > 0 ? Math.min(1, g.arrived / plannedRoll) : 1;
        return { ...g, plannedRoll, estPcs: Math.round(plannedPcs * ratio) };
      })
      .sort((a, b) => a.warna.localeCompare(b.warna, "id-ID") || a.lengan.localeCompare(b.lengan));
  }

  // Item 2 (feedback batch 2026-09-07): status RECEIVING tidak bedakan "baru mulai" dari "sudah
  // sebagian roll masuk" -- begitu masih ada roll yang belum ditandai, tampilkan pill "PARSIAL"
  // (rollArrivalStatusBadge, sudah dipakai identik di Material Tracking Procurement) SEBAGAI
  // GANTI pill status invoice, tetap 1 pill sesuai keputusan owner sebelumnya (lihat komentar di
  // bawah) -- bukan pill tambahan.
  function invoiceStatusPill(i: (typeof eligible)[number]) {
    if (i.status === "RECEIVING" && rollArrivalStatus(i) === "PARSIAL") return rollArrivalStatusBadge("PARSIAL");
    return invoiceBadge(i.status);
  }

  return (
    <AppShell
      role="vendorMaklon"
      vendorId={vendorId}
      activeHref="/vendor-maklon/receiving"
      breadcrumb={["Dashboard", "Good Receive"]}
      title="Good Receive — Terima Material"
      roleOverride={VENDOR_PRODUKSI[vendorId]?.name ?? vendorId}
      entityOverride="Vendor Produksi"
    >
      <div className="rounded-lg border border-border-subtle bg-surface-card px-4 py-3.5">
        <div className="font-sans text-[11px] font-medium uppercase tracking-wider text-text-muted">Pilih MRP</div>
        <select
          value={selectedMrpId}
          onChange={(e) => pickMrp(e.target.value)}
          className="mt-1 w-full max-w-[420px] rounded-md border border-[#DDE4EB] px-[11px] py-[9px] font-sans text-[12.5px] font-medium text-text-primary"
        >
          <option value="">— pilih MRP —</option>
          {mrpIds.map((id) => (
            <option key={id} value={id}>
              {id} ({eligible.filter((i) => i.mrpId === id).length} PO)
              {pendingMarker(countGoodReceiveEligibleForMrp(id, vendorId, invoices), "PO belum lengkap diterima")}
            </option>
          ))}
        </select>
        {mrpIds.length === 0 && <div className="mt-2 font-sans text-xs text-text-muted">Belum ada bahan berstatus DELIVERY menuju vendor Anda.</div>}
      </div>

      {selectedMrpId && (
        <div className="overflow-hidden rounded-lg border border-border-subtle bg-surface-card">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border-subtle px-4 py-3">
            <span className="font-sans text-[13px] font-semibold text-text-primary">PO material — {selectedMrpId}</span>
            <div className="flex gap-1.5">
              {(
                [
                  { key: "ALL" as const, label: `Semua (${mrpInvoicesAll.length})` },
                  { key: "DELIVERY" as const, label: `Delivery (${deliveryCount})` },
                  { key: "RECEIVING" as const, label: `Receiving (${receivingCount})` },
                  { key: "PARSIAL" as const, label: `Parsial (${parsialCount})` },
                ]
              ).map((opt) => (
                <button
                  key={opt.key}
                  onClick={() => setStatusFilter(opt.key)}
                  className={
                    "rounded-md border px-2.5 py-[6px] font-sans text-[11px] font-semibold " +
                    (statusFilter === opt.key ? "border-action-primary bg-action-primary text-white" : "border-[#CBD5DF] bg-white text-action-primary")
                  }
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
          {/* Item revisi 2026-09-08 (owner: "Hilangkan saja untuk kolom warna" — terlalu padat
              untuk PO multi-warna, apalagi sekarang detail per-warna sudah ada di ringkasan roll
              + qty pendek/panjang begitu PO ini dipilih, lihat di bawah). */}
          <div className="grid grid-cols-8 gap-x-3 border-b border-border-subtle bg-[#F7F9FB] px-4 py-[9px] font-sans text-[10.5px] font-medium uppercase tracking-wider text-text-muted">
            <span>No PO</span>
            <span>Supplier</span>
            <span>Status</span>
            <span className="text-right">Roll diterima</span>
            <span>Tanggal Kirim</span>
            <span>Tanggal Terima</span>
            <span>Target Selesai Produksi</span>
            <span />
          </div>
          {mrpInvoices.length === 0 && (
            <div className="px-4 py-6 text-center font-sans text-xs text-text-muted">Tidak ada PO dengan status ini.</div>
          )}
          {mrpInvoices.map((i) => {
            const progress = rollArrivalProgress(i);
            return (
              <div key={i.id} className="grid grid-cols-8 items-center gap-x-3 border-b border-[#F1F4F7] px-4 py-[11px] font-sans text-xs text-[#31414F] last:border-b-0">
                <span className="font-mono font-medium">{i.poId}</span>
                <span>{i.supplier}</span>
                {/* Item revisi 2026-09-06: sebelumnya 2 pill (status invoice + status kedatangan
                    roll) tampil berdampingan di baris yang sama — dobel & membingungkan menurut
                    owner ("tidak perlu ada dua statusnya tampil, buat saja jadi satu"). Cukup 1
                    pill status invoice (DELIVERY/RECEIVING) yang jadi acuan alur PO; progres
                    kedatangan roll per-warna sudah cukup terwakili kolom "Roll diterima" di
                    sebelahnya (angka + warna teks). */}
                <span>
                  <StatusPill tone={invoiceStatusPill(i).tone}>{invoiceStatusPill(i).label}</StatusPill>
                </span>
                <span className={"text-right font-mono " + (progress.arrived < progress.total ? "text-warning-fg" : "text-success-fg")}>
                  {progress.arrived}/{progress.total} roll
                </span>
                <span className="font-mono text-[11px] text-text-muted">{formatDate(i.deliveredAt)}</span>
                <span className="font-mono text-[11px] text-text-muted">{formatDate(i.receivedAt)}</span>
                <span className="font-mono text-[11px] text-text-muted">
                  {i.receivedAt ? formatDate(addDays(i.receivedAt, VENDOR_PRODUKSI[vendorId]?.productionLeadDays ?? 7)) : "—"}
                </span>
                <span className="text-right">
                  <Button onClick={() => pickInvoice(i.id)} variant={selectedInvoiceId === i.id ? "muted" : "primary"} size="xs">
                    {selectedInvoiceId === i.id ? "Tutup detail ✕" : "Lihat Detail →"}
                  </Button>
                </span>
              </div>
            );
          })}
        </div>
      )}

      {selectedInvoice && (
        <>
          <div className="rounded-lg border border-border-subtle bg-surface-card px-4 py-3.5">
            <div className="flex items-center gap-2">
              <span className="font-sans text-[13px] font-semibold text-text-primary">{selectedInvoice.poId}</span>
              <StatusPill tone={invoiceStatusPill(selectedInvoice).tone}>{invoiceStatusPill(selectedInvoice).label}</StatusPill>
            </div>
            <div className="mt-1 font-sans text-xs text-text-muted">
              {selectedInvoice.supplier} · No. invoice supplier: {selectedInvoice.noInvoiceVendor || "—"}
            </div>
            {/* Item revisi 2026-09-08 (owner, Gambar 3: "buat untuk bisa select dropdown list mrp
                atau po jadi akan ada informasi detail warna yang diterima itu ada berapa roll,
                berapa qty totalnya untuk panjang dan pendek") -- ringkasan per warna: roll
                total/diterima + qty pendek/panjang (pcs) dari aduan pola MRP ini, vendor ini.
                Qty pendek/panjang murni informasi (dari aduan pola produksi, bukan dari roll
                material itu sendiri yang cuma dihitung dalam kg) -- bantu vendor tahu berapa
                banyak yang HARUS diproduksi dari warna ini begitu materialnya lengkap diterima. */}
            {colorOptions.length > 0 && (
              <div className="mt-3 overflow-hidden rounded-md border border-[#E4E8EE]">
                <div className="grid grid-cols-5 gap-x-2 bg-[#F2F4F7] px-3 py-1.5 font-sans text-[10px] font-medium uppercase tracking-wider text-text-muted">
                  <span>Warna</span>
                  <span className="text-right">Roll (diterima/total)</span>
                  <span className="text-right">Qty Pendek (pcs)</span>
                  <span className="text-right">Qty Panjang (pcs)</span>
                  {/* Item 7 (feedback batch 2026-09-10, owner: "Apa bisa ada nama header untuk
                     yang simbol centang itu? dan ada simbol yang menggambarkan kalau belum
                     diterima") -- dulu kolom ini tanpa label & KOSONG TOTAL sampai warna itu
                     lengkap diterima, jadi ✅-nya kesannya "muncul dari mana-mana". Sekarang ada
                     header "Status" + state awal eksplisit ("○ Belum") sebelum berubah jadi ✅. */}
                  <span className="text-right">Status</span>
                </div>
                {(() => {
                  const aduanRows = mrpDetailFor(selectedInvoice.mrpId, mrpDetails)?.aduanRows.filter((a) => a.vendor === vendorId) ?? [];
                  const warnaList = Array.from(new Set(colorOptions.map((c) => c.warna)));
                  return warnaList.map((warna) => {
                    const colorsForWarna = colorOptions.filter((c) => c.warna === warna);
                    const totalRoll = colorsForWarna.reduce((s, c) => s + c.rolls.length, 0);
                    const arrivedRoll = colorsForWarna.reduce((s, c) => {
                      const key = c.warna + "|" + c.lengan;
                      return s + c.rolls.filter((_, idx) => selectedInvoice.rollArrivals[key]?.[idx]).length;
                    }, 0);
                    const complete = totalRoll > 0 && arrivedRoll === totalRoll;
                    const qtyPendek = aduanRows.filter((a) => a.warna === warna && a.lengan === "PENDEK").reduce((s, a) => s + a.qty, 0);
                    const qtyPanjang = aduanRows.filter((a) => a.warna === warna && a.lengan === "PANJANG").reduce((s, a) => s + a.qty, 0);
                    return (
                      <div key={warna} className="grid grid-cols-5 items-center gap-x-2 border-t border-[#F1F4F7] px-3 py-1.5 font-sans text-[11.5px] text-[#31414F]">
                        <span className="font-medium">{warna}</span>
                        <span className={"text-right font-mono " + (complete ? "text-success-fg" : "")}>
                          {arrivedRoll}/{totalRoll}
                        </span>
                        <span className="text-right font-mono">{qtyPendek > 0 ? formatPcs(qtyPendek) : "—"}</span>
                        <span className="text-right font-mono">{qtyPanjang > 0 ? formatPcs(qtyPanjang) : "—"}</span>
                        <span className="flex justify-end">
                          {complete ? (
                            <span title="Semua roll warna ini sudah diterima">✅</span>
                          ) : (
                            <span className="text-text-muted" title="Belum semua roll warna ini diterima">
                              ○ Belum
                            </span>
                          )}
                        </span>
                      </div>
                    );
                  });
                })()}
              </div>
            )}

            {/* Item revisi 2026-09-18 (owner, Gambar 3: "apa bisa ini tidak ditampilkan semua? tapi
                user tetap bisa notice warna yang sudah/belum diterima") -- dulu SEMUA warna·lengan
                langsung tampil sekaligus (bisa puluhan chip untuk PO besar). Ringkasan per warna
                di atas (roll diterima/total + status ✅/○ Belum) sudah cukup untuk "notice" status
                tiap warna tanpa perlu chip row ini terbuka -- jadi sekarang chip di bawah DEFAULT
                cuma nampilkan yang MASIH BISA ditandai (belum lengkap & punya roll), warna yang
                sudah ✅ lengkap disembunyikan (masih kelihatan di ringkasan atas) sampai toggle
                "Tampilkan semua" diklik. Warna yang lagi dipilih (selectedColorKey) SELALU ikut
                tampil apa pun statusnya, supaya tidak tiba-tiba hilang dari layar begitu selesai
                ditandai lengkap. */}
            {(() => {
              const completeCount = colorOptions.filter((c) => {
                const key = c.warna + "|" + c.lengan;
                const arrivedCount = c.rolls.filter((_, idx) => selectedInvoice.rollArrivals[key]?.[idx]).length;
                return c.rolls.length > 0 && arrivedCount === c.rolls.length;
              }).length;
              const visibleColors = showAllColors
                ? colorOptions
                : colorOptions.filter((c) => {
                    const key = c.warna + "|" + c.lengan;
                    if (key === selectedColorKey) return true;
                    const arrivedCount = c.rolls.filter((_, idx) => selectedInvoice.rollArrivals[key]?.[idx]).length;
                    const complete = c.rolls.length > 0 && arrivedCount === c.rolls.length;
                    return !complete;
                  });
              return (
                <>
                  <div className="mt-3 flex items-center gap-2">
                    <span className="font-sans text-[11px] font-medium uppercase tracking-wider text-text-muted">Pilih warna</span>
                    {completeCount > 0 && (
                      <button onClick={() => setShowAllColors((v) => !v)} className="font-sans text-[10.5px] font-semibold text-action-primary underline">
                        {showAllColors ? "Sembunyikan yang sudah lengkap" : `Tampilkan semua (${completeCount} sudah lengkap)`}
                      </button>
                    )}
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-2">
                    {visibleColors.map((c) => {
                      const key = c.warna + "|" + c.lengan;
                      const arrivedCount = c.rolls.filter((_, idx) => selectedInvoice.rollArrivals[key]?.[idx]).length;
                      const complete = c.rolls.length > 0 && arrivedCount === c.rolls.length;
                      return (
                        <button
                          key={key}
                          onClick={() => pickColor(key)}
                          disabled={c.rolls.length === 0}
                          className={
                            "rounded-md border px-2.5 py-[6px] font-sans text-[11.5px] font-semibold disabled:cursor-not-allowed disabled:opacity-40 " +
                            (selectedColorKey === key ? "border-action-primary bg-action-primary text-white" : "border-[#CBD5DF] bg-white text-action-primary")
                          }
                        >
                          {/* Item revisi 2026-09-08 (owner, Gambar 4: "Tambahkan simbol atau icon centang
                              hijau pada card warna jika sudah lengkap untuk menandai roll sudah
                              diterima"). Item 7 (feedback batch 2026-09-10): tambah state awal eksplisit
                              ("○") sebelum lengkap, supaya ✅ tidak kesannya muncul tiba-tiba. */}
                          <span className="mr-1">{complete ? "✅" : "○"}</span>
                          {c.warna} · {c.lengan} ({arrivedCount}/{c.rolls.length} diterima)
                        </button>
                      );
                    })}
                  </div>
                </>
              );
            })()}
            {colorOptions.some((c) => c.rolls.length === 0) && (
              <div className="mt-2 font-sans text-[11px] text-text-muted">
                Warna dengan 0 roll belum ada data roll dari Procurement untuk invoice ini — tidak bisa ditandai diterima di sini.
              </div>
            )}
          </div>

          {(selectedColor || selectedInvoice.addBuys.length > 0) && (
            // Revisi 2026-09-20 (owner: "berantakan, susunan button tidak presisi, buat lebih simpel"):
            // kartu "Terima Material" disusun ulang jadi 2 bagian (Roll, Item Tambahan) yang berbagi
            // SATU grid kolom (RECEIVE_GRID) -- kolom Aksi lebar tetap & rata kanan, semua tombol
            // per baris seragam (lebar/tinggi sama), tombol "Terima semua" ada di bar judul tiap
            // bagian dengan ukuran yang sama.
            <div className="w-full overflow-hidden rounded-lg border border-border-subtle bg-surface-card">
              <div className="border-b border-border-subtle px-4 py-3 font-sans text-[13px] font-semibold text-text-primary">
                Terima Material{selectedColor ? ` — ${selectedColor.warna} · ${selectedColor.lengan}` : ""}
              </div>
              <div className="overflow-x-auto">
                <div className="min-w-[760px]">
                  {selectedColor && (
                    <>
                      <div className="flex items-center justify-between gap-3 border-b border-[#E4E8EE] bg-[#F7F9FB] px-4 py-2">
                        <span className="font-sans text-[12px] font-semibold text-text-primary">
                          Roll <span className="font-mono text-[11px] font-normal text-text-muted">({selectedColor.rolls.length - pendingRollIdx.length}/{selectedColor.rolls.length} diterima)</span>
                        </span>
                        {pendingRollIdx.length > 0 && (
                          <span className="flex items-center gap-3">
                            {rollsMissingCode.length > 0 && <span className="font-sans text-[11px] text-warning-fg">{rollsMissingCode.length} roll belum diisi code roll</span>}
                            <Button onClick={receiveAllRolls} disabled={rollsMissingCode.length > 0} variant="primary" size="sm" className="min-w-[170px]">
                              Terima semua roll ({pendingRollIdx.length})
                            </Button>
                          </span>
                        )}
                      </div>
                      <div
                        className="grid items-center gap-x-4 border-b-2 border-accent-blue bg-info-bg px-4 py-[8px] font-sans text-[10.5px] font-medium uppercase tracking-wider text-info-fg"
                        style={{ gridTemplateColumns: RECEIVE_GRID }}
                      >
                        <span>Roll</span>
                        <span>Code roll</span>
                        <span>Code lot</span>
                        <span className="text-right">Berat kotor (kg)</span>
                        <span className="text-right">Status</span>
                      </div>
                      {selectedColor.rolls.map((grossKg, idx) => {
                        const arrival = selectedInvoice.rollArrivals[selectedColorKey]?.[idx] ?? null;
                        const code = draftCode[idx] ?? { codeRoll: arrival?.codeRoll ?? "" };
                        // Code Lot murni informasi dari Procurement (diinput saat Paying Voucher, lihat
                        // ColorEntry.lots) — read-only di sini.
                        const codeLot = selectedColor.lots?.[idx]?.trim() || "";
                        return (
                          <div
                            key={idx}
                            className="grid items-center gap-x-4 border-b border-[#F1F4F7] px-4 py-2 font-sans text-xs text-[#31414F]"
                            style={{ gridTemplateColumns: RECEIVE_GRID }}
                          >
                            <span className="font-mono font-medium">Roll {idx + 1}</span>
                            {arrival ? (
                              <span className="font-mono text-[11px]">{arrival.codeRoll || "—"}</span>
                            ) : (
                              <input
                                value={code.codeRoll}
                                onChange={(e) => setDraftCode((prev) => ({ ...prev, [idx]: { ...code, codeRoll: e.target.value } }))}
                                className="input w-full max-w-[240px] !py-1.5 font-mono text-[11px]"
                                placeholder="Code roll"
                              />
                            )}
                            <span className="font-mono text-[11px] text-text-muted">{codeLot || "—"}</span>
                            <span className="text-right font-mono">{formatDecimal(grossKg)}</span>
                            <span className="flex items-center justify-end gap-2">
                              {arrival ? (
                                <>
                                  <span className="font-mono text-[11px] text-text-muted">{formatDate(arrival.arrivedAt)}</span>
                                  <StatusPill tone="success">Diterima</StatusPill>
                                </>
                              ) : (
                                <Button onClick={() => markArrived(idx)} disabled={!code.codeRoll.trim()} variant="accent" size="sm" className="w-[96px]">
                                  Terima
                                </Button>
                              )}
                            </span>
                          </div>
                        );
                      })}
                    </>
                  )}

                  {selectedInvoice.addBuys.length > 0 && (
                    <>
                      <div className={"flex items-center justify-between gap-3 border-b border-[#E4E8EE] bg-[#F7F9FB] px-4 py-2 " + (selectedColor ? "border-t border-t-[#E4E8EE]" : "")}>
                        <span className="font-sans text-[12px] font-semibold text-text-primary">
                          Item Tambahan <span className="text-[11px] font-normal text-text-muted">(Rib, Kerah, Manset)</span>
                        </span>
                        {pendingAddBuyIds.length > 0 && (
                          <Button onClick={receiveAllAddBuys} variant="primary" size="sm" className="min-w-[170px]">
                            Terima semua item ({pendingAddBuyIds.length})
                          </Button>
                        )}
                      </div>
                      <div
                        className="grid items-center gap-x-4 border-b-2 border-accent-blue bg-info-bg px-4 py-[8px] font-sans text-[10.5px] font-medium uppercase tracking-wider text-info-fg"
                        style={{ gridTemplateColumns: RECEIVE_GRID }}
                      >
                        <span>Item</span>
                        <span>Warna</span>
                        <span />
                        <span className="text-right">Berat (kg)</span>
                        <span className="text-right">Status</span>
                      </div>
                      {selectedInvoice.addBuys.map((b) => {
                        const receipt = selectedInvoice.addBuyReceipts[b.id];
                        return (
                          <div
                            key={b.id}
                            className="grid items-center gap-x-4 border-b border-[#F1F4F7] px-4 py-2 font-sans text-xs text-[#31414F] last:border-b-0"
                            style={{ gridTemplateColumns: RECEIVE_GRID }}
                          >
                            <span className="font-medium">{b.item}</span>
                            <span className="text-[11.5px] text-text-muted">{b.warna || "—"}</span>
                            <span />
                            <span className="text-right font-mono">{formatDecimal(b.beratKg)}</span>
                            <span className="flex items-center justify-end gap-2">
                              {receipt ? (
                                <>
                                  <span className="font-mono text-[11px] text-text-muted">{formatDate(receipt.receivedAt)}</span>
                                  <StatusPill tone="success">Diterima</StatusPill>
                                </>
                              ) : (
                                <Button onClick={() => receiveRawMaterialAddBuy(selectedInvoice.id, b.id)} variant="accent" size="sm" className="w-[96px]">
                                  Terima
                                </Button>
                              )}
                            </span>
                          </div>
                        );
                      })}
                    </>
                  )}
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {/* Item 8/9 (feedback batch 2026-09-10, owner: "container notif untuk mulai produksi
         mungkin ditempatkan dibagian paling bawah halaman") -- dipindah ke bawah (dulu di antara
         daftar PO material & detail invoice terpilih). Kondisi render TIDAK berubah -- begitu
         "Mulai Produksi" diklik, PO itu pindah status & otomatis hilang dari readyMaklonPOs. */}
      {readyMaklonPOs.length > 0 && (
        <div className="rounded-lg border border-[#B7DFC5] bg-success-bg px-5 py-4">
          <div className="font-sans text-[12.5px] font-semibold text-success-fg">Bahan sudah diterima — siap mulai produksi</div>
          {/* Revisi 2026-09-19 (owner, Gambar 2): yang dimulai produksi = bahan yang SUDAH DITERIMA
              saat ini (bukan seluruh PO) -- daftar item + estimasi pcs di bawah dihitung langsung dari
              roll yang sudah ditandai diterima (bertambah otomatis begitu material baru masuk). */}
          <div className="mt-2.5 flex flex-col gap-2">
            {readyMaklonPOs.map((p) => {
              const items = receivedItemsFor(p.mrpId);
              const estTotal = items.reduce((s, it) => s + it.estPcs, 0);
              const noCode = rollsWithoutCode(p.mrpId);
              return (
                <div key={p.id} className="overflow-hidden rounded-md border border-border-subtle bg-white">
                  <div className="flex items-center justify-between gap-3 px-3.5 py-2.5">
                    <span className="font-sans text-xs text-[#31414F]">
                      <span className="font-mono font-medium">{p.id}</span> — estimasi{" "}
                      <span className="font-semibold">{formatPcs(estTotal)} pcs</span> dari bahan diterima{" "}
                      <span className="text-text-muted">(total PO {formatPcs(p.qty)} pcs)</span>
                    </span>
                    <Button onClick={() => startProduction(p.id)} disabled={noCode.length > 0} variant="primary" size="xs">
                      Mulai Produksi →
                    </Button>
                  </div>
                  {noCode.length > 0 && (
                    <div className="border-t border-[#F0DFC2] bg-warning-bg px-3.5 py-2 font-sans text-[11px] text-warning-fg">
                      <div className="font-semibold">Belum bisa mulai produksi — {noCode.length} roll yang sudah diterima belum punya code roll. Isi dulu:</div>
                      <div className="mt-1.5 flex flex-col gap-1.5">
                        {noCode.map((r) => {
                          const k = r.invoiceId + "|" + r.warna + "|" + r.lengan + "|" + r.idx;
                          return (
                            <div key={k} className="flex flex-wrap items-center gap-2">
                              <span className="min-w-[260px]">
                                {r.warna} · {r.lengan} — Roll {r.idx + 1} <span className="font-mono text-[10px] text-text-muted">({r.poId})</span>
                              </span>
                              <input
                                value={legacyCodeDraft[k] ?? ""}
                                onChange={(e) => setLegacyCodeDraft((prev) => ({ ...prev, [k]: e.target.value }))}
                                className="input w-[180px] text-[11px]"
                                placeholder="Code roll"
                              />
                              <Button
                                onClick={() => markRollArrived(r.invoiceId, r.warna, r.lengan, r.idx, legacyCodeDraft[k]?.trim())}
                                disabled={!legacyCodeDraft[k]?.trim()}
                                variant="primary"
                                size="xs"
                              >
                                Simpan code
                              </Button>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                  {items.length > 0 && (
                    <table className="w-full table-fixed border-collapse border-t border-[#CFE0EF]">
                      <thead>
                        <tr className="border-b-2 border-accent-blue bg-info-bg font-sans text-[10px] font-medium uppercase tracking-wider text-info-fg">
                          <th className="px-3.5 py-1.5 text-left">Item diterima (warna · lengan)</th>
                          <th className="w-[22%] px-3 py-1.5 text-center">Roll diterima / rencana</th>
                          <th className="w-[22%] px-3 py-1.5 text-center">Estimasi (pcs)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {items.map((it) => (
                          <tr key={it.warna + "|" + it.lengan} className="border-b border-[#F1F4F7] font-sans text-[11.5px] text-[#31414F] last:border-b-0">
                            <td className="px-3.5 py-1.5 font-medium">
                              {it.warna} <span className="text-text-muted">· {it.lengan}</span>
                            </td>
                            <td className="px-3 py-1.5 text-center font-mono">
                              {it.arrived}/{it.plannedRoll}
                            </td>
                            <td className="px-3 py-1.5 text-center font-mono">{formatPcs(it.estPcs)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </AppShell>
  );
}

export default function VendorReceivingPage() {
  return <VendorAuthGuard>{(vendorId) => <ReceivingContent vendorId={vendorId} />}</VendorAuthGuard>;
}
