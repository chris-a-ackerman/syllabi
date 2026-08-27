# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is the Supabase backend for a syllabus parsing application. It uses Supabase Edge Functions powered by Claude AI to extract structured course data (events, grading, schedule) from uploaded syllabus PDFs, support a chat assistant over that data, export iCalendar files, and integrate with Canvas LMS. There are 11 Edge Functions in total — see the README for the full table.

## Common Commands

```bash
# Local development
supabase start                                    # Start local Supabase stack
supabase stop                                     # Stop local stack

# Edge Functions
supabase functions serve process-syllabus         # Run function locally with hot reload
supabase functions deploy process-syllabus        # Deploy to production

# Database
supabase db push                                  # Apply migrations
supabase db reset                                 # Reset DB and re-run all migrations
supabase migration new <name>                     # Create a new migration file
supabase db diff --schema public                  # Diff local DB vs migrations
```

Local services run at: API `54321`, DB `54322`, Studio `54323`, Email `54324`.

## Architecture

### Data Flow

1. Client uploads a syllabus PDF to the `syllabi` Storage bucket and calls the `process-syllabus` Edge Function with a `course_id`.
2. The function fetches course/semester context from `courses` (joined with `semesters`), downloads the PDF from Storage, and encodes it as base64.
3. It sends the document + semester date context to Claude (currently `claude-sonnet-4-6`) with a system prompt that enforces a strict JSON schema output.
4. Claude returns structured JSON with keys: `course`, `schedule`, `events`, `recurring_patterns`, `grading_rules`, `policies`, `extraction_quality`.
5. The function writes the raw JSON blob to `courses.syllabus_analysis`, updates `courses.name/code/professor/analysis_status`, deletes existing `course_events` for the course, and bulk-inserts the new events.

### Key Tables

| Table | Purpose |
|---|---|
| `courses` | One row per course; holds `syllabus_file_path`, `analysis_status` (`processing`/`complete`/`failed`), `analysis_error`, and `syllabus_analysis` (full JSONB blob) |
| `semesters` | Referenced by courses; provides `start_date`/`end_date` so Claude can resolve relative dates like "Week 5" |
| `course_events` | Flattened, one-row-per-event output of the parse; includes `type` (NOT NULL), `category`, `date`, `time`, `confidence`, `is_recurring_instance`, plus Canvas-matching columns: `canvas_assignment_id`, `canvas_matched_at`, `canvas_only`, `source` (`syllabus`/`canvas_matched`/`canvas`/`canvas_deleted`), `canvas_metadata` |

**`course_events.type` is NOT NULL** with `CHECK (type IN ('deadline', 'exam', 'quiz', 'presentation', 'project_due', 'no_class', 'other'))` — defaults to `"other"` in the function if Claude omits it.

### Claude Prompt Contract

The system prompt in `process-syllabus/index.ts` instructs Claude to output **raw JSON only** (no markdown fences). Events in the `events` array must have:
- `date` — resolved to `YYYY-MM-DD` using the provided semester start date
- `type` — always required (maps to the NOT NULL column)
- `category` — must match a `grading_rules.components[].name` exactly
- `title`, `confidence`, `is_recurring_instance`

If Claude wraps its response in markdown code fences despite the prompt, the function strips them via regex before `JSON.parse`.

### Edge Function Config

```toml
# config.toml
[functions.process-syllabus]
verify_jwt = true
import_map = "./functions/process-syllabus/deno.json"
```

JWT verification is enforced — all calls require a valid Supabase auth token.

### Environment Variables (required)

- `SUPABASE_URL`
- `SERVICE_ROLE_KEY` — used for the Supabase client inside the function (bypasses RLS)
- `ANTHROPIC_API_KEY`
