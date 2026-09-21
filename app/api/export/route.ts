import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase";

function toCsvValue(v: string) {
  if (v.includes(",") || v.includes('"') || v.includes("\n")) {
    return `"${v.replace(/"/g, '""')}"`;
  }
  return v;
}

// "3rd Year" < "4th Year" < "Final year" < "Other" < (blank).
// Plain alphabetical would put "4th" before "Final", which reads wrong.
function yearRank(y: string) {
  const t = y.toLowerCase();
  const m = t.match(/(\d)/);
  if (m) return Number(m[1]);
  if (t.includes("final")) return 8;
  if (!t) return 10;
  return 9;
}

type Row = {
  name: string;
  email: string | null;
  college: string | null;
  attended: boolean;
  attended_at: string | null;
  attributes: Record<string, string> | null;
  wp_username: string | null;
};

export async function GET(req: NextRequest) {
  const sb = supabaseServer();
  const sp = req.nextUrl.searchParams;
  const college = sp.get("college")?.trim() || null;
  const year = sp.get("year")?.trim() || null;
  const scope = sp.get("scope") === "all" ? "all" : "present";

  let query = sb
    .from("students")
    .select("name,email,college,attended,attended_at,attributes,wp_username");
  if (scope === "present") query = query.eq("attended", true);
  if (college) query = query.eq("college", college);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Year lives in the jsonb attributes, so it is filtered here rather than in
  // the query.
  const rows = ((data ?? []) as Row[]).filter(
    (s) => !year || (s.attributes?.year ?? "").trim() === year
  );

  // Year first, then name A-Z (case-insensitive; the DB collation alone puts
  // uppercase names out of plain A-Z order).
  rows.sort((a, b) => {
    const ya = (a.attributes?.year ?? "").trim();
    const yb = (b.attributes?.year ?? "").trim();
    const r = yearRank(ya) - yearRank(yb);
    if (r !== 0) return r;
    if (ya !== yb) return ya.localeCompare(yb, undefined, { sensitivity: "base" });
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });

  const header = [
    "Name",
    "Year",
    "Branch",
    "WordPress.org Username",
    "Email",
    "College",
    "Present",
    "Attended At",
  ];
  const body = rows.map((s) =>
    [
      s.name,
      s.attributes?.year ?? "",
      s.attributes?.branch ?? "",
      s.wp_username ?? "",
      s.email ?? "",
      s.college ?? "",
      s.attended ? "Yes" : "No",
      s.attended_at ?? "",
    ]
      .map((v) => toCsvValue(String(v)))
      .join(",")
  );

  const parts = ["wpcc", scope === "all" ? "registered" : "attendance"];
  if (year) parts.push(year.replace(/\s+/g, "-").toLowerCase());
  parts.push(new Date().toISOString().slice(0, 10));

  return new NextResponse([header.join(","), ...body].join("\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${parts.join("-")}.csv"`,
    },
  });
}
