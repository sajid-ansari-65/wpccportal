import { createClient } from "./supabase/server";
import { canonicalYear, compareByName } from "./attendeeSort";
import { titleCaseName } from "./names";

export type SessionRow = {
  id: string;
  name: string;
  isDefault: boolean;
  opensAt: string | null;
  closesAt: string | null;
};

export type AttendeeRow = {
  id: string;
  name: string;
  /**
   * Sent to the event-day client so a scanned code can be resolved against
   * THIS event without a round trip — and, later, while offline.
   *
   * It is a credential, so this is a deliberate call rather than an oversight:
   * anyone holding it can only check in someone the volunteer is already able
   * to mark present by tapping their name, so it grants nothing new. It never
   * goes to the admin screens, which have no use for it.
   */
  qrToken: string;
  email: string | null;
  /** The id, not just the label: filters key off this, because two colleges
   *  can share a short name and a rename must not break a saved filter. */
  institutionId: string | null;
  institution: string | null;
  year: string;
  present: boolean;
};

/**
 * Which session a mark lands in, at time T. Used identically by the event-day
 * surface and the public check-in page.
 *
 *   1. One session only  -> it is current, regardless of windows.
 *   2. Otherwise         -> the session whose check-in window contains T.
 *   3. Several match     -> the one closing soonest, being the most urgent.
 *   4. None match        -> there is no current session, and the caller decides
 *                           what to do about it.
 *
 * Rule 1 is what keeps a plain single-day event behaving exactly as it always
 * has: no windows to set, nothing about sessions in the UI at all.
 */
export function resolveCurrentSession(
  sessions: SessionRow[],
  now: Date = new Date()
): SessionRow | null {
  if (sessions.length === 0) return null;
  if (sessions.length === 1) return sessions[0];

  const t = now.getTime();
  const open = sessions.filter((s) => {
    const from = s.opensAt ? Date.parse(s.opensAt) : -Infinity;
    const to = s.closesAt ? Date.parse(s.closesAt) : Infinity;
    return t >= from && t <= to;
  });

  if (open.length === 0) return null;

  return open.reduce((soonest, s) => {
    const a = s.closesAt ? Date.parse(s.closesAt) : Infinity;
    const b = soonest.closesAt ? Date.parse(soonest.closesAt) : Infinity;
    return a < b ? s : soonest;
  });
}

export async function loadSessions(eventId: string): Promise<SessionRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("sessions")
    .select("id, name, is_default, checkin_opens_at, checkin_closes_at")
    .eq("event_id", eventId)
    .order("position");

  if (error) throw new Error(`Could not load sessions: ${error.message}`);

  return (data ?? []).map((s) => ({
    id: s.id,
    name: s.name,
    isDefault: s.is_default,
    opensAt: s.checkin_opens_at,
    closesAt: s.checkin_closes_at,
  }));
}

export async function loadAttendees(
  eventId: string,
  sessionId: string | null
): Promise<AttendeeRow[]> {
  const supabase = await createClient();

  const [people, marks] = await Promise.all([
    supabase
      .from("attendees")
      .select("id, name, email, qr_token, attributes, institution_id, institutions(name, short_name)")
      .eq("event_id", eventId),
    sessionId
      ? supabase
          .from("attendance_records")
          .select("attendee_id")
          .eq("session_id", sessionId)
          .is("revoked_at", null)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (people.error) throw new Error(`Could not load attendees: ${people.error.message}`);
  if (marks.error) throw new Error(`Could not load attendance: ${marks.error.message}`);

  const present = new Set((marks.data ?? []).map((r) => r.attendee_id as string));

  type Inst = { name: string; short_name: string | null } | null;

  const rows: AttendeeRow[] = (people.data ?? []).map((p) => {
    const inst = p.institutions as unknown as Inst;
    const attrs = (p.attributes ?? {}) as Record<string, string>;
    return {
      id: p.id,
      name: titleCaseName(p.name),
      qrToken: p.qr_token,
      email: p.email,
      institutionId: (p.institution_id as string | null) ?? null,
      institution: inst ? (inst.short_name ?? inst.name) : null,
      year: canonicalYear(attrs.year ?? ""),
      present: present.has(p.id),
    };
  });

  // Sorted here rather than with `order`, because database collation puts
  // uppercase and accented names out of plain A-Z order.
  return rows.sort(compareByName);
}
