#!/usr/bin/env bash
#
# Authenticated end-to-end pass against an ephemeral local Supabase stack.
#
# No credentials are stored anywhere: the test users are created at runtime with
# a password generated for this run, against a throwaway local stack whose keys
# are well-known development fixtures. Nothing here touches a real project.
#
# Prerequisites: the local stack is already running (`supabase start` in
# backend/), plus psql, node >= 22 and a Chrome/Chromium binary.
#
# Usage:  ./e2e/run.sh
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

PORT="${E2E_PORT:-5199}"
CDP_PORT="${CDP_PORT:-9222}"
WORKDIR="$(mktemp -d)"
CHROME_BIN="${CHROME_BIN:-}"

if [ -z "$CHROME_BIN" ]; then
  for candidate in \
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
    "$(command -v google-chrome || true)" \
    "$(command -v google-chrome-stable || true)" \
    "$(command -v chromium || true)"; do
    if [ -n "$candidate" ] && [ -x "$candidate" ]; then CHROME_BIN="$candidate"; break; fi
  done
fi
if [ -z "$CHROME_BIN" ]; then echo "No Chrome/Chromium found; set CHROME_BIN." >&2; exit 1; fi

# The CDP client in render-pass.mjs uses the global WebSocket, unflagged only
# from node 22.4; on older runtimes it dies with "WebSocket is not defined".
if ! node -e 'process.exit(+process.versions.node.split(".")[0] >= 22 ? 0 : 1)'; then
  echo "e2e requires node >= 22 (global WebSocket for CDP); found $(node -v)." >&2
  exit 1
fi

cleanup() {
  [ -n "${VITE_PID:-}" ] && kill "$VITE_PID" 2>/dev/null || true
  [ -n "${CHROME_PID:-}" ] && kill "$CHROME_PID" 2>/dev/null || true
  # Chrome keeps writing to its profile for a moment after SIGTERM.
  sleep 1
  rm -rf "$WORKDIR" 2>/dev/null || true
}
trap cleanup EXIT

# ── Local stack keys (development fixtures, not secrets) ────────────────────
eval "$(supabase status -o env --workdir backend | sed 's/"//g' | grep -E '^(API_URL|ANON_KEY|SERVICE_ROLE_KEY|DB_URL)=' | sed 's/^/export /')"

# ── Test users, created fresh with a per-run password ───────────────────────
export E2E_PASSWORD="$(openssl rand -base64 24)"
export E2E_EMAIL="e2e@syllabi.test"
export E2E_EMAIL_NEW="e2e-new@syllabi.test"

create_user() {
  curl -sS -X POST "$API_URL/auth/v1/admin/users" \
    -H "apikey: $SERVICE_ROLE_KEY" -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"$1\",\"password\":\"$E2E_PASSWORD\",\"email_confirm\":true,\"user_metadata\":{\"full_name\":\"$2\"}}" \
    | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);if(!j.id){console.error(s);process.exit(1)}process.stdout.write(j.id)})"
}

echo "Creating test users..."
UID1="$(create_user "$E2E_EMAIL" 'E2E Test User')"
UID2="$(create_user "$E2E_EMAIL_NEW" 'E2E New User')"

echo "Seeding fixture data..."
psql "$DB_URL" -q -v ON_ERROR_STOP=1 -v uid1="$UID1" -v uid2="$UID2" -f e2e/seed.sql

# ── Dev server pointed at the local stack ───────────────────────────────────
echo "Starting dev server on :$PORT ..."
VITE_SUPABASE_URL="$API_URL" VITE_SUPABASE_ANON_KEY="$ANON_KEY" \
  npx vite --port "$PORT" --strictPort > "$WORKDIR/vite.log" 2>&1 &
VITE_PID=$!
for _ in $(seq 1 60); do
  [ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 2 "http://localhost:$PORT/" || true)" = "200" ] && break
  sleep 1
done

echo "Starting headless Chrome..."
"$CHROME_BIN" --headless=new --disable-gpu --no-sandbox --no-first-run \
  --no-default-browser-check --disable-extensions \
  --remote-debugging-port="$CDP_PORT" --user-data-dir="$WORKDIR/chrome" about:blank \
  > "$WORKDIR/chrome.log" 2>&1 &
CHROME_PID=$!
for _ in $(seq 1 60); do
  curl -s --max-time 2 "http://127.0.0.1:$CDP_PORT/json/version" > /dev/null 2>&1 && break
  sleep 1
done

# ── Render pass ─────────────────────────────────────────────────────────────
BASE_URL="http://localhost:$PORT" CDP_PORT="$CDP_PORT" node e2e/render-pass.mjs

# ── Post-conditions the browser cannot assert on its own ────────────────────
echo ""
echo "Checking semester isActive invariants in the database..."
ACTIVE_COUNT="$(psql "$DB_URL" -At -c "SELECT count(*) FROM semesters WHERE user_id='$UID1' AND is_active")"
ACTIVE_NAME="$(psql "$DB_URL" -At -c "SELECT name FROM semesters WHERE user_id='$UID1' AND is_active")"

if [ "$ACTIVE_COUNT" != "1" ]; then
  echo "FAIL  expected exactly 1 active semester, found $ACTIVE_COUNT"
  exit 1
fi
if [ "$ACTIVE_NAME" != "E2E Semester" ]; then
  echo "FAIL  expected the newly created semester to be active, found '$ACTIVE_NAME'"
  exit 1
fi
echo "PASS  creating a semester made it the only active one (SYL-35 isActive fix)"

echo ""
echo "Checking the note written through the UI landed in course_notes..."
NOTE_COUNT="$(psql "$DB_URL" -At -c "SELECT count(*) FROM course_notes WHERE user_id='$UID1' AND body='E2E note: midterm covers chapters 1-5'")"
if [ "$NOTE_COUNT" != "1" ]; then
  echo "FAIL  expected 1 UI-authored row in course_notes, found $NOTE_COUNT"
  exit 1
fi
echo "PASS  the note added in the UI is a real course_notes row (SYL-37)"

echo ""
echo "Checking the admin AI toggle wrote app_settings..."
AI_ROW="$(psql "$DB_URL" -At -c "SELECT ai_enabled || '|' || coalesce(updated_by::text,'') FROM app_settings WHERE id='global'")"
if [ "$AI_ROW" != "false|$UID1" ]; then
  echo "FAIL  expected app_settings to read 'false|$UID1' after the admin disabled AI, found '$AI_ROW'"
  exit 1
fi
echo "PASS  the admin toggle disabled AI in app_settings, stamped with the admin's id (SYL-37)"
echo ""
echo "Authenticated E2E pass succeeded."
