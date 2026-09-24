/** Read once, fail loudly. A missing Supabase URL should not surface as a
 *  confusing fetch error three layers down. */
function required(name: string): string {
  const v = process.env[name];
  if (!v) {
    throw new Error(
      `${name} is not set. Copy .env.local.example to .env.local and fill it in.`
    );
  }
  return v;
}

export const SUPABASE_URL = () => required("NEXT_PUBLIC_SUPABASE_URL");
export const SUPABASE_ANON_KEY = () => required("NEXT_PUBLIC_SUPABASE_ANON_KEY");

/**
 * Every client in this app pins the `portal` schema here, once.
 *
 * Two reasons it lives in one constant rather than at each call site: the
 * legacy single-event tables still sit in `public` in the same database, and a
 * query that forgets its schema would read them silently; and Supabase's Data
 * API only exposes schemas listed in project settings, so a missing
 * "portal" there surfaces as PGRST106 rather than as a typo.
 */
export const DB_SCHEMA = "portal" as const;
