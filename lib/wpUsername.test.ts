import { describe, it, expect } from "vitest";
import { normalizeWpUsername, wpUsernameError } from "./wpUsername";

describe("normalizeWpUsername", () => {
  it("passes a plain handle through, lowercased", () => {
    expect(normalizeWpUsername("sajid")).toBe("sajid");
    expect(normalizeWpUsername("SAJID")).toBe("sajid");
  });

  it("strips a leading @, however many", () => {
    expect(normalizeWpUsername("@sajid")).toBe("sajid");
    expect(normalizeWpUsername("@@sajid")).toBe("sajid");
  });

  it("pulls the handle out of a profile URL", () => {
    expect(normalizeWpUsername("profiles.wordpress.org/sajid")).toBe("sajid");
    expect(normalizeWpUsername("https://profiles.wordpress.org/sajid/")).toBe("sajid");
    expect(normalizeWpUsername("http://profiles.wordpress.org/Sajid")).toBe("sajid");
  });

  it("ignores query strings and fragments on a profile URL", () => {
    expect(normalizeWpUsername("https://profiles.wordpress.org/sajid?tab=x")).toBe("sajid");
    expect(normalizeWpUsername("https://profiles.wordpress.org/sajid#bio")).toBe("sajid");
  });

  it("trims surrounding whitespace", () => {
    expect(normalizeWpUsername("  sajid  ")).toBe("sajid");
  });

  it("returns empty for blank input", () => {
    expect(normalizeWpUsername("")).toBe("");
    expect(normalizeWpUsername("   ")).toBe("");
  });
});

describe("wpUsernameError", () => {
  it("accepts empty, because the field is optional", () => {
    expect(wpUsernameError("")).toBeNull();
  });

  it("accepts ordinary handles", () => {
    expect(wpUsernameError("sajid")).toBeNull();
    expect(wpUsernameError("sajid-ansari")).toBeNull();
    expect(wpUsernameError("sajid.ansari_65")).toBeNull();
    expect(wpUsernameError("a")).toBeNull();
  });

  it("rejects spaces and other stray characters", () => {
    expect(wpUsernameError("sajid ansari")).not.toBeNull();
    expect(wpUsernameError("sajid@example.com")).not.toBeNull();
  });

  it("rejects a leading or trailing separator", () => {
    expect(wpUsernameError("-sajid")).not.toBeNull();
    expect(wpUsernameError("sajid-")).not.toBeNull();
  });

  it("rejects anything over 60 characters", () => {
    expect(wpUsernameError("a".repeat(60))).toBeNull();
    expect(wpUsernameError("a".repeat(61))).not.toBeNull();
  });
});
