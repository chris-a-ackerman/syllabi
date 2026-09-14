-- SYL-72: bring-your-own Claude API key (BYOK) storage, mirroring the Canvas
-- token pattern (20260406000000_canvas_token.sql) — encrypted at rest, never
-- readable through the client API, decrypted only inside SECURITY DEFINER
-- functions. Idempotent throughout so this is safe to re-run against a
-- partially-applied database.
--
-- Encryption key: a new SECRETS_ENCRYPTION_KEY env var (decision recorded in
-- README conventions), not a reuse of CANVAS_ENCRYPTION_KEY — keeps the two
-- secrets' rotation independent.
--
-- Also adds canvas_token_last_tested_at/last_test_ok, since "Test connection"
-- for Canvas needs somewhere to record its result and this is the natural
-- migration for it (same profiles_safe / privileged-write-lock touch points).

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS anthropic_key_encrypted BYTEA,
  ADD COLUMN IF NOT EXISTS anthropic_key_last4 TEXT,
  ADD COLUMN IF NOT EXISTS anthropic_key_added_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS anthropic_key_last_tested_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS anthropic_key_last_test_ok BOOLEAN,
  ADD COLUMN IF NOT EXISTS canvas_token_last_tested_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS canvas_token_last_test_ok BOOLEAN;

-- ── Storage functions (SYL-30: search_path pinned, fully-qualified names) ──

