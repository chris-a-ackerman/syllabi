UPDATE public.app_settings
SET ai_enabled = true,
    updated_at = now()
WHERE id = 'global';