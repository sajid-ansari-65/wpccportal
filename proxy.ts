import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { SUPABASE_URL, SUPABASE_ANON_KEY, DB_SCHEMA } from "@/lib/supabase/env";

/**
 * Proxy does exactly two things, per Next's own guidance: refresh the Supabase
 * session cookie, and optimistically send signed-out visitors to /login.
 *
 * It is NOT where authorization lives. Deciding what a given user may see is
 * the job of the server-side DAL in lib/authz.ts, called as the first line of
 * every page and route handler — a redirect here is a convenience, not a
 * security boundary.
 */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(SUPABASE_URL(), SUPABASE_ANON_KEY(), {
    db: { schema: DB_SCHEMA },
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  // Refreshes the token and rewrites the cookie when needed. Do not remove:
  // without a call that touches auth, the session silently expires mid-session.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user && !isPublic(request.nextUrl.pathname)) {
    const login = new URL("/login", request.url);
    login.searchParams.set("next", request.nextUrl.pathname);
    return NextResponse.redirect(login);
  }

  return response;
}

const PUBLIC_PREFIXES = ["/login", "/signup", "/auth", "/join", "/checkin", "/api/checkin", "/s/"];

function isPublic(pathname: string): boolean {
  if (pathname === "/") return true;
  return PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/") || pathname.startsWith(p));
}

export const config = {
  matcher: [
    /*
     * Everything except static assets and image optimisation.
     *
     * /checkin/:token and /api/checkin are matched but treated as public
     * above rather than excluded here, so their session cookie is still
     * refreshed if the visitor happens to be signed in — a volunteer scanning
     * their own code should not be logged out by doing so.
     */
    "/((?!_next/static|_next/image|favicon.ico|icon.png|apple-icon.png|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
