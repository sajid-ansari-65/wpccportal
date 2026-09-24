/**
 * One spelling per year.
 *
 * Two sheets from two colleges write "3rd year" and "3rd Year", and the filter
 * then offers both as separate chips — so tapping one silently hides half the
 * people who are in that year. Normalising at read time rather than rewriting
 * what was imported means existing data is fixed immediately and nothing the
 * organiser typed is destroyed.
 *
 * Words beginning with a digit keep their ordinal suffix lowercase, because
 * "3Rd Year" is worse than the problem.
 */
export function canonicalYear(raw: string): string {
  const t = raw.trim().replace(/\s+/g, " ");
  if (!t) return "";
  return t
    .toLowerCase()
    .split(" ")
    .map((w) => (/^\d/.test(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ");
}

// "3rd Year" < "4th Year" < "Final year" < "Other" < (blank).
// Plain alphabetical would put "4th" before "Final", which reads wrong on a
// printed list.
export function yearRank(year: string): number {
  const t = year.toLowerCase();
  const m = t.match(/(\d)/);
  if (m) return Number(m[1]);
  if (t.includes("final")) return 8;
  if (!t) return 10;
  return 9;
}

export type Sortable = {
  name: string;
  attributes?: Record<string, string> | null;
};

/** Case-insensitive A-Z. The database collation alone puts uppercase and
 *  accented names out of plain alphabetical order, so sorting is done here
 *  rather than relying on `order by`. */
export function compareByName(a: Sortable, b: Sortable): number {
  return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
}

/** Year first (by rank, then alphabetically within a rank), then name. */
export function compareByYearThenName(a: Sortable, b: Sortable): number {
  const ya = (a.attributes?.year ?? "").trim();
  const yb = (b.attributes?.year ?? "").trim();

  const r = yearRank(ya) - yearRank(yb);
  if (r !== 0) return r;

  if (ya !== yb) return ya.localeCompare(yb, undefined, { sensitivity: "base" });
  return compareByName(a, b);
}
