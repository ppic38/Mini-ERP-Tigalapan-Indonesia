import { supabaseServer } from "@/lib/supabase/server";
import { buildAttachments, loadResiFiles, wosConfig } from "@/lib/mrp/wosPush";
import { verifyFileLink } from "@/lib/mrp/wosSign";

/** Daftar lampiran satu resi untuk WOS (selalu data terbaru). Dibuka lewat tautan bertanda tangan dari kiriman `resi.created`
 *  (lihat lib/mrp/wosPush.ts); tidak memakai sesi login. Respons: { resiGroupId, files: [{ index, fileName, url }] }. */
export async function GET(request: Request) {
  const cfg = wosConfig();
  if (!cfg) return Response.json({ error: "Integrasi WOS belum diaktifkan." }, { status: 503 });
  const q = new URL(request.url).searchParams;
  const resi = q.get("resi") ?? "";
  const exp = Number(q.get("exp"));
  const sig = q.get("sig") ?? "";
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(resi) || !verifyFileLink(cfg.secret, "list", resi, 0, exp, sig)) {
    return Response.json({ error: "Tautan tidak valid atau sudah kedaluwarsa." }, { status: 401 });
  }
  const db = supabaseServer();
  const files = await loadResiFiles(db, resi);
  const attachments = await buildAttachments(cfg, db, resi, 24 * 3600);
  return Response.json({ resiGroupId: resi, count: files.length, files: attachments.files }, { headers: { "Cache-Control": "no-store" } });
}
