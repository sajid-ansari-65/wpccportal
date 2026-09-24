import { type EmailOtpType } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import { type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { safeNext } from "@/lib/safeNext";

/**
 * The link in the confirmation email lands here.
 *
 * token_hash rather than a PKCE code exchange, so the link works on whatever
 * device the email is opened on. A volunteer signs up on a laptop and taps the
 * link on their phone; a code exchange needs the verifier cookie from the
 * browser that started it, and would fail.
 */
export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type") as EmailOtpType | null;
  const next = safeNext(url.searchParams.get("next"), requestOrigin(request));

  if (tokenHash && type) {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    // redirect() rather than a NextResponse, so the session cookie that
    // verifyOtp just set goes out on this same response.
    if (!error) redirect(next);
  }

  const back = new URLSearchParams({ link: "expired" });
  if (next !== "/dashboard") back.set("next", next);
  redirect(`/signup?${back}`);
}

/**
 * The origin the visitor actually used. `nextUrl.origin` is not it: Next
 * normalises it (127.0.0.1 comes back as localhost in dev), so comparing the
 * link's `next` against it silently sent everyone to /dashboard instead of
 * back to their invite. Behind Vercel's proxy the forwarded headers carry it.
 */
function requestOrigin(request: NextRequest): string {
  const h = request.headers;
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? request.nextUrl.host;
  const proto = h.get("x-forwarded-proto") ?? request.nextUrl.protocol.replace(/:$/, "");
  return `${proto}://${host}`;
}
