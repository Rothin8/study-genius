-- ROLES
CREATE TYPE public.app_role AS ENUM ('student', 'teacher', 'admin');

CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  role public.app_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
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

-- default role on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)))
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, CASE WHEN NEW.raw_user_meta_data->>'role' = 'teacher' THEN 'teacher'::public.app_role ELSE 'student'::public.app_role END)
  ON CONFLICT (user_id, role) DO NOTHING;
  RETURN NEW;
END;
$$;

INSERT INTO public.user_roles (user_id, role)
SELECT id, 'student'::public.app_role FROM auth.users
ON CONFLICT (user_id, role) DO NOTHING;

-- CLASSES
CREATE TABLE public.classes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id uuid NOT NULL,
  name text NOT NULL,
  subject text,
  join_code text NOT NULL UNIQUE DEFAULT upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6)),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.classes TO authenticated;
GRANT ALL ON public.classes TO service_role;
ALTER TABLE public.classes ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.class_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id uuid NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
  student_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (class_id, student_id)
);
GRANT SELECT, INSERT, DELETE ON public.class_members TO authenticated;
GRANT ALL ON public.class_members TO service_role;
ALTER TABLE public.class_members ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.class_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id uuid NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
  document_id uuid NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (class_id, document_id)
);
GRANT SELECT, INSERT, DELETE ON public.class_documents TO authenticated;
GRANT ALL ON public.class_documents TO service_role;
ALTER TABLE public.class_documents ENABLE ROW LEVEL SECURITY;

-- helpers (security definer to avoid cross-policy recursion)
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
REVOKE ALL ON FUNCTION public.is_class_member(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_class_teacher(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_read_document(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_class_member(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_class_teacher(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_read_document(uuid, uuid) TO authenticated, service_role;

CREATE POLICY classes_teacher_all ON public.classes FOR ALL TO authenticated
  USING (teacher_id = auth.uid()) WITH CHECK (teacher_id = auth.uid() AND public.has_role(auth.uid(), 'teacher'));
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

-- shared read access to documents + chunks
CREATE POLICY documents_shared_select ON public.documents FOR SELECT TO authenticated
  USING (public.can_read_document(id, auth.uid()));
CREATE POLICY chunks_shared_select ON public.document_chunks FOR SELECT TO authenticated
  USING (public.can_read_document(document_id, auth.uid()));

-- retrieval across own + shared documents
CREATE OR REPLACE FUNCTION public.match_document_chunks(query_embedding vector, match_count integer DEFAULT 8, filter_document_ids uuid[] DEFAULT NULL::uuid[])
RETURNS TABLE(id uuid, document_id uuid, file_name text, subject text, content text, page_number integer, chunk_index integer, similarity double precision)
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

-- teacher visibility of class activity
CREATE OR REPLACE FUNCTION public.class_activity(_class_id uuid)
RETURNS TABLE(student_id uuid, display_name text, documents_count bigint, questions_count bigint, last_active timestamptz)
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
REVOKE ALL ON FUNCTION public.class_activity(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.class_activity(uuid) TO authenticated, service_role;

-- admin platform stats
CREATE OR REPLACE FUNCTION public.platform_stats()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE result jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  SELECT jsonb_build_object(
    'users', (SELECT count(*) FROM public.profiles),
    'teachers', (SELECT count(*) FROM public.user_roles WHERE role = 'teacher'),
    'students', (SELECT count(*) FROM public.user_roles WHERE role = 'student'),
    'documents', (SELECT count(*) FROM public.documents),
    'chunks', (SELECT count(*) FROM public.document_chunks),
    'questions', (SELECT count(*) FROM public.messages WHERE role = 'user'),
    'classes', (SELECT count(*) FROM public.classes),
    'failed_documents', (SELECT count(*) FROM public.documents WHERE status = 'failed'),
    'daily', (
      SELECT coalesce(jsonb_agg(jsonb_build_object('day', day, 'questions', q, 'documents', dc) ORDER BY day), '[]'::jsonb)
      FROM (
        SELECT d::date AS day,
          (SELECT count(*) FROM public.messages m WHERE m.role = 'user' AND m.created_at::date = d::date) AS q,
          (SELECT count(*) FROM public.documents doc WHERE doc.created_at::date = d::date) AS dc
        FROM generate_series(now() - interval '29 days', now(), interval '1 day') AS d
      ) s
    ),
    'top_subjects', (
      SELECT coalesce(jsonb_agg(jsonb_build_object('subject', subject, 'count', c) ORDER BY c DESC), '[]'::jsonb)
      FROM (SELECT coalesce(subject, 'Unspecified') AS subject, count(*) AS c FROM public.documents GROUP BY 1 ORDER BY c DESC LIMIT 8) t
    )
  ) INTO result;
  RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION public.platform_stats() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_stats() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;
CREATE TRIGGER classes_updated_at BEFORE UPDATE ON public.classes
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();