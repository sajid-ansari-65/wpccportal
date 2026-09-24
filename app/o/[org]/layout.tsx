import Link from "next/link";
import { requireOrgAdmin } from "@/lib/authz";

/**
 * Organisation admin: the things that outlive any single event.
 *
 * Colleges and events belong to the organisation, not to an event, so they are
 * managed here rather than inside one event's screens — otherwise adding a
 * college would mean picking an arbitrary event to do it from.
 */
export default async function OrgLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ org: string }>;
}) {
  const { org } = await params;
  const access = await requireOrgAdmin(org);

  const tabs = [
    { href: `/o/${org}`, label: "Events" },
    { href: `/o/${org}/colleges`, label: "Colleges" },
    { href: `/o/${org}/team`, label: "Team" },
  ];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="border-b border-line bg-surface px-4 pt-3">
        <h1 className="truncate text-[17px] font-semibold tracking-[-0.01em] text-wp-dark">
          {access.org.name}
        </h1>
        <nav className="-mx-4 mt-3 flex gap-1 overflow-x-auto px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {tabs.map((t) => (
            <Link
              key={t.href}
              href={t.href}
              className="shrink-0 border-b-2 border-transparent px-3 pb-2.5 text-[14px] text-ink-muted hover:text-ink"
            >
              {t.label}
            </Link>
          ))}
        </nav>
      </header>

      <div className="flex-1 px-4 py-6">
        <div className="mx-auto w-full max-w-2xl">{children}</div>
      </div>
    </div>
  );
}
