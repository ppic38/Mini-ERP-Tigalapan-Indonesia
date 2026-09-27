import { NextResponse, type NextRequest } from "next/server";
import { readSession } from "@/lib/auth/session";
import type { InternalRole } from "@/lib/internal-auth";

/**
 * Proteksi rute DENY-BY-DEFAULT (menggantikan AppShell.GATED_ROLES yang tadinya cuma
 * allowlist 5 dari 8 role, dan bikin `/dashboard/admin` & `/dashboard/vendor-supplier`
 * bisa diakses langsung via URL tanpa password sama sekali).
 *
 * Path yang tidak cocok satupun aturan di bawah -> ditolak (redirect ke "/"), TERMASUK
 * admin & vendor-supplier (belum ada login-nya sama sekali di app ini -- lihat catatan
 * di plan migrasi, sengaja belum dibangun, jadi untuk sekarang cukup ditutup total).
 *
 * PENTING (lihat docs Next.js versi ini, node_modules/next/dist/docs/.../proxy.md):
 * proxy TIDAK otomatis melindungi Server Function -- kalau matcher di bawah suatu saat
 * berubah dan tidak lagi mencakup path tempat sebuah Server Action dipanggil, proxy ini
 * dilewati begitu saja untuk request itu. Jangan andalkan proxy sebagai satu-satunya
 * lapisan proteksi -- setiap Server Action yang memutasi data (lib/mrp/actions.ts, dst.)
 * WAJIB tetap verifikasi sesi sendiri di awal fungsinya.
 */
const INTERNAL_ROLE_PREFIXES: [prefix: string, role: InternalRole][] = [
  ["/dashboard/ppic", "ppic"],
  ["/mrp", "ppic"],
  ["/dashboard/procurement", "procurement"],
  ["/procurement", "procurement"],
  ["/raw-material", "procurement"],
  ["/dashboard/finance", "finance"],
  ["/finance", "finance"],
  ["/scm", "scm"],
  ["/gm", "gm"],
  ["/sysadmin", "sysadmin"],
  ["/produksi", "produksi"],
  ["/warehouse", "warehouse"],
];

// Logo kop PO (public/tigalapan-logo-kop.png) dimuat browser untuk dicetak ke PDF -- tanpa pengecualian ini
// proxy mengalihkan requestnya ke "/" (HTML, bukan gambar) sehingga logo tidak pernah muncul di PO.
const PUBLIC_PATHS = ["/", "/vendor-maklon/login", "/gate-to-gate", "/tigalapan-logo-kop.png"];

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (PUBLIC_PATHS.includes(pathname)) return NextResponse.next();

  const session = await readSession(request.cookies);

  if (pathname.startsWith("/vendor-maklon")) {
    if (!session.vendorId) return NextResponse.redirect(new URL("/vendor-maklon/login", request.url));
    // Akun anggota tim (migration 0057, owner 2026-09-27: "tim cutting, tim finish good,
    // packing") -- dibatasi ke halaman yang diizinkan saja, DAN tidak boleh membuka "Tim Saya"
    // (kelola akun lain) sama sekali walau kebetulan ada di allowedPages. Akun UTAMA vendor
    // (vendorActor null) tetap akses penuh, tidak berubah dari sebelumnya.
    if (session.vendorActor) {
      if (pathname === "/vendor-maklon/team") return NextResponse.redirect(new URL(session.vendorActor.allowedPages[0] ?? "/vendor-maklon/po-produksi", request.url));
      const allowed = session.vendorActor.allowedPages.some((p) => pathname === p || pathname.startsWith(p + "/"));
      if (!allowed) return NextResponse.redirect(new URL(session.vendorActor.allowedPages[0] ?? "/vendor-maklon/login", request.url));
    }
    return NextResponse.next();
  }

  const match = INTERNAL_ROLE_PREFIXES.find(([prefix]) => pathname.startsWith(prefix));
  if (match) {
    const [, requiredRole] = match;
    if (session.internalRoles.includes(requiredRole)) return NextResponse.next();
    return NextResponse.redirect(new URL("/", request.url));
  }

  // Path tidak dikenal (termasuk /dashboard/admin, /dashboard/vendor-supplier) -> tolak.
  return NextResponse.redirect(new URL("/", request.url));
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
