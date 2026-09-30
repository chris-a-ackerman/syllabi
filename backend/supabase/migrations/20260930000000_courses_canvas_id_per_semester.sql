-- Re-importing a Canvas semester silently dropped canvas_course_id
-- (SYL-92/SYL-104 follow-up).
--
-- Production had a hand-added index that no migration ever created:
--
--   CREATE UNIQUE INDEX idx_courses_canvas_id
--     ON public.courses (user_id, canvas_course_id)
--     WHERE canvas_course_id IS NOT NULL;
--
-- One Canvas course per *user* is wrong. The same Canvas course legitimately
-- appears in two of a user's semesters, for example when a semester is
-- imported again. useCanvasFlow.confirm() creates the new course and then
-- stamps canvas_course_id. That UPDATE hit a unique violation (23505) for
-- every course the older semester already held, and nothing checked the
-- error, so the new rows kept a NULL id. agent-upcoming then returned
-- canvas_course_id: null, and match-canvas-assignments skipped those courses.
--
-- Uniqueness belongs per semester: one row per Canvas course inside a
-- semester still stops a double import, but a new semester can link the
-- course again. DROP ... IF EXISTS makes this a no-op on a
-- from-migrations database, where the old index never existed.
DROP INDEX IF EXISTS public.idx_courses_canvas_id;

CREATE UNIQUE INDEX IF NOT EXISTS idx_courses_semester_canvas_id
  ON public.courses (semester_id, canvas_course_id)
  WHERE canvas_course_id IS NOT NULL;

-- Canvas course ids are integers. find-canvas-courses writes String(c.id), and
-- the class-prep agent only accepts digits. A URL or any other shape stored
-- here would reach the agent as null, so refuse it at write time. Production
-- held only digit strings when this was written (9 of 9 rows).
ALTER TABLE public.courses
  DROP CONSTRAINT IF EXISTS courses_canvas_course_id_digits;
ALTER TABLE public.courses
  ADD CONSTRAINT courses_canvas_course_id_digits
  CHECK (canvas_course_id IS NULL OR canvas_course_id ~ '^[0-9]+$');
