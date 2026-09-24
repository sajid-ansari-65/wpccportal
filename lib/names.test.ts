import { describe, it, expect } from "vitest";
import { titleCaseName } from "./names";

describe("titleCaseName", () => {
  it("calms down a sheet written in block capitals", () => {
    expect(titleCaseName("AARSH HITESH GOPANI")).toBe("Aarsh Hitesh Gopani");
  });

  it("lifts an all-lowercase name", () => {
    expect(titleCaseName("arya shah")).toBe("Arya Shah");
  });

  it("fixes only the word that needs it", () => {
    expect(titleCaseName("Arya shah")).toBe("Arya Shah");
  });

  it("leaves a name that already mixes cases alone", () => {
    expect(titleCaseName("Ronald McDonald")).toBe("Ronald McDonald");
    expect(titleCaseName("Maria D'Souza")).toBe("Maria D'Souza");
  });

  it("capitalises each segment of an initial", () => {
    expect(titleCaseName("j.p. dawer")).toBe("J.P. Dawer");
    expect(titleCaseName("J.P. DAWER")).toBe("J.P. Dawer");
  });

  it("capitalises across hyphens and apostrophes", () => {
    expect(titleCaseName("jean-paul o'brien")).toBe("Jean-Paul O'Brien");
  });

  it("collapses stray whitespace", () => {
    expect(titleCaseName("  aarsh   gopani ")).toBe("Aarsh Gopani");
  });

  it("leaves empty as empty", () => {
    expect(titleCaseName("")).toBe("");
    expect(titleCaseName("   ")).toBe("");
  });
});
