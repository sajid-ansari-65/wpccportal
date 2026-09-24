import { requireEventAccess } from "@/lib/authz";
import { loadAttendees, loadSessions, resolveCurrentSession } from "@/lib/eventData";
import AttendanceList from "./AttendanceList";
import Link from "next/link";
import { signOut } from "@/app/logout/actions";

export default async function EventDayPage({
  params,
}: {
  params: Promise<{ org: string; event: string }>;
}) {
  const { org, event } = await params;
  const access = await requireEventAccess(org, event);

  const sessions = await loadSessions(access.event.id);
  const current = resolveCurrentSession(sessions);
  const attendees = await loadAttendees(access.event.id, current?.id ?? null);

  // A value that is the same for everyone carries no information, so it does
  // not earn a line on all 187 rows. Single-college events are the common case
  // for campus connect, so it goes in the header instead.
  const institutions = new Set(
    attendees.map((a) => a.institution).filter((v): v is string => !!v)
  );
  const soleInstitution = institutions.size === 1 ? [...institutions][0] : null;

  return (
    <main className="flex min-h-0 flex-1 flex-col">
      <header className="flex items-start justify-between gap-3 border-b border-line bg-surface px-4 py-3">
        <div className="min-w-0">
          <h1 className="truncate text-[17px] font-semibold tracking-[-0.01em] text-wp-dark">
            {access.event.name}
          </h1>
        {/* Sessions stay invisible until there is more than one, so a plain
            single-day event reads exactly as it always did. */}
        {(soleInstitution || sessions.length > 1) && (
          <p className="mt-0.5 truncate text-[13px] text-ink-faint">
            {[soleInstitution, sessions.length > 1 ? current?.name ?? "No session open" : null]
              .filter(Boolean)
              .join(" — ")}
          </p>
        )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {access.role !== "volunteer" && (
            <Link
              href={`/e/${org}/${event}/admin`}
              className="rounded-md px-2 py-1 text-[13px] text-ink-faint hover:text-ink"
            >
              Admin
            </Link>
          )}
        {/* Volunteers hand these phones around, so signing out has to be
            reachable without hunting for a menu. */}
        <form action={signOut}>
          <button
            type="submit"
            className="shrink-0 rounded-md px-2 py-1 text-[13px] text-ink-faint hover:text-ink"
          >
            Sign out
          </button>
        </form>
        </div>
      </header>

      {!current ? (
        <div className="px-4 py-12 text-center">
          <p className="text-[16px] font-medium text-ink">Check-in isn&rsquo;t open</p>
          <p className="mx-auto mt-1.5 max-w-xs text-[14px] leading-relaxed text-ink-muted">
            No session is accepting attendance right now. An organiser can open
            one, or mark people in from the admin screens.
          </p>
        </div>
      ) : (
        <AttendanceList
          orgSlug={org}
          eventSlug={event}
          sessionId={current.id}
          attendees={attendees}
          showInstitution={institutions.size > 1}
        />
      )}
    </main>
  );
}
