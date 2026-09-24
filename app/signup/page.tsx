import SignupForm from "./SignupForm";
import { safeNext } from "@/lib/safeNext";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function SignupPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const next = safeNext(sp.next);
  // Why they are here decides which form they see first.
  //   link=expired  — they clicked a confirmation link that no longer works
  //   confirm=1     — they tried to sign in before confirming
  const mode = sp.link === "expired" ? "expired" : sp.confirm === "1" ? "unconfirmed" : "create";

  return (
    <main className="flex-1 grid place-items-center px-4 py-16">
      <div className="w-full max-w-sm">
        <SignupForm next={next} mode={mode} forInvite={next.startsWith("/join/")} />
      </div>
    </main>
  );
}
