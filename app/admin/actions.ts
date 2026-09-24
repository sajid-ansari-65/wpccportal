"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requirePlatformAdmin } from "@/lib/authz";
import { slugify } from "@/lib/slug";

export type OrgState = { status: "idle" } | { status: "error"; message: string };

export async function createOrganization(
  _prev: OrgState,
  formData: FormData
): Promise<OrgState> {
  await requirePlatformAdmin();

  const name = String(formData.get("name") ?? "").trim();
  const slug = slugify(String(formData.get("slug") ?? "") || name);
  const ownerEmail = String(formData.get("ownerEmail") ?? "").trim();

  if (!name) return { status: "error", message: "Give the organisation a name." };
  if (!slug) return { status: "error", message: "That name has no letters or numbers in it." };
  if (!ownerEmail) return { status: "error", message: "Who owns it?" };

  // One RPC, one transaction: an organisation without an owner cannot be
  // administered by anyone, and the membership trigger will not let a second
  // request grant ownership after the fact.
  const supabase = await createClient();
  const { error } = await supabase.rpc("create_organization", {
    p_slug: slug,
    p_name: name,
    p_owner_email: ownerEmail,
  });

  if (error) {
    const known =
      error.message.includes("No account for")
        ? `${ownerEmail} hasn’t signed in yet. Ask them to sign in once, then create this.`
        : error.code === "23505"
          ? `There is already an organisation at /${slug}.`
          : error.message;
    return { status: "error", message: known };
  }

  revalidatePath("/admin");
  return { status: "idle" };
}

export async function updateOrganization(
  _prev: OrgState,
  formData: FormData
): Promise<OrgState> {
  await requirePlatformAdmin();

  const id = String(formData.get("id") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const slug = slugify(String(formData.get("slug") ?? "") || name);

  if (!id) return { status: "error", message: "Which organisation?" };
  if (!name) return { status: "error", message: "An organisation needs a name." };
  if (!slug) return { status: "error", message: "That name has no letters or numbers in it." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("organizations")
    .update({ name, slug })
    .eq("id", id)
    .select("id");

  if (error) {
    return {
      status: "error",
      message:
        error.code === "23505"
          ? `There is already an organisation at /o/${slug}.`
          : error.message,
    };
  }
  // Under RLS a forbidden update reports success and changes nothing, so the
  // row count is the only honest signal.
  if (!data?.length) return { status: "error", message: "That could not be changed." };

  revalidatePath("/admin");
  return { status: "idle" };
}

/**
 * Only an organisation with no events and nobody in it — a typo, or a second
 * attempt at creating one.
 *
 * Deleting cascades to attendees, attendance, events, sessions, institutions,
 * memberships, invitations and stations. There is no undo and no archive of
 * what was there, so the emptiness check is the whole safety mechanism.
 */
export async function deleteOrganization(
  _prev: OrgState,
  formData: FormData
): Promise<OrgState> {
  await requirePlatformAdmin();

  const id = String(formData.get("id") ?? "");
  if (!id) return { status: "error", message: "Which organisation?" };

  const supabase = await createClient();

  // Re-checked here, not trusted from the page that rendered the button: the
  // page may have been open while somebody imported a roster.
  const { data: empty, error: checkErr } = await supabase.rpc("org_is_empty", {
    p_org: id,
  });
  if (checkErr) return { status: "error", message: checkErr.message };
  if (!empty) {
    return {
      status: "error",
      message: "That organisation has events or people in it, so it can't be deleted.",
    };
  }

  const { data, error } = await supabase
    .from("organizations")
    .delete()
    .eq("id", id)
    .select("id");

  if (error) return { status: "error", message: error.message };
  if (!data?.length) return { status: "error", message: "That could not be removed." };

  revalidatePath("/admin");
  return { status: "idle" };
}
