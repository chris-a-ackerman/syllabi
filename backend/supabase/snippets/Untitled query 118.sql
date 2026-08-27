CREATE TABLE public.app_settings (
  id TEXT PRIMARY KEY DEFAULT 'global',
  ai_enabled BOOLEAN NOT NULL DEFAULT true,
  updated_at TIMESTAMPTZ DEFAULT now(),
  updated_by UUID REFERENCES public.profiles(id)
);

-- Seed the row
INSERT INTO public.app_settings (id, ai_enabled)
VALUES ('global', true);

-- RLS: anyone can read, only admins can write
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read app settings"
  ON public.app_settings FOR SELECT
  USING (true);

CREATE POLICY "Only admins can update app settings"
  ON public.app_settings FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND is_admin = true
    )
  );