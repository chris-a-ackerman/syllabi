ALTER TABLE public.course_events
  ADD COLUMN IF NOT EXISTS canvas_assignment_id TEXT,
  ADD COLUMN IF NOT EXISTS canvas_matched_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS canvas_only          BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS source               TEXT    DEFAULT 'syllabus'
    CHECK (source IN ('syllabus', 'canvas_matched', 'canvas', 'canvas_deleted')),
  ADD COLUMN IF NOT EXISTS canvas_metadata      JSONB;

-- Unique index for SYL-11 deduplication during sync
CREATE UNIQUE INDEX IF NOT EXISTS idx_course_events_canvas_assignment
  ON public.course_events(course_id, canvas_assignment_id)
  WHERE canvas_assignment_id IS NOT NULL;
