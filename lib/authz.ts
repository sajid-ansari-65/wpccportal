import { redirect, notFound } from "next/navigation";
import { createClient } from "./supabase/server";

/**
 * The server-side data access layer.
 *
 * Every page and route handler calls one of these as its first line. proxy.ts
 * only refreshes the session and bounces signed-out visitors; it is a
 * convenience, not a security boundary, and it never decides what a given user
 * may see.
 *
 * RLS is the backstop underneath all of this. These functions are the primary
 * mechanism, because an RLS failure is silent — PostgREST returns an empty
 * list for an invisible row rather than an error — and "the dashboard is empty"
 * at 9am with 200 people queueing is not a debuggable symptom.
 */

export type OrgRole = "owner" | "admin";
export type EventRole = OrgRole | "volunteer";

export type SignedInUser = { userId: string; email: string | null };

export async function getUser(): Promise<SignedInUser | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  return { userId: user.id, email: user.email ?? null };
}

/** Signed-in or sent to /login. */
export async function requireUser(nextPath?: string): Promise<SignedInUser> {
  const user = await getUser();
  if (!user) {
    const to = nextPath ? `/login?next=${encodeURIComponent(nextPath)}` : "/login";
    redirect(to);
  }
  return user;
}

/**
 * The platform operator, above any tenant.
 *
 * They can create organisations and see counts. They deliberately have no
 * policy on attendees, attendance or institutions: being able to set a tenant
 * up is not the same as being able to read what is inside it.
 */
export async function isPlatformAdmin(): Promise<boolean> {
  const user = await getUser();
  if (!user) return false;
  const supabase = await createClient();
  const { data } = await supabase
    .from("platform_admins")
    .select("user_id")
    .eq("user_id", user.userId)
    .maybeSingle();
  return !!data;
}

export async function requirePlatformAdmin(): Promise<SignedInUser> {
  const user = await requireUser("/admin");
  if (!(await isPlatformAdmin())) notFound();
  return user;
}

export type OrgAccess = {
  org: { id: string; slug: string; name: string };
  /** "platform" means the operator, who is here to help set the organisation
   *  up and has no membership in it — and no access to its attendees. */
  role: OrgRole | "platform";
};

/**
 * Resolve an organisation for the current user, or stop.
 *
 * Org-level work — adding a college, creating an event — is owner/admin only.
 * A volunteer is scoped to one event and has no business here, and gets a 404
 * rather than a 403 for the same reason as everywhere else: a 403 confirms the
 * organisation exists.
 */
export async function requireOrgAdmin(orgSlug: string): Promise<OrgAccess> {
  const user = await requireUser(`/o/${orgSlug}`);
  const supabase = await createClient();

  const { data: org } = await supabase
    .from("organizations")
    .select("id, slug, name")
    .eq("slug", orgSlug)
    .maybeSingle();
  if (!org) notFound();

  const { data: membership } = await supabase
    .from("memberships")
    .select("role")
    .eq("org_id", org.id)
    .eq("user_id", user.userId)
    .maybeSingle();

  if (membership) {
    return {
      org: { id: org.id, slug: org.slug, name: org.name },
      role: membership.role as OrgRole,
    };
  }

  // No membership, but the platform operator can still do setup work here.
  // Note this does NOT extend to the event screens, which handle attendees.
  if (await isPlatformAdmin()) {
    return { org: { id: org.id, slug: org.slug, name: org.name }, role: "platform" };
  }

  notFound();
}

export type EventAccess = {
  org: { id: string; slug: string; name: string };
  event: {
    id: string;
    slug: string;
    name: string;
    timezone: string;
    settings: Record<string, unknown>;
    archivedAt: string | null;
  };
  role: EventRole;
};

/**
 * Resolve /e/<org>/<event> for the current user, or stop.
 *
 * Anything the caller is not entitled to is a 404, never a 403. A 403 confirms
 * that another tenant's event exists at that slug, which is exactly the thing
 * multi-tenancy is supposed to keep quiet about.
 */
