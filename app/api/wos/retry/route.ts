import { processWosOutbox } from "@/lib/mrp/wosPush";
import { safeEqualHex } from "@/lib/mrp/wosSign";

/** Kirim ulang antrean WOS yang gagal. Dipanggil Vercel Cron (vercel.json) dengan header `Authorization: Bearer <CRON_SECRET>`;
 *  tanpa env CRON_SECRET rute ini menolak semua permintaan. */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  const given = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!secret || !safeEqualHex(secret, given)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const result = await processWosOutbox(25);
  return Response.json(result, { headers: { "Cache-Control": "no-store" } });
}
