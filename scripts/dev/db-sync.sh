#!/usr/bin/env bash
# Salin database Supabase LIVE ke project Supabase UJI, dan bandingkan strukturnya.
#
# LIVE hanya DIBACA (pg_dump). Semua penulisan hanya ke DEV_DB_URL.
# Alamat koneksi dibaca dari .env.db-sync (diabaikan git, jangan di-commit):
#   LIVE_DB_URL=postgresql://postgres.<ref-live>:<password>@<host-pooler>:5432/postgres
#   DEV_DB_URL=postgresql://postgres.<ref-uji>:<password>@<host-pooler>:5432/postgres
# (Supabase > Connect > Session pooler. Karakter khusus di password harus di-encode, mis. @ -> %40.)
# DEV_DB_URL boleh dikosongkan: tujuan bawaan = Supabase LOKAL di Docker (`supabase start`,
# postgresql://postgres:postgres@127.0.0.1:54322/postgres).
#
# Pemakaian (dari folder project, di Git Bash):
#   bash scripts/dev/db-sync.sh schema         struktur LIVE -> UJI (UJI harus kosong)
#   bash scripts/dev/db-sync.sh schema --reset kosongkan schema public UJI dulu, lalu salin struktur
#   bash scripts/dev/db-sync.sh data           data LIVE -> UJI (tanpa tabel berisi file lampiran)
#   bash scripts/dev/db-sync.sh data --with-files   termasuk tabel file lampiran (berat)
#   bash scripts/dev/db-sync.sh all [--reset]  struktur + data
#   bash scripts/dev/db-sync.sh diff           bandingkan struktur LIVE vs UJI (yang harus dibawa ke live)
set -euo pipefail
cd "$(dirname "$0")/../.."

MODE="${1:-}"; shift || true
RESET=0; WITH_FILES=0
for a in "$@"; do
  case "$a" in
    --reset) RESET=1 ;;
    --with-files) WITH_FILES=1 ;;
    *) echo "Opsi tidak dikenal: $a"; exit 1 ;;
  esac
done
case "$MODE" in schema|data|all|diff) ;; *) sed -n '2,18p' "$0"; exit 1 ;; esac

[ -f .env.db-sync ] || { echo "File .env.db-sync belum ada (lihat petunjuk di kepala skrip)."; exit 1; }
set -a; . ./.env.db-sync; set +a
: "${LIVE_DB_URL:?LIVE_DB_URL belum diisi di .env.db-sync}"
DEV_DB_URL="${DEV_DB_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}"

# Ambil project ref dari alamat koneksi (pooler: user postgres.<ref>; direct: db.<ref>.supabase.co).
# Database di komputer ini (127.0.0.1 / localhost) diberi ref "lokal".
ref_of() {
  local u="$1" r
  if printf '%s' "$u" | grep -qE '@(127\.0\.0\.1|localhost)(:|/)'; then printf 'lokal'; return; fi
  # Pooler Supabase: user = "<role>.<ref>". Role tidak selalu "postgres" -- akun baca-saja khusus
  # (mis. partner_ro dari tim IT) juga dipakai lewat pooler, jadi nama role apa pun diterima.
  r=$(printf '%s' "$u" | sed -nE 's#^[a-z]+://[a-z0-9_]+\.([a-z0-9]+):.*#\1#p')
  [ -n "$r" ] || r=$(printf '%s' "$u" | sed -nE 's#.*@db\.([a-z0-9]+)\.supabase\.co.*#\1#p')
  printf '%s' "$r"
}
url_ref_of_env() { sed -nE 's#^NEXT_PUBLIC_SUPABASE_URL=["]?https://([a-z0-9]+)\.supabase\.co.*#\1#p' "$1" 2>/dev/null | head -1; }

LIVE_REF=$(ref_of "$LIVE_DB_URL"); DEV_REF=$(ref_of "$DEV_DB_URL")
[ -n "$LIVE_REF" ] && [ -n "$DEV_REF" ] || { echo "Tidak bisa membaca project ref dari alamat koneksi. Pakai alamat Session pooler atau Direct dari Supabase."; exit 1; }
[ "$LIVE_REF" != "lokal" ] || { echo "BERHENTI: LIVE_DB_URL menunjuk database lokal; isi dengan alamat Supabase live."; exit 1; }
if [ "$DEV_REF" = "lokal" ]; then
  psql "$DEV_DB_URL" -X -q -At -c "select 1" > /dev/null 2>&1 || { echo "Database lokal belum jalan. Nyalakan Docker Desktop lalu jalankan: node node_modules/supabase/dist/supabase.js start"; exit 1; }
