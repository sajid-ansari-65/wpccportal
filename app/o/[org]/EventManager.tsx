"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import {
  createEvent,
  deleteEvent,
  setEventArchived,
  updateEvent,
  type EventState,
} from "./actions";
import { slugify } from "@/lib/slug";

export type EventRow = {
  id: string;
  slug: string;
  name: string;
  timezone: string;
  attendees: number;
  present: number;
  archived: boolean;
};

const initial: EventState = { status: "idle" };

export default function EventManager({
  org,
  events,
  canOpenEvents,
}: {
  org: string;
  events: EventRow[];
  /** False for the platform operator: the event screens handle attendees, and
   *  they have no access there. A link that 404s is worse than no link. */
  canOpenEvents: boolean;
}) {
  const [state, action, pending] = useActionState(createEvent, initial);
  const [editing, setEditing] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");

  const preview = slug ? slugify(slug) : slugify(name);

  return (
    <div className="space-y-6">
      <section>
        <h2 className="text-[15px] font-medium text-ink">
          {events.length} {events.length === 1 ? "event" : "events"}
        </h2>

        {events.length === 0 ? (
          <p className="mt-2 text-[14px] text-ink-muted">
            None yet. Create one below and import your roster into it.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-line-soft overflow-hidden rounded-xl border border-line bg-surface">
            {events.map((e) => {
              if (editing === e.id) {
                return (
                  <li key={e.slug} className="px-4 py-3">
                    <EventEditor
                      org={org}
                      event={e}
                      onDone={() => setEditing(null)}
                    />
                  </li>
                );
              }

              const body = (
                <>
                  <span className="min-w-0">
                    <span className="block text-[16px] font-medium text-ink">
                      {e.name}
                      {e.archived && (
                        <span className="ml-2 align-middle text-[12px] font-normal text-ink-faint">
                          Archived
                        </span>
                      )}
                    </span>
                    <span className="mt-0.5 block text-[13px] text-ink-faint">
                      /{e.slug}
                    </span>
                  </span>
                  {/* Labelled, not "0 / 1". The bare ratio reads as "nobody
                      is in this" to anyone who does not already know the
                      convention — and then the missing delete button makes no
                      sense. */}
                  <span className="shrink-0 text-right text-[13px] text-ink-muted tabular">
                    <span className="block">
                      {e.attendees} registered
                    </span>
                    {e.attendees > 0 && (
                      <span className="block text-ink-faint">{e.present} present</span>
                    )}
                  </span>
                </>
              );
              const shared =
                "flex min-h-[64px] w-full min-w-0 items-center justify-between gap-3 px-4 py-3";

              return (
                <li key={e.slug} className="flex items-center gap-1 pr-3">
                  {canOpenEvents ? (
                    <Link
                      href={`/e/${org}/${e.slug}/admin`}
                      className={`${shared} flex-1 hover:bg-wp-pale/40`}
                    >
                      {body}
                    </Link>
                  ) : (
                    <div className={`${shared} flex-1`}>{body}</div>
                  )}
                  <button
                    type="button"
                    onClick={() => setEditing(e.id)}
                    className="shrink-0 rounded-md px-2 py-1 text-[13px] text-wp hover:text-wp-dark"
                  >
                    Edit
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <form action={action} className="rounded-xl border border-line bg-surface p-5">
        <input type="hidden" name="org" value={org} />
        <h2 className="text-[15px] font-medium text-ink">Create an event</h2>

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
              placeholder="WPCC Surat 2027"
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
              placeholder={slugify(name) || "surat-2027"}
              className="mt-1.5 w-full rounded-lg border border-line bg-surface px-3.5 py-2.5 text-base text-ink placeholder:text-ink-faint"
            />
            <p className="mt-1.5 break-all text-[13px] text-ink-faint">
              /e/{org}/{preview || "…"}
            </p>
          </div>

          <div>
            <label htmlFor="timezone" className="block text-[13px] font-medium text-ink-muted">
              Timezone
            </label>
            <input
              id="timezone"
              name="timezone"
              defaultValue="Asia/Kolkata"
              className="mt-1.5 w-full rounded-lg border border-line bg-surface px-3.5 py-2.5 text-base text-ink"
            />
            <p className="mt-1.5 text-[13px] leading-relaxed text-ink-faint">
              Session times are read in this zone. &ldquo;10:00&rdquo; should
              mean 10:00 at the venue, not wherever you happen to be.
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
          {pending ? "Creating…" : "Create event"}
        </button>
      </form>
    </div>
  );
}

function EventEditor({
  org,
  event,
  onDone,
}: {
  org: string;
  event: EventRow;
  onDone: () => void;
}) {
  const [saveState, saveAction, saving] = useActionState(updateEvent, initial);
  const [archState, archAction, archiving] = useActionState(setEventArchived, initial);
  const [delState, delAction, deleting] = useActionState(deleteEvent, initial);
  const [slug, setSlug] = useState(event.slug);

  const error =
    saveState.status === "error"
      ? saveState.message
      : archState.status === "error"
        ? archState.message
        : delState.status === "error"
          ? delState.message
          : null;

  return (
    <div>
      <form action={saveAction} className="space-y-3">
        <input type="hidden" name="org" value={org} />
        <input type="hidden" name="id" value={event.id} />

        <div>
          <label htmlFor={`ename-${event.id}`} className="block text-[13px] font-medium text-ink-muted">
            Name
          </label>
          <input
            id={`ename-${event.id}`}
            name="name"
            required
            defaultValue={event.name}
            autoFocus
            className="mt-1.5 w-full rounded-lg border border-line bg-surface px-3.5 py-2.5 text-base text-ink"
          />
        </div>

        <div>
          <label htmlFor={`eslug-${event.id}`} className="block text-[13px] font-medium text-ink-muted">
            Link
          </label>
          <input
            id={`eslug-${event.id}`}
            name="slug"
            value={slug}
            onChange={(ev) => setSlug(ev.target.value)}
            className="mt-1.5 w-full rounded-lg border border-line bg-surface px-3.5 py-2.5 text-base text-ink"
          />
          <p className="mt-1.5 break-all text-[13px] text-ink-faint">
            /e/{org}/{slugify(slug) || "…"}
          </p>
          {slugify(slug) !== event.slug && (
            <p className="mt-1 text-[13px] text-ink-muted">
              Changing this breaks any bookmark or printed link pointing at the
              old address.
            </p>
          )}
        </div>

        <div>
          <label htmlFor={`etz-${event.id}`} className="block text-[13px] font-medium text-ink-muted">
            Timezone
          </label>
          <input
            id={`etz-${event.id}`}
            name="timezone"
            defaultValue={event.timezone}
            className="mt-1.5 w-full rounded-lg border border-line bg-surface px-3.5 py-2.5 text-base text-ink"
          />
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

      <div className="mt-3 space-y-2 border-t border-line-soft pt-3">
        <form action={archAction}>
          <input type="hidden" name="org" value={org} />
          <input type="hidden" name="id" value={event.id} />
          <input type="hidden" name="archived" value={event.archived ? "false" : "true"} />
          <button
            type="submit"
            disabled={archiving}
            className="text-[13px] text-ink-muted hover:text-ink disabled:opacity-60"
          >
            {archiving
              ? "Working…"
              : event.archived
                ? "Bring this event back"
                : "Archive this event"}
          </button>
        </form>

        {/* Delete exists only for an event nobody is in — a typo, or a second
            attempt at creating one. Anything with a roster archives instead,
            because deleting an event takes every attendee and every mark with
            it, silently and with no error to notice. */}
        {event.attendees === 0 ? (
          <form action={delAction}>
            <input type="hidden" name="org" value={org} />
            <input type="hidden" name="id" value={event.id} />
            <button
              type="submit"
              disabled={deleting}
              className="text-[13px] text-orange hover:underline disabled:opacity-60"
            >
              {deleting ? "Removing…" : "Delete this event"}
            </button>
          </form>
        ) : (
          <p className="text-[13px] text-ink-faint">
            {event.attendees === 1
              ? "1 person is in this event, so it can be archived but not deleted."
              : `${event.attendees} people are in this event, so it can be archived but not deleted.`}
          </p>
        )}
      </div>
    </div>
  );
}
