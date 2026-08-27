ALTER TABLE public.courses
  ADD COLUMN IF NOT EXISTS schedule JSONB;
