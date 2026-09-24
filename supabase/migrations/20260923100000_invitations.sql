-- ============================================================================
-- Joining an organisation or an event.
--
-- Until now the only way to give anyone access was to write SQL, which makes
-- this a product for one person. Two ways in, because they fail differently:
--
--   Link invite   — anyone holding the link can join with that role. Fast on
--                   event morning, and the link is the credential, so it is
--                   short-lived, use-capped and revocable.
--   Email invite  — the same link, but it only works for one address. A
--                   forwarded link is useless. Slower to set up, so it earns
--                   its keep for admin and owner roles rather than volunteers.
-- ============================================================================

alter table portal.invitations
  add column email text,
  add column accepted_at timestamptz,
  add column label text;

comment on column portal.invitations.email is
  'When set, only this address may accept. Null means anyone with the link.';

create index invitations_org_idx on portal.invitations (org_id);

-- ---------------------------------------------------------------------------
-- The membership guard has to let an invite through.
--
-- Accepting an invite means writing your OWN membership row, which is exactly
-- what "nobody edits their own membership" forbids. Rather than weaken that
-- rule, accept_invite raises a transaction-local flag that only it can set —
-- it is SECURITY DEFINER and validates the token before doing so.
-- ---------------------------------------------------------------------------
create or replace function portal.guard_membership_changes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  actor_role text;
  owners_left integer;
begin
  if actor is null then
    return coalesce(new, old);
  end if;

  -- Set only inside portal.accept_invite, after the token has been checked.
  if coalesce(current_setting('portal.accepting_invite', true), '') = 'yes' then
    return coalesce(new, old);
  end if;

  if app.is_platform_admin() then
    return coalesce(new, old);
  end if;

  select m.role into actor_role
    from portal.memberships m
   where m.org_id = coalesce(new.org_id, old.org_id)
     and m.user_id = actor;

  if coalesce(new.user_id, old.user_id) = actor then
    raise exception 'You cannot change your own membership.'
      using errcode = '42501';
  end if;

  if tg_op in ('INSERT', 'UPDATE') and new.role = 'owner'
     and coalesce(actor_role, '') <> 'owner' then
    raise exception 'Only an owner can grant ownership.'
      using errcode = '42501';
  end if;

  if tg_op in ('UPDATE', 'DELETE') and old.role = 'owner'
     and (tg_op = 'DELETE' or new.role <> 'owner') then
    select count(*) into owners_left
      from portal.memberships m
     where m.org_id = old.org_id and m.role = 'owner' and m.user_id <> old.user_id;
    if owners_left = 0 then
      raise exception 'An organisation must keep at least one owner.'
        using errcode = '23514';
    end if;
  end if;

  return coalesce(new, old);
end;
$$;

-- ---------------------------------------------------------------------------
-- What a link shows before anyone commits to it.
--
-- Callable by anyone signed in, because the token IS the credential. It leaks
-- only what the person needs to decide whether to accept: which organisation,
-- which event, which role.
-- ---------------------------------------------------------------------------
create or replace function portal.describe_invite(p_token text)
returns table (
  org_name    text,
  event_name  text,
  role        text,
  email       text,
  problem     text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    o.name,
    e.name,
    i.role,
    i.email,
    case
      when i.revoked_at is not null                  then 'revoked'
      when i.expires_at is not null
           and now() > i.expires_at                  then 'expired'
      when i.used_count >= i.max_uses                then 'used up'
      when i.email is not null
           and lower(i.email) <> lower(coalesce((select auth.email()), '')) then 'wrong account'
      else null
    end
  from portal.invitations i
  join portal.organizations o on o.id = i.org_id
  left join portal.events e on e.id = i.event_id
  where i.token = p_token
$$;

grant execute on function portal.describe_invite(text) to authenticated;

-- ---------------------------------------------------------------------------
-- Accepting.
-- ---------------------------------------------------------------------------
create or replace function portal.accept_invite(p_token text)
returns table (org_slug text, event_slug text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_mail text := (select auth.email());
  i portal.invitations;
begin
  if v_user is null then
    raise exception 'Sign in first.' using errcode = '42501';
  end if;

  select * into i from portal.invitations where token = p_token;
  if not found then
    raise exception 'That invite link is not valid.' using errcode = 'P0002';
  end if;

  if i.revoked_at is not null then
    raise exception 'That invite has been revoked.' using errcode = '42501';
  end if;
  if i.expires_at is not null and now() > i.expires_at then
    raise exception 'That invite has expired.' using errcode = '42501';
  end if;
  if i.used_count >= i.max_uses then
    raise exception 'That invite has already been used.' using errcode = '42501';
  end if;
  -- An email-bound invite is worthless if forwarded, which is the whole point
  -- of offering it alongside the open link.
  if i.email is not null and lower(i.email) <> lower(coalesce(v_mail, '')) then
    raise exception 'That invite was issued to a different email address.'
      using errcode = '42501';
  end if;

  perform set_config('portal.accepting_invite', 'yes', true);

  if i.role = 'volunteer' then
    insert into portal.event_members (event_id, user_id, org_id, role)
    values (i.event_id, v_user, i.org_id, 'volunteer')
    on conflict (event_id, user_id) do nothing;
  else
    insert into portal.memberships (org_id, user_id, role)
    values (i.org_id, v_user, i.role)
    on conflict (org_id, user_id) do update set role = excluded.role;
  end if;

  update portal.invitations
     set used_count = used_count + 1,
         accepted_at = coalesce(accepted_at, now())
   where id = i.id;

  return query
    select o.slug, e.slug
      from portal.organizations o
      left join portal.events e on e.id = i.event_id
     where o.id = i.org_id;
end;
$$;

grant execute on function portal.accept_invite(text) to authenticated;

-- ---------------------------------------------------------------------------
-- Who is on the team. auth.users is not readable over the API, so the screen
-- would otherwise show a list of UUIDs.
-- ---------------------------------------------------------------------------
create or replace function portal.org_members(p_org uuid)
returns table (
  user_id    uuid,
  email      text,
  role       text,
  event_id   uuid,
  event_name text,
  joined_at  timestamptz,
  is_you     boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select m.user_id, u.email::text, m.role, null::uuid, null::text, m.created_at,
         m.user_id = (select auth.uid())
    from portal.memberships m
    join auth.users u on u.id = m.user_id
   where m.org_id = p_org and app.can_admin_org(p_org)
  union all
  select em.user_id, u.email::text, em.role, em.event_id, e.name, em.created_at,
         em.user_id = (select auth.uid())
    from portal.event_members em
    join auth.users u on u.id = em.user_id
    join portal.events e on e.id = em.event_id
   where em.org_id = p_org and app.can_admin_org(p_org)
$$;

grant execute on function portal.org_members(uuid) to authenticated;
