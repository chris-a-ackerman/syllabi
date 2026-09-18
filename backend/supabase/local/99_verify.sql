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

-- ── SYL-29/SYL-67: ai_usage quota counters ──────────────────────────────────
DO $$
DECLARE
  v_a       UUID;
  v_count   INTEGER;
  v_global  BOOLEAN;
  v_blocked BOOLEAN;
BEGIN
  SELECT id INTO v_a FROM auth.users WHERE email = 'a@test.local';

  -- The counter increments atomically and isolates endpoints from each other.
  -- p_limit/p_global_limit are set far above anything consumed in this block
  -- except where a test deliberately sizes them to force a rejection.
  SELECT count INTO v_count FROM public.consume_ai_quota(v_a, 'chat', 100, 100000, 1);
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'SYL-29: first consume returned %, expected 1', v_count;
  END IF;
  SELECT count INTO v_count FROM public.consume_ai_quota(v_a, 'chat', 100, 100000, 1);
  IF v_count <> 2 THEN
    RAISE EXCEPTION 'SYL-29: second consume returned %, expected 2', v_count;
  END IF;
  SELECT count INTO v_count FROM public.consume_ai_quota(v_a, 'detect-syllabi-info', 100, 100000, 5);
  IF v_count <> 5 THEN
    RAISE EXCEPTION 'SYL-29: batched consume returned %, expected 5', v_count;
  END IF;
  SELECT count INTO v_count FROM public.consume_ai_quota(v_a, 'chat', 100, 100000, 1);
  IF v_count <> 3 THEN
    RAISE EXCEPTION 'SYL-29: endpoints share a counter (chat returned %)', v_count;
  END IF;

  -- SYL-67: a request that would push the per-user count over p_limit is
  -- rejected (count IS NULL, global_exceeded FALSE) and does NOT increment —
  -- the 'chat' counter is 3; asking for 1 more against a limit of 3 must fail.
  SELECT count, global_exceeded INTO v_count, v_global
  FROM public.consume_ai_quota(v_a, 'chat', 3, 100000, 1);
  IF v_count IS NOT NULL THEN
    RAISE EXCEPTION 'SYL-67: over-user-limit consume returned %, expected NULL (rejected)', v_count;
  END IF;
  IF v_global IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'SYL-67: over-user-limit rejection reported as global, not per-user';
  END IF;
  -- Prove the rejection above left the counter at 3, not 4: raising the
  -- limit to 4 and consuming 1 more must land on exactly 4.
  SELECT count INTO v_count FROM public.consume_ai_quota(v_a, 'chat', 4, 100000, 1);
  IF v_count IS DISTINCT FROM 4 THEN
    RAISE EXCEPTION 'SYL-67: rejected consume was not a no-op — counter is % instead of 4', v_count;
  END IF;

  -- SYL-67: a request that would push the GLOBAL count over p_global_limit is
  -- rejected the same way (global_exceeded TRUE this time) and also leaves no
  -- trace in ai_usage — the per-user row for this endpoint must not exist.
  SELECT count, global_exceeded INTO v_count, v_global
  FROM public.consume_ai_quota(v_a, 'process-syllabus', 100, 1, 5);
  IF v_count IS NOT NULL THEN
    RAISE EXCEPTION 'SYL-67: over-global-limit consume returned %, expected NULL (rejected)', v_count;
  END IF;
  IF v_global IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'SYL-67: over-global-limit rejection not reported as global';
  END IF;
  SELECT count INTO v_count FROM public.ai_usage
  WHERE user_id = v_a AND endpoint = 'process-syllabus' AND day = (now() AT TIME ZONE 'utc')::date;
  -- No row, or a 0-row placeholder from row-locking, is fine (not "usage");
  -- a nonzero count would mean the rejected request was charged anyway.
  IF COALESCE(v_count, 0) <> 0 THEN
    RAISE EXCEPTION 'SYL-67: rejected-by-global consume incremented the per-user row (count=%)', v_count;
  END IF;

  -- Clients can neither execute the counter function...
  v_blocked := false;
  BEGIN
    SET LOCAL ROLE authenticated;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_a)::text, true);
    PERFORM public.consume_ai_quota(v_a, 'chat', 100, 100000, 1);
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

  -- ...nor the global counter.
  v_blocked := false;
  BEGIN
    SET LOCAL ROLE authenticated;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_a)::text, true);
    PERFORM count(*) FROM public.ai_usage_global;
  EXCEPTION WHEN insufficient_privilege THEN
    v_blocked := true;
  END;
  RESET ROLE;
  IF NOT v_blocked THEN
    RAISE EXCEPTION 'SYL-67: authenticated can SELECT from ai_usage_global';
  END IF;

  RAISE NOTICE 'SYL-29/SYL-67 quota assertions passed.';
