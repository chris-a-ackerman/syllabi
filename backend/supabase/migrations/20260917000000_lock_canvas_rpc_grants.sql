-- SYL-74: the Canvas token RPCs are callable by anon and authenticated.
--
-- store_canvas_token, get_canvas_token and delete_canvas_token are SECURITY
-- DEFINER and act on the p_user_id they are handed rather than auth.uid(),
-- but 20260406000000_canvas_token.sql never revoked EXECUTE from the client
-- roles, and PostgREST serves every public function at /rest/v1/rpc/<name>.
-- A caller holding only the publishable anon key could therefore delete any
-- user's stored Canvas credentials given their user id, with no session.
-- Supabase's own database linter reports all three (lints 0028 and 0029)
-- against the hosted project.
--
-- REVOKE ... FROM PUBLIC alone would not have fixed it either. Supabase ships
--
--   ALTER DEFAULT PRIVILEGES IN SCHEMA public
--     GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
--
-- so each function was created carrying *explicit* anon=X/authenticated=X ACL
-- entries, which revoking the PUBLIC pseudo-role leaves in place. The roles
-- have to be named. Same lesson as SYL-72, which caught this in
-- 20260915000000_anthropic_key.sql before that migration was ever applied;
-- these three were deployed back in April, so they need their own migration.
--
-- Safe for every caller: the seven Edge Functions that use these RPCs
-- (save-canvas-token, delete-canvas-token, test-canvas-token,
-- find-canvas-courses, find-canvas-syllabus, download-canvas-syllabus,
-- match-canvas-assignments) all build their client with
-- SUPABASE_SERVICE_ROLE_KEY. Nothing reaches them from the browser.

REVOKE ALL ON FUNCTION public.store_canvas_token(UUID, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.store_canvas_token(UUID, TEXT, TEXT, TEXT) TO service_role;

REVOKE ALL ON FUNCTION public.get_canvas_token(UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_canvas_token(UUID, TEXT) TO service_role;

REVOKE ALL ON FUNCTION public.delete_canvas_token(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_canvas_token(UUID) TO service_role;

-- handle_new_user is an AFTER INSERT trigger on auth.users and has no reason
-- to be reachable as an RPC. Revoking it cannot affect signup: Postgres checks
-- EXECUTE on a trigger function when the trigger is created, not when it
-- fires, and 99_verify.sql's SYL-30 assertion (a new auth.users row still
-- produces a profile) is the regression test for that. No service_role grant
-- is added here — it keeps the one the default privileges already gave it,
-- which is harmless, since service_role is the backend's own trusted role.
-- The point is only to take the function off anon and authenticated.
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