export async function requireEventAccess(
  orgSlug: string,
  eventSlug: string
): Promise<EventAccess> {
  const user = await requireUser(`/e/${orgSlug}/${eventSlug}`);
  const supabase = await createClient();

  const { data: org } = await supabase
    .from("organizations")
    .select("id, slug, name")
    .eq("slug", orgSlug)
    .maybeSingle();
  if (!org) notFound();

  const { data: event } = await supabase
    .from("events")
    .select("id, slug, name, timezone, settings, archived_at")
    .eq("org_id", org.id)
    .eq("slug", eventSlug)
    .maybeSingle();
  if (!event) notFound();

  // Org staff first: an owner or admin reaches every event in their org.
  const { data: membership } = await supabase
    .from("memberships")
    .select("role")
    .eq("org_id", org.id)
    .eq("user_id", user.userId)
    .maybeSingle();

  let role: EventRole | null = (membership?.role as OrgRole | undefined) ?? null;

  // Otherwise a volunteer, who reaches exactly one event — not the org.
  if (!role) {
    const { data: eventMember } = await supabase
      .from("event_members")
      .select("role")
      .eq("event_id", event.id)
      .eq("user_id", user.userId)
      .maybeSingle();
    role = (eventMember?.role as EventRole | undefined) ?? null;
  }

  if (!role) notFound();

  return {
    org: { id: org.id, slug: org.slug, name: org.name },
    event: {
      id: event.id,
      slug: event.slug,
      name: event.name,
      timezone: event.timezone,
      settings: (event.settings ?? {}) as Record<string, unknown>,
      archivedAt: event.archived_at,
    },
    role,
  };
}

/** The admin backend is org staff only. Volunteers get a 404, as above. */
export async function requireEventAdmin(
  orgSlug: string,
  eventSlug: string
): Promise<EventAccess & { role: OrgRole }> {
  const access = await requireEventAccess(orgSlug, eventSlug);
  if (access.role === "volunteer") notFound();
  return access as EventAccess & { role: OrgRole };
}

/** Every event the caller can reach, for the /dashboard picker. */
export async function listMyEvents(): Promise<
  { orgSlug: string; orgName: string; eventSlug: string; eventName: string; role: EventRole }[]
> {
  const user = await getUser();
  if (!user) return [];
  const supabase = await createClient();

  // RLS restricts both of these to the caller; the explicit filters keep the
  // indexes in play and mean a policy bug shows up as a 500, not as silence.
  const [staff, volunteer] = await Promise.all([
    supabase
      .from("memberships")
      .select("role, organizations!inner(slug, name, events(slug, name))")
      .eq("user_id", user.userId),
    supabase
      .from("event_members")
      .select("role, events!inner(slug, name, organizations!inner(slug, name))")
      .eq("user_id", user.userId),
  ]);

  type OrgRow = { slug: string; name: string; events: { slug: string; name: string }[] };
  type EventRow = {
    slug: string;
    name: string;
    organizations: { slug: string; name: string };
  };

  const out: Awaited<ReturnType<typeof listMyEvents>> = [];

  for (const row of staff.data ?? []) {
    const org = row.organizations as unknown as OrgRow;
    for (const ev of org?.events ?? []) {
      out.push({
        orgSlug: org.slug,
        orgName: org.name,
        eventSlug: ev.slug,
        eventName: ev.name,
        role: row.role as OrgRole,
      });
    }
  }

  for (const row of volunteer.data ?? []) {
    const ev = row.events as unknown as EventRow;
    if (!ev) continue;
    out.push({
      orgSlug: ev.organizations.slug,
      orgName: ev.organizations.name,
      eventSlug: ev.slug,
      eventName: ev.name,
      role: "volunteer",
    });
  }

  return out;
}
