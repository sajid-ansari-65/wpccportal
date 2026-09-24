import { createBrowserClient } from "@supabase/ssr";
import { SUPABASE_URL, SUPABASE_ANON_KEY, DB_SCHEMA } from "./env";

/** Browser client. Carries the signed-in user's session, so RLS applies. */
export function createClient() {
  return createBrowserClient(SUPABASE_URL(), SUPABASE_ANON_KEY(), {
    db: { schema: DB_SCHEMA },
  });
}
