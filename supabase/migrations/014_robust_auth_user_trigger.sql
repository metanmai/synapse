-- Make the handle_new_auth_user trigger robust against:
--   1. Email conflicts (e.g. OAuth sign-in over existing email/password account)
--   2. supabase_auth_id conflicts (e.g. retry after partial failure)
--   3. Any unexpected error (trigger must NEVER block auth.users insert)
--
-- Before: a silent INSERT failure left an orphan in auth.users with no public.users row.
-- After: ON CONFLICT relinks instead of failing, and any other error is logged and swallowed.

create or replace function handle_new_auth_user()
returns trigger as $$
begin
  insert into public.users (email, supabase_auth_id)
  values (new.email, new.id)
  on conflict (email) do update
    set supabase_auth_id = excluded.supabase_auth_id
    where public.users.supabase_auth_id is distinct from excluded.supabase_auth_id;
  return new;
exception
  when others then
    raise warning '[handle_new_auth_user] failed for %: %', new.email, sqlerrm;
    return new;
end;
$$ language plpgsql security definer;
