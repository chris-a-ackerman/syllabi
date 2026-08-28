#!/usr/bin/env bash
# Rebuild a throwaway local database from migrations/ and assert the security
# fixes hold. Run this before `supabase db push`.
#
#   ./backend/supabase/local/db-test.sh
#   ADMIN_URL=postgres://postgres@localhost:5432/postgres ./backend/supabase/local/db-test.sh
#   TEST_DB=syllabi_scratch ./backend/supabase/local/db-test.sh --keep
#
# Flags:
#   --keep        leave the database in place afterwards (default: also kept;
#                 this flag exists for symmetry and is a no-op)
#   --no-verify   apply the schema but skip 99_verify.sql
#
# Never point this at a Supabase project: it DROPs and recreates $TEST_DB.

set -euo pipefail

ADMIN_URL="${ADMIN_URL:-postgres://postgres@localhost:5432/postgres}"
TEST_DB="${TEST_DB:-syllabi_test}"
RUN_VERIFY=1

for arg in "$@"; do
  case "$arg" in
    --no-verify) RUN_VERIFY=0 ;;
    --keep) ;;
    *) echo "unknown flag: $arg" >&2; exit 2 ;;
  esac
done

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MIGRATIONS="$HERE/../migrations"

command -v psql >/dev/null || { echo "psql not found on PATH" >&2; exit 1; }

# Rewrite only the database component of the admin URL, preserving any query
# string (?host=/var/run/postgresql, ?sslmode=..., and friends).
ADMIN_BASE="${ADMIN_URL%%\?*}"
ADMIN_QUERY=""
if [ "$ADMIN_BASE" != "$ADMIN_URL" ]; then
  ADMIN_QUERY="?${ADMIN_URL#*\?}"
fi
TEST_URL="${ADMIN_BASE%/*}/${TEST_DB}${ADMIN_QUERY}"

case "$TEST_URL" in
  *supabase.co*|*supabase.com*|*pooler.supabase*)
    echo "refusing to run against a Supabase host: $TEST_URL" >&2; exit 1 ;;
esac

echo "==> recreating $TEST_DB"
psql "$ADMIN_URL" -v ON_ERROR_STOP=1 -q \
  -c "DROP DATABASE IF EXISTS $TEST_DB WITH (FORCE)" \
  -c "CREATE DATABASE $TEST_DB"

apply() {
  printf '  %-52s' "$(basename "$1")"
  if psql "$TEST_URL" -v ON_ERROR_STOP=1 -q -f "$1" 2>/tmp/db-test-err; then
    echo "ok"
  else
    echo "FAILED"
    sed 's/^/      /' /tmp/db-test-err >&2
    exit 1
  fi
}

echo "==> Supabase scaffolding (local only)"
apply "$HERE/00_bootstrap.sql"

echo "==> migrations"
for f in "$MIGRATIONS"/*.sql; do apply "$f"; done

echo "==> production drift not captured in migrations (local only)"
apply "$HERE/90_prod_drift.sql"

if [ "$RUN_VERIFY" -eq 1 ]; then
  echo "==> security assertions"
  apply "$HERE/99_verify.sql"
fi

echo
echo "$TEST_DB is ready:  psql $TEST_URL"
