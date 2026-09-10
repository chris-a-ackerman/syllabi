-- SYL-67: consume_ai_quota follow-ups.
--
-- Problem 1: consume_ai_quota incremented public.ai_usage unconditionally and
-- left the over-limit check to the caller (functions/_shared/ai-quota.ts), so
-- a rejected request still burned its quota unit — at 45/50, a 10-unit batch
-- got both a 429 AND left the counter at 55.
--
-- Problem 2: nothing capped total AI spend across users, only per-user.
--
-- Fix: consume_ai_quota now takes the per-user limit AND a cross-user daily
-- limit, and only increments (either counter) when the whole request fits
-- under both. Both counters are locked with SELECT ... FOR UPDATE before
-- either is read, so the accept/reject decision and both increments happen
-- in one atomic step — no request can land between the check and the write.

-- The 3-arg overload is replaced, not extended — CREATE OR REPLACE with a
-- different parameter list creates a new overload instead of updating this
-- one, silently leaving the old (unconditional) version reachable.
DROP FUNCTION IF EXISTS public.consume_ai_quota(UUID, TEXT, INTEGER);

-- Cross-user daily counter — one row per UTC day, summed across every user
-- and endpoint. Same access pattern as ai_usage: service role only.
CREATE TABLE IF NOT EXISTS public.ai_usage_global (
  day   DATE NOT NULL PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 0
);

ALTER TABLE public.ai_usage_global ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ai_usage_global FROM anon, authenticated;

-- Atomically check-and-increment both the per-user and the global counter.
-- Returns (count, global_exceeded) for the caller to translate into a
-- response: count IS NULL means the request was rejected without either
-- counter being touched; global_exceeded distinguishes which gate it hit so
-- the 429 body can say so.
CREATE OR REPLACE FUNCTION public.consume_ai_quota(
  p_user_id UUID,
  p_endpoint TEXT,
  p_limit INTEGER,
  p_global_limit INTEGER,
  p_amount INTEGER DEFAULT 1
)
RETURNS TABLE(count INTEGER, global_exceeded BOOLEAN)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_day          DATE := (now() AT TIME ZONE 'utc')::date;
  v_user_count   INTEGER;
  v_global_count INTEGER;
BEGIN
  -- Ensure both rows exist, then lock them in a fixed order (user row before
  -- global row, both ordered by their own primary key) so two concurrent
  -- calls can never deadlock on each other.
  INSERT INTO public.ai_usage (user_id, day, endpoint, count)
  VALUES (p_user_id, v_day, p_endpoint, 0)
  ON CONFLICT (user_id, day, endpoint) DO NOTHING;

  INSERT INTO public.ai_usage_global (day, count)
  VALUES (v_day, 0)
  ON CONFLICT (day) DO NOTHING;

  SELECT au.count INTO v_user_count
  FROM public.ai_usage au
  WHERE au.user_id = p_user_id AND au.day = v_day AND au.endpoint = p_endpoint
  FOR UPDATE;

  SELECT g.count INTO v_global_count
  FROM public.ai_usage_global g
  WHERE g.day = v_day
  FOR UPDATE;

  IF v_user_count + p_amount > p_limit THEN
    RETURN QUERY SELECT NULL::INTEGER, FALSE;
    RETURN;
  END IF;

  IF v_global_count + p_amount > p_global_limit THEN
    RETURN QUERY SELECT NULL::INTEGER, TRUE;
    RETURN;
  END IF;

  UPDATE public.ai_usage au SET count = au.count + p_amount
  WHERE au.user_id = p_user_id AND au.day = v_day AND au.endpoint = p_endpoint
  RETURNING au.count INTO v_user_count;

  UPDATE public.ai_usage_global g SET count = g.count + p_amount
  WHERE g.day = v_day;

  RETURN QUERY SELECT v_user_count, FALSE;
END;
$$;

REVOKE ALL ON FUNCTION public.consume_ai_quota(UUID, TEXT, INTEGER, INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_ai_quota(UUID, TEXT, INTEGER, INTEGER, INTEGER) TO service_role;
