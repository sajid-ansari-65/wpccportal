-- ============================================================================
-- mark_attendance — the only way attendance is ever written.
--
-- A SECURITY DEFINER function bypasses RLS entirely, so the role check inside
-- it is the ONLY protection. Keep this surface tiny and review changes to it
-- the way you would review crypto.
--
-- It exists because a volunteer needs to mark attendance without being able to
-- edit attendees, and Postgres expresses column-level permission as
-- `GRANT UPDATE (col)` — which is per database role, while every signed-in
-- user shares the role `authenticated`. A policy cannot say "this person may
-- write attendance but not names".
-- ============================================================================

create or replace function portal.mark_attendance(
  p_attendee    uuid,
  p_session     uuid,
  p_present     boolean,
  p_marked_via  text default 'manual',
  p_wp_username text default null,
  p_station     uuid default null,
  p_client_id   uuid default null
)
returns portal.attendance_records
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor        uuid := (select auth.uid());
  v_event      uuid;
  v_org        uuid;
  v_is_staff   boolean := false;
  v_is_member  boolean := false;
  v_opens      timestamptz;
  v_closes     timestamptz;
  v_record     portal.attendance_records;
begin
  if p_marked_via not in ('manual', 'qr', 'station', 'import') then
    raise exception 'Unknown marked_via: %', p_marked_via using errcode = '22023';
  end if;

  select a.event_id, a.org_id into v_event, v_org
    from portal.attendees a where a.id = p_attendee;
  if v_event is null then
    raise exception 'No such attendee.' using errcode = 'P0002';
  end if;

  -- The session must belong to the attendee's event. Without this check a
  -- caller could mark someone into another tenant's session, which the FKs
  -- alone would happily allow.
  select s.checkin_opens_at, s.checkin_closes_at into v_opens, v_closes
    from portal.sessions s
   where s.id = p_session and s.event_id = v_event;
  if not found then
    raise exception 'Session does not belong to this attendee''s event.'
      using errcode = '42501';
  end if;

  v_is_staff := app.has_org_role(v_org, array['owner', 'admin']);
  v_is_member := exists (
    select 1 from portal.event_members em
     where em.event_id = v_event and em.user_id = actor
  );

  if not (v_is_staff or v_is_member) then
    raise exception 'You do not have access to this event.' using errcode = '42501';
  end if;

  -- Check-in windows bind volunteers, not org staff. A closed window is the
  -- normal state at 6pm, and an admin recording a late entry is a legitimate
  -- act; a volunteer marking people hours after the gate closed is not.
  -- A session with no window set is always open, which is what makes the
  -- simple single-session event behave exactly as it always has.
  if not v_is_staff then
    if v_opens is not null and now() < v_opens then
      raise exception 'Check-in has not opened for this session yet.'
        using errcode = '42501';
    end if;
    if v_closes is not null and now() > v_closes then
      raise exception 'Check-in has closed for this session.'
        using errcode = '42501';
    end if;
  end if;

  if p_present then
    -- Idempotent twice over: on the client's own id, so a replayed offline
    -- queue entry is a no-op; and on (attendee, session), so two volunteers
    -- marking the same person at a busy gate is a success, not an error.
    if p_client_id is not null then
      select * into v_record from portal.attendance_records r
       where r.client_id = p_client_id;
      if found then
        return v_record;
      end if;
    end if;

    insert into portal.attendance_records (
      attendee_id, session_id, event_id, org_id, marked_via, marked_by, station_id, client_id
    )
    values (p_attendee, p_session, v_event, v_org, p_marked_via, actor, p_station, p_client_id)
    on conflict do nothing
    returning * into v_record;

    if v_record.id is null then
      select * into v_record from portal.attendance_records r
       where r.attendee_id = p_attendee and r.session_id = p_session
         and r.revoked_at is null;
    end if;
  else
    update portal.attendance_records r
       set revoked_at = now(), revoked_by = actor
     where r.attendee_id = p_attendee
       and r.session_id = p_session
       and r.revoked_at is null
    returning * into v_record;
  end if;

  -- Only ever set a handle, never clear one. Un-marking someone must not
  -- destroy the WordPress.org username they typed in at check-in.
  if p_wp_username is not null and length(trim(p_wp_username)) > 0 then
    update portal.attendees a
       set wp_username = lower(trim(p_wp_username))
     where a.id = p_attendee;
  end if;

  return v_record;
end;
$$;

revoke all on function portal.mark_attendance(uuid, uuid, boolean, text, text, uuid, uuid) from public, anon;
grant execute on function portal.mark_attendance(uuid, uuid, boolean, text, text, uuid, uuid) to authenticated;
