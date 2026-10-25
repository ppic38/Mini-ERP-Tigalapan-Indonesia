/** Username PIC dari label yang disimpan server (migration 0078): "Budi (@budi.cutting)" -> "budi.cutting"; "CECEP (akun utama)" -> "Akun utama". */
export function picUsername(label?: string): string | undefined {
  if (!label) return undefined;
  // Beberapa pelaku (mis. satu sesi resting dikerjakan >1 orang) digabung dengan " | ".
  return label
    .split(" | ")
    .map((one) => {
      const m = one.match(/\(@([^)]+)\)\s*$/);
      if (m) return m[1];
      if (/\(akun utama\)\s*$/i.test(one)) return "Akun utama";
      return one;
    })
    .join(", ");
}

/** Isi sel kolom "PIC" di daftar portal vendor: username saja (nama lengkap muncul saat kursor diarahkan). "-" kalau belum ada (data sebelum fitur ini). */
export function PicText({ label, className = "" }: { label?: string; className?: string }) {
  const name = picUsername(label);
  return (
    <span data-label="PIC" title={label} className={"min-w-0 truncate font-mono text-[11px] " + (name ? "text-[#31414F]" : "text-text-muted") + " " + className}>
      {name ?? "-"}
    </span>
  );
}
