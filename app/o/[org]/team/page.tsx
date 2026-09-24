import { headers } from "next/headers";
import { requireOrgAdmin } from "@/lib/authz";
import { createClient } from "@/lib/supabase/server";
import TeamManager, { type EventOption, type Invite, type Member } from "./TeamManager";

export default async function TeamPage({
  params,
}: {
  params: Promise<{ org: string }>;
}) {
  const { org } = await params;
  const access = await requireOrgAdmin(org);
  const supabase = await createClient();

  const [people, invites, events] = await Promise.all([
    // auth.users is not readable over the API, so without this the screen
    // would be a list of UUIDs.
    supabase.rpc("org_members", { p_org: access.org.id }),
    // "Still usable" depends on now(), which the database knows and the
    // application would have to guess at.
    supabase.rpc("org_open_invites", { p_org: access.org.id }),
    supabase
      .from("events")
      .select("id, name")
      .eq("org_id", access.org.id)
      .is("archived_at", null)
      .order("created_at", { ascending: false }),
  ]);

  if (people.error) throw new Error(`Could not load the team: ${people.error.message}`);
  if (invites.error) throw new Error(`Could not load invites: ${invites.error.message}`);

  type MemberRow = {
    user_id: string;
    email: string;
    role: string;
    event_id: string | null;
    event_name: string | null;
    is_you: boolean;
  };

  const members: Member[] = ((people.data ?? []) as MemberRow[]).map((m) => ({
    userId: m.user_id,
    email: m.email,
    role: m.role,
    eventId: m.event_id,
    eventName: m.event_name,
    isYou: m.is_you,
  }));

  type InviteRow = {
    id: string;
    token: string;
    role: string;
    email: string | null;
    event_name: string | null;
    expires_at: string | null;
    max_uses: number;
    used_count: number;
  };

  const open: Invite[] = ((invites.data ?? []) as InviteRow[]).map((i) => ({
    id: i.id,
    token: i.token,
    role: i.role,
    email: i.email,
    eventName: i.event_name,
    expiresAt: i.expires_at,
    maxUses: i.max_uses,
    usedCount: i.used_count,
  }));

  const eventOptions: EventOption[] = (events.data ?? []).map((e) => ({
    id: e.id,
    name: e.name,
  }));

  // The invite link has to be absolute — it is pasted into WhatsApp, not
  // followed from this page.
  const h = await headers();
  const origin = `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host")}`;

  return (
    <TeamManager
      org={org}
      origin={origin}
      isOwner={access.role === "owner"}
      members={members}
      invites={open}
      events={eventOptions}
    />
  );
}
