import Link from "next/link";
import { redirect } from "next/navigation";
import { getUser } from "@/lib/authz";

export default async function HomePage() {
  // Anyone already signed in wants their event, not a landing page.
  const user = await getUser();
  if (user) redirect("/dashboard");

  return (
    <main className="flex-1 grid place-items-center px-4 py-16">
      <div className="w-full max-w-md">
        <h1 className="text-[32px] leading-[1.15] font-semibold tracking-[-0.025em] text-wp-dark">
          Attendance for campus events
        </h1>
        <p className="mt-3 text-[16px] leading-relaxed text-ink-muted">
          Import your registration sheet, hand volunteers a phone, and mark
          people in as they arrive.
        </p>

        <Link
          href="/login"
          className="mt-8 inline-flex items-center rounded-lg bg-wp px-5 py-3 text-base font-medium text-white transition-colors hover:bg-wp-dark"
        >
          Sign in
        </Link>

        <p className="mt-10 text-[13px] leading-relaxed text-ink-faint">
          Volunteers don&rsquo;t need an account first — the invite link an
          organiser sends creates one on first use.
        </p>
      </div>
    </main>
  );
}
