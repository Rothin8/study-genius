-- =============================================================================
-- Solution.AI — consolidated database schema
-- Target: PostgreSQL 15+ with the Supabase auth schema (auth.users, auth.uid()).
-- Runnable top-to-bottom on a fresh database. Order: extensions, enums, tables,
-- grants, RLS, functions, triggers, indexes, seed data.
--
-- Porting notes for a non-Supabase backend:
--   * auth.uid() = the current authenticated user's UUID. Replace with your
--     session accessor, or enforce the same rules in application code.
--   * RLS policies below ARE the authorization model. If you drop RLS you must
--     re-implement every USING/WITH CHECK clause in your API layer.
--   * `vector(3072)` requires pgvector >= 0.7 (halfvec support) for the HNSW
--     index. Embeddings are 3072-dim (Gemini embedding).
-- =============================================================================

-- ----------------------------------------------------------------- extensions
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- gen_random_uuid()

-- ---------------------------------------------------------------------- enums
CREATE TYPE public.app_role  AS ENUM ('student', 'teacher', 'admin');
CREATE TYPE public.plan_tier AS ENUM ('free', 'pro');

-- ------------------------------------------------------------ shared trigger
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

-- =============================================================================
-- IDENTITY
-- =============================================================================

CREATE TABLE public.profiles (
  id           uuid PRIMARY KEY,              -- = auth.users.id
  display_name text,
  created_at   timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
-- Any signed-in user may read display names (needed for class rosters).
CREATE POLICY profiles_select      ON public.profiles FOR SELECT TO authenticated USING (true);
CREATE POLICY profiles_insert_own  ON public.profiles FOR INSERT TO authenticated WITH CHECK (id = auth.uid());
CREATE POLICY profiles_update_own  ON public.profiles FOR UPDATE TO authenticated USING (id = auth.uid()) WITH CHECK (id = auth.uid());

CREATE TABLE public.user_roles (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL,
  role       public.app_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
-- Read-only to clients. Writes go exclusively through admin_set_role /
-- redeem_teacher_invite so a user can never grant themselves a role.
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY user_roles_select_own ON public.user_roles FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role);
$$;
REVOKE ALL ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated, service_role;

CREATE TABLE public.role_change_log (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id       uuid NOT NULL,
  target_user_id uuid NOT NULL,
  role           public.app_role NOT NULL,
  action         text NOT NULL CHECK (action IN ('granted', 'revoked')),
  created_at     timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.role_change_log TO authenticated;
GRANT ALL ON public.role_change_log TO service_role;
ALTER TABLE public.role_change_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY role_change_log_admin_select ON public.role_change_log
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

CREATE TABLE public.teacher_invites (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code       text NOT NULL UNIQUE DEFAULT upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)),
  created_by uuid NOT NULL,
  max_uses   integer NOT NULL DEFAULT 1,
  used_count integer NOT NULL DEFAULT 0,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.teacher_invites TO authenticated;
GRANT ALL ON public.teacher_invites TO service_role;
ALTER TABLE public.teacher_invites ENABLE ROW LEVEL SECURITY;
CREATE POLICY teacher_invites_admin_all ON public.teacher_invites
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin') AND created_by = auth.uid());

-- Signup hook: create the profile and force the 'student' role.
-- The client-supplied role in user metadata is deliberately ignored.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name',
                           NEW.raw_user_meta_data->>'name',
                           split_part(NEW.email, '@', 1)))
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'student'::public.app_role)
  ON CONFLICT (user_id, role) DO NOTHING;

  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- =============================================================================
-- KNOWLEDGE BASE (documents + vector index)
-- =============================================================================

