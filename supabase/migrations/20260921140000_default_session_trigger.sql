-- ============================================================================
-- Every event gets exactly one session, always.
--
-- The whole session model rests on this: resolveCurrentSession() treats a lone
-- session as always current, which is what keeps a plain single-day event
-- behaving as though sessions did not exist. An event created without one
-- would show "check-in isn't open" and nobody would be able to mark anyone.
--
-- That makes it an invariant, not a step in a procedure — so it lives here
-- rather than in whichever code path happens to create an event.
-- ============================================================================

create or replace function portal.create_default_session()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into portal.sessions (event_id, org_id, name, is_default, position)
  values (new.id, new.org_id, 'Main', true, 0);
  return new;
end;
$$;

create trigger create_default_session
  after insert on portal.events
  for each row execute function portal.create_default_session();
