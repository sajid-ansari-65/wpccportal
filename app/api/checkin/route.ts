import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase";
import { normalizeWpUsername, wpUsernameError } from "@/lib/wpUsername";

// Public route — a student's own QR encodes their unique token.
// No login required, but the token is unguessable (12 random bytes), and it is
// the only thing that authorises writing to that student's row.
export async function POST(req: NextRequest) {
  const sb = supabaseServer();
  const { token, wpUsername } = await req.json();
  if (!token) return NextResponse.json({ error: "token required" }, { status: 400 });

  const { data: student, error: findErr } = await sb
    .from("students")
    .select("*")
    .eq("qr_token", token)
    .single();

  if (findErr || !student) {
    return NextResponse.json({ error: "Invalid QR code" }, { status: 404 });
  }

  // Second step of the check-in screen: save the handle the student typed.
  // Attendance is already recorded by then, so this never changes it.
  if (typeof wpUsername === "string") {
    const handle = normalizeWpUsername(wpUsername);
    const err = wpUsernameError(handle);
    if (err) return NextResponse.json({ error: err }, { status: 400 });

    const { data, error } = await sb
      .from("students")
      .update({ wp_username: handle || null })
      .eq("id", student.id)
      .select()
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ student: data, savedUsername: true });
  }

  if (student.attended) {
    return NextResponse.json({ student, alreadyMarked: true });
  }

  const { data, error } = await sb
    .from("students")
    .update({ attended: true, attended_at: new Date().toISOString(), marked_via: "qr" })
    .eq("id", student.id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ student: data, alreadyMarked: false });
}
