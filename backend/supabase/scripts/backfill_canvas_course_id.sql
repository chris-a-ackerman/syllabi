-- Backfill courses.canvas_course_id for courses that lost their Canvas link
-- (SYL-92/SYL-104 follow-up). This is a one-off data fix, not a migration.
--
-- Run it only AFTER migration 20260930000000_courses_canvas_id_per_semester.
-- Before that migration, the old (user_id, canvas_course_id) index rejects the
-- same UPDATE that failed in the first place.
--
-- DRY RUN BY DEFAULT: the transaction ends in ROLLBACK. Read the preview and
-- the UPDATE ... RETURNING rows, then change the last line to COMMIT to apply.
--
--   psql "$DB_URL" -f backend/supabase/scripts/backfill_canvas_course_id.sql
--   (or paste it into the Supabase SQL editor)
--
-- Evidence, per course, only where canvas_course_id IS NULL:
--   1. claude_api_logs rows written by find-canvas-syllabus. Its prompt is
--      "Find the syllabus for Canvas course ID <n>. …", logged with the course's
--      id. The import flow sends that id in the same step as the link that
--      failed.
--   2. course_events.canvas_metadata->>'canvas_url' (…/courses/<n>/…), written
--      by match-canvas-assignments.
-- A course is filled only when every id from each source agrees on one id, and
-- no other course in the same semester already holds it. Anything else is
-- listed with a reason and left alone.

BEGIN;

CREATE TEMP VIEW canvas_id_backfill AS
WITH log_ids AS (
  SELECT l.course_id,
         (regexp_match(l.input, 'Find the syllabus for Canvas course ID ([0-9]+)\.'))[1] AS cid
  FROM public.claude_api_logs l
  WHERE l.course_id IS NOT NULL
    AND l.input LIKE '%Find the syllabus for Canvas course ID %'
),
event_ids AS (
  SELECT e.course_id,
         (regexp_match(e.canvas_metadata->>'canvas_url', '/courses/([0-9]+)(?:[/?#]|$)'))[1] AS cid
  FROM public.course_events e
  WHERE e.canvas_metadata->>'canvas_url' IS NOT NULL
),
per_log AS (
  SELECT course_id, min(cid) AS cid, count(DISTINCT cid) AS n
  FROM log_ids WHERE cid IS NOT NULL GROUP BY course_id
),
per_event AS (
  SELECT course_id, min(cid) AS cid, count(DISTINCT cid) AS n
  FROM event_ids WHERE cid IS NOT NULL GROUP BY course_id
),
candidates AS (
  SELECT c.id, c.user_id, c.semester_id, c.code, c.name,
         l.cid AS log_id, l.n AS log_n, e.cid AS event_id, e.n AS event_n
  FROM public.courses c
  LEFT JOIN per_log l ON l.course_id = c.id
  LEFT JOIN per_event e ON e.course_id = c.id
  WHERE c.canvas_course_id IS NULL
    AND (l.cid IS NOT NULL OR e.cid IS NOT NULL)
),
decided AS (
  SELECT cand.*,
         CASE
           WHEN coalesce(log_n, 0) > 1 THEN NULL
           WHEN coalesce(event_n, 0) > 1 THEN NULL
           WHEN log_id IS NOT NULL AND event_id IS NOT NULL AND log_id <> event_id THEN NULL
           ELSE coalesce(log_id, event_id)
         END AS new_id
  FROM candidates cand
)
SELECT d.*,
       CASE
         WHEN coalesce(d.log_n, 0) > 1 THEN 'skip: logs name more than one Canvas id'
         WHEN coalesce(d.event_n, 0) > 1 THEN 'skip: events name more than one Canvas id'
         WHEN d.new_id IS NULL THEN 'skip: logs and events disagree'
         WHEN EXISTS (
           SELECT 1 FROM public.courses o
           WHERE o.semester_id = d.semester_id AND o.canvas_course_id = d.new_id
         ) THEN 'skip: another course in this semester already has this id'
         WHEN (
           SELECT count(*) FROM decided d2
           WHERE d2.semester_id = d.semester_id AND d2.new_id = d.new_id
         ) > 1 THEN 'skip: two courses in this semester resolve to this id'
         ELSE 'fill'
       END AS action
FROM decided d;

-- Preview: every candidate with its evidence and what will happen to it.
SELECT u.email, s.name AS semester, s.is_active, b.code, b.name,
       b.log_id, b.event_id, b.new_id, b.action
FROM canvas_id_backfill b
JOIN public.semesters s ON s.id = b.semester_id
JOIN auth.users u ON u.id = b.user_id
ORDER BY u.email, s.start_date DESC, b.code;

-- Apply.
UPDATE public.courses c
SET canvas_course_id = b.new_id
FROM canvas_id_backfill b
WHERE b.id = c.id
  AND b.action = 'fill'
  AND c.canvas_course_id IS NULL
RETURNING c.id, c.code, c.name, c.canvas_course_id;

ROLLBACK;  -- change to COMMIT to apply
