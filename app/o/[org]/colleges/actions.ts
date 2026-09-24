"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireOrgAdmin } from "@/lib/authz";

export type CollegeState = { status: "idle" } | { status: "error"; message: string };

export async function addCollege(
  _prev: CollegeState,
  formData: FormData
): Promise<CollegeState> {
  const orgSlug = String(formData.get("org") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const shortName = String(formData.get("shortName") ?? "").trim();

  if (!name) return { status: "error", message: "Give the college a name." };

  const access = await requireOrgAdmin(orgSlug);
  const supabase = await createClient();

  const { error } = await supabase
    .from("institutions")
    .insert({ org_id: access.org.id, name, short_name: shortName || null })
    .select("id");

  if (error) {
    // 23505: the case-insensitive unique index caught a college that is
    // already here under a different capitalisation.
    return {
      status: "error",
      message:
        error.code === "23505"
          ? `“${name}” is already on the list.`
          : error.message,
    };
  }

  revalidatePath(`/o/${orgSlug}/colleges`);
  return { status: "idle" };
}

export async function updateCollege(
  _prev: CollegeState,
  formData: FormData
): Promise<CollegeState> {
  const orgSlug = String(formData.get("org") ?? "");
  const id = String(formData.get("id") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const shortName = String(formData.get("shortName") ?? "").trim();

  if (!id) return { status: "error", message: "Which college?" };
  if (!name) return { status: "error", message: "A college needs a name." };

  const access = await requireOrgAdmin(orgSlug);
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("institutions")
    .update({ name, short_name: shortName || null })
    .eq("id", id)
    .eq("org_id", access.org.id)
    .select("id");

  if (error) {
    return {
      status: "error",
      message:
        error.code === "23505"
          ? `Another college is already called “${name}”. Merge them instead.`
          : error.message,
    };
  }
  // Under RLS a forbidden update reports success and changes nothing, so the
  // row count is the only honest signal that anything happened.
  if (!data || data.length === 0) {
    return { status: "error", message: "That college could not be changed." };
  }

  revalidatePath(`/o/${orgSlug}/colleges`);
  return { status: "idle" };
}

/**
 * Remove a college that nobody is attached to.
 *
 * Deliberately refused once it has attendees: `attendees.institution_id` is
 * ON DELETE SET NULL, so deleting a populated college would quietly strip the
 * college off every one of those people instead of failing. Merging is the
 * right move there, and it keeps the history.
 */
export async function deleteCollege(
  _prev: CollegeState,
  formData: FormData
): Promise<CollegeState> {
  const orgSlug = String(formData.get("org") ?? "");
  const id = String(formData.get("id") ?? "");
  if (!id) return { status: "error", message: "Which college?" };

  const access = await requireOrgAdmin(orgSlug);
  const supabase = await createClient();

  const { data: stats, error: statErr } = await supabase.rpc("org_institution_stats", {
    p_org: access.org.id,
  });
  if (statErr) return { status: "error", message: statErr.message };

  type Stat = { institution_id: string; attendees: number };
  const count = ((stats ?? []) as Stat[]).find((s) => s.institution_id === id)?.attendees ?? 0;
  if (Number(count) > 0) {
    return {
      status: "error",
      message: `${count} people are attached to that college. Merge it into another one instead.`,
    };
  }

  const { data, error } = await supabase
    .from("institutions")
    .delete()
    .eq("id", id)
    .eq("org_id", access.org.id)
    .select("id");

  if (error) return { status: "error", message: error.message };
  if (!data || data.length === 0) {
    return { status: "error", message: "That college could not be removed." };
  }

  revalidatePath(`/o/${orgSlug}/colleges`);
  return { status: "idle" };
}
