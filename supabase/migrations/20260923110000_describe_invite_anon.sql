-- Someone opening an invite link is usually signed out. Showing them what they
-- are about to join BEFORE asking them to sign in is the difference between
-- "join WPCC Surat as a volunteer" and an unexplained login wall.
--
-- Safe to expose: the token is the credential, and this returns only the
-- organisation, the event and the role — the three things needed to decide.
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
      -- Only a mismatch once somebody is actually signed in. Reporting "wrong
      -- account" to a signed-out visitor would be nonsense.
      when i.email is not null
           and (select auth.uid()) is not null
           and lower(i.email) <> lower(coalesce((select auth.email()), '')) then 'wrong account'
      else null
    end
  from portal.invitations i
  join portal.organizations o on o.id = i.org_id
  left join portal.events e on e.id = i.event_id
  where i.token = p_token
$$;

grant execute on function portal.describe_invite(text) to anon, authenticated;
