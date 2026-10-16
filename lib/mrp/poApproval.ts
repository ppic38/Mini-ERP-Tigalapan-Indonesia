/** Matriks Approval Purchase Order (owner 2026-09-26, dokumen "5.2 Approval Matrix PO") -- logika MURNI
 *  (tanpa I/O) yang dipakai bersama server (lib/mrp/actions.ts) dan layar (portal Procurement/Finance/
 *  SCM/General Manager). Berlaku untuk PO Material & PO Produksi, MENGGANTIKAN approval Finance tunggal:
 *
 *   Level 1  Rp 0 – 2 jt           Procurement Staff                    SLA 1 hari
 *   Level 2  > 2 jt – 50 jt        SCM (portal SCM)                     SLA 1 hari   (revisi 2026-10-14: dulu "Asisten Manager Procurement")
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
  /** Nama orang yang klik (migration 0060, owner 2026-09-29: "biar tau siapa PIC-nya") -- label
   *  modul (mis. "Procurement") kalau login lewat akun utama, atau nama anggota tim kalau login
   *  lewat akun sub-user. Opsional -- entri lama (sebelum revisi ini) tidak punya field ini sama
   *  sekali, jsonb jadi tidak perlu migrasi data. */
  actorName?: string;
};

export const APPROVAL_LEVEL_TABLE = [
  { level: 1, max: 2_000_000, label: "Level 1", approver: "Procurement Staff", slaDays: 1, keterangan: "Pembelian rutin nilai kecil" },
  { level: 2, max: 50_000_000, label: "Level 2", approver: "SCM", slaDays: 1, keterangan: "Memerlukan review harga & vendor" },
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

/** Siapa (portal mana) yang harus menyetujui tiap langkah. Revisi 2026-10-14 (owner: tidak ada akun "Asisten Manager",
 *  Level 2 diganti SCM): langkah 2 disetujui portal SCM, bukan Procurement. */
export const APPROVAL_STEP_ROLES: Record<number, ApprovalRole[]> = {
  1: ["procurement"],
  2: ["scm"],
  3: ["finance", "scm"],
  4: ["gm"],
};

/** Persetujuan langkah 2 yang SUDAH tercatat oleh Procurement (sebelum Level 2 dipindah ke SCM) tetap dianggap sah, supaya PO
 *  yang sudah melewati Level 2 tidak mundur lagi ke antrean SCM. */
const APPROVAL_STEP_LEGACY_ROLES: Record<number, ApprovalRole[]> = { 2: ["procurement"] };

export const APPROVAL_STEP_LABEL: Record<number, string> = {
  1: "Level 1 · Procurement Staff",
  2: "Level 2 · SCM",
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
    const doneByLegacy = (APPROVAL_STEP_LEGACY_ROLES[s] ?? []).some((r) => have.includes(r));
    if (!doneByLegacy && !need.every((r) => have.includes(r))) {
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
  const who = state.pendingRoles
    .map((r) => (r === "finance" ? "FAT Manager" : r === "scm" ? (state.currentStep === 2 ? "SCM" : "SCM Manager") : r === "gm" ? "General Manager" : "Procurement"))
    .join(" + ");
  return `Menunggu Level ${state.currentStep} (${who})`;
}

/** Teks blok "Disetujui oleh" pada cetakan PO (PDF/Excel): PO lama = Finance; PO bermatriks = level & jabatan. */
/** Satu kotak tanda tangan di cetakan PO: 1 kotak per orang/slot persetujuan (revisi 2026-10-16). */
export type PoApprovalSignBox = {
  heading: string;
  role: string;
  /** Singkatan peran untuk bagan ringkas ("Procurement", "SCM", "FAT", "GM"). */
  short: string;
  /** Nomor langkah/level (1 = pengajuan). */
  step: number;
  state: "SUBMITTED" | "APPROVED" | "PENDING" | "REJECTED";
  name: string;
  /** Tanggal lokal yyyy-mm-dd (kosong kalau belum ada tindakan). */
  date?: string;
};

function localDateOf(iso?: string | null): string | undefined {
  if (!iso) return undefined;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const SLOT_TITLE: Record<ApprovalRole, string> = { procurement: "Procurement", finance: "FAT Manager", scm: "SCM", gm: "General Manager" };
const SLOT_SHORT: Record<ApprovalRole, string> = { procurement: "Procurement", finance: "FAT", scm: "SCM", gm: "GM" };

/** Daftar kotak tanda tangan: "Diajukan oleh" lalu SATU kotak untuk tiap penyetuju yang dibutuhkan (mis. Level 3 =
 *  SCM L2, FAT, SCM L3). Yang sudah setuju terisi nama + tanggal; yang belum tetap muncul sebagai kotak kosong
 *  berstatus "BELUM DISETUJUI". `submittedDate`/`approvedDate` (yyyy-mm-dd) dipakai bila log tidak punya waktu. */
export function poApprovalSignBoxes(po: PoApprovalSubject, submittedDate?: string, approvedDate?: string): PoApprovalSignBox[] {
  const state = poApprovalState(po);
  const submitEntry = state.cycle.find((e) => e.step === 1 && e.action === "APPROVED");
  const boxes: PoApprovalSignBox[] = [
    {
      heading: "DIAJUKAN OLEH",
      role: "Procurement",
      short: "Procurement",
      step: 1,
      state: "SUBMITTED",
      name: submitEntry?.actorName?.trim() || "Tim Procurement",
      date: localDateOf(submitEntry?.at) ?? submittedDate,
    },
  ];
  if (state.legacy || state.level == null || state.level <= 1) {
    const title = state.legacy || state.level == null ? "Finance" : "Procurement Staff";
    boxes.push({ heading: "DISETUJUI OLEH", role: state.legacy || state.level == null ? "Finance" : "Level 1", short: state.legacy || state.level == null ? "Finance" : "Procurement", step: state.legacy || state.level == null ? 3 : 1, state: po.approved ? "APPROVED" : "PENDING", name: title, date: po.approved ? approvedDate : undefined });
    return boxes;
  }
  const last = state.cycle[state.cycle.length - 1];
  for (let s = 2; s <= state.level; s++) {
    for (const role of APPROVAL_STEP_ROLES[s] ?? []) {
      const accepted: ApprovalRole[] = [role, ...(APPROVAL_STEP_LEGACY_ROLES[s] ?? [])];
      const hit = state.cycle.find((e) => e.step === s && e.action === "APPROVED" && accepted.includes(e.role));
      const title = role === "scm" && s === 3 ? "SCM Manager" : SLOT_TITLE[role];
      const heading = "DISETUJUI OLEH";
      const roleText = `Level ${s} · ${SLOT_SHORT[role]}`;
      if (hit) {
        boxes.push({ heading, role: roleText, short: SLOT_SHORT[role], step: s, state: "APPROVED", name: hit.actorName?.trim() || title, date: localDateOf(hit.at) });
      } else if (po.approved) {
        boxes.push({ heading, role: roleText, short: SLOT_SHORT[role], step: s, state: "APPROVED", name: title, date: approvedDate });
      } else if (state.rejected && last && last.step === s && last.role === role) {
        boxes.push({ heading, role: roleText, short: SLOT_SHORT[role], step: s, state: "REJECTED", name: last.actorName?.trim() || title, date: localDateOf(last.at) });
      } else {
        boxes.push({ heading, role: roleText, short: SLOT_SHORT[role], step: s, state: "PENDING", name: title });
      }
    }
  }
  return boxes;
}

export type PoApprovalPrintInfo = {
  role: string;
  name: string;
  pendingText: string;
  /** Nama PIC yang mengajukan (langkah 1, siklus berjalan). Kosong untuk entri lama tanpa actorName. */
  submitter?: string;
  /** Nama PIC yang sudah menyetujui, mis. "Budi (Finance) + Siti (SCM)". Kosong kalau belum ada / entri lama. */
  approverNames?: string;
};

const PRINT_ROLE_SHORT: Record<ApprovalRole, string> = { procurement: "Procurement", finance: "Finance", scm: "SCM", gm: "GM" };

export function poApprovalPrintInfo(po: PoApprovalSubject): PoApprovalPrintInfo {
  const state = poApprovalState(po);
  if (state.legacy || state.level == null) return { role: "Finance", name: "Finance", pendingText: "Belum disetujui Finance" };
  const row = APPROVAL_LEVEL_TABLE[Math.min(3, Math.max(0, state.level - 1))];
  // Nama PIC dari log siklus berjalan (revisi 2026-10-16: owner minta nama PIC tampil di cetakan PO).
  const submitter = state.cycle.find((e) => e.step === 1 && e.action === "APPROVED")?.actorName?.trim() || undefined;
  const names: string[] = [];
  for (const e of state.cycle) {
    if (e.step < 2 || e.action !== "APPROVED" || !e.actorName?.trim()) continue;
    const label = `${e.actorName.trim()} (${PRINT_ROLE_SHORT[e.role]})`;
    if (!names.includes(label)) names.push(label);
  }
  return { role: `Level ${state.level}`, name: row.approver, pendingText: poApprovalSummary(state), submitter, approverNames: names.length > 0 ? names.join(" + ") : undefined };
}
