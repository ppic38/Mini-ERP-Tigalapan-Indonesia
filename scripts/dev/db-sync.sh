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
  r=$(printf '%s' "$u" | sed -nE 's#^[a-z]+://postgres\.([a-z0-9]+):.*#\1#p')
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

dump_schema() { # $1 = url, $2 = file
  pg_dump "$1" --schema-only --schema=public --no-owner --no-comments -f "$2"
}

ensure_roles() {
  # Role khusus di live (mis. wms_integration_role) dibuat juga di UJI supaya GRANT tidak gagal. Tanpa login.
  local roles r
  roles=$(psql "$LIVE_DB_URL" -X -At -c "select rolname from pg_roles where rolname not like 'pg\_%' and rolname not in ('postgres','anon','authenticated','service_role','authenticator','supabase_admin','supabase_auth_admin','supabase_storage_admin','supabase_realtime_admin','supabase_replication_admin','supabase_read_only_user','supabase_etl_admin','supabase_functions_admin','dashboard_user','pgbouncer','pgsodium_keyholder','pgsodium_keyiduser','pgsodium_keymaker','supabase_privileged_role','cli_login_postgres')")
  for r in $roles; do
    dev_psql -c "do \$\$ begin if not exists (select from pg_roles where rolname = '$r') then create role \"$r\" nologin; end if; end \$\$;"
  done
}

do_schema() {
  local n
  n=$(dev_psql -At -c "select count(*) from pg_tables where schemaname = 'public'")
  if [ "$n" != "0" ]; then
    if [ "$RESET" = "1" ]; then
      echo "Mengosongkan schema public di UJI ($DEV_REF)…"
      dev_psql <<'SQL'
drop schema public cascade;
create schema public;
grant usage on schema public to postgres, anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to postgres, anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to postgres, anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to postgres, anon, authenticated, service_role;
SQL
    else
      echo "BERHENTI: schema public UJI sudah berisi $n tabel. Tambahkan --reset untuk mengosongkannya dulu."; exit 1
    fi
  fi
  echo "Membaca struktur LIVE…"
  dump_schema "$LIVE_DB_URL" "$OUT/live-schema.sql"
  ensure_roles
  echo "Menerapkan struktur ke UJI…"
  dev_psql --single-transaction -f "$OUT/live-schema.sql"
  echo "Struktur selesai: $(dev_psql -At -c "select count(*) from pg_tables where schemaname = 'public'") tabel."
}

do_data() {
  local args=(--data-only --schema=public --no-owner -f "$OUT/live-data.sql")
  if [ "$WITH_FILES" = "0" ]; then for t in "${FILE_TABLES[@]}"; do args+=(--exclude-table-data="public.$t"); done; fi
  echo "Membaca data LIVE (sekali baca)…"
  pg_dump "$LIVE_DB_URL" "${args[@]}"
  echo "Mengisi data ke UJI…"
  # Kosongkan tabel UJI dulu supaya bisa diulang; trigger & FK dimatikan selama pengisian.
  {
    echo "set session_replication_role = replica;"
    echo "do \$\$ declare t text; begin for t in select tablename from pg_tables where schemaname = 'public' loop execute format('truncate table public.%I cascade', t); end loop; end \$\$;"
    cat "$OUT/live-data.sql"
    echo "set session_replication_role = origin;"
  } > "$OUT/load-data.sql"
  dev_psql --single-transaction -f "$OUT/load-data.sql"
  echo "Data selesai."
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
