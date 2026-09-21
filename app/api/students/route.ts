import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase";

export async function GET(req: NextRequest) {
  const sb = supabaseServer();
  const q = req.nextUrl.searchParams.get("q")?.trim();

  let query = sb.from("students").select("*");
  if (q) {
    query = query.or(`name.ilike.%${q}%,email.ilike.%${q}%,college.ilike.%${q}%`);
  }
  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Explicit case-insensitive alphabetical sort (DB collation can otherwise
  // put uppercase/lowercase or accented names out of plain A-Z order).
  const sorted = [...(data || [])].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
  );
  return NextResponse.json({ students: sorted });
}
