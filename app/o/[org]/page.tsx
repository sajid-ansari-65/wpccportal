import { requireOrgAdmin } from "@/lib/authz";
import { createClient } from "@/lib/supabase/server";
import EventManager, { type EventRow } from "./EventManager";

export default async function OrgEventsPage({
  params,
}: {
  params: Promise<{ org: string }>;
}) {
  const { org } = await params;
  const access = await requireOrgAdmin(org);
  const supabase = await createClient();

  const [events, stats] = await Promise.all([
    supabase
      .from("events")
      .select("id, slug, name, timezone, archived_at")
      .eq("org_id", access.org.id)
      .order("created_at", { ascending: false }),
    // Counts come from an aggregate function, not a table read: the platform
    // operator can see this page but cannot read portal.attendees, so a direct
    // count would confidently render 0 / 0.
    supabase.rpc("org_event_stats", { p_org: access.org.id }),
  ]);

  if (events.error) throw new Error(`Could not load events: ${events.error.message}`);
  if (stats.error) throw new Error(`Could not count attendees: ${stats.error.message}`);

  type Stat = { event_id: string; attendees: number; present: number };
  const byEvent = new Map(
    ((stats.data ?? []) as Stat[]).map((s) => [s.event_id, s])
  );

  const rows: EventRow[] = (events.data ?? []).map((e) => ({
    id: e.id,
    slug: e.slug,
    name: e.name,
    timezone: e.timezone,
    attendees: Number(byEvent.get(e.id)?.attendees ?? 0),
    present: Number(byEvent.get(e.id)?.present ?? 0),
    archived: !!e.archived_at,
  }));

  return (
    <EventManager org={org} events={rows} canOpenEvents={access.role !== "platform"} />
  );
}
