-- "Still usable" is a question about now(), and the database is the only place
-- that knows the answer without the application inventing its own clock. It
-- was also being decided in two places — here and in describe_invite — which
-- is how the two drift apart.
create or replace function portal.org_open_invites(p_org uuid)
returns table (
  id         uuid,
  token      text,
  role       text,
  email      text,
  event_name text,
  expires_at timestamptz,
  max_uses   integer,
  used_count integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select i.id, i.token, i.role, i.email, e.name, i.expires_at, i.max_uses, i.used_count
    from portal.invitations i
    left join portal.events e on e.id = i.event_id
   where i.org_id = p_org
     and app.can_admin_org(p_org)
     and i.revoked_at is null
     and (i.expires_at is null or now() < i.expires_at)
     and i.used_count < i.max_uses
   order by i.created_at desc
$$;

grant execute on function portal.org_open_invites(uuid) to authenticated;
