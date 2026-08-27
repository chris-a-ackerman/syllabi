-- Ensure the syllabi bucket exists (no-op if already created via dashboard)
INSERT INTO storage.buckets (id, name, public)
VALUES ('syllabi', 'syllabi', false)
ON CONFLICT (id) DO NOTHING;

-- Drop and recreate all syllabi storage policies to ensure they're present
-- (handles the case where migrations weren't previously pushed to remote)
DROP POLICY IF EXISTS "Users can upload to own folder" ON storage.objects;
DROP POLICY IF EXISTS "Users can read own files" ON storage.objects;
DROP POLICY IF EXISTS "Users can update own files" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete own files" ON storage.objects;

CREATE POLICY "Users can upload to own folder"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'syllabi' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users can read own files"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'syllabi' AND auth.uid()::text = (storage.foldername(name))[1]);

-- Required for upsert (overwriting an existing file)
CREATE POLICY "Users can update own files"
  ON storage.objects FOR UPDATE
  USING (bucket_id = 'syllabi' AND auth.uid()::text = (storage.foldername(name))[1])
  WITH CHECK (bucket_id = 'syllabi' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users can delete own files"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'syllabi' AND auth.uid()::text = (storage.foldername(name))[1]);
