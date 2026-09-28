-- SYL-92: scoped, revocable, read-only tokens for an external agent, so the
-- agent never holds the user's Supabase password or a session JWT.
--
-- The raw token (`syl_agent_` + 32 random bytes, base64url) is shown to the
-- user exactly once by create-agent-token; only its sha256 is stored here.
-- Lookups by hash happen in the edge functions under service_role
-- (_shared/agent-auth.ts#resolveCaller). Clients can list their own tokens
-- (never the hash), create them, and revoke them — nothing else.

CREATE TABLE IF NOT EXISTS public.agent_tokens (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token_hash   TEXT NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  label        TEXT CHECK (label IS NULL OR char_length(label) <= 100),
  -- Only scopes that some function actually checks for are storable, so a
  -- token can never be minted with a capability that doesn't exist yet.
  scopes       TEXT[] NOT NULL DEFAULT '{read:upcoming}'
               CHECK (cardinality(scopes) > 0 AND scopes <@ ARRAY['read:upcoming']::TEXT[]),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ,
  revoked_at   TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_agent_tokens_user ON public.agent_tokens(user_id);

ALTER TABLE public.agent_tokens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read own agent tokens" ON public.agent_tokens;
CREATE POLICY "Users can read own agent tokens"
  ON public.agent_tokens FOR SELECT
  USING (auth.uid() = user_id);

-- A new token starts live and unused; the caller can't pre-date either field.
DROP POLICY IF EXISTS "Users can create own agent tokens" ON public.agent_tokens;
CREATE POLICY "Users can create own agent tokens"
  ON public.agent_tokens FOR INSERT
  WITH CHECK (auth.uid() = user_id AND revoked_at IS NULL AND last_used_at IS NULL);

DROP POLICY IF EXISTS "Users can revoke own agent tokens" ON public.agent_tokens;
CREATE POLICY "Users can revoke own agent tokens"
  ON public.agent_tokens FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- No DELETE policy: a revoked row stays as the audit trail.

-- ── Column-level grants (same two-layer approach as profiles, SYL-25/31) ────
-- Supabase's ALTER DEFAULT PRIVILEGES hands anon/authenticated ALL on every
-- new table; take it back and grant only what the client needs. token_hash
-- is never client-readable, and the only client-writable column after insert
-- is revoked_at.
REVOKE ALL ON public.agent_tokens FROM anon, authenticated;

GRANT SELECT (id, user_id, label, scopes, created_at, last_used_at, revoked_at)
  ON public.agent_tokens TO authenticated;
GRANT INSERT (id, user_id, token_hash, label, scopes)
  ON public.agent_tokens TO authenticated;
GRANT UPDATE (revoked_at)
  ON public.agent_tokens TO authenticated;

-- ── Revocation is one-way ───────────────────────────────────────────────────
-- Applies to every role, service_role included: once revoked_at is set it can
-- never be cleared or moved, so a revoked token can't be brought back.
CREATE OR REPLACE FUNCTION public.agent_tokens_revoke_once()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS DISTINCT FROM OLD.revoked_at THEN
    RAISE EXCEPTION 'agent token % is already revoked', OLD.id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.agent_tokens_revoke_once() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS agent_tokens_revoke_once ON public.agent_tokens;
CREATE TRIGGER agent_tokens_revoke_once
  BEFORE UPDATE ON public.agent_tokens
  FOR EACH ROW EXECUTE FUNCTION public.agent_tokens_revoke_once();

-- ── agent_tokens_safe: the documented client read surface ───────────────────
-- Mirrors profiles_safe: runs with the owner's privileges, filtered to the
-- caller, and simply has no token_hash column.
CREATE OR REPLACE VIEW public.agent_tokens_safe AS
  SELECT id, label, scopes, created_at, last_used_at, revoked_at
  FROM public.agent_tokens
  WHERE user_id = auth.uid();

REVOKE ALL ON public.agent_tokens_safe FROM anon, authenticated;
GRANT SELECT ON public.agent_tokens_safe TO authenticated;
