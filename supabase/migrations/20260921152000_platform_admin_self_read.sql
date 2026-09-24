-- portal.platform_admins was locked down with RLS on and no policies, so that
-- nothing in the application could grant the privilege. That also meant nobody
-- could READ it — including a platform admin checking whether they are one, so
-- the page 404'd for exactly the person it was built for.
--
-- Read your own row only. You can learn that you are an admin; you cannot
-- enumerate who else is. There is still no write policy, which was the point.
create policy platform_admin_self_read on portal.platform_admins
  for select to authenticated
  using (user_id = (select auth.uid()));
