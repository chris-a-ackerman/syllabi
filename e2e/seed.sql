-- Deterministic fixture data for the authenticated E2E pass.
-- Applied to an ephemeral local Supabase stack; never run against a real project.
-- Expects :uid1 (admin, onboarded) and :uid2 (fresh, not onboarded).

BEGIN;

UPDATE public.profiles
   SET display_name = 'E2E Test User', is_admin = true,
       onboarding_completed = true, onboarding_completed_at = now()
 WHERE id = :'uid1';

INSERT INTO public.semesters (id, user_id, name, start_date, end_date, is_active) VALUES
  ('11111111-1111-1111-1111-111111111111', :'uid1', 'Fall 2026',   '2026-08-24', '2026-12-18', true),
  ('22222222-2222-2222-2222-222222222222', :'uid1', 'Spring 2026', '2026-01-20', '2026-05-15', false);

INSERT INTO public.courses (id, semester_id, user_id, name, code, professor, color, analysis_status, grading_rules, policies, schedule) VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', :'uid1',
   'Introduction to Algorithms', '6.006', 'Prof. Ada Lovelace', '#6366f1', 'complete',
   '{"components":[{"name":"Problem Sets","weight":0.40,"count":8,"drop_lowest":1},{"name":"Midterm","weight":0.25},{"name":"Final Exam","weight":0.35}],"late_policy":"10% per day, up to 3 days","grading_scale":"A 93+, A- 90-92, B+ 87-89"}',
   '{"attendance":"Lectures are not mandatory but recitations are.","late_work":"10% per day late penalty.","academic_integrity":"Collaboration permitted on psets; solutions written alone.","ai_policy":"LLM use allowed for concepts, not for graded solutions.","other":["Laptops closed during exams."]}',
   '{"meeting_days":["Monday","Wednesday","Friday"],"meeting_times":{"start":"11:00","end":"12:00"},"location":"32-123","instructor":{"name":"Prof. Ada Lovelace","email":"ada@example.edu","office":"32-G904","office_hours":"Thursdays 2-4pm"},"semester_start":"2026-08-24","semester_end":"2026-12-18","total_weeks":15}'),
  ('aaaaaaaa-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', :'uid1',
   'Organic Chemistry I', '5.12', 'Prof. Rosalind Franklin', '#8b5cf6', 'complete',
   '{"components":[{"name":"Quizzes","weight":0.30,"count":5},{"name":"Lab Reports","weight":0.30},{"name":"Final Exam","weight":0.40}]}',
   '{"attendance":"Labs are mandatory."}',
   '{"meeting_days":["Tuesday","Thursday"],"meeting_times":{"start":"09:30","end":"11:00"},"location":"4-270"}');

-- Dated events across two months, plus undated events (date IS NULL with the raw
-- text kept in date_unresolved) which must surface in the "Date TBD" group.
INSERT INTO public.course_events (course_id, user_id, date, date_unresolved, time, title, type, confidence) VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001', :'uid1', '2026-09-11', NULL, '23:59', 'Problem Set 1 due',       'deadline', 'high'),
  ('aaaaaaaa-0000-0000-0000-000000000001', :'uid1', '2026-09-25', NULL, '23:59', 'Problem Set 2 due',       'deadline', 'high'),
  ('aaaaaaaa-0000-0000-0000-000000000001', :'uid1', '2026-10-15', NULL, '19:00', 'Midterm Exam',            'exam',     'high'),
  ('aaaaaaaa-0000-0000-0000-000000000001', :'uid1', NULL, 'TBD - see course website', NULL, 'Guest Lecture Response', 'other', 'low'),
  ('aaaaaaaa-0000-0000-0000-000000000002', :'uid1', '2026-09-03', NULL, '09:30', 'Quiz 1',                  'quiz',     'high'),
  ('aaaaaaaa-0000-0000-0000-000000000002', :'uid1', '2026-09-17', NULL, NULL,    'Lab Report 1 due',        'deadline', 'medium'),
  ('aaaaaaaa-0000-0000-0000-000000000002', :'uid1', '2026-11-26', NULL, NULL,    'No class - Thanksgiving', 'no_class', 'high'),
  ('aaaaaaaa-0000-0000-0000-000000000002', :'uid1', NULL, 'Week of finals',      NULL, 'Final Exam (date TBD)',  'exam', 'low');

INSERT INTO public.course_notes (course_id, user_id, body) VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001', :'uid1', 'Office hours moved to Thursday 2pm the week of the midterm.');

INSERT INTO public.chats (id, user_id, semester_id, title) VALUES
  ('cccccccc-0000-0000-0000-000000000001', :'uid1', '11111111-1111-1111-1111-111111111111', 'When is my midterm?');
INSERT INTO public.chat_courses (chat_id, course_id) VALUES
  ('cccccccc-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001');
INSERT INTO public.chat_messages (chat_id, sequence, role, content, query_type) VALUES
  ('cccccccc-0000-0000-0000-000000000001', 1, 'user',      'When is my midterm?', 'date'),
  ('cccccccc-0000-0000-0000-000000000001', 2, 'assistant', 'Your **6.006 Midterm Exam** is on **October 15, 2026** at 7:00 PM.', 'date');

COMMIT;
