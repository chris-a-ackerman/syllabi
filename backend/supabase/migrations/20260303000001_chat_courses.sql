-- Junction table tracking which courses are referenced in a chat session.
-- Allows a chat to be scoped to one or more specific courses within the semester.
CREATE TABLE public.chat_courses (
  chat_id UUID NOT NULL REFERENCES public.chats(id) ON DELETE CASCADE,
  course_id UUID NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
  PRIMARY KEY (chat_id, course_id)
);

CREATE INDEX idx_chat_courses_course ON public.chat_courses(course_id);

ALTER TABLE public.chat_courses ENABLE ROW LEVEL SECURITY;

-- Access is governed by ownership of the parent chat
CREATE POLICY "Users can CRUD own chat courses"
  ON public.chat_courses FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.chats
      WHERE chats.id = chat_courses.chat_id
        AND chats.user_id = auth.uid()
    )
  );
