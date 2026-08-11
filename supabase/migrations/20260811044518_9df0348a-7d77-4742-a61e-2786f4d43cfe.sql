-- 1. Signup no longer trusts the client-supplied role
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.profiles (id, display_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)))
  ON CONFLICT (id) DO NOTHING;

  -- Everyone starts as a student. Teacher/admin is granted by an admin or a valid invite code.
  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'student'::public.app_role)
  ON CONFLICT (user_id, role) DO NOTHING;

  RETURN NEW;
END;
$function$;

-- 2. Audit log for role changes
CREATE TABLE public.role_change_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid NOT NULL,
  target_user_id uuid NOT NULL,
  role public.app_role NOT NULL,
  action text NOT NULL CHECK (action IN ('granted', 'revoked')),
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.role_change_log TO authenticated;
GRANT ALL ON public.role_change_log TO service_role;
ALTER TABLE public.role_change_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY role_change_log_admin_select ON public.role_change_log
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- 3. Teacher invite codes
CREATE TABLE public.teacher_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE DEFAULT upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)),
  created_by uuid NOT NULL,
  max_uses integer NOT NULL DEFAULT 1,
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

-- 4. Admin-only role management
CREATE OR REPLACE FUNCTION public.admin_set_role(_target_user_id uuid, _role public.app_role, _grant boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  IF _role = 'admin' AND _target_user_id = auth.uid() AND NOT _grant THEN
    RAISE EXCEPTION 'You cannot remove your own admin role';
  END IF;

  IF _grant THEN
    INSERT INTO public.user_roles (user_id, role)
    VALUES (_target_user_id, _role)
    ON CONFLICT (user_id, role) DO NOTHING;
  ELSE
    IF _role = 'student' THEN
      RAISE EXCEPTION 'The student role cannot be removed';
    END IF;
    DELETE FROM public.user_roles WHERE user_id = _target_user_id AND role = _role;
  END IF;

  INSERT INTO public.role_change_log (actor_id, target_user_id, role, action)
  VALUES (auth.uid(), _target_user_id, _role, CASE WHEN _grant THEN 'granted' ELSE 'revoked' END);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_set_role(uuid, public.app_role, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_role(uuid, public.app_role, boolean) TO authenticated;

-- 5. Admin user directory
CREATE OR REPLACE FUNCTION public.admin_list_users()
RETURNS TABLE(
  user_id uuid,
  email text,
  display_name text,
  roles text[],
  documents_count bigint,
  questions_count bigint,
  created_at timestamptz,
  last_sign_in_at timestamptz
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  RETURN QUERY
  SELECT u.id,
         u.email::text,
         p.display_name,
         COALESCE((SELECT array_agg(r.role::text ORDER BY r.role::text) FROM public.user_roles r WHERE r.user_id = u.id), ARRAY[]::text[]),
         (SELECT count(*) FROM public.documents d WHERE d.user_id = u.id),
         (SELECT count(*) FROM public.messages m WHERE m.user_id = u.id AND m.role = 'user'),
         u.created_at,
         u.last_sign_in_at
  FROM auth.users u
  LEFT JOIN public.profiles p ON p.id = u.id
  ORDER BY u.created_at DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_list_users() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_users() TO authenticated;

-- 6. Redeem a teacher invite code
CREATE OR REPLACE FUNCTION public.redeem_teacher_invite(_code text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE _invite public.teacher_invites;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not signed in';
  END IF;

  SELECT * INTO _invite FROM public.teacher_invites
  WHERE upper(code) = upper(btrim(_code)) FOR UPDATE;

  IF _invite.id IS NULL THEN
    RAISE EXCEPTION 'That invite code is not valid';
  END IF;
  IF _invite.expires_at IS NOT NULL AND _invite.expires_at < now() THEN
    RAISE EXCEPTION 'That invite code has expired';
  END IF;
  IF _invite.used_count >= _invite.max_uses THEN
    RAISE EXCEPTION 'That invite code has already been used';
  END IF;

  INSERT INTO public.user_roles (user_id, role)
  VALUES (auth.uid(), 'teacher'::public.app_role)
  ON CONFLICT (user_id, role) DO NOTHING;

  UPDATE public.teacher_invites SET used_count = used_count + 1 WHERE id = _invite.id;

  INSERT INTO public.role_change_log (actor_id, target_user_id, role, action)
  VALUES (auth.uid(), auth.uid(), 'teacher', 'granted');

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.redeem_teacher_invite(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.redeem_teacher_invite(text) TO authenticated;

-- 7. Seed the first account as Super Admin
INSERT INTO public.user_roles (user_id, role)
SELECT id, 'admin'::public.app_role FROM auth.users ORDER BY created_at LIMIT 1
ON CONFLICT (user_id, role) DO NOTHING;
