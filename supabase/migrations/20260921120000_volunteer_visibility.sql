-- ============================================================================
-- Volunteers could not see their own event.
--
-- The SELECT policies on organizations and institutions were scoped to
-- app.user_org_ids(), which reads `memberships` — and a volunteer has no
-- membership row, because they are scoped to one event through event_members.
-- So the org lookup in requireEventAccess returned nothing and the page 404'd
-- before it ever got as far as checking event membership.
--
-- A volunteer legitimately needs both: the organisation's name to show in the
-- header, and the institutions to label attendees with. They still must not
-- see any OTHER event in that organisation, which the events policy already
-- enforces through app.user_event_ids().
-- ============================================================================

create or replace function app.user_visible_org_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.org_id from portal.memberships m where m.user_id = (select auth.uid())
  union
  select em.org_id from portal.event_members em where em.user_id = (select auth.uid())
$$;

grant execute on function app.user_visible_org_ids() to authenticated;

-- Read widens; writing stays staff-only via app.has_org_role(), untouched.
drop policy org_select on portal.organizations;
create policy org_select on portal.organizations
  for select to authenticated
  using (id in (select app.user_visible_org_ids()));

drop policy institution_select on portal.institutions;
create policy institution_select on portal.institutions
  for select to authenticated
  using (org_id in (select app.user_visible_org_ids()));
