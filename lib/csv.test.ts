import { describe, it, expect } from "vitest";
import { toCsvValue, toCsvRow, toCsv } from "./csv";

describe("toCsvValue", () => {
  it("leaves an ordinary value unquoted", () => {
    expect(toCsvValue("Neel Gandhi")).toBe("Neel Gandhi");
  });

  it("quotes a value containing a comma", () => {
    expect(toCsvValue("Dawer Institute, Surat")).toBe('"Dawer Institute, Surat"');
  });

  it("doubles embedded quotes", () => {
    expect(toCsvValue('He said "hi"')).toBe('"He said ""hi"""');
  });

  it("quotes a value containing a newline", () => {
    expect(toCsvValue("line1\nline2")).toBe('"line1\nline2"');
  });
});

describe("toCsvRow", () => {
  it("renders null and undefined as empty, never as the words", () => {
    expect(toCsvRow(["a", null, undefined, "b"])).toBe("a,,,b");
  });
});

describe("toCsv", () => {
  it("puts the header first and joins with newlines", () => {
    expect(toCsv(["Name", "Year"], [["Aarti", "3rd Year"], ["Zoya", "Final year"]])).toBe(
      "Name,Year\nAarti,3rd Year\nZoya,Final year"
    );
  });
});
