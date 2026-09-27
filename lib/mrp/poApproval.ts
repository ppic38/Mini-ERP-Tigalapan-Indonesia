/** Matriks Approval Purchase Order (owner 2026-09-26, dokumen "5.2 Approval Matrix PO") -- logika MURNI
 *  (tanpa I/O) yang dipakai bersama server (lib/mrp/actions.ts) dan layar (portal Procurement/Finance/
 *  SCM/General Manager). Berlaku untuk PO Material & PO Produksi, MENGGANTIKAN approval Finance tunggal:
 *
 *   Level 1  Rp 0 – 2 jt           Procurement Staff                    SLA 1 hari
 *   Level 2  > 2 jt – 50 jt        Asisten Manager Procurement          SLA 1 hari
 *   Level 3  > 50 jt – 200 jt      FAT Manager (Finance) + SCM Manager  SLA 2 hari
 *   Level 4  > 200 jt              General Manager / Board of Director  SLA 2 hari
 *
 *  Approval BERLAPIS BERURUTAN: PO level N harus lewat langkah 1..N. Langkah 1 = pengajuan oleh
 *  Procurement ("Kirim PO ke Finance") -> otomatis dianggap setuju. Langkah 3 butuh DUA persetujuan
 *  (Finance dan SCM, urutan bebas). Satu login per modul (bukan per jabatan): Level 1 vs 2 dibedakan
 *  lewat LANGKAH-nya (2 klik terpisah di portal Procurement), bukan lewat orangnya. Ditolak di level
 *  manapun -> PO kembali ke Procurement, diajukan ulang dari awal. PO lama (approval_level kosong)
 *  tetap memakai alur lama: 1 approval Finance. */

export type ApprovalRole = "procurement" | "finance" | "scm" | "gm";

export type PoApprovalEntry = {
  step: number;
  role: ApprovalRole;
  action: "APPROVED" | "REJECTED";
  at: string;
  note?: string;
};

export const APPROVAL_LEVEL_TABLE = [
  { level: 1, max: 2_000_000, label: "Level 1", approver: "Procurement Staff", slaDays: 1, keterangan: "Pembelian rutin nilai kecil" },
  { level: 2, max: 50_000_000, label: "Level 2", approver: "Asisten Manager Procurement", slaDays: 1, keterangan: "Memerlukan review harga & vendor" },
  { level: 3, max: 200_000_000, label: "Level 3", approver: "FAT Manager + SCM Manager", slaDays: 2, keterangan: "Memerlukan validasi anggaran FAT" },
  { level: 4, max: Infinity, label: "Level 4", approver: "General Manager / Board of Director", slaDays: 2, keterangan: "Nilai besar, kontrak jangka panjang, atau capex" },
] as const;

/** Level yang dibutuhkan untuk nilai PO tertentu (batas atas inklusif: tepat Rp 2.000.000 = Level 1). */
export function approvalLevelForAmount(amount: number): 1 | 2 | 3 | 4 {
  const a = Number.isFinite(amount) ? Math.max(0, amount) : 0;
  if (a <= 2_000_000) return 1;
  if (a <= 50_000_000) return 2;
  if (a <= 200_000_000) return 3;
  return 4;
}

/** Siapa (portal mana) yang harus menyetujui tiap langkah. */
export const APPROVAL_STEP_ROLES: Record<number, ApprovalRole[]> = {
  1: ["procurement"],
  2: ["procurement"],
  3: ["finance", "scm"],
  4: ["gm"],
};

export const APPROVAL_STEP_LABEL: Record<number, string> = {
  1: "Level 1 · Procurement Staff",
  2: "Level 2 · Asisten Manager Procurement",
  3: "Level 3 · FAT Manager + SCM Manager",
  4: "Level 4 · General Manager",
};

export const APPROVAL_ROLE_LABEL: Record<ApprovalRole, string> = {
  procurement: "Procurement",
  finance: "Finance (FAT Manager)",
  scm: "SCM (SCM Manager)",
  gm: "General Manager",
};

export const APPROVAL_STEP_SLA_DAYS: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 2 };

export type PoApprovalSubject = {
  approved: boolean;
  approvalLevel?: number | null;
  approvalLog?: PoApprovalEntry[] | null;
  approvalSubmittedAt?: string | null;
};

export type PoApprovalState = {
  /** PO lama (sebelum matriks ini): alur 1 approval Finance. */
  legacy: boolean;
  level: number | null;
  approved: boolean;
  rejected: boolean;
  rejectNote?: string;
  rejectedBy?: ApprovalRole;
  /** Langkah yang sedang menunggu (null kalau sudah selesai/ditolak/legacy). */
  currentStep: number | null;
  /** Portal yang MASIH harus menyetujui langkah ini. */
  pendingRoles: ApprovalRole[];
  /** Portal yang sudah menyetujui langkah ini (khusus langkah 3 yang butuh 2 persetujuan). */
  doneRolesInStep: ApprovalRole[];
  /** Entri log siklus pengajuan yang sedang berjalan (sejak pengajuan terakhir). */
  cycle: PoApprovalEntry[];
  stepStartedAt?: string;
  slaDueAt?: string;
  overdue: boolean;
};

