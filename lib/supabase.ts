import { createClient } from "@supabase/supabase-js";

// Server-side client — uses the service role key so it can bypass RLS
// for the admin dashboard and the public self-checkin route.
// NEVER expose SUPABASE_SERVICE_ROLE_KEY to the browser.
export function supabaseServer() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createClient(url, key, {
    auth: { persistSession: false },
  });
}