fi

# PENGAMAN: UJI tidak boleh sama dengan LIVE.
if [ "$LIVE_REF" = "$DEV_REF" ]; then echo "BERHENTI: LIVE_DB_URL dan DEV_DB_URL menunjuk project yang sama ($LIVE_REF)."; exit 1; fi
BACKUP_REF=$(url_ref_of_env .env.live-backup)
if [ -n "$BACKUP_REF" ] && [ "$BACKUP_REF" != "$LIVE_REF" ]; then
  echo "BERHENTI: LIVE_DB_URL ($LIVE_REF) bukan project live yang tercatat di .env.live-backup ($BACKUP_REF)."; exit 1
fi
if [ -n "$BACKUP_REF" ] && [ "$DEV_REF" = "$BACKUP_REF" ]; then echo "BERHENTI: DEV_DB_URL menunjuk project live."; exit 1; fi
APP_REF=$(url_ref_of_env .env.local)
if [ -n "$APP_REF" ] && [ "$APP_REF" = "$LIVE_REF" ]; then
  echo "PERINGATAN: .env.local masih menunjuk project LIVE. Aplikasi lokal akan menulis ke data live sampai .env.local diganti ke project uji."
fi
echo "LIVE (hanya dibaca): $LIVE_REF"
echo "UJI  (ditulis)     : $DEV_REF"

OUT=.db-sync; mkdir -p "$OUT"
# Tabel yang menyimpan isi file lampiran (base64). Strukturnya tetap disalin; datanya hanya dengan --with-files.
FILE_TABLES=(attachment_files invoice_pv_files invoice_support_files invoice_payment_proofs
  vendor_invoice_payment_proofs delivery_koli_ekspedisi_photos material_claim_photos)

dev_psql() { psql "$DEV_DB_URL" -X -q -v ON_ERROR_STOP=1 "$@"; }

# Tabel yang tidak boleh dibaca akun LIVE_DB_URL (dikunci tim IT: akun, password, log audit, bukti bayar,
# antrean integrasi). pg_dump mengunci SEMUA tabel yang ikut didump, jadi satu tabel terlarang menggagalkan
# seluruh dump -- baik data maupun struktur. Dihitung sekali, dipakai dump_schema dan do_data.
# AWAS Windows: psql.exe menulis akhir baris dengan CR+LF; tanpa membuang CR (tr -d) nama tabel berakhiran CR dan pola
# -t/-T tidak cocok dengan apa pun, TANPA pesan error.
DENIED=$(psql "$LIVE_DB_URL" -X -At -c "select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and not has_table_privilege(current_user, c.oid, 'SELECT') order by 1")
DENIED=$(printf '%s
' "$DENIED" | grep -oE '[A-Za-z0-9_]+' || true)

dump_schema() { # $1 = url, $2 = file
  local x=() t
  for t in $DENIED; do x+=(-T "public.$t"); done
  pg_dump "$1" --schema-only --schema=public --no-owner --no-comments "${x[@]}" -f "$2"
}

ensure_roles() {
  # Role khusus di live (mis. wms_integration_role) harus ADA di UJI, kalau tidak penerapan struktur
  # berhenti dengan ERROR: role "..." does not exist.
  # Nama role dibaca dari FILE DUMP-nya sendiri (baris GRANT/REVOKE), bukan dari query pg_roles ke live --
  # LIVE_DB_URL bisa memakai akun baca-saja khusus yang tidak boleh membaca daftar role.
  local f="$1" r
  for r in $( { grep -E '^GRANT '  "$f" | sed -E 's/.* TO //;   s/;[[:space:]]*$//'
                grep -E '^REVOKE ' "$f" | sed -E 's/.* FROM //; s/;[[:space:]]*$//'
              } | tr ',' '\n' | tr -d ' "' | sort -u || true ); do
    case "$r" in
      ""|PUBLIC|postgres|anon|authenticated|service_role|authenticator|dashboard_user|pgbouncer) continue ;;
      supabase_*|pgsodium_*|pg_*|cli_login_*) continue ;;
    esac
    dev_psql -c "do \$\$ begin if not exists (select from pg_roles where rolname = '$r') then create role \"$r\" nologin; end if; end \$\$;"
  done
}

