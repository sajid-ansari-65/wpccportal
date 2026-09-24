import { describe, it, expect } from "vitest";
import {
  canonicalYear,
  yearRank,
  compareByName,
  compareByYearThenName,
  type Sortable,
} from "./attendeeSort";

const p = (name: string, year?: string): Sortable => ({
  name,
  attributes: year ? { year } : {},
});

describe("yearRank", () => {
  it("orders numbered years by their number", () => {
    expect(yearRank("3rd Year")).toBeLessThan(yearRank("4th Year"));
  });

  it("puts 'Final year' after any numbered year", () => {
    expect(yearRank("4th Year")).toBeLessThan(yearRank("Final year"));
  });

  it("puts anything unrecognised after 'Final', and blanks last of all", () => {
    expect(yearRank("Final year")).toBeLessThan(yearRank("Other"));
    expect(yearRank("Other")).toBeLessThan(yearRank(""));
  });
});

describe("compareByName", () => {
  it("sorts case-insensitively, which a plain codepoint sort does not", () => {
    const names = ["bhavesh", "Aarti", "Chirag"].sort(
      (a, b) => compareByName({ name: a }, { name: b })
    );
    expect(names.map((n) => n.toLowerCase())).toEqual(["aarti", "bhavesh", "chirag"]);
  });
});

describe("compareByYearThenName", () => {
  it("groups by year rank before name", () => {
    const sorted = [p("Aarti", "Final year"), p("Zoya", "3rd Year")]
      .sort(compareByYearThenName)
      .map((s) => s.name);
    expect(sorted).toEqual(["Zoya", "Aarti"]);
  });

  it("sorts by name within the same year", () => {
    const sorted = [p("Zoya", "3rd Year"), p("Aarti", "3rd Year")]
      .sort(compareByYearThenName)
      .map((s) => s.name);
    expect(sorted).toEqual(["Aarti", "Zoya"]);
  });

  it("puts attendees with no year at the end", () => {
    const sorted = [p("NoYear"), p("Zoya", "4th Year")]
      .sort(compareByYearThenName)
      .map((s) => s.name);
    expect(sorted).toEqual(["Zoya", "NoYear"]);
  });

  it("produces the real dataset's year order", () => {
    const sorted = [p("d", "Other"), p("c", "Final year"), p("b", "4th Year"), p("a", "3rd Year")]
      .sort(compareByYearThenName)
      .map((s) => s.name);
    expect(sorted).toEqual(["a", "b", "c", "d"]);
  });
});

describe("canonicalYear", () => {
  it("folds the case differences two sheets produce", () => {
    expect(canonicalYear("3rd year")).toBe(canonicalYear("3rd Year"));
    expect(canonicalYear("final year")).toBe(canonicalYear("Final year"));
  });

  it("keeps an ordinal suffix lowercase", () => {
    expect(canonicalYear("3RD YEAR")).toBe("3rd Year");
    expect(canonicalYear("4th year")).toBe("4th Year");
  });

  it("capitalises words that do not start with a digit", () => {
    expect(canonicalYear("final year")).toBe("Final Year");
    expect(canonicalYear("other")).toBe("Other");
  });

  it("collapses stray whitespace", () => {
    expect(canonicalYear("  3rd    year  ")).toBe("3rd Year");
  });

  it("leaves empty as empty", () => {
    expect(canonicalYear("")).toBe("");
    expect(canonicalYear("   ")).toBe("");
  });

  it("still sorts correctly after normalising", () => {
    const years = ["final year", "3rd Year", "4th year", "Other"]
      .map(canonicalYear)
      .sort((a, b) => yearRank(a) - yearRank(b));
    expect(years).toEqual(["3rd Year", "4th Year", "Final Year", "Other"]);
  });
});
