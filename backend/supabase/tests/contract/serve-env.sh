#!/usr/bin/env bash
# Build the env file for `supabase functions serve` during contract tests:
# the dummy Anthropic key from .env.contract plus the local stack's keys under
# the UNPREFIXED names the functions read (SERVICE_ROLE_KEY / ANON_KEY —
# `functions serve` refuses to inject SUPABASE_-prefixed names from an env file).
#
# Usage (from backend/): tests are wired through this in ci.yml and README.
#   supabase/tests/contract/serve-env.sh > /tmp/contract.env
#   supabase functions serve --env-file /tmp/contract.env

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

cat "$HERE/.env.contract"
supabase status -o env 2>/dev/null | sed 's/"//g' | grep -E '^(ANON_KEY|SERVICE_ROLE_KEY)='
