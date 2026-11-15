import { ClipboardList, Package, Wallet, ShieldCheck, Factory, Warehouse, Crown, ShieldAlert, type LucideIcon } from "lucide-react";
import { INTERNAL_ACCOUNTS, type InternalRole } from "@/lib/internal-auth";

/** Daftar modul internal untuk halaman utama dan pemindah modul di bar atas (satu sumber, supaya
 *  ikon, warna, dan urutan selalu sama di dua tempat itu). Urutan kartu: owner 2026-09-27. */
export type ModuleInfo = { role: InternalRole; label: string; desc: string; icon: LucideIcon; color: string };

export const MODULES: ModuleInfo[] = [
  { role: "ppic", label: "PPIC", desc: "Planning & MRP", icon: ClipboardList, color: "#3B82F6" },
  { role: "procurement", label: "Procurement", desc: "PO & invoice", icon: Package, color: "#F59E0B" },
  { role: "finance", label: "Finance", desc: "Approval & bayar", icon: Wallet, color: "#10B981" },
  { role: "produksi", label: "Produksi", desc: "Monitoring vendor", icon: Factory, color: "#06B6D4" },
  { role: "warehouse", label: "Warehouse", desc: "Penerimaan koli", icon: Warehouse, color: "#EC4899" },
  { role: "scm", label: "SCM", desc: "Approval MRP & PO", icon: ShieldCheck, color: "#6366F1" },
  { role: "gm", label: "General Manager", desc: "Approval PO L4", icon: Crown, color: "#EAB308" },
  { role: "sysadmin", label: "Sysadmin", desc: "Akun & koreksi", icon: ShieldAlert, color: "#8B5CF6" },
];

export function moduleHomeHref(role: InternalRole): string {
  return INTERNAL_ACCOUNTS.find((a) => a.role === role)?.homeHref ?? "/";
}