-- Stores (encrypts) a user's Anthropic key. Computes last4 itself so this
-- function is the only place in the system that ever sees the plaintext
-- outside the edge function that validated it. Resets the "last tested"
-- metadata — a freshly stored/replaced key hasn't been tested yet under
-- itself; the edge function calls record_key_test right after this succeeds,
-- since save-anthropic-key validates the key before storing it.
CREATE OR REPLACE FUNCTION public.store_anthropic_key(
  p_user_id UUID,
  p_key TEXT,
  p_enc_key TEXT
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  UPDATE public.profiles
  SET
    anthropic_key_encrypted = extensions.pgp_sym_encrypt(p_key, p_enc_key),
    anthropic_key_last4 = right(p_key, 4),
    anthropic_key_added_at = pg_catalog.now(),
    anthropic_key_last_tested_at = NULL,
    anthropic_key_last_test_ok = NULL,
    updated_at = pg_catalog.now()
  WHERE id = p_user_id;
END;
$$;
REVOKE ALL ON FUNCTION public.store_anthropic_key(UUID, TEXT, TEXT) FROM PUBLIC;

-- Retrieves (decrypts) a user's Anthropic key, or NULL if none is stored.
CREATE OR REPLACE FUNCTION public.get_anthropic_key(p_user_id UUID, p_enc_key TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN (
    SELECT extensions.pgp_sym_decrypt(anthropic_key_encrypted, p_enc_key)
    FROM public.profiles
    WHERE id = p_user_id
      AND anthropic_key_encrypted IS NOT NULL
  );
END;
$$;
REVOKE ALL ON FUNCTION public.get_anthropic_key(UUID, TEXT) FROM PUBLIC;

-- Deletes (removes) a user's stored Anthropic key and its metadata.
CREATE OR REPLACE FUNCTION public.delete_anthropic_key(p_user_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  UPDATE public.profiles
  SET
    anthropic_key_encrypted = NULL,
    anthropic_key_last4 = NULL,
    anthropic_key_added_at = NULL,
    anthropic_key_last_tested_at = NULL,
    anthropic_key_last_test_ok = NULL,
    updated_at = pg_catalog.now()
  WHERE id = p_user_id;
END;
$$;
REVOKE ALL ON FUNCTION public.delete_anthropic_key(UUID) FROM PUBLIC;

-- Records the outcome of a key/token test-connection check ('anthropic' or
-- 'canvas') so the Settings UI can show "Last tested {relative} — ok/rejected"
-- without ever handing the client the key or the provider's response body.
CREATE OR REPLACE FUNCTION public.record_key_test(
  p_user_id UUID,
  p_provider TEXT,
  p_ok BOOLEAN
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_provider = 'anthropic' THEN
    UPDATE public.profiles
    SET anthropic_key_last_tested_at = pg_catalog.now(), anthropic_key_last_test_ok = p_ok
    WHERE id = p_user_id;
  ELSIF p_provider = 'canvas' THEN
    UPDATE public.profiles
    SET canvas_token_last_tested_at = pg_catalog.now(), canvas_token_last_test_ok = p_ok
    WHERE id = p_user_id;
  ELSE
    RAISE EXCEPTION 'record_key_test: unknown provider %', p_provider;
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.record_key_test(UUID, TEXT, BOOLEAN) FROM PUBLIC;

-- ── profiles_safe: never the ciphertext ─────────────────────────────────────

-- CREATE OR REPLACE VIEW can only append columns, never reorder or insert
-- them among the existing ones — the new columns go after updated_at.
CREATE OR REPLACE VIEW public.profiles_safe AS
  SELECT
    id, display_name, phone_number, timezone, canvas_base_url,
    (canvas_token_encrypted IS NOT NULL) AS has_canvas_connected,
    created_at, updated_at,
    canvas_token_last_tested_at,
    canvas_token_last_test_ok,
    (anthropic_key_encrypted IS NOT NULL) AS has_anthropic_key,
    anthropic_key_last4,
    anthropic_key_added_at,
    anthropic_key_last_tested_at,
    anthropic_key_last_test_ok
  FROM public.profiles
  WHERE id = auth.uid();

GRANT SELECT ON public.profiles_safe TO authenticated;

-- ── SYL-25 privileged-write lock: extend to the new columns ─────────────────
-- Not added to the column-level GRANT UPDATE list on public.profiles (still
-- only display_name/phone_number/timezone/onboarding_*/updated_at) — this
-- trigger is defense-in-depth on top of that absence, same as canvas_*.

CREATE OR REPLACE FUNCTION public.profiles_block_privileged_writes()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF CURRENT_USER NOT IN ('anon', 'authenticated') THEN
    RETURN NEW;
  END IF;

  IF NEW.is_admin IS DISTINCT FROM OLD.is_admin THEN
    RAISE EXCEPTION 'is_admin cannot be changed through the client API';
  END IF;

  IF NEW.canvas_token_encrypted IS DISTINCT FROM OLD.canvas_token_encrypted THEN
    RAISE EXCEPTION 'canvas_token_encrypted cannot be changed through the client API';
  END IF;

  IF NEW.canvas_base_url IS DISTINCT FROM OLD.canvas_base_url THEN
    RAISE EXCEPTION 'canvas_base_url cannot be changed through the client API';
  END IF;

  IF NEW.canvas_token_last_tested_at IS DISTINCT FROM OLD.canvas_token_last_tested_at THEN
    RAISE EXCEPTION 'canvas_token_last_tested_at cannot be changed through the client API';
  END IF;

  IF NEW.canvas_token_last_test_ok IS DISTINCT FROM OLD.canvas_token_last_test_ok THEN
    RAISE EXCEPTION 'canvas_token_last_test_ok cannot be changed through the client API';
  END IF;

  IF NEW.anthropic_key_encrypted IS DISTINCT FROM OLD.anthropic_key_encrypted THEN
    RAISE EXCEPTION 'anthropic_key_encrypted cannot be changed through the client API';
  END IF;

  IF NEW.anthropic_key_last4 IS DISTINCT FROM OLD.anthropic_key_last4 THEN
    RAISE EXCEPTION 'anthropic_key_last4 cannot be changed through the client API';
  END IF;

  IF NEW.anthropic_key_added_at IS DISTINCT FROM OLD.anthropic_key_added_at THEN
    RAISE EXCEPTION 'anthropic_key_added_at cannot be changed through the client API';
  END IF;

  IF NEW.anthropic_key_last_tested_at IS DISTINCT FROM OLD.anthropic_key_last_tested_at THEN
    RAISE EXCEPTION 'anthropic_key_last_tested_at cannot be changed through the client API';
  END IF;

  IF NEW.anthropic_key_last_test_ok IS DISTINCT FROM OLD.anthropic_key_last_test_ok THEN
    RAISE EXCEPTION 'anthropic_key_last_test_ok cannot be changed through the client API';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_block_privileged_writes ON public.profiles;
CREATE TRIGGER profiles_block_privileged_writes
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.profiles_block_privileged_writes();

-- ── BYOK usage observability ─────────────────────────────────────────────
-- BYOK requests bypass consume_ai_quota entirely (they don't touch the
-- project's bill), so a separate, unenforced counter table records volume
-- for the admin panel. Kept apart from ai_usage/consume_ai_quota rather than
-- adding a `byok` column there, so the enforced quota's schema and RPC
-- signature (SYL-67) stay untouched by this pass.

CREATE TABLE IF NOT EXISTS public.ai_usage_byok (
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  day DATE NOT NULL,
  endpoint TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day, endpoint)
);

ALTER TABLE public.ai_usage_byok ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ai_usage_byok FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.record_byok_usage(
  p_user_id UUID,
  p_endpoint TEXT,
  p_amount INTEGER DEFAULT 1
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  INSERT INTO public.ai_usage_byok (user_id, day, endpoint, count)
  VALUES (p_user_id, (pg_catalog.now() AT TIME ZONE 'utc')::date, p_endpoint, p_amount)
  ON CONFLICT (user_id, day, endpoint)
  DO UPDATE SET count = public.ai_usage_byok.count + p_amount;
$$;

REVOKE ALL ON FUNCTION public.record_byok_usage(UUID, TEXT, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_byok_usage(UUID, TEXT, INTEGER) TO service_role;
