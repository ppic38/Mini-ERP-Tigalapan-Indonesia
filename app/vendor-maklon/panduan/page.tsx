"use client";

import { useEffect, useState } from "react";
import { MessageCircle } from "lucide-react";
import { AppShell } from "@/components/shell/app-shell";
import { VendorAuthGuard } from "@/components/mrp/vendor-auth-guard";
import { VENDOR_PRODUKSI } from "@/lib/mrp/seed";
import { GuideMedia } from "@/components/guide/guide-media";
import { VENDOR_GUIDE_SECTIONS, type GuideItem } from "@/lib/guide/sections";
import { listGuideItemsAction } from "@/lib/mrp/guideActions";

const WHATSAPP_URL = "https://wa.me/6285395257703";
const PHONE_LABEL = "0853-9525-7703";

type Section = { key: string; title: string; intro?: string; steps: string[] };

/** Panduan penggunaan portal Vendor Produksi, urut sesuai menu di sidebar. Isinya ringkas dan mengikuti alur kerja yang
 *  sebenarnya; kalau halaman berubah, perbarui bagian yang terkait di sini. */
const SECTIONS: Section[] = [
  {
    key: "po-produksi",
    title: "1. PO Produksi Saya",
    intro: "Daftar PO produksi yang sudah disetujui dan ditujukan ke vendor Anda.",
    steps: [
      "Klik baris PO untuk melihat rincian per warna, lengan, dan size.",
      "Kolom Form Rasio (paling kanan): klik Excel untuk mengunduh tabel rasio PO, berisi qty per size, kebutuhan roll, aduan pola, rib, serta kerah dan manset, sehingga tidak perlu membuka satu per satu.",
      "Angka merah di menu sidebar menandakan PO baru yang belum Anda lihat.",
    ],
  },
  {
    key: "po-material",
    title: "2. PO Material Saya",
    intro: "Pantau material yang dikirim untuk PO Anda beserta status roll-nya.",
    steps: ["Lihat status tiap PO material: menunggu invoice, dibayar, dikirim, sampai roll diterima.", "Material yang sudah dikirim akan muncul di halaman Good Receive."],
  },
  {
    key: "good-receive",
    title: "3. Good Receive",
    intro: "Catat roll material yang benar-benar Anda terima.",
    steps: [
      "Pilih MRP, lalu tiap roll yang datang: isi Code Roll (wajib) dan Code Lot (opsional), kemudian klik Terima.",
      "Code Roll tidak boleh sama dengan roll lain. Sistem akan menolak dan memberi tahu kalau sudah dipakai.",
      "Kalau ada selisih berat atau cacat, ajukan klaim dari sini lengkap dengan foto.",
    ],
  },
  {
    key: "produksi",
    title: "4. Produksi",
    intro: "Terdiri dari beberapa tab sesuai tahap kerja.",
    steps: [
      "Cutting: pilih MRP, lalu pilih lengan (Pendek atau Panjang) dan kode aduan. Anda bebas memulai dari kode aduan yang mana saja.",
      "Klik + Tambah roll: pilih warna dulu (boleh lebih dari satu), tentukan jumlah roll, lalu pilih code roll yang dipakai. Roll dipakai bersama oleh semua kode aduan dengan warna yang sama, dan roll yang sudah diresting hilang dari daftar kode aduan lain.",
      "Di List roll, isi berat bersih tiap roll (gramasi dan setting boleh diisi sekalian atau pakai Gramasi semua), lalu klik Resting. Waktu mulai resting dicatat otomatis.",
      "Kalau ada masalah pada roll, klik Claim: pilih Selisih berat (berat bersih lebih ringan dari toleransi) atau Cacat fisik (wajib tulis keterangan). Foto bukti wajib. Roll yang diklaim terkunci dan keluar dari list.",
      "Setelah resting selesai, klik Input Hasil Cutting dan isi qty tiap size. Tombol Maks mengisi sebesar target, ▼ ▲ untuk kurang atau tambah satu. Waktu cutting dicatat otomatis saat Simpan. Klik Edit untuk memperbaiki hasil sebelum grup Selesai Produksi.",
      "Kalau sisa kain cukup untuk size yang lebih kecil, gunakan alih size di modal hasil cutting.",
      "Bila akun utama mengaktifkan persetujuan hasil cutting, hasil dari anggota tim yang kurang dari target menunggu persetujuan akun utama dulu sebelum Finish Good bisa diisi.",
      "Finish Good: isi hasil jadi per size (otomatis diisikan ke roll yang masih terbuka, mulai dari roll paling awal), lalu Tutup Roll kalau roll itu sudah selesai. Roll yang sudah ditutup siap masuk Pengiriman. Selesai Produksi pada grup warna menutup semua roll terbuka yang sudah punya Finish Good.",
      "Reject & Rework: sisa yang tidak jadi tercatat sebagai reject. Anda bisa memprosesnya menjadi rework di tab ini.",
      "Final Produksi: kunci grup warna setelah semua roll selesai. Buka kunci kalau masih perlu koreksi.",
    ],
  },
  {
    key: "pengiriman",
    title: "5. Pengiriman",
    intro: "Kemas Finish Good menjadi koli dan kirim.",
    steps: [
      "Buat koli: pilih MRP, isi No. Koli, lalu isi qty kirim tiap item. Sisa yang masih bisa dikirim tertera di sebelahnya.",
      "Set Ekspedisi & Resi: pilih koli yang sudah siap, isi ekspedisi, No. Resi, berat tiap koli, dan unggah foto lampiran (wajib).",
      "Begitu dikirim, Warehouse langsung melihat resinya untuk dibongkar.",
    ],
  },
  {
    key: "invoice-payment",
    title: "6. Invoice & Payment",
    intro: "Pantau penagihan Anda.",
    steps: ["Invoice dibuat dari data resi pengiriman yang sama, jadi tidak perlu mengetik ulang.", "Lihat status persetujuan dan pembayaran, termasuk penyesuaian denda atau reward kalau ada."],
  },
  {
    key: "tim-saya",
    title: "7. Tim Saya (khusus akun utama)",
    intro: "Kelola akun anggota tim Anda.",
    steps: [
      "Tambah anggota: isi username (tidak bisa diubah setelahnya), nama, dan password, lalu pilih halaman yang boleh mereka buka. Produksi bisa dipilih sampai tingkat tab.",
      "Ikon mata di kolom password untuk melihat password anggota, dan Edit untuk mengganti password atau izin.",
      "Saklar Persetujuan hasil cutting: aktifkan bila hasil cutting yang kurang dari target dari anggota tim perlu disetujui akun utama. Bawaannya mati.",
      "Riwayat Aksi menampilkan siapa mengerjakan apa.",
    ],
  },
  {
    key: "profil",
    title: "8. Profil Saya & akun",
    steps: [
      "Klik nama Anda di pojok kanan atas, lalu Profil Saya untuk mengganti password. Username dan nama tidak bisa diubah.",
      "Klik Logout dari menu yang sama setelah selesai bekerja, terutama di perangkat bersama.",
      "Ikon lonceng (Notifikasi) berisi pemberitahuan terbaru, misalnya PO baru, persetujuan cutting, atau perubahan status invoice.",
    ],
  },
  {
    key: "tips",
    title: "Tips bekerja bersama dalam satu tim",
    steps: [
      "Beberapa orang boleh bekerja bersamaan, tiap orang dengan akunnya sendiri.",
      "Kalau dua orang menyimpan roll yang sama, simpanan kedua ditolak dan data terbaru dimuat ulang supaya tidak saling menimpa. Periksa dulu lalu simpan lagi.",
      "Bisa dibuka dari HP: menu Produksi punya tombol ikon di bagian bawah layar untuk pindah antar tab.",
      "Aplikasi membutuhkan internet. Kalau gagal menyimpan akan muncul pemberitahuan, ulangi setelah tersambung.",
    ],
  },
];

