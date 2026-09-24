"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireEventAccess } from "@/lib/authz";

export type MarkResult = { ok: true } | { ok: false; message: string };

/**
 * Attendance is only ever written through portal.mark_attendance, never by a
 * direct table write: a volunteer must be able to mark someone present without
 * being able to edit them, and Postgres cannot express that as a policy.
 */
export async function setAttendance(
  orgSlug: string,
  eventSlug: string,
  attendeeId: string,
  sessionId: string,
  present: boolean
): Promise<MarkResult> {
  // Re-checked on the server every time. A Server Action is a public endpoint;
  // the fact that the UI only offers it to the right people proves nothing.
  await requireEventAccess(orgSlug, eventSlug);

  const supabase = await createClient();
  const { error } = await supabase.rpc("mark_attendance", {
    p_attendee: attendeeId,
    p_session: sessionId,
    p_present: present,
    p_marked_via: "manual",
  });

  if (error) return { ok: false, message: error.message };

  revalidatePath(`/e/${orgSlug}/${eventSlug}`);
  return { ok: true };
}
