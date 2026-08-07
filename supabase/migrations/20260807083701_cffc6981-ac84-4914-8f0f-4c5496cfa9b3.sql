CREATE POLICY "documents_storage_own" ON storage.objects FOR ALL TO authenticated
USING (bucket_id = 'documents' AND owner = auth.uid())
WITH CHECK (bucket_id = 'documents' AND owner = auth.uid());