"use client";

import { useActionState } from "react";
import { runImport, type ImportState } from "./actions";
import type { ImportSummary } from "@/lib/importAttendees";

const initial: ImportState = { status: "idle" };

export default function ImportForm({ org, event }: { org: string; event: string }) {
  const [state, action, pending] = useActionState(runImport, initial);

  return (
    <div>
      <form action={action} className="rounded-xl border border-line bg-surface p-5">
        <input type="hidden" name="org" value={org} />
        <input type="hidden" name="event" value={event} />

        <label htmlFor="sheet" className="block text-[15px] font-medium text-ink">
          Registration sheet
        </label>
        <p className="mt-1 text-[14px] leading-relaxed text-ink-muted">
          A .csv or .xlsx with one person per row. Columns named Name, Email,
          Phone and College are recognised; anything else is kept as-is and
          shows up as a filter.
        </p>

        <input
          id="sheet"
          name="sheet"
          type="file"
          accept=".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          required
          className="mt-3.5 block w-full text-[14px] text-ink-muted file:mr-3 file:rounded-lg file:border file:border-line file:bg-surface-sunk file:px-3.5 file:py-2 file:text-[14px] file:font-medium file:text-ink"
        />

        <button
          type="submit"
          disabled={pending}
          className="mt-4 rounded-lg bg-wp px-5 py-2.5 text-base font-medium text-white transition-colors hover:bg-wp-dark disabled:opacity-60"
        >
          {pending ? "Importing…" : "Import"}
        </button>

        <p className="mt-3 text-[13px] leading-relaxed text-ink-faint">
          Re-importing the same sheet is safe. People already here are updated,
          not duplicated, and their attendance is never touched.
        </p>
      </form>

      {state.status === "error" && (
        <p
          role="alert"
          className="mt-4 rounded-lg border border-orange/40 bg-orange/5 px-4 py-3 text-[14px] text-ink"
        >
          {state.message}
        </p>
      )}

      {state.status === "done" && <Result summary={state.summary} />}
    </div>
  );
}

function Result({ summary }: { summary: ImportSummary }) {
  const counts = [
    { label: "Added", value: summary.inserted },
    { label: "Updated", value: summary.updated },
    { label: "Duplicates skipped", value: summary.skippedDuplicate },
    { label: "Rows with problems", value: summary.skippedInvalid },
  ];

  return (
    <div className="mt-5 rounded-xl border border-line bg-surface p-5">
      <h2 className="text-[15px] font-medium text-ink">
        {summary.totalRows} rows read
      </h2>

      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2.5 sm:grid-cols-4">
        {counts.map((c) => (
          <div key={c.label}>
            <dt className="text-[13px] text-ink-faint">{c.label}</dt>
            <dd className="text-[20px] font-semibold text-ink tabular">{c.value}</dd>
          </div>
        ))}
      </dl>

      {summary.institutionsCreated > 0 && (
        <p className="mt-3 text-[14px] text-ink-muted">
          {summary.institutionsCreated} new college
          {summary.institutionsCreated === 1 ? "" : "s"} added. Check for
          different spellings of the same one and merge them.
        </p>
      )}

      {summary.notInSheet.length > 0 && (
        <div className="mt-4 border-t border-line-soft pt-4">
          <h3 className="text-[14px] font-medium text-ink">
            {summary.notInSheet.length} already here but not in this sheet
          </h3>
          <p className="mt-1 text-[13px] leading-relaxed text-ink-muted">
            Compared against {summary.scopedTo.join(", ")} only — a sheet for
            one college says nothing about another. Nothing has been removed;
            this is here so you can see the difference and decide.
          </p>
          <ul className="mt-2.5 space-y-1.5">
            {summary.notInSheet.map((p) => (
              <li key={p.id} className="text-[13px] leading-relaxed text-ink-muted">
                <span className="text-ink">{p.name}</span>
                {p.email ? ` · ${p.email}` : ""}
                {p.attended && (
                  <span className="ml-1.5 text-ink-faint">— was marked present</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {summary.details.length > 0 && (
        <div className="mt-4 border-t border-line-soft pt-4">
          <h3 className="text-[14px] font-medium text-ink">Rows not imported</h3>
          <ul className="mt-2 space-y-1.5">
            {summary.details.map((d, i) => (
              <li key={i} className="text-[13px] leading-relaxed text-ink-muted">
                <span className="tabular text-ink">Row {d.row}</span>
                {d.name ? ` · ${d.name}` : ""} — {d.reason}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
