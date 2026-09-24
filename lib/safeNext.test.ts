import { describe, expect, it } from "vitest";
import { safeNext } from "./safeNext";

const ORIGIN = "https://wpccportal.vercel.app";

describe("safeNext", () => {
  it("keeps an in-app path", () => {
    expect(safeNext("/join/abc123")).toBe("/join/abc123");
    expect(safeNext("/o/wpcc-surat?tab=team")).toBe("/o/wpcc-surat?tab=team");
  });

  it("falls back when there is nothing usable", () => {
    expect(safeNext(null)).toBe("/dashboard");
    expect(safeNext("")).toBe("/dashboard");
    expect(safeNext(42)).toBe("/dashboard");
  });

  it("refuses protocol-relative paths", () => {
    expect(safeNext("//evil.com/x")).toBe("/dashboard");
    expect(safeNext("/\\evil.com")).toBe("/dashboard");
  });

  it("refuses absolute urls unless an origin is given and matches", () => {
    expect(safeNext(`${ORIGIN}/join/abc`)).toBe("/dashboard");
    expect(safeNext(`${ORIGIN}/join/abc`, ORIGIN)).toBe("/join/abc");
    expect(safeNext("https://evil.com/join/abc", ORIGIN)).toBe("/dashboard");
    expect(safeNext("https://wpccportal.vercel.app.evil.com/x", ORIGIN)).toBe("/dashboard");
  });

  it("does not let a same-origin url smuggle a protocol-relative path", () => {
    expect(safeNext(`${ORIGIN}//evil.com`, ORIGIN)).toBe("/dashboard");
  });

  it("refuses non-http schemes", () => {
    expect(safeNext("javascript:alert(1)", ORIGIN)).toBe("/dashboard");
  });
});
