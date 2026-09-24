import Link from "next/link";
import { redirect } from "next/navigation";
import { isPlatformAdmin, listMyEvents, requireUser } from "@/lib/authz";

/**
 * The entry point volunteers already have bookmarked from the Surat event.
 *
 * One event is the overwhelmingly common case, so it redirects rather than
 * making someone tap through a list of one.
 */
export default async function DashboardPage() {
  await requireUser("/dashboard");
  const [events, platform] = await Promise.all([listMyEvents(), isPlatformAdmin()]);

  // A platform operator often belongs to no event at all, and would otherwise
  // land on an empty screen with no way to reach the one page they can use.
  if (events.length === 0 && platform) redirect("/admin");

  if (events.length === 1) {
    const e = events[0];
    redirect(`/e/${e.orgSlug}/${e.eventSlug}`);
  }

  return (
    <main className="flex-1 px-4 py-10">
      <div className="mx-auto w-full max-w-lg">
        <div className="flex items-baseline justify-between gap-3">
          <h1 className="text-[28px] leading-tight font-semibold tracking-[-0.02em] text-wp-dark">
            Your events
          </h1>
          {platform && (
            <Link href="/admin" className="shrink-0 text-[13px] text-ink-faint hover:text-ink">
              Platform
            </Link>
          )}
        </div>

        {events.length === 0 ? (
          <div className="mt-6 rounded-xl border border-line bg-surface p-5">
            <p className="text-[15px] text-ink">
              You&rsquo;re not part of an event yet.
            </p>
            <p className="mt-2 text-[14px] leading-relaxed text-ink-muted">
              Organisers add people by sending an invite link. Ask yours for
              one, then open it on this device to join.
            </p>
          </div>
        ) : (
          <ul className="mt-6 divide-y divide-line-soft overflow-hidden rounded-xl border border-line bg-surface">
            {events.map((e) => (
              <li key={`${e.orgSlug}/${e.eventSlug}`}>
                <Link
                  href={`/e/${e.orgSlug}/${e.eventSlug}`}
                  className="flex min-h-[64px] w-full min-w-0 items-center justify-between gap-3 px-4 py-3 hover:bg-wp-pale/40"
                >
                  <span className="min-w-0">
                    <span className="block text-[16px] font-medium text-ink">
                      {e.eventName}
                    </span>
                    <span className="mt-0.5 block truncate text-[13px] text-ink-faint">
                      {e.orgName}
                    </span>
                  </span>
                  <span className="shrink-0 text-[13px] text-ink-muted">
                    {e.role === "volunteer" ? "Volunteer" : "Organiser"}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}
