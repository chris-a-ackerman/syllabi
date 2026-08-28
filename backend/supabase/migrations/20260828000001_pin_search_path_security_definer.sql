-- SYL-30: Pin search_path on all SECURITY DEFINER functions
--
-- handle_new_user, store_canvas_token, get_canvas_token and delete_canvas_token
-- are SECURITY DEFINER but set no search_path, while config.toml puts `public`
-- and `extensions` on every request's search path. Any role able to create
-- objects in a schema earlier on the definer's path could shadow an object
-- these functions call — pgp_sym_encrypt/pgp_sym_decrypt among them — and run
-- code as the definer. Hardening: it needs a create-privilege foothold first.
--
-- Each function now runs with an empty search_path and fully-qualified names.

-- pgp_sym_encrypt/pgp_sym_decrypt are qualified as extensions.* below, so fail
-- loudly here rather than at Canvas-connect time if pgcrypto lives elsewhere.
DO $$
DECLARE
  v_schema TEXT;
BEGIN
  SELECT n.nspname INTO v_schema
  FROM pg_extension e
  JOIN pg_namespace n ON n.oid = e.extnamespace
  WHERE e.extname = 'pgcrypto';

  IF v_schema IS NULL THEN
    RAISE EXCEPTION 'pgcrypto is not installed; canvas token functions cannot be created';
  ELSIF v_schema <> 'extensions' THEN
    RAISE EXCEPTION
      'pgcrypto is installed in schema %, but this migration qualifies pgp_sym_* as extensions.*', v_schema;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email));
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.store_canvas_token(
  p_user_id UUID,
  p_token TEXT,
  p_base_url TEXT,
  p_key TEXT
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  UPDATE public.profiles
  SET
    canvas_token_encrypted = extensions.pgp_sym_encrypt(p_token, p_key),
    canvas_base_url = p_base_url,
    updated_at = pg_catalog.now()
  WHERE id = p_user_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_canvas_token(p_user_id UUID, p_key TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN (
    SELECT extensions.pgp_sym_decrypt(canvas_token_encrypted, p_key)
    FROM public.profiles
    WHERE id = p_user_id
      AND canvas_token_encrypted IS NOT NULL
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_canvas_token(p_user_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  UPDATE public.profiles
  SET canvas_token_encrypted = NULL,
      canvas_base_url = NULL,
      updated_at = pg_catalog.now()
  WHERE id = p_user_id;
END;
$$;

-- CREATE OR REPLACE preserves existing grants, but re-assert them in case a
-- function is being created fresh here (live schema drift).
REVOKE ALL ON FUNCTION public.store_canvas_token(UUID, TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_canvas_token(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.delete_canvas_token(UUID) FROM PUBLIC;
