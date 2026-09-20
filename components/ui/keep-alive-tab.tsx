"use client";

import { useRef, type ReactNode } from "react";

// Panel sub-tab yang TIDAK di-unmount saat tab lain dipilih: konten baru dirender saat pertama kali
// aktif (lazy), lalu tetap mounted dan hanya disembunyikan (display:none). Hasilnya state lokal isi
// tab (MRP terpilih, filter, baris terbuka, dsb.) tetap ada waktu pindah-pindah sub-tab dan baru
// reset saat halaman di-reload. `contents` untuk tab aktif supaya layout induk (flex/gap) tidak berubah.
export function KeepAliveTab({ active, children }: { active: boolean; children: ReactNode }) {
  const visited = useRef(false);
  if (active) visited.current = true;
  if (!visited.current) return null;
  return <div className={active ? "contents" : "hidden"}>{children}</div>;
}