/** Hitung status approval sebuah PO dari level + log-nya. */
export function poApprovalState(po: PoApprovalSubject, now: Date = new Date()): PoApprovalState {
  const level = po.approvalLevel ?? null;
  if (level == null) {
    return {
      legacy: true,
      level: null,
      approved: po.approved,
      rejected: false,
      currentStep: po.approved ? null : 3,
      pendingRoles: po.approved ? [] : ["finance"],
      doneRolesInStep: [],
      cycle: [],
      overdue: false,
    };
  }
  const log = po.approvalLog ?? [];
  // Siklus berjalan = sejak entri langkah-1 TERAKHIR (pengajuan / pengajuan ulang).
  let start = 0;
  for (let i = log.length - 1; i >= 0; i--) {
    if (log[i].step === 1 && log[i].action === "APPROVED") {
      start = i;
      break;
    }
  }
  const cycle = log.slice(start);
  const last = cycle[cycle.length - 1];
  const rejected = !!last && last.action === "REJECTED";
  if (po.approved) {
    return { legacy: false, level, approved: true, rejected: false, currentStep: null, pendingRoles: [], doneRolesInStep: [], cycle, overdue: false };
  }
  if (rejected) {
    return { legacy: false, level, approved: false, rejected: true, rejectNote: last.note, rejectedBy: last.role, currentStep: null, pendingRoles: [], doneRolesInStep: [], cycle, overdue: false };
  }

  const approvedBy = (step: number) => cycle.filter((e) => e.step === step && e.action === "APPROVED").map((e) => e.role);
  let currentStep: number | null = null;
  for (let s = 2; s <= level; s++) {
    const need = APPROVAL_STEP_ROLES[s] ?? [];
    const have = approvedBy(s);
    if (!need.every((r) => have.includes(r))) {
      currentStep = s;
      break;
    }
  }
  if (currentStep == null) {
    // Semua langkah tercatat setuju (mis. baru saja dilengkapi) -- dianggap selesai.
    return { legacy: false, level, approved: true, rejected: false, currentStep: null, pendingRoles: [], doneRolesInStep: [], cycle, overdue: false };
  }
  const need = APPROVAL_STEP_ROLES[currentStep] ?? [];
  const done = approvedBy(currentStep);
  // Waktu mulai langkah = saat langkah sebelumnya selesai (entri APPROVED terakhir sebelum langkah ini).
  const previous = cycle.filter((e) => e.step < currentStep && e.action === "APPROVED");
  const stepStartedAt = previous.length > 0 ? previous[previous.length - 1].at : (po.approvalSubmittedAt ?? cycle[0]?.at ?? undefined);
  const slaDays = APPROVAL_STEP_SLA_DAYS[currentStep] ?? 1;
  const slaDueAt = stepStartedAt ? new Date(Date.parse(stepStartedAt) + slaDays * 86_400_000).toISOString() : undefined;
  return {
    legacy: false,
    level,
    approved: false,
    rejected: false,
    currentStep,
    pendingRoles: need.filter((r) => !done.includes(r)),
    doneRolesInStep: done,
    cycle,
    stepStartedAt,
    slaDueAt,
    overdue: !!slaDueAt && now.getTime() > Date.parse(slaDueAt),
  };
}

/** Ringkasan satu baris untuk badge/status, mis. "Menunggu Level 3 (FAT Manager)". */
export function poApprovalSummary(state: PoApprovalState): string {
  if (state.approved) return "Disetujui";
  if (state.legacy) return "Menunggu Finance";
  if (state.rejected) return "Ditolak — perbaiki & ajukan ulang";
  if (state.currentStep == null) return "—";
  const who = state.pendingRoles.map((r) => (r === "finance" ? "FAT Manager" : r === "scm" ? "SCM Manager" : r === "gm" ? "General Manager" : "Asisten Manager")).join(" + ");
  return `Menunggu Level ${state.currentStep} (${who})`;
}

/** Teks blok "Disetujui oleh" pada cetakan PO (PDF/Excel): PO lama = Finance; PO bermatriks = level & jabatan. */
export function poApprovalPrintInfo(po: PoApprovalSubject): { role: string; name: string; pendingText: string } {
  const state = poApprovalState(po);
  if (state.legacy || state.level == null) return { role: "Finance", name: "Finance", pendingText: "Belum disetujui Finance" };
  const row = APPROVAL_LEVEL_TABLE[Math.min(3, Math.max(0, state.level - 1))];
  return { role: `Level ${state.level}`, name: row.approver, pendingText: poApprovalSummary(state) };
}
