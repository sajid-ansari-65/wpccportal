"use client";

import { useActionState, useState } from "react";
import { createInvite, removeMember, revokeInvite, type TeamState } from "./actions";

export type Member = {
  userId: string;
  email: string;
  role: string;
  eventId: string | null;
  eventName: string | null;
  isYou: boolean;
};

export type Invite = {
  id: string;
  token: string;
  role: string;
  email: string | null;
  eventName: string | null;
  expiresAt: string | null;
  maxUses: number;
  usedCount: number;
};

export type EventOption = { id: string; name: string };

const initial: TeamState = { status: "idle" };

export default function TeamManager({
  org,
  origin,
  isOwner,
  members,
  invites,
  events,
}: {
  org: string;
  origin: string;
  isOwner: boolean;
  members: Member[];
  invites: Invite[];
  events: EventOption[];
}) {
  const [inviteState, inviteAction, inviting] = useActionState(createInvite, initial);
  const [revokeState, revokeAction] = useActionState(revokeInvite, initial);
  const [removeState, removeAction] = useActionState(removeMember, initial);
  const [role, setRole] = useState("volunteer");
  const [bound, setBound] = useState(false);

  const err =
    inviteState.status === "error"
      ? inviteState.message
      : revokeState.status === "error"
        ? revokeState.message
        : removeState.status === "error"
          ? removeState.message
          : null;

  return (
    <div className="space-y-6">
      <section>
        <h2 className="text-[15px] font-medium text-ink">
          {members.length} {members.length === 1 ? "person" : "people"}
        </h2>
        <ul className="mt-3 divide-y divide-line-soft overflow-hidden rounded-xl border border-line bg-surface">
          {members.map((m) => (
            <li
              key={`${m.userId}-${m.eventId ?? "org"}`}
              className="flex items-center justify-between gap-3 px-4 py-3"
            >
              <span className="min-w-0">
                <span className="block text-[15px] text-ink">
                  {m.email}
                  {m.isYou && <span className="ml-2 text-[13px] text-ink-faint">you</span>}
                </span>
                <span className="mt-0.5 block text-[13px] text-ink-faint">
                  {roleLabel(m.role)}
                  {m.eventName ? ` · ${m.eventName}` : ""}
                </span>
              </span>
              {!m.isYou && (
                <form action={removeAction} className="shrink-0">
                  <input type="hidden" name="org" value={org} />
                  <input type="hidden" name="userId" value={m.userId} />
                  <input type="hidden" name="eventId" value={m.eventId ?? ""} />
                  <button
                    type="submit"
                    className="rounded-md px-2 py-1 text-[13px] text-orange hover:underline"
                  >
                    Remove
                  </button>
                </form>
              )}
            </li>
          ))}
        </ul>
        {members.some((m) => m.isYou) && (
          <p className="mt-2 text-[13px] text-ink-faint">
            You can&rsquo;t remove yourself, and an organisation always keeps at
            least one owner.
          </p>
        )}
      </section>

      {err && (
        <p role="alert" className="rounded-lg border border-orange/40 bg-orange/5 px-4 py-3 text-[14px] text-ink">
          {err}
        </p>
      )}

      <form action={inviteAction} className="rounded-xl border border-line bg-surface p-5">
        <input type="hidden" name="org" value={org} />
        <h2 className="text-[15px] font-medium text-ink">Invite someone</h2>

        <div className="mt-3.5 space-y-3">
          <div>
            <label htmlFor="role" className="block text-[13px] font-medium text-ink-muted">
              Role
            </label>
            <select
              id="role"
              name="role"
              value={role}
              onChange={(e) => setRole(e.target.value)}
              className="mt-1.5 w-full rounded-lg border border-line bg-surface px-3 py-2.5 text-base text-ink"
            >
              <option value="volunteer">Volunteer — marks attendance at one event</option>
              <option value="admin">Admin — imports, exports and manages the organisation</option>
              {isOwner && <option value="owner">Owner — everything, including adding owners</option>}
            </select>
          </div>

          {role === "volunteer" && (
            <div>
              <label htmlFor="eventId" className="block text-[13px] font-medium text-ink-muted">
                Which event
              </label>
              <select
                id="eventId"
                name="eventId"
                required
                className="mt-1.5 w-full rounded-lg border border-line bg-surface px-3 py-2.5 text-base text-ink"
              >
                {events.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                  </option>
                ))}
              </select>
              <p className="mt-1.5 text-[13px] text-ink-faint">
                They see this event and nothing else in the organisation.
              </p>
            </div>
          )}

          <fieldset>
            <legend className="text-[13px] font-medium text-ink-muted">How they join</legend>
            <div className="mt-2 space-y-2">
              <label className="flex items-start gap-2.5 text-[15px] text-ink">
                <input
                  type="radio"
                  checked={!bound}
                  onChange={() => setBound(false)}
                  className="mt-1 h-4 w-4 accent-[var(--wp-blue)]"
                />
                <span>
                  A link anyone can use
                  <span className="mt-0.5 block text-[13px] text-ink-faint">
                    Send it on WhatsApp. Whoever opens it joins with this role,
                    so keep the expiry short.
                  </span>
                </span>
              </label>
              <label className="flex items-start gap-2.5 text-[15px] text-ink">
                <input
                  type="radio"
                  checked={bound}
                  onChange={() => setBound(true)}
                  className="mt-1 h-4 w-4 accent-[var(--wp-blue)]"
                />
                <span>
                  Only one email address
                  <span className="mt-0.5 block text-[13px] text-ink-faint">
                    A forwarded link is useless to anyone else.
                  </span>
                </span>
              </label>
            </div>
          </fieldset>

          {bound && (
            <div>
              <label htmlFor="email" className="block text-[13px] font-medium text-ink-muted">
                Their email
              </label>
              <input
                id="email"
                name="email"
                type="email"
                required
                placeholder="them@example.com"
                className="mt-1.5 w-full rounded-lg border border-line bg-surface px-3.5 py-2.5 text-base text-ink placeholder:text-ink-faint"
              />
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="days" className="block text-[13px] font-medium text-ink-muted">
                Expires in
              </label>
              <select
                id="days"
                name="days"
                defaultValue="7"
                className="mt-1.5 w-full rounded-lg border border-line bg-surface px-3 py-2.5 text-base text-ink"
              >
                <option value="1">1 day</option>
                <option value="7">7 days</option>
                <option value="30">30 days</option>
              </select>
            </div>
            {!bound && (
              <div>
                <label htmlFor="maxUses" className="block text-[13px] font-medium text-ink-muted">
                  Can be used
                </label>
                <select
                  id="maxUses"
                  name="maxUses"
                  defaultValue="10"
                  className="mt-1.5 w-full rounded-lg border border-line bg-surface px-3 py-2.5 text-base text-ink"
                >
                  <option value="1">once</option>
                  <option value="10">10 times</option>
                  <option value="50">50 times</option>
                </select>
              </div>
            )}
          </div>
        </div>

        <button
          type="submit"
          disabled={inviting}
          className="mt-4 rounded-lg bg-wp px-5 py-2.5 text-base font-medium text-white disabled:opacity-60"
        >
          {inviting ? "Creating…" : "Create invite"}
        </button>
      </form>

      {invites.length > 0 && (
        <section>
          <h2 className="text-[15px] font-medium text-ink">Open invites</h2>
          <ul className="mt-3 space-y-3">
            {invites.map((i) => (
              <li key={i.id} className="rounded-xl border border-line bg-surface p-4">
                <p className="text-[14px] text-ink">
                  {roleLabel(i.role)}
                  {i.eventName ? ` · ${i.eventName}` : ""}
                  {i.email ? ` · ${i.email} only` : ""}
                </p>
                <p className="mt-0.5 text-[13px] text-ink-faint tabular">
                  Used {i.usedCount} of {i.maxUses}
                  {i.expiresAt ? ` · expires ${new Date(i.expiresAt).toLocaleDateString()}` : ""}
                </p>
                <CopyLink url={`${origin}/join/${i.token}`} />
                <form action={revokeAction} className="mt-2">
                  <input type="hidden" name="org" value={org} />
                  <input type="hidden" name="id" value={i.id} />
                  <button type="submit" className="text-[13px] text-orange hover:underline">
                    Revoke
                  </button>
                </form>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function roleLabel(role: string) {
  return role === "volunteer" ? "Volunteer" : role === "admin" ? "Admin" : "Owner";
}

/** The link is the thing being sent, so it has to be selectable and copyable
 *  without hunting — this is the one action every invite ends with. */
function CopyLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="mt-2.5 flex items-center gap-2">
      <input
        readOnly
        value={url}
        onFocus={(e) => e.currentTarget.select()}
        className="min-w-0 flex-1 rounded-lg border border-line bg-surface-sunk px-3 py-2 text-[13px] text-ink"
      />
      <button
        type="button"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(url);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          } catch {
            // Clipboard is blocked on insecure origins and in some browsers;
            // the field is selectable, so there is always a way.
          }
        }}
        className="shrink-0 rounded-lg border border-line bg-surface px-3 py-2 text-[13px] font-medium text-ink-muted"
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}
