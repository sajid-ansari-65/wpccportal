-- ============================================================================
-- RLS helper functions.
--
-- These live in `app`, which is deliberately NOT added to the Data API's
-- exposed schemas: they are called from inside policies, never over the wire.
-- `portal` holds the tables and the API-callable RPCs; `app` holds only this.
--
-- They exist to break policy recursion. A policy on `organizations` that
-- checks `memberships` would trigger the policy on `memberships`, which checks
-- `organizations`, and so on. A SECURITY DEFINER function runs as its owner,
-- who bypasses RLS, so the inner read is not itself policed.
--
-- Corollary that must never be undone: DO NOT enable `force row level
-- security` on portal.memberships. Forcing RLS on the owner is exactly what
-- would reintroduce the recursion these functions exist to prevent.
-- ============================================================================

create schema if not exists app;

-- Callable from policies, invisible to the API.
grant usage on schema app to authenticated;
revoke all on schema app from anon;

-- `search_path = ''` plus fully qualified names: a SECURITY DEFINER function
-- that resolves names through a caller-controlled search_path is a privilege
-- escalation waiting to happen.

-- Set-returning, so the planner hoists it and runs it once per statement
-- rather than once per row. Use this form in SELECT policies.
create or replace function app.user_org_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.org_id from portal.memberships m where m.user_id = (select auth.uid())
$$;

-- Org staff reach every event in their org; a volunteer reaches exactly one.
create or replace function app.user_event_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select e.id
    from portal.events e
   where e.org_id in (
     select m.org_id from portal.memberships m where m.user_id = (select auth.uid())
   )
  union
  select em.event_id
    from portal.event_members em
   where em.user_id = (select auth.uid())
$$;

-- Boolean, evaluated per row. Fine for write policies, which touch few rows.
create or replace function app.has_org_role(p_org uuid, p_roles text[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from portal.memberships m
     where m.org_id = p_org
       and m.user_id = (select auth.uid())
       and m.role = any(p_roles)
  )
$$;

grant execute on function app.user_org_ids()          to authenticated;
grant execute on function app.user_event_ids()        to authenticated;
grant execute on function app.has_org_role(uuid, text[]) to authenticated;
