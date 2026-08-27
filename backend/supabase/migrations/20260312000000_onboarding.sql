ALTER TABLE public.profiles
  ADD COLUMN onboarding_completed BOOLEAN DEFAULT false,
  ADD COLUMN onboarding_completed_at TIMESTAMPTZ;