do_schema() {
  local n
  n=$(dev_psql -At -c "select count(*) from pg_tables where schemaname = 'public'")
  if [ "$n" != "0" ] && [ "$RESET" != "1" ]; then
    echo "BERHENTI: schema public UJI sudah berisi $n tabel. Tambahkan --reset untuk mengosongkannya dulu."; exit 1
  fi
  # Baca struktur LIVE SEBELUM menghapus apa pun di UJI: kalau pembacaan gagal, salinan lokal tetap utuh.
  echo "Membaca struktur LIVE…"
  dump_schema "$LIVE_DB_URL" "$OUT/live-schema.sql"
  # Schema public SELALU sudah ada di tujuan (bawaan Postgres, atau dibuat ulang oleh blok --reset di bawah),
  # sementara pg_dump >= 15 tetap menuliskan "CREATE SCHEMA public;" -- tanpa dibuang, penerapan berhenti
  # dengan ERROR: schema "public" already exists.
  sed -i -E '/^CREATE SCHEMA public;$/d; /^ALTER SCHEMA public OWNER TO /d' "$OUT/live-schema.sql"
  # "ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin ..." ditolak di Supabase LOKAL (kita tersambung
  # sebagai postgres, yang bukan anggota role internal Supabase cloud itu) -> "permission denied to change
  # default privileges". Baris ini hanya mengatur hak objek yang dibuat KEMUDIAN, jadi tidak ada artinya
  # untuk salinan uji: yang bukan milik role postgres dibuang.
  sed -i -E '/^ALTER DEFAULT PRIVILEGES FOR ROLE /{/^ALTER DEFAULT PRIVILEGES FOR ROLE postgres /!d}' "$OUT/live-schema.sql"
  ensure_roles "$OUT/live-schema.sql"
  if [ "$n" != "0" ]; then
    echo "Mengosongkan schema public di UJI ($DEV_REF)…"
    # Struktur tabel terlarang TIDAK bisa dibaca ulang dari live, padahal tabel lain punya foreign key ke
    # sana (mis. ke vendors_produksi). Jadi tabelnya diamankan dulu ke schema lain, schema public
    # dibangun ulang, lalu tabelnya dikembalikan SEBELUM struktur live diterapkan. Strukturnya jarang
    # berubah (tabel akun/log); kalau berubah, minta IT mengirim DDL-nya.
    local t keep=""
    for t in $DENIED; do
      if [ "$(dev_psql -At -c "select count(*) from pg_tables where schemaname='public' and tablename='$t'")" = "1" ]; then keep="$keep $t"; fi
    done
    {
      echo "create schema if not exists keep_denied;"
      for t in $keep; do echo "alter table public.\"$t\" set schema keep_denied;"; done
      cat <<'SQL'
drop schema public cascade;
create schema public;
grant usage on schema public to postgres, anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to postgres, anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to postgres, anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to postgres, anon, authenticated, service_role;
SQL
      for t in $keep; do echo "alter table keep_denied.\"$t\" set schema public;"; done
      echo "drop schema keep_denied;"
    } | dev_psql --single-transaction
    [ -z "$keep" ] || echo "Tabel terlarang diamankan lalu dikembalikan:$keep"
  fi
  echo "Menerapkan struktur ke UJI…"
  dev_psql --single-transaction -f "$OUT/live-schema.sql"
  echo "Struktur selesai: $(dev_psql -At -c "select count(*) from pg_tables where schemaname = 'public'") tabel."
}

