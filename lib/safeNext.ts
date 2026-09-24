/**
 * Where to send someone after they sign in, sign up or confirm their email.
 *
 * Only ever a path inside this app. An open redirect on an auth page hands an
 * attacker a credible-looking link to anywhere.
 *
 * The confirmation email is the one place a FULL url arrives: Supabase passes
 * back the `emailRedirectTo` it was given. That is accepted only when it points
 * at the same origin, and reduced to its path.
 */
export function safeNext(raw: unknown, origin?: string): string {
  const fallback = "/dashboard";
  if (typeof raw !== "string" || raw === "") return fallback;

  if (raw.startsWith("/")) {
    // "//evil.com" and "/\evil.com" are protocol-relative in browsers.
    return raw.startsWith("//") || raw.startsWith("/\\") ? fallback : raw;
  }

  if (!origin) return fallback;
  try {
    const url = new URL(raw);
    if (url.origin !== new URL(origin).origin) return fallback;
    return safeNext(url.pathname + url.search, undefined);
  } catch {
    return fallback;
  }
}
