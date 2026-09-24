-- ============================================================================
-- checkin_by_token — the public, anonymous self check-in path.
--
-- The plan had this route holding the service-role key in v1, confined to one
-- module, with the RPC as a later improvement. Doing it as an RPC now is less
-- code, not more: the public route never touches a key that bypasses RLS, and
-- the narrow return type makes over-fetching impossible rather than merely
-- discouraged. The legacy route returned `select("*")` — phone, email and
-- every attributes key — to anyone holding a token.
--
-- The token IS the credential: 96 bits of randomness, printed on a card. That
-- is the same trust model the printed QR codes already rely on. It still wants
-- a rate limit at the edge, because this is the one route that cannot be
-- scoped to a tenant.
-- ============================================================================

create or replace function portal.checkin_by_token(
  p_token       text,
  p_wp_username text default null
)
returns table (
  attendee_name    text,
  event_name       text,
  session_name     text,
  collect_username boolean,
  already_present  boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attendee  portal.attendees;
  v_event     portal.events;
  v_session   portal.sessions;
  v_count     integer;
  v_existing  portal.attendance_records;
begin
  select * into v_attendee from portal.attendees a where a.qr_token = p_token;
  if not found then
    raise exception 'Unknown code.' using errcode = 'P0002';
  end if;

  select * into v_event from portal.events e where e.id = v_attendee.event_id;

  -- Session resolution, matching lib/eventData.ts. Unlike the volunteer path
  -- there is no organiser override here: a student cannot decide that check-in
  -- is open.
  select count(*) into v_count from portal.sessions s where s.event_id = v_event.id;

  if v_count = 1 then
    select * into v_session from portal.sessions s where s.event_id = v_event.id;
  else
    select * into v_session
      from portal.sessions s
     where s.event_id = v_event.id
       and (s.checkin_opens_at is null or now() >= s.checkin_opens_at)
       and (s.checkin_closes_at is null or now() <= s.checkin_closes_at)
     order by s.checkin_closes_at nulls last
     limit 1;
  end if;

  if v_session.id is null then
    -- This is what closes the old gap where a student could open their QR link
    -- from home the night before and be marked present. It falls out of the
    -- session model rather than needing a special case.
    raise exception 'Check-in is not open right now.' using errcode = '42501';
  end if;

  select * into v_existing
    from portal.attendance_records r
   where r.attendee_id = v_attendee.id
     and r.session_id = v_session.id
     and r.revoked_at is null;

  if not found then
    insert into portal.attendance_records (
      attendee_id, session_id, event_id, org_id, marked_via
    ) values (
      v_attendee.id, v_session.id, v_event.id, v_event.org_id, 'qr'
    )
    on conflict do nothing;
  end if;

  -- Only ever set a handle, never clear one.
  if p_wp_username is not null and length(trim(p_wp_username)) > 0 then
    update portal.attendees a
       set wp_username = lower(trim(p_wp_username))
     where a.id = v_attendee.id;
  end if;

  -- Deliberately narrow: a name to confirm the right person, and nothing else.
  return query select
    v_attendee.name,
    v_event.name,
    v_session.name,
    coalesce((v_event.settings ->> 'collect_wp_username')::boolean, false),
    (v_existing.id is not null);
end;
$$;

revoke all on function portal.checkin_by_token(text, text) from public;
grant execute on function portal.checkin_by_token(text, text) to anon, authenticated;
