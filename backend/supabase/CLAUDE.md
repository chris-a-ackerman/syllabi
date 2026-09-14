# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in `backend/supabase/`. There is no root-level `CLAUDE.md` for the rest of the repo (frontend included) — see the root [`README.md`](../../README.md) instead.

## Project Overview

This is the Supabase backend for a syllabus parsing application. It uses Supabase Edge Functions powered by Claude AI to extract structured course data (events, grading, schedule) from uploaded syllabus PDFs, support a chat assistant over that data, export iCalendar files, integrate with Canvas LMS, and let a user bring their own Claude API key. There are **15 Edge Functions** in total — see [`README.md`](README.md) for the full table.

## Common Commands

```bash
# Local development
supabase start --workdir backend                  # Start local Supabase stack (from repo root)
supabase stop --workdir backend                   # Stop local stack

# Edge Functions
supabase functions serve process-syllabus --env-file supabase/.env.local  # Run function locally with hot reload (from backend/)
supabase functions deploy process-syllabus        # Deploy one function to production
supabase functions deploy                         # Deploy all 15

# Database
supabase db push                                  # Apply migrations
supabase db reset                                 # Reset DB and re-run all migrations
supabase migration new <name>                     # Create a new migration file
supabase migration list                           # What the hosted DB is missing
supabase db diff --schema public                  # Diff local DB vs migrations

# Testing (from repo root unless noted)
npm run db:test                                   # Rebuild schema on plain Postgres + security assertions (no Docker)
deno task test:unit                                # from backend/supabase/ — Deno unit tests
deno task test:contract                            # from backend/supabase/ — needs a running local stack
```

Local services run at: API `54321`, DB `54322`, Studio `54323`, Mailpit (local email, `[local_smtp]` in `config.toml`) `54324`.

Every function in `config.toml` is `verify_jwt = false` at the platform level (so the browser's CORS preflight isn't rejected at the gateway) and verifies the caller's `Authorization` header + `auth.getUser` **inside the handler** instead. `tests/unit/config-drift.test.ts` is the tripwire: it asserts every function block in `config.toml` has `verify_jwt = false`, so a new function needs its own `[functions.<name>]` block or the test fails. Do not "fix" this by flipping a function to `verify_jwt = true` — that breaks the CORS preflight.

## Architecture

### Data Flow

1. Client uploads a syllabus PDF to the `syllabi` Storage bucket and calls the `process-syllabus` Edge Function with a `course_id`.
2. The function fetches course/semester context from `courses` (joined with `semesters`), downloads the PDF from Storage, and encodes it as base64.
3. It resolves an Anthropic client for the request — the caller's own BYOK key if one is stored, otherwise the project's `ANTHROPIC_API_KEY` (`_shared/anthropic-client.ts#resolveAnthropicClient`) — and sends the document + semester date context to Claude (currently `claude-sonnet-4-6`) with a system prompt that enforces a strict JSON schema output.
4. Claude returns structured JSON with keys: `course`, `schedule`, `events`, `recurring_patterns`, `grading_rules`, `policies`, `extraction_quality`.
5. The function writes the raw JSON blob to `courses.syllabus_analysis`, updates `courses.name/code/professor/analysis_status`, deletes existing `course_events` for the course, and bulk-inserts the new events.

### Key Tables

| Table           | Purpose                                                                                                                                                                                                                                                                                                                                          |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `courses`       | One row per course; holds `syllabus_file_path`, `analysis_status` (`processing`/`complete`/`failed`), `analysis_error`, `syllabus_analysis` (full JSONB blob), and `canvas_course_id` when imported from Canvas                                                                                                                                  |
| `semesters`     | Referenced by courses; provides `start_date`/`end_date` so Claude can resolve relative dates like "Week 5"                                                                                                                                                                                                                                       |
| `course_events` | Flattened, one-row-per-event output of the parse; includes `type` (NOT NULL), `category`, `date`, `time`, `confidence`, `is_recurring_instance`, plus Canvas-matching columns: `canvas_assignment_id`, `canvas_matched_at`, `canvas_only`, `source` (`syllabus`/`canvas_matched`/`canvas`/`canvas_deleted`), `canvas_metadata`                   |
| `profiles`      | Holds both the pgcrypto-encrypted Canvas token (`canvas_token_encrypted`) and the pgcrypto-encrypted BYOK Anthropic key (`anthropic_key_encrypted`), plus non-secret metadata for each (`*_last4`, `*_added_at`, `*_last_tested_at`, `*_last_test_ok`). Never read these columns directly for client-facing data — use the `profiles_safe` view. |
| `ai_usage`      | Per-user daily quota counters against the **project's** Claude key (SYL-29/SYL-67); service-role write only                                                                                                                                                                                                                                      |
| `ai_usage_byok` | Per-user daily counters for requests made under a user's **own** Claude key (SYL-72); never checked against a limit, purely for admin visibility                                                                                                                                                                                                 |

