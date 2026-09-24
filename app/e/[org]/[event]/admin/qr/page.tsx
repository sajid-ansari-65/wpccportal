import { headers } from "next/headers";
import QRCode from "qrcode";
import { requireEventAdmin } from "@/lib/authz";
import { createClient } from "@/lib/supabase/server";
import { canonicalYear, compareByName } from "@/lib/attendeeSort";
import { titleCaseName } from "@/lib/names";

type Row = {
  id: string;
  name: string;
  qr_token: string;
  attributes: Record<string, string> | null;
  institutions: { short_name: string | null; name: string } | null;
};

export default async function QrSheetPage({
  params,
  searchParams,
}: {
  params: Promise<{ org: string; event: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { org, event } = await params;
  const sp = await searchParams;
  const year = typeof sp.year === "string" ? sp.year : null;

  const access = await requireEventAdmin(org, event);
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("attendees")
    .select("id, name, qr_token, attributes, institutions(name, short_name)")
    .eq("event_id", access.event.id);

  if (error) throw new Error(`Could not load attendees: ${error.message}`);

  let rows = (data ?? []) as unknown as Row[];
  if (year) {
    const wanted = canonicalYear(year);
    rows = rows.filter((r) => canonicalYear(r.attributes?.year ?? "") === wanted);
  }
  rows = [...rows].sort(compareByName);

  // The code has to carry an absolute URL, because it is scanned by a phone
  // camera that has no idea which site it came from.
  const h = await headers();
  const proto = h.get("x-forwarded-proto") ?? "http";
  const origin = `${proto}://${h.get("host")}`;

  const cards = await Promise.all(
    rows.map(async (r) => ({
      id: r.id,
      name: titleCaseName(r.name),
      year: canonicalYear(r.attributes?.year ?? ""),
      institution: r.institutions?.short_name ?? r.institutions?.name ?? "",
      // SVG rather than a PNG data URL: it prints at the printer's resolution
      // instead of the screen's, and a blurry QR code is a useless one.
      svg: await QRCode.toString(`${origin}/checkin/${r.qr_token}`, {
        type: "svg",
        margin: 0,
        errorCorrectionLevel: "M",
      }),
    }))
  );

  const years = [
    ...new Set(rows.map((r) => canonicalYear(r.attributes?.year ?? "")).filter(Boolean)),
  ];

  return (
    <div>
      <div className="print:hidden">
        <h2 className="text-[15px] font-medium text-ink">Entry passes</h2>
        <p className="mt-1 text-[14px] leading-relaxed text-ink-muted">
          {cards.length} {cards.length === 1 ? "pass" : "passes"}
          {year ? ` for ${year}` : ""}. Print this page, or save it as a PDF and
          send it out.
        </p>

        {years.length > 1 && (
          <div className="mt-3 flex flex-wrap gap-2">
            <FilterLink href={`/e/${org}/${event}/admin/qr`} active={!year}>
              All years
            </FilterLink>
            {years.map((y) => (
              <FilterLink
                key={y}
                href={`/e/${org}/${event}/admin/qr?year=${encodeURIComponent(y)}`}
                active={year === y}
              >
                {y}
              </FilterLink>
            ))}
          </div>
        )}
      </div>

      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 print:grid-cols-3 print:gap-2">
        {cards.map((c) => (
          <div
            key={c.id}
            className="break-inside-avoid rounded-lg border border-line bg-surface p-3 text-center print:border-ink/20"
          >
            <div
              className="mx-auto aspect-square w-full max-w-[120px] [&>svg]:h-full [&>svg]:w-full"
              dangerouslySetInnerHTML={{ __html: c.svg }}
            />
            <p className="mt-2 text-[13px] font-medium leading-snug text-ink">{c.name}</p>
            {(c.institution || c.year) && (
              <p className="mt-0.5 text-[11px] leading-snug text-ink-faint">
                {[c.institution, c.year].filter(Boolean).join(" · ")}
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function FilterLink({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <a
      href={href}
      className={`rounded-full border px-3.5 py-1.5 text-[14px] ${
        active ? "border-wp bg-wp text-white" : "border-line bg-surface text-ink-muted"
      }`}
    >
      {children}
    </a>
  );
}
