import { requireOrgAdmin } from "@/lib/authz";
import { createClient } from "@/lib/supabase/server";
import CollegeManager, { type College } from "./CollegeManager";

type Row = {
  id: string;
  name: string;
  short_name: string | null;
  merged_into: string | null;
};

export default async function CollegesPage({
  params,
}: {
  params: Promise<{ org: string }>;
}) {
  const { org } = await params;
  const access = await requireOrgAdmin(org);
  const supabase = await createClient();

  const [inst, people] = await Promise.all([
    supabase
      .from("institutions")
      .select("id, name, short_name, merged_into")
      .eq("org_id", access.org.id)
      .order("name"),
    // Aggregate, for the same reason as the events page.
    supabase.rpc("org_institution_stats", { p_org: access.org.id }),
  ]);

  if (inst.error) throw new Error(`Could not load colleges: ${inst.error.message}`);
  if (people.error) throw new Error(`Could not count attendees: ${people.error.message}`);

  type Stat = { institution_id: string; attendees: number };
  const counts = new Map(
    ((people.data ?? []) as Stat[]).map((s) => [s.institution_id, Number(s.attendees)])
  );

  const rows = (inst.data ?? []) as Row[];
  const nameById = new Map(rows.map((r) => [r.id, r.short_name ?? r.name]));

  const colleges: College[] = rows.map((r) => ({
    id: r.id,
    name: r.name,
    shortName: r.short_name,
    attendees: counts.get(r.id) ?? 0,
    mergedIntoName: r.merged_into ? (nameById.get(r.merged_into) ?? "another college") : null,
  }));

  return <CollegeManager org={org} colleges={colleges} />;
}
