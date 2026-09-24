"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { normalizeWpUsername, wpUsernameError } from "@/lib/wpUsername";

export type HandleState = { status: "idle" | "saved" } | { status: "error"; message: string };

export async function saveHandle(
  _prev: HandleState,
  formData: FormData
): Promise<HandleState> {
  const token = String(formData.get("token") ?? "");
  const raw = String(formData.get("wpUsername") ?? "");

  const handle = normalizeWpUsername(raw);
  const problem = wpUsernameError(handle);
  if (problem) return { status: "error", message: problem };
  if (!handle) return { status: "idle" };

  // Same RPC as the check-in itself: recording attendance is idempotent, so
  // saving a handle afterwards cannot double-mark anyone.
  const supabase = await createClient();
  const { error } = await supabase.rpc("checkin_by_token", {
    p_token: token,
    p_wp_username: handle,
  });

  if (error) return { status: "error", message: "That didn't save. Try again." };

  revalidatePath(`/checkin/${token}`);
  return { status: "saved" };
}
