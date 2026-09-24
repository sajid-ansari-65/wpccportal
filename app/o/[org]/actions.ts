"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireOrgAdmin, getUser } from "@/lib/authz";
import { slugify } from "@/lib/slug";

export type EventState = { status: "idle" } | { status: "error"; message: string };

export async function createEvent(
  _prev: EventState,
  formData: FormData
): Promise<EventState> {
  const orgSlug = String(formData.get("org") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const slug = slugify(String(formData.get("slug") ?? "") || name);
  const timezone = String(formData.get("timezone") ?? "").trim() || "Asia/Kolkata";

  if (!name) return { status: "error", message: "Give the event a name." };
  if (!slug) return { status: "error", message: "That name has no letters or numbers in it." };

  const access = await requireOrgAdmin(orgSlug);
  const user = await getUser();
  const supabase = await createClient();

  // The default 'Main' session is created by a database trigger, so an event
  // is never left in a state where nobody can be marked present.
  const { error } = await supabase
    .from("events")
    .insert({
      org_id: access.org.id,
      name,
      slug,
      timezone,
      settings: { collect_wp_username: false, institution_label: "College" },
      created_by: user?.userId ?? null,
    })
    .select("id");

  if (error) {
    return {
      status: "error",
      message:
        error.code === "23505"
          ? `This organisation already has an event at /${slug}.`
          : error.message,
    };
  }

  revalidatePath(`/o/${orgSlug}`);
  return { status: "idle" };
}

export async function updateEvent(
  _prev: EventState,
  formData: FormData
): Promise<EventState> {
  const orgSlug = String(formData.get("org") ?? "");
  const id = String(formData.get("id") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const slug = slugify(String(formData.get("slug") ?? "") || name);
  const timezone = String(formData.get("timezone") ?? "").trim() || "Asia/Kolkata";

  if (!id) return { status: "error", message: "Which event?" };
  if (!name) return { status: "error", message: "An event needs a name." };
  if (!slug) return { status: "error", message: "That name has no letters or numbers in it." };

  const access = await requireOrgAdmin(orgSlug);
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("events")
    .update({ name, slug, timezone })
    .eq("id", id)
    .eq("org_id", access.org.id)
    .select("id");

  if (error) {
    return {
      status: "error",
      message:
        error.code === "23505"
          ? `This organisation already has an event at /${slug}.`
          : error.message,
    };
  }
  if (!data || data.length === 0) {
    return { status: "error", message: "That event could not be changed." };
  }

  revalidatePath(`/o/${orgSlug}`);
  return { status: "idle" };
}

/**
 * Archive, rather than delete, anything with people in it.
 *
 * Deleting an event CASCADES to attendees, attendance_records, sessions,
 * event_members, invitations and stations. One click would take 289 people and
 * every mark against them, silently and with no error to notice. Archiving
 * takes it out of the way and keeps every row.
 */
export async function setEventArchived(
  _prev: EventState,
  formData: FormData
): Promise<EventState> {
  const orgSlug = String(formData.get("org") ?? "");
  const id = String(formData.get("id") ?? "");
  const archived = String(formData.get("archived") ?? "") === "true";

  if (!id) return { status: "error", message: "Which event?" };

  const access = await requireOrgAdmin(orgSlug);
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("events")
    .update({ archived_at: archived ? new Date().toISOString() : null })
    .eq("id", id)
    .eq("org_id", access.org.id)
    .select("id");

  if (error) return { status: "error", message: error.message };
  if (!data || data.length === 0) {
    return { status: "error", message: "That event could not be changed." };
  }

  revalidatePath(`/o/${orgSlug}`);
  return { status: "idle" };
}

/**
 * Only ever an event nobody has been imported into — a typo, or a second
 * attempt at creating one. Everything else archives. Because of the cascade
 * above, this check is the difference between tidying up and losing a roster.
 */
export async function deleteEvent(
  _prev: EventState,
  formData: FormData
): Promise<EventState> {
  const orgSlug = String(formData.get("org") ?? "");
  const id = String(formData.get("id") ?? "");
  if (!id) return { status: "error", message: "Which event?" };

  const access = await requireOrgAdmin(orgSlug);
  const supabase = await createClient();

  const { data: stats, error: statErr } = await supabase.rpc("org_event_stats", {
    p_org: access.org.id,
  });
  if (statErr) return { status: "error", message: statErr.message };

  type Stat = { event_id: string; attendees: number };
  const count = Number(
    ((stats ?? []) as Stat[]).find((s) => s.event_id === id)?.attendees ?? 0
  );
  if (count > 0) {
    return {
      status: "error",
      message: `${count} people are in that event. Archive it instead — deleting would take them with it.`,
    };
  }

  const { data, error } = await supabase
    .from("events")
    .delete()
    .eq("id", id)
    .eq("org_id", access.org.id)
    .select("id");

  if (error) return { status: "error", message: error.message };
  if (!data || data.length === 0) {
    return { status: "error", message: "That event could not be removed." };
  }

  revalidatePath(`/o/${orgSlug}`);
  return { status: "idle" };
}