function StepList({ steps }: { steps: string[] }) {
  if (steps.length === 0) return null;
  return (
    <ul className="flex list-disc flex-col gap-1.5 pl-5 font-sans text-[12.5px] leading-[1.55] text-[#31414F]">
      {steps.map((step) => (
        <li key={step}>{step}</li>
      ))}
    </ul>
  );
}

function MediaBlock({ items }: { items: GuideItem[] }) {
  if (items.length === 0) return null;
  return (
    <div className="mt-4 flex flex-col gap-4 border-t border-dashed border-border-subtle pt-3">
      {items.map((m) => (
        <GuideMedia key={m.id} item={m} />
      ))}
    </div>
  );
}

/** Nama sub-tab = judul media yang diberi Sysadmin, tanpa awalan "Tutorial Mini ERP - " (mis. "Proses Resting", "Pengajuan Claim"). */
function mediaTabLabel(m: GuideItem, index: number): string {
  const t = m.title.replace(/^Tutorial\s+Mini\s+ERP\s*[-\u2013\u2014:]\s*/i, "").trim();
  return t || `Media ${index + 1}`;
}

/** Satu media = tampil langsung. Dua media atau lebih dalam satu bagian = sub-tab, satu tab per media, supaya vendor
 *  memilih topik yang dicari (mis. Resting, Claim) tanpa menggulir semua video. */
