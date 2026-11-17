"use client";

import { useEffect, useSyncExternalStore } from "react";
import { Moon, Sun } from "lucide-react";
import { THEME_KEY } from "@/lib/shell/theme";

/** Tombol mode terang / gelap (owner 2026-11-17). Memasang kelas `.dark` di <html>; pilihan disimpan per browser (localStorage `erp-theme`).
 *  Skrip kecil di app/layout.tsx memasang kelas yang sama sebelum halaman digambar, supaya tidak berkedip putih. */

function subscribe(cb: () => void) {
  const obs = new MutationObserver(cb);
  obs.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  return () => obs.disconnect();
}
const isDark = () => document.documentElement.classList.contains("dark");

export function ThemeToggle() {
  const dark = useSyncExternalStore(subscribe, isDark, () => false);
  function toggle() {
    const next = !isDark();
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem(THEME_KEY, next ? "dark" : "light");
    } catch {
      // Penyimpanan browser tidak tersedia: pilihan berlaku sampai halaman dimuat ulang.
    }
  }
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={dark ? "Ganti ke mode terang" : "Ganti ke mode gelap"}
      title={dark ? "Mode terang" : "Mode gelap"}
      className="flex h-9 w-9 flex-none items-center justify-center rounded-md text-text-muted hover:bg-[#F7F9FB] hover:text-text-primary"
    >
      {dark ? <Sun size={18} /> : <Moon size={18} />}
    </button>
  );
}

/** Portal Vendor Produksi selalu terang (tampilan HP vendor punya warnanya sendiri dan tidak didesain untuk gelap):
 *  selama shell vendor tampil, kelas `.dark` dilepas, lalu dipasang lagi kalau pilihan tersimpan memang gelap. */
export function useForceLightTheme(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const root = document.documentElement;
    root.classList.remove("dark");
    return () => {
      try {
        if (localStorage.getItem(THEME_KEY) === "dark") root.classList.add("dark");
      } catch {
        // abaikan
      }
    };
  }, [active]);
}
