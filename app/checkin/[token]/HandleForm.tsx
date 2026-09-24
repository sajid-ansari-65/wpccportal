"use client";

import { useActionState } from "react";
import { saveHandle, type HandleState } from "./actions";

const initial: HandleState = { status: "idle" };

export default function HandleForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState(saveHandle, initial);

  if (state.status === "saved") {
    return (
      <p className="mt-6 rounded-lg border border-line bg-wp-pale/40 px-4 py-3 text-[15px] text-ink">
        Saved. Thanks — you can close this page.
      </p>
    );
  }

  return (
    <form action={action} className="mt-8">
      <input type="hidden" name="token" value={token} />

      <label htmlFor="wpUsername" className="block text-[15px] font-medium text-ink">
        Your WordPress.org username
      </label>
      <p className="mt-1 text-[14px] leading-relaxed text-ink-muted">
        Optional. It lets the organisers credit you properly afterwards.
      </p>

      <div className="mt-3 flex items-center gap-2">
        <span className="text-[17px] text-ink-faint">@</span>
        <input
          id="wpUsername"
          name="wpUsername"
          type="text"
          inputMode="text"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          placeholder="username"
          className="min-w-0 flex-1 rounded-lg border border-line bg-surface px-3.5 py-3 text-base text-ink placeholder:text-ink-faint"
        />
      </div>

      {state.status === "error" && (
        <p role="alert" className="mt-2 text-[14px] text-ink">
          {state.message}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="mt-4 w-full rounded-lg bg-wp px-4 py-3 text-base font-medium text-white disabled:opacity-60"
      >
        {pending ? "Saving…" : "Save"}
      </button>
    </form>
  );
}
