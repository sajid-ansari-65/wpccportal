"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type JoinState = { status: "idle" } | { status: "error"; message: string };

export async function acceptInvite(
  _prev: JoinState,
  formData: FormData
): Promise<JoinState> {
  const token = String(formData.get("token") ?? "");
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("accept_invite", { p_token: token });
  if (error) {
    return { status: "error", message: error.message.replace(/^.*?:\s*/, "") };
  }

  const row = (data as { org_slug: string; event_slug: string | null }[] | null)?.[0];
  if (!row) return { status: "error", message: "That invite could not be used." };

  // Straight to the thing they were invited to, not to a confirmation screen.
  redirect(row.event_slug ? `/e/${row.org_slug}/${row.event_slug}` : `/o/${row.org_slug}`);
}
