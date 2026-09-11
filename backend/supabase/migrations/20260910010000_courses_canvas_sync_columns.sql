-- SYL-69: promote local/90_prod_drift.sql to a real migration.
--
-- These three courses columns were added by hand in the SQL editor and
-- existed only in local/90_prod_drift.sql (applied after migrations/, never
-- pushed to Supabase) — a from-migrations database couldn't run the Canvas
-- flows, and local testing of them was misleading. ADD COLUMN IF NOT EXISTS
-- makes this a no-op against production, where the columns already exist.
--
-- Types match what the Canvas edge functions already read/write:
--   canvas_course_id   find-canvas-courses/index.ts writes String(c.id),
--                      and useCanvasFlow.ts types it as string  -> TEXT
--   canvas_sync_status find-canvas-syllabus/index.ts spreads it as an
--                      object of step -> status                 -> JSONB
--   canvas_sync_error  same shape, step -> error message        -> JSONB

ALTER TABLE public.courses
  ADD COLUMN IF NOT EXISTS canvas_course_id   TEXT,
  ADD COLUMN IF NOT EXISTS canvas_sync_status JSONB,
  ADD COLUMN IF NOT EXISTS canvas_sync_error  JSONB;
