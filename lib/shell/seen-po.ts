"use client";

import { useEffect, useMemo, useSyncExternalStore } from "react";

// Revisi 2026-09-19 (owner: "badge PO Produksi Saya & PO Material Saya, hilang begitu halamannya
// diklik sekali"): kedua halaman itu 100% monitoring, jadi tidak ada "pekerjaan pending" yang bisa
// dihitung seperti badge lain (lib/shell/badges.ts) -- yang dihitung di sini PO yang BELUM PERNAH
// dilihat vendor. Daftar ID PO yang sudah dilihat disimpan di localStorage (per vendor, per
// halaman), BUKAN di Supabase: tidak perlu migration baru, konsekuensinya status "sudah dilihat"
// per browser/perangkat -- login dari perangkat lain akan melihat badge lagi sekali.

const EVENT = "seen-po-changed";

export function seenPoKey(vendorId: string | undefined, page: "po-produksi" | "po-material") {
  return `seen-po:${page}:${vendorId ?? ""}`;
}

function readRaw(key: string): string {
  try {
    return window.localStorage.getItem(key) ?? "[]";
  } catch {
    return "[]";
  }
}

function subscribe(cb: () => void) {
  window.addEventListener(EVENT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(EVENT, cb);
    window.removeEventListener("storage", cb);
  };
}

/** ID PO yang sudah pernah dilihat user di halaman `key`. */
export function useSeenPoIds(key: string): Set<string> {
  const raw = useSyncExternalStore(
    subscribe,
    () => readRaw(key),
    () => "[]"
  );
  return useMemo(() => {
    try {
      const parsed = JSON.parse(raw);
      return new Set<string>(Array.isArray(parsed) ? parsed : []);
    } catch {
      return new Set<string>();
    }
  }, [raw]);
}

/** Tandai semua `ids` sebagai sudah dilihat -- dipanggil dari halaman yang bersangkutan (jalan
 *  lagi kalau ada PO baru masuk selagi user masih membuka halamannya). */
export function useMarkPoSeen(key: string, ids: string[]) {
  const idsKey = ids.join("|");
  useEffect(() => {
    if (ids.length === 0) return;
    try {
      const seen = new Set<string>(JSON.parse(readRaw(key)));
      if (ids.every((id) => seen.has(id))) return;
      ids.forEach((id) => seen.add(id));
      window.localStorage.setItem(key, JSON.stringify([...seen]));
      window.dispatchEvent(new Event(EVENT));
    } catch {
      // localStorage tidak tersedia (mode privat dsb.) -- badge sekadar tidak bisa dihilangkan.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, idsKey]);
}
