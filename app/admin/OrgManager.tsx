"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import {
  createOrganization,
  deleteOrganization,
  updateOrganization,
  type OrgState,
} from "./actions";
import { slugify } from "@/lib/slug";

export type OrgRow = {
  id: string;
  slug: string;
  name: string;
  events: number;
  attendees: number;
  present: number;
};

const initial: OrgState = { status: "idle" };

export default function OrgManager({ orgs }: { orgs: OrgRow[] }) {
  const [state, action, pending] = useActionState(createOrganization, initial);
  const [editing, setEditing] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");

  const preview = slug ? slugify(slug) : slugify(name);

  return (
    <div className="space-y-6">
      <section>
        <h2 className="text-[15px] font-medium text-ink">
          {orgs.length} {orgs.length === 1 ? "organisation" : "organisations"}
        </h2>

        {orgs.length === 0 ? (
          <p className="mt-2 text-[14px] text-ink-muted">
            None yet. Create the first one below.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-line-soft overflow-hidden rounded-xl border border-line bg-surface">
            {orgs.map((o) =>
              editing === o.id ? (
                <li key={o.slug} className="px-4 py-3">
                  <OrgEditor org={o} onDone={() => setEditing(null)} />
                </li>
              ) : (
                <li key={o.slug} className="flex items-center gap-1 pr-3">
                  <Link
                    href={`/o/${o.slug}`}
                    className="flex min-h-[64px] w-full min-w-0 flex-1 items-center justify-between gap-3 px-4 py-3 hover:bg-wp-pale/40"
                  >
                    <span className="min-w-0">
                      <span className="block text-[16px] font-medium text-ink">
                        {o.name}
                      </span>
                      <span className="mt-0.5 block text-[13px] text-ink-faint">
                        /o/{o.slug}
                      </span>
                    </span>
                    <span className="shrink-0 text-right text-[13px] text-ink-muted tabular">
                      <span className="block">
                        {o.events} {o.events === 1 ? "event" : "events"}
                      </span>
                      <span className="block">{o.attendees} registered</span>
                    </span>
                  </Link>
                  <button
                    type="button"
                    onClick={() => setEditing(o.id)}
                    className="shrink-0 rounded-md px-2 py-1 text-[13px] text-wp hover:text-wp-dark"
                  >
                    Edit
                  </button>
                </li>
              )
            )}
          </ul>
        )}

        <p className="mt-3 text-[13px] leading-relaxed text-ink-faint">
          Open one to add colleges or create events. Attendee lists stay with
          the people who run it — the event screens are closed to you unless
          its owner adds you.
        </p>
      </section>

      <form action={action} className="rounded-xl border border-line bg-surface p-5">
        <h2 className="text-[15px] font-medium text-ink">Create an organisation</h2>

        <div className="mt-3.5 space-y-3">
          <div>
            <label htmlFor="name" className="block text-[13px] font-medium text-ink-muted">
              Name
            </label>
            <input
              id="name"
              name="name"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="WordPress Campus Connect Pune"
              className="mt-1.5 w-full rounded-lg border border-line bg-surface px-3.5 py-2.5 text-base text-ink placeholder:text-ink-faint"
            />
          </div>

          <div>
            <label htmlFor="slug" className="block text-[13px] font-medium text-ink-muted">
              Link
            </label>
            <input
              id="slug"
              name="slug"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              placeholder={slugify(name) || "wpcc-pune"}
              className="mt-1.5 w-full rounded-lg border border-line bg-surface px-3.5 py-2.5 text-base text-ink placeholder:text-ink-faint"
            />
            <p className="mt-1.5 break-all text-[13px] text-ink-faint">
              /o/{preview || "…"}
            </p>
          </div>

          <div>
            <label htmlFor="ownerEmail" className="block text-[13px] font-medium text-ink-muted">
              Owner
            </label>
            <input
              id="ownerEmail"
              name="ownerEmail"
              type="email"
              required
              placeholder="them@example.com"
              className="mt-1.5 w-full rounded-lg border border-line bg-surface px-3.5 py-2.5 text-base text-ink placeholder:text-ink-faint"
            />
            <p className="mt-1.5 text-[13px] leading-relaxed text-ink-faint">
              They need to have signed in once, so there is an account to
              attach. They run the organisation from there — you don&rsquo;t.
            </p>
          </div>
        </div>

        {state.status === "error" && (
          <p role="alert" className="mt-3 text-[14px] text-ink">
            {state.message}
          </p>
        )}

        <button
          type="submit"
          disabled={pending}
          className="mt-4 rounded-lg bg-wp px-5 py-2.5 text-base font-medium text-white disabled:opacity-60"
        >
          {pending ? "Creating…" : "Create organisation"}
        </button>
      </form>
    </div>
  );
}

