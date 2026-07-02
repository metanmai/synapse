-- DELETE A USER: Replace the email below with the user's email
-- All related data is cleaned up automatically via CASCADE

DO $$
DECLARE
  target_email text := 'REPLACE_WITH_EMAIL';
  target_user_id uuid;
  target_auth_id uuid;
BEGIN
  -- Find the user
  SELECT id, supabase_auth_id INTO target_user_id, target_auth_id
  FROM public.users WHERE email = target_email;

  IF target_user_id IS NULL THEN
    RAISE NOTICE 'User not found: %', target_email;
    RETURN;
  END IF;

  -- Delete from public.users (CASCADE handles api_keys, project_members, etc.)
  DELETE FROM public.users WHERE id = target_user_id;

  -- Delete from Supabase Auth
  IF target_auth_id IS NOT NULL THEN
    DELETE FROM auth.users WHERE id = target_auth_id;
  END IF;

  RAISE NOTICE 'Deleted user: % (id: %)', target_email, target_user_id;
END $$;