END;
$$;

-- ── SYL-31: RLS hardening (WITH CHECK, token ciphertext, chat_courses) ──────
DO $$
DECLARE
  v_a          UUID;
  v_b          UUID;
  v_sem_a      UUID;
  v_sem_b      UUID;
  v_course_a   UUID;
  v_course_b   UUID;
  v_chat_a     UUID;
  v_blocked    BOOLEAN;
  v_missing    TEXT;
  v_rows       INTEGER;
  v_connected  BOOLEAN;
BEGIN
  SELECT id INTO v_a FROM auth.users WHERE email = 'a@test.local';
  SELECT id INTO v_b FROM auth.users WHERE email = 'b@test.local';

  -- Every ownership policy carries an explicit WITH CHECK.
  SELECT string_agg(tablename || '.' || policyname, ', ') INTO v_missing
  FROM pg_policies
  WHERE schemaname = 'public'
    AND policyname IN (
      'Users can CRUD own semesters',
      'Users can CRUD own courses',
      'Users can CRUD own notes',
      'Users can CRUD own chats',
      'Users can CRUD own chat messages',
      'Users can CRUD own chat courses'
    )
    AND with_check IS NULL;
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'SYL-31: ownership policies missing WITH CHECK: %', v_missing;
  END IF;

  -- The canvas token ciphertext is not client-readable...
  v_blocked := false;
  BEGIN
    SET LOCAL ROLE authenticated;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_b)::text, true);
    PERFORM canvas_token_encrypted FROM public.profiles WHERE id = v_b;
  EXCEPTION WHEN insufficient_privilege THEN
    v_blocked := true;
  END;
  RESET ROLE;
  IF NOT v_blocked THEN
    RAISE EXCEPTION 'SYL-31: authenticated can still SELECT canvas_token_encrypted';
  END IF;

  -- ...while ordinary profile columns remain readable...
  BEGIN
    SET LOCAL ROLE authenticated;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_b)::text, true);
    SELECT count(*) INTO v_rows FROM public.profiles WHERE id = v_b;
  END;
  RESET ROLE;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'SYL-31: owner can no longer read their own profile row (regression)';
  END IF;

  -- ...and profiles_safe still answers has_canvas_connected.
  PERFORM public.store_canvas_token(v_b, 'tok_local_syl31', 'https://canvas.mit.edu', 'test_key');
  BEGIN
    SET LOCAL ROLE authenticated;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_b)::text, true);
    SELECT has_canvas_connected INTO v_connected FROM public.profiles_safe;
  END;
  RESET ROLE;
  PERFORM public.delete_canvas_token(v_b);
  IF v_connected IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'SYL-31: profiles_safe.has_canvas_connected broke (got %)', v_connected;
  END IF;

  -- chat_courses: a chat you own may not reference a course you do not own.
  INSERT INTO public.semesters (user_id, name, start_date, end_date)
    VALUES (v_a, 'Verify S31 A', '2026-08-24', '2026-12-18') RETURNING id INTO v_sem_a;
  INSERT INTO public.semesters (user_id, name, start_date, end_date)
    VALUES (v_b, 'Verify S31 B', '2026-08-24', '2026-12-18') RETURNING id INTO v_sem_b;
  INSERT INTO public.courses (user_id, semester_id, name)
    VALUES (v_a, v_sem_a, 'Course A') RETURNING id INTO v_course_a;
  INSERT INTO public.courses (user_id, semester_id, name)
    VALUES (v_b, v_sem_b, 'Course B') RETURNING id INTO v_course_b;
  INSERT INTO public.chats (user_id, semester_id, title)
    VALUES (v_a, v_sem_a, 'Chat A') RETURNING id INTO v_chat_a;

  v_blocked := false;
  BEGIN
    SET LOCAL ROLE authenticated;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_a)::text, true);
    INSERT INTO public.chat_courses (chat_id, course_id) VALUES (v_chat_a, v_course_b);
  EXCEPTION WHEN insufficient_privilege THEN
    v_blocked := true;
  END;
  RESET ROLE;
  IF NOT v_blocked THEN
    RAISE EXCEPTION 'SYL-31: chat_courses INSERT accepted a course the caller does not own';
  END IF;

  BEGIN
    SET LOCAL ROLE authenticated;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_a)::text, true);
    INSERT INTO public.chat_courses (chat_id, course_id) VALUES (v_chat_a, v_course_a);
    GET DIAGNOSTICS v_rows = ROW_COUNT;
  END;
  RESET ROLE;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'SYL-31: owner can no longer link their own course to their chat (regression)';
  END IF;

  RAISE NOTICE 'SYL-31 hardening assertions passed.';
