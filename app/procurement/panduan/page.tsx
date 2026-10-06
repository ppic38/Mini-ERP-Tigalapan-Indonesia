"use client";

import { AppShell } from "@/components/shell/app-shell";
import { StatusPill } from "@/components/ui/status-pill";
import { FlowSteps, GuideSection, Legend, Marker, MockKpi, MockTable } from "@/components/guide/guide-kit";

/** Panduan modul Procurement (owner 2026-10-06: panduan per modul untuk user baru, visual, contoh
 *  pakai data dummy). SEMUA angka/nama di bawah ini karangan (MRP_DEMO, "Supplier Contoh", dst) dan
 *  ditulis langsung di file ini -- tidak membaca store/database, jadi aman dari data asli.
 *  Kalau halaman Procurement berubah, perbarui bagian terkait di sini. */
export default function ProcurementGuidePage() {
  return (
    <AppShell role="procurement" activeHref="/procurement/panduan" breadcrumb={["Dashboard", "Panduan"]} title="Panduan Procurement" subtitle="Penjelasan tiap halaman modul Procurement, lengkap dengan contoh tampilan (data dummy).">
      <div className="flex flex-col gap-4">
        <div className="rounded-lg border border-border-subtle bg-surface-card px-4 py-4">
          <div className="mb-3 font-sans text-[13px] font-semibold text-text-primary">Alur kerja Procurement dari awal sampai akhir</div>
          <FlowSteps
            steps={[
              { label: "MRP disetujui SCM", sub: "dari PPIC" },
              { label: "Buat PO", sub: "pilih vendor material" },
              { label: "Approval berjenjang", sub: "sesuai nilai PO" },
              { label: "Terbitkan Paying Voucher", sub: "invoice material" },
              { label: "Finance bayar", sub: "lalu atur Delivery" },
              { label: "Pantau & tangani klaim", sub: "selisih berat roll" },
            ]}
          />
          <p className="mt-3 font-sans text-[11.5px] leading-[1.5] text-text-muted">
            Klik tiap bagian di bawah untuk membuka penjelasan. Contoh tabel di dalamnya hanya ilustrasi — angka dan nama di sana bukan data sungguhan.
          </p>
        </div>

        <GuideSection
          defaultOpen
          title="Dashboard"
          href="/dashboard/procurement"
          purpose="Ringkasan pekerjaan yang sedang menunggu Anda. Mulai hari kerja dari sini."
          steps={[
            "Lihat empat kartu angka di bagian atas.",
            "Angka lebih dari 0 berarti ada pekerjaan yang perlu ditindak.",
            "Buka menu di sidebar yang sesuai dengan kartunya (Purchase Order, Paying Voucher, Klaim Material).",
          ]}
          mock={
            <>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <MockKpi label="MRP belum dibuatkan PO" value="2" sub="siap dibuatkan PO" marker={1} />
                <MockKpi label="Klaim material terbuka" value="1" sub="selisih berat di luar toleransi" marker={2} />
                <MockKpi label="PO menunggu invoice" value="3" sub="Rp 48.500.000" marker={3} />
                <MockKpi label="Invoice vendor menunggu review" value="0" sub="Rp 0" marker={4} />
              </div>
              <Legend
                items={[
                  "MRP dari PPIC yang sudah disetujui SCM tapi belum Anda buatkan PO → buka Purchase Order.",
                  "Roll yang beratnya selisih di luar batas toleransi → buka Klaim Material.",
                  "PO sudah disetujui tapi belum diterbitkan Paying Voucher-nya → buka Paying Voucher (Invoice).",
                  "Tagihan dari vendor produksi yang belum Anda review → buka Paying Voucher, tab Invoice Vendor.",
                ]}
              />
            </>
          }
        />

        <GuideSection
          title="Purchase Order"
          href="/procurement/po-approval"
          purpose="Tempat membuat PO dari MRP, memilih vendor material per warna, dan menyetujui PO level Procurement."
          steps={[
            "Pilih MRP di dropdown \"MRP tanpa PO\". Hanya MRP yang sudah disetujui SCM yang muncul.",
            "Pilih vendor material (supplier) untuk tiap warna. Boleh sebagian dulu.",
            "Klik \"Kirim PO ke Finance\". Kalau masih ada warna tanpa vendor, tombolnya berubah jadi \"(parsial)\".",
            "Pantau status PO di tab PO Material dan PO Produksi.",
            "Buka tab \"Approval PO Saya (Level 2)\" untuk menyetujui atau menolak PO yang menunggu persetujuan Procurement.",
          ]}
          mock={
            <>
              <MockTable
                columns={["Warna", "Roll", "Vendor material", "Status"]}
                align={["left", "right", "left", "left"]}
                rows={[
                  ["Hitam 24S", "7", <span key="a">Supplier Contoh A<Marker n={1} /></span>, <StatusPill key="s" tone="success">Terpilih</StatusPill>],
                  ["Cream 24S", "5", <span key="b">Supplier Contoh B<Marker n={1} /></span>, <StatusPill key="s" tone="success">Terpilih</StatusPill>],
                  ["Burgundy 24S", "4", <span key="c" className="text-text-muted">— belum dipilih —<Marker n={2} /></span>, <StatusPill key="s" tone="warning">Outstanding</StatusPill>],
                ]}
              />
              <Legend
                items={[
                  "Vendor material dipilih per warna. Satu PO dibuat per supplier.",
                  "Warna yang belum punya vendor ditandai outstanding. PO tetap bisa dikirim parsial, sisanya menyusul.",
                ]}
              />
            </>
          }
          tips={[
            "PO harus disetujui berjenjang sesuai nilainya: semakin besar nilai PO, semakin banyak level yang menyetujui (sampai General Manager).",
            "PO yang ditolak kembali ke Procurement untuk diperbaiki dan diajukan ulang.",
            "Riwayat approval menampilkan siapa yang menyetujui, jadi kalau akun Anda dipakai beberapa orang, pakai akun masing-masing.",
          ]}
        />

        <GuideSection
          title="Paying Voucher (Invoice)"
          href="/raw-material"
          purpose="Menerbitkan invoice material untuk PO yang sudah disetujui, dan mereview tagihan dari vendor produksi."
          steps={[
            "Di tab Invoice Material, pilih PO yang sudah disetujui lalu mulai buat invoice.",
            "Isi roll per warna: berat kotor tiap roll dan code lot (jika sudah ada).",
            "Tambahkan item tambahan (rib, kerah, manset) dan diskon bila ada.",
            "Upload bukti Paying Voucher (PDF). Tanpa bukti ini invoice tidak bisa diajukan.",
            "Ajukan invoice. Finance akan melakukan pembayaran.",
            "Di tab Invoice Vendor, review tagihan dari vendor produksi: setujui atau minta revisi.",
          ]}
          mock={
            <>
              <MockTable
                columns={["Roll", "Warna · Lengan", "Berat kotor (kg)", "Code lot"]}
                align={["left", "left", "right", "left"]}
                rows={[
                  ["Roll 1", "Hitam 24S · Panjang", "24,82", <span key="a" className="font-mono">LOT-DEMO-001</span>],
                  ["Roll 2", "Hitam 24S · Panjang", "25,01", <span key="b" className="font-mono">LOT-DEMO-001</span>],
                  ["Roll 3", "Hitam 24S · Pendek", "24,72", <span key="c" className="text-text-muted">— kosong<Marker n={1} /></span>],
                ]}
              />
              <Legend items={["Code lot boleh dikosongkan. Kalau kosong, vendor produksi bisa mengisinya saat menerima roll di Good Receive."]} />
            </>
          }
          tips={[
            "Berat kotor yang Anda isi di sini menjadi acuan saat vendor menimbang roll. Selisih di luar toleransi akan muncul sebagai klaim.",
            "Harga maklon dikunci saat invoice terbit, jadi perubahan harga di Master Data tidak mengubah invoice yang sudah ada.",
          ]}
        />

        <GuideSection
          title="Material Tracking"
          href="/procurement/material-tracking"
          purpose="Memantau invoice yang sudah dibayar Finance dan mengatur tanggal Delivery material ke vendor produksi."
          steps={[
            "Buka tab Material. Daftarnya hanya invoice yang sudah dibayar Finance.",
            "Angka merah di tab menunjukkan invoice yang belum diatur tanggal Delivery-nya.",
            "Atur tanggal Delivery per invoice. Satu PO yang ditagih bertahap boleh punya tanggal Delivery berbeda untuk tiap invoice.",
            "Pantau berapa roll yang sudah diterima vendor. Tab \"PO Produksi aktif\" untuk memantau PO produksi yang berjalan.",
          ]}
          mock={
            <>
              <MockTable
                columns={["No. invoice", "Status", "Delivery", "Roll diterima"]}
                align={["left", "left", "left", "right"]}
                rows={[
                  ["INV-DEMO-001", <StatusPill key="a" tone="success">Dibayar</StatusPill>, <span key="d" className="text-warning-fg">Belum diatur<Marker n={1} /></span>, "0/5"],
                  ["INV-DEMO-002", <StatusPill key="b" tone="info">Delivery</StatusPill>, "08/10/2026", "2/6"],
                  ["INV-DEMO-003", <StatusPill key="c" tone="success">Diterima</StatusPill>, "02/10/2026", <span key="e">7/7<Marker n={2} /></span>],
                ]}
              />
              <Legend items={["Invoice sudah dibayar tapi tanggal Delivery belum diatur → atur supaya vendor bisa menerima material.", "Semua roll sudah ditandai diterima oleh vendor produksi."]} />
            </>
          }
        />

        <GuideSection
          title="Klaim Material"
          href="/procurement/material-claims"
          purpose="Menangani roll yang beratnya selisih di luar toleransi setelah ditimbang vendor produksi."
          steps={[
            "Klaim muncul otomatis saat berat bersih roll menyimpang dari berat kotor di luar toleransi.",
            "Buka klaimnya, cek selisih berat dan foto bukti dari vendor.",
            "Putuskan tindak lanjutnya, misalnya terima klaim, buat Paying Voucher klaim, atau minta retur roll.",
            "Ikuti sampai statusnya \"Sudah ditindak\".",
          ]}
          mock={
            <>
              <MockTable
                columns={["No invoice", "Roll", "Berat kotor → bersih", "Selisih", "Status"]}
                align={["left", "left", "left", "right", "left"]}
                rows={[
                  ["INV-DEMO-004", "#2 · DEMO-R002", "25,00 → 23,10 kg", <span key="a" className="text-danger-fg">−1,90 kg<Marker n={1} /></span>, <StatusPill key="s" tone="warning">Belum ditindak</StatusPill>],
                  ["INV-DEMO-005", "#1 · DEMO-R010", "24,50 → 23,00 kg", <span key="b" className="text-danger-fg">−1,50 kg</span>, <StatusPill key="s2" tone="info">Retur diminta<Marker n={2} /></StatusPill>],
                ]}
              />
              <Legend items={["Selisih di luar toleransi → perlu keputusan Procurement.", "Retur sedang berjalan. Tahapnya: klaim diterima → PV dibuat → retur diminta → retur dikirim → retur diterima vendor → selesai."]} />
            </>
          }
        />

        <GuideSection
          title="Master Data"
          href="/procurement/master-data"
          purpose="Daftar referensi harga dan vendor yang dipakai untuk menghitung PO dan invoice."
          steps={[
            "Pilih tab sesuai data yang ingin dicek: Harga Maklon, Harga Kain, Harga RIB, Harga FOB, Ekspedisi, Kerah/Manset, atau Vendor & Supplier.",
            "Cek harga yang berlaku sebelum membuat PO atau invoice.",
            "Ubah hanya kalau harga memang berubah. Tab Vendor & Supplier dipakai untuk menambah atau mengubah data vendor dan supplier.",
          ]}
          mock={
            <>
              <MockTable
                columns={["Vendor", "Kategori", "Tier qty", "Harga / pcs"]}
                align={["left", "left", "left", "right"]}
                rows={[
                  ["Vendor Contoh A", "Kaos", "1 – 500 pcs", "Rp 12.000"],
                  ["Vendor Contoh A", "Kaos", "501 – 2.000 pcs", <span key="a">Rp 10.500<Marker n={1} /></span>],
                ]}
              />
              <Legend items={["Harga maklon bertingkat menurut jumlah pcs. Tier yang sesuai dengan qty PO yang dipakai."]} />
            </>
          }
          tips={["Perubahan harga hanya berlaku untuk invoice berikutnya. Invoice yang sudah terbit tidak ikut berubah."]}
        />
      </div>
    </AppShell>
  );
}
