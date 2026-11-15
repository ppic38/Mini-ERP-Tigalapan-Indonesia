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
function readColPrefsRaw(key: string | null): string | null {
  if (!key) return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}
/** Pilihan kolom per tabel: SELISIH dari bawaan (`shown` / `hidden`) dan urutan kolom (`order`, kosong = urutan bawaan). */
type ColPrefs = { shown: string[]; hidden: string[]; order: string[] };
const NO_COL_PREFS: ColPrefs = { shown: [], hidden: [], order: [] };
const strList = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
function parseColPrefs(raw: string | null): ColPrefs {
  try {
    const parsed = raw ? (JSON.parse(raw) as { shown?: unknown; hidden?: unknown; order?: unknown }) : null;
    return { shown: strList(parsed?.shown), hidden: strList(parsed?.hidden), order: strList(parsed?.order) };
  } catch {
    return NO_COL_PREFS;
  }
}
/** Favorit: susunan tabel yang diberi nama (filter + kelompok + kolom), disimpan di browser per tabel. */
type Favorite = { name: string; filters: Record<string, string[]>; group: string | null; cols: ColPrefs };
type FavStore = { items: Favorite[]; def: string | null };
const NO_FAVS: FavStore = { items: [], def: null };
function parseFavs(raw: string | null): FavStore {
  try {
    const p = raw ? (JSON.parse(raw) as { items?: unknown; def?: unknown }) : null;
    const items = (Array.isArray(p?.items) ? p.items : [])
      .filter((x): x is Record<string, unknown> => !!x && typeof x === "object" && typeof (x as { name?: unknown }).name === "string")
      .map((x) => {
        const filters: Record<string, string[]> = {};
        if (x.filters && typeof x.filters === "object") for (const [k, v] of Object.entries(x.filters as Record<string, unknown>)) filters[k] = strList(v);
        const c = (x.cols ?? {}) as { shown?: unknown; hidden?: unknown; order?: unknown };
        return { name: x.name as string, filters, group: typeof x.group === "string" ? x.group : null, cols: { shown: strList(c.shown), hidden: strList(c.hidden), order: strList(c.order) } };
      });
    const def = typeof p?.def === "string" && items.some((f) => f.name === p.def) ? p.def : null;
    return { items, def };
  } catch {
    return NO_FAVS;
  }
}
const GROUP_PREVIEW = 100;

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
  // Portal vendor produksi TIDAK ikut perilaku baru (keputusan owner: modul itu sudah dirapikan sendiri dan tidak
  // disentuh). Di sana tabel berperilaku persis seperti sebelum redesign: tanpa ingatan kolom, tanpa bagi halaman,
  // filter tetap pilihan tunggal.
  const modern = !pathname.startsWith("/vendor-maklon");
  const viewId = viewKey ?? `${pathname}:${typeof title === "string" ? title : ""}`;
  const storageKey = modern ? "dt-kolom-v1:" + viewId : null;
  const favKey = modern ? "dt-favorit-v1:" + viewId : null;
  // useSyncExternalStore: render server memakai bawaan (null), klien membaca localStorage setelah hidrasi,
  // dan perubahan dari tab lain ikut terbaca.
  const colPrefsRaw = useSyncExternalStore(subscribeColPrefs, () => readColPrefsRaw(storageKey), () => null);
  const colPrefs = useMemo(() => parseColPrefs(colPrefsRaw), [colPrefsRaw]);
  const favsRaw = useSyncExternalStore(subscribeColPrefs, () => readColPrefsRaw(favKey), () => null);
  const favs = useMemo(() => parseFavs(favsRaw), [favsRaw]);
  function writeStore(key: string | null, value: unknown, empty: boolean) {
    if (!key) return;
    try {
      if (empty) window.localStorage.removeItem(key);
      else window.localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Penyimpanan penuh atau diblokir: pilihan tidak bisa diingat.
    }
    window.dispatchEvent(new Event(COL_PREFS_EVENT));
  }
  function saveColPrefs(next: ColPrefs) {
    writeStore(storageKey, next, next.shown.length === 0 && next.hidden.length === 0 && next.order.length === 0);
  }
  function saveFavs(next: FavStore) {
    writeStore(favKey, next, next.items.length === 0);
  }
  const visible = new Set(columns.filter((c) => (c.default || colPrefs.shown.includes(c.key)) && !colPrefs.hidden.includes(c.key)).map((c) => c.key));
  const colPrefsActive = colPrefs.shown.length > 0 || colPrefs.hidden.length > 0 || colPrefs.order.length > 0;
  /** Urutan kolom pilihan pengguna; kolom yang belum punya urutan (mis. kolom baru) mengikuti urutan bawaannya di belakang. */
  function inUserOrder<C extends { key: string }>(list: C[]): C[] {
    if (colPrefs.order.length === 0) return list;
    const rank = (c: C, i: number) => {
      const at = colPrefs.order.indexOf(c.key);
      return at >= 0 ? at : colPrefs.order.length + i;
    };
    return list.map((c, i) => ({ c, r: rank(c, i) })).sort((a, b) => a.r - b.r).map((x) => x.c);
  }
  const [page, setPage] = useState(0);
  const [pageSizeChoice, setPageSizeChoice] = useState<number | null>(null);
  // Menu yang sedang terbuka: "kolom", "grup", "fav", atau "f:{label filter}". Satu saja pada satu waktu.
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  // Filter: beberapa nilai per filter (baris lolos kalau cocok SALAH SATU nilai). Dikunci dengan label filter supaya
  // tetap benar kalau daftar filter sebuah halaman berubah. Favorit bawaan (kalau ada) dipasang sekali saat tabel dibuka.
  const [filterSel, setFilterSel] = useState<Record<string, string[]>>(() => {
    const f = parseFavs(readColPrefsRaw(typeof window === "undefined" ? null : favKey));
    return f.items.find((x) => x.name === f.def)?.filters ?? {};
  });
  const [groupBy, setGroupBy] = useState<string | null>(() => {
    const f = parseFavs(readColPrefsRaw(typeof window === "undefined" ? null : favKey));
    return f.items.find((x) => x.name === f.def)?.group ?? null;
  });
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());
  const [fullGroups, setFullGroups] = useState<Set<string>>(new Set());
  const [favName, setFavName] = useState("");
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
    saveColPrefs({ shown, hidden, order: colPrefs.order });
  }
  function moveColumn(key: string, dir: -1 | 1) {
    const keys = inUserOrder(columns.filter((c) => !c.sysadmin)).map((c) => c.key);
    const at = keys.indexOf(key);
    const to = at + dir;
    if (at < 0 || to < 0 || to >= keys.length) return;
    [keys[at], keys[to]] = [keys[to], keys[at]];
    saveColPrefs({ ...colPrefs, order: keys });
  }

  const trimmedQuery = searchQuery.trim().toLowerCase();
  const selOf = (f: FilterDef<T>) => filterSel[f.label] ?? [];
  const passes = (f: FilterDef<T>, r: T) => {
    const sel = selOf(f);
    return sel.length === 0 || sel.some((v) => f.test(r, v));
  };
  function setSel(label: string, values: string[]) {
    setFilterSel((prev) => ({ ...prev, [label]: values }));
    setPage(0);
  }
  const filtered = rows.filter(
    (r) =>
      (alwaysShowKey != null && keyOf(r) === alwaysShowKey) ||
      ((filterDefs ?? []).every((f) => passes(f, r)) && (!search || !trimmedQuery || search.getText(r).toLowerCase().includes(trimmedQuery)))
  );
  // Filter saling memengaruhi (permintaan owner 2026-11-05): pilihan sebuah filter hanya memuat nilai yang MASIH ADA di baris yang lolos SEMUA filter lain
  // (dan kotak cari). Contoh: pilih MRP W39 -> filter Vendor hanya berisi vendor yang punya baris di W39. Pilihan yang sedang aktif selalu tetap tampil.
  // Tanpa filter lain/pencarian yang aktif, daftar pilihannya apa adanya seperti sebelumnya.
  const filterDefList = filterDefs ?? [];
  function optionsFor(i: number): string[] {
    const f = filterDefList[i];
    const othersActive = filterDefList.some((g, j) => j !== i && selOf(g).length > 0);
    if (!othersActive && !trimmedQuery) return f.options;
    const pool = rows.filter(
      (r) => filterDefList.every((g, j) => j === i || passes(g, r)) && (!search || !trimmedQuery || search.getText(r).toLowerCase().includes(trimmedQuery))
    );
    const mine = selOf(f);
    return f.options.filter((o) => mine.includes(o) || pool.some((r) => f.test(r, o)));
  }
  // Kelompokkan: memakai definisi filter yang sudah ada sebagai sumber kelompok (nilai kelompok sebuah baris = pilihan
  // filter pertama yang cocok), jadi semua tabel yang punya filter langsung bisa dikelompokkan tanpa diubah.
  const groupDef = modern ? (filterDefList.find((f) => f.label === groupBy) ?? null) : null;
  const groups = groupDef
    ? (() => {
        const map = new Map<string, T[]>();
        for (const r of filtered) {
          const name = groupDef.options.find((o) => groupDef.test(r, o)) ?? "Lainnya";
          const list = map.get(name);
          if (list) list.push(r);
          else map.set(name, [r]);
        }
        const order = [...groupDef.options, "Lainnya"];
        return [...map.entries()].sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]));
      })()
    : null;
  const activeFilterCount = filterDefList.filter((f) => selOf(f).length > 0).length;
  function applyFavorite(fav: Favorite) {
    setFilterSel(fav.filters);
    setGroupBy(fav.group);
    setOpenGroups(new Set());
    setPage(0);
    saveColPrefs(fav.cols);
    setOpenMenu(null);
  }
  function saveFavorite() {
    const name = favName.trim();
    if (!name) return;
    const filters: Record<string, string[]> = {};
    for (const f of filterDefList) if (selOf(f).length > 0) filters[f.label] = selOf(f);
    const fav: Favorite = { name, filters, group: groupDef ? groupDef.label : null, cols: colPrefs };
    saveFavs({ items: [...favs.items.filter((x) => x.name !== name), fav], def: favs.def });
    setFavName("");
  }
  // Bagi halaman (owner 2026-11-16): tabel besar dulu dirender sekaligus (Master SKU 2.139 baris, Tracking Item 881,
  // Yield Alert 595 -- halaman setinggi 47.677 px). Ini HANYA membatasi baris yang digambar; `filtered` tetap utuh,
  // jadi hitungan, total, dan export pemakai tidak berubah.
  const AUTO_PAGE_MIN = 100;
  const effectivePageSize =
    pageSize === false || groups ? 0 : (pageSizeChoice ?? (typeof pageSize === "number" ? pageSize : modern && filtered.length > AUTO_PAGE_MIN ? 50 : 0));
  const pageCount = effectivePageSize > 0 ? Math.max(1, Math.ceil(filtered.length / effectivePageSize)) : 1;
  const currentPage = Math.min(page, pageCount - 1);
  let pageRows = effectivePageSize > 0 ? filtered.slice(currentPage * effectivePageSize, (currentPage + 1) * effectivePageSize) : filtered;
  // Baris yang wajib selalu terlihat tidak boleh tersembunyi di halaman lain.
  if (alwaysShowKey != null && effectivePageSize > 0 && !pageRows.some((r) => keyOf(r) === alwaysShowKey)) {
    const pinned = filtered.find((r) => keyOf(r) === alwaysShowKey);
    if (pinned) pageRows = [pinned, ...pageRows];
  }
  const showPager = pageSize !== false && !groups && (effectivePageSize > 0 || pageSizeChoice === 0) && filtered.length > 25;
  const sysadminMode = useSysadminMode();
  const visibleColumns = [...inUserOrder(columns.filter((c) => !c.sysadmin && visible.has(c.key))), ...(sysadminMode ? columns.filter((c) => c.sysadmin) : [])];
  const fullSpan = visibleColumns.length + 1 + (renderExpanded || onRowClick ? 1 : 0);
  type Item = { kind: "row"; row: T } | { kind: "group"; name: string; count: number; open: boolean } | { kind: "more"; name: string; rest: number };
  const displayItems: Item[] = groups
    ? groups.flatMap(([name, list]): Item[] => {
        const open = openGroups.has(name);
        const head: Item = { kind: "group", name, count: list.length, open };
        if (!open) return [head];
        const shown = fullGroups.has(name) ? list : list.slice(0, GROUP_PREVIEW);
        const body: Item[] = shown.map((row) => ({ kind: "row", row }));
        return list.length > shown.length ? [head, ...body, { kind: "more", name, rest: list.length - shown.length }] : [head, ...body];
      })
    : pageRows.map((row) => ({ kind: "row", row }));
  const toggleIn = (set: Set<string>, name: string) => {
    const next = new Set(set);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    return next;
  };
  const menuBtn = "rounded-md border border-[#CBD5DF] px-2.5 py-[6px] font-sans text-[11.5px] font-semibold text-action-primary";
  const menuBox = "absolute z-30 max-h-72 overflow-y-auto rounded-md border border-border-subtle bg-surface-card p-2 shadow-[0_8px_20px_rgba(11,19,27,.15)]";
  const menuItem = "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left font-sans text-xs text-[#31414F] hover:bg-[#F7F9FB]";

  return (
    <div className={"overflow-hidden rounded-lg border border-border-subtle bg-surface-card" + (mobileCards ? " m-cards" : "")}>
      <div className="dt-head flex items-center gap-2 border-b border-border-subtle px-5 py-3">
        <div>
          <span className="font-sans text-[13px] font-semibold text-text-primary">{title}</span>
          {subtitle && <div className="mt-0.5 font-sans text-[10.5px] font-medium text-text-muted">{subtitle}</div>}
        </div>
        <div className="ml-auto flex items-center gap-2">
          {headerActions}
          {/* Lapisan penutup: klik di luar menu menutupnya. */}
          {openMenu && <div className="fixed inset-0 z-20" onClick={() => setOpenMenu(null)} />}
          {modern && filterDefList.length > 0 && (
            <div className="relative">
              <button onClick={() => setOpenMenu(openMenu === "grup" ? null : "grup")} className={menuBtn + (groupDef ? " bg-info-bg" : "")}>
                {groupDef ? `Kelompok: ${groupDef.label}` : "Kelompokkan"}
              </button>
              {openMenu === "grup" && (
                <div className={menuBox + " right-0 top-[110%] w-52"}>
                  {filterDefList.map((f) => (
                    <button
                      key={f.label}
                      className={menuItem + (groupBy === f.label ? " font-semibold text-action-primary" : "")}
                      onClick={() => {
                        setGroupBy(f.label);
                        setOpenGroups(new Set());
                        setFullGroups(new Set());
                        setOpenMenu(null);
                      }}
                    >
                      {f.label}
                    </button>
                  ))}
                  {groupDef && (
                    <button className={menuItem + " mt-1 border-t border-border-subtle font-semibold text-action-primary"} onClick={() => { setGroupBy(null); setOpenMenu(null); }}>
                      Tanpa kelompok
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
          {modern && (
            <div className="relative">
              <button onClick={() => setOpenMenu(openMenu === "fav" ? null : "fav")} className={menuBtn}>
                Favorit{favs.items.length > 0 ? ` (${favs.items.length})` : ""}
              </button>
              {openMenu === "fav" && (
                <div className={menuBox + " right-0 top-[110%] w-72"}>
                  {favs.items.length === 0 && <div className="px-2 py-1.5 font-sans text-xs text-text-muted">Belum ada favorit. Atur filter, kelompok, dan kolom, lalu simpan di bawah.</div>}
                  {favs.items.map((f) => (
                    <div key={f.name} className="flex items-center gap-1">
                      <button className={menuItem + " min-w-0 flex-1"} onClick={() => applyFavorite(f)}>
                        <span className="truncate">{f.name}</span>
                        {favs.def === f.name && <span className="flex-none rounded bg-info-bg px-1.5 py-px text-[10px] font-semibold text-info-fg">bawaan</span>}
                      </button>
                      <button
                        className="flex-none rounded px-1.5 py-1 font-sans text-[11px] font-semibold text-action-primary hover:bg-[#F7F9FB]"
                        title={favs.def === f.name ? "Jangan pakai sebagai bawaan" : "Pakai setiap kali tabel ini dibuka"}
                        onClick={() => saveFavs({ items: favs.items, def: favs.def === f.name ? null : f.name })}
                      >
                        {favs.def === f.name ? "Lepas" : "Jadikan bawaan"}
                      </button>
                      <button
                        className="flex-none rounded px-1.5 py-1 font-sans text-[11px] font-semibold text-danger-fg hover:bg-[#F7F9FB]"
                        aria-label={`Hapus favorit ${f.name}`}
                        onClick={() => saveFavs({ items: favs.items.filter((x) => x.name !== f.name), def: favs.def === f.name ? null : favs.def })}
                      >
                        Hapus
                      </button>
                    </div>
                  ))}
                  <div className="mt-1 flex gap-1 border-t border-border-subtle pt-2">
                    <input
                      value={favName}
                      onChange={(e) => setFavName(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") saveFavorite(); }}
                      placeholder="Nama susunan ini"
                      aria-label="Nama favorit"
                      maxLength={40}
                      className="min-w-0 flex-1 rounded-md border border-border-subtle bg-white px-2 py-[5px] font-sans text-xs text-[#31414F]"
                    />
                    <button onClick={saveFavorite} disabled={!favName.trim()} className="flex-none rounded-md bg-action-primary px-2.5 py-[5px] font-sans text-xs font-semibold text-white disabled:opacity-40">
                      Simpan
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
          <div className="relative">
            <button onClick={() => setOpenMenu(openMenu === "kolom" ? null : "kolom")} className={menuBtn}>
              ⊞ Kolom
            </button>
            {openMenu === "kolom" && (
              <div className={menuBox + " right-0 top-[110%] w-64"}>
                {inUserOrder(columns.filter((c) => !c.sysadmin)).map((c, i, list) => (
                  <div key={c.key} className="flex items-center rounded hover:bg-[#F7F9FB]">
                    <label className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 font-sans text-xs text-[#31414F]">
                      <input type="checkbox" checked={visible.has(c.key)} onChange={() => toggle(c.key)} className="h-3.5 w-3.5 flex-none accent-accent-blue" />
                      <span className="truncate">{c.label}</span>
                    </label>
                    {modern && (
                      <>
                        <button disabled={i === 0} onClick={() => moveColumn(c.key, -1)} aria-label={`Naikkan kolom ${c.label}`} className="flex-none px-1.5 py-1 text-xs text-text-muted disabled:opacity-25">
                          ▲
                        </button>
                        <button disabled={i === list.length - 1} onClick={() => moveColumn(c.key, 1)} aria-label={`Turunkan kolom ${c.label}`} className="flex-none px-1.5 py-1 text-xs text-text-muted disabled:opacity-25">
                          ▼
                        </button>
                      </>
                    )}
                  </div>
                ))}
                {colPrefsActive && (
                  <button onClick={() => saveColPrefs(NO_COL_PREFS)} className="mt-1 w-full rounded border-t border-border-subtle px-2 py-1.5 text-left font-sans text-xs font-semibold text-action-primary hover:bg-[#F7F9FB]">
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
          {!modern &&
            filterDefs?.map((f, i) => (
              <select
                key={f.label}
                value={selOf(f)[0] ?? ""}
                onChange={(e) => setSel(f.label, e.target.value ? [e.target.value] : [])}
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
          {modern &&
            filterDefs?.map((f, i) => {
              const sel = selOf(f);
              const id = "f:" + f.label;
              return (
                <div key={f.label} className="relative max-md:w-full">
                  <button
                    onClick={() => setOpenMenu(openMenu === id ? null : id)}
                    className={
                      "flex max-w-full items-center gap-1.5 rounded-md border px-2.5 py-[6px] font-sans text-[11.5px] font-medium max-md:w-full " +
                      (sel.length > 0 ? "border-accent-blue bg-info-bg text-info-fg" : "border-border-subtle bg-white text-[#31414F]")
                    }
                  >
                    <span className="truncate">
                      {f.label}
                      {sel.length === 1 ? `: ${sel[0]}` : sel.length > 1 ? `: ${sel.length} dipilih` : ""}
                    </span>
                    <ChevronDown className="h-3 w-3 flex-none" />
                  </button>
                  {openMenu === id && (
                    <div className={menuBox + " left-0 top-[110%] w-60"}>
                      {optionsFor(i).map((o) => (
                        <label key={o} className={menuItem + " cursor-pointer"}>
                          <input
                            type="checkbox"
                            checked={sel.includes(o)}
                            onChange={() => setSel(f.label, sel.includes(o) ? sel.filter((v) => v !== o) : [...sel, o])}
                            className="h-3.5 w-3.5 flex-none accent-accent-blue"
                          />
                          <span className="truncate">{o}</span>
                        </label>
                      ))}
                      {optionsFor(i).length === 0 && <div className="px-2 py-1.5 font-sans text-xs text-text-muted">Tidak ada pilihan.</div>}
                      {sel.length > 0 && (
                        <button className={menuItem + " mt-1 border-t border-border-subtle font-semibold text-action-primary"} onClick={() => setSel(f.label, [])}>
                          Hapus pilihan
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          {modern && activeFilterCount > 0 && (
            <button onClick={() => { setFilterSel({}); setPage(0); }} className="rounded-md px-2 py-[6px] font-sans text-[11.5px] font-semibold text-action-primary hover:bg-white">
              Hapus semua filter
            </button>
          )}
          {modern && (activeFilterCount > 0 || trimmedQuery) && <span className="ml-auto font-sans text-[11.5px] text-text-muted max-md:ml-0">{filtered.length} dari {rows.length} baris</span>}
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
            {displayItems.map((item) => {
              if (item.kind === "group")
                return (
                  <tr key={"g:" + item.name} className="cursor-pointer border-b border-[#E3E8EE] bg-[#F4F6F9] font-sans text-xs font-semibold text-text-primary hover:bg-[#EDF1F5]" onClick={() => setOpenGroups(toggleIn(openGroups, item.name))}>
                    <td colSpan={fullSpan} className="px-5 py-[9px]">
                      <span className="inline-flex items-center gap-2">
                        {item.open ? <ChevronDown className="h-3.5 w-3.5 flex-none" /> : <ChevronRight className="h-3.5 w-3.5 flex-none" />}
                        {item.name}
                        <span className="font-medium text-text-muted">{item.count} baris</span>
                      </span>
                    </td>
                  </tr>
                );
              if (item.kind === "more")
                return (
                  <tr key={"m:" + item.name} className="border-b border-[#F1F4F7]">
                    <td colSpan={fullSpan} className="px-5 py-2">
                      <button className="font-sans text-xs font-semibold text-action-primary" onClick={() => setFullGroups(toggleIn(fullGroups, item.name))}>
                        Tampilkan {item.rest} baris lainnya di {item.name}
                      </button>
                    </td>
                  </tr>
                );
              const r = item.row;
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
