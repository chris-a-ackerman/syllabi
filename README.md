# Syllabi — Student Academic Assistant

Syllabi is a student-focused web app. Students upload course syllabi as PDFs, Claude parses them into structured data (deadlines, exams, grading rules, policies, meeting schedule), and a chat assistant answers questions across all of a student's courses. Events export to `.ics`, and courses can be pulled in from Canvas LMS.

- **Production frontend:** https://syllabi-one.vercel.app (Vercel deploys the `main` branch)
- **Backend:** a hosted Supabase project (Postgres, Auth, Storage, Edge Functions)
- **Work tracking:** Linear, team key `SYL`

This file is the living run / test / release guide. Schema and function internals live in [`backend/supabase/README.md`](backend/supabase/README.md); the SQL test harness in [`backend/supabase/local/README.md`](backend/supabase/local/README.md).

---

## Repository layout

This directory is the git root — the backend lives **inside** it.

```
.
├── src/
│   ├── app/pages/          one component per route
│   ├── app/components/     feature components; ui/ holds the shadcn primitives
│   ├── app/context/        AuthProvider · SettingsProvider · DataProvider · ChatProvider
│   ├── app/hooks/          useBulkUpload · useCanvasFlow · useChatRename · useProcessingPoll
│   ├── app/routes.tsx      React Router v7 (data mode)
│   └── lib/
│       ├── api/            every Supabase query / Storage / Edge Function call lives here
│       ├── types.ts        shared domain types
│       ├── mappers.ts      DB row → domain object
│       └── *.ts            pure helpers: eventHelpers, agendaGrouping, deadlineUrgency, gradeWeight, courseColors
├── backend/supabase/
│   ├── config.toml         local stack + per-function config
│   ├── migrations/         schema, applied with `supabase db push`
│   ├── functions/          eleven Deno edge functions + _shared/
│   ├── tests/unit/         Deno unit tests (pure modules, config tripwires)
│   ├── tests/contract/     HTTP contract tests against a live local stack
│   └── local/              db-test.sh + SQL: rebuild the schema on plain Postgres, assert RLS/security invariants
├── e2e/                    authenticated browser pass (run.sh, render-pass.mjs, seed.sql)
└── .github/workflows/ci.yml
```

---

## Tech stack

| Layer | Choice |
|---|---|
| Frontend | React 19, TypeScript (strict), Vite 6, Tailwind CSS v4, React Router v7 (data mode), shadcn/ui on Radix, date-fns, react-markdown, sonner |
| Backend | Supabase: Postgres 17, Auth (PKCE), Storage, Edge Functions on Deno 2 |
| AI | `claude-sonnet-4-6` for syllabus parsing, chat, Canvas syllabus search and assignment matching; `claude-haiku-4-5` for the lightweight detect step |
| Tooling | ESLint (flat config), Prettier, Vitest, Deno test, GitHub Actions |

---

## Prerequisites

| Tool | Version | Needed for |
|---|---|---|
| Node + npm | 22+ (`.nvmrc`) | frontend, e2e |
| Deno | 2.x | backend unit + contract tests |
| Supabase CLI | **≥ 2.116** | local stack, contract/e2e, deploys. Older CLIs verify local ES256 tokens as HS256 and reject every real JWT. |
| Docker | any recent | the local Supabase stack (contract, e2e, manual backend testing) |
| PostgreSQL + `psql` | 17 preferred | `npm run db:test` (no Docker needed); e2e also uses `psql` |
| Google Chrome / Chromium | any | e2e (`CHROME_BIN` overrides auto-detection) |

---

## Quick start (frontend against the hosted backend)

```bash
npm install
# create .env (gitignored):
#   VITE_SUPABASE_URL=https://<project-ref>.supabase.co
#   VITE_SUPABASE_ANON_KEY=<anon / publishable key>
npm run dev            # http://localhost:5173
npm run build          # production build into dist/
```

The dev server talks to whichever project `.env` points at. Point it at the local stack (next section) to exercise local schema and functions instead of production's.

---

## Running the backend locally

Every Supabase CLI command takes `--workdir backend` from the repo root (or run it from `backend/`).

```bash
supabase start --workdir backend                                      # full stack, Studio at http://127.0.0.1:54323
supabase start -x studio,imgproxy,logflare,vector --workdir backend   # trimmed, what CI boots
supabase status --workdir backend                                     # URLs + keys
supabase db reset --workdir backend                                   # wipe the local DB, re-run migrations
supabase stop --workdir backend                                       # keeps a DB backup; --no-backup discards it
```

