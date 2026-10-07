"use client";

import { useState } from "react";
import { Bell, Menu } from "lucide-react";
import type { Notification } from "@/lib/mrp/types";

// Revisi 2026-09-19 (owner: "untuk sementara notifikasi di semua modul di-hide"): tombol
// Notifikasi di topbar disembunyikan di SEMUA halaman.
// Revisi 2026-09-23 (owner: "tambahkan kembali fitur notifikasi tapi hanya di modul vendor
// produksi"): sekarang dikontrol per pemanggilan lewat prop `showNotifications` (AppShell
// mengisinya `role === "vendorMaklon"`) -- modul internal (PPIC/Procurement/Finance/dst) tetap
// tersembunyi seperti sebelumnya.

function formatNotifTime(time: string) {
  return time;
}

/** "PPIC" -> "PP", "Maklon BAYU" -> "MB", "Procurement" -> "PR" — dipakai buat avatar profil,
 *  karena app ini belum punya sistem akun per-nama sungguhan (cuma login per-role/per-vendor). */
function initialsFor(name: string): string {
  // Label topbar bisa "Produksi · Gusti Zulkarnain" (modul · nama akun bernama). Dulu dipecah per
  // spasi sehingga kata ke-2 = "·" dan avatar jadi "P·". Sekarang pakai bagian SETELAH "·" (orangnya)
  // dan buang token yang bukan huruf/angka.
  const label = name.includes("·") ? name.split("·").slice(1).join(" ") : name;
  const parts = label.trim().split(/\s+/).filter((p) => /[\p{L}\p{N}]/u.test(p));
  if (parts.length === 0) return name.trim().slice(0, 2).toUpperCase();
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return parts[0].slice(0, 2).toUpperCase();
}

