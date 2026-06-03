-- Reset all user data while keeping the auth user alive.
-- Called from POST /api/account/reset via db.rpc('reset_user_data', { p_user_id: ... })
create or replace function reset_user_data(p_user_id uuid)
returns void
language plpgsql
security definer
as $$
declare
  pid uuid;
  convo_ids uuid[];
  entry_ids uuid[];
begin
  -- For each project the user is a member of
  for pid in
    select project_id from project_members where user_id = p_user_id
  loop
    -- Collect conversation IDs
    select coalesce(array_agg(id), '{}') into convo_ids
    from conversations where project_id = pid and status != 'deleted';

    -- Delete conversation children
    if array_length(convo_ids, 1) > 0 then
      delete from conversation_media where conversation_id = any(convo_ids);
      delete from conversation_messages where conversation_id = any(convo_ids);
      delete from conversation_context where conversation_id = any(convo_ids);
    end if;
    delete from conversations where project_id = pid;

    -- Collect entry IDs and delete history
    select coalesce(array_agg(id), '{}') into entry_ids
    from entries where project_id = pid;

    if array_length(entry_ids, 1) > 0 then
      delete from entry_history where entry_id = any(entry_ids);
    end if;
    delete from entries where project_id = pid;

    -- Delete other project data
    delete from insights where project_id = pid;
    delete from activity_log where project_id = pid;
    delete from share_links where project_id = pid;
    delete from project_members where project_id = pid;
    delete from user_preferences where project_id = pid;
  end loop;

  -- Delete owned projects and API keys (keep subscriptions and user row)
  delete from projects where owner_id = p_user_id;
  delete from api_keys where user_id = p_user_id;
end;
$$;
