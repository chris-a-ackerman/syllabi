-- SYL-25: Prevent self-service admin escalation via profiles.is_admin
--
-- "Users can update own profile" (20260223191529_profiles.sql:26) allows an
-- UPDATE of the caller's own profiles row with no column-level restriction,
-- and the default Supabase grants give `authenticated` UPDATE on every column.
-- Any logged-in user could therefore set is_admin = true on themselves and
-- pass the admin-get-users gate, or write canvas_base_url directly (SYL-28).
--
-- Two layers, so the columns stay locked even if blanket table grants are
-- re-applied later by a dashboard action or a future migration:
--   1. Column-level UPDATE grants — PostgREST rejects a write to any column
--      outside the allowed list before it ever reaches RLS.
--   2. A BEFORE UPDATE trigger that rejects changes to the privileged columns
--      from any role other than service_role or the database owner.

REVOKE UPDATE ON public.profiles FROM anon, authenticated;

GRANT UPDATE (
  display_name,
  phone_number,
  timezone,
  onboarding_completed,
  onboarding_completed_at,
  updated_at
) ON public.profiles TO authenticated;

CREATE OR REPLACE FUNCTION public.profiles_block_privileged_writes()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  -- Block the two roles PostgREST exposes to the client and nothing else, so
  -- service_role (Edge Functions), the SQL editor, migrations, and the
  -- SECURITY DEFINER canvas-token functions keep working whatever role they
  -- run as.
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

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_block_privileged_writes ON public.profiles;
CREATE TRIGGER profiles_block_privileged_writes
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.profiles_block_privileged_writes();
