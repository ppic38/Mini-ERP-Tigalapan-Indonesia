"use client";

import { useSysadminMode } from "@/lib/shell/use-sysadmin-mode";
import { Fragment, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { ChevronDown, ChevronRight } from "lucide-react";
import { InfoPopover } from "@/components/ui/info-popover";

export type ColumnDef<T> = {
  key: string;
  label: string;
  default: boolean;
  align?: "left" | "right";
  render: (row: T) => ReactNode;
  /** Opsional: ikon "i" di header kolom yang membuka kartu penjelasan (asal nilai dan rumusnya). */
  info?: { title: string; body: ReactNode };
  /** Kolom "Aksi Sysadmin" (owner 2026-10-06): hanya tampil di mode Sysadmin, SELALU tampil (tidak ada di
   *  menu Kolom), ditaruh paling kanan dan diwarnai ungu supaya jelas ini bagian Sysadmin. */
  sysadmin?: boolean;
};

export type FilterDef<T> = {
  label: string;
  options: string[];
  test: (row: T, value: string) => boolean;
};

/** Item revisi 2026-09-15 (owner: "tambahkan searchbar di semua fitur master, langsung tampil
 *  seiring diketik, tidak perlu Enter") — kotak cari bebas teks, BEDA dari `filterDefs` (dropdown
 *  exact-match per kolom) -- ini substring match (case-insensitive) lintas beberapa kolom
 *  sekaligus lewat `getText`, filter LANGSUNG tiap keystroke (React onChange biasa, TIDAK ada
 *  submit/Enter/debounce -- `rows` yang dipakai di app ini semuanya sudah di memori client,
 *  bukan query server, jadi filter di setiap ketikan tidak mahal). Opsional -- pemakai DataTable
 *  yang tidak mengisi prop ini TIDAK berubah perilaku sama sekali. */
export type SearchDef<T> = {
  placeholder?: string;
  getText: (row: T) => string;
};

const COL_PREFS_EVENT = "dt-kolom-berubah";
function subscribeColPrefs(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener(COL_PREFS_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(COL_PREFS_EVENT, onChange);
  };
}
function readColPrefsRaw(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}
function parseColPrefs(raw: string | null): { shown: string[]; hidden: string[] } {
  const strs = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  try {
    const parsed = raw ? (JSON.parse(raw) as { shown?: unknown; hidden?: unknown }) : null;
    return { shown: strs(parsed?.shown), hidden: strs(parsed?.hidden) };
  } catch {
    return { shown: [], hidden: [] };
  }
}

export function DataTable<T>({
  title,
  subtitle,
  headerActions,
  columns,
  rows,
  keyOf,
  filterDefs,
  search,
  alwaysShowKey,
  emptyText = "Tidak ada data.",
  firstColumnLabel,
  firstColumnRender,
  firstColumnAlign = "left",
  rowClassName,
  bodyMaxHeight,
  renderExpanded,
  singleExpand,
  onRowClick,
  collapseSignal,
  mobileCards,
  nowrap,
  viewKey,
  pageSize,
}: {
  /** Opsional -- di layar HP/tablet tegak (< 1024px) tiap baris jadi KARTU bertumpuk (label kolom di depan nilainya) alih-alih
   *  tabel yang digeser ke samping. Hanya dipakai halaman portal vendor; yang lain tidak berubah sama sekali. */
  mobileCards?: boolean;
  /** Opsional: judul dan isi sel tidak dibungkus ke baris kedua (satu baris per data, header dan nilai sejajar); kalau kolom terlalu banyak, tabel digeser ke samping.
   *  Baris rincian yang dibuka (renderExpanded) tidak terpengaruh. Tidak diisi = perilaku lama. */
  nowrap?: boolean;
  title: string;
  subtitle?: string;
  headerActions?: ReactNode;
  columns: ColumnDef<T>[];
  rows: T[];
  keyOf: (row: T) => string;
  filterDefs?: FilterDef<T>[];
  search?: SearchDef<T>;
  /** Item revisi 2026-09-15 (owner-reported: "input satu huruf, langsung terclose" di Master Data
   *  -- klik "Edit" baris X, ketik 1 karakter, baris X HILANG dari tampilan): root cause -- kalau
   *  ada `filterDefs`/`search` yang KEBETULAN sedang aktif & cocok dengan nilai LAMA baris itu
   *  (mis. filter "Kategori" di-set ke "WA MYNO" untuk MENEMUKAN baris itu, lalu baris itu di-Edit
   *  buat diperbaiki jadi "WANGKI MYNO") -- begitu user ketik 1 huruf, nilai baris berubah jadi
   *  TIDAK LAGI cocok filter yang MASIH aktif, `filtered` di bawah otomatis MEMBUANG baris itu dari
   *  tampilan -- bukan "tertutup", tapi literal ke-filter keluar SELAGI SEDANG diedit. Isi prop ini
   *  dengan `keyOf` baris yang SEDANG dalam mode edit (kalau ada) -- baris itu SELALU ikut tampil
   *  di `filtered`, TIDAK PERNAH ikut ke-filter keluar oleh filterDefs/search apa pun, SELAMA masih
   *  dalam mode edit. Opsional & backward-compatible -- pemakai DataTable yang tidak mengisi prop
   *  ini (SEMUA tabel lain, bukan Master Data yang punya gerbang Edit/Simpan) TIDAK berubah
   *  perilaku sama sekali. */
  alwaysShowKey?: string | null;
  emptyText?: string;
  firstColumnLabel: string;
  firstColumnRender: (row: T) => ReactNode;
  firstColumnAlign?: "left" | "right";
  rowClassName?: (row: T) => string | undefined;
  /** Opsional — kalau diisi (mis. "60vh"), body tabel jadi scroll SENDIRI (bukan ikut nge-scroll
   *  halaman utama) dengan header kolom yang tetap kelihatan (sticky) selagi di-scroll. Dipakai
   *  di halaman Master Data yang barisnya bisa ratusan (Harga Kain/Harga Kain PKS) — kalau tidak
   *  diisi, perilaku lama (tabel tumbuh mengikuti isi, ikut scroll halaman) TIDAK berubah sama
   *  sekali, supaya semua pemakai DataTable lain di app ini tidak kena efek samping. */
  bodyMaxHeight?: string;
  /** Opsional — kalau diisi, tiap baris jadi bisa diklik untuk expand/collapse 1 baris rincian
   *  di bawahnya (kolom chevron ditambah otomatis di ujung kanan) — pola yang sama dipakai di
   *  halaman MRP PPIC. Tidak diisi = tabel tetap seperti biasa, tidak ada perubahan sama sekali
   *  buat pemakai DataTable lain. */
  renderExpanded?: (row: T) => ReactNode;
  /** Kalau true, hanya satu baris yang bisa terbuka: membuka satu baris menutup yang lain. */
  singleExpand?: boolean;
  /** Opsional: klik baris memanggil fungsi ini (mis. membuka popup rincian) alih-alih membuka baris. Diabaikan kalau `renderExpanded` diisi. */
  onRowClick?: (row: T) => void;
  /** Opsional (B1, flow "auto-collapse setelah Bayar" di Finance/Payment) — ubah nilainya (mis.
   *  increment sebuah counter) dari luar untuk memaksa SELURUH baris yang sedang ter-expand
   *  tertutup lagi, tanpa mereset pilihan kolom (`visible`) atau filter (`filterValues`) apa pun.
   *  Tidak diisi = perilaku expand/collapse 100% seperti sebelumnya, tidak ada efek sama sekali —
   *  jangan pakai `key` di komponen ini buat maksud yang sama (itu me-remount seluruh state,
   *  termasuk kolom & filter). */
  collapseSignal?: number;
  /** Opsional: kunci penyimpanan pilihan kolom. Tidak diisi = alamat halaman + judul tabel, jadi semua tabel
   *  otomatis mengingat pilihan kolomnya tanpa menyentuh tiap pemakai. Isi sendiri hanya kalau dua tabel di satu
   *  halaman berjudul sama. */
  viewKey?: string;
  /** Opsional: jumlah baris per halaman. Tidak diisi = dibagi 50 baris per halaman HANYA kalau baris lebih dari
   *  100 (tabel kecil tidak berubah). `false` = jangan pernah dibagi. */
  pageSize?: number | false;
}) {
  // Pilihan kolom diingat per tabel di browser (owner 2026-11-16: field harus fleksibel, dan sebelumnya pilihan
  // hilang tiap halaman dibuka). Yang disimpan SELISIH dari bawaan (kolom yang sengaja ditampilkan / disembunyikan),
  // bukan daftar lengkap -- supaya kolom baru yang ditambahkan ke tabel di kemudian hari tetap ikut bawaannya.
  const pathname = usePathname();
  const storageKey = "dt-kolom-v1:" + (viewKey ?? `${pathname}:${typeof title === "string" ? title : ""}`);
  // useSyncExternalStore: render server memakai bawaan (null), klien membaca localStorage setelah hidrasi,
  // dan perubahan dari tab lain ikut terbaca.
  const colPrefsRaw = useSyncExternalStore(subscribeColPrefs, () => readColPrefsRaw(storageKey), () => null);
  const colPrefs = useMemo(() => parseColPrefs(colPrefsRaw), [colPrefsRaw]);
  function saveColPrefs(next: { shown: string[]; hidden: string[] }) {
    try {
      if (next.shown.length === 0 && next.hidden.length === 0) window.localStorage.removeItem(storageKey);
      else window.localStorage.setItem(storageKey, JSON.stringify(next));
    } catch {
      // Penyimpanan penuh atau diblokir: pilihan tidak bisa diingat.
    }
    window.dispatchEvent(new Event(COL_PREFS_EVENT));
  }
  const visible = new Set(columns.filter((c) => (c.default || colPrefs.shown.includes(c.key)) && !colPrefs.hidden.includes(c.key)).map((c) => c.key));
  const colPrefsActive = colPrefs.shown.length > 0 || colPrefs.hidden.length > 0;
  const [page, setPage] = useState(0);
  const [pageSizeChoice, setPageSizeChoice] = useState<number | null>(null);
  const [colOpen, setColOpen] = useState(false);
  const [filterValues, setFilterValues] = useState<string[]>((filterDefs ?? []).map(() => ""));
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());
  const prevCollapseSignal = useRef(collapseSignal);
  useEffect(() => {
    if (collapseSignal !== undefined && collapseSignal !== prevCollapseSignal.current) {
      prevCollapseSignal.current = collapseSignal;
      setExpandedKeys(new Set());
    }
  }, [collapseSignal]);

  function toggleExpanded(key: string) {
    setExpandedKeys((prev) => {
      if (singleExpand) return prev.has(key) ? new Set() : new Set([key]);
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function toggle(key: string) {
    const isDefault = columns.some((c) => c.key === key && c.default);
    const shown = colPrefs.shown.filter((k) => k !== key);
    const hidden = colPrefs.hidden.filter((k) => k !== key);
    if (visible.has(key)) {
      if (isDefault) hidden.push(key);
    } else if (!isDefault) shown.push(key);
    saveColPrefs({ shown, hidden });
  }

  const trimmedQuery = searchQuery.trim().toLowerCase();
  const filtered = rows.filter(
    (r) =>
      (alwaysShowKey != null && keyOf(r) === alwaysShowKey) ||
      ((filterDefs ?? []).every((f, i) => !filterValues[i] || f.test(r, filterValues[i])) &&
        (!search || !trimmedQuery || search.getText(r).toLowerCase().includes(trimmedQuery)))
  );
  // Filter saling memengaruhi (permintaan owner 2026-11-05): pilihan sebuah filter hanya memuat nilai yang MASIH ADA di baris yang lolos SEMUA filter lain
  // (dan kotak cari). Contoh: pilih MRP W39 -> filter Vendor hanya berisi vendor yang punya baris di W39. Pilihan yang sedang aktif selalu tetap tampil.
  // Tanpa filter lain/pencarian yang aktif, daftar pilihannya apa adanya seperti sebelumnya.
  const filterDefList = filterDefs ?? [];
  function optionsFor(i: number): string[] {
    const f = filterDefList[i];
    const othersActive = filterDefList.some((_, j) => j !== i && !!filterValues[j]);
    if (!othersActive && !trimmedQuery) return f.options;
    const pool = rows.filter(
      (r) =>
        filterDefList.every((g, j) => j === i || !filterValues[j] || g.test(r, filterValues[j])) &&
        (!search || !trimmedQuery || search.getText(r).toLowerCase().includes(trimmedQuery))
    );
    return f.options.filter((o) => o === filterValues[i] || pool.some((r) => f.test(r, o)));
  }
  // Bagi halaman (owner 2026-11-16): tabel besar dulu dirender sekaligus (Master SKU 2.139 baris, Tracking Item 881,
  // Yield Alert 595 -- halaman setinggi 47.677 px). Ini HANYA membatasi baris yang digambar; `filtered` tetap utuh,
  // jadi hitungan, total, dan export pemakai tidak berubah.
  const AUTO_PAGE_MIN = 100;
  const effectivePageSize = pageSize === false ? 0 : (pageSizeChoice ?? (typeof pageSize === "number" ? pageSize : filtered.length > AUTO_PAGE_MIN ? 50 : 0));
  const pageCount = effectivePageSize > 0 ? Math.max(1, Math.ceil(filtered.length / effectivePageSize)) : 1;
  const currentPage = Math.min(page, pageCount - 1);
  let pageRows = effectivePageSize > 0 ? filtered.slice(currentPage * effectivePageSize, (currentPage + 1) * effectivePageSize) : filtered;
  // Baris yang wajib selalu terlihat tidak boleh tersembunyi di halaman lain.
  if (alwaysShowKey != null && effectivePageSize > 0 && !pageRows.some((r) => keyOf(r) === alwaysShowKey)) {
    const pinned = filtered.find((r) => keyOf(r) === alwaysShowKey);
    if (pinned) pageRows = [pinned, ...pageRows];
  }
  const showPager = pageSize !== false && (effectivePageSize > 0 || pageSizeChoice === 0) && filtered.length > 25;
  const sysadminMode = useSysadminMode();
  const visibleColumns = [...columns.filter((c) => !c.sysadmin && visible.has(c.key)), ...(sysadminMode ? columns.filter((c) => c.sysadmin) : [])];

  return (
    <div className={"overflow-hidden rounded-lg border border-border-subtle bg-surface-card" + (mobileCards ? " m-cards" : "")}>
      <div className="dt-head flex items-center gap-2 border-b border-border-subtle px-5 py-3">
        <div>
          <span className="font-sans text-[13px] font-semibold text-text-primary">{title}</span>
          {subtitle && <div className="mt-0.5 font-sans text-[10.5px] font-medium text-text-muted">{subtitle}</div>}
        </div>
        <div className="ml-auto flex items-center gap-2">
          {headerActions}
          <div className="relative">
            <button onClick={() => setColOpen((v) => !v)} className="rounded-md border border-[#CBD5DF] px-2.5 py-[6px] font-sans text-[11.5px] font-semibold text-action-primary">
              ⊞ Kolom
            </button>
            {colOpen && (
              <div className="absolute right-0 top-[110%] z-20 max-h-72 w-56 overflow-y-auto rounded-md border border-border-subtle bg-surface-card p-2 shadow-[0_8px_20px_rgba(11,19,27,.15)]">
                {columns.filter((c) => !c.sysadmin).map((c) => (
                  <label key={c.key} className="flex items-center gap-2 rounded px-2 py-1.5 font-sans text-xs text-[#31414F] hover:bg-[#F7F9FB]">
                    <input type="checkbox" checked={visible.has(c.key)} onChange={() => toggle(c.key)} className="h-3.5 w-3.5 accent-accent-blue" />
                    {c.label}
                  </label>
                ))}
                {colPrefsActive && (
                  <button onClick={() => saveColPrefs({ shown: [], hidden: [] })} className="mt-1 w-full rounded border-t border-border-subtle px-2 py-1.5 text-left font-sans text-xs font-semibold text-action-primary hover:bg-[#F7F9FB]">
                    Kembalikan kolom bawaan
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {((filterDefs && filterDefs.length > 0) || search) && (
        <div className="dt-filters flex flex-wrap items-center gap-2 border-b border-border-subtle bg-[#FAFBFC] px-5 py-2.5 max-md:flex-col max-md:items-stretch max-md:px-4">
          {search && (
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={search.placeholder ?? "Cari…"}
              className="w-[220px] max-w-full rounded-md max-md:w-full border border-border-subtle bg-white px-2.5 py-[6px] font-sans text-[11.5px] font-medium text-[#31414F]"
            />
          )}
          {filterDefs?.map((f, i) => (
            <select
              key={f.label}
              value={filterValues[i]}
              onChange={(e) => {
                const next = [...filterValues];
                next[i] = e.target.value;
                setFilterValues(next);
              }}
              className="max-w-full rounded-md border border-border-subtle bg-white px-2.5 py-[6px] max-md:w-full font-sans text-[11.5px] font-medium text-[#31414F]"
            >
              <option value="">{f.label}: Semua</option>
              {optionsFor(i).map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          ))}
        </div>
      )}

      <div className={"overflow-x-auto" + (bodyMaxHeight ? " overflow-y-auto" : "")} style={bodyMaxHeight ? { maxHeight: bodyMaxHeight } : undefined}>
        <table className="w-full border-collapse">
          <thead className={bodyMaxHeight ? "sticky top-0 z-10" : undefined}>
            <tr className="border-b-2 border-accent-blue bg-info-bg font-sans text-[10.5px] font-medium uppercase tracking-wider text-info-fg">
              <th className={"px-5 py-[9px] " + (nowrap ? "whitespace-nowrap " : "") + (firstColumnAlign === "right" ? "text-right" : "text-left")}>{firstColumnLabel}</th>
              {visibleColumns.map((c) => (
                <th key={c.key} className={"px-3 py-[9px] " + (nowrap ? "whitespace-nowrap " : "") + (c.align === "right" ? "text-right " : "text-left ") + (c.sysadmin ? "border-l-2 border-accent-purple bg-accent-purple-bg text-accent-purple" : "")}>
                  {c.label}
                  {c.info && <InfoPopover title={c.info.title}>{c.info.body}</InfoPopover>}
                </th>
              ))}
              {(renderExpanded || onRowClick) && <th className="w-8 px-3 py-[9px]" />}
            </tr>
          </thead>
          <tbody>
            {pageRows.map((r) => {
              const key = keyOf(r);
              const isExpanded = renderExpanded ? expandedKeys.has(key) : false;
              return (
                <Fragment key={key}>
                  <tr
                    className={
                      "border-b border-[#F1F4F7] font-sans text-xs text-[#31414F] last:border-b-0 " +
                      (renderExpanded || onRowClick ? "cursor-pointer hover:bg-[#FAFBFC] " : "") +
                      (rowClassName?.(r) ?? "")
                    }
                    onClick={renderExpanded ? () => toggleExpanded(key) : onRowClick ? () => onRowClick(r) : undefined}
                  >
                    <td className={"px-5 py-[11px] " + (nowrap ? "whitespace-nowrap " : "") + (firstColumnAlign === "right" ? "text-right" : "text-left")}>{firstColumnRender(r)}</td>
                    {visibleColumns.map((c) => (
                      <td key={c.key} data-label={c.label} onClick={c.sysadmin ? (e) => e.stopPropagation() : undefined} className={"px-3 py-[11px] " + (nowrap ? "whitespace-nowrap " : "") + (c.align === "right" ? "text-right " : "text-left ") + (c.sysadmin ? "border-l-2 border-accent-purple/40 bg-accent-purple-bg" : "")}>
                        {c.render(r)}
                      </td>
                    ))}
                    {!renderExpanded && onRowClick && (
                      <td data-chevron className="px-3 py-[11px]">
                        <ChevronRight className="h-3.5 w-3.5 flex-none text-text-muted" />
                      </td>
                    )}
                    {renderExpanded && (
                      <td data-chevron className="px-3 py-[11px]">
                        {isExpanded ? (
                          <ChevronDown className="h-3.5 w-3.5 flex-none text-text-muted" />
                        ) : (
                          <ChevronRight className="h-3.5 w-3.5 flex-none text-text-muted" />
                        )}
                      </td>
                    )}
                  </tr>
                  {renderExpanded && isExpanded && (
                    <tr className="border-b border-[#F1F4F7] last:border-b-0">
                      <td colSpan={visibleColumns.length + 2} className="bg-[#FAFBFC] px-5 py-4">
                        {renderExpanded(r)}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={visibleColumns.length + 1 + (renderExpanded || onRowClick ? 1 : 0)} className="px-5 py-6 text-center font-sans text-xs text-text-muted">
                  {emptyText}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {showPager && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border-subtle bg-[#FAFBFC] px-5 py-2 font-sans text-[11.5px] text-text-muted max-md:px-4">
          <span>
            {effectivePageSize > 0
              ? `${currentPage * effectivePageSize + 1}–${Math.min((currentPage + 1) * effectivePageSize, filtered.length)} dari ${filtered.length} baris`
              : `${filtered.length} baris`}
          </span>
          <div className="flex items-center gap-2">
            <select
              aria-label="Baris per halaman"
              value={effectivePageSize}
              onChange={(e) => {
                setPageSizeChoice(Number(e.target.value));
                setPage(0);
              }}
              className="rounded-md border border-border-subtle bg-white px-2 py-[5px] font-sans text-[11.5px] font-medium text-[#31414F]"
            >
              {[25, 50, 100].map((n) => (
                <option key={n} value={n}>
                  {n} per halaman
                </option>
              ))}
              <option value={0}>Semua</option>
            </select>
            {effectivePageSize > 0 && (
              <>
                <button type="button" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)} className="rounded-md border border-border-subtle bg-white px-2.5 py-[5px] font-semibold text-[#31414F] disabled:opacity-40">
                  Sebelumnya
                </button>
                <span>
                  {currentPage + 1} / {pageCount}
                </span>
                <button type="button" disabled={currentPage >= pageCount - 1} onClick={() => setPage(currentPage + 1)} className="rounded-md border border-border-subtle bg-white px-2.5 py-[5px] font-semibold text-[#31414F] disabled:opacity-40">
                  Berikutnya
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
