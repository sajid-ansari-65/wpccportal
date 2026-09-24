import Link from "next/link";
import { getUser } from "@/lib/authz";
import { createClient } from "@/lib/supabase/server";
import JoinForm from "./JoinForm";

type Invite = {
  org_name: string;
  event_name: string | null;
  role: string;
  email: string | null;
  problem: string | null;
};

const ROLE: Record<string, string> = {
  volunteer: "a volunteer",
  admin: "an admin",
  owner: "an owner",
};

const EXPLAIN: Record<string, string> = {
  volunteer: "You'll be able to search the attendee list and mark people in. Nothing else.",
  admin: "You'll be able to import and export rosters, print passes and manage the team.",
  owner: "You'll be able to do everything, including adding other owners.",
};

export default async function JoinPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  // Readable signed out on purpose: someone opening this link should see what
  // they are joining before being asked to sign in.
  const supabase = await createClient();
  const { data } = await supabase.rpc("describe_invite", { p_token: token });
  const invite = (data as Invite[] | null)?.[0];
  const user = await getUser();

  if (!invite) {
    return (
      <Shell>
        <h1 className="text-[24px] font-semibold text-ink">That link isn&rsquo;t valid</h1>
        <p className="mt-2 text-[15px] leading-relaxed text-ink-muted">
          Check you copied the whole thing. If it still fails, ask whoever sent
          it for a fresh one.
        </p>
      </Shell>
    );
  }

  if (invite.problem) {
    const said: Record<string, string> = {
      revoked: "This invite was cancelled.",
      expired: "This invite has expired.",
      "used up": "This invite has already been used.",
      "wrong account": `This invite is for ${invite.email}. You're signed in as someone else.`,
    };
    return (
      <Shell>
        <h1 className="text-[24px] font-semibold text-ink">
          {invite.problem === "wrong account" ? "Wrong account" : "This invite can’t be used"}
        </h1>
        <p className="mt-2 text-[15px] leading-relaxed text-ink-muted">
          {said[invite.problem] ?? "Ask whoever sent it for a fresh one."}
        </p>
        {invite.problem === "wrong account" && (
          <p className="mt-4 text-[14px] text-ink-muted">
            Sign out and open this link again with {invite.email}.
          </p>
        )}
      </Shell>
    );
  }

  return (
    <Shell>
      <p className="text-[13px] text-ink-faint">You&rsquo;ve been invited</p>
      <h1 className="mt-1 text-[26px] leading-tight font-semibold tracking-[-0.02em] text-wp-dark">
        {invite.event_name ?? invite.org_name}
      </h1>
      <p className="mt-2 text-[16px] text-ink">
        Join {invite.event_name ? `${invite.org_name}’s event` : "this organisation"} as{" "}
        {ROLE[invite.role] ?? invite.role}.
      </p>
      <p className="mt-2 text-[14px] leading-relaxed text-ink-muted">
        {EXPLAIN[invite.role]}
      </p>

      {user ? (
        <JoinForm token={token} role={ROLE[invite.role]?.replace(/^an? /, "") ?? invite.role} />
      ) : (
        <>
          <Link
            href={`/login?next=${encodeURIComponent(`/join/${token}`)}`}
            className="mt-6 block w-full rounded-lg bg-wp px-4 py-3 text-center text-base font-medium text-white"
          >
            Sign in to join
          </Link>
          <p className="mt-3 text-[13px] leading-relaxed text-ink-faint">
            {invite.email
              ? `This invite only works for ${invite.email}.`
              : "No account yet? You can create one on the next screen."}
          </p>
        </>
      )}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex-1 px-5 py-12">
      <div className="mx-auto w-full max-w-sm">{children}</div>
    </main>
  );
}
