"use client";

import { addAttachmentExtraAction, clearAttachmentExtrasAction, getAttachmentFilesAction, type AttachmentKind } from "./actions";
import { downloadDataUrl, fillPreviewWindow, fillPreviewWindowMulti, openPreviewWindow } from "./clientFiles";

/** Lampiran lebih dari satu file (migration 0080). File PERTAMA dikirim lewat aksi utama seperti dulu; file ke-2 dan seterusnya disimpan di sini, satu panggilan per file
 *  (supaya tiap panggilan tetap di bawah batas ukuran Server Action). Satu tombol "Lihat / Download" membuka semua file sekaligus. */

export type AttachFile = { dataUrl: string; fileName: string };

/** Simpan file tambahan (index 1 dst. dari daftar) untuk satu atau beberapa lampiran. Selalu membersihkan file tambahan lama dulu, supaya unggah ulang tidak
 *  menyisakan file lama. Mengembalikan pesan kegagalan, atau null kalau berhasil. Hanya satu file = tidak ada yang ditambah; kegagalan membersihkan saat itu diabaikan
 *  (mis. migration 0080 belum dijalankan) karena tidak ada file tambahan yang perlu disimpan. */
export async function saveExtraAttachments(kind: AttachmentKind, refIds: string[], files: AttachFile[]): Promise<string | null> {
  const extras = files.slice(1);
  for (const refId of refIds) {
    const cleared = await clearAttachmentExtrasAction(kind, refId);
    if (!cleared.ok && extras.length > 0) return cleared.error;
    for (const file of extras) {
      const added = await addAttachmentExtraAction(kind, refId, file);
      if (!added.ok) return added.error;
    }
  }
  return null;
}

/** Buka semua file satu lampiran dalam satu tab. Tab dibuka SEKARANG (sebelum await) supaya tidak diblokir popup blocker. Satu file langsung dibuka seperti biasa. */
export async function viewAttachments(kind: AttachmentKind, refId: string, emptyMessage = "Lampiran belum ada."): Promise<void> {
  const win = openPreviewWindow();
  try {
    const res = await getAttachmentFilesAction(kind, refId);
    if (!res.ok) {
      win?.close();
      window.alert("Gagal membuka lampiran: " + res.error);
      return;
    }
    const files = res.data;
    if (files.length === 0) {
      win?.close();
      window.alert(emptyMessage);
      return;
    }
    if (files.length === 1) {
      fillPreviewWindow(win, files[0].dataUrl);
      return;
    }
    if (win) fillPreviewWindowMulti(win, files);
    else files.forEach((f, i) => setTimeout(() => downloadDataUrl(f.dataUrl, f.fileName ?? `lampiran-${i + 1}`), i * 400));
  } catch (err) {
    win?.close();
    window.alert("Gagal membuka lampiran: " + (err instanceof Error ? err.message : String(err)));
  }
}