Ports: API `54321`, DB `54322`, Studio `54323`, Mailpit (local email) `54324`. Migrations run automatically on `start`.

**Edge functions.** `supabase start` serves all eleven functions with only the platform-injected `SUPABASE_*` variables. To give them an Anthropic key and the other secrets, serve them with an env file:

```bash
# backend/supabase/.env.local (gitignored)
ANTHROPIC_API_KEY=sk-ant-...
SERVICE_ROLE_KEY=<SERVICE_ROLE_KEY from `supabase status`>
CANVAS_ENCRYPTION_KEY=<any string locally>

cd backend && supabase functions serve --env-file supabase/.env.local     # all functions, hot reload
```

`SERVICE_ROLE_KEY` (unprefixed) is read by `process-syllabus`, `generate-ics` and `detect-syllabi-info`; the other eight read the injected `SUPABASE_SERVICE_ROLE_KEY`. `functions serve` refuses to load `SUPABASE_`-prefixed names from an env file, which is why the unprefixed name exists — and why the hosted project also needs it set as a secret.

**Local auth.** Email confirmation is on (`enable_confirmations = true`), so a signup through the UI needs the link Mailpit catches at http://127.0.0.1:54324. To skip that, create users through the GoTrue admin API with the local service-role key:

```bash
eval "$(supabase status -o env --workdir backend | sed 's/"//g' | grep -E '^(API_URL|DB_URL|SERVICE_ROLE_KEY)=' | sed 's/^/export /')"
curl -s -X POST "$API_URL/auth/v1/admin/users" \
  -H "apikey: $SERVICE_ROLE_KEY" -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"email":"dev@syllabi.test","password":"a-long-password","email_confirm":true}'
# make that user an admin (clients cannot set this column themselves — SYL-25)
psql "$DB_URL" -c "UPDATE public.profiles SET is_admin = true WHERE id = '<uuid from the response>'"
```

---

## Testing

Five tiers, one per CI job. Run the first three before every PR; the last two need Docker.

| Tier | Command | Needs | CI job |
|---|---|---|---|
| Frontend static + unit | `npm run typecheck && npm run lint && npm test && npm run build` | Node | `frontend-unit` |
| Backend unit | `cd backend/supabase && deno task test:unit` | Deno | `deno-unit` |
| Schema + RLS assertions | `npm run db:test` | a local Postgres | `db-test` |
| Edge-function contracts | below | Docker, Supabase CLI, Deno | `contract` |
| Authenticated browser pass | `./e2e/run.sh` | Docker, Supabase CLI, Chrome, Node 22+ | `e2e` |

