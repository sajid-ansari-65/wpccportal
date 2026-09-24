import Link from "next/link";
import { requireEventAdmin } from "@/lib/authz";

/**
 * The admin backend: desk work, before and after the event.
 *
 * Guarded here so every page under it inherits the check. Volunteers get a 404
 * rather than a 403 — a 403 would confirm the page exists.
 */
export default async function AdminLayout({
  children,
  params,
}: LayoutProps<"/e/[org]/[event]/admin">) {
  const { org, event } = await params;
  const access = await requireEventAdmin(org, event);
  const base = `/e/${org}/${event}`;

  const tabs = [
    { href: `${base}/admin`, label: "Overview" },
    { href: `${base}/admin/import`, label: "Import" },
    { href: `${base}/admin/export`, label: "Export" },
    { href: `${base}/admin/qr`, label: "Entry passes" },
  ];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="border-b border-line bg-surface px-4 pt-3">
        <div className="flex items-baseline justify-between gap-3">
          <h1 className="truncate text-[17px] font-semibold tracking-[-0.01em] text-wp-dark">
            {access.event.name}
          </h1>
          <span className="flex shrink-0 items-center gap-3">
            <Link href={`/o/${org}`} className="text-[13px] text-ink-faint hover:text-ink">
              Organisation
            </Link>
            <Link href={base} className="text-[13px] text-ink-faint hover:text-ink">
              Event day
            </Link>
          </span>
        </div>

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
