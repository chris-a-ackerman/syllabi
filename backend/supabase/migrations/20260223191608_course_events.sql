CREATE TABLE public.course_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id UUID NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  date DATE,
  date_unresolved TEXT,
  time TIME,
  title TEXT NOT NULL,
  type TEXT NOT NULL
    CHECK (type IN ('deadline', 'exam', 'quiz', 'presentation', 'project_due', 'no_class', 'other')),
  category TEXT,
  is_recurring_instance BOOLEAN DEFAULT false,
  confidence TEXT DEFAULT 'medium'
    CHECK (confidence IN ('high', 'medium', 'low')),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_events_user_date ON public.course_events(user_id, date);
CREATE INDEX idx_events_course_date ON public.course_events(course_id, date);

ALTER TABLE public.course_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can read own events"
  ON public.course_events FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own events"
  ON public.course_events FOR DELETE USING (auth.uid() = user_id);