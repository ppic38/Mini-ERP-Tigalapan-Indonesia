/** Pembulatan roll yang benar untuk dua tempat (owner 2026-11-26, kasus template KID: tiap warna 0,5 roll PENDEK + 0,5 roll PANJANG = 1 roll nyata):
 *  1) `snapRoll` -- impor MRP: pecahan asli disimpan, selisih desimal komputer (mis. 2,0000000001) disnap ke bilangan bulat.
 *  2) `planRollRoundingByWarna` -- tombol "Bulatkan Roll": total roll SATU WARNA yang dibulatkan, lalu roll utuh dibagi ke lengan yang pecahannya terbesar
 *     (seri: lengan dengan qty pcs lebih besar). Dulu dibulatkan per baris warna·lengan sehingga 0,5 + 0,5 menjadi 1 + 1 (dua kali kebutuhan nyata). */

const EPS = 1e-9;

/** Roll dari Excel: dekat bilangan bulat -> bilangan bulat, selain itu dibulatkan ke 3 desimal (tidak dibulatkan ke atas). */
export function snapRoll(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  const nearest = Math.round(value);
  if (Math.abs(value - nearest) < 1e-6) return nearest;
  return Math.round(value * 1000) / 1000;
}

type RoundableRow = { warna: string; rollCount: number; originalRollCount?: number };

/** Rencana pembulatan: key = baris yang BERUBAH, value = roll_count barunya (nilai lama = `rollCount` baris itu, disimpan sebagai original_roll_count).
 *  Baris yang sudah punya originalRollCount (sudah dibulatkan) dan baris yang sudah bulat tidak disentuh. Jumlah roll satu warna selalu round(total). */
export function planRollRoundingByWarna<T extends RoundableRow>(rows: T[], weightOf: (row: T) => number = () => 0): Map<T, number> {
  const out = new Map<T, number>();
  const byWarna = new Map<string, T[]>();
  for (const r of rows) {
    if (r.originalRollCount != null) continue;
    byWarna.set(r.warna, [...(byWarna.get(r.warna) ?? []), r]);
  }
  for (const group of byWarna.values()) {
    if (!group.some((r) => !Number.isInteger(r.rollCount))) continue;
    const floors = group.map((r) => Math.floor(r.rollCount + EPS));
    const total = group.reduce((s, r) => s + r.rollCount, 0);
    let remain = Math.round(total + EPS) - floors.reduce((s, f) => s + f, 0);
    const candidates = group
      .map((r, idx) => ({ r, idx, frac: r.rollCount - floors[idx] }))
      .filter((c) => c.frac > EPS)
      .sort((a, b) => {
        const d = b.frac - a.frac;
        if (Math.abs(d) > EPS) return d;
        const w = weightOf(b.r) - weightOf(a.r);
        if (w !== 0) return w;
        return a.idx - b.idx;
      });
    const bump = new Set<number>();
    for (const c of candidates) {
      if (remain <= 0) break;
      bump.add(c.idx);
      remain -= 1;
    }
    group.forEach((r, idx) => {
      const next = floors[idx] + (bump.has(idx) ? 1 : 0);
      if (next !== r.rollCount) out.set(r, next);
    });
  }
  return out;
}
