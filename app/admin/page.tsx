import { requirePlatformAdmin } from "@/lib/authz";
import { createClient } from "@/lib/supabase/server";
import OrgManager, { type OrgRow } from "./OrgManager";

export default async function PlatformPage() {
  await requirePlatformAdmin();
  const supabase = await createClient();

  // An aggregate-only function, not a table read. The privilege returns
  // numbers about each tenant and never a row belonging to one.
  const { data, error } = await supabase.rpc("platform_org_stats");
  if (error) throw new Error(`Could not load organisations: ${error.message}`);

  const orgs: OrgRow[] = (data ?? []).map(
    (o: {
      org_id: string;
      slug: string;
      name: string;
      events: number;
      attendees: number;
      present: number;
    }) => ({
      id: o.org_id,
      slug: o.slug,
      name: o.name,
      events: Number(o.events),
      attendees: Number(o.attendees),
      present: Number(o.present),
    })
  );

  return <OrgManager orgs={orgs} />;
}
