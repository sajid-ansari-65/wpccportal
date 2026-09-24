import { requireEventAdmin } from "@/lib/authz";
import { loadAttendees, loadSessions, resolveCurrentSession } from "@/lib/eventData";
import ExportForm, { type ExportRow } from "./ExportForm";

export default async function ExportPage({
  params,
}: {
  params: Promise<{ org: string; event: string }>;
}) {
  const { org, event } = await params;
  const access = await requireEventAdmin(org, event);

  const sessions = await loadSessions(access.event.id);
  const current = resolveCurrentSession(sessions);
  const attendees = await loadAttendees(access.event.id, current?.id ?? null);

  const rows: ExportRow[] = attendees.map((a) => ({
    present: a.present,
    year: a.year,
    institutionId: a.institutionId,
    institution: a.institution,
  }));

  return (
    <ExportForm action={`/e/${org}/${event}/admin/export/download`} rows={rows} />
  );
}
