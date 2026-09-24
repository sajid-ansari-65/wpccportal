"use server";

import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { safeNext } from "@/lib/safeNext";

export type SignupState =
  | { status: "idle" }
  | { status: "error"; message: string }
  | { status: "sent"; email: string; next: string; resent?: boolean };

const MIN_PASSWORD = 8;

/** Where the confirmation link should land them once it has been verified.
 *  Carried to Supabase as a full url, because that is what `emailRedirectTo`
 *  takes, and brought back to a path by /auth/confirm. */
async function redirectTarget(next: string): Promise<string> {
  const h = await headers();
  const origin = h.get("origin") ?? `https://${h.get("host")}`;
  return `${origin}${next}`;
}

export async function signUp(_prev: SignupState, formData: FormData): Promise<SignupState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const next = safeNext(formData.get("next"));

  if (!email || !password) {
    return { status: "error", message: "Enter your email and choose a password." };
  }
  if (password.length < MIN_PASSWORD) {
    return { status: "error", message: `Choose a password of at least ${MIN_PASSWORD} characters.` };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: { emailRedirectTo: await redirectTarget(next) },
  });

  if (error) {
    if (error.code === "over_email_send_rate_limit") {
      return { status: "error", message: "Too many emails sent just now. Wait a few minutes and try again." };
    }
    if (error.code === "weak_password") {
      return { status: "error", message: "Choose a longer or less common password." };
    }
    return { status: "error", message: "The account could not be created. Check the email address and try again." };
  }

  // The same screen whether or not the address already had an account.
  // Supabase deliberately answers both the same way, and so does this page:
  // otherwise it would tell anyone who asks which emails are registered.
  return { status: "sent", email, next };
}

export async function resendConfirmation(
  _prev: SignupState,
  formData: FormData
): Promise<SignupState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const next = safeNext(formData.get("next"));
  if (!email) return { status: "error", message: "Enter your email address." };

  const supabase = await createClient();
  const { error } = await supabase.auth.resend({
    type: "signup",
    email,
    options: { emailRedirectTo: await redirectTarget(next) },
  });

  if (error?.code === "over_email_send_rate_limit") {
    return { status: "error", message: "Too many emails sent just now. Wait a few minutes and try again." };
  }
  // Any other outcome reads the same, for the same reason as above.
  return { status: "sent", email, next, resent: true };
}