do_data() {
  # Sequence TIDAK ikut disalin: membaca nilainya butuh izin SELECT pada sequence, yang belum tentu
  # diberikan ke akun baca-saja (LIVE_DB_URL). Posisinya disetel ulang di UJI setelah data masuk
  # (lihat reset_sequences) -- hasilnya sama, tanpa minta izin tambahan ke tim IT.
  # Yang bekerja: --exclude-table-data (buang DATA-nya). "-T public.*_seq" TIDAK bekerja, dan menyebut
  # tabel satu per satu lewat -t juga tidak menolong -- pg_dump tetap ikut menyertakan sequence yang
  # DIMILIKI kolom serial tabel terpilih.
  local args=(--data-only --schema=public --no-owner --exclude-table-data='public.*_seq' -f "$OUT/live-data.sql")
  if [ "$WITH_FILES" = "0" ]; then for t in "${FILE_TABLES[@]}"; do args+=(--exclude-table-data="public.$t"); done; fi
  # Tabel yang TIDAK boleh dibaca akun LIVE_DB_URL (mis. akun, password, log audit, bukti bayar -- sengaja
  # dikunci tim IT) harus dikeluarkan dari dump: pg_dump mengunci SEMUA tabel sekaligus, jadi satu tabel
  # terlarang menggagalkan seluruh dump ("permission denied for table ...").
  # Caranya: sebut HANYA tabel yang boleh dibaca lewat -t.
  # AWAS Windows: psql.exe menulis akhir baris "\r\n", jadi tiap nama tabel berakhiran "\r" (kecuali baris
  # terakhir). Tanpa tr -d '\r', pola -t/-T tidak cocok dengan nama tabel apa pun -> dump nyaris kosong
  # TANPA pesan error. Itu sebabnya "-T" sebelumnya terlihat tidak bekerja.
  local denied readable t
  readable=$(psql "$LIVE_DB_URL" -X -At -c "select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and has_table_privilege(current_user, c.oid, 'SELECT') order by 1" | tr -d '\r')
  readable=$(printf '%s
' \"$readable\" | grep -oE '[A-Za-z0-9_]+' || true)
  denied="$DENIED"
  [ -n "$readable" ] || { echo "BERHENTI: akun LIVE_DB_URL tidak bisa membaca satu tabel pun."; exit 1; }
  args=(--data-only --no-owner --exclude-table-data='public.*_seq' -f "$OUT/live-data.sql")
  if [ "$WITH_FILES" = "0" ]; then for t in "${FILE_TABLES[@]}"; do args+=(--exclude-table-data="public.$t"); done; fi
  for t in $readable; do args+=(-t "public.$t"); done
  [ -z "$denied" ] || echo "Dilewati (tidak boleh dibaca akun LIVE): $(echo $denied | tr '\n' ' ')"
  echo "Tabel yang dibaca: $(echo "$readable" | wc -l) dari $(( $(echo "$readable" | wc -l) + $(echo "$denied" | grep -c .) ))"
  echo "Membaca data LIVE (sekali baca)…"
  pg_dump "$LIVE_DB_URL" "${args[@]}"
  # Pengaman: dump yang nyaris kosong = pola tabel tidak cocok, BUKAN "database kosong". Berhenti sebelum
  # truncate, supaya salinan lokal yang sudah ada tidak terhapus oleh dump yang salah.
  local ncopy; ncopy=$(grep -c '^COPY ' "$OUT/live-data.sql" || true)
  if [ "$ncopy" -lt 20 ]; then echo "BERHENTI: dump hanya berisi $ncopy tabel (seharusnya puluhan). UJI tidak disentuh."; exit 1; fi
  echo "Dump berisi $ncopy tabel."
  echo "Mengisi data ke UJI…"
  # Kosongkan tabel UJI dulu supaya bisa diulang; trigger & FK dimatikan selama pengisian.
  {
    echo "set session_replication_role = replica;"
    echo "do \$\$ declare t text; begin for t in select tablename from pg_tables where schemaname = 'public' loop execute format('truncate table public.%I cascade', t); end loop; end \$\$;"
    cat "$OUT/live-data.sql"
    echo "set session_replication_role = origin;"
  } > "$OUT/load-data.sql"
  dev_psql --single-transaction -f "$OUT/load-data.sql"
  copy_readable_columns "$denied"
  reset_sequences
  echo "Data selesai."
}

# Tabel yang ditolak di tingkat tabel kadang masih boleh dibaca PER KOLOM (mis. vendors_produksi: daftar
# vendor boleh, kolom password tidak). Aplikasi butuh baris vendornya agar halaman bisa tampil, jadi kolom
# yang boleh dibaca disalin -- KECUALI kolom yang namanya mengandung password/secret/token/hash/_enc:
# kredensial tidak pernah disalin ke laptop, walaupun ada yang masih bisa dibaca.
copy_readable_columns() {
  local t cols
  for t in $1; do
    cols=$(psql "$LIVE_DB_URL" -X -At -c "select string_agg(quote_ident(attname), ',' order by attnum) from pg_attribute where attrelid = 'public.${t}'::regclass and attnum > 0 and not attisdropped and has_column_privilege(current_user, attrelid, attnum, 'SELECT') and attname !~* '(password|secret|token|hash|_enc\$)'" | tr -d '\r')
    cols=$(printf '%s' "$cols" | sed 's/[^A-Za-z0-9_",]//g')
    [ -n "$cols" ] || continue
    echo "Menyalin kolom yang boleh dibaca saja dari $t (tanpa kolom kredensial)…"
    psql "$LIVE_DB_URL" -X -q -c "\\copy (select $cols from public.$t) to '$OUT/part-$t.tsv'"
    # Kolom kredensial yang sengaja TIDAK disalin tapi bersifat NOT NULL tanpa default (mis.
    # vendors_produksi.password_hash) akan menolak barisnya. Diisi penanda "!" -- BUKAN hash bcrypt yang valid,
    # jadi baris itu tidak bisa dipakai login sampai akun uji dibuat (lihat catatan akun uji di RENCANA.md).
    local extra_cols extra_vals
    extra_cols=$(dev_psql -At -c "select string_agg(quote_ident(a.attname), ',' order by a.attnum), string_agg('''!''', ',' order by a.attnum) from pg_attribute a where a.attrelid = 'public.${t}'::regclass and a.attnum > 0 and not a.attisdropped and a.attnotnull and not a.atthasdef and a.attname <> all (string_to_array(replace('$cols', '\"', ''), ','))" | sed "s/[^A-Za-z0-9_,|!']//g")
    extra_vals="${extra_cols#*|}"; extra_cols="${extra_cols%%|*}"
    # Lewat tabel sementara (tanpa batasan NOT NULL) lalu INSERT dengan kolom tambahan terisi.
    { echo "set session_replication_role = replica;"
      echo "create temp table _p as select $cols from public.$t where false;"
      echo "\\copy _p ($cols) from '$OUT/part-$t.tsv'"
      if [ -n "$extra_cols" ]; then
        echo "insert into public.$t ($cols,$extra_cols) select $cols,$extra_vals from _p;"
      else
        echo "insert into public.$t ($cols) select $cols from _p;"
      fi
    } > "$OUT/part-$t.sql"
    dev_psql -f "$OUT/part-$t.sql" || echo "  (gagal menyalin $t; lanjut)"
    rm -f "$OUT/part-$t.tsv"
  done
}

# Setel ulang tiap sequence yang dimiliki sebuah kolom (serial/identity) ke nilai tertinggi kolom itu,
# supaya baris BARU yang dibuat saat menguji di UJI tidak bentrok id dengan data salinan.
reset_sequences() {
  echo "Menyetel ulang sequence…"
  dev_psql <<'SQL'
do $$
declare r record; mx bigint;
begin
  for r in
    select s.relname as seq, t.relname as tbl, a.attname as col
      from pg_class s
      join pg_namespace n on n.oid = s.relnamespace and n.nspname = 'public'
      join pg_depend d on d.objid = s.oid and d.deptype = 'a'
      join pg_class t on t.oid = d.refobjid
      join pg_attribute a on a.attrelid = t.oid and a.attnum = d.refobjsubid
     where s.relkind = 'S'
  loop
    execute format('select coalesce(max(%I), 0) from public.%I', r.col, r.tbl) into mx;
    perform setval('public.' || quote_ident(r.seq), greatest(mx, 1), mx > 0);
  end loop;
end $$;
SQL
}

do_diff() {
  dump_schema "$LIVE_DB_URL" "$OUT/live-schema.sql"
  dump_schema "$DEV_DB_URL" "$OUT/dev-schema.sql"
  # Buang baris yang selalu beda (komentar, \restrict acak dari pg_dump baru).
  local clean='/^--/d; /^\\(un)?restrict /d; /^$/d'
  sed -E "$clean" "$OUT/live-schema.sql" > "$OUT/live-schema.clean.sql"
  sed -E "$clean" "$OUT/dev-schema.sql" > "$OUT/dev-schema.clean.sql"
  if diff -u "$OUT/live-schema.clean.sql" "$OUT/dev-schema.clean.sql" > "$OUT/schema.diff"; then
    echo "Struktur LIVE dan UJI sama."
  else
    echo "Struktur berbeda: baris '+' ada di UJI tetapi belum di LIVE. Rincian: $OUT/schema.diff"
    grep -cE '^[+-][^+-]' "$OUT/schema.diff" | xargs echo "Jumlah baris beda:"
  fi
}

case "$MODE" in
  schema) do_schema ;;
  data) do_data ;;
  all) do_schema; do_data ;;
  diff) do_diff ;;
esac
