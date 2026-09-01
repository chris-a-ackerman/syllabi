-- SYL-31: RLS hardening roll-up.
--
-- 1) Explicit WITH CHECK on the ownership policies. Not a live vulnerability —
--    a policy with USING and no WITH CHECK applies the USING expression to
--    writes as well — but making the write check explicit means a future
--    loosening of USING (e.g. for sharing/read-only features) can't silently
--    weaken the write side.

ALTER POLICY "Users can CRUD own semesters" ON public.semesters
  WITH CHECK (auth.uid() = user_id);

ALTER POLICY "Users can CRUD own courses" ON public.courses
  WITH CHECK (auth.uid() = user_id);

ALTER POLICY "Users can CRUD own notes" ON public.course_notes
  WITH CHECK (auth.uid() = user_id);

ALTER POLICY "Users can CRUD own chats" ON public.chats
  WITH CHECK (auth.uid() = user_id);

ALTER POLICY "Users can CRUD own chat messages" ON public.chat_messages
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.chats
      WHERE chats.id = chat_messages.chat_id
        AND chats.user_id = auth.uid()
    )
  );

-- 2) chat_courses inserts must reference a course the caller owns, not just a
--    chat they own. Reads were never exposed (they join through courses RLS),
--    but the junction row itself should not be creatable against someone
--    else's course.

ALTER POLICY "Users can CRUD own chat courses" ON public.chat_courses
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.chats
      WHERE chats.id = chat_courses.chat_id
        AND chats.user_id = auth.uid()
    )
    AND EXISTS (
      SELECT 1 FROM public.courses
      WHERE courses.id = chat_courses.course_id
        AND courses.user_id = auth.uid()
    )
  );

-- 3) The Canvas token ciphertext is no longer client-readable. profiles_safe
--    (which exposes has_canvas_connected instead of the bytes) is unaffected:
--    the view runs with its owner's privileges. Same two-layer approach as
--    the SYL-25 UPDATE lockdown: enumerate the readable columns so a future
--    blanket grant can't quietly re-expose the ciphertext.

REVOKE SELECT ON public.profiles FROM anon, authenticated;

GRANT SELECT (
  id,
  display_name,
  phone_number,
  timezone,
  is_admin,
  onboarding_completed,
  onboarding_completed_at,
  created_at,
  updated_at
) ON public.profiles TO authenticated;
