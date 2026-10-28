import { supabaseServer } from "@/lib/supabase/server";
import { loadResiFiles, wosConfig } from "@/lib/mrp/wosPush";
import { verifyFileLink } from "@/lib/mrp/wosSign";

/** Satu file lampiran resi untuk WOS, dibuka lewat tautan bertanda tangan (tanpa sesi login). */
export async function GET(request: Request) {
  const cfg = wosConfig();
  if (!cfg) return Response.json({ error: "Integrasi WOS belum diaktifkan." }, { status: 503 });
  const q = new URL(request.url).searchParams;
  const resi = q.get("resi") ?? "";
  const index = Number(q.get("i"));
  const exp = Number(q.get("exp"));
  const sig = q.get("sig") ?? "";
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(resi) || !Number.isInteger(index) || index < 0 || !verifyFileLink(cfg.secret, "file", resi, index, exp, sig)) {
    return Response.json({ error: "Tautan tidak valid atau sudah kedaluwarsa." }, { status: 401 });
  }
  const file = (await loadResiFiles(supabaseServer(), resi))[index];
  if (!file) return Response.json({ error: "File tidak ditemukan." }, { status: 404 });

  const m = /^data:([^;,]+)(;base64)?,([\s\S]*)$/.exec(file.dataUrl);
  if (!m) return Response.json({ error: "Format file tidak dikenali." }, { status: 500 });
  const contentType = m[1];
  const bytes = m[2] ? Buffer.from(m[3], "base64") : Buffer.from(decodeURIComponent(m[3]));
  const name = (file.fileName ?? `resi-${resi}-${index + 1}`).replace(/[^\w.\- ]+/g, "_");
  return new Response(new Uint8Array(bytes), {
    headers: { "Content-Type": contentType, "Content-Disposition": `inline; filename="${name}"`, "Cache-Control": "no-store" },
  });
}
