CREATE TABLE public.chat_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  chat_id UUID REFERENCES public.chats(id) ON DELETE SET NULL,
  semester_id UUID REFERENCES public.semesters(id) ON DELETE SET NULL,
  course_ids UUID[] NOT NULL DEFAULT '{}',
  reported_at_sequence INTEGER,           -- sequence of last visible message when submitted
  description TEXT NOT NULL,
  conversation_snapshot JSONB NOT NULL DEFAULT '[]', -- [{role, content, sequence}]
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_chat_feedback_user ON public.chat_feedback(user_id);
CREATE INDEX idx_chat_feedback_chat ON public.chat_feedback(chat_id);

ALTER TABLE public.chat_feedback ENABLE ROW LEVEL SECURITY;

-- Users can insert their own feedback
CREATE POLICY "Users can insert own feedback"
  ON public.chat_feedback FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Users can read their own feedback
CREATE POLICY "Users can read own feedback"
  ON public.chat_feedback FOR SELECT
  USING (auth.uid() = user_id);

-- Admins can read all feedback (via service role in Edge Functions or admin panel)
