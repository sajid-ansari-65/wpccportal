import { NextRequest, NextResponse } from "next/server";
import { requireEventAdmin } from "@/lib/authz";
import { createClient } from "@/lib/supabase/server";
import { loadSessions, resolveCurrentSession } from "@/lib/eventData";
import { canonicalYear, compareByYearThenName } from "@/lib/attendeeSort";
import { toCsv } from "@/lib/csv";
import { slugify } from "@/lib/slug";
import { titleCaseName } from "@/lib/names";

type Row = {
  id: string;
  institution_id: string | null;
  name: string;
  email: string | null;
  phone: string | null;
  wp_username: string | null;
  attributes: Record<string, string> | null;
  institutions: { name: string; short_name: string | null } | null;
};

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ org: string; event: string }> }
) {
  const { org, event } = await ctx.params;
  const access = await requireEventAdmin(org, event);

  const sp = req.nextUrl.searchParams;
  const scope = sp.get("scope") === "all" ? "all" : "present";
  const year = sp.get("year")?.trim() || null;
  // By id, not by name: two colleges can share a short name, and renaming one
  // must not silently change which people a saved link exports.
  const college = sp.get("college")?.trim() || null;

  const supabase = await createClient();
  const sessions = await loadSessions(access.event.id);
  const current = resolveCurrentSession(sessions);

  const [people, marks] = await Promise.all([
    supabase
      .from("attendees")
      .select("id, name, email, phone, wp_username, attributes, institution_id, institutions(name, short_name)")
      .eq("event_id", access.event.id),
    current
      ? supabase
          .from("attendance_records")
          .select("attendee_id, marked_at")
          .eq("session_id", current.id)
          .is("revoked_at", null)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (people.error) {
    return NextResponse.json({ error: people.error.message }, { status: 500 });
  }
  if (marks.error) {
    return NextResponse.json({ error: marks.error.message }, { status: 500 });
  }

  const markedAt = new Map(
    (marks.data ?? []).map((m) => [m.attendee_id as string, m.marked_at as string])
  );

  let rows = ((people.data ?? []) as unknown as Row[]).map((p) => {
    const attrs = { ...((p.attributes ?? {}) as Record<string, string>) };
    // Same normalisation the event screen uses, so a "3rd Year" export is not
    // missing everyone whose sheet said "3rd year".
    attrs.year = canonicalYear(attrs.year ?? "");
    return { ...p, attrs, present: markedAt.has(p.id) };
  });

  if (scope === "present") rows = rows.filter((r) => r.present);
  if (college) rows = rows.filter((r) => r.institution_id === college);
  // Year lives in the jsonb attributes, so it is filtered here rather than in
  // the query.
  if (year) {
    const wanted = canonicalYear(year);
    rows = rows.filter((r) => r.attrs.year === wanted);
  }

  rows.sort((a, b) =>
    compareByYearThenName(
      { name: titleCaseName(a.name), attributes: a.attrs },
      { name: titleCaseName(b.name), attributes: b.attrs }
    )
  );

  const csv = toCsv(
    ["Name", "Year", "Branch", "WordPress.org username", "Email", "Phone", "College", "Present", "Marked at"],
    rows.map((r) => [
      titleCaseName(r.name),
      r.attrs.year ?? "",
      r.attrs.branch ?? "",
      r.wp_username ?? "",
      r.email ?? "",
      r.phone ?? "",
      r.institutions?.name ?? "",
      r.present ? "Yes" : "No",
      markedAt.get(r.id) ?? "",
    ])
  );

  // The filename says what is inside it. Three of these on a desktop, all
  // called "attendance.csv", is how the wrong list gets printed.
  const collegeLabel = college
    ? (rows[0]?.institutions?.short_name ?? rows[0]?.institutions?.name ?? null)
    : null;

  const parts = [
    access.event.slug,
    scope === "all" ? "registered" : "attendance",
    ...(collegeLabel ? [slugify(collegeLabel)] : []),
    ...(year ? [slugify(year)] : []),
    new Date().toISOString().slice(0, 10),
  ].filter(Boolean);

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${parts.join("-")}.csv"`,
    },
  });
}
