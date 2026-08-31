-- Local-only: asserts the Wave 0 security fixes actually hold on a real
-- database. Raises on the first failure, so the runner exits non-zero.
--
-- Not a substitute for testing against staging — this proves the SQL does what
-- it claims, not that production's grants and schema match this repo.

\set ON_ERROR_STOP on

DO $$
DECLARE
  v_a       UUID;
  v_b       UUID;
  v_blocked BOOLEAN;
  v_rows    INTEGER;
  v_token   TEXT;
  v_url     TEXT;
  v_cols    TEXT[];
  v_missing TEXT;
BEGIN
  -- ── seed two users; the signup trigger creates their profiles ─────────────
  INSERT INTO auth.users (email, raw_user_meta_data)
    VALUES ('a@test.local', '{"full_name":"User A"}') RETURNING id INTO v_a;
  INSERT INTO auth.users (email, raw_user_meta_data)
    VALUES ('b@test.local', '{"full_name":"User B"}') RETURNING id INTO v_b;

  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = v_a) THEN
    RAISE EXCEPTION 'SYL-30: handle_new_user did not create a profile row';
  END IF;

  -- ── SYL-25: a user cannot grant themselves admin ──────────────────────────
  v_blocked := false;
  BEGIN
    SET LOCAL ROLE authenticated;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_b)::text, true);
    UPDATE public.profiles SET is_admin = true WHERE id = v_b;
  EXCEPTION WHEN OTHERS THEN
    v_blocked := true;
  END;
  RESET ROLE;
  IF NOT v_blocked THEN
    RAISE EXCEPTION 'SYL-25: authenticated was able to set is_admin on its own row';
  END IF;
  IF (SELECT is_admin FROM public.profiles WHERE id = v_b) THEN
    RAISE EXCEPTION 'SYL-25: is_admin ended up true despite the write being rejected';
  END IF;

  -- ── SYL-25/28: a user cannot repoint their own canvas_base_url ────────────
  v_blocked := false;
  BEGIN
    SET LOCAL ROLE authenticated;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_b)::text, true);
    UPDATE public.profiles SET canvas_base_url = 'https://evil.example' WHERE id = v_b;
  EXCEPTION WHEN OTHERS THEN
    v_blocked := true;
  END;
  RESET ROLE;
  IF NOT v_blocked THEN
    RAISE EXCEPTION 'SYL-28: authenticated was able to write canvas_base_url directly';
  END IF;

  -- ── SYL-25: the same user's ordinary profile edit still works ─────────────
  BEGIN
    SET LOCAL ROLE authenticated;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_b)::text, true);
    UPDATE public.profiles SET display_name = 'Renamed B' WHERE id = v_b;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
  END;
  RESET ROLE;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'SYL-25: owner could no longer update display_name (regression)';
  END IF;

  -- ── RLS still isolates users from each other ──────────────────────────────
  BEGIN
    SET LOCAL ROLE authenticated;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_b)::text, true);
    UPDATE public.profiles SET display_name = 'Owned by B' WHERE id = v_a;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
  END;
  RESET ROLE;
  IF v_rows <> 0 THEN
    RAISE EXCEPTION 'RLS: user B updated user A''s profile row';
  END IF;

  -- ── SYL-25: exactly the intended columns are writable by the client ───────
  SELECT array_agg(column_name ORDER BY column_name) INTO v_cols
  FROM information_schema.column_privileges
  WHERE table_schema = 'public' AND table_name = 'profiles'
    AND grantee = 'authenticated' AND privilege_type = 'UPDATE';

  FOREACH v_missing IN ARRAY ARRAY['is_admin','canvas_token_encrypted','canvas_base_url'] LOOP
    IF v_cols @> ARRAY[v_missing] THEN
      RAISE EXCEPTION 'SYL-25: authenticated still holds UPDATE on %', v_missing;
    END IF;
  END LOOP;
  IF NOT v_cols @> ARRAY['display_name'] THEN
    RAISE EXCEPTION 'SYL-25: authenticated lost UPDATE on display_name';
  END IF;

  -- ── SYL-30: the definer path still works under SYL-25's trigger ───────────
  -- store_canvas_token writes two of the columns the trigger guards. If the
  -- trigger over-blocked, or extensions.pgp_sym_* did not resolve under the
  -- empty search_path, this round trip fails.
  PERFORM public.store_canvas_token(v_b, 'tok_local_123', 'https://canvas.mit.edu', 'test_key');
  SELECT public.get_canvas_token(v_b, 'test_key') INTO v_token;
  IF v_token IS DISTINCT FROM 'tok_local_123' THEN
    RAISE EXCEPTION 'SYL-30: canvas token round trip returned %, expected tok_local_123', v_token;
  END IF;
  SELECT canvas_base_url INTO v_url FROM public.profiles WHERE id = v_b;
  IF v_url IS DISTINCT FROM 'https://canvas.mit.edu' THEN
    RAISE EXCEPTION 'SYL-30: store_canvas_token did not persist canvas_base_url';
  END IF;

  PERFORM public.delete_canvas_token(v_b);
  IF (SELECT canvas_token_encrypted FROM public.profiles WHERE id = v_b) IS NOT NULL THEN
    RAISE EXCEPTION 'SYL-30: delete_canvas_token left the token in place';
  END IF;

  -- ── SYL-30: every SECURITY DEFINER function pins search_path ──────────────
  SELECT string_agg(p.proname, ', ') INTO v_missing
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.prosecdef
    AND NOT COALESCE(array_to_string(p.proconfig, ',') LIKE '%search_path%', false);
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'SYL-30: SECURITY DEFINER without search_path: %', v_missing;
  END IF;

  -- ── SYL-25: the guard trigger must run as invoker, or CURRENT_USER inside
  --    it would be the owner and the check would never fire ─────────────────
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger t
    JOIN pg_proc p ON p.oid = t.tgfoid
    WHERE t.tgrelid = 'public.profiles'::regclass
      AND t.tgname = 'profiles_block_privileged_writes'
      AND NOT p.prosecdef
  ) THEN
    RAISE EXCEPTION 'SYL-25: guard trigger missing, or defined SECURITY DEFINER';
  END IF;

  RAISE NOTICE 'All security assertions passed.';
