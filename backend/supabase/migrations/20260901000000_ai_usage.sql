-- SYL-29: per-user daily usage counters for the AI endpoints.
--
-- Each AI-backed Edge Function calls public.consume_ai_quota (service role
-- only) before invoking Claude and returns 429 once the caller's daily count
-- exceeds the endpoint's limit. Limits themselves live in
-- functions/_shared/ai-limits.ts — this table only counts.

CREATE TABLE public.ai_usage (
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  day DATE NOT NULL,
  endpoint TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day, endpoint)
);

-- RLS on, no policies: only the service role (which bypasses RLS) reads or
-- writes these counters. Clients have no direct access.
ALTER TABLE public.ai_usage ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ai_usage FROM anon, authenticated;

-- Atomically increment today's counter and return the new count. A single
-- INSERT ... ON CONFLICT statement so concurrent bursts serialize on the row
-- lock instead of double-counting or racing past the limit check.
CREATE OR REPLACE FUNCTION public.consume_ai_quota(
  p_user_id UUID,
  p_endpoint TEXT,
  p_amount INTEGER DEFAULT 1
)
RETURNS INTEGER
LANGUAGE sql
SET search_path = ''
AS $$
  INSERT INTO public.ai_usage (user_id, day, endpoint, count)
  VALUES (p_user_id, (now() AT TIME ZONE 'utc')::date, p_endpoint, p_amount)
  ON CONFLICT (user_id, day, endpoint)
  DO UPDATE SET count = public.ai_usage.count + p_amount
  RETURNING count;
$$;

REVOKE ALL ON FUNCTION public.consume_ai_quota(UUID, TEXT, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_ai_quota(UUID, TEXT, INTEGER) TO service_role;
