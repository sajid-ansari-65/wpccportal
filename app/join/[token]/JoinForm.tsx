"use client";

import { useActionState } from "react";
import { acceptInvite, type JoinState } from "./actions";

const initial: JoinState = { status: "idle" };

export default function JoinForm({ token, role }: { token: string; role: string }) {
  const [state, action, pending] = useActionState(acceptInvite, initial);

  return (
    <form action={action} className="mt-6">
      <input type="hidden" name="token" value={token} />
      {state.status === "error" && (
        <p role="alert" className="mb-3 rounded-lg border border-orange/40 bg-orange/5 px-4 py-3 text-[14px] text-ink">
          {state.message}
        </p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-lg bg-wp px-4 py-3 text-base font-medium text-white disabled:opacity-60"
      >
        {pending ? "Joining…" : `Join as ${role}`}
      </button>
    </form>
  );
}
