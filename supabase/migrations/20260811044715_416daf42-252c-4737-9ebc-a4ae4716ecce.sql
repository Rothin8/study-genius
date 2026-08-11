CREATE INDEX IF NOT EXISTS document_chunks_fts_idx
  ON public.document_chunks
  USING gin (to_tsvector('english', content));

CREATE OR REPLACE FUNCTION public.hybrid_match_document_chunks(
  query_embedding vector,
  query_text text,
  match_count integer DEFAULT 8,
  filter_document_ids uuid[] DEFAULT NULL::uuid[]
)
RETURNS TABLE(
  id uuid,
  document_id uuid,
  file_name text,
  subject text,
  content text,
  page_number integer,
  chunk_index integer,
  similarity double precision,
  keyword_rank double precision,
  score double precision
)
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
  WITH readable AS (
    SELECT c.id, c.document_id, c.content, c.page_number, c.chunk_index, c.embedding
    FROM public.document_chunks c
    WHERE c.embedding IS NOT NULL
      AND public.can_read_document(c.document_id, auth.uid())
      AND (filter_document_ids IS NULL OR c.document_id = ANY (filter_document_ids))
  ),
  vector_hits AS (
    SELECT r.id,
           1 - (r.embedding::halfvec(3072) <=> query_embedding::halfvec(3072)) AS similarity
    FROM readable r
    ORDER BY r.embedding::halfvec(3072) <=> query_embedding::halfvec(3072)
    LIMIT match_count * 4
  ),
  keyword_hits AS (
    SELECT r.id,
           ts_rank(to_tsvector('english', r.content), websearch_to_tsquery('english', query_text)) AS keyword_rank
    FROM readable r
    WHERE query_text IS NOT NULL
      AND btrim(query_text) <> ''
      AND to_tsvector('english', r.content) @@ websearch_to_tsquery('english', query_text)
    ORDER BY keyword_rank DESC
    LIMIT match_count * 4
  ),
  merged AS (
    SELECT COALESCE(v.id, k.id) AS id,
           COALESCE(v.similarity, 0) AS similarity,
           COALESCE(k.keyword_rank, 0) AS keyword_rank
    FROM vector_hits v
    FULL OUTER JOIN keyword_hits k ON k.id = v.id
  )
  SELECT r.id, r.document_id, d.file_name, d.subject, r.content, r.page_number, r.chunk_index,
         m.similarity,
         m.keyword_rank,
         (m.similarity * 0.75) + (LEAST(m.keyword_rank, 1.0) * 0.25) AS score
  FROM merged m
  JOIN readable r ON r.id = m.id
  JOIN public.documents d ON d.id = r.document_id
  ORDER BY score DESC
  LIMIT match_count;
$$;
