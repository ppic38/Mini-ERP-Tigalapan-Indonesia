"use server";

import { requireSession } from "../auth/session";
import { supabaseServer } from "../supabase/server";
import type { ActionResult } from "./action-result";
import { nextReadableId } from "./repo/ids";
import { VENDOR_GUIDE_SECTIONS, type GuideItem, type GuideKind } from "../guide/sections";
import { imageSrcFromUrl, parseHttpsUrl, videoEmbedFromUrl } from "../guide/embed";

/** Media panduan (video/gambar/tautan) yang dikelola Sysadmin dan tampil di Panduan Penggunaan portal Vendor
 *  (migration 0073, tabel guide_items). Hanya TAUTAN yang disimpan. Membaca: sesi login mana pun (vendor/internal) hanya
 *  melihat yang aktif; Sysadmin melihat semuanya. Menulis: hanya Sysadmin. */

const GUIDE_TABLE_MISSING = "Jalankan migration 0073 (tabel guide_items) di Supabase dulu.";

async function toResult<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function requireSysadminSession() {
  const session = await requireSession();
  if (!session.internalRoles.includes("sysadmin")) throw new Error("Forbidden: pengelolaan panduan hanya untuk Sysadmin.");
}

type Row = { id: string; portal: string; section_key: string; kind: string; title: string; url: string; caption: string | null; sort_order: number; active: boolean };

function toItem(r: Row): GuideItem {
  return { id: r.id, portal: r.portal, sectionKey: r.section_key, kind: r.kind as GuideKind, title: r.title ?? "", url: r.url, caption: r.caption ?? "", sortOrder: Number(r.sort_order), active: !!r.active };
}

export async function listGuideItemsAction(portal: string = "vendor"): Promise<ActionResult<GuideItem[]>> {
  return toResult(async () => {
    const session = await requireSession();
    const isSysadmin = session.internalRoles.includes("sysadmin");
    let q = supabaseServer().from("guide_items").select("*").eq("portal", portal).order("section_key").order("sort_order").order("created_at");
    if (!isSysadmin) q = q.eq("active", true);
    const { data, error } = await q;
    if (error) throw new Error(error.message.includes("guide_items") ? GUIDE_TABLE_MISSING : error.message);
    return (data as Row[]).map(toItem);
  });
}

export type GuideItemInput = { id?: string; portal?: string; sectionKey: string; kind: GuideKind; title: string; url: string; caption?: string; active: boolean };

export async function saveGuideItemAction(input: GuideItemInput): Promise<ActionResult<GuideItem>> {
  return toResult(async () => {
    await requireSysadminSession();
    const portal = input.portal ?? "vendor";
    if (!VENDOR_GUIDE_SECTIONS.some((s) => s.key === input.sectionKey)) throw new Error("Bagian panduan tidak dikenal.");
    if (!["VIDEO", "IMAGE", "LINK"].includes(input.kind)) throw new Error("Jenis media tidak dikenal.");
    const title = input.title.trim();
    const caption = (input.caption ?? "").trim();
    if (title.length > 120) throw new Error("Judul maksimal 120 karakter.");
    if (caption.length > 400) throw new Error("Keterangan maksimal 400 karakter.");
    const rawUrl = input.url.trim();
    if (!parseHttpsUrl(rawUrl)) throw new Error("Tautan harus diawali https:// dan berupa alamat yang valid.");
    if (rawUrl.length > 1000) throw new Error("Tautan terlalu panjang.");
    if (input.kind === "VIDEO" && !videoEmbedFromUrl(rawUrl)) {
      throw new Error("Tautan video tidak dikenali. Gunakan tautan YouTube, Vimeo, Loom, atau Google Drive (tautan berbagi file).");
    }
    if (input.kind === "IMAGE" && !imageSrcFromUrl(rawUrl)) throw new Error("Tautan gambar harus https.");
    if (input.kind === "LINK" && !title) throw new Error("Judul wajib diisi untuk tautan.");

    const db = supabaseServer();
    const now = new Date().toISOString();
    if (input.id) {
      const { data, error } = await db
        .from("guide_items")
        .update({ section_key: input.sectionKey, kind: input.kind, title, url: rawUrl, caption: caption || null, active: input.active, updated_at: now })
        .eq("id", input.id)
        .select("*")
        .maybeSingle();
      if (error) throw new Error(error.message.includes("guide_items") ? GUIDE_TABLE_MISSING : error.message);
      if (!data) throw new Error("Media tidak ditemukan.");
      return toItem(data as Row);
    }
    // Item baru: taruh di urutan paling bawah bagiannya.
    const { data: last } = await db.from("guide_items").select("sort_order").eq("portal", portal).eq("section_key", input.sectionKey).order("sort_order", { ascending: false }).limit(1);
    const sortOrder = (last?.[0]?.sort_order ?? 0) + 10;
    const id = await nextReadableId("GUIDE");
    const { data, error } = await db
      .from("guide_items")
      .insert({ id, portal, section_key: input.sectionKey, kind: input.kind, title, url: rawUrl, caption: caption || null, sort_order: sortOrder, active: input.active })
      .select("*")
      .single();
    if (error) throw new Error(error.message.includes("guide_items") ? GUIDE_TABLE_MISSING : error.message);
    return toItem(data as Row);
  });
}

export async function deleteGuideItemAction(id: string): Promise<ActionResult<void>> {
  return toResult(async () => {
    await requireSysadminSession();
    const { error } = await supabaseServer().from("guide_items").delete().eq("id", id);
    if (error) throw new Error(error.message);
  });
}

/** Geser satu media naik/turun di dalam bagian yang sama (tukar nomor urut dengan tetangganya). */
export async function moveGuideItemAction(id: string, direction: "UP" | "DOWN"): Promise<ActionResult<void>> {
  return toResult(async () => {
    await requireSysadminSession();
    const db = supabaseServer();
    const { data: me } = await db.from("guide_items").select("id,portal,section_key,sort_order,created_at").eq("id", id).maybeSingle();
    if (!me) throw new Error("Media tidak ditemukan.");
    const { data: siblings } = await db.from("guide_items").select("id,sort_order,created_at").eq("portal", me.portal).eq("section_key", me.section_key).order("sort_order").order("created_at");
    const list = siblings ?? [];
    const idx = list.findIndex((s) => s.id === id);
    const swapIdx = direction === "UP" ? idx - 1 : idx + 1;
    if (idx < 0 || swapIdx < 0 || swapIdx >= list.length) return;
    // Tulis ulang nomor urut berurutan setelah menukar posisi, supaya nomor yang kebetulan sama tidak menggagalkan penukaran.
    const reordered = [...list];
    [reordered[idx], reordered[swapIdx]] = [reordered[swapIdx], reordered[idx]];
    for (let i = 0; i < reordered.length; i++) {
      const { error } = await db.from("guide_items").update({ sort_order: (i + 1) * 10 }).eq("id", reordered[i].id);
      if (error) throw new Error(error.message);
    }
  });
}
