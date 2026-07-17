import { describe, it, expect } from "vitest";
import { highlighterPromise, highlighter } from "./highlighter";

describe("highlighter", () => {
  it("highlighterPromise resolves correctly", async () => {
    const h = await highlighterPromise;
    expect(h).toBeDefined();
    expect(h).not.toBeNull();
  });

  it("highlighter module variable is non-null after await", async () => {
    await highlighterPromise;
    expect(highlighter).not.toBeNull();
    expect(highlighter).toBeDefined();
  });

  it("has both one-light and one-dark themes available", async () => {
    const h = await highlighterPromise;
    const themes = h.getLoadedThemes();
    expect(themes).toContain("one-light");
    expect(themes).toContain("one-dark");
  });
});
