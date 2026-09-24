import { describe, it, expect } from "vitest";
import { slugify } from "./slug";

describe("slugify", () => {
  it("lowercases and joins words with dashes", () => {
    expect(slugify("WPCC Surat 2027")).toBe("wpcc-surat-2027");
  });

  it("collapses runs of punctuation into a single dash", () => {
    expect(slugify("Hack — the   Campus!!")).toBe("hack-the-campus");
  });

  it("never starts or ends with a dash", () => {
    expect(slugify("  ...Surat...  ")).toBe("surat");
  });

  it("returns empty when there is nothing usable", () => {
    expect(slugify("!!!")).toBe("");
    expect(slugify("")).toBe("");
  });

  it("caps the length, so a pasted paragraph cannot become a URL", () => {
    expect(slugify("a".repeat(200))).toHaveLength(60);
  });
});
