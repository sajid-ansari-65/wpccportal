import Link from "next/link";
import { signIn } from "./actions";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function LoginPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const sp = await searchParams;
  const error = typeof sp.error === "string" ? sp.error : null;
  const next = typeof sp.next === "string" ? sp.next : "";

  return (
    <main className="flex-1 grid place-items-center px-4 py-16">
      <div className="w-full max-w-sm">
        <h1 className="text-[28px] leading-tight font-semibold tracking-[-0.02em] text-wp-dark">
          Attendance Portal
        </h1>
        <p className="mt-2 text-[15px] text-ink-muted">
          Sign in to run your event.
        </p>

        <form action={signIn} className="mt-8 space-y-4">
          <input type="hidden" name="next" value={next} />

          <div>
            <label htmlFor="email" className="block text-[13px] font-medium text-ink-muted">
              Email
            </label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              autoFocus
              required
              className="mt-1.5 w-full rounded-lg border border-line bg-surface px-3.5 py-3 text-base text-ink placeholder:text-ink-faint"
            />
          </div>

          <div>
            <label htmlFor="password" className="block text-[13px] font-medium text-ink-muted">
              Password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              className="mt-1.5 w-full rounded-lg border border-line bg-surface px-3.5 py-3 text-base text-ink placeholder:text-ink-faint"
            />
          </div>

          {error && (
            <p
              role="alert"
              className="rounded-lg border border-orange/30 bg-orange/5 px-3.5 py-2.5 text-[14px] text-ink"
            >
              {error}
            </p>
          )}

          <button
            type="submit"
            className="w-full rounded-lg bg-wp px-4 py-3 text-base font-medium text-white transition-colors hover:bg-wp-dark"
          >
            Sign in
          </button>
        </form>

        <p className="mt-8 text-[14px] text-ink-muted">
          New here?{" "}
          <Link
            href={next ? `/signup?next=${encodeURIComponent(next)}` : "/signup"}
            className="font-medium text-wp underline-offset-2 hover:underline"
          >
            Create an account
          </Link>
        </p>
      </div>
    </main>
  );
}
