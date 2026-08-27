CREATE TABLE public.semesters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, name)
);

CREATE INDEX idx_semesters_user ON public.semesters(user_id);

ALTER TABLE public.semesters ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can CRUD own semesters"
  ON public.semesters FOR ALL USING (auth.uid() = user_id);