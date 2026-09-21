import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase";
import { normalizeWpUsername, wpUsernameError } from "@/lib/wpUsername";

export async function POST(req: NextRequest) {
  const sb = supabaseServer();
  const { id, attended, wpUsername } = await req.json();
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const marking = attended !== false;
  const patch: Record<string, unknown> = {
    attended: marking,
    attended_at: marking ? new Date().toISOString() : null,
    marked_via: "manual",
  };

  // Only touch the handle when one was actually supplied, so un-marking
  // someone never silently wipes what they gave us.
  if (typeof wpUsername === "string") {
    const handle = normalizeWpUsername(wpUsername);
    const err = wpUsernameError(handle);
    if (err) return NextResponse.json({ error: err }, { status: 400 });
    patch.wp_username = handle || null;
  }

  const { data, error } = await sb
    .from("students")
    .update(patch)
    .eq("id", id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ student: data });
}
