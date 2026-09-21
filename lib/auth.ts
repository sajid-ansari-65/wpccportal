import { cookies } from "next/headers";
import crypto from "crypto";

const COOKIE_NAME = "wpcc_session";

function sign(value: string, secret: string) {
  return crypto.createHmac("sha256", secret).update(value).digest("hex");
}

export async function createSession() {
  const secret = process.env.ADMIN_PASSWORD!;
  const value = "ok";
  const sig = sign(value, secret);
  const store = await cookies();
  store.set(COOKIE_NAME, `${value}.${sig}`, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7, // 7 days
  });
}

export async function destroySession() {
  const store = await cookies();
  store.delete(COOKIE_NAME);
}

export async function isAuthed() {
  const secret = process.env.ADMIN_PASSWORD;
  if (!secret) return false;
  const store = await cookies();
  const raw = store.get(COOKIE_NAME)?.value;
  if (!raw) return false;
  const [value, sig] = raw.split(".");
  if (!value || !sig) return false;
  return sign(value, secret) === sig;
}
