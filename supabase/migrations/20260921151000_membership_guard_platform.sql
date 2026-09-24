-- ============================================================================
-- Make the membership guard explicit about platform admins.
--
-- Before this, a platform admin creating an organisation for someone else got
-- past the "only an owner may grant ownership" rule by accident: their
-- actor_role is NULL, and `NULL <> 'owner'` is NULL, so the branch never
-- fired. Relying on three-valued logic for a privilege check is the kind of
-- thing that breaks the day someone rewrites the condition to look tidier.
--
-- Creating an organisation for THEMSELVES was blocked outright by the
-- "nobody edits their own membership" rule, which is the common case for a
-- one-person platform.
--
-- So: platform admins are named, and the rules they are exempt from are
-- visible. The rules still bind everyone else, including org owners.
-- ============================================================================

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
  -- The seed and service-role maintenance run without a JWT.
  if actor is null then
    return coalesce(new, old);
  end if;

  -- Bootstrapping an organisation means writing its first owner row, which
  -- every rule below is designed to prevent. Exempt, explicitly, and only for
  -- the handful of people in portal.platform_admins — a table no application
  -- code can write to.
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

  -- coalesce, so a NULL actor_role reads as "not an owner" rather than as
  -- "unknown, therefore allowed".
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
