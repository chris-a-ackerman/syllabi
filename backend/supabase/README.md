# Syllabi Backend — Supabase

## Prerequisites

- [Supabase CLI](https://supabase.com/docs/guides/cli/getting-started) **≥ 2.116** (older versions reject the local stack's ES256 JWTs)
- Docker (required for local Supabase stack)
- Deno 2.x (unit + contract tests)
- `jq` (used by `test-chat.sh` — `brew install jq`)

All commands below run from `backend/` (or add `--workdir backend` from the repo root). The repo root is `Syllabi - Prototype/`; `backend/` lives inside it. The top-level [`README.md`](../../README.md) has the test tiers, CI and release checklist.

---

## 1. Start the local stack

```bash
supabase start
```

Starts Postgres, Auth, Storage, Studio, and Kong locally. First run pulls Docker images and takes a minute.

```bash
supabase stop
```

---

## 2. Get your local keys

```bash
supabase status
```

Prints local API URL and two keys:

- **Publishable key** (`sb_publishable_...`) — use as the anon/client key
- **Secret key** (`sb_secret_...`) — use as the service role key

---

## 3. Set up `.env.local`

Create `backend/supabase/.env.local` (already gitignored):

```
ANTHROPIC_API_KEY=sk-ant-...
SERVICE_ROLE_KEY=<SERVICE_ROLE_KEY from supabase status>
CANVAS_ENCRYPTION_KEY=<any string locally; six Canvas-touching functions refuse to run without it>
SECRETS_ENCRYPTION_KEY=<any string locally; encrypts/decrypts the BYOK Anthropic key — see the secrets table below>
```

### Secrets

| Secret                                                                                                                                                                                                             | Used by                                                                                                                                                                                         | Notes                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `SERVICE_ROLE_KEY`                                                                                                                                                                                                 | `process-syllabus`, `generate-ics`, `detect-syllabi-info`                                                                                                                                       | Unprefixed; the other twelve functions use the platform-injected `SUPABASE_SERVICE_ROLE_KEY`. `functions serve` refuses to load `SUPABASE_`-prefixed names from an env file, which is why the unprefixed name exists. No function reads an unprefixed `ANON_KEY`.                                                                                            |
| `ANTHROPIC_API_KEY`                                                                                                                                                                                                | `process-syllabus`, `chat`, `detect-syllabi-info`, `find-canvas-syllabus`, `match-canvas-assignments`                                                                                           | The project's Claude key — the fallback when a caller has no BYOK key of their own (`_shared/anthropic-client.ts`).                                                                                                                                                                                                                                          |
| `CANVAS_ENCRYPTION_KEY`                                                                                                                                                                                            | `save-canvas-token`, `delete-canvas-token`'s siblings that decrypt (`download-canvas-syllabus`, `find-canvas-courses`, `find-canvas-syllabus`, `match-canvas-assignments`, `test-canvas-token`) | pgcrypto key for the stored Canvas token. `delete-canvas-token` doesn't need it — deleting doesn't require decrypting.                                                                                                                                                                                                                                       |
| `SECRETS_ENCRYPTION_KEY`                                                                                                                                                                                           | `save-anthropic-key`, `test-anthropic-key`, the five AI functions (via `resolveAnthropicClient`)                                                                                                | pgcrypto key for the stored Anthropic (BYOK) key. SYL-72 introduced this as a **second, independent** secret rather than reusing `CANVAS_ENCRYPTION_KEY` — keeps the two secrets' rotation independent (see the parent README's Conventions section). `delete-anthropic-key` doesn't need it.                                                                |
| `AI_DAILY_LIMIT_CHAT`, `AI_DAILY_LIMIT_PROCESS_SYLLABUS`, `AI_DAILY_LIMIT_DETECT_SYLLABI_INFO`, `AI_DAILY_LIMIT_FIND_CANVAS_SYLLABUS`, `AI_DAILY_LIMIT_MATCH_CANVAS_ASSIGNMENTS`, `AI_DAILY_LIMIT_MANAGE_API_KEYS` | The AI + BYOK-management functions                                                                                                                                                              | Optional per-user daily overrides (defaults 100 / 25 / 50 files / 25 / 25 / 20). `manage-api-keys` is a shared quota name across `save-anthropic-key`, `test-anthropic-key` and `test-canvas-token` — each makes one outbound validation call, so without a limit the endpoint is a key/token-validation oracle; `delete-anthropic-key` is not rate-limited. |
| `AI_DAILY_LIMIT_GLOBAL`                                                                                                                                                                                            | All five AI functions                                                                                                                                                                           | SYL-67: cross-user daily cap on every AI endpoint call combined, enforced atomically alongside the per-user unit. Default 2000/day. A BYOK request (user's own Claude key) skips this and the per-user cap entirely — see `ai_usage_byok` below.                                                                                                             |
| `MAX_SYLLABUS_BYTES`, `MAX_SYLLABUS_PAGES`                                                                                                                                                                         | `process-syllabus`, `detect-syllabi-info`                                                                                                                                                       | Optional upload caps (defaults 20 MiB, 100 pages).                                                                                                                                                                                                                                                                                                           |

---

## 4. Run migrations

```bash
supabase db push       # Apply migrations to local DB
supabase db reset      # Reset DB and re-run all migrations from scratch
supabase migration new <name>   # Create a new migration file
```

---

## 5. Create a test user

Email confirmation is on locally (SYL-32), so create users through the GoTrue admin API rather than the signup form:

```bash
eval "$(supabase status -o env | sed 's/"//g' | grep -E '^(API_URL|DB_URL|SERVICE_ROLE_KEY)=' | sed 's/^/export /')"
curl -s -X POST "$API_URL/auth/v1/admin/users" \
  -H "apikey: $SERVICE_ROLE_KEY" -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"email":"test@test.com","password":"password123","email_confirm":true}'
# optional: make the user an admin (clients cannot set this column — SYL-25)
psql "$DB_URL" -c "UPDATE public.profiles SET is_admin = true WHERE id = '<id from the response>'"
```

---

## 6. Run Edge Functions locally

```bash
supabase functions serve --env-file supabase/.env.local                   # all fifteen, hot reload
supabase functions serve process-syllabus --env-file supabase/.env.local  # or just one
```

`supabase start` already serves every function with only the platform-injected `SUPABASE_*` variables; `functions serve --env-file` is how they get the Anthropic key and the other secrets.

Every function is configured `verify_jwt = false` at the platform level (so the browser's CORS preflight isn't rejected) and verifies the caller's JWT inside the handler instead (see `tests/unit/config-drift.test.ts`), so requests always need a real user token regardless of any `--no-verify-jwt` flag.

---

## 7. Test scripts

```bash
bash supabase/test-chat.sh "What is due this week?"
```

The script signs in as `test@test.com`, fetches the active semester ID, then calls the `chat` function with your message.

---

## 8. Deploy to production

```bash
supabase migration list        # what the hosted DB is missing
supabase db push --dry-run
supabase db push               # migrations only

supabase functions deploy      # all fifteen; or name one: supabase functions deploy chat

supabase secrets set ANTHROPIC_API_KEY=sk-ant-... CANVAS_ENCRYPTION_KEY=... SECRETS_ENCRYPTION_KEY=... SERVICE_ROLE_KEY=...   # only when introducing a secret
```

Run `npm run db:test` from the repo root first — it rebuilds the schema from `migrations/` on a plain Postgres and runs the security assertions in `local/99_verify.sql`. Auth settings (`config.toml [auth]`) only govern local stacks; on the hosted project set them in the dashboard.

---

## Data Flow

**Syllabus parsing:**

1. Client uploads PDF to `syllabi` Storage bucket and calls `process-syllabus` with a `course_id`
2. Function fetches course + semester context, downloads the PDF, encodes as base64
3. Resolves an Anthropic client for the request (the caller's own BYOK key if stored, else the project's `ANTHROPIC_API_KEY` — `_shared/anthropic-client.ts`)
4. Sends document + semester dates to Claude `sonnet-4-6` with a strict JSON schema prompt
5. Claude returns structured JSON: `course`, `schedule`, `events`, `recurring_patterns`, `grading_rules`, `policies`, `extraction_quality`
6. Function writes the blob to `courses.syllabus_analysis`, updates course metadata, and bulk-inserts flattened rows into `course_events`

**Chat:**

1. Client sends message + `semester_id` + `course_ids` + conversation history to `chat`
2. Function checks `app_settings.ai_enabled` kill switch
3. Detects query type (date / grading / policy / schedule / general) from message keywords
4. Fetches relevant semester/course data scoped to the query type
5. Resolves an Anthropic client (BYOK or project key) and calls Claude `sonnet-4-6` with full context + conversation history
6. Returns reply; client persists messages to `chat_messages`

**Calendar export:**

1. Client calls `generate-ics` with `semester_id` (and optionally `course_id`)
2. Function fetches matching `course_events`, builds RFC 5545 VEVENT entries
3. Stores `.ics` file to `syllabi` bucket at `calendars/{user_id}/{id}.ics`
4. Returns file as `text/calendar` attachment

**Bring-your-own Claude key (SYL-72):**

1. Client calls `save-anthropic-key` with a candidate key
2. Function validates it with `GET https://api.anthropic.com/v1/models` (`x-api-key` header, no tokens spent) before storing anything; a rejected key returns 400 and persists nothing
3. On success, `store_anthropic_key` encrypts the key under `SECRETS_ENCRYPTION_KEY`, records `last4` + `added_at`, and resets the "last tested" metadata
4. `test-anthropic-key` re-runs the same validation against the stored key and updates `anthropic_key_last_tested_at` / `anthropic_key_last_test_ok`
5. Every AI function resolves the caller's key via `resolveAnthropicClient` before calling Claude; a 401/403 from Anthropic on a BYOK request returns `claude_key_rejected` (402) rather than silently falling back to the project key

---

## Schema

### `profiles`

Auto-created for every auth user via trigger on `auth.users`.

| Column                         | Type        | Notes                                            |
| ------------------------------ | ----------- | ------------------------------------------------ |
| `id`                           | UUID PK     | References `auth.users(id)`                      |
| `display_name`                 | TEXT        | Seeded from user metadata or email               |
| `phone_number`                 | TEXT UNIQUE |                                                  |
| `timezone`                     | TEXT        | Default `America/New_York`                       |
| `is_admin`                     | BOOLEAN     | Default `false`; required for admin functions    |
| `onboarding_completed`         | BOOLEAN     | Default `false`; set after first-time setup      |
| `onboarding_completed_at`      | TIMESTAMPTZ |                                                  |
| `canvas_token_encrypted`       | BYTEA       | pgcrypto-encrypted Canvas API token              |
| `canvas_base_url`              | TEXT        | Canvas instance URL                              |
| `canvas_token_last_tested_at`  | TIMESTAMPTZ | Set by `test-canvas-token` (SYL-72)              |
| `canvas_token_last_test_ok`    | BOOLEAN     | Set by `test-canvas-token` (SYL-72)              |
| `anthropic_key_encrypted`      | BYTEA       | pgcrypto-encrypted Claude API key (SYL-72, BYOK) |
| `anthropic_key_last4`          | TEXT        | Last 4 characters, computed at store time        |
| `anthropic_key_added_at`       | TIMESTAMPTZ |                                                  |
| `anthropic_key_last_tested_at` | TIMESTAMPTZ |                                                  |
| `anthropic_key_last_test_ok`   | BOOLEAN     |                                                  |
| `created_at`                   | TIMESTAMPTZ |                                                  |
| `updated_at`                   | TIMESTAMPTZ |                                                  |

RLS: users can SELECT and UPDATE their own row only. Column grants narrow that further: clients cannot UPDATE `is_admin`, `canvas_base_url`, either ciphertext column or any of the key/token metadata columns (SYL-25, extended by SYL-72's `profiles_block_privileged_writes()` update) and cannot SELECT `canvas_token_encrypted` / `canvas_base_url` / `anthropic_key_encrypted` at all (SYL-31).

View `profiles_safe` exposes `has_canvas_connected`, `has_anthropic_key` and the non-secret metadata columns without leaking either ciphertext.

---

### `semesters`

One row per user-defined semester (e.g. "Spring 2026").

| Column       | Type        | Notes                                                  |
| ------------ | ----------- | ------------------------------------------------------ |
| `id`         | UUID PK     |                                                        |
| `user_id`    | UUID FK     | → `profiles(id)`                                       |
| `name`       | TEXT        | Unique per user                                        |
| `start_date` | DATE        | Used by Claude to resolve relative dates like "Week 5" |
| `end_date`   | DATE        |                                                        |
| `is_active`  | BOOLEAN     | Default `true`                                         |
| `created_at` | TIMESTAMPTZ |                                                        |
| `updated_at` | TIMESTAMPTZ |                                                        |

RLS: users can CRUD their own rows.

---

### `courses`

One row per course within a semester.

| Column               | Type        | Notes                                                 |
| -------------------- | ----------- | ----------------------------------------------------- |
| `id`                 | UUID PK     |                                                       |
| `semester_id`        | UUID FK     | → `semesters(id)`                                     |
| `user_id`            | UUID FK     | → `profiles(id)`                                      |
| `name`               | TEXT        | Updated by `process-syllabus` after parsing           |
| `code`               | TEXT        | e.g. `CS 101`                                         |
| `professor`          | TEXT        |                                                       |
| `color`              | TEXT        | UI display color                                      |
| `syllabus_file_path` | TEXT        | Storage path: `{user_id}/{filename}`                  |
| `syllabus_file_name` | TEXT        | Original uploaded filename                            |
| `analysis_status`    | TEXT        | `pending` \| `processing` \| `complete` \| `failed`   |
| `analysis_error`     | TEXT        | Populated on failure                                  |
| `syllabus_analysis`  | JSONB       | Full structured output from Claude                    |
| `policies`           | JSONB       | Extracted from `syllabus_analysis.policies`           |
| `grading_rules`      | JSONB       | Extracted from `syllabus_analysis.grading_rules`      |
| `schedule`           | JSONB       | Meeting times, location, instructor info, breaks      |
| `extraction_quality` | TEXT        | Claude's self-reported completeness score             |
| `canvas_course_id`   | TEXT        | Canvas course this was imported from, if any (SYL-71) |
| `created_at`         | TIMESTAMPTZ |                                                       |
| `updated_at`         | TIMESTAMPTZ |                                                       |

RLS: users can CRUD their own rows.

---

### `course_events`

Flattened events extracted from syllabi. Written by `process-syllabus` via service role; read-only for users.

| Column                  | Type          | Notes                                                                                      |
| ----------------------- | ------------- | ------------------------------------------------------------------------------------------ |
| `id`                    | UUID PK       |                                                                                            |
| `course_id`             | UUID FK       | → `courses(id)`                                                                            |
| `user_id`               | UUID FK       | → `profiles(id)`                                                                           |
| `title`                 | TEXT NOT NULL |                                                                                            |
| `type`                  | TEXT NOT NULL | `deadline` \| `exam` \| `quiz` \| `presentation` \| `project_due` \| `no_class` \| `other` |
| `category`              | TEXT          | Maps to a `grading_rules.components[].name`                                                |
| `date`                  | DATE          | Resolved to `YYYY-MM-DD`; may be null if unresolvable                                      |
| `date_unresolved`       | TEXT          | Raw date string when resolution failed                                                     |
| `time`                  | TIME          | Null for all-day events                                                                    |
| `is_recurring_instance` | BOOLEAN       | Default `false`                                                                            |
| `confidence`            | TEXT          | `high` \| `medium` \| `low`                                                                |
| `canvas_assignment_id`  | TEXT          | Canvas assignment ID this event maps to (when matched/synced)                              |
| `canvas_matched_at`     | TIMESTAMPTZ   | When this event was matched against a Canvas assignment                                    |
| `canvas_only`           | BOOLEAN       | Default `false`; true for events imported from Canvas with no syllabus counterpart         |
| `source`                | TEXT          | `syllabus` \| `canvas_matched` \| `canvas` \| `canvas_deleted`; default `syllabus`         |
| `canvas_metadata`       | JSONB         | Raw Canvas assignment payload (points, submission types, URL, etc.)                        |
| `created_at`            | TIMESTAMPTZ   |                                                                                            |

Unique index on `(course_id, canvas_assignment_id)` where `canvas_assignment_id IS NOT NULL` enforces dedup during Canvas sync.

RLS: users can SELECT and DELETE their own rows (no INSERT/UPDATE — written by the function).

---

### `course_notes`

Free-text notes a user attaches to a course. Max 1,000 characters.

| Column       | Type        | Notes            |
| ------------ | ----------- | ---------------- |
| `id`         | UUID PK     |                  |
| `course_id`  | UUID FK     | → `courses(id)`  |
| `user_id`    | UUID FK     | → `profiles(id)` |
| `body`       | TEXT        | Max 1,000 chars  |
| `created_at` | TIMESTAMPTZ |                  |
| `updated_at` | TIMESTAMPTZ |                  |

RLS: users can CRUD their own rows.

---

### `chats`

One row per conversation session.

| Column        | Type        | Notes                           |
| ------------- | ----------- | ------------------------------- |
| `id`          | UUID PK     |                                 |
| `user_id`     | UUID FK     | → `profiles(id)`                |
| `semester_id` | UUID FK     | → `semesters(id)`               |
| `title`       | TEXT        | User-editable or auto-generated |
| `created_at`  | TIMESTAMPTZ |                                 |
| `updated_at`  | TIMESTAMPTZ |                                 |

RLS: users can CRUD their own rows.

---

### `chat_courses`

Junction table — which courses are in scope for a given chat.

| Column      | Type    | Notes           |
| ----------- | ------- | --------------- |
| `chat_id`   | UUID FK | → `chats(id)`   |
| `course_id` | UUID FK | → `courses(id)` |

---

### `chat_messages`

Individual messages within a conversation.

| Column       | Type        | Notes                                                                     |
| ------------ | ----------- | ------------------------------------------------------------------------- |
| `id`         | UUID PK     |                                                                           |
| `chat_id`    | UUID FK     | → `chats(id)`                                                             |
| `sequence`   | INTEGER     | Unique per chat; preserves order                                          |
| `role`       | TEXT        | `user` \| `assistant`                                                     |
| `content`    | TEXT        |                                                                           |
| `query_type` | TEXT        | Detected type: `date` \| `grading` \| `policy` \| `schedule` \| `general` |
| `created_at` | TIMESTAMPTZ |                                                                           |

RLS: via parent chat ownership.

---

### `chat_feedback`

User-submitted feedback on AI responses.

| Column                  | Type        | Notes                                |
| ----------------------- | ----------- | ------------------------------------ |
| `id`                    | UUID PK     |                                      |
| `user_id`               | UUID FK     | → `profiles(id)`                     |
| `chat_id`               | UUID FK     | → `chats(id)`                        |
| `semester_id`           | UUID        |                                      |
| `course_ids`            | UUID[]      | Courses in scope at time of feedback |
| `reported_at_sequence`  | INTEGER     | Which message was flagged            |
| `description`           | TEXT        | User's free-text description         |
| `conversation_snapshot` | JSONB       | Full conversation at time of report  |
| `created_at`            | TIMESTAMPTZ |                                      |

RLS: users can INSERT and SELECT their own feedback; admins can read all via service role.

---

### `app_settings`

Single-row global settings table (key: `'global'`).

| Column       | Type        | Notes                                                  |
| ------------ | ----------- | ------------------------------------------------------ |
| `id`         | TEXT PK     | Always `'global'`                                      |
| `ai_enabled` | BOOLEAN     | Globally enable/disable AI; checked by `chat` function |
| `updated_at` | TIMESTAMPTZ |                                                        |
| `updated_by` | UUID FK     | → `profiles(id)`                                       |

RLS: anyone can SELECT; only users with `profiles.is_admin = true` can UPDATE.

---

### `claude_api_logs`

Audit log of every Claude API call.

| Column          | Type        | Notes                                                   |
| --------------- | ----------- | ------------------------------------------------------- |
| `id`            | UUID PK     |                                                         |
| `user_id`       | UUID FK     | → `profiles(id)` ON DELETE SET NULL                     |
| `course_id`     | UUID FK     | → `courses(id)` ON DELETE SET NULL; null for chat calls |
| `model`         | TEXT        | e.g. `claude-sonnet-4-6`                                |
| `status`        | TEXT        | `success` \| `error`                                    |
| `input`         | TEXT        | Serialized system prompt + messages                     |
| `output`        | TEXT        | Raw Claude response                                     |
| `error_message` | TEXT        | Populated on error                                      |
| `input_tokens`  | INTEGER     |                                                         |
| `output_tokens` | INTEGER     |                                                         |
| `created_at`    | TIMESTAMPTZ |                                                         |

RLS: users can SELECT their own logs.

---

### `ai_usage`

Per-user daily counters behind the SYL-29/SYL-67 quotas, consumed against the **project's** Claude key. Written only by `public.consume_ai_quota(p_user_id, p_endpoint, p_limit, p_global_limit, p_amount)` — one atomic conditional `INSERT … ON CONFLICT … RETURNING`, executable by `service_role` only. Increments only when both the per-user and cross-user (`AI_DAILY_LIMIT_GLOBAL`) limits would still be satisfied, so a rejected request never burns a quota unit.

| Column     | Type    | Notes                                                                                                                    |
| ---------- | ------- | ------------------------------------------------------------------------------------------------------------------------ |
| `user_id`  | UUID FK | → `profiles(id)` ON DELETE CASCADE                                                                                       |
| `day`      | DATE    | UTC day                                                                                                                  |
| `endpoint` | TEXT    | `chat`, `process-syllabus`, `detect-syllabi-info`, `find-canvas-syllabus`, `match-canvas-assignments`, `manage-api-keys` |
| `count`    | INTEGER | units consumed today                                                                                                     |

Primary key `(user_id, day, endpoint)`. RLS on with no policies; `anon`/`authenticated` have no grants. Limits live in `functions/_shared/ai-limits.ts`.

---

### `ai_usage_byok`

Per-user daily counters for requests made with a user's **own** Claude key (SYL-72). A separate table rather than a `byok` flag on `ai_usage`, so the enforced-quota schema and RPC stay untouched by this feature. Written only by `public.record_byok_usage(p_user_id, p_endpoint, p_amount)`, executable by `service_role` only; never checked against a limit — BYOK requests bypass both the per-user and global caps entirely (see the parent README's Conventions section). Exists purely so the admin panel can see BYOK volume per user.

| Column     | Type    | Notes                                     |
| ---------- | ------- | ----------------------------------------- |
| `user_id`  | UUID FK | → `profiles(id)` ON DELETE CASCADE        |
| `day`      | DATE    | UTC day                                   |
| `endpoint` | TEXT    | Same endpoint names as `ai_usage`         |
| `count`    | INTEGER | units used today under the user's own key |

RLS on; `anon`/`authenticated` have no grants.

---

## Storage

**Bucket:** `syllabi` (private)

| Path pattern                   | Purpose                   |
| ------------------------------ | ------------------------- |
| `{user_id}/{filename}`         | Uploaded syllabus PDFs    |
| `calendars/{user_id}/{id}.ics` | Generated iCalendar files |

File size limit: 50 MiB. RLS policies enforce that users can only access files within their own user folder.

---

## Edge Functions

| Function                   | Auth             | Model                            | Purpose                                                                                                           |
| -------------------------- | ---------------- | -------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `process-syllabus`         | JWT required     | `claude-sonnet-4-6` (16k tokens) | Download PDF, extract structured syllabus data, write `course_events`                                             |
| `chat`                     | JWT required     | `claude-sonnet-4-6` (512 tokens) | AI assistant with semester/course context; query-type detection                                                   |
| `generate-ics`             | JWT required     | —                                | Build RFC 5545 `.ics` from `course_events`                                                                        |
| `admin-get-users`          | JWT + `is_admin` | —                                | Paginated user list; supports `?search=` and `?page=`; includes `has_anthropic_key` + BYOK request count per user |
| `detect-syllabi-info`      | JWT required     | `claude-haiku-4-5` (256 tokens)  | Lightweight parse: extract course name, code, semester from PDF (used in onboarding/bulk upload)                  |
| `save-canvas-token`        | JWT required     | —                                | Encrypt Canvas API token with pgcrypto and store on profile                                                       |
| `delete-canvas-token`      | JWT required     | —                                | Revoke stored Canvas credentials                                                                                  |
| `find-canvas-courses`      | JWT required     | —                                | Fetch courses from user's Canvas instance within a date range                                                     |
| `find-canvas-syllabus`     | JWT required     | `claude-sonnet-4-6`              | Search Canvas course modules for syllabus documents                                                               |
| `download-canvas-syllabus` | JWT required     | —                                | Download syllabus from Canvas, trigger `process-syllabus` then `match-canvas-assignments`                         |
| `match-canvas-assignments` | JWT required     | `claude-sonnet-4-6`              | Match Canvas LMS assignments to extracted `course_events`; populates `canvas_assignment_id` and related metadata  |
| `save-anthropic-key`       | JWT required     | —                                | Validate (via Anthropic `/v1/models`) and store a user's Claude API key                                           |
| `test-anthropic-key`       | JWT required     | —                                | Re-validate the stored key; update `anthropic_key_last_tested_at`/`last_test_ok`                                  |
| `delete-anthropic-key`     | JWT required     | —                                | Remove the stored Claude API key; no outbound call, not rate-limited                                              |
| `test-canvas-token`        | JWT required     | —                                | "Test connection": re-run the same Canvas `/users/self` check `save-canvas-token` uses                            |

### Claude Prompt Contract (`process-syllabus`)

- System prompt instructs Claude to output **raw JSON only** (no markdown fences)
- Function strips fences via regex as a fallback before `JSON.parse`
- `events[].date` must be resolved to `YYYY-MM-DD` using the `semester_start_date` passed in context
- `events[].type` is always required; function defaults to `"other"` if Claude omits it
- `events[].category` must match a `grading_rules.components[].name` exactly

### `chat` Query-Type Detection

The function classifies each incoming message as one of: `date`, `grading`, `policy`, `schedule`, or `general`. This controls which subset of course data is fetched from the DB before calling Claude, reducing token usage and latency.

### BYOK key resolution (SYL-72)

`process-syllabus`, `chat`, `detect-syllabi-info`, `find-canvas-syllabus` and `match-canvas-assignments` no longer construct a module-level Anthropic client from `ANTHROPIC_API_KEY`. Instead, after the caller's JWT is verified, each calls `resolveAnthropicClient(supabaseAdmin, user.id, encKey)` (`_shared/anthropic-client.ts`), which decrypts the caller's stored key via `get_anthropic_key` if one exists, or falls back to the project's `ANTHROPIC_API_KEY`. A BYOK request records usage in `ai_usage_byok` instead of consuming `ai_usage`/`AI_DAILY_LIMIT_GLOBAL`. If Anthropic rejects the user's key (401/403 — e.g. it was revoked in the console), the function returns `{ error: "claude_key_rejected", ... }` with status 402 rather than silently retrying on the project key.

---

## Environment Variables

See the [Secrets](#secrets) table above for the complete, current list — it supersedes any older table here now that SYL-72 added `SECRETS_ENCRYPTION_KEY` and `AI_DAILY_LIMIT_MANAGE_API_KEYS`, and SYL-67 added `AI_DAILY_LIMIT_GLOBAL` and `MAX_SYLLABUS_PAGES`.
