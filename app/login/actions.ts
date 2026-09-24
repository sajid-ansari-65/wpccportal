"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { safeNext } from "@/lib/safeNext";

/** Back to the form with a message, keeping where they were headed — losing
 *  `next` on a typo would drop someone arriving from an invite link. */
function backToLogin(message: string, next: string): never {
  const q = new URLSearchParams({ error: message });
  if (next !== "/dashboard") q.set("next", next);
  redirect(`/login?${q}`);
}

export async function signIn(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const next = safeNext(formData.get("next"));

  if (!email || !password) {
    backToLogin("Enter your email and password.", next);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  // Only reachable with the right password, so it tells a stranger nothing
  // they could not already find out by signing in.
  if (error?.code === "email_not_confirmed") {
    const q = new URLSearchParams({ confirm: "1" });
    if (next !== "/dashboard") q.set("next", next);
    redirect(`/signup?${q}`);
  }

  if (error) {
    // Deliberately not "no account with that email" — that tells anyone who
    // asks which addresses are registered.
    backToLogin("That email and password don't match.", next);
  }

  redirect(next);
}
