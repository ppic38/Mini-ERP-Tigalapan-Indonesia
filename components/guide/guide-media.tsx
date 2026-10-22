"use client";

import { ExternalLink } from "lucide-react";
import type { GuideItem } from "@/lib/guide/sections";
import { imageSrcFromUrl, videoEmbedFromUrl } from "@/lib/guide/embed";

/** Tampilan satu media panduan (video sematan, gambar, atau tautan) -- dipakai halaman Panduan vendor dan pratinjau
 *  Sysadmin. Video dimuat malas (lazy) supaya halaman tidak berat. */
export function GuideMedia({ item }: { item: Pick<GuideItem, "kind" | "title" | "url" | "caption"> }) {
  if (item.kind === "VIDEO") {
    const embed = videoEmbedFromUrl(item.url);
    if (!embed) return <div className="rounded-md border border-danger bg-danger-bg px-3 py-2 font-sans text-[11.5px] text-danger-fg">Tautan video tidak dikenali.</div>;
    return (
      <figure className="flex flex-col gap-1.5">
        {item.title && <figcaption className="font-sans text-[12px] font-semibold text-text-primary">{item.title}</figcaption>}
        <div className="relative w-full overflow-hidden rounded-md border border-border-subtle bg-black" style={{ aspectRatio: "16 / 9" }}>
          <iframe
            src={embed.embedUrl}
            title={item.title || "Video panduan"}
            loading="lazy"
            allow="fullscreen; picture-in-picture; clipboard-write; encrypted-media"
            allowFullScreen
            referrerPolicy="strict-origin-when-cross-origin"
            sandbox="allow-scripts allow-same-origin allow-presentation allow-popups"
            className="absolute inset-0 h-full w-full"
          />
        </div>
        {item.caption && <p className="font-sans text-[11.5px] text-text-muted">{item.caption}</p>}
      </figure>
    );
  }
  if (item.kind === "IMAGE") {
    const src = imageSrcFromUrl(item.url);
    if (!src) return <div className="rounded-md border border-danger bg-danger-bg px-3 py-2 font-sans text-[11.5px] text-danger-fg">Tautan gambar tidak valid.</div>;
    return (
      <figure className="flex flex-col gap-1.5">
        {item.title && <figcaption className="font-sans text-[12px] font-semibold text-text-primary">{item.title}</figcaption>}
        <a href={src} target="_blank" rel="noopener noreferrer" title="Klik untuk memperbesar" className="block overflow-hidden rounded-md border border-border-subtle bg-white">
          {/* eslint-disable-next-line @next/next/no-img-element -- tautan dari luar (hosting bebas), bukan aset aplikasi */}
          <img src={src} alt={item.title || item.caption || "Gambar panduan"} loading="lazy" referrerPolicy="no-referrer" className="h-auto max-h-[520px] w-full object-contain" />
        </a>
        {item.caption && <p className="font-sans text-[11.5px] text-text-muted">{item.caption}</p>}
      </figure>
    );
  }
  return (
    <a
      href={item.url}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-2 rounded-md border border-border-subtle bg-white px-3 py-2 font-sans text-[12px] font-semibold text-action-primary hover:border-accent-blue"
    >
      <ExternalLink size={14} />
      <span>
        {item.title || item.url}
        {item.caption && <span className="block text-[11px] font-normal text-text-muted">{item.caption}</span>}
      </span>
    </a>
  );
}
