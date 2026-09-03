-- Branding settings (single row, id = true)
CREATE TABLE public.app_branding (
  id boolean PRIMARY KEY DEFAULT true,
  app_name text NOT NULL DEFAULT 'Solution.AI',
  tagline text,
  logo_url text,
  favicon_url text,
  primary_color text,
  background_color text,
  accent_color text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  CONSTRAINT app_branding_singleton CHECK (id)
);

GRANT SELECT ON public.app_branding TO anon;
GRANT SELECT ON public.app_branding TO authenticated;
GRANT ALL ON public.app_branding TO service_role;
ALTER TABLE public.app_branding ENABLE ROW LEVEL SECURITY;

CREATE POLICY app_branding_read_anon ON public.app_branding FOR SELECT TO anon USING (true);
CREATE POLICY app_branding_read_auth ON public.app_branding FOR SELECT TO authenticated USING (true);

INSERT INTO public.app_branding (id) VALUES (true) ON CONFLICT (id) DO NOTHING;

-- Admin-only writes go through an RPC that verifies the admin role.
CREATE OR REPLACE FUNCTION public.admin_update_branding(
  _app_name text,
  _tagline text,
  _logo_url text,
  _favicon_url text,
  _primary_color text,
  _background_color text,
  _accent_color text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'Forbidden'; END IF;

  UPDATE public.app_branding SET
    app_name = COALESCE(NULLIF(btrim(_app_name), ''), 'Solution.AI'),
    tagline = NULLIF(btrim(COALESCE(_tagline, '')), ''),
    logo_url = NULLIF(btrim(COALESCE(_logo_url, '')), ''),
    favicon_url = NULLIF(btrim(COALESCE(_favicon_url, '')), ''),
    primary_color = NULLIF(btrim(COALESCE(_primary_color, '')), ''),
    background_color = NULLIF(btrim(COALESCE(_background_color, '')), ''),
    accent_color = NULLIF(btrim(COALESCE(_accent_color, '')), ''),
    updated_at = now(),
    updated_by = auth.uid()
  WHERE id;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_update_branding(text, text, text, text, text, text, text) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_update_branding(text, text, text, text, text, text, text) TO authenticated;

-- Admin overview of every assignment across all classes.
CREATE OR REPLACE FUNCTION public.admin_list_assignments()
RETURNS TABLE(
  id uuid,
  title text,
  instructions text,
  due_at timestamptz,
  created_at timestamptz,
  class_id uuid,
  class_name text,
  teacher_name text,
  documents_count bigint,
  students_count bigint,
  done_count bigint,
  in_progress_count bigint
) LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'Forbidden'; END IF;

  RETURN QUERY
  SELECT a.id, a.title, a.instructions, a.due_at, a.created_at,
         c.id, c.name,
         p.display_name,
         (SELECT count(*) FROM public.assignment_documents ad WHERE ad.assignment_id = a.id),
         (SELECT count(*) FROM public.class_members cm WHERE cm.class_id = c.id),
         (SELECT count(*) FROM public.assignment_progress ap WHERE ap.assignment_id = a.id AND ap.status = 'done'),
         (SELECT count(*) FROM public.assignment_progress ap WHERE ap.assignment_id = a.id AND ap.status = 'in_progress')
  FROM public.class_assignments a
  JOIN public.classes c ON c.id = a.class_id
  LEFT JOIN public.profiles p ON p.id = c.teacher_id
  ORDER BY a.created_at DESC;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_list_assignments() FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_list_assignments() TO authenticated;