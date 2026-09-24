"use client";

import { useActionState, useState } from "react";
import { addCollege, deleteCollege, updateCollege, type CollegeState } from "./actions";

export type College = {
  id: string;
  name: string;
  shortName: string | null;
  attendees: number;
  mergedIntoName: string | null;
};

const initial: CollegeState = { status: "idle" };

export default function CollegeManager({
  org,
  colleges,
}: {
  org: string;
  colleges: College[];
}) {
  const [addState, addAction, adding] = useActionState(addCollege, initial);
  const [editing, setEditing] = useState<string | null>(null);

  const active = colleges.filter((c) => !c.mergedIntoName);

  return (
    <div className="space-y-6">
      <form action={addAction} className="rounded-xl border border-line bg-surface p-5">
        <input type="hidden" name="org" value={org} />
        <h2 className="text-[15px] font-medium text-ink">Add a college</h2>
        <p className="mt-1 text-[14px] leading-relaxed text-ink-muted">
          Importing a sheet adds these automatically. Add one by hand when you
          need it before the roster arrives.
        </p>

        <div className="mt-3.5 space-y-3">
          <div>
            <label htmlFor="name" className="block text-[13px] font-medium text-ink-muted">
              Full name
            </label>
            <input
              id="name"
              name="name"
              required
              placeholder="J.P. Dawer Institute of Information Science and Technology (VNSGU)"
              className="mt-1.5 w-full rounded-lg border border-line bg-surface px-3.5 py-2.5 text-base text-ink placeholder:text-ink-faint"
            />
          </div>
          <div>
            <label htmlFor="shortName" className="block text-[13px] font-medium text-ink-muted">
              Short name
            </label>
            <input
              id="shortName"
              name="shortName"
              placeholder="VNSGU"
              className="mt-1.5 w-full rounded-lg border border-line bg-surface px-3.5 py-2.5 text-base text-ink placeholder:text-ink-faint"
            />
            <p className="mt-1.5 text-[13px] text-ink-faint">
              What appears next to a name on a phone. Optional, but a long name
              is unreadable there.
            </p>
          </div>
        </div>

        {addState.status === "error" && (
          <p role="alert" className="mt-3 text-[14px] text-ink">
            {addState.message}
          </p>
        )}

        <button
          type="submit"
          disabled={adding}
          className="mt-4 rounded-lg bg-wp px-5 py-2.5 text-base font-medium text-white disabled:opacity-60"
        >
          {adding ? "Adding…" : "Add college"}
        </button>
      </form>

      <section>
        <h2 className="text-[15px] font-medium text-ink">
          {active.length} {active.length === 1 ? "college" : "colleges"}
        </h2>

        {active.length === 0 ? (
          <p className="mt-2 text-[14px] text-ink-muted">
            None yet. Add one above, or import a sheet.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-line-soft overflow-hidden rounded-xl border border-line bg-surface">
            {active.map((c) =>
              editing === c.id ? (
                <li key={c.id} className="px-4 py-3">
                  <CollegeEditor
                    org={org}
                    college={c}
                    onDone={() => setEditing(null)}
                  />
                </li>
              ) : (
                <li key={c.id} className="flex items-baseline justify-between gap-3 px-4 py-3">
                  <span className="min-w-0">
                    <span className="block text-[15px] text-ink">{c.name}</span>
                    {c.shortName && (
                      <span className="mt-0.5 block text-[13px] text-ink-faint">
                        Shown as {c.shortName}
                      </span>
                    )}
                  </span>
                  <span className="flex shrink-0 items-baseline gap-3">
                    <span className="text-[13px] text-ink-faint tabular">{c.attendees}</span>
                    <button
                      type="button"
                      onClick={() => setEditing(c.id)}
                      className="rounded-md px-2 py-1 text-[13px] text-wp hover:text-wp-dark"
                    >
                      Edit
                    </button>
                  </span>
                </li>
              )
            )}
          </ul>
        )}
      </section>

    </div>
  );
}

/**
 * Editing in place rather than on a separate screen: there is nothing else to
 * say about a college, and a round trip to its own page for two fields would
 * be more chrome than content.
 */
function CollegeEditor({
  org,
  college,
  onDone,
}: {
  org: string;
  college: College;
  onDone: () => void;
}) {
  const [saveState, saveAction, saving] = useActionState(updateCollege, initial);
  const [removeState, removeAction, removing] = useActionState(deleteCollege, initial);
  const error =
    saveState.status === "error"
      ? saveState.message
      : removeState.status === "error"
        ? removeState.message
        : null;

  return (
    <div>
      <form action={saveAction} className="space-y-3">
        <input type="hidden" name="org" value={org} />
        <input type="hidden" name="id" value={college.id} />

        <div>
          <label
            htmlFor={`name-${college.id}`}
            className="block text-[13px] font-medium text-ink-muted"
          >
            Full name
          </label>
          <input
            id={`name-${college.id}`}
            name="name"
            required
            defaultValue={college.name}
            autoFocus
            className="mt-1.5 w-full rounded-lg border border-line bg-surface px-3.5 py-2.5 text-base text-ink"
          />
        </div>

        <div>
          <label
            htmlFor={`short-${college.id}`}
            className="block text-[13px] font-medium text-ink-muted"
          >
            Short name
          </label>
          <input
            id={`short-${college.id}`}
            name="shortName"
            defaultValue={college.shortName ?? ""}
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

      {college.attendees === 0 && (
        <form action={removeAction} className="mt-3 border-t border-line-soft pt-3">
          <input type="hidden" name="org" value={org} />
          <input type="hidden" name="id" value={college.id} />
          <button
            type="submit"
            disabled={removing}
            className="text-[13px] text-orange hover:underline disabled:opacity-60"
          >
            {removing ? "Removing…" : "Remove this college"}
          </button>
          <p className="mt-1 text-[13px] text-ink-faint">
            Only while nobody is attached to it.
          </p>
        </form>
      )}
    </div>
  );
}
