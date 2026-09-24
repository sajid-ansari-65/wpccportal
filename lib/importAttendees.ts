import { mapImportRows, type RawRow, type SkippedRow } from "./importRows";
import type { createClient } from "./supabase/server";

/** Derived from the factory rather than written out, so it stays correct if
 *  the pinned schema ever changes. */
type PortalClient = Awaited<ReturnType<typeof createClient>>;

export type Stale = {
  id: string;
  name: string;
  email: string | null;
  /** Marked present in some session. Never offered for removal: it is a record
   *  of someone who actually turned up. */
  attended: boolean;
};

export type ImportSummary = {
  totalRows: number;
  inserted: number;
  updated: number;
  skippedDuplicate: number;
  skippedInvalid: number;
  institutionsCreated: number;
  details: SkippedRow[];
  /**
   * In this event and at one of the colleges this sheet covers, but not in the
   * sheet itself.
   *
   * Scoped to the sheet's own colleges on purpose. A sheet for one college says
   * nothing about who should be at another, so listing the other college's
   * people as "missing" would be noise at best and an invitation to delete
   * them at worst.
   *
   * Reported only. Nothing is removed — who leaves the list is a decision with
   * a person on the other end of it, not a side effect of an upload.
   */
  notInSheet: Stale[];
  /** The colleges this sheet covered, so the report can say what it compared. */
  scopedTo: string[];
};

// PostgREST puts filter values in the query string, so a very long `in.(...)`
// can exceed the URL length limit. Chunked rather than hoping.
const LOOKUP_CHUNK = 200;

/**
 * Write a parsed sheet into one event.
 *
 * Two rules here are load-bearing rather than stylistic:
 *
 *   1. Existing people are updated BY ID, never by email. The legacy app
 *      updated `.eq("email", …)` with no event scope, which was safe only
 *      because a global unique index guaranteed one row per email in the whole
 *      database. Per-event uniqueness removes that guarantee, and an
 *      update-by-email would then rewrite a same-named person in another event.
 *
 *   2. Every mutation selects its result and treats zero rows as an error.
 *      Under RLS a forbidden UPDATE does not raise — it reports success and
 *      changes nothing — so counting attempts instead of results would report
 *      a clean import that never happened.
 */
