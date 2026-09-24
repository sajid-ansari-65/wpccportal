-- ============================================================================
-- Invite hardening: three holes in accept_invite and the invitations policy.
--
-- 1. Admin → owner. The app refused to let an admin create an owner invite,
--    but the RLS policy did not, so an admin calling the API directly could
--    insert one, accept it themselves, and walk past "only an owner can grant
--    ownership" — accept_invite raises the flag that skips that guard.
--    Closed twice: the policy refuses the insert, and acceptance re-checks
--    that whoever issued an owner invite is still an owner.
--
-- 2. Use-count race. The cap was checked on a plain SELECT and bumped later,
--    so two people accepting a single-use link at once could both get in.
--    The row is now locked for the length of the acceptance.
--
-- 3. Silent demotion. Accepting an admin invite as an existing owner ran
--    `on conflict do update set role = 'admin'` — and if they were the only
--    owner, the organisation was left with none. Accepting an invite now only
--    ever raises a role, never lowers it.
-- ============================================================================

-- Nothing ever filled in created_by, and the owner re-check below depends on
-- it. The default fills it; the policy stops a caller from writing someone
-- else's id there to borrow their ownership.
alter table portal.invitations
  alter column created_by set default auth.uid();

drop policy invitation_write on portal.invitations;

-- Admins still manage invites, but only an owner may mint or edit an owner
-- invite. Split by operation because `for all` applies the insert-time
-- created_by rule to updates too, which would stop an admin revoking an
-- invite someone else created.
create policy invitation_insert on portal.invitations
  for insert to authenticated
  with check (
    app.has_org_role(org_id, array['owner', 'admin'])
    and (role <> 'owner' or app.has_org_role(org_id, array['owner']))
    and created_by = (select auth.uid())
  );

-- An update can neither turn an invite into an owner invite nor touch one,
-- unless the caller is an owner, so created_by cannot be used to launder one.
create policy invitation_update on portal.invitations
  for update to authenticated
  using (
    app.has_org_role(org_id, array['owner', 'admin'])
    and (role <> 'owner' or app.has_org_role(org_id, array['owner']))
  )
  with check (
    app.has_org_role(org_id, array['owner', 'admin'])
    and (role <> 'owner' or app.has_org_role(org_id, array['owner']))
  );

create policy invitation_delete on portal.invitations
  for delete to authenticated
  using (app.has_org_role(org_id, array['owner', 'admin']));

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

  -- FOR UPDATE: a second acceptance of the same token waits here until this
  -- one commits, then sees the new used_count.
  select * into i from portal.invitations where token = p_token for update;
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
  if i.email is not null and lower(i.email) <> lower(coalesce(v_mail, '')) then
    raise exception 'That invite was issued to a different email address.'
      using errcode = '42501';
  end if;

  -- The policy stops new owner invites from non-owners; this also catches one
  -- that predates the policy, or whose issuer has since been demoted.
  if i.role = 'owner' and not exists (
    select 1 from portal.memberships m
     where m.org_id = i.org_id and m.user_id = i.created_by and m.role = 'owner'
  ) then
    raise exception 'That invite is no longer valid. Ask an owner for a new one.'
      using errcode = '42501';
  end if;

  perform set_config('portal.accepting_invite', 'yes', true);

  if i.role = 'volunteer' then
    insert into portal.event_members (event_id, user_id, org_id, role)
    values (i.event_id, v_user, i.org_id, 'volunteer')
    on conflict (event_id, user_id) do nothing;
  else
    -- Only ever upward: admin → owner. An owner opening an admin link stays
    -- an owner.
    insert into portal.memberships (org_id, user_id, role)
    values (i.org_id, v_user, i.role)
    on conflict (org_id, user_id) do update set role = excluded.role
      where portal.memberships.role = 'admin' and excluded.role = 'owner';
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
