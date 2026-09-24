"use server";

import { revalidatePath } from "next/cache";
import * as XLSX from "xlsx";
import { createClient } from "@/lib/supabase/server";
import { requireEventAdmin } from "@/lib/authz";
import { importAttendees, type ImportSummary } from "@/lib/importAttendees";
import type { RawRow } from "@/lib/importRows";

export type ImportState =
  | { status: "idle" }
  | { status: "error"; message: string }
  | { status: "done"; summary: ImportSummary };

// Sheets of a few thousand rows are well under this. The cap is here so a
// hostile or mistaken upload cannot be parsed at all.
const MAX_BYTES = 8 * 1024 * 1024;

export async function runImport(
  _prev: ImportState,
  formData: FormData
): Promise<ImportState> {
  const org = String(formData.get("org") ?? "");
  const event = String(formData.get("event") ?? "");
  const access = await requireEventAdmin(org, event);

  const file = formData.get("sheet");
  if (!(file instanceof File) || file.size === 0) {
    return { status: "error", message: "Choose a .csv or .xlsx file to import." };
  }
  if (file.size > MAX_BYTES) {
    return { status: "error", message: "That file is larger than 8 MB." };
  }

  let rows: RawRow[];
  try {
    // Parsed here, on the server, rather than in the browser. The parser has a
    // history of prototype-pollution and ReDoS advisories, and a spreadsheet is
    // a file from someone else — it should not be handed to a parser inside a
    // tab that holds the organiser's session.
    const buf = new Uint8Array(await file.arrayBuffer());
    const wb = XLSX.read(buf, { type: "array" });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    if (!sheet) return { status: "error", message: "That file has no sheets in it." };
    rows = XLSX.utils.sheet_to_json<RawRow>(sheet, { defval: "" });
  } catch {
    return {
      status: "error",
      message: "That file could not be read as a spreadsheet. Export it as .csv and try again.",
    };
  }

  if (rows.length === 0) {
    return { status: "error", message: "That sheet has a header but no rows." };
  }

  try {
    const supabase = await createClient();
    const summary = await importAttendees(supabase, {
      eventId: access.event.id,
      orgId: access.org.id,
      rows,
    });
    revalidatePath(`/e/${org}/${event}`);
    revalidatePath(`/e/${org}/${event}/admin`);
    return { status: "done", summary };
  } catch (e) {
    return { status: "error", message: e instanceof Error ? e.message : "Import failed." };
  }
}
