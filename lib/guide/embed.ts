/** Normalisasi tautan media panduan (murni fungsi, dipakai klien dan server). Hanya tautan https yang diterima; video hanya
 *  dari penyedia yang diizinkan (supaya iframe tidak bisa memuat halaman sembarang), dan tautan "tonton" diubah ke
 *  tautan sematan (embed) masing-masing. */

export function parseHttpsUrl(raw: string): URL | null {
  try {
    const u = new URL(raw.trim());
    return u.protocol === "https:" ? u : null;
  } catch {
    return null;
  }
}

export type VideoEmbed = { provider: "YouTube" | "Vimeo" | "Loom" | "Google Drive"; embedUrl: string };

/** Ubah tautan video biasa jadi tautan sematan. null = tidak dikenali / penyedia tidak diizinkan. */
export function videoEmbedFromUrl(raw: string): VideoEmbed | null {
  const u = parseHttpsUrl(raw);
  if (!u) return null;
  const host = u.hostname.replace(/^www\./, "").toLowerCase();

  // YouTube: watch?v=ID, youtu.be/ID, /shorts/ID, /embed/ID, /live/ID
  if (host === "youtube.com" || host === "m.youtube.com" || host === "youtube-nocookie.com" || host === "youtu.be") {
    let id = "";
    if (host === "youtu.be") id = u.pathname.split("/")[1] ?? "";
    else if (u.pathname === "/watch") id = u.searchParams.get("v") ?? "";
    else {
      const m = u.pathname.match(/^\/(?:embed|shorts|live)\/([^/?#]+)/);
      id = m?.[1] ?? "";
    }
    if (!/^[A-Za-z0-9_-]{6,20}$/.test(id)) return null;
    return { provider: "YouTube", embedUrl: `https://www.youtube-nocookie.com/embed/${id}` };
  }

  // Vimeo: vimeo.com/ID atau player.vimeo.com/video/ID
  if (host === "vimeo.com" || host === "player.vimeo.com") {
    const m = u.pathname.match(/(?:\/video)?\/(\d{5,12})/);
    if (!m) return null;
    return { provider: "Vimeo", embedUrl: `https://player.vimeo.com/video/${m[1]}` };
  }

  // Loom: loom.com/share/ID atau loom.com/embed/ID
  if (host === "loom.com") {
    const m = u.pathname.match(/^\/(?:share|embed)\/([A-Za-z0-9]{10,40})/);
    if (!m) return null;
    return { provider: "Loom", embedUrl: `https://www.loom.com/embed/${m[1]}` };
  }

  // Google Drive: drive.google.com/file/d/ID/view
  if (host === "drive.google.com") {
    const m = u.pathname.match(/^\/file\/d\/([A-Za-z0-9_-]{10,80})/);
    if (!m) return null;
    return { provider: "Google Drive", embedUrl: `https://drive.google.com/file/d/${m[1]}/preview` };
  }
  return null;
}

/** Tautan gambar: https apa pun; tautan berbagi Google Drive diubah ke tautan gambar langsung. null = bukan https. */
export function imageSrcFromUrl(raw: string): string | null {
  const u = parseHttpsUrl(raw);
  if (!u) return null;
  if (u.hostname.replace(/^www\./, "") === "drive.google.com") {
    const m = u.pathname.match(/^\/file\/d\/([A-Za-z0-9_-]{10,80})/);
    if (m) return `https://lh3.googleusercontent.com/d/${m[1]}`;
  }
  return u.toString();
}
