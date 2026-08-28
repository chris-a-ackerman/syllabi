-- Moved from backend/supabase/20260223163000_claude-api-logs.sql, which sat
-- outside migrations/ and so was never part of a fresh apply — the 20260304
-- migration ALTERs this table and failed on any clean database. Renumbered to
-- run after courses, and made idempotent so pushing to a project that already
-- has the table is a no-op.
CREATE TABLE IF NOT EXISTS public.claude_api_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  course_id UUID REFERENCES public.courses(id) ON DELETE SET NULL,
  model TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('success', 'error')),
  output TEXT,
  error_message TEXT,
  input_tokens INTEGER,
  output_tokens INTEGER,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.claude_api_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own logs" ON public.claude_api_logs;
CREATE POLICY "Users can view their own logs"
  ON public.claude_api_logs
  FOR SELECT
  USING (auth.uid() = user_id);