CREATE TABLE public.documents (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL,                       -- owner
  file_name     text NOT NULL,
  file_type     text NOT NULL DEFAULT 'text/plain',
  file_size     integer NOT NULL DEFAULT 0,          -- bytes
  storage_path  text,                                -- object key in the 'documents' bucket
  subject       text,
  status        text NOT NULL DEFAULT 'processing',  -- processing | ready | failed
  error_message text,
  page_count    integer NOT NULL DEFAULT 0,
  chunk_count   integer NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.documents TO authenticated;
GRANT ALL ON public.documents TO service_role;
ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;
CREATE INDEX documents_user_idx ON public.documents (user_id, created_at DESC);

CREATE TABLE public.document_chunks (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL,
  content     text NOT NULL,
  page_number integer,
  chunk_index integer NOT NULL DEFAULT 0,
  embedding   vector(3072),
  created_at  timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.document_chunks TO authenticated;
GRANT ALL ON public.document_chunks TO service_role;
ALTER TABLE public.document_chunks ENABLE ROW LEVEL SECURITY;
CREATE INDEX document_chunks_doc_idx ON public.document_chunks (document_id);
CREATE INDEX document_chunks_embedding_idx ON public.document_chunks
  USING hnsw ((embedding::halfvec(3072)) halfvec_cosine_ops);
CREATE INDEX document_chunks_fts_idx ON public.document_chunks
  USING gin (to_tsvector('english', content));

CREATE TABLE public.subjects (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL,
  name       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX subjects_user_name_key ON public.subjects (user_id, lower(name));
GRANT SELECT, INSERT, UPDATE, DELETE ON public.subjects TO authenticated;
GRANT ALL ON public.subjects TO service_role;
ALTER TABLE public.subjects ENABLE ROW LEVEL SECURITY;
CREATE POLICY subjects_own ON public.subjects FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE TRIGGER subjects_updated_at BEFORE UPDATE ON public.subjects
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =============================================================================
-- CHAT
-- =============================================================================

CREATE TABLE public.conversations (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL,
  title      text NOT NULL DEFAULT 'New chat',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.conversations TO authenticated;
GRANT ALL ON public.conversations TO service_role;
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
CREATE POLICY conversations_own ON public.conversations FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE TABLE public.messages (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL,
  role            text NOT NULL,                 -- 'user' | 'assistant'
  content         text NOT NULL DEFAULT '',
  citations       jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now()
);
-- citations shape:
-- [{ documentId, fileName, page, snippet, score }]
GRANT SELECT, INSERT, UPDATE, DELETE ON public.messages TO authenticated;
GRANT ALL ON public.messages TO service_role;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY messages_own ON public.messages FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE INDEX messages_conversation_idx ON public.messages (conversation_id, created_at);

-- =============================================================================
-- CLASSES
-- =============================================================================

CREATE TABLE public.classes (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id uuid NOT NULL,
  name       text NOT NULL,
  subject    text,
  join_code  text NOT NULL UNIQUE DEFAULT upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6)),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.classes TO authenticated;
GRANT ALL ON public.classes TO service_role;
ALTER TABLE public.classes ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER classes_updated_at BEFORE UPDATE ON public.classes
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.class_members (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id   uuid NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
  student_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (class_id, student_id)
);
GRANT SELECT, INSERT, DELETE ON public.class_members TO authenticated;
GRANT ALL ON public.class_members TO service_role;
ALTER TABLE public.class_members ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.class_documents (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id    uuid NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
  document_id uuid NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (class_id, document_id)
);
GRANT SELECT, INSERT, DELETE ON public.class_documents TO authenticated;
GRANT ALL ON public.class_documents TO service_role;
ALTER TABLE public.class_documents ENABLE ROW LEVEL SECURITY;

-- Access helpers. SECURITY DEFINER on purpose: they are called from RLS
-- policies on the very tables they read, which would otherwise recurse.
CREATE OR REPLACE FUNCTION public.is_class_member(_class_id uuid, _user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.class_members WHERE class_id = _class_id AND student_id = _user_id);
$$;

CREATE OR REPLACE FUNCTION public.is_class_teacher(_class_id uuid, _user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.classes WHERE id = _class_id AND teacher_id = _user_id);
$$;

CREATE OR REPLACE FUNCTION public.can_read_document(_document_id uuid, _user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.documents d WHERE d.id = _document_id AND d.user_id = _user_id)
      OR EXISTS (
        SELECT 1 FROM public.class_documents cd
        JOIN public.class_members cm ON cm.class_id = cd.class_id
        WHERE cd.document_id = _document_id AND cm.student_id = _user_id
      );
$$;

REVOKE ALL ON FUNCTION public.is_class_member(uuid, uuid)   FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_class_teacher(uuid, uuid)  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_read_document(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_class_member(uuid, uuid)   TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_class_teacher(uuid, uuid)  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_read_document(uuid, uuid) TO authenticated, service_role;

-- Class policies
CREATE POLICY classes_teacher_all ON public.classes FOR ALL TO authenticated
  USING (teacher_id = auth.uid())
  WITH CHECK (teacher_id = auth.uid() AND public.has_role(auth.uid(), 'teacher'));
CREATE POLICY classes_member_select ON public.classes FOR SELECT TO authenticated
  USING (public.is_class_member(id, auth.uid()));

CREATE POLICY class_members_student ON public.class_members FOR SELECT TO authenticated
  USING (student_id = auth.uid() OR public.is_class_teacher(class_id, auth.uid()));
CREATE POLICY class_members_join ON public.class_members FOR INSERT TO authenticated
  WITH CHECK (student_id = auth.uid());
CREATE POLICY class_members_leave ON public.class_members FOR DELETE TO authenticated
  USING (student_id = auth.uid() OR public.is_class_teacher(class_id, auth.uid()));

CREATE POLICY class_documents_read ON public.class_documents FOR SELECT TO authenticated
  USING (public.is_class_teacher(class_id, auth.uid()) OR public.is_class_member(class_id, auth.uid()));
CREATE POLICY class_documents_write ON public.class_documents FOR INSERT TO authenticated
  WITH CHECK (public.is_class_teacher(class_id, auth.uid())
    AND EXISTS (SELECT 1 FROM public.documents d WHERE d.id = document_id AND d.user_id = auth.uid()));
CREATE POLICY class_documents_delete ON public.class_documents FOR DELETE TO authenticated
  USING (public.is_class_teacher(class_id, auth.uid()));

-- Document policies (declared here because they depend on can_read_document)
CREATE POLICY documents_own ON public.documents FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY documents_shared_select ON public.documents FOR SELECT TO authenticated
  USING (public.can_read_document(id, auth.uid()));

CREATE POLICY chunks_own ON public.document_chunks FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY chunks_shared_select ON public.document_chunks FOR SELECT TO authenticated
  USING (public.can_read_document(document_id, auth.uid()));

-- Students join a class by code without being able to read the classes table.
CREATE OR REPLACE FUNCTION public.join_class_by_code(_code text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _class_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;

  SELECT id INTO _class_id FROM public.classes
  WHERE upper(join_code) = upper(btrim(_code));

  IF _class_id IS NULL THEN RAISE EXCEPTION 'No class found with that code'; END IF;

  INSERT INTO public.class_members (class_id, student_id)
  VALUES (_class_id, auth.uid())
  ON CONFLICT DO NOTHING;

  RETURN _class_id;
END;
$$;
REVOKE ALL ON FUNCTION public.join_class_by_code(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.join_class_by_code(text) TO authenticated;

-- =============================================================================
-- ASSIGNMENTS
-- =============================================================================

CREATE TABLE public.class_assignments (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id     uuid NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
  created_by   uuid NOT NULL,
  title        text NOT NULL,
  instructions text,
  due_at       timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.class_assignments TO authenticated;
GRANT ALL ON public.class_assignments TO service_role;
ALTER TABLE public.class_assignments ENABLE ROW LEVEL SECURITY;
CREATE POLICY class_assignments_read ON public.class_assignments FOR SELECT TO authenticated
  USING (public.is_class_teacher(class_id, auth.uid()) OR public.is_class_member(class_id, auth.uid()));
CREATE POLICY class_assignments_insert ON public.class_assignments FOR INSERT TO authenticated
  WITH CHECK (public.is_class_teacher(class_id, auth.uid()) AND created_by = auth.uid());
CREATE POLICY class_assignments_update ON public.class_assignments FOR UPDATE TO authenticated
  USING (public.is_class_teacher(class_id, auth.uid()))
  WITH CHECK (public.is_class_teacher(class_id, auth.uid()));
CREATE POLICY class_assignments_delete ON public.class_assignments FOR DELETE TO authenticated
  USING (public.is_class_teacher(class_id, auth.uid()));
CREATE TRIGGER class_assignments_updated_at BEFORE UPDATE ON public.class_assignments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.can_read_assignment(_assignment_id uuid, _user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.class_assignments a
    WHERE a.id = _assignment_id
      AND (public.is_class_teacher(a.class_id, _user_id) OR public.is_class_member(a.class_id, _user_id))
  );
$$;

CREATE OR REPLACE FUNCTION public.is_assignment_teacher(_assignment_id uuid, _user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.class_assignments a
    WHERE a.id = _assignment_id AND public.is_class_teacher(a.class_id, _user_id)
  );
$$;
REVOKE ALL ON FUNCTION public.can_read_assignment(uuid, uuid)    FROM anon, PUBLIC;
REVOKE ALL ON FUNCTION public.is_assignment_teacher(uuid, uuid)  FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_read_assignment(uuid, uuid)   TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_assignment_teacher(uuid, uuid) TO authenticated;

CREATE TABLE public.assignment_documents (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id uuid NOT NULL REFERENCES public.class_assignments(id) ON DELETE CASCADE,
  document_id   uuid NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (assignment_id, document_id)
);
GRANT SELECT, INSERT, DELETE ON public.assignment_documents TO authenticated;
GRANT ALL ON public.assignment_documents TO service_role;
ALTER TABLE public.assignment_documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY assignment_documents_read ON public.assignment_documents FOR SELECT TO authenticated
  USING (public.can_read_assignment(assignment_id, auth.uid()));
CREATE POLICY assignment_documents_insert ON public.assignment_documents FOR INSERT TO authenticated
  WITH CHECK (public.is_assignment_teacher(assignment_id, auth.uid()));
CREATE POLICY assignment_documents_delete ON public.assignment_documents FOR DELETE TO authenticated
  USING (public.is_assignment_teacher(assignment_id, auth.uid()));

CREATE TABLE public.assignment_progress (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id uuid NOT NULL REFERENCES public.class_assignments(id) ON DELETE CASCADE,
  student_id    uuid NOT NULL,
  status        text NOT NULL DEFAULT 'not_started',
  completed_at  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (assignment_id, student_id),
  CONSTRAINT assignment_progress_status_check CHECK (status IN ('not_started', 'in_progress', 'done'))
);
GRANT SELECT, INSERT, UPDATE ON public.assignment_progress TO authenticated;
GRANT ALL ON public.assignment_progress TO service_role;
ALTER TABLE public.assignment_progress ENABLE ROW LEVEL SECURITY;
CREATE POLICY assignment_progress_read ON public.assignment_progress FOR SELECT TO authenticated
  USING (student_id = auth.uid() OR public.is_assignment_teacher(assignment_id, auth.uid()));
CREATE POLICY assignment_progress_insert ON public.assignment_progress FOR INSERT TO authenticated
  WITH CHECK (student_id = auth.uid() AND public.can_read_assignment(assignment_id, auth.uid()));
CREATE POLICY assignment_progress_update ON public.assignment_progress FOR UPDATE TO authenticated
  USING (student_id = auth.uid()) WITH CHECK (student_id = auth.uid());
CREATE TRIGGER assignment_progress_updated_at BEFORE UPDATE ON public.assignment_progress
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =============================================================================
-- PLANS AND USAGE
-- =============================================================================

CREATE TABLE public.plan_limits (
  plan                    public.plan_tier PRIMARY KEY,
  max_documents           integer NOT NULL,
  max_pages_per_month     integer NOT NULL,
  max_questions_per_month integer NOT NULL
);
GRANT SELECT ON public.plan_limits TO authenticated;
GRANT ALL ON public.plan_limits TO service_role;
ALTER TABLE public.plan_limits ENABLE ROW LEVEL SECURITY;
CREATE POLICY plan_limits_read ON public.plan_limits FOR SELECT TO authenticated USING (true);

INSERT INTO public.plan_limits (plan, max_documents, max_pages_per_month, max_questions_per_month)
VALUES ('free', 20, 300, 60),
       ('pro', 500, 10000, 3000);

CREATE TABLE public.user_plans (
  user_id    uuid PRIMARY KEY,
  plan       public.plan_tier NOT NULL DEFAULT 'free',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- Read-only to clients; only admin_set_plan writes.
GRANT SELECT ON public.user_plans TO authenticated;
GRANT ALL ON public.user_plans TO service_role;
ALTER TABLE public.user_plans ENABLE ROW LEVEL SECURITY;
CREATE POLICY user_plans_own ON public.user_plans FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));
CREATE TRIGGER user_plans_updated_at BEFORE UPDATE ON public.user_plans
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.usage_counters (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL,
  period     text NOT NULL,              -- 'YYYY-MM'
  documents  integer NOT NULL DEFAULT 0,
  pages      integer NOT NULL DEFAULT 0,
  questions  integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, period)
);
GRANT SELECT ON public.usage_counters TO authenticated;
GRANT ALL ON public.usage_counters TO service_role;
ALTER TABLE public.usage_counters ENABLE ROW LEVEL SECURITY;
CREATE POLICY usage_counters_own ON public.usage_counters FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));
CREATE TRIGGER usage_counters_updated_at BEFORE UPDATE ON public.usage_counters
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.current_usage_period()
RETURNS text LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT to_char(now(), 'YYYY-MM');
$$;

-- Atomic quota check + increment. Raises on breach; callers surface the message.
CREATE OR REPLACE FUNCTION public.consume_usage(_kind text, _amount integer DEFAULT 1)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _plan public.plan_tier; _limits public.plan_limits; _period text; _used integer; _docs bigint;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  IF _kind NOT IN ('document', 'pages', 'question') THEN RAISE EXCEPTION 'Unknown usage kind'; END IF;
  IF _amount < 0 THEN RAISE EXCEPTION 'Invalid amount'; END IF;

  _period := public.current_usage_period();
  SELECT COALESCE((SELECT plan FROM public.user_plans WHERE user_id = auth.uid()), 'free') INTO _plan;
  SELECT * INTO _limits FROM public.plan_limits WHERE plan = _plan;

  INSERT INTO public.usage_counters (user_id, period) VALUES (auth.uid(), _period)
  ON CONFLICT (user_id, period) DO NOTHING;

  IF _kind = 'document' THEN
    SELECT count(*) INTO _docs FROM public.documents WHERE user_id = auth.uid();
    IF _docs + _amount > _limits.max_documents THEN
      RAISE EXCEPTION 'Document limit reached for the % plan (% documents). Delete a document or upgrade.', _plan, _limits.max_documents;
    END IF;
    UPDATE public.usage_counters SET documents = documents + _amount
    WHERE user_id = auth.uid() AND period = _period;

  ELSIF _kind = 'pages' THEN
    SELECT pages INTO _used FROM public.usage_counters WHERE user_id = auth.uid() AND period = _period;
    IF _used + _amount > _limits.max_pages_per_month THEN
      RAISE EXCEPTION 'Monthly page limit reached for the % plan (% pages). Try again next month or upgrade.', _plan, _limits.max_pages_per_month;
    END IF;
    UPDATE public.usage_counters SET pages = pages + _amount
    WHERE user_id = auth.uid() AND period = _period;

  ELSE
    SELECT questions INTO _used FROM public.usage_counters WHERE user_id = auth.uid() AND period = _period;
    IF _used + _amount > _limits.max_questions_per_month THEN
      RAISE EXCEPTION 'Monthly question limit reached for the % plan (% questions). Try again next month or upgrade.', _plan, _limits.max_questions_per_month;
    END IF;
    UPDATE public.usage_counters SET questions = questions + _amount
    WHERE user_id = auth.uid() AND period = _period;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.my_usage()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _plan public.plan_tier; _limits public.plan_limits; _row public.usage_counters; _docs bigint;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  SELECT COALESCE((SELECT plan FROM public.user_plans WHERE user_id = auth.uid()), 'free') INTO _plan;
  SELECT * INTO _limits FROM public.plan_limits WHERE plan = _plan;
  SELECT * INTO _row FROM public.usage_counters
    WHERE user_id = auth.uid() AND period = public.current_usage_period();
  SELECT count(*) INTO _docs FROM public.documents WHERE user_id = auth.uid();

  RETURN jsonb_build_object(
    'plan', _plan,
    'period', public.current_usage_period(),
    'documents', _docs,
    'pages', COALESCE(_row.pages, 0),
    'questions', COALESCE(_row.questions, 0),
    'limits', jsonb_build_object(
      'documents', _limits.max_documents,
      'pages', _limits.max_pages_per_month,
      'questions', _limits.max_questions_per_month
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.consume_usage(text, integer) FROM anon, PUBLIC;
REVOKE ALL ON FUNCTION public.my_usage() FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.consume_usage(text, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.my_usage() TO authenticated;

-- =============================================================================
-- RETRIEVAL
-- =============================================================================

-- Pure vector search across documents the caller may read (own + class-shared).
CREATE OR REPLACE FUNCTION public.match_document_chunks(
  query_embedding vector,
  match_count integer DEFAULT 8,
  filter_document_ids uuid[] DEFAULT NULL::uuid[]
)
RETURNS TABLE(id uuid, document_id uuid, file_name text, subject text, content text,
              page_number integer, chunk_index integer, similarity double precision)
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT c.id, c.document_id, d.file_name, d.subject, c.content, c.page_number, c.chunk_index,
         1 - (c.embedding::halfvec(3072) <=> query_embedding::halfvec(3072)) AS similarity
  FROM public.document_chunks c
  JOIN public.documents d ON d.id = c.document_id
  WHERE c.embedding IS NOT NULL
    AND public.can_read_document(c.document_id, auth.uid())
    AND (filter_document_ids IS NULL OR c.document_id = ANY (filter_document_ids))
  ORDER BY c.embedding::halfvec(3072) <=> query_embedding::halfvec(3072)
  LIMIT match_count;
$$;
GRANT EXECUTE ON FUNCTION public.match_document_chunks(vector, integer, uuid[]) TO authenticated;

-- Hybrid search: cosine similarity (0.75) blended with English FTS rank (0.25).
CREATE OR REPLACE FUNCTION public.hybrid_match_document_chunks(
  query_embedding vector,
  query_text text,
  match_count integer DEFAULT 8,
  filter_document_ids uuid[] DEFAULT NULL::uuid[]
)
RETURNS TABLE(id uuid, document_id uuid, file_name text, subject text, content text,
              page_number integer, chunk_index integer,
              similarity double precision, keyword_rank double precision, score double precision)
LANGUAGE sql STABLE SET search_path = public AS $$
  WITH readable AS (
    SELECT c.id, c.document_id, c.content, c.page_number, c.chunk_index, c.embedding
    FROM public.document_chunks c
    WHERE c.embedding IS NOT NULL
      AND public.can_read_document(c.document_id, auth.uid())
      AND (filter_document_ids IS NULL OR c.document_id = ANY (filter_document_ids))
  ),
  vector_hits AS (
    SELECT r.id, 1 - (r.embedding::halfvec(3072) <=> query_embedding::halfvec(3072)) AS similarity
    FROM readable r
    ORDER BY r.embedding::halfvec(3072) <=> query_embedding::halfvec(3072)
    LIMIT match_count * 4
  ),
  keyword_hits AS (
    SELECT r.id, ts_rank(to_tsvector('english', r.content), websearch_to_tsquery('english', query_text)) AS keyword_rank
    FROM readable r
    WHERE query_text IS NOT NULL AND btrim(query_text) <> ''
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
         m.similarity, m.keyword_rank,
         (m.similarity * 0.75) + (LEAST(m.keyword_rank, 1.0) * 0.25) AS score
  FROM merged m
  JOIN readable r ON r.id = m.id
  JOIN public.documents d ON d.id = r.document_id
  ORDER BY score DESC
  LIMIT match_count;
$$;
GRANT EXECUTE ON FUNCTION public.hybrid_match_document_chunks(vector, text, integer, uuid[]) TO authenticated;

-- =============================================================================
-- ADMIN AND ANALYTICS
-- =============================================================================

CREATE OR REPLACE FUNCTION public.admin_set_role(_target_user_id uuid, _role public.app_role, _grant boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'Forbidden'; END IF;

  IF _role = 'admin' AND _target_user_id = auth.uid() AND NOT _grant THEN
    RAISE EXCEPTION 'You cannot remove your own admin role';
  END IF;

  IF _grant THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (_target_user_id, _role)
    ON CONFLICT (user_id, role) DO NOTHING;
  ELSE
    IF _role = 'student' THEN RAISE EXCEPTION 'The student role cannot be removed'; END IF;
    DELETE FROM public.user_roles WHERE user_id = _target_user_id AND role = _role;
  END IF;

  INSERT INTO public.role_change_log (actor_id, target_user_id, role, action)
  VALUES (auth.uid(), _target_user_id, _role, CASE WHEN _grant THEN 'granted' ELSE 'revoked' END);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_set_plan(_target_user_id uuid, _plan public.plan_tier)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'Forbidden'; END IF;
  INSERT INTO public.user_plans (user_id, plan) VALUES (_target_user_id, _plan)
  ON CONFLICT (user_id) DO UPDATE SET plan = EXCLUDED.plan;
END;
$$;

CREATE OR REPLACE FUNCTION public.redeem_teacher_invite(_code text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _invite public.teacher_invites;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;

  SELECT * INTO _invite FROM public.teacher_invites
  WHERE upper(code) = upper(btrim(_code)) FOR UPDATE;

  IF _invite.id IS NULL THEN RAISE EXCEPTION 'That invite code is not valid'; END IF;
  IF _invite.expires_at IS NOT NULL AND _invite.expires_at < now() THEN
    RAISE EXCEPTION 'That invite code has expired';
  END IF;
  IF _invite.used_count >= _invite.max_uses THEN
    RAISE EXCEPTION 'That invite code has already been used';
  END IF;

  INSERT INTO public.user_roles (user_id, role) VALUES (auth.uid(), 'teacher'::public.app_role)
  ON CONFLICT (user_id, role) DO NOTHING;

  UPDATE public.teacher_invites SET used_count = used_count + 1 WHERE id = _invite.id;

  INSERT INTO public.role_change_log (actor_id, target_user_id, role, action)
  VALUES (auth.uid(), auth.uid(), 'teacher', 'granted');

  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_list_users()
RETURNS TABLE(user_id uuid, email text, display_name text, roles text[], plan text,
              documents_count bigint, questions_count bigint,
              created_at timestamptz, last_sign_in_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'Forbidden'; END IF;

  RETURN QUERY
  SELECT u.id,
         u.email::text,
         p.display_name,
         COALESCE((SELECT array_agg(r.role::text ORDER BY r.role::text)
                   FROM public.user_roles r WHERE r.user_id = u.id), ARRAY[]::text[]),
         COALESCE((SELECT up.plan::text FROM public.user_plans up WHERE up.user_id = u.id), 'free'),
         (SELECT count(*) FROM public.documents d WHERE d.user_id = u.id),
         (SELECT count(*) FROM public.messages m WHERE m.user_id = u.id AND m.role = 'user'),
         u.created_at,
         u.last_sign_in_at
  FROM auth.users u
  LEFT JOIN public.profiles p ON p.id = u.id
  ORDER BY u.created_at DESC;
END;
$$;

CREATE OR REPLACE FUNCTION public.class_activity(_class_id uuid)
RETURNS TABLE(student_id uuid, display_name text, documents_count bigint,
              questions_count bigint, last_active timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p.id, p.display_name,
    (SELECT count(*) FROM public.documents d WHERE d.user_id = p.id),
    (SELECT count(*) FROM public.messages m WHERE m.user_id = p.id AND m.role = 'user'),
    GREATEST(
      (SELECT max(created_at) FROM public.documents d WHERE d.user_id = p.id),
      (SELECT max(created_at) FROM public.messages m WHERE m.user_id = p.id)
    )
  FROM public.class_members cm
  JOIN public.profiles p ON p.id = cm.student_id
  WHERE cm.class_id = _class_id AND public.is_class_teacher(_class_id, auth.uid())
  ORDER BY p.display_name;
$$;

CREATE OR REPLACE FUNCTION public.platform_stats()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE result jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'Forbidden'; END IF;
  SELECT jsonb_build_object(
    'users',    (SELECT count(*) FROM public.profiles),
    'teachers', (SELECT count(*) FROM public.user_roles WHERE role = 'teacher'),
    'students', (SELECT count(*) FROM public.user_roles WHERE role = 'student'),
    'documents',(SELECT count(*) FROM public.documents),
    'chunks',   (SELECT count(*) FROM public.document_chunks),
    'questions',(SELECT count(*) FROM public.messages WHERE role = 'user'),
    'classes',  (SELECT count(*) FROM public.classes),
    'failed_documents', (SELECT count(*) FROM public.documents WHERE status = 'failed'),
    'daily', (
      SELECT coalesce(jsonb_agg(jsonb_build_object('day', day, 'questions', q, 'documents', dc) ORDER BY day), '[]'::jsonb)
      FROM (
        SELECT d::date AS day,
          (SELECT count(*) FROM public.messages m  WHERE m.role = 'user' AND m.created_at::date = d::date) AS q,
          (SELECT count(*) FROM public.documents doc WHERE doc.created_at::date = d::date) AS dc
        FROM generate_series(now() - interval '29 days', now(), interval '1 day') AS d
      ) s
    ),
    'top_subjects', (
      SELECT coalesce(jsonb_agg(jsonb_build_object('subject', subject, 'count', c) ORDER BY c DESC), '[]'::jsonb)
      FROM (SELECT coalesce(subject, 'Unspecified') AS subject, count(*) AS c
            FROM public.documents GROUP BY 1 ORDER BY c DESC LIMIT 8) t
    )
  ) INTO result;
  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_set_role(uuid, public.app_role, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_set_plan(uuid, public.plan_tier)          FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_list_users()                              FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.redeem_teacher_invite(text)                     FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.class_activity(uuid)                            FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.platform_stats()                                FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_role(uuid, public.app_role, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_plan(uuid, public.plan_tier)         TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_users()                             TO authenticated;
GRANT EXECUTE ON FUNCTION public.redeem_teacher_invite(text)                    TO authenticated;
GRANT EXECUTE ON FUNCTION public.class_activity(uuid)                           TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.platform_stats()                               TO authenticated, service_role;

-- =============================================================================
-- OBJECT STORAGE (Supabase Storage). Bucket 'documents', private.
-- On another stack: one private bucket, key prefixed by user id, signed URLs
-- only, and the equivalent owner-only read/write rule.
-- =============================================================================
CREATE POLICY documents_storage_own ON storage.objects FOR ALL TO authenticated
  USING (bucket_id = 'documents' AND owner = auth.uid())
  WITH CHECK (bucket_id = 'documents' AND owner = auth.uid());

-- =============================================================================
-- BOOTSTRAP
-- Promote the first registered account to Super Admin. Run after the first
-- signup, or replace with an explicit user id.
-- =============================================================================
INSERT INTO public.user_roles (user_id, role)
SELECT id, 'admin'::public.app_role FROM auth.users ORDER BY created_at LIMIT 1
ON CONFLICT (user_id, role) DO NOTHING;
