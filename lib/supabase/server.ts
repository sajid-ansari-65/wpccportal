import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { SUPABASE_URL, SUPABASE_ANON_KEY, DB_SCHEMA } from "./env";

/**
 * Server client for Server Components, Route Handlers and Server Actions.
 *
 * Scoped to the signed-in user, so RLS is the backstop on every query. Never
 * cache this across requests: it holds one request's cookies.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(SUPABASE_URL(), SUPABASE_ANON_KEY(), {
    db: { schema: DB_SCHEMA },
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Server Components cannot set cookies. Harmless: proxy.ts refreshes
          // the session on every request, so the write is never the only one.
        }
      },
    },
  });
}