function MediaTabs({ items }: { items: GuideItem[] }) {
  const [activeId, setActiveId] = useState<string | null>(null);
  if (items.length === 0) return null;
  if (items.length === 1) return <MediaBlock items={items} />;
  const active = items.find((m) => m.id === activeId) ?? items[0];
  return (
    <div className="mt-4 border-t border-dashed border-border-subtle pt-3">
      <div role="tablist" className="flex flex-wrap gap-1.5 border-b border-border-subtle">
        {items.map((m, i) => {
          const on = m.id === active.id;
          return (
            <button
              key={m.id}
              type="button"
              role="tab"
              aria-selected={on}
              onClick={() => setActiveId(m.id)}
              className={
                "-mb-px rounded-t-md border border-b-0 px-3.5 py-2 font-sans text-[12px] font-semibold " +
                (on ? "border-border-subtle bg-white text-action-primary" : "border-transparent text-text-muted hover:text-text-primary")
              }
            >
              {mediaTabLabel(m, i)}
            </button>
          );
        })}
      </div>
      <div role="tabpanel" className="pt-3">
        <GuideMedia key={active.id} item={active} />
      </div>
    </div>
  );
}

function PanduanContent({ vendorId }: { vendorId: string }) {
  // Media panduan (video/gambar/tautan) yang dikelola Sysadmin (migration 0073). Gagal memuat = halaman tetap tampil teks saja.
  const [media, setMedia] = useState<GuideItem[]>([]);
  useEffect(() => {
    void listGuideItemsAction("vendor").then((res) => {
      if (res.ok) setMedia(res.data);
    });
  }, []);
  const mediaFor = (key: string) => (VENDOR_GUIDE_SECTIONS.some((s) => s.key === key) ? media.filter((m) => m.sectionKey === key) : []);
  return (
    <AppShell
      role="vendorMaklon"
      vendorId={vendorId}
      activeHref="/vendor-maklon/panduan"
      breadcrumb={["Dashboard", "Panduan Penggunaan"]}
      title="Panduan Penggunaan"
      subtitle="Cara memakai portal Vendor Produksi, urut sesuai menu di sebelah kiri."
      roleOverride={VENDOR_PRODUKSI[vendorId]?.name ?? vendorId}
      entityOverride="Vendor Produksi"
    >
      <div className="flex flex-col gap-3">
        <a
          href={WHATSAPP_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-3 rounded-lg border border-border-subtle bg-surface-card px-4 py-3 hover:border-accent-blue"
        >
          <span className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-info-bg text-info-fg">
            <MessageCircle size={18} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block font-sans text-[13px] font-semibold text-text-primary">Ada kendala, saran, atau feedback?</span>
            <span className="block font-sans text-[11.5px] text-text-muted">Hubungi kami lewat WhatsApp di nomor {PHONE_LABEL}.</span>
          </span>
          <span className="font-mono text-[12px] font-semibold text-action-primary">{PHONE_LABEL}</span>
        </a>

        {SECTIONS.map((s, i) => (
          <details key={s.key} open={i === 0} className="group overflow-hidden rounded-lg border border-border-subtle bg-surface-card">
            <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 font-sans text-[13px] font-semibold text-text-primary marker:hidden [&::-webkit-details-marker]:hidden">
              <span className="flex-1">{s.title}</span>
              <span className="font-sans text-[11px] font-medium text-text-muted group-open:hidden">Buka</span>
              <span className="hidden font-sans text-[11px] font-medium text-text-muted group-open:inline">Tutup</span>
            </summary>
            <div className="border-t border-border-subtle px-4 py-3">
              {s.intro && <p className="mb-2 font-sans text-[12.5px] text-text-muted">{s.intro}</p>}
              <StepList steps={s.steps} />
              <MediaTabs items={mediaFor(s.key)} />
            </div>
          </details>
        ))}
      </div>
    </AppShell>
  );
}

export default function VendorPanduanPage() {
  return <VendorAuthGuard>{(vendorId) => <PanduanContent vendorId={vendorId} />}</VendorAuthGuard>;
}