Formatting is `npm run format` (write) / `npm run format:check`. CI does not enforce it yet — see [Known gaps](#known-gaps).

### Contract tests

Exactly what `ci.yml` does, locally. The env file carries a **dummy** Anthropic key on purpose: every asserted path must reject before a model call, so an accidental call fails loudly. It also shrinks `MAX_SYLLABUS_BYTES` to 1 KiB for the size-cap tests.

```bash
supabase start -x studio,imgproxy,logflare,vector,realtime --workdir backend
cd backend
supabase/tests/contract/serve-env.sh > /tmp/contract.env
supabase functions serve --env-file /tmp/contract.env &      # wait until GET /functions/v1/chat returns 401
eval "$(supabase status -o env | sed 's/"//g' | grep -E '^(API_URL|ANON_KEY|SERVICE_ROLE_KEY)=' | sed 's/^/export /')"
cd supabase
SUPABASE_URL=$API_URL SUPABASE_ANON_KEY=$ANON_KEY SUPABASE_SERVICE_ROLE_KEY=$SERVICE_ROLE_KEY deno task test:contract
```

The fixtures are idempotent (two users, a semester, courses, an event), so the tests can be re-run against a warm stack.

### E2E

Creates its two users at runtime with a per-run password against the local stack — no stored credentials, and nothing touches the hosted project. It inserts fixed IDs and emails, so it needs a **fresh database every run**:

```bash
supabase start -x studio,imgproxy,logflare,vector --workdir backend
supabase db reset --workdir backend
./e2e/run.sh          # E2E_PORT (5199), CDP_PORT (9222), CHROME_BIN to override
```

It signs in through the real form, visits every screen, fails on any console error / page exception / failed request / unexpected redirect, exercises the note, semester and admin kill-switch flows, and then asserts the resulting rows with `psql`.

### Conventions

- Tests pin **behaviour of pure modules, HTTP contracts and DB invariants** — never component structure — so they survive refactors.
- A known bug is pinned by a characterization test marked `// BUG (characterization): see SYL-xx` and paired with a Linear issue. The fixing PR flips the test; never "fix" the test alone.
- `backend/supabase/tests/unit/config-drift.test.ts` is the auth tripwire: all eleven functions run with `verify_jwt = false` (so browsers can preflight), so each handler must parse `Authorization` and call `auth.getUser` before doing anything. A new function needs a `[functions.<name>]` block in `config.toml` or this test fails.
- Contract tests assert status codes and coarse body shape, never exact error prose.
- `backend/supabase/local/99_verify.sql` holds the SQL-level assertions (SYL-25/28/29/30/31 + RLS isolation). Extend it whenever a migration touches a policy or grant.

---

## CI

`.github/workflows/ci.yml` runs on every pull request and on pushes to `main`: `frontend-unit`, `deno-unit`, `db-test` (postgres:17 service), `contract` and `e2e` (each of the last two boots a real local stack with Supabase CLI 2.116.0). Pushes to a long-lived branch such as `refactor` are only tested through the PRs into it.

---

## Branching and PRs

- `main` is what Vercel deploys. Work happens on a branch named after its Linear issue (`chris333/syl-NN-…`) and lands through a PR.
- Large multi-PR efforts use a long-lived integration branch (currently `refactor`, Linear project "App Refactor"). PRs into it are stacked and reviewed in 300–800-line chunks; one final `refactor → main` PR is the release gate. GitHub rebases the upper branches when a lower PR merges, so `git fetch && git reset --hard origin/<branch>` before building on one, and restack with `git rebase --onto <new-base> <old-base>` + `git push --force-with-lease`.
- Before opening a PR: typecheck, lint, Vitest, Deno unit and `db:test` green locally. CI covers contract + e2e.
- Close the loop in Linear with a comment: what shipped, where the implementation departed from the acceptance criteria, and any hosted-project steps still required.

---

## Releasing to production

The frontend deploys itself: Vercel builds `main` (SPA rewrite in `vercel.json`; `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` are set in the Vercel project).

Backend changes are deployed by hand from `backend/`, with the CLI linked to the hosted project (`supabase link --project-ref <ref>`, once):

```bash
cd backend
(cd .. && npm run db:test)             # 1. schema rebuild + security assertions green locally
supabase migration list                # 2. which migrations the hosted DB is missing
supabase db push --dry-run             # 3. review
supabase db push                       # 4. apply migrations — schema only, functions are separate
supabase functions deploy              # 5. deploy ALL functions (or one: supabase functions deploy chat)
supabase secrets set NAME=value        # 6. only when a new secret is introduced
```

Function secrets on the hosted project: `ANTHROPIC_API_KEY`, `CANVAS_ENCRYPTION_KEY`, `SERVICE_ROLE_KEY` (see above). Optional tuning: `AI_DAILY_LIMIT_CHAT`, `AI_DAILY_LIMIT_PROCESS_SYLLABUS`, `AI_DAILY_LIMIT_DETECT_SYLLABI_INFO`, `AI_DAILY_LIMIT_FIND_CANVAS_SYLLABUS`, `AI_DAILY_LIMIT_MATCH_CANVAS_ASSIGNMENTS`, `MAX_SYLLABUS_BYTES`. `supabase secrets list` shows what is set.

`config.toml` governs **local stacks only**. On the hosted project these live in the Supabase dashboard and must be changed by hand: Auth → email confirmation, minimum password length, Site URL and redirect allow-list; Google OAuth credentials.

Two caveats. The hosted schema was partly built by hand in the SQL editor, so migrations are a claim, not ground truth — `backend/supabase/local/90_prod_drift.sql` documents three `courses` columns that exist in production without a migration. And the migration history was baselined with `supabase migration repair` on 2026-08-28, so `migration list` is reliable from then on.

### Pending for the `refactor → main` release (as of 2026-09-01)

- [ ] Open and merge the `refactor → main` PR — all six waves (SYL-25…56) are merged into `refactor`.
- [ ] `supabase db push` — the hosted DB is missing `20260901000000_ai_usage` and `20260902000000_rls_hardening`.
- [ ] `supabase functions deploy` for all eleven functions (SYL-29 quotas, SYL-31 hardening and log hygiene, SYL-42 `verify_jwt` flips for `generate-ics` / `admin-get-users`, SYL-50…54 fixes).
- [ ] Supabase dashboard (SYL-32): Confirm email **on**, minimum password length **8**, Site URL `https://syllabi-one.vercel.app`, redirect allow-list including `/auth/callback`. Then verify a real signup confirmation and a Google sign-in against production.
- [ ] Confirm the three `90_prod_drift.sql` column types in production and promote that file to a real migration.

---

## Architecture

### Data flow

1. **Syllabus upload** — PDF to the private `syllabi` bucket at `{user_id}/{file}` → `process-syllabus` (course ownership enforced, 20 MiB cap, 25/day) → Claude → JSON into `courses.syllabus_analysis` → events flattened into `course_events`.
2. **Onboarding / bulk upload** — `detect-syllabi-info` (Haiku, one quota unit per file, paths scoped to the caller) extracts name / code / semester dates → user reviews → courses and semesters are created → `useProcessingPoll` polls `analysis_status`.
3. **Chat** — `chat` checks the `app_settings.ai_enabled` kill switch and the 100/day quota, classifies the question (date / grading / policy / schedule / general), fetches only that slice of course data, calls Claude, and the client persists to `chats` / `chat_messages`.
4. **Calendar export** — `generate-ics` builds an RFC 5545 file from `course_events` for a semester or one course.
5. **Canvas LMS** — `save-canvas-token` (pgcrypto-encrypted, base URL SSRF-guarded) → `find-canvas-courses` → `find-canvas-syllabus` + `download-canvas-syllabus` → `process-syllabus` → `match-canvas-assignments`.

### Frontend

Providers nest as `AuthProvider › SettingsProvider › DataProvider › ChatProvider` (`App.tsx`):

| Hook | Provides |
|---|---|
| `useAuth()` | `user` (with `isAdmin`, `onboardingCompleted`), `loading`, `profileLoaded`, `markOnboardingComplete`, `signOut` |
| `useSettings()` | `aiEnabled`, `setAiEnabled` (writes `app_settings`) |
| `useData()` | `semesters`, `courses`, `events`, `notes` + CRUD, `setActiveSemester`, `refreshCourses`, `refreshEvents` |
| `useChat()` | `chats`, `currentChatId`, `chatMessages`, `addChatMessage`, `startNewChat`, `selectChat`, `deleteChat`, `renameChat`, `submitFeedback` |

Components never call Supabase directly — everything goes through `src/lib/api/*` (`auth`, `semesters`, `courses`, `events`, `notes`, `chat`, `syllabus`, `calendar`, `settings`, `admin`). `lib/api/syllabus.ts#uploadAndProcess` is the single upload pipeline (create course → upload → set `syllabus_file_path` → invoke `process-syllabus`) used by single upload, bulk upload, onboarding and the Canvas flow.

| Route | Page | Guard |
|---|---|---|
| `/` | `AuthScreen` | public |
| `/auth/callback` | `AuthCallback` | public (Google OAuth redirect) |
| `/onboarding` | `Onboarding` | signed in; redirects to `/dashboard` once `onboarding_completed` |
| `/dashboard` | `Dashboard` | signed in |
| `/courses` | `Courses` | signed in |
| `/course/:id` | `CourseDetail` | signed in |
| `/agenda` | `Agenda` | signed in |
| `/settings/canvas` | `CanvasSettings` | signed in |
| `/admin` | `AdminPanel` | signed in + `is_admin`; waits for the profile fetch before deciding (SYL-55) |

`ProtectedLayout` in `routes.tsx` wraps every signed-in route; `/admin` uses the `adminOnly` variant.

Feature components (`src/app/components/`): `AppHeader` (nav + mobile drawer), `DashboardSidebar` (Knowledge Base / Chat History tabs), `ChatPanel`, `ChatHistoryList`, `EditableChatTitle`, `FeedbackDialog`, `AddCourseChooser`, `UploadSyllabusModal` (single upload and re-upload), `CourseFormModal` + `CourseFormFields` (manual create / edit), `BulkUploadModal` + `BulkReviewForm` (shared with Onboarding), `SyllabusDropzone`, `AddSemesterModal`, `EditSemesterModal`, `ConfirmDeleteDialog`, `CourseQuickInfoCards`, `DeadlineUrgencyBanner`, `ProtectedRoute`. shadcn primitives live in `components/ui/` (React 19 flavour — regenerate with `npx shadcn add`, don't hand-edit).

### Backend

| Function | Model | Daily limit / user | Purpose |
|---|---|---|---|
| `process-syllabus` | sonnet-4-6 (16k tokens) | 25 · 20 MiB per file | Parse a PDF into `syllabus_analysis` + `course_events` |
| `detect-syllabi-info` | haiku-4-5 (256 tokens) | 50 files | Name / code / semester dates for onboarding and bulk upload |
| `chat` | sonnet-4-6 (512 tokens) | 100 | Assistant answer scoped by query type |
| `generate-ics` | — | — | `.ics` for a semester or course |
| `admin-get-users` | — | — | Paginated user list; requires `is_admin` |
| `save-canvas-token` | — | — | Verify with Canvas, encrypt, store on `profiles` |
| `delete-canvas-token` | — | — | Revoke stored Canvas credentials |
| `find-canvas-courses` | — | — | Courses in a date range from the user's Canvas |
| `find-canvas-syllabus` | sonnet-4-6 | 25 | Locate the syllabus document in Canvas modules |
| `download-canvas-syllabus` | — | — | Pull the PDF from Canvas, trigger `process-syllabus` |
| `match-canvas-assignments` | sonnet-4-6 (2k tokens) | 25 | Map Canvas assignments onto `course_events` |

Every function verifies the caller's JWT in-handler before any DB read, Storage read, outbound fetch or model call. Shared helpers in `functions/_shared/`: `ai-limits.ts` (the limits above, env-overridable), `ai-quota.ts` (atomic `consume_ai_quota` RPC, fails **closed**), `canvas-url.ts` (`assertSafeCanvasUrl`: https only, blocked private / loopback / metadata ranges, DNS-resolved), `cors.ts` (wildcard — bearer-token JSON API, no cookies), `strip-json-fences.ts`, `iso-date.ts`, `strip-html.ts`.

Claude prompt contract for `process-syllabus`: raw JSON only (fences stripped as a fallback); `events[].date` resolved to `YYYY-MM-DD` from the semester dates; `events[].type` always present (defaults to `other` — the column is `NOT NULL` with a `CHECK`); `events[].time_start` maps to `course_events.time`; `time_end` is currently dropped (no column).

Tables: `profiles`, `semesters`, `courses`, `course_events`, `course_notes`, `chats`, `chat_courses`, `chat_messages`, `chat_feedback`, `app_settings` (single row, `ai_enabled`), `claude_api_logs`, `ai_usage` (per-user daily counters, service role only). Storage bucket `syllabi` (private; `{user_id}/…` PDFs and `calendars/{user_id}/…` exports). Column-level grants keep `is_admin`, `canvas_base_url` and the token ciphertext out of client reach.

---

## Key features

- **Auth** — email/password (confirmation required, 8-char minimum) and Google OAuth via PKCE. New users go to onboarding, returning users to the dashboard.
- **Onboarding** — drag-and-drop several PDFs → detect → review grouped by semester → create → poll until parsed.
- **Semesters** — create/edit/delete; one active semester drives the chat sidebar and course grid.
- **Courses** — manual, single-PDF, bulk-PDF or Canvas import; status badge (`processing` / `ready` / `failed`); ten colour presets.
- **Course detail** — tabs for Events, Grading, Schedule, Policies, Notes; quick actions: chat about this course, download calendar, re-upload syllabus, delete.
- **Agenda** — one timeline of deadlines across courses, with undated events in a "Date TBD" group and an urgency banner.
- **Chat** — markdown answers with course/semester context, chat history with rename/delete, thumbs-down feedback stored in `chat_feedback`, honours the admin kill switch.
- **Admin** — toggle AI globally; paginated, searchable user list.
- **Canvas** — connect an instance, import courses, fetch syllabi from modules, match assignments to extracted events.

---

## Known gaps

- Prettier isn't enforced in CI and most of the tree is unformatted. Run `npm run format` as a standalone commit, then add `npm run format:check` to the `frontend-unit` job.
- `course_events` has no `time_end`; `.ics` exports use a default duration (follow-up noted on SYL-52).
- `config.toml`'s `[inbucket]` section is deprecated in CLI 2.116 — rename to `[local_smtp]`.
- ESLint reports warnings (`react-hooks/set-state-in-effect`, `react-refresh/only-export-components`); warnings do not fail CI.

---

## Design tokens

Primary `indigo-600` with violet accents on white / `gray-50` / `gray-100`; borders `gray-200` / `gray-300`; text `gray-900` / `gray-600` / `gray-500`. Course colours: indigo, violet, pink, salmon, orange, yellow, green, teal, blue, slate. Spacing `p-4` / `p-6` / `p-8`; corners `rounded-lg` → `rounded-2xl` → `rounded-full`. Tailwind v4 is configured through the Vite plugin (no `tailwind.config.js`); `@` aliases `src/`.
