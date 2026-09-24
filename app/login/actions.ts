"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

/** Only ever redirect within this app. An open redirect on a login page hands
 *  an attacker a credible-looking link to anywhere. */
function safeNext(raw: FormDataEntryValue | null): string {
  const v = typeof raw === "string" ? raw : "";
  return v.startsWith("/") && !v.startsWith("//") ? v : "/dashboard";
}

export async function signIn(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const next = safeNext(formData.get("next"));

  if (!email || !password) {
    redirect(`/login?error=${encodeURIComponent("Enter your email and password.")}`);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    // Deliberately not "no account with that email" — that tells anyone who
    // asks which addresses are registered.
    redirect(`/login?error=${encodeURIComponent("That email and password don't match.")}`);
  }

  redirect(next);
}
