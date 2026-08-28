-- Local-only: columns the Supabase project has but no migration creates.
--
-- Applied AFTER migrations/, never pushed to Supabase. These three are read and
-- written by the Canvas edge functions but appear in no migration file, so they
-- were added by hand in the SQL editor. Without them a local database cannot run
-- the Canvas flows and local testing would be misleading.
--
-- Types are inferred from the code, not from production:
--   canvas_course_id   find-canvas-courses/index.ts:178 writes String(c.id),
--                      and useCanvasFlow.ts:19 types it as string  -> TEXT
--   canvas_sync_status find-canvas-syllabus/index.ts:402 spreads it as an
--                      object of step -> status                    -> JSONB
--   canvas_sync_error  same shape, step -> error message           -> JSONB
--
-- Confirm against production before trusting a local test of these columns:
--
--   SELECT column_name, data_type, is_nullable
--   FROM information_schema.columns
--   WHERE table_schema='public' AND table_name='courses'
--     AND column_name LIKE 'canvas%';
--
-- If production agrees, promote this file to a real migration (ADD COLUMN IF
-- NOT EXISTS makes it a no-op there) and delete it from local/.

ALTER TABLE public.courses
  ADD COLUMN IF NOT EXISTS canvas_course_id   TEXT,
  ADD COLUMN IF NOT EXISTS canvas_sync_status JSONB,
  ADD COLUMN IF NOT EXISTS canvas_sync_error  JSONB;
