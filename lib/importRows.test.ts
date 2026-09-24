import { describe, it, expect } from "vitest";
import { mapImportRows } from "./importRows";

describe("mapImportRows — header handling", () => {
  it("matches headers regardless of case and padding", () => {
    const { rows } = mapImportRows([
      { "  Full Name ": "Neel Gandhi", "EMAIL ADDRESS": "neel@example.com" },
    ]);
    expect(rows[0].name).toBe("Neel Gandhi");
    expect(rows[0].email).toBe("neel@example.com");
  });

  it("lowercases the email but leaves the name alone", () => {
    const { rows } = mapImportRows([{ Name: "Neel Gandhi", Email: "NEEL@Example.COM" }]);
    expect(rows[0].email).toBe("neel@example.com");
    expect(rows[0].name).toBe("Neel Gandhi");
  });

  it("maps a College header onto institution", () => {
    const { rows } = mapImportRows([{ Name: "A", College: "VNSGU" }]);
    expect(rows[0].institution).toBe("VNSGU");
  });

  it("keeps unmapped columns in attributes rather than dropping them", () => {
    const { rows } = mapImportRows([
      { Name: "A", Email: "a@x.com", Year: "3rd Year", Branch: "MscIT", "Roll No": "42" },
    ]);
    expect(rows[0].attributes).toEqual({ year: "3rd Year", branch: "MscIT", "roll no": "42" });
  });

  it("omits blank cells from attributes instead of storing empty strings", () => {
    const { rows } = mapImportRows([{ Name: "A", Year: "", Branch: "  " }]);
    expect(rows[0].attributes).toEqual({});
  });

  it("normalises a WordPress profile URL in the sheet", () => {
    const { rows } = mapImportRows([
      { Name: "A", "WordPress.org Username": "https://profiles.wordpress.org/Sajid/" },
    ]);
    expect(rows[0].wpUsername).toBe("sajid");
  });

  it("reports a blank handle as null so a blank cell can never erase one", () => {
    const { rows } = mapImportRows([{ Name: "A", "WP Username": "" }]);
    expect(rows[0].wpUsername).toBeNull();
  });

  it("returns null, not empty string, for missing optional fields", () => {
    const { rows } = mapImportRows([{ Name: "A" }]);
    expect(rows[0]).toMatchObject({
      email: null,
      phone: null,
      institution: null,
      wpUsername: null,
    });
  });
});

describe("mapImportRows — skipping", () => {
  it("skips a row with no name and says why", () => {
    const { rows, skipped } = mapImportRows([
      { Name: "", Email: "a@x.com" },
      { Name: "Real Person", Email: "b@x.com" },
    ]);
    expect(rows).toHaveLength(1);
    expect(skipped).toHaveLength(1);
    expect(skipped[0].kind).toBe("invalid");
  });

  it("skips an in-file duplicate email and names the row that claimed it first", () => {
    const { rows, skipped } = mapImportRows([
      { Name: "First", Email: "same@x.com" },
      { Name: "Second", Email: "SAME@x.com" },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe("First");
    expect(skipped[0].kind).toBe("duplicate");
    expect(skipped[0].reason).toContain("row 2");
  });

  it("does not treat rows without an email as duplicates of each other", () => {
    const { rows, skipped } = mapImportRows([{ Name: "A" }, { Name: "B" }]);
    expect(rows).toHaveLength(2);
    expect(skipped).toHaveLength(0);
  });
});

describe("mapImportRows — row numbers", () => {
  it("assumes a header row when __row is absent", () => {
    const { rows } = mapImportRows([{ Name: "A" }, { Name: "B" }]);
    expect(rows.map((r) => r.row)).toEqual([2, 3]);
  });

  it("uses __row when the caller supplies it", () => {
    const { rows } = mapImportRows([{ Name: "A", __row: 57 }]);
    expect(rows[0].row).toBe(57);
  });

  it("never treats __row as a data column", () => {
    const { rows } = mapImportRows([{ Name: "A", __row: 57 }]);
    expect(rows[0].attributes).toEqual({});
  });
});
