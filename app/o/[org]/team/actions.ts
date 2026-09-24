"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireOrgAdmin } from "@/lib/authz";

export type TeamState = { status: "idle" } | { status: "error"; message: string };

export async function createInvite(
  _prev: TeamState,
  formData: FormData
): Promise<TeamState> {
  const orgSlug = String(formData.get("org") ?? "");
  const role = String(formData.get("role") ?? "");
  const eventId = String(formData.get("eventId") ?? "") || null;
  const email = String(formData.get("email") ?? "").trim().toLowerCase() || null;
  const days = Number(formData.get("days") ?? 7);
  const maxUses = Number(formData.get("maxUses") ?? 1);

  if (!["owner", "admin", "volunteer"].includes(role)) {
    return { status: "error", message: "Pick a role." };
  }
  // The schema enforces this too; saying it here means a clear sentence rather
  // than a constraint name.
  if (role === "volunteer" && !eventId) {
    return { status: "error", message: "A volunteer joins one event — pick which." };
  }
  if (role !== "volunteer" && eventId) {
    return { status: "error", message: "Owners and admins are added to the whole organisation, not one event." };
  }

  const access = await requireOrgAdmin(orgSlug);
  if (role === "owner" && access.role !== "owner") {
    return { status: "error", message: "Only an owner can invite another owner." };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("invitations")
    .insert({
      org_id: access.org.id,
      event_id: eventId,
      role,
      email,
      // An email-bound invite is useless to anyone else, so one use is right.
      // An open link is for a group, so it carries a cap instead.
      max_uses: email ? 1 : Math.max(1, Math.min(maxUses, 100)),
      expires_at: new Date(Date.now() + Math.max(1, Math.min(days, 90)) * 86400000).toISOString(),
    })
    .select("id");

  if (error) return { status: "error", message: error.message };

  revalidatePath(`/o/${orgSlug}/team`);
  return { status: "idle" };
}

export async function revokeInvite(
  _prev: TeamState,
  formData: FormData
): Promise<TeamState> {
  const orgSlug = String(formData.get("org") ?? "");
  const id = String(formData.get("id") ?? "");
  const access = await requireOrgAdmin(orgSlug);
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("invitations")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", id)
    .eq("org_id", access.org.id)
    .select("id");

  if (error) return { status: "error", message: error.message };
  if (!data?.length) return { status: "error", message: "That invite could not be revoked." };

  revalidatePath(`/o/${orgSlug}/team`);
  return { status: "idle" };
}

/**
 * Removing someone is a delete against memberships or event_members, so the
 * guard trigger still applies: nobody removes themselves, and the last owner
 * cannot be removed at all.
 */
export async function removeMember(
  _prev: TeamState,
  formData: FormData
): Promise<TeamState> {
  const orgSlug = String(formData.get("org") ?? "");
  const userId = String(formData.get("userId") ?? "");
  const eventId = String(formData.get("eventId") ?? "") || null;

  const access = await requireOrgAdmin(orgSlug);
  const supabase = await createClient();

  // eventId arrives from the form, so it is the caller's to choose. RLS would
  // already filter a delete aimed at another tenant's event down to zero rows,
  // but "zero rows" then surfaces as "that person could not be removed" —
  // indistinguishable from an ordinary miss. Check it here so a cross-tenant
  // attempt is refused for the reason it is refused, and so this does not rely
  // on a policy staying exactly as it is.
  if (eventId) {
    const { data: ev } = await supabase
      .from("events")
      .select("id")
      .eq("id", eventId)
      .eq("org_id", access.org.id)
      .maybeSingle();
    if (!ev) {
      return { status: "error", message: "That event isn't part of this organisation." };
    }
  }

  const q = eventId
    ? supabase
        .from("event_members")
        .delete()
        .eq("event_id", eventId)
        .eq("user_id", userId)
        .eq("org_id", access.org.id)
    : supabase.from("memberships").delete().eq("org_id", access.org.id).eq("user_id", userId);

  const { data, error } = await q.select(eventId ? "event_id" : "org_id");

  if (error) return { status: "error", message: error.message };
  if (!data?.length) {
    return { status: "error", message: "That person could not be removed." };
  }

  revalidatePath(`/o/${orgSlug}/team`);
  return { status: "idle" };
}
