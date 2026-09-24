import { titleCaseName } from "./names";
import { normalizeWpUsername } from "./wpUsername";

// Header variants recognised as first-class fields. Everything else in the
// sheet is preserved verbatim in `attributes` rather than being dropped — an
// organiser's "Roll No" or "T-shirt size" column survives the round trip.
//
// Note `institution` rather than `college`: the sheet header is still likely
// to say "College", but the field it maps to is named for the schema, which is
// deliberately neutral about what kind of body an attendee belongs to.
export const HEADER_ALIASES = {
  name: ["name", "full name", "student name", "student"],
  email: ["email", "email address", "e-mail", "mail", "email id"],
  phone: ["phone", "mobile", "contact", "phone number", "mobile number", "whatsapp"],
  institution: [
    "college",
    "institute",
    "institution",
    "organization",
    "organisation",
    "school",
  ],
  wpUsername: [
    "wordpress username",
    "wordpress.org username",
    "wordpress org username",
    "wp username",
    "wordpress profile",
    "profile username",
    "wordpress.org profile",
  ],
} as const;

export type RawRow = Record<string, unknown> & { __row?: number };

export type MappedRow = {
  /** 1-based row in the source sheet, so an error can be pointed at. */
  row: number;
  name: string;
  email: string | null;
  phone: string | null;
  institution: string | null;
  wpUsername: string | null;
  attributes: Record<string, string>;
};

export type SkipKind = "invalid" | "duplicate";

export type SkippedRow = {
  row: number;
  name: string;
  email: string | null;
  kind: SkipKind;
  reason: string;
};

export type MapResult = { rows: MappedRow[]; skipped: SkippedRow[] };

function text(v: unknown): string {
  return v === null || v === undefined ? "" : String(v).trim();
}

/**
 * Turn raw spreadsheet rows into candidate attendees.
 *
 * Pure: no database, no network. Duplicate detection here covers only
 * duplicates *within the file* — clashes against already-stored rows are the
 * caller's job, because only the caller knows which event is being imported
 * into.
 */
export function mapImportRows(input: RawRow[]): MapResult {
  const rows: MappedRow[] = [];
  const skipped: SkippedRow[] = [];

  // email (lowercased) -> the sheet row that first claimed it
  const seenInFile = new Map<string, number>();

  for (let i = 0; i < input.length; i++) {
    const raw = input[i];
    const rowNo = typeof raw.__row === "number" ? raw.__row : i + 2; // +2: header is row 1

    // Normalise headers once so "Full Name", " full name " and "FULL NAME" match.
    const byHeader = new Map<string, unknown>();
    for (const [k, v] of Object.entries(raw)) {
      if (k === "__row") continue;
      byHeader.set(k.toLowerCase().trim(), v);
    }

    const claimed = new Set<string>();
    const pick = (keys: readonly string[]) => {
      for (const k of keys) {
        if (byHeader.has(k)) {
          claimed.add(k);
          const v = text(byHeader.get(k));
          if (v) return v;
        }
      }
      return "";
    };

    const name = titleCaseName(pick(HEADER_ALIASES.name));
    const email = pick(HEADER_ALIASES.email).toLowerCase() || null;
    const phone = pick(HEADER_ALIASES.phone) || null;
    const institution = pick(HEADER_ALIASES.institution) || null;
    const wpUsername = normalizeWpUsername(pick(HEADER_ALIASES.wpUsername)) || null;

    // Whatever the sheet had that we didn't map goes here, so nothing is lost.
    const attributes: Record<string, string> = {};
    for (const [k, v] of byHeader) {
      if (claimed.has(k)) continue;
      const val = text(v);
      if (val) attributes[k] = val;
    }

    if (!name) {
      skipped.push({
        row: rowNo,
        name: "",
        email,
        kind: "invalid",
        reason: "Name column is empty",
      });
      continue;
    }

    if (email) {
      const firstRow = seenInFile.get(email);
      if (firstRow !== undefined) {
        skipped.push({
          row: rowNo,
          name,
          email,
          kind: "duplicate",
          reason: `Same email already on row ${firstRow} of this file`,
        });
        continue;
      }
      seenInFile.set(email, rowNo);
    }

    rows.push({ row: rowNo, name, email, phone, institution, wpUsername, attributes });
  }

  return { rows, skipped };
}
