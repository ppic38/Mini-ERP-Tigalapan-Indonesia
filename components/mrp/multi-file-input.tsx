"use client";

import { useRef, useState } from "react";
import type { AttachFile } from "@/lib/mrp/attachments";

/** Kotak unggah lampiran LEBIH DARI SATU file (maksimal 5). Pilih beberapa file sekaligus atau tambah satu per satu; tiap file bisa dihapus sebelum disimpan.
 *  Pembacaan dan batas ukuran file dipasok pemanggil (`readFile`), jadi aturan yang sudah ada tiap tempat (PDF/JPG/PNG atau gambar saja) tidak berubah. */
export function MultiFileInput({
  files,
  onChange,
  readFile,
  accept,
  max = 5,
  disabled,
  inputClassName,
}: {
  files: AttachFile[];
  onChange: (files: AttachFile[]) => void;
  readFile: (file: File) => Promise<AttachFile | { error: string }>;
  accept: string;
  max?: number;
  disabled?: boolean;
  inputClassName?: string;
}) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const locked = !!disabled || busy || files.length >= max;

  async function pick(list: FileList | null) {
    if (!list || list.length === 0) return;
    setError("");
    setBusy(true);
    const next = [...files];
    let firstError = "";
    for (const f of Array.from(list)) {
      if (next.length >= max) {
        firstError = firstError || `Maksimal ${max} file per lampiran.`;
        break;
      }
      const r = await readFile(f);
      if ("error" in r) firstError = firstError || `${f.name}: ${r.error}`;
      else next.push(r);
    }
    setBusy(false);
    if (firstError) setError(firstError);
    onChange(next);
    if (inputRef.current) inputRef.current.value = "";
  }

  // Seret file dari komputer ke kotak ini (drag and drop); tetap bisa memilih lewat tombol. Berlaku di semua tempat yang memakai komponen ini.
  return (
    <div
      className={"flex flex-col gap-1.5 rounded-md transition-colors " + (dragging ? "bg-info-bg outline-dashed outline-2 outline-offset-2 outline-accent-blue" : "")}
      onDragOver={(e) => {
        if (locked || !e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
        if (!dragging) setDragging(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        if (locked) return;
        void pick(e.dataTransfer.files);
      }}
    >
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={accept}
        disabled={disabled || busy || files.length >= max}
        onChange={(e) => void pick(e.target.files)}
        className={inputClassName ?? "w-full text-[11.5px] file:mr-2 file:rounded-md file:border-0 file:bg-[#EEF1F4] file:px-3 file:py-1.5 file:font-sans file:text-[11.5px] file:font-semibold file:text-text-primary"}
      />
      {busy && <span className="font-sans text-[11px] text-text-muted">Memproses file…</span>}
      {files.length === 0 && !busy && !error && <span className="font-sans text-[11px] text-text-muted">{dragging ? "Lepas file di sini." : `Belum ada file dipilih. Pilih atau seret file ke sini; boleh lebih dari satu (maks ${max}).`}</span>}
      {files.length > 0 && (
        <ul className="flex flex-col gap-1">
          {files.map((f, i) => (
            <li key={`${f.fileName}-${i}`} className="flex items-center gap-2 font-sans text-[11px] font-medium text-success-fg">
              <span className="min-w-0 flex-1 truncate">✓ {f.fileName}</span>
              <button type="button" onClick={() => onChange(files.filter((_, idx) => idx !== i))} className="flex-none text-text-muted hover:text-danger-fg" aria-label={`Hapus ${f.fileName}`}>
                ✕
              </button>
            </li>
          ))}
          <li className="font-sans text-[10.5px] text-text-muted">{files.length} dari maksimal {max} file</li>
        </ul>
      )}
      {error && <span className="font-sans text-[11px] font-medium text-danger-fg">{error}</span>}
    </div>
  );
}
