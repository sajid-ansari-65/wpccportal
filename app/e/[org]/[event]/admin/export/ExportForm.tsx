"use client";

import { useMemo, useState } from "react";
import { yearRank } from "@/lib/attendeeSort";

export type ExportRow = {
  present: boolean;
  year: string;
  institutionId: string | null;
  institution: string | null;
};

export default function ExportForm({
  action,
  rows,
}: {
  action: string;
  rows: ExportRow[];
}) {
  const [college, setCollege] = useState("");
  const [year, setYear] = useState("");
  const [scope, setScope] = useState<"present" | "all">("present");

  const colleges = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of rows) {
      if (r.institutionId && r.institution) m.set(r.institutionId, r.institution);
    }
    return [...m].sort((a, b) => a[1].localeCompare(b[1]));
  }, [rows]);

  const years = useMemo(() => {
    const set = new Set(rows.map((r) => r.year).filter(Boolean));
    return [...set].sort((a, b) => yearRank(a) - yearRank(b) || a.localeCompare(b));
  }, [rows]);

  // Counts follow the filters. Static totals next to a college picker would be
  // wrong the moment anyone used it, and a download of the wrong size is only
  // noticed after it has been printed.
  const matching = useMemo(
    () =>
      rows.filter(
        (r) =>
          (!college || r.institutionId === college) && (!year || r.year === year)
      ),
    [rows, college, year]
  );
  const presentCount = matching.filter((r) => r.present).length;

  return (
    <form action={action} className="rounded-xl border border-line bg-surface p-5">
      <h2 className="text-[15px] font-medium text-ink">Download a CSV</h2>
      <p className="mt-1 text-[14px] leading-relaxed text-ink-muted">
        Sorted by year, then name — the order a printed list wants to be in.
      </p>

      {colleges.length > 1 && (
        <div className="mt-4">
          <label htmlFor="college" className="block text-[13px] font-medium text-ink-muted">
            College
          </label>
          <select
            id="college"
            name="college"
            value={college}
            onChange={(e) => setCollege(e.target.value)}
            className="mt-1.5 w-full rounded-lg border border-line bg-surface px-3 py-2.5 text-base text-ink"
          >
            <option value="">All colleges</option>
            {colleges.map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
        </div>
      )}

      {years.length > 1 && (
        <div className="mt-4">
          <label htmlFor="year" className="block text-[13px] font-medium text-ink-muted">
            Year
          </label>
          <select
            id="year"
            name="year"
            value={year}
            onChange={(e) => setYear(e.target.value)}
            className="mt-1.5 w-full rounded-lg border border-line bg-surface px-3 py-2.5 text-base text-ink"
          >
            <option value="">All years</option>
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </div>
      )}

      <fieldset className="mt-4">
        <legend className="text-[13px] font-medium text-ink-muted">Who</legend>
        <div className="mt-2 space-y-2">
          <Radio
            name="scope"
            value="present"
            checked={scope === "present"}
            onChange={() => setScope("present")}
          >
            Present only <span className="tabular">({presentCount})</span>
          </Radio>
          <Radio
            name="scope"
            value="all"
            checked={scope === "all"}
            onChange={() => setScope("all")}
          >
            Everyone registered <span className="tabular">({matching.length})</span>
          </Radio>
        </div>
      </fieldset>

      <button
        type="submit"
        disabled={matching.length === 0}
        className="mt-5 rounded-lg bg-wp px-5 py-2.5 text-base font-medium text-white transition-colors hover:bg-wp-dark disabled:opacity-60"
      >
        Download CSV
      </button>

      {matching.length === 0 && (
        <p className="mt-2 text-[13px] text-ink-faint">
          Nobody matches that combination.
        </p>
      )}
    </form>
  );
}

function Radio({
  name,
  value,
  checked,
  onChange,
  children,
}: {
  name: string;
  value: string;
  checked: boolean;
  onChange: () => void;
  children: React.ReactNode;
}) {
  return (
    <label className="flex items-center gap-2.5 text-[15px] text-ink">
      <input
        type="radio"
        name={name}
        value={value}
        checked={checked}
        onChange={onChange}
        className="h-4 w-4 accent-[var(--wp-blue)]"
      />
      <span>{children}</span>
    </label>
  );
}