export async function importAttendees(
  supabase: PortalClient,
  opts: { eventId: string; orgId: string; rows: RawRow[] }
): Promise<ImportSummary> {
  const { eventId, orgId, rows: rawRows } = opts;
  const { rows, skipped } = mapImportRows(rawRows);
  const details = [...skipped];

  // --- institutions ---------------------------------------------------------
  const wanted = new Map<string, string>(); // lower(name) -> original spelling
  for (const r of rows) {
    if (r.institution) wanted.set(r.institution.toLowerCase(), r.institution);
  }

  const institutionId = new Map<string, string>(); // lower(name) -> id
  let institutionsCreated = 0;

  if (wanted.size > 0) {
    const { data: existing, error } = await supabase
      .from("institutions")
      .select("id, name, merged_into")
      .eq("org_id", orgId);
    if (error) throw new Error(`Could not read institutions: ${error.message}`);

    // Resolve through merged_into, so re-uploading an old spelling lands on the
    // institution it was merged into instead of resurrecting the duplicate.
    const byId = new Map((existing ?? []).map((i) => [i.id as string, i]));
    const resolve = (id: string): string => {
      const seen = new Set<string>();
      let cur = id;
      while (true) {
        const row = byId.get(cur);
        if (!row?.merged_into || seen.has(cur)) return cur;
        seen.add(cur);
        cur = row.merged_into as string;
      }
    };

    for (const i of existing ?? []) {
      institutionId.set(String(i.name).toLowerCase(), resolve(i.id as string));
    }

    const missing = [...wanted.entries()].filter(([k]) => !institutionId.has(k));
    if (missing.length > 0) {
      const { data: made, error: insErr } = await supabase
        .from("institutions")
        .insert(missing.map(([, name]) => ({ org_id: orgId, name })))
        .select("id, name");
      if (insErr) throw new Error(`Could not create institutions: ${insErr.message}`);
      for (const i of made ?? []) {
        institutionId.set(String(i.name).toLowerCase(), i.id as string);
      }
      institutionsCreated = made?.length ?? 0;
    }
  }

  // --- who already exists in THIS event -------------------------------------
  const emails = rows.map((r) => r.email).filter((e): e is string => !!e);
  const existingId = new Map<string, string>(); // lower(email) -> attendee id

  for (let i = 0; i < emails.length; i += LOOKUP_CHUNK) {
    const { data, error } = await supabase
      .from("attendees")
      .select("id, email")
      .eq("event_id", eventId)
      .in("email", emails.slice(i, i + LOOKUP_CHUNK));
    if (error) throw new Error(`Could not check existing attendees: ${error.message}`);
    for (const a of data ?? []) {
      if (a.email) existingId.set(String(a.email).toLowerCase(), a.id as string);
    }
  }

  // --- update what exists, insert what does not -----------------------------
  let updated = 0;
  let inserted = 0;

  for (const r of rows) {
    const id = r.email ? existingId.get(r.email) : undefined;
    if (!id) continue;

    // A blank cell must never erase a value that is already stored — a sheet
    // re-uploaded without the phone column should not wipe every phone number.
    const patch: Record<string, unknown> = { name: r.name };
    if (r.phone) patch.phone = r.phone;
    if (r.institution) patch.institution_id = institutionId.get(r.institution.toLowerCase());
    if (Object.keys(r.attributes).length > 0) patch.attributes = r.attributes;
    if (r.wpUsername) patch.wp_username = r.wpUsername;

    const { data, error } = await supabase
      .from("attendees")
      .update(patch)
      .eq("id", id)
      .select("id");

    if (error) {
      details.push({ row: r.row, name: r.name, email: r.email, kind: "invalid", reason: error.message });
      continue;
    }
    if (!data || data.length === 0) {
      details.push({
        row: r.row,
        name: r.name,
        email: r.email,
        kind: "invalid",
        reason: "Not saved — you may not have permission to edit this attendee.",
      });
      continue;
    }
    updated++;
  }

  const fresh = rows.filter((r) => !r.email || !existingId.has(r.email));
  if (fresh.length > 0) {
    const payload = fresh.map((r) => ({
      event_id: eventId,
      org_id: orgId,
      name: r.name,
      email: r.email,
      phone: r.phone,
      institution_id: r.institution
        ? institutionId.get(r.institution.toLowerCase())
        : null,
      attributes: r.attributes,
      wp_username: r.wpUsername,
      consent_source: "import",
      consent_at: new Date().toISOString(),
    }));

    const { data, error } = await supabase.from("attendees").insert(payload).select("id");

    if (error) {
      // 23505: the unique index caught a duplicate the in-file check could not
      // see — two imports racing, or a row added between the lookup and here.
      throw new Error(
        error.code === "23505"
          ? "A duplicate email was rejected by the database. Re-upload to see which rows."
          : error.message
      );
    }
    inserted = data?.length ?? 0;
  }

  // --- who is here but not in the sheet ------------------------------------
  // Two deliberate limits on what this even looks at:
  //
  //   1. Only the colleges the sheet covers. A TDEC roster says nothing about
  //      who should be at VNSGU.
  //   2. Only people stored with an email, because matching is by email. An
  //      attendee without one cannot be shown to be missing — only that we
  //      cannot tell.
  const inSheet = new Set(rows.map((r) => r.email).filter((e): e is string => !!e));
  const sheetInstitutionIds = [...wanted.keys()]
    .map((k) => institutionId.get(k))
    .filter((v): v is string => !!v);

  let notInSheet: Stale[] = [];

  if (sheetInstitutionIds.length > 0) {
    const { data: existing, error: staleErr } = await supabase
      .from("attendees")
      .select("id, name, email")
      .eq("event_id", eventId)
      .in("institution_id", sheetInstitutionIds)
      .not("email", "is", null);
    if (staleErr) throw new Error(`Could not compare with the sheet: ${staleErr.message}`);

    const missing = (existing ?? []).filter(
      (a) => a.email && !inSheet.has(String(a.email).toLowerCase())
    );

    if (missing.length > 0) {
      const { data: marks, error: markErr } = await supabase
        .from("attendance_records")
        .select("attendee_id")
        .eq("event_id", eventId)
        .is("revoked_at", null);
      if (markErr) throw new Error(`Could not check attendance: ${markErr.message}`);

      const attended = new Set((marks ?? []).map((m) => m.attendee_id as string));
      notInSheet = missing.map((a) => ({
        id: a.id as string,
        name: a.name as string,
        email: (a.email as string) ?? null,
        attended: attended.has(a.id as string),
      }));
    }
  }

  return {
    notInSheet,
    scopedTo: [...wanted.values()],
    totalRows: rawRows.length,
    inserted,
    updated,
    skippedDuplicate: details.filter((d) => d.kind === "duplicate").length,
    skippedInvalid: details.filter((d) => d.kind === "invalid").length,
    institutionsCreated,
    details: details.slice(0, 200),
  };
}
