-- ============================================================================
-- Renaming and removing an organisation.
--
-- Two gaps this closes:
--   - org_update was scoped to org staff, so the platform operator who created
--     an organisation could not fix a typo in its name.
--   - There was no delete policy at all, so a mistyped organisation was
--     permanent.
--
-- Deleting an organisation cascades to attendees, attendance_records, events,
-- sessions, institutions, memberships, invitations and stations — everything.
-- The application only ever offers it for an empty one, and this policy keeps
-- it to the platform operator, who is the only one who can create them.
-- ============================================================================

drop policy org_update on portal.organizations;
create policy org_update on portal.organizations
  for update to authenticated
  using (app.can_admin_org(id))
  with check (app.can_admin_org(id));

create policy org_delete on portal.organizations
  for delete to authenticated
  using (app.is_platform_admin());

-- Whether an organisation is safe to remove, answered where the counting
-- happens rather than in three round trips from the application.
create or replace function portal.org_is_empty(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.is_platform_admin()
     and not exists (select 1 from portal.events e where e.org_id = p_org)
     and not exists (select 1 from portal.attendees a where a.org_id = p_org)
$$;

grant execute on function portal.org_is_empty(uuid) to authenticated;