END;
$$;

-- ── SYL-29: ai_usage quota counters ─────────────────────────────────────────
DO $$
DECLARE
  v_a       UUID;
  v_count   INTEGER;
  v_blocked BOOLEAN;
BEGIN
  SELECT id INTO v_a FROM auth.users WHERE email = 'a@test.local';

  -- The counter increments atomically and isolates endpoints from each other.
  SELECT public.consume_ai_quota(v_a, 'chat', 1) INTO v_count;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'SYL-29: first consume returned %, expected 1', v_count;
  END IF;
  SELECT public.consume_ai_quota(v_a, 'chat', 1) INTO v_count;
  IF v_count <> 2 THEN
    RAISE EXCEPTION 'SYL-29: second consume returned %, expected 2', v_count;
  END IF;
  SELECT public.consume_ai_quota(v_a, 'detect-syllabi-info', 5) INTO v_count;
  IF v_count <> 5 THEN
    RAISE EXCEPTION 'SYL-29: batched consume returned %, expected 5', v_count;
  END IF;
  SELECT public.consume_ai_quota(v_a, 'chat', 1) INTO v_count;
  IF v_count <> 3 THEN
    RAISE EXCEPTION 'SYL-29: endpoints share a counter (chat returned %)', v_count;
  END IF;

  -- Clients can neither execute the counter function...
  v_blocked := false;
  BEGIN
    SET LOCAL ROLE authenticated;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_a)::text, true);
    PERFORM public.consume_ai_quota(v_a, 'chat', 1);
  EXCEPTION WHEN insufficient_privilege THEN
    v_blocked := true;
  END;
  RESET ROLE;
  IF NOT v_blocked THEN
    RAISE EXCEPTION 'SYL-29: authenticated can execute consume_ai_quota';
  END IF;

  -- ...nor read the counters directly.
  v_blocked := false;
  BEGIN
    SET LOCAL ROLE authenticated;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_a)::text, true);
    PERFORM count(*) FROM public.ai_usage;
  EXCEPTION WHEN insufficient_privilege THEN
    v_blocked := true;
  END;
  RESET ROLE;
  IF NOT v_blocked THEN
    RAISE EXCEPTION 'SYL-29: authenticated can SELECT from ai_usage';
  END IF;

  RAISE NOTICE 'SYL-29 quota assertions passed.';
END;
$$;
