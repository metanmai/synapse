-- Keep project ownership and membership creation in one database transaction.
--
-- The application historically inserted `projects` first and
-- `project_members` second. A failure between those statements left a project
-- with an owner_id but no owner membership, making it invisible to normal
-- membership-scoped reads. The trigger makes the invariant atomic; the
-- application retains an idempotent upsert for compatibility during rolling
-- deploys and with databases that have not received this migration yet.

CREATE OR REPLACE FUNCTION public.ensure_project_owner_membership()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
BEGIN
  INSERT INTO public.project_members (project_id, user_id, role)
  VALUES (NEW.id, NEW.owner_id, 'owner')
  ON CONFLICT (project_id, user_id)
  DO UPDATE SET role = EXCLUDED.role;

  RETURN NEW;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.ensure_project_owner_membership()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS projects_ensure_owner_membership ON public.projects;
CREATE TRIGGER projects_ensure_owner_membership
  AFTER INSERT ON public.projects
  FOR EACH ROW
  EXECUTE FUNCTION public.ensure_project_owner_membership();

-- Repair any pre-existing drift in environments other than production. The
-- production E2E artifacts found during this repair were deleted separately.
INSERT INTO public.project_members (project_id, user_id, role)
SELECT p.id, p.owner_id, 'owner'
FROM public.projects p
ON CONFLICT (project_id, user_id)
DO UPDATE SET role = EXCLUDED.role;