export function Topbar({
  role,
  entity,
  notifications = [],
  onMarkRead,
  onMarkAllRead,
  onDismiss,
  onLogout,
  onOpenProfile,
  showNotifications = false,
  onOpenMenu,
}: {
  /** Tombol hamburger (hanya tampil < lg) untuk membuka sidebar yang jadi laci di layar kecil. */
  onOpenMenu?: () => void;
  role: string;
  entity: string;
  notifications?: Notification[];
  onMarkRead?: (id: string) => void;
  onMarkAllRead?: () => void;
  onDismiss?: (id: string) => void;
  onLogout?: () => void;
  onOpenProfile?: () => void;
  showNotifications?: boolean;
}) {
  const [notifOpen, setNotifOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const unreadCount = notifications.filter((n) => !n.read).length;

  return (
    <div className="flex h-[52px] flex-none items-center gap-2.5 border-b border-border-subtle bg-surface-card px-3 sm:gap-[14px] sm:px-[22px]">
      {onOpenMenu && (
        <button type="button" onClick={onOpenMenu} aria-label="Buka menu" className="-ml-1 flex h-9 w-9 flex-none items-center justify-center rounded-md text-text-primary hover:bg-[#F7F9FB] lg:hidden">
          <Menu size={20} />
        </button>
      )}
      {/* Nama peran/vendor sudah ada di tombol profil (kanan); di HP cukup satu kali supaya tidak sempit. */}
      <div className="hidden truncate font-sans text-[13px] font-semibold text-text-primary sm:block">{role}</div>
      <div className="ml-auto flex min-w-0 items-center gap-2.5 sm:gap-[14px]">
        {showNotifications && (
        <>
        <div className="relative">
          <button
            onClick={() => {
              setNotifOpen((v) => !v);
              setProfileOpen(false);
            }}
            className="relative flex h-9 w-9 items-center justify-center font-sans text-xs font-medium text-text-muted sm:h-auto sm:w-auto"
            aria-label="Notifikasi"
          >
            <Bell size={20} className="sm:hidden" />
            <span className="hidden sm:inline">Notifikasi</span>
            {unreadCount > 0 && (
              <span className="absolute -right-3 -top-1.5 rounded-full bg-danger px-[5px] py-px font-mono text-[9px] font-semibold text-white">{unreadCount}</span>
            )}
          </button>
          {notifOpen && (
            <div className="fixed inset-x-3 top-[58px] z-50 rounded-lg border border-border-subtle bg-white shadow-lg sm:absolute sm:inset-x-auto sm:right-0 sm:top-[calc(100%+8px)] sm:w-[340px]">
              <div className="flex items-center border-b border-[#F1F4F7] px-3.5 py-2.5">
                <span className="font-sans text-[12px] font-semibold text-text-primary">Notifikasi</span>
                {unreadCount > 0 && (
                  <button
                    onClick={() => onMarkAllRead?.()}
                    className="ml-auto font-sans text-[10.5px] font-semibold text-action-primary"
                  >
                    Tandai semua dibaca
                  </button>
                )}
              </div>
              <div className="max-h-[360px] overflow-y-auto">
                {notifications.length === 0 && (
                  <div className="px-3.5 py-6 text-center font-sans text-[11.5px] text-text-muted">Tidak ada notifikasi.</div>
                )}
                {notifications.slice(0, 30).map((n) => (
                  <div
                    key={n.id}
                    className={"flex w-full items-start gap-2 border-b border-[#F7F9FB] px-3.5 py-2.5 text-left last:border-b-0 " + (n.read ? "bg-white" : "bg-[#F3F8FE]")}
                  >
                    <button onClick={() => onMarkRead?.(n.id)} className="flex flex-1 items-start gap-2 text-left">
                      {!n.read && <span className="mt-1.5 h-1.5 w-1.5 flex-none rounded-full bg-accent-blue" />}
                      <span className={"flex-1 font-sans text-[11.5px] leading-[1.45] " + (n.read ? "text-text-muted" : "text-[#31414F]")}>{n.text}</span>
                    </button>
                    <span className="flex-none font-mono text-[10px] text-[#94A3B0]">{formatNotifTime(n.time)}</span>
                    <button
                      onClick={() => onDismiss?.(n.id)}
                      title="Tutup notifikasi"
                      className="flex-none font-sans text-[13px] leading-none text-[#B8C4D0] hover:text-danger-fg"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <span className="h-5 w-px flex-none bg-border-subtle" />
        </>
        )}

        <div className="relative">
          <button
            onClick={() => {
              setProfileOpen((v) => !v);
              setNotifOpen(false);
            }}
            className="flex items-center gap-2 rounded-md py-1 pl-1 hover:bg-[#F7F9FB] sm:pr-2"
            aria-label="Menu profil"
          >
            <span className="flex h-[30px] w-[30px] flex-none items-center justify-center rounded-full bg-action-primary font-sans text-[11px] font-semibold text-white">
              {initialsFor(role)}
            </span>
            {/* HP: cukup ikon profil (nama ada di dalam menu-nya). */}
            <span className="hidden min-w-0 flex-col items-start leading-tight sm:flex">
              <span className="font-sans text-[12.5px] font-semibold text-text-primary">{role}</span>
              <span className="font-sans text-[10.5px] text-text-muted">{entity}</span>
            </span>
          </button>
          {profileOpen && (
            <div className="absolute right-0 top-[calc(100%+8px)] z-50 w-[190px] overflow-hidden rounded-lg border border-border-subtle bg-white py-1 shadow-lg">
              <div className="border-b border-[#F1F4F7] px-3.5 py-2 sm:hidden">
                <div className="font-sans text-xs font-semibold text-text-primary">{role}</div>
                <div className="font-sans text-[10.5px] text-text-muted">{entity}</div>
              </div>
              {onOpenProfile && (
                <button
                  onClick={() => {
                    setProfileOpen(false);
                    onOpenProfile();
                  }}
                  className="block w-full px-3.5 py-2 text-left font-sans text-xs font-medium text-text-primary hover:bg-[#F7F9FB]"
                >
                  Profil Saya
                </button>
              )}
              {onLogout && (
                <button
                  onClick={onLogout}
                  className="block w-full px-3.5 py-2 text-left font-sans text-xs font-medium text-danger-fg hover:bg-[#FBEDEB]"
                >
                  Logout
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