**`course_events.type` is NOT NULL** with `CHECK (type IN ('deadline', 'exam', 'quiz', 'presentation', 'project_due', 'no_class', 'other'))` — defaults to `"other"` in the function if Claude omits it.

### Claude Prompt Contract

The system prompt in `process-syllabus/index.ts` instructs Claude to output **raw JSON only** (no markdown fences). Events in the `events` array must have:

- `date` — resolved to `YYYY-MM-DD` using the provided semester start date
- `type` — always required (maps to the NOT NULL column)
- `category` — must match a `grading_rules.components[].name` exactly
- `title`, `confidence`, `is_recurring_instance`

If Claude wraps its response in markdown code fences despite the prompt, the function strips them via regex before `JSON.parse`.

### Bring-your-own Claude key (SYL-72)

`process-syllabus`, `chat`, `detect-syllabi-info`, `find-canvas-syllabus` and `match-canvas-assignments` do **not** construct a module-level Anthropic client from an env var anymore. Each resolves a per-request client via `_shared/anthropic-client.ts#resolveAnthropicClient(serviceClient, userId, encKey)` after the JWT check:

- If the user has a stored key (`get_anthropic_key` RPC, decrypted under `SECRETS_ENCRYPTION_KEY`), use it and record usage in `ai_usage_byok` — **skip** `enforceAiQuota` entirely (both the per-user and `AI_DAILY_LIMIT_GLOBAL` caps exist to protect the project's bill; BYOK requests don't touch it).
- Otherwise, fall back to the project's `ANTHROPIC_API_KEY` and go through the normal `enforceAiQuota` path.
- If Anthropic rejects a BYOK key at call time (401/403 — e.g. revoked in the console), return `{ error: "claude_key_rejected" }` with status 402 and flip `anthropic_key_last_test_ok` to false. **Never** fall back to the project key silently on a rejected user key.

`SECRETS_ENCRYPTION_KEY` is a separate secret from `CANVAS_ENCRYPTION_KEY` — a deliberate SYL-72 decision to keep the two secrets' rotation independent, even though the issue that introduced it recommended reusing `CANVAS_ENCRYPTION_KEY`. Don't "simplify" this by merging them back into one env var without checking the README's Conventions section first.

### Edge Function Config

```toml
# config.toml
[functions.process-syllabus]
verify_jwt = false
import_map = "./functions/process-syllabus/deno.json"
```

`verify_jwt = false` so the CORS preflight (`OPTIONS`) is not rejected by the
platform. JWT verification is instead done inside the function: it requires an
`Authorization` header, resolves it with `supabase.auth.getUser(token)`, and
returns 401 if that fails. The course is then looked up scoped to that user.
Every one of the 15 functions follows this same pattern — see
`tests/unit/config-drift.test.ts`.

### Environment Variables (required)

- `SUPABASE_URL`
- `SERVICE_ROLE_KEY` — used for the Supabase client inside `process-syllabus`, `generate-ics` and `detect-syllabi-info` (bypasses RLS); the other twelve functions use the platform-injected `SUPABASE_SERVICE_ROLE_KEY`
- `ANTHROPIC_API_KEY` — the project's Claude key, the fallback when a caller has no BYOK key
- `CANVAS_ENCRYPTION_KEY` — pgcrypto key for the stored Canvas token (six functions)
- `SECRETS_ENCRYPTION_KEY` — pgcrypto key for the stored BYOK Anthropic key (SYL-72; separate from `CANVAS_ENCRYPTION_KEY` on purpose)

See [`README.md`](README.md)'s Secrets table for the complete list including the optional `AI_DAILY_LIMIT_*` / `MAX_SYLLABUS_*` tuning variables.
