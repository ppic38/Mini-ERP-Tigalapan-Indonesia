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

// Revisi 2026-09-20 (owner): item tambahan (Rib/Kerah/Manset) ikut terfilter per warna. Item yang warnanya
// kosong (mis. Bur/umum) dikelompokkan ke pilihan "Tanpa warna (umum)" memakai sentinel ini.
const NO_WARNA = "__TANPA_WARNA__";
const warnaLabel = (w: string) => (w === NO_WARNA ? "Tanpa warna (umum)" : w);

// Kolom kartu "Terima Material": Roll/Item | Code roll/Warna | Code lot | Berat | Status/Aksi (lebar tetap, rata kanan).
const RECEIVE_GRID = "minmax(80px,0.6fr) minmax(220px,2fr) minmax(80px,0.6fr) minmax(90px,0.5fr) minmax(120px,0.8fr) 190px";
const ROLL_PAGE_SIZE = 5;

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
  // Revisi 2026-09-23 (owner: "tidak usah dibagi jadi sub tab tipe lengan ... buat ada halaman-
  // halaman tabel"): dulu selectedColorKey = SATU lengan aktif (tab Pendek/Panjang, ganti-ganti).
  // Sekarang Pendek & Panjang tampil sekaligus sebagai 1 list roll gabungan (tidak ada tab lagi),
  // dipaginasi ROLL_PAGE_SIZE baris/halaman supaya tidak kepanjangan untuk warna dengan banyak roll.
  const [rollPage, setRollPage] = useState(0);
  // Revisi 2026-09-20 (owner): daftar "Pilih warna" digabung PER WARNA (bukan per warna·lengan) supaya
  // tidak panjang; kalau 1 warna punya 2 lengan, user memilih sub-tab lengannya (Pendek/Panjang) dulu
  // sebelum menerima bahan. selectedWarna = warna yang dibuka; selectedColorKey = warna|lengan aktif.
  const [selectedWarna, setSelectedWarna] = useState("");
  const [draftCode, setDraftCode] = useState<Record<string, DraftCode>>({});
  // Item revisi 2026-09-18 (owner, Gambar 3) -- toggle "Pilih warna" chip row, lihat catatan
  // panjang di dekat pemakaiannya di bawah.
  // Revisi 2026-09-23 (owner: "hilangkan tampilkan/sembunyikan, tapi ada filter di header status"):
  // boolean toggle DIGANTI filter 3-opsi (Semua / Belum lengkap / Lengkap), gaya sama seperti filter
  // Status PO material di atasnya (tombol berjajar, bukan link teks).
  const [colorStatusFilter, setColorStatusFilter] = useState<"ALL" | "BELUM" | "LENGKAP">("BELUM");
  const [colorWarnaQuery, setColorWarnaQuery] = useState("");

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
  const warnaColorEntries = colorOptions
    .filter((c) => c.warna === selectedWarna && c.rolls.length > 0)
    .sort((a, b) => (a.lengan === "PENDEK" ? 0 : 1) - (b.lengan === "PENDEK" ? 0 : 1));
  // Daftar roll GABUNGAN semua lengan warna ini, tiap baris tahu lengan asalnya sendiri.
  const combinedRolls = warnaColorEntries.flatMap((c) =>
    c.rolls.map((grossKg, idx) => ({ lengan: c.lengan, idx, grossKg, codeLot: c.lots?.[idx]?.trim() || "" }))
  );
  function rollKey(lengan: Lengan, idx: number): string {
    return lengan + "|" + idx;
  }
  function arrivalFor(lengan: Lengan, idx: number) {
    return selectedInvoice?.rollArrivals[selectedWarna + "|" + lengan]?.[idx] ?? null;
  }

  // Ringkasan per warna (roll diterima/total, qty pendek/panjang, status lengkap) -- dulu dihitung di
  // dalam IIFE render, sekarang di level komponen supaya dipakai bareng oleh filter Status di header
  // kartu invoice DAN tabel "Pilih warna" di bawahnya.
  const colorGroups = (() => {
    if (!selectedInvoice) return [];
    const aduanRows = mrpDetailFor(selectedInvoice.mrpId, mrpDetails)?.aduanRows.filter((a) => a.vendor === vendorId) ?? [];
    return warnaListFor(selectedInvoice).map((warna) => {
      const entries = colorOptions.filter((c) => c.warna === warna);
      const totalRoll = entries.reduce((sum, c) => sum + c.rolls.length, 0);
      const arrivedRoll = entries.reduce(
        (sum, c) => sum + c.rolls.filter((_, idx) => selectedInvoice.rollArrivals[c.warna + "|" + c.lengan]?.[idx]).length,
        0
      );
      const items = selectedInvoice.addBuys.filter((it) => (it.warna || NO_WARNA) === warna);
      const itemTotal = items.length;
      const itemReceived = items.filter((it) => selectedInvoice.addBuyReceipts[it.id]).length;
      const rollsDone = totalRoll === 0 || arrivedRoll === totalRoll;
      const itemsDone = itemTotal === 0 || itemReceived === itemTotal;
      const complete = (totalRoll > 0 || itemTotal > 0) && rollsDone && itemsDone;
      const qtyPendek = aduanRows.filter((a) => a.warna === warna && a.lengan === "PENDEK").reduce((s, a) => s + a.qty, 0);
      const qtyPanjang = aduanRows.filter((a) => a.warna === warna && a.lengan === "PANJANG").reduce((s, a) => s + a.qty, 0);
      return { warna, totalRoll, arrivedRoll, itemTotal, itemReceived, complete, qtyPendek, qtyPanjang };
    });
  })();
  const colorCompleteCount = colorGroups.filter((g) => g.complete).length;
  const colorBelumCount = colorGroups.length - colorCompleteCount;
  // Warna yang lagi dipilih SELALU ikut tampil apa pun filternya, supaya tidak tiba-tiba hilang dari
  // layar begitu selesai ditandai lengkap.
  const visibleColorGroups = colorGroups.filter((g) => {
    if (g.warna === selectedWarna) return true;
    if (colorWarnaQuery.trim() && !warnaLabel(g.warna).toLowerCase().includes(colorWarnaQuery.trim().toLowerCase())) return false;
    if (colorStatusFilter === "LENGKAP") return g.complete;
    if (colorStatusFilter === "BELUM") return !g.complete;
    return true;
  });
  // Revisi 2026-09-23 (owner: "buat untuk bisa diclose untuk tabel dibawahnya, Terima Material"):
  // menutup kartu "Terima Material" = kosongkan warna terpilih (kartu itu dipagari `selectedWarna`).
  function closeTerimaMaterial() {
    setSelectedWarna("");
    setDraftCode({});
    setRollPage(0);
  }

  // Auto-generate Code Roll per roll (unik dalam batch ini) begitu warna dipilih — demi kebutuhan
  // simulasi supaya tidak perlu input manual. Tetap bisa diedit sebelum "Tandai diterima".
  // Ditandai berdasarkan rollArrivals (bukan rollReceipts lagi) — roll sudah dianggap "selesai di
  // sini" begitu ditandai diterima, tidak perlu menunggu ditimbang (itu di Cutting).
  // Item revisi 2026-09-08: Code Lot TIDAK LAGI di-auto-generate/diinput di sini — sudah diinput
  // Procurement saat Paying Voucher (ColorEntry.lots), ditampilkan read-only di tabel di bawah.
  useEffect(() => {
    if (combinedRolls.length === 0 || !selectedInvoice) return;
    setDraftCode((prev) => {
      const usedRoll = new Set(Object.values(prev).map((c) => c.codeRoll).filter(Boolean));
      const next = { ...prev };
      let changed = false;
      for (const r of combinedRolls) {
        const key = rollKey(r.lengan, r.idx);
        if (arrivalFor(r.lengan, r.idx) || next[key]) continue;
        const codeRoll = generateCodeRoll(usedRoll);
        usedRoll.add(codeRoll);
        next[key] = { codeRoll };
        changed = true;
      }
      return changed ? next : prev;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedWarna]);

  function pickMrp(mrpId: string) {
    setSelectedMrpId(mrpId);
    setSelectedInvoiceId("");
    setSelectedWarna("");
    setDraftCode({});
    setRollPage(0);
  }

  // Item revisi 2026-09-18 (owner: "ganti redaksi 'Pilih' jadi 'Lihat Detail', bisa di-close lagi
  // tabelnya") -- dulu SELALU set selectedInvoiceId (sekali diklik, tidak bisa ditutup lagi selain
  // pindah pilih invoice lain). Sekarang toggle: klik baris yang SEDANG terbuka lagi -> tutup
  // (selectedInvoiceId dikosongkan), sama seperti pola expand/collapse baris di tabel lain.
  function pickInvoice(id: string) {
    if (selectedInvoiceId === id) {
      setSelectedInvoiceId("");
      setSelectedWarna("");
      setDraftCode({});
      setRollPage(0);
      return;
    }
    setSelectedInvoiceId(id);
    const inv = eligible.find((i) => i.id === id);
    // Warna pertama (gabungan warna roll + warna item tambahan) langsung terbuka dengan lengan
    // default-nya (Pendek dulu kalau ada, kalau tidak Panjang). Invoice yang cuma berisi item
    // tambahan (tanpa roll) tetap punya warna pertama dari item tambahannya.
    const firstWarna = inv ? warnaListFor(inv)[0] : undefined;
    setSelectedWarna(firstWarna ?? "");
    setDraftCode({});
    setRollPage(0);
    setColorStatusFilter("BELUM");
    setColorWarnaQuery("");
  }

  // Revisi 2026-09-20 (owner): TIDAK perlu klik lengan dulu -- begitu warna dipilih, tampilan pertama
  // langsung lengan PENDEK kalau warna itu punya Pendek & Panjang; kalau cuma Panjang ya Panjang.
  function warnaListFor(inv: { colorEntries: { warna: string }[]; addBuys: { warna: string }[] }): string[] {
    const list = Array.from(new Set(inv.colorEntries.map((c) => c.warna)));
    for (const b of inv.addBuys) {
      const w = b.warna || NO_WARNA;
      if (!list.includes(w)) list.push(w);
    }
    return list;
  }
  function pickWarna(warna: string) {
    if (selectedWarna === warna) {
      closeTerimaMaterial();
      return;
    }
    setSelectedWarna(warna);
    setDraftCode({});
    setRollPage(0);
  }

  function markArrived(lengan: Lengan, idx: number) {
    if (!selectedInvoice) return;
    const key = rollKey(lengan, idx);
    const code = draftCode[key] ?? { codeRoll: "" };
    if (!code.codeRoll.trim()) return;
    markRollArrived(selectedInvoice.id, selectedWarna, lengan, idx, code.codeRoll.trim());
  }

  // Revisi 2026-09-19 (owner: "tabel terima material & tabel di atasnya ter-close begitu klik Mulai
  // Produksi"): detail PO + tabel Terima Material ditutup (sama seperti klik "Tutup detail") --
  // dipanggil SEBELUM aksinya (optimistic, PO langsung pindah status) supaya tidak ada jeda tampil.
  function startProduction(maklonPoId: string) {
    setSelectedInvoiceId("");
    setSelectedWarna("");
    setDraftCode({});
    setRollPage(0);
    setColorStatusFilter("BELUM");
    setColorWarnaQuery("");
    advanceMaklonProduction(maklonPoId);
  }

  // Revisi 2026-09-19 (owner: "simpan semua untuk roll dan simpan semua untuk item tambahan (Rib,
  // Kerah, Manset) dipisah"): dulu SATU tombol "Terima semua" menerima roll warna terpilih SEKALIGUS
  // semua item tambahan invoice ini (item tambahan dari warna-warna lain ikut tersimpan padahal
  // user cuma mau menerima roll 1 warna). Sekarang dua aksi terpisah:
  //   - receiveAllRolls: HANYA roll warna·lengan yang sedang dipilih;
  //   - receiveAllAddBuys: HANYA item tambahan invoice ini (tidak menyentuh roll).
  // Keduanya tetap 1 optimistic patch + 1 tulisan server (receiveMaterialBatch), tanpa flicker.
  const pendingRolls = selectedInvoice ? combinedRolls.filter((r) => !arrivalFor(r.lengan, r.idx)) : [];
  // Item tambahan yang ditampilkan/diterima = HANYA yang warnanya cocok dengan warna terpilih.
  const selectedWarnaItems = selectedInvoice && selectedWarna ? selectedInvoice.addBuys.filter((b) => (b.warna || NO_WARNA) === selectedWarna) : [];
  const pendingAddBuyIds = selectedInvoice ? selectedWarnaItems.filter((b) => !selectedInvoice.addBuyReceipts[b.id]).map((b) => b.id) : [];
  // Code roll WAJIB terisi sebelum roll boleh diterima (Terima / Terima semua roll).
  const rollsMissingCode = pendingRolls.filter((r) => !draftCode[rollKey(r.lengan, r.idx)]?.codeRoll?.trim());
  function receiveAllRolls() {
    if (!selectedInvoice || pendingRolls.length === 0 || rollsMissingCode.length > 0) return;
    // Pendek & Panjang sekarang digabung 1 list -- receiveMaterialBatch tetap per LENGAN (kontrak
    // server tidak berubah), jadi dikelompokkan dulu lalu dikirim per grup.
    for (const c of warnaColorEntries) {
      const rollsForLengan = pendingRolls.filter((r) => r.lengan === c.lengan);
      if (rollsForLengan.length === 0) continue;
      receiveMaterialBatch(
        selectedInvoice.id,
        selectedWarna,
        c.lengan,
        rollsForLengan.map((r) => ({ rollIndex: r.idx, codeRoll: draftCode[rollKey(r.lengan, r.idx)]!.codeRoll.trim() })),
        []
      );
    }
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
          <div className="grid grid-cols-9 gap-x-3 border-b border-border-subtle bg-[#F7F9FB] px-4 py-[9px] font-sans text-[10.5px] font-medium uppercase tracking-wider text-text-muted">
            <span>No PO</span>
            <span>No. Invoice</span>
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
              <div key={i.id} className="grid grid-cols-9 items-center gap-x-3 border-b border-[#F1F4F7] px-4 py-[11px] font-sans text-xs text-[#31414F] last:border-b-0">
                <span className="font-mono font-medium">{i.poId}</span>
                {/* Revisi 2026-09-20 (owner): nomor invoice supplier yang diinput Procurement di Paying Voucher
                    disematkan di daftar PO material ini. */}
                <span className="break-all font-mono text-[11px]">{i.noInvoiceVendor || "—"}</span>
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
            {/* Revisi 2026-09-23 (owner: "yang ditabel PO-SUP-... apa tidak bisa diheader tabel
                ditempatkan filternya? jadi di header status dan warna itu ada filternya"): filter
                Status (Belum lengkap/Lengkap/Semua) + filter Warna (cari nama warna) DIPINDAH ke
                baris header kartu ini, berdampingan dengan No. PO + status pill PO-nya -- dulu ada
                bar "Pilih warna" terpisah di bawah, sekarang jadi satu baris header. */}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="font-sans text-[13px] font-semibold text-text-primary">{selectedInvoice.poId}</span>
                <StatusPill tone={invoiceStatusPill(selectedInvoice).tone}>{invoiceStatusPill(selectedInvoice).label}</StatusPill>
              </div>
              {colorGroups.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <input
                    value={colorWarnaQuery}
                    onChange={(e) => setColorWarnaQuery(e.target.value)}
                    placeholder="Cari warna…"
                    className="input h-[30px] w-[140px] !py-1 text-[11px]"
                  />
                  {(
                    [
                      { key: "BELUM" as const, label: `Belum lengkap (${colorBelumCount})` },
                      { key: "LENGKAP" as const, label: `Lengkap (${colorCompleteCount})` },
                      { key: "ALL" as const, label: `Semua (${colorGroups.length})` },
                    ]
                  ).map((opt) => (
                    <button
                      key={opt.key}
                      onClick={() => setColorStatusFilter(opt.key)}
                      className={
                        "rounded-md border px-2.5 py-[5px] font-sans text-[10.5px] font-semibold " +
                        (colorStatusFilter === opt.key ? "border-action-primary bg-action-primary text-white" : "border-[#CBD5DF] bg-white text-action-primary")
                      }
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="mt-1 font-sans text-xs text-text-muted">
              {selectedInvoice.supplier} · No. invoice supplier: {selectedInvoice.noInvoiceVendor || "—"}
            </div>
            {colorGroups.length === 0 ? null : (
              <div className="mt-3 overflow-hidden rounded-md border border-[#E4E8EE]">
                <div className="grid grid-cols-5 gap-x-2 border-b border-[#E4E8EE] bg-[#F7F9FB] px-3 py-1.5 font-sans text-[10px] font-medium uppercase tracking-wider text-text-muted">
                  <span>Warna</span>
                  <span className="text-right">Qty Pendek (pcs)</span>
                  <span className="text-right">Qty Panjang (pcs)</span>
                  <span className="text-right">Roll (diterima/total)</span>
                  {/* Item 7 (feedback batch 2026-09-10, owner: "Apa bisa ada nama header untuk
                     yang simbol centang itu? dan ada simbol yang menggambarkan kalau belum
                     diterima") -- dulu kolom ini tanpa label & KOSONG TOTAL sampai warna itu
                     lengkap diterima, jadi ✅-nya kesannya "muncul dari mana-mana". Sekarang ada
                     header "Status" + state awal eksplisit ("○ Belum") sebelum berubah jadi ✅. */}
                  <span className="text-right">Status</span>
                </div>
                {visibleColorGroups.map((g) => {
                  const active = selectedWarna === g.warna;
                  const disabled = g.totalRoll === 0 && g.itemTotal === 0;
                  return (
                    <button
                      key={g.warna}
                      type="button"
                      onClick={() => pickWarna(g.warna)}
                      disabled={disabled}
                      className={
                        "grid w-full grid-cols-5 items-center gap-x-2 border-t border-[#F1F4F7] px-3 py-1.5 text-left font-sans text-[11.5px] text-[#31414F] disabled:cursor-not-allowed disabled:opacity-50 " +
                        (active ? "bg-info-bg" : "hover:bg-[#FAFBFC]")
                      }
                    >
                      <span className={"font-medium " + (active ? "text-info-fg" : "")}>{warnaLabel(g.warna)}</span>
                      <span className="text-right font-mono">{g.qtyPendek > 0 ? formatPcs(g.qtyPendek) : "—"}</span>
                      <span className="text-right font-mono">{g.qtyPanjang > 0 ? formatPcs(g.qtyPanjang) : "—"}</span>
                      <span className={"text-right font-mono " + (g.complete ? "text-success-fg" : "")}>
                        {g.totalRoll > 0 ? `${g.arrivedRoll}/${g.totalRoll}` : "tanpa roll"}
                      </span>
                      <span className="flex justify-end">
                        {g.complete ? (
                          <span title="Semua roll/item warna ini sudah diterima">✅</span>
                        ) : (
                          <span className="text-text-muted" title="Belum semua roll/item warna ini diterima">
                            ○ Belum{g.itemTotal > 0 ? ` (${g.itemReceived}/${g.itemTotal} item)` : ""}
                          </span>
                        )}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
            {colorOptions.some((c) => c.rolls.length === 0) && (
              <div className="mt-2 font-sans text-[11px] text-text-muted">
                Warna dengan 0 roll belum ada data roll dari Procurement untuk invoice ini — tidak bisa ditandai diterima di sini.
              </div>
            )}
          </div>

          {(combinedRolls.length > 0 || selectedWarnaItems.length > 0) && (
            // Revisi 2026-09-20 (owner: "berantakan, susunan button tidak presisi, buat lebih simpel"):
            // kartu "Terima Material" disusun ulang jadi 2 bagian (Roll, Item Tambahan) yang berbagi
            // SATU grid kolom (RECEIVE_GRID) -- kolom Aksi lebar tetap & rata kanan, semua tombol
            // per baris seragam (lebar/tinggi sama), tombol "Terima semua" ada di bar judul tiap
            // bagian dengan ukuran yang sama.
            //
            // Revisi 2026-09-23 (owner: "tidak usah dibagi jadi sub tab tipe lengan ... karena ini
            // masih penerimaan bahan ... buat halaman-halaman tabel"): tab Pendek/Panjang DIHAPUS --
            // roll kedua lengan digabung jadi 1 list (kolom "Lengan" ditambah supaya tetap jelas
            // asalnya), dipaginasi ROLL_PAGE_SIZE baris/halaman.
            <div className="w-full overflow-hidden rounded-lg border border-border-subtle bg-surface-card">
              <div className="border-b border-border-subtle px-4 py-3 font-sans text-[13px] font-semibold text-text-primary">
                Terima Material
                {selectedWarna ? ` — ${warnaLabel(selectedWarna)}` : ""}
                {/* Revisi 2026-09-23 (owner: "untuk close dan open itu berdasarkan click list tabelnya
                    ... jika diklik lagi maka akan close tabelnya"): kartu ini ditutup dengan klik ULANG
                    baris warna yang sama di tabel "Pilih warna" (pickWarna toggle) -- tidak perlu
                    tombol tutup terpisah lagi. */}
              </div>
              <div className="overflow-x-auto">
                <div className="min-w-[820px]">
                  {combinedRolls.length > 0 && (() => {
                    const pageCount = Math.max(1, Math.ceil(combinedRolls.length / ROLL_PAGE_SIZE));
                    const page = Math.min(rollPage, pageCount - 1);
                    const pageRolls = combinedRolls.slice(page * ROLL_PAGE_SIZE, page * ROLL_PAGE_SIZE + ROLL_PAGE_SIZE);
                    return (
                    <>
                      <div className="flex items-center justify-between gap-3 border-b border-[#E4E8EE] bg-[#F7F9FB] px-4 py-2">
                        <span className="font-sans text-[12px] font-semibold text-text-primary">
                          Roll <span className="font-mono text-[11px] font-normal text-text-muted">({combinedRolls.length - pendingRolls.length}/{combinedRolls.length} diterima)</span>
                        </span>
                        {pendingRolls.length > 0 && (
                          <span className="flex items-center gap-3">
                            {rollsMissingCode.length > 0 && <span className="font-sans text-[11px] text-warning-fg">{rollsMissingCode.length} roll belum diisi code roll</span>}
                            <Button onClick={receiveAllRolls} disabled={rollsMissingCode.length > 0} variant="primary" size="sm" className="min-w-[170px]">
                              Terima semua roll ({pendingRolls.length})
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
                        <span>Lengan</span>
                        <span className="text-right">Berat kotor (kg)</span>
                        <span className="text-right">Status</span>
                      </div>
                      {pageRolls.map((r) => {
                        const key = rollKey(r.lengan, r.idx);
                        const arrival = arrivalFor(r.lengan, r.idx);
                        const code = draftCode[key] ?? { codeRoll: arrival?.codeRoll ?? "" };
                        return (
                          <div
                            key={key}
                            className="grid items-center gap-x-4 border-b border-[#F1F4F7] px-4 py-2 font-sans text-xs text-[#31414F]"
                            style={{ gridTemplateColumns: RECEIVE_GRID }}
                          >
                            <span className="font-mono font-medium">Roll {r.idx + 1}</span>
                            {arrival ? (
                              <span className="font-mono text-[11px]">{arrival.codeRoll || "—"}</span>
                            ) : (
                              <input
                                value={code.codeRoll}
                                onChange={(e) => setDraftCode((prev) => ({ ...prev, [key]: { ...code, codeRoll: e.target.value } }))}
                                className="input w-full max-w-[240px] !py-1.5 font-mono text-[11px]"
                                placeholder="Code roll"
                              />
                            )}
                            <span className="font-mono text-[11px] text-text-muted">{r.codeLot || "—"}</span>
                            <span className="text-[11px] text-text-muted">{r.lengan === "PENDEK" ? "Pendek" : "Panjang"}</span>
                            <span className="text-right font-mono">{formatDecimal(r.grossKg)}</span>
                            <span className="flex items-center justify-end gap-2">
                              {arrival ? (
                                <>
                                  <span className="font-mono text-[11px] text-text-muted">{formatDate(arrival.arrivedAt)}</span>
                                  <StatusPill tone="success">Diterima</StatusPill>
                                </>
                              ) : (
                                <Button onClick={() => markArrived(r.lengan, r.idx)} disabled={!code.codeRoll.trim()} variant="accent" size="sm" className="w-[96px]">
                                  Terima
                                </Button>
                              )}
                            </span>
                          </div>
                        );
                      })}
                      {pageCount > 1 && (
                        <div className="flex items-center justify-between gap-2 border-t border-[#F1F4F7] bg-[#FAFBFC] px-4 py-2 font-sans text-[11px] text-text-muted">
                          <span>
                            Halaman {page + 1} dari {pageCount} — {combinedRolls.length} roll total
                          </span>
                          <span className="flex items-center gap-1">
                            <button
                              onClick={() => setRollPage(Math.max(0, page - 1))}
                              disabled={page === 0}
                              className="rounded-md border border-[#CBD5DF] px-2.5 py-1 font-semibold text-action-primary disabled:cursor-not-allowed disabled:opacity-40"
                            >
                              ← Sebelumnya
                            </button>
                            {Array.from({ length: pageCount }, (_, i) => i).map((i) => (
                              <button
                                key={i}
                                onClick={() => setRollPage(i)}
                                className={
                                  "rounded-md border px-2.5 py-1 font-semibold " +
                                  (i === page ? "border-action-primary bg-action-primary text-white" : "border-[#CBD5DF] text-action-primary")
                                }
                              >
                                {i + 1}
                              </button>
                            ))}
                            <button
                              onClick={() => setRollPage(Math.min(pageCount - 1, page + 1))}
                              disabled={page >= pageCount - 1}
                              className="rounded-md border border-[#CBD5DF] px-2.5 py-1 font-semibold text-action-primary disabled:cursor-not-allowed disabled:opacity-40"
                            >
                              Berikutnya →
                            </button>
                          </span>
                        </div>
                      )}
                    </>
                    );
                  })()}

                  {selectedWarnaItems.length > 0 && (
                    <>
                      <div className={"flex items-center justify-between gap-3 border-b border-[#E4E8EE] bg-[#F7F9FB] px-4 py-2 " + (combinedRolls.length > 0 ? "border-t border-t-[#E4E8EE]" : "")}>
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
                      {selectedWarnaItems.map((b) => {
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
