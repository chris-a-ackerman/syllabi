INSERT INTO storage.buckets (id, name, public)
VALUES ('syllabi', 'syllabi', false);

CREATE POLICY "Users can upload to own folder"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'syllabi' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users can read own files"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'syllabi' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users can delete own files"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'syllabi' AND auth.uid()::text = (storage.foldername(name))[1]);