function OrgEditor({ org, onDone }: { org: OrgRow; onDone: () => void }) {
  const [saveState, saveAction, saving] = useActionState(updateOrganization, initial);
  const [delState, delAction, deleting] = useActionState(deleteOrganization, initial);
  const [slug, setSlug] = useState(org.slug);

  const error =
    saveState.status === "error"
      ? saveState.message
      : delState.status === "error"
        ? delState.message
        : null;

  // No events and nobody registered. The server re-checks before deleting —
  // this page may have been open while somebody imported a roster.
  const empty = org.events === 0 && org.attendees === 0;

  return (
    <div>
      <form action={saveAction} className="space-y-3">
        <input type="hidden" name="id" value={org.id} />

        <div>
          <label htmlFor={`oname-${org.id}`} className="block text-[13px] font-medium text-ink-muted">
            Name
          </label>
          <input
            id={`oname-${org.id}`}
            name="name"
            required
            defaultValue={org.name}
            autoFocus
            className="mt-1.5 w-full rounded-lg border border-line bg-surface px-3.5 py-2.5 text-base text-ink"
          />
        </div>

        <div>
          <label htmlFor={`oslug-${org.id}`} className="block text-[13px] font-medium text-ink-muted">
            Link
          </label>
          <input
            id={`oslug-${org.id}`}
            name="slug"
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            className="mt-1.5 w-full rounded-lg border border-line bg-surface px-3.5 py-2.5 text-base text-ink"
          />
          <p className="mt-1.5 break-all text-[13px] text-ink-faint">/o/{slugify(slug) || "…"}</p>
          {slugify(slug) !== org.slug && (
            <p className="mt-1 text-[13px] text-ink-muted">
              Every link into this organisation changes, including its events.
            </p>
          )}
        </div>

        {error && (
          <p role="alert" className="text-[14px] text-ink">
            {error}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="submit"
            disabled={saving}
            onClick={() => setTimeout(onDone, 0)}
            className="rounded-lg bg-wp px-4 py-2.5 text-[15px] font-medium text-white disabled:opacity-60"
          >
            {saving ? "Saving…" : "Save"}
          </button>
          <button
            type="button"
            onClick={onDone}
            className="rounded-lg border border-line bg-surface px-4 py-2.5 text-[15px] font-medium text-ink-muted"
          >
            Cancel
          </button>
        </div>
      </form>

      <div className="mt-3 border-t border-line-soft pt-3">
        {empty ? (
          <form action={delAction}>
            <input type="hidden" name="id" value={org.id} />
            <button
              type="submit"
              disabled={deleting}
              className="text-[13px] text-orange hover:underline disabled:opacity-60"
            >
              {deleting ? "Removing…" : "Delete this organisation"}
            </button>
            <p className="mt-1 text-[13px] text-ink-faint">
              Only while it has no events and nobody registered.
            </p>
          </form>
        ) : (
          <p className="text-[13px] text-ink-faint">
            This has {org.events} {org.events === 1 ? "event" : "events"} and{" "}
            {org.attendees} registered, so it can&rsquo;t be deleted. Deleting
            one takes its attendees and their attendance with it.
          </p>
        )}
      </div>
    </div>
  );
}
