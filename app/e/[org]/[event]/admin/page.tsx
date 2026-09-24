import { requireEventAdmin } from "@/lib/authz";
import { loadAttendees, loadSessions, resolveCurrentSession } from "@/lib/eventData";

export default async function AdminOverview({
  params,
}: {
  params: Promise<{ org: string; event: string }>;
}) {
  const { org, event } = await params;
  const access = await requireEventAdmin(org, event);

  const sessions = await loadSessions(access.event.id);
  const current = resolveCurrentSession(sessions);
  const attendees = await loadAttendees(access.event.id, current?.id ?? null);

  const present = attendees.filter((a) => a.present).length;
  const institutions = new Set(attendees.map((a) => a.institution).filter(Boolean));
  const withHandle = attendees.filter((a) => a.year !== undefined).length;

  const stats = [
    { label: "Registered", value: attendees.length },
    { label: "Present", value: present },
    { label: "Colleges", value: institutions.size },
    { label: "Sessions", value: sessions.length },
  ];

  return (
    <div>
      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label} className="bg-surface px-4 py-3.5">
            <dt className="text-[13px] text-ink-faint">{s.label}</dt>
            <dd className="mt-0.5 text-[22px] font-semibold text-ink tabular">
              {s.value}
            </dd>
          </div>
        ))}
      </dl>

      <p className="mt-6 text-[14px] leading-relaxed text-ink-muted">
        {withHandle === 0
          ? "Nobody has been imported yet. Start with Import."
          : `Attendance is recorded against ${
              current ? `the ${current.name} session` : "no open session"
            }.`}
      </p>
    </div>
  );
}
