-- Get your test user's ID first from auth.users, then plug it in
-- Easiest to run this in Supabase Studio SQL editor after creating the user

DO $$
DECLARE
  v_user_id UUID;
  v_semester_id UUID;
  v_course_id UUID;
BEGIN
  -- grab the test user
  SELECT id INTO v_user_id FROM auth.users WHERE email = 'test@test.com' LIMIT 1;

  -- create a semester
  INSERT INTO public.semesters (user_id, name, start_date, end_date, is_active)
  VALUES (v_user_id, 'Spring 2026', '2026-01-12', '2026-05-08', true)
  RETURNING id INTO v_semester_id;

  -- create a course
  INSERT INTO public.courses (semester_id, user_id, name, code, professor, color, analysis_status)
  VALUES (v_semester_id, v_user_id, 'Intro to Microeconomics', 'ECON 101', 'Prof. Smith', '#4A90D9', 'complete')
  RETURNING id INTO v_course_id;

  -- seed some events
  INSERT INTO public.course_events (course_id, user_id, date, time, title, type, category, confidence)
  VALUES
    (v_course_id, v_user_id, CURRENT_DATE, '23:59', 'Problem Set 1', 'deadline', 'Problem Sets', 'high'),
    (v_course_id, v_user_id, CURRENT_DATE + 2, '23:59', 'Problem Set 2', 'deadline', 'Problem Sets', 'high'),
    (v_course_id, v_user_id, CURRENT_DATE + 5, '14:00', 'Midterm Exam', 'exam', 'Exams', 'high'),
    (v_course_id, v_user_id, CURRENT_DATE + 7, '23:59', 'Essay Draft', 'deadline', 'Essays', 'medium');

  -- add minimal syllabus_analysis so grading/policy queries work
  UPDATE public.courses SET syllabus_analysis = '{
    "grading_rules": {
      "components": [
        {"name": "Problem Sets", "weight": 30, "count": 10, "drop_lowest": 1, "late_policy": "10% per day"},
        {"name": "Exams", "weight": 50, "count": 2, "drop_lowest": 0, "late_policy": "No late exams"},
        {"name": "Essays", "weight": 20, "count": 3, "drop_lowest": 0, "late_policy": "5% per day"}
      ],
      "grading_scale": "A: 93+, B: 83+, C: 73+"
    },
    "policies": {
      "attendance": {"required": true, "penalty": "Lose 2% per unexcused absence"},
      "late_work": {"accepted": true, "default_penalty": "10% per day", "max_late_days": 3},
      "ai_usage": "AI tools prohibited on exams, allowed on homework with citation"
    },
    "schedule": {
      "meeting_days": ["Monday", "Wednesday", "Friday"],
      "meeting_time": {"start": "10:00", "end": "11:00"},
      "location": "Room 201"
    }
  }'::jsonb
  WHERE id = v_course_id;

END $$;