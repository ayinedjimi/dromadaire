// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  parseCSVLine,
  detectCSSFramework,
  buildHTMLBlobContent,
  markdownToHtml,
} from "./renderers";

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
});

// ── parseCSVLine ──

describe("parseCSVLine", () => {
  it("parses simple comma-separated values", () => {
    expect(parseCSVLine("a,b,c")).toEqual(["a", "b", "c"]);
  });

  it("handles quoted fields containing commas", () => {
    const result = parseCSVLine('"Smith, John",42');
    expect(result).toEqual(["Smith, John", "42"]);
  });

  it("handles escaped double-quotes inside quoted fields", () => {
    const result = parseCSVLine('"He said ""hello""",done');
    expect(result).toEqual(['He said "hello"', "done"]);
  });

  it("handles empty fields between commas", () => {
    expect(parseCSVLine("a,,c")).toEqual(["a", "", "c"]);
  });

  it("returns a single-element array for a single field", () => {
    expect(parseCSVLine("hello")).toEqual(["hello"]);
  });

  it("returns a single empty string for an empty input", () => {
    expect(parseCSVLine("")).toEqual([""]);
  });
});

// ── detectCSSFramework ──

describe("detectCSSFramework", () => {
  it("detects Tailwind when 3+ distinct TW prefix categories are used", () => {
    const html = '<div class="flex bg-blue-500 p-4 text-white rounded">hello</div>';
    const result = detectCSSFramework(html);
    expect(result.tailwind).toBe(true);
    expect(result.bootstrap).toBe(false);
  });

  it("detects Bootstrap when 2+ distinct BS classes are used", () => {
    const html = '<div class="container"><button class="btn btn-primary">Go</button></div>';
    const result = detectCSSFramework(html);
    expect(result.bootstrap).toBe(true);
    expect(result.tailwind).toBe(false);
  });

  it("returns false for both when no framework classes are present", () => {
    const html = '<div class="my-custom-class another-class">plain</div>';
    const result = detectCSSFramework(html);
    expect(result.tailwind).toBe(false);
    expect(result.bootstrap).toBe(false);
  });

  it("detects both frameworks when both are present", () => {
    const html =
      '<div class="flex bg-red-500 p-2 text-lg container btn card">mixed</div>';
    const result = detectCSSFramework(html);
    expect(result.tailwind).toBe(true);
    expect(result.bootstrap).toBe(true);
  });

  it("returns false for both when there are no class attributes", () => {
    const html = "<div><p>No classes here</p></div>";
    const result = detectCSSFramework(html);
    expect(result.tailwind).toBe(false);
    expect(result.bootstrap).toBe(false);
  });
});

// ── buildHTMLBlobContent ──

describe("buildHTMLBlobContent", () => {
  it("outputs a full HTML document with DOCTYPE and meta charset", () => {
    const result = buildHTMLBlobContent("<p>Hello</p>");
    expect(result).toContain("<!DOCTYPE html>");
    expect(result).toContain('<meta charset="utf-8">');
    expect(result).toContain('<meta name="viewport"');
  });

  it("includes the storage sandbox security script", () => {
    const result = buildHTMLBlobContent("<p>Test</p>");
    expect(result).toContain("localStorage");
    expect(result).toContain("SecurityError");
    expect(result).toContain("sessionStorage");
    expect(result).toContain("indexedDB");
  });

  it("auto-injects Tailwind script tag when code uses TW classes", () => {
    const twCode = '<div class="flex bg-blue-500 p-4 text-white rounded">TW</div>';
    const result = buildHTMLBlobContent(twCode);
    expect(result).toContain("tailwind.js");
  });

  it("does not inject Tailwind when code already references tailwindcss", () => {
    const twCode =
      '<script src="https://cdn.tailwindcss.com"></script><div class="flex bg-blue-500 p-4 text-white rounded">TW</div>';
    const result = buildHTMLBlobContent(twCode);
    // The vendor tailwind.js should NOT appear since the code already has tailwindcss
    const vendorMatches = result.match(/vendor\/tailwind\.js/g);
    expect(vendorMatches).toBeNull();
  });

  it("does not inject Tailwind when fewer than 3 TW prefix categories", () => {
    const code = '<div class="flex block">not enough</div>';
    const result = buildHTMLBlobContent(code);
    expect(result).not.toContain("tailwind.js");
  });

  it("applies theme class to the html element", () => {
    const result = buildHTMLBlobContent("<p>Hi</p>", { theme: "dark" });
    expect(result).toContain('<html class="dark">');
  });

  it("includes the user code in the body", () => {
    const code = "<h1>My Artifact</h1>";
    const result = buildHTMLBlobContent(code);
    expect(result).toContain("<h1>My Artifact</h1>");
  });
});

// ── markdownToHtml ──

describe("markdownToHtml", () => {
  it("converts headers (h1-h4)", () => {
    expect(markdownToHtml("# Title")).toContain("<h1>Title</h1>");
    expect(markdownToHtml("## Sub")).toContain("<h2>Sub</h2>");
    expect(markdownToHtml("### Third")).toContain("<h3>Third</h3>");
    expect(markdownToHtml("#### Fourth")).toContain("<h4>Fourth</h4>");
  });

  it("converts bold text", () => {
    const result = markdownToHtml("This is **bold** text");
    expect(result).toContain("<strong>bold</strong>");
  });

  it("converts italic text", () => {
    const result = markdownToHtml("This is *italic* text");
    expect(result).toContain("<em>italic</em>");
  });

  it("converts bold-italic text", () => {
    const result = markdownToHtml("***both***");
    expect(result).toContain("<strong><em>both</em></strong>");
  });

  it("converts inline code", () => {
    const result = markdownToHtml("Use `const x = 1` here");
    expect(result).toContain("<code");
    expect(result).toContain("const x = 1");
  });

  it("converts links with target=_blank", () => {
    const result = markdownToHtml("[Click](https://example.com)");
    expect(result).toContain('href="https://example.com"');
    expect(result).toContain('target="_blank"');
    expect(result).toContain(">Click</a>");
  });

  it("converts horizontal rules", () => {
    expect(markdownToHtml("---")).toContain("<hr>");
    expect(markdownToHtml("***")).toContain("<hr>");
    expect(markdownToHtml("___")).toContain("<hr>");
  });

  it("converts blockquotes", () => {
    const result = markdownToHtml("> Quote here");
    expect(result).toContain("<blockquote");
    expect(result).toContain("Quote here");
  });

  it("converts images", () => {
    const result = markdownToHtml("![Alt text](image.png)");
    expect(result).toContain('<img alt="Alt text" src="image.png"');
  });
});
