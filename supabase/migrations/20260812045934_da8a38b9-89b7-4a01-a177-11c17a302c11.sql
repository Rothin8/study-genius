-- ============ PLANS ============
DO $$ BEGIN
  CREATE TYPE public.plan_tier AS ENUM ('free', 'pro');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE public.plan_limits (
  plan public.plan_tier PRIMARY KEY,
  max_documents integer NOT NULL,
  max_pages_per_month integer NOT NULL,
  max_questions_per_month integer NOT NULL
);
GRANT SELECT ON public.plan_limits TO authenticated;
GRANT ALL ON public.plan_limits TO service_role;
ALTER TABLE public.plan_limits ENABLE ROW LEVEL SECURITY;
CREATE POLICY plan_limits_read ON public.plan_limits FOR SELECT TO authenticated USING (true);

INSERT INTO public.plan_limits (plan, max_documents, max_pages_per_month, max_questions_per_month)
VALUES ('free', 20, 300, 60), ('pro', 500, 10000, 3000);

CREATE TABLE public.user_plans (
  user_id uuid PRIMARY KEY,
  plan public.plan_tier NOT NULL DEFAULT 'free',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.user_plans TO authenticated;
GRANT ALL ON public.user_plans TO service_role;
ALTER TABLE public.user_plans ENABLE ROW LEVEL SECURITY;
CREATE POLICY user_plans_own ON public.user_plans FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));
CREATE TRIGGER user_plans_updated_at BEFORE UPDATE ON public.user_plans
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

INSERT INTO public.user_plans (user_id, plan)
SELECT id, 'free' FROM auth.users ON CONFLICT DO NOTHING;

CREATE TABLE public.usage_counters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  period text NOT NULL,
  documents integer NOT NULL DEFAULT 0,
  pages integer NOT NULL DEFAULT 0,
  questions integer NOT NULL DEFAULT 0,
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

-- Creates the plan row on signup alongside the profile/role.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)))
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'student'::public.app_role)
  ON CONFLICT (user_id, role) DO NOTHING;

  INSERT INTO public.user_plans (user_id, plan)
  VALUES (NEW.id, 'free')
  ON CONFLICT (user_id) DO NOTHING;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.my_usage()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _plan public.plan_tier; _limits public.plan_limits; _row public.usage_counters; _docs bigint;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  SELECT COALESCE((SELECT plan FROM public.user_plans WHERE user_id = auth.uid()), 'free') INTO _plan;
  SELECT * INTO _limits FROM public.plan_limits WHERE plan = _plan;
  SELECT * INTO _row FROM public.usage_counters WHERE user_id = auth.uid() AND period = public.current_usage_period();
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

-- Checks the caller's plan allowance and records the usage. Raises when over the limit.
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

CREATE OR REPLACE FUNCTION public.admin_set_plan(_target_user_id uuid, _plan public.plan_tier)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'Forbidden'; END IF;
  INSERT INTO public.user_plans (user_id, plan) VALUES (_target_user_id, _plan)
  ON CONFLICT (user_id) DO UPDATE SET plan = EXCLUDED.plan;
END;
$$;

DROP FUNCTION IF EXISTS public.admin_list_users();
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
         COALESCE((SELECT array_agg(r.role::text ORDER BY r.role::text) FROM public.user_roles r WHERE r.user_id = u.id), ARRAY[]::text[]),
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

REVOKE ALL ON FUNCTION public.consume_usage(text, integer) FROM anon, public;
REVOKE ALL ON FUNCTION public.my_usage() FROM anon, public;
REVOKE ALL ON FUNCTION public.admin_set_plan(uuid, public.plan_tier) FROM anon, public;
REVOKE ALL ON FUNCTION public.admin_list_users() FROM anon, public;
GRANT EXECUTE ON FUNCTION public.consume_usage(text, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.my_usage() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_plan(uuid, public.plan_tier) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_users() TO authenticated;

-- ============ SUBJECTS ============
CREATE TABLE public.subjects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  name text NOT NULL,
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

INSERT INTO public.subjects (user_id, name)
SELECT DISTINCT d.user_id, btrim(d.subject)
FROM public.documents d
WHERE d.subject IS NOT NULL AND btrim(d.subject) <> ''
ON CONFLICT DO NOTHING;

-- ============ CLASS ASSIGNMENTS ============
CREATE TABLE public.class_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id uuid NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
  created_by uuid NOT NULL,
  title text NOT NULL,
  instructions text,
  due_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.class_assignments TO authenticated;
GRANT ALL ON public.class_assignments TO service_role;
ALTER TABLE public.class_assignments ENABLE ROW LEVEL SECURITY;
CREATE POLICY class_assignments_read ON public.class_assignments FOR SELECT TO authenticated
  USING (public.is_class_teacher(class_id, auth.uid()) OR public.is_class_member(class_id, auth.uid()));
CREATE POLICY class_assignments_insert ON public.class_assignments FOR INSERT TO authenticated
  WITH CHECK (public.is_class_teacher(class_id, auth.uid()) AND created_by = auth.uid());
CREATE POLICY class_assignments_update ON public.class_assignments FOR UPDATE TO authenticated
  USING (public.is_class_teacher(class_id, auth.uid())) WITH CHECK (public.is_class_teacher(class_id, auth.uid()));
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

CREATE TABLE public.assignment_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id uuid NOT NULL REFERENCES public.class_assignments(id) ON DELETE CASCADE,
  document_id uuid NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
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
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id uuid NOT NULL REFERENCES public.class_assignments(id) ON DELETE CASCADE,
  student_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'not_started',
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
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

REVOKE ALL ON FUNCTION public.can_read_assignment(uuid, uuid) FROM anon, public;
REVOKE ALL ON FUNCTION public.is_assignment_teacher(uuid, uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.can_read_assignment(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_assignment_teacher(uuid, uuid) TO authenticated;