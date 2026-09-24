"use client";

import Link from "next/link";
import { useActionState } from "react";
import { resendConfirmation, signUp, type SignupState } from "./actions";

const idle: SignupState = { status: "idle" };

const field =
  "mt-1.5 w-full rounded-lg border border-line bg-surface px-3.5 py-3 text-base text-ink placeholder:text-ink-faint";
const label = "block text-[13px] font-medium text-ink-muted";
const primary =
  "w-full rounded-lg bg-wp px-4 py-3 text-base font-medium text-white transition-colors hover:bg-wp-dark disabled:opacity-60";

type Mode = "create" | "expired" | "unconfirmed";

export default function SignupForm({
  next,
  mode,
  forInvite,
}: {
  next: string;
  mode: Mode;
  forInvite: boolean;
}) {
  const [created, createAction, creating] = useActionState(signUp, idle);
  const [resent, resendAction, resending] = useActionState(resendConfirmation, idle);

  // Whichever form last sent an email owns the screen.
  const sent = resent.status === "sent" ? resent : created.status === "sent" ? created : null;
  if (sent) {
    return <CheckEmail sent={sent} resendAction={resendAction} resending={resending} next={next} />;
  }

  const signInHref = next !== "/dashboard" ? `/login?next=${encodeURIComponent(next)}` : "/login";

  if (mode !== "create") {
    return (
      <>
        <h1 className="text-[28px] leading-tight font-semibold tracking-[-0.02em] text-wp-dark">
          {mode === "expired" ? "That link has expired" : "Confirm your email first"}
        </h1>
        <p className="mt-2 text-[15px] leading-relaxed text-ink-muted">
          {mode === "expired"
            ? "Confirmation links work once and expire after an hour. Enter your email and we’ll send a fresh one."
            : "Your account is waiting for you to open the link we emailed. Didn’t get it? Send it again."}
        </p>
        <form action={resendAction} className="mt-8 space-y-4">
          <input type="hidden" name="next" value={next} />
          <div>
            <label htmlFor="email" className={label}>Email</label>
            <input id="email" name="email" type="email" autoComplete="email" autoFocus required className={field} />
          </div>
          <Alert state={resent} />
          <button type="submit" disabled={resending} className={primary}>
            {resending ? "Sending…" : "Send a new link"}
          </button>
        </form>
        <p className="mt-8 text-[14px] text-ink-muted">
          Already confirmed?{" "}
          <Link href={signInHref} className="font-medium text-wp underline-offset-2 hover:underline">
            Sign in
          </Link>
        </p>
      </>
    );
  }

  return (
    <>
      <h1 className="text-[28px] leading-tight font-semibold tracking-[-0.02em] text-wp-dark">
        Create your account
      </h1>
      <p className="mt-2 text-[15px] leading-relaxed text-ink-muted">
        {forInvite
          ? "Once you confirm your email, you’ll come straight back to your invite."
          : "Use the email your organiser knows you by."}
      </p>

      <form action={createAction} className="mt-8 space-y-4">
        <input type="hidden" name="next" value={next} />
        <div>
          <label htmlFor="email" className={label}>Email</label>
          <input id="email" name="email" type="email" autoComplete="email" autoFocus required className={field} />
        </div>
        <div>
          <label htmlFor="password" className={label}>Password</label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="new-password"
            minLength={8}
            required
            aria-describedby="password-hint"
            className={field}
          />
          <p id="password-hint" className="mt-1.5 text-[13px] text-ink-faint">
            At least 8 characters.
          </p>
        </div>
        <Alert state={created} />
        <button type="submit" disabled={creating} className={primary}>
          {creating ? "Creating account…" : "Create account"}
        </button>
      </form>

      <p className="mt-8 text-[14px] text-ink-muted">
        Already have an account?{" "}
        <Link href={signInHref} className="font-medium text-wp underline-offset-2 hover:underline">
          Sign in
        </Link>
      </p>
    </>
  );
}

function CheckEmail({
  sent,
  resendAction,
  resending,
  next,
}: {
  sent: Extract<SignupState, { status: "sent" }>;
  resendAction: (formData: FormData) => void;
  resending: boolean;
  next: string;
}) {
  return (
    <div role="status" aria-live="polite">
      <h1 className="text-[28px] leading-tight font-semibold tracking-[-0.02em] text-wp-dark">
        Check your email
      </h1>
      <p className="mt-3 text-[15px] text-ink-muted">We sent a confirmation link to</p>
      <p className="mt-1 rounded-lg bg-wp-pale px-3.5 py-3 text-[17px] font-medium break-all text-wp-dark">
        {sent.email}
      </p>
      <p className="mt-4 text-[15px] leading-relaxed text-ink-muted">
        Open it to finish setting up. It works on any device, so tapping it on your phone is fine.
        The link expires in an hour.
      </p>

      {sent.resent && (
        <p className="mt-4 text-[14px] text-ink">A new link is on its way. Only the newest one works.</p>
      )}

      <form action={resendAction} className="mt-8">
        <input type="hidden" name="email" value={sent.email} />
        <input type="hidden" name="next" value={next} />
        <p className="text-[14px] text-ink-muted">
          Nothing after a few minutes? Check spam, then{" "}
          <button
            type="submit"
            disabled={resending}
            className="font-medium text-wp underline-offset-2 hover:underline disabled:opacity-60"
          >
            {resending ? "sending…" : "send it again"}
          </button>
          .
        </p>
      </form>

      <p className="mt-4 text-[14px] text-ink-muted">
        Wrong address?{" "}
        <a
          href={next !== "/dashboard" ? `/signup?next=${encodeURIComponent(next)}` : "/signup"}
          className="font-medium text-wp underline-offset-2 hover:underline"
        >
          Start again
        </a>
      </p>
    </div>
  );
}

function Alert({ state }: { state: SignupState }) {
  if (state.status !== "error") return null;
  return (
    <p role="alert" className="rounded-lg border border-orange/30 bg-orange/5 px-3.5 py-2.5 text-[14px] text-ink">
      {state.message}
    </p>
  );
}
