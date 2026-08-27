-- Enable pgcrypto for symmetric encryption
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Add encrypted token storage to profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS canvas_token_encrypted BYTEA,
  ADD COLUMN IF NOT EXISTS canvas_base_url TEXT;

-- Safe view: exposes has_canvas_connected but never the encrypted bytes
-- Filtered to the authenticated user via auth.uid()
CREATE OR REPLACE VIEW public.profiles_safe AS
  SELECT
    id, display_name, phone_number, timezone, canvas_base_url,
    (canvas_token_encrypted IS NOT NULL) AS has_canvas_connected,
    created_at, updated_at
  FROM public.profiles
  WHERE id = auth.uid();

-- Store (encrypt) a Canvas token for a user
CREATE OR REPLACE FUNCTION store_canvas_token(
  p_user_id UUID,
  p_token TEXT,
  p_base_url TEXT,
  p_key TEXT
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE public.profiles
  SET
    canvas_token_encrypted = pgp_sym_encrypt(p_token, p_key),
    canvas_base_url = p_base_url,
    updated_at = now()
  WHERE id = p_user_id;
END;
$$;
REVOKE ALL ON FUNCTION store_canvas_token FROM PUBLIC;

-- Retrieve (decrypt) a Canvas token for a user
CREATE OR REPLACE FUNCTION get_canvas_token(p_user_id UUID, p_key TEXT)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  RETURN (
    SELECT pgp_sym_decrypt(canvas_token_encrypted, p_key)
    FROM public.profiles
    WHERE id = p_user_id
      AND canvas_token_encrypted IS NOT NULL
  );
END;
$$;
REVOKE ALL ON FUNCTION get_canvas_token FROM PUBLIC;

-- Delete (disconnect) a Canvas token for a user
CREATE OR REPLACE FUNCTION delete_canvas_token(p_user_id UUID)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE public.profiles
  SET canvas_token_encrypted = NULL, canvas_base_url = NULL, updated_at = now()
  WHERE id = p_user_id;
END;
$$;
REVOKE ALL ON FUNCTION delete_canvas_token FROM PUBLIC;
