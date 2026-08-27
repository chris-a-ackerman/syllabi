CREATE TABLE public.courses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  semester_id UUID NOT NULL REFERENCES public.semesters(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  code TEXT,
  professor TEXT,
  color TEXT,
  syllabus_analysis JSONB,
  analysis_status TEXT DEFAULT 'pending'
    CHECK (analysis_status IN ('pending', 'processing', 'complete', 'failed')),
  analysis_error TEXT,
  syllabus_file_path TEXT,
  syllabus_file_name TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_courses_semester ON public.courses(semester_id);
CREATE INDEX idx_courses_user ON public.courses(user_id);

ALTER TABLE public.courses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can CRUD own courses"
  ON public.courses FOR ALL USING (auth.uid() = user_id);