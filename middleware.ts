import { NextRequest, NextResponse } from "next/server";

const COOKIE_NAME = "wpcc_session";

// Edge-runtime-safe HMAC using Web Crypto (no Node 'crypto' module).
async function sign(value: string, secret: string) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sigBuf = await crypto.subtle.sign("HMAC", key, enc.encode(value));
  return Array.from(new Uint8Array(sigBuf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function isAuthed(req: NextRequest) {
  const secret = process.env.ADMIN_PASSWORD;
  if (!secret) return false;
  const raw = req.cookies.get(COOKIE_NAME)?.value;
  if (!raw) return false;
  const [value, sig] = raw.split(".");
  if (!value || !sig) return false;
  return (await sign(value, secret)) === sig;
}

// Protected: dashboard UI + admin-only APIs.
// Public: /login, /checkin/[token] (student self-checkin), /api/login
const PROTECTED_PREFIXES = ["/dashboard", "/api/students", "/api/import", "/api/export", "/api/mark"];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const needsAuth = PROTECTED_PREFIXES.some((p) => pathname.startsWith(p));
  if (!needsAuth) return NextResponse.next();

  if (await isAuthed(req)) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const loginUrl = new URL("/login", req.url);
  loginUrl.searchParams.set("next", pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/dashboard/:path*", "/api/students/:path*", "/api/import/:path*", "/api/export/:path*", "/api/mark/:path*"],
};