END;
$$;

-- ── SYL-72: BYOK Claude key storage ──────────────────────────────────────
DO $$
DECLARE
  v_b        UUID;
  v_blocked  BOOLEAN;
  v_cols     TEXT[];
  v_missing  TEXT;
  v_encrypted_cols TEXT;
  v_key      TEXT;
  v_last4    TEXT;
  v_ok       BOOLEAN;
  v_tested_at TIMESTAMPTZ;
  v_fn       TEXT;
  v_role     TEXT;
BEGIN
  SELECT id INTO v_b FROM auth.users WHERE email = 'b@test.local';

  -- ── none of the new privileged columns are client-writable ──────────────
  SELECT array_agg(column_name ORDER BY column_name) INTO v_cols
  FROM information_schema.column_privileges
  WHERE table_schema = 'public' AND table_name = 'profiles'
    AND grantee = 'authenticated' AND privilege_type = 'UPDATE';

  FOREACH v_missing IN ARRAY ARRAY[
    'anthropic_key_encrypted', 'anthropic_key_last4', 'anthropic_key_added_at',
    'anthropic_key_last_tested_at', 'anthropic_key_last_test_ok',
    'canvas_token_last_tested_at', 'canvas_token_last_test_ok'
  ] LOOP
    IF v_cols @> ARRAY[v_missing] THEN
      RAISE EXCEPTION 'SYL-72: authenticated still holds UPDATE on %', v_missing;
    END IF;
  END LOOP;

  -- ── the guard trigger rejects a direct write too (defense in depth) ─────
  v_blocked := false;
  BEGIN
    SET LOCAL ROLE authenticated;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_b)::text, true);
    UPDATE public.profiles SET anthropic_key_last4 = '9999' WHERE id = v_b;
  EXCEPTION WHEN OTHERS THEN
    v_blocked := true;
  END;
  RESET ROLE;
  IF NOT v_blocked THEN
    RAISE EXCEPTION 'SYL-72: authenticated was able to write anthropic_key_last4 directly';
  END IF;

  -- ── profiles_safe never exposes ciphertext ───────────────────────────────
  SELECT string_agg(column_name, ', ') INTO v_encrypted_cols
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'profiles_safe'
    AND column_name LIKE '%_encrypted';
  IF v_encrypted_cols IS NOT NULL THEN
    RAISE EXCEPTION 'SYL-72: profiles_safe exposes ciphertext column(s): %', v_encrypted_cols;
  END IF;

  -- ── store/get/delete_anthropic_key round trip, last4 computed server-side ─
  PERFORM public.store_anthropic_key(v_b, 'sk-ant-local-test-1234', 'test_key');
  SELECT public.get_anthropic_key(v_b, 'test_key') INTO v_key;
  IF v_key IS DISTINCT FROM 'sk-ant-local-test-1234' THEN
    RAISE EXCEPTION 'SYL-72: anthropic key round trip returned %, expected sk-ant-local-test-1234', v_key;
  END IF;
  SELECT anthropic_key_last4 FROM public.profiles WHERE id = v_b INTO v_last4;
  IF v_last4 IS DISTINCT FROM '1234' THEN
    RAISE EXCEPTION 'SYL-72: store_anthropic_key computed last4=%, expected 1234', v_last4;
  END IF;

  -- ── record_key_test updates the right pair of columns per provider ───────
  PERFORM public.record_key_test(v_b, 'anthropic', true);
  SELECT anthropic_key_last_test_ok, anthropic_key_last_tested_at
    INTO v_ok, v_tested_at FROM public.profiles WHERE id = v_b;
  IF v_ok IS DISTINCT FROM true OR v_tested_at IS NULL THEN
    RAISE EXCEPTION 'SYL-72: record_key_test(anthropic, true) did not persist';
  END IF;

  PERFORM public.record_key_test(v_b, 'canvas', false);
  SELECT canvas_token_last_test_ok, canvas_token_last_tested_at
    INTO v_ok, v_tested_at FROM public.profiles WHERE id = v_b;
  IF v_ok IS DISTINCT FROM false OR v_tested_at IS NULL THEN
    RAISE EXCEPTION 'SYL-72: record_key_test(canvas, false) did not persist';
  END IF;

  -- ── profiles_safe reflects has_anthropic_key + metadata for the owner ────
  BEGIN
    SET LOCAL ROLE authenticated;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_b)::text, true);
    SELECT has_anthropic_key, anthropic_key_last4 INTO v_ok, v_last4 FROM public.profiles_safe;
  END;
  RESET ROLE;
  IF v_ok IS DISTINCT FROM true OR v_last4 IS DISTINCT FROM '1234' THEN
    RAISE EXCEPTION 'SYL-72: profiles_safe did not reflect the stored anthropic key';
  END IF;

  -- ── delete clears every column ────────────────────────────────────────────
  PERFORM public.delete_anthropic_key(v_b);
  IF (SELECT anthropic_key_encrypted FROM public.profiles WHERE id = v_b) IS NOT NULL
    OR (SELECT anthropic_key_last4 FROM public.profiles WHERE id = v_b) IS NOT NULL
  THEN
    RAISE EXCEPTION 'SYL-72: delete_anthropic_key left data behind';
  END IF;

  -- ── ai_usage_byok: counts, and is not client-readable/executable ─────────
  PERFORM public.record_byok_usage(v_b, 'chat', 1);
  PERFORM public.record_byok_usage(v_b, 'chat', 1);
  IF (
    SELECT count FROM public.ai_usage_byok
    WHERE user_id = v_b AND endpoint = 'chat' AND day = (now() AT TIME ZONE 'utc')::date
  ) <> 2 THEN
    RAISE EXCEPTION 'SYL-72: record_byok_usage did not accumulate';
  END IF;

  v_blocked := false;
  BEGIN
    SET LOCAL ROLE authenticated;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_b)::text, true);
    PERFORM public.record_byok_usage(v_b, 'chat', 1);
  EXCEPTION WHEN insufficient_privilege THEN
    v_blocked := true;
  END;
  RESET ROLE;
  IF NOT v_blocked THEN
    RAISE EXCEPTION 'SYL-72: authenticated can execute record_byok_usage';
  END IF;

  v_blocked := false;
  BEGIN
    SET LOCAL ROLE authenticated;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_b)::text, true);
    PERFORM count(*) FROM public.ai_usage_byok;
  EXCEPTION WHEN insufficient_privilege THEN
    v_blocked := true;
  END;
  RESET ROLE;
  IF NOT v_blocked THEN
    RAISE EXCEPTION 'SYL-72: authenticated can SELECT from ai_usage_byok';
  END IF;

  -- ── the four key RPCs are reachable by service_role only ────────────────
  -- REVOKE ... FROM PUBLIC alone does not do this. Supabase ships ALTER
  -- DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon,
  -- authenticated, service_role, so each new function carries an *explicit*
  -- anon/authenticated EXECUTE grant that revoking the PUBLIC pseudo-role
  -- leaves untouched, and PostgREST then serves it at /rest/v1/rpc/<name>.
  -- All four are SECURITY DEFINER and act on the p_user_id they are handed
  -- rather than auth.uid(), so a client-reachable grant is an IDOR on every
  -- other user's row. 00_bootstrap.sql reproduces those default privileges,
  -- which is what makes this assertion meaningful locally.
  FOREACH v_fn IN ARRAY ARRAY[
    'public.store_anthropic_key(UUID, TEXT, TEXT)',
    'public.get_anthropic_key(UUID, TEXT)',
    'public.delete_anthropic_key(UUID)',
    'public.record_key_test(UUID, TEXT, BOOLEAN)'
  ] LOOP
    FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
      IF has_function_privilege(v_role, v_fn, 'EXECUTE') THEN
        RAISE EXCEPTION 'SYL-72: % can execute %', v_role, v_fn;
      END IF;
    END LOOP;
    IF NOT has_function_privilege('service_role', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'SYL-72: service_role cannot execute % (the edge functions need it)', v_fn;
    END IF;
  END LOOP;

  RAISE NOTICE 'SYL-72 BYOK assertions passed.';
END;
$$;
