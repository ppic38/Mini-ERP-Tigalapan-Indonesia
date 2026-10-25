/** Baris kecil "Dibuat oleh X" di daftar portal vendor (migration 0078). Tidak menampilkan apa pun kalau namanya kosong (data sebelum fitur ini). */
export function ActorTag({ label, name, className = "" }: { label: string; name?: string; className?: string }) {
  if (!name) return null;
  return (
    <span className={"block font-sans text-[10.5px] font-normal leading-tight text-text-muted " + className}>
      {label} <span className="font-medium text-[#475569]">{name}</span>
    </span>
  );
}
