import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase";
import { normalizeWpUsername } from "@/lib/wpUsername";

// Header variants we recognise as first-class fields. Everything else in the
// sheet is preserved verbatim in `attributes` rather than being dropped.
const ALIASES: Record<"name" | "email" | "phone" | "college" | "wpUsername", string[]> = {
  name: ["name", "full name", "student name", "student"],
  email: ["email", "email address", "e-mail", "mail", "email id"],
  phone: ["phone", "mobile", "contact", "phone number", "mobile number", "whatsapp"],
  college: ["college", "institute", "institution", "organization", "organisation", "school"],
  wpUsername: [
    "wordpress username",
    "wordpress.org username",
    "wordpress org username",
    "wp username",
    "wordpress profile",
    "profile username",
    "wordpress.org profile",
  ],
};

type RawRow = Record<string, unknown> & { __row?: number };

type Skipped = { row: number; name: string; email: string | null; reason: string };

function text(v: unknown): string {
  return v === null || v === undefined ? "" : String(v).trim();
}

export async function POST(req: NextRequest) {
  const sb = supabaseServer();
  const { students } = (await req.json()) as { students?: RawRow[] };

  if (!Array.isArray(students) || students.length === 0) {
    return NextResponse.json({ error: "No rows received" }, { status: 400 });
  }

  const skipped: Skipped[] = [];
  const toInsert: {
    name: string;
    email: string | null;
    phone: string | null;
    college: string | null;
    wp_username: string | null;
    attributes: Record<string, string>;
  }[] = [];

  // email (lowercased) -> the sheet row that first claimed it
  const seenInFile = new Map<string, number>();

  for (let i = 0; i < students.length; i++) {
    const raw = students[i];
    const rowNo = typeof raw.__row === "number" ? raw.__row : i + 2; // +2: header is row 1

    // Normalise headers once so "Full Name", " full name " and "FULL NAME" match.
    const byHeader = new Map<string, unknown>();
    for (const [k, v] of Object.entries(raw)) {
      if (k === "__row") continue;
      byHeader.set(k.toLowerCase().trim(), v);
    }

    const claimed = new Set<string>();
    const pick = (keys: string[]) => {
      for (const k of keys) {
        if (byHeader.has(k)) {
          claimed.add(k);
          const v = text(byHeader.get(k));
          if (v) return v;
        }
      }
      return "";
    };

    const name = pick(ALIASES.name);
    const email = pick(ALIASES.email).toLowerCase() || null;
    const phone = pick(ALIASES.phone) || null;
    const college = pick(ALIASES.college) || null;
    const wpUsername = normalizeWpUsername(pick(ALIASES.wpUsername)) || null;

    // Whatever the sheet had that we didn't map goes here, so nothing is lost.
    const attributes: Record<string, string> = {};
    for (const [k, v] of byHeader) {
      if (claimed.has(k)) continue;
      const val = text(v);
      if (val) attributes[k] = val;
    }

    if (!name) {
      skipped.push({ row: rowNo, name: "", email, reason: "Name column is empty" });
      continue;
    }

    if (email) {
      const firstRow = seenInFile.get(email);
      if (firstRow !== undefined) {
        skipped.push({
          row: rowNo,
          name,
          email,
          reason: `Same email already on row ${firstRow} of this file`,
        });
        continue;
      }
      seenInFile.set(email, rowNo);
    }

    toInsert.push({ name, email, phone, college, wp_username: wpUsername, attributes });
  }

  // Now check the ones that survived against what's already stored.
  const emails = toInsert.map((s) => s.email).filter((e): e is string => !!e);
  const existing = new Set<string>();
  if (emails.length > 0) {
    // Chunked: a very long ?in=(...) can exceed the URL length limit.
    for (let i = 0; i < emails.length; i += 200) {
      const { data, error } = await sb
        .from("students")
        .select("email")
        .in("email", emails.slice(i, i + 200));
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      for (const r of data ?? []) if (r.email) existing.add(String(r.email).toLowerCase());
    }
  }

  // An email that already exists is NOT a new row — but the stored row may
  // predate a column the sheet now has (e.g. Year), so backfill its details.
  // attended / attended_at / qr_token are never touched: attendance already
  // recorded stays, and printed QR codes keep working.
  const fresh: typeof toInsert = [];
  const updates: typeof toInsert = [];
  for (const s of toInsert) {
    if (s.email && existing.has(s.email)) updates.push(s);
    else fresh.push(s);
  }

  let updated = 0;
  for (const u of updates) {
    const { error } = await sb
      .from("students")
      .update({
        name: u.name,
        phone: u.phone,
        college: u.college,
        attributes: u.attributes,
        // Only overwrite when the sheet actually carries a handle — a blank
        // cell must not erase one a student gave us at check-in.
        ...(u.wp_username ? { wp_username: u.wp_username } : {}),
      })
      .eq("email", u.email);
    if (error) {
      skipped.push({ row: 0, name: u.name, email: u.email, reason: error.message });
      continue;
    }
    updated++;
  }

  let inserted = 0;
  if (fresh.length > 0) {
    const { data, error } = await sb.from("students").insert(fresh).select("id");
    if (error) {
      // 23505 = unique violation: the DB index caught a duplicate the checks
      // above missed (two imports racing each other).
      const conflict = error.code === "23505";
      return NextResponse.json(
        {
          error: conflict
            ? "Duplicate email rejected by the database. Re-upload to see which rows."
            : error.message,
        },
        { status: conflict ? 409 : 500 }
      );
    }
    inserted = data.length;
  }

  const invalid = skipped.filter((s) => s.reason === "Name column is empty");
  const duplicates = skipped.filter((s) => s.reason !== "Name column is empty");

  return NextResponse.json({
    totalRows: students.length,
    inserted,
    updated,
    skippedDuplicate: duplicates.length,
    skippedInvalid: invalid.length,
    details: skipped.slice(0, 200),
  });
}